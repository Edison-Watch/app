; SealGate for Beeper - the Windows setup program.
;
; Installs the sealgate-stdiod daemon and a private Node runtime, then walks
; the person through what only they can do: approve this PC in the browser,
; sign in to Beeper, click Allow in Beeper. Each step is a
; `sealgate-stdiod setup ...` command (crates/sealgate-stdiod/src/setup); this
; script only asks for them in order and shows what they report.
;
; Built by build.ps1, which stages the files and passes the defines below. The
; install folder is the one scripts/install-beeper.ps1 uses, so either one
; upgrades the other.

; ExecAndCaptureOutput, which shows each step's output, arrived in 6.3.
#if Ver < EncodeVer(6, 3, 0)
  #error Inno Setup 6.3 or newer is required
#endif

#ifndef Backend
  #define Backend "https://beeper.sealgate.ai"
#endif
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
; The numeric part of AppVersion (0.6.19 for 0.6.19-beta.3): Windows file
; versions take numbers only. build.ps1 passes it.
#ifndef FileVersion
  #define FileVersion "0.0.0"
#endif
#ifndef Stage
  #define Stage "stage"
#endif
#ifndef OutputName
  #define OutputName "SealGate-Beeper-Setup"
#endif
; build.ps1 -SignCommand: the setup, its uninstaller and the daemon are signed
; with the "sealgate" sign tool it passes to ISCC.
#ifdef Sign
  #define SignFlag " signonce"
#else
  #define SignFlag ""
#endif

[Setup]
AppId={{6F1E9B7C-2D4A-4E7B-9C3F-5A8D1B2E4C60}
AppName=SealGate for Beeper
AppVersion={#AppVersion}
VersionInfoVersion={#FileVersion}
VersionInfoTextVersion={#AppVersion}
VersionInfoProductTextVersion={#AppVersion}
AppPublisher=SealGate
AppPublisherURL=https://sealgate.ai
DefaultDirName={localappdata}\Programs\sealgate-stdiod
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputBaseFilename={#OutputName}
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
ChangesEnvironment=yes
UninstallDisplayName=SealGate for Beeper
UninstallDisplayIcon={app}\sealgate-stdiod.exe
#ifdef Sign
SignTool=sealgate
SignedUninstaller=yes
#endif
; Images from assets/make_images.py, one per DPI; Inno picks the closest.
DisableWelcomePage=no
SetupIconFile=assets\setup.ico
WizardImageFile=assets\banner-164.bmp,assets\banner-192.bmp,assets\banner-246.bmp,assets\banner-273.bmp,assets\banner-328.bmp,assets\banner-355.bmp,assets\banner-410.bmp
WizardSmallImageFile=assets\header-55.bmp,assets\header-64.bmp,assets\header-83.bmp,assets\header-92.bmp,assets\header-110.bmp,assets\header-119.bmp,assets\header-138.bmp

[Messages]
WelcomeLabel1=Welcome to SealGate for Beeper
WelcomeLabel2=This sets up SealGate on this computer and connects it to Beeper, so your AI assistant can read and send your messages safely.%n%nIt takes three short steps: sign in to SealGate, set up Beeper, and allow SealGate in Beeper.
; Inno adds this line under the welcome text; the buttons read Install and Exit.
ClickNext=Click Install to continue, or Exit to close Setup.

[Files]
; IsArm64 rather than the architecture filter: x64compatible also matches an
; ARM PC, which must get the native build.
Source: "{#Stage}\x64\sealgate-stdiod.exe"; DestDir: "{app}"; Check: not IsArm64; Flags: ignoreversion{#SignFlag}
Source: "{#Stage}\arm64\sealgate-stdiod.exe"; DestDir: "{app}"; Check: IsArm64; Flags: ignoreversion{#SignFlag}
; The daemon looks for npx in <exe dir>\runtimes\node on its own.
Source: "{#Stage}\x64\node\*"; DestDir: "{app}\runtimes\node"; Check: not IsArm64; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Stage}\arm64\node\*"; DestDir: "{app}\runtimes\node"; Check: IsArm64; Flags: ignoreversion recursesubdirs createallsubdirs

[Registry]
; `sealgate-stdiod` on the user's PATH, as the install script does.
Root: HKCU; Subkey: "Environment"; ValueType: expandsz; ValueName: "Path"; ValueData: "{olddata};{app}"; Check: NeedsAddPath(ExpandConstant('{app}'))

[UninstallDelete]
; The folder belongs to SealGate alone: also remove what this setup did not
; install itself (an earlier PowerShell install, files written at run time).
; The sign-in, logs and Beeper access live in the user's profile; the
; uninstaller removes them too unless the user keeps them (UninstallData).
Type: filesandordirs; Name: "{app}"

[Code]
const
  UNINSTALL_KEY = 'Software\Microsoft\Windows\CurrentVersion\Uninstall';
  { Set when this setup installed Beeper, so the uninstaller offers to remove
    it ticked. Removed with SealGate's settings. }
  SEALGATE_KEY = 'Software\SealGate\Beeper';
  INSTALLED_BEEPER = 'InstalledBeeper';
  EXIT_OK = 0;
  EXIT_NOT_YET = 2;
  EXIT_STOPPED = 130;
  { The steps that wait for the person, and so run in the background. }
  STEP_NONE = 0;
  STEP_LOGIN = 1;
  STEP_BEEPER = 2;
  STEP_APPROVE = 3;
  { Restarting Beeper: after its first-run setup (Beeper page), and before
    asking again after a missed Allow (Allow page). }
  STEP_RESTART = 4;
  STEP_RESTART_ALLOW = 5;
  APPROVE_TIMEOUT = 180;
  { What the Beeper page found, which decides its text and big button. }
  BEEPER_CHECKING = 0;
  BEEPER_READY = 1;
  BEEPER_NOT_READY = 2;
  BEEPER_RETRY = 3;
  { Where a Beeper that is not ready yet stands: waiting for the first-run
    sign-in (Continue restarts it), or for MCP, before or after a restart. }
  STAGE_SIGN_IN = 0;
  STAGE_MCP = 1;
  STAGE_RESTARTED = 2;
  { A tick-list row's state. }
  RS_PENDING = 0;
  RS_BUSY = 1;
  RS_DONE = 2;
  RS_FAILED = 3;
  RS_SKIPPED = 4;
  { Row icons: glyphs of the icon font every Windows 10+ has. }
  GLYPH_FONT = 'Segoe MDL2 Assets';
  GLYPH_DONE = #$E930;
  GLYPH_PENDING = #$EA3A;
  GLYPH_FAILED = #$E783;
  GLYPH_SKIPPED = #$E738;
  GLYPH_BROWSER = #$E774;
  GLYPH_DOWNLOAD = #$E896;
  GLYPH_PACKAGE = #$E7B8;
  GLYPH_WAIT = #$E823;
  GLYPH_SYNC = #$E895;
  { Colours, as $BBGGRR. }
  CLR_DONE = $0F7B0F;
  CLR_BUSY = $C06700;
  CLR_FAILED = $1C2BC4;
  CLR_PENDING = $9A9A9A;
  CLR_MUTED = $6B6B6B;

var
  SignInPage, BeeperPage, AllowPage: TOutputMsgMemoWizardPage;
  SignInButton, BeeperButton, AllowButton, OtherAccountButton: TNewButton;
  Backend: String;
  { Whether this PC was already signed in to Backend when the sign-in page
    opened, and whether the person asked to use another account instead. }
  AlreadySignedIn, UseOtherAccount: Boolean;
  { The signed-in account's email, when the backend says (it may not). }
  SignedInEmail: String;
  { The step running in the background, the page and row it reports to,
    and the files it is followed through (src/setup/stepio.rs). }
  StepKind, StepRow: Integer;
  StepPage: TOutputMsgMemoWizardPage;
  StepOut, StepRc, StepStop: String;
  StepTimer, StepStarted: LongWord;
  { Set while moving on after a step succeeded, so NextButtonClick can tell
    that from the person pressing Skip. }
  Advancing: Boolean;
  { What each page achieved, for the last page. }
  SignInDone, BeeperDone, AllowDone: Boolean;
  BeeperState, BeeperStage: Integer;
  { Beeper had never run on this account when setup started. Its first-run
    setup swallows SealGate's request to be let in, and only a restart clears
    it, so the Beeper page waits for the person and then restarts it. }
  BeeperFresh: Boolean;
  { The last Allow timed out: restart Beeper before asking again. }
  AllowMissed: Boolean;
  { The uninstall window's choices, and the Beeper it found. }
  UninstallData, UninstallBeeper, HasBeeper: Boolean;
  BeeperKey, BeeperCommand, BeeperExe: String;
  ClosingEarly: Boolean;
  { The tick lists: one row is an icon, a label, a detail on the right and
    an optional progress bar under it, shown while the row is busy. }
  RowIcon, RowText, RowDetail: array of TNewStaticText;
  RowBar: array of TNewProgressBar;
  RowBusyGlyph: array of String;
  RowState, RowRight: array of Integer;
  RowCount: Integer;
  RowLogin, RowStart: Integer;
  RowCheck, RowDownload, RowInstall, RowSignIn, RowRestartBeeper, RowMcp: Integer;
  RowRegister, RowAllow, RowRestart: Integer;
  RowSummary: Integer;
  LaidOut: Boolean;
#ifdef DebugUi
  DebugButton: TNewButton;
  DebugState: Integer;
#endif

function SetTimer(hWnd, nIDEvent, uElapse, lpTimerFunc: LongWord): LongWord;
  external 'SetTimer@user32.dll stdcall';
function KillTimer(hWnd, uIDEvent: LongWord): LongWord;
  external 'KillTimer@user32.dll stdcall';
function WinTickCount(): LongWord;
  external 'GetTickCount@kernel32.dll stdcall';
function GetSystemMenu(hWnd: HWND; bRevert: BOOL): LongWord;
  external 'GetSystemMenu@user32.dll stdcall';
function EnableMenuItem(hMenu, uIDEnableItem, uEnable: LongWord): BOOL;
  external 'EnableMenuItem@user32.dll stdcall';

{ The deployment this setup program is for, or /backend=URL for testing. }
function GetBackend(): String;
begin
  Result := ExpandConstant('{param:backend|{#Backend}}');
end;

function NeedsAddPath(Dir: String): Boolean;
var
  Path: String;
begin
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', Path) then
    Path := '';
  Result := Pos(';' + Uppercase(Dir) + ';', ';' + Uppercase(Path) + ';') = 0;
end;

function DaemonExe(): String;
begin
  Result := ExpandConstant('{app}\sealgate-stdiod.exe');
end;

{ Run one quick daemon command hidden, wait for it, and return its exit code
  with what it printed. -1 when it could not be started at all. }
function Stdiod(Params: String; var Output: String): Integer;
var
  ResultCode, I: Integer;
  Captured: TExecOutput;
begin
  Output := '';
  if not ExecAndCaptureOutput(DaemonExe(), Params, '', SW_HIDE,
      ewWaitUntilTerminated, ResultCode, Captured) then
  begin
    Output := SysErrorMessage(ResultCode);
    Result := -1;
    exit;
  end;
  for I := 0 to GetArrayLength(Captured.StdOut) - 1 do
    Output := Output + Captured.StdOut[I] + #13#10;
  for I := 0 to GetArrayLength(Captured.StdErr) - 1 do
    Output := Output + Captured.StdErr[I] + #13#10;
  Result := ResultCode;
end;

{ ---- Tick lists ---- }

function AddRow(Parent: TWinControl; Left, Right: Integer; Caption, BusyGlyph: String;
  WithBar: Boolean): Integer;
var
  I: Integer;
begin
  I := RowCount;
  RowCount := RowCount + 1;
  SetArrayLength(RowIcon, RowCount);
  SetArrayLength(RowText, RowCount);
  SetArrayLength(RowDetail, RowCount);
  SetArrayLength(RowBar, RowCount);
  SetArrayLength(RowBusyGlyph, RowCount);
  SetArrayLength(RowState, RowCount);
  SetArrayLength(RowRight, RowCount);

  RowIcon[I] := TNewStaticText.Create(Parent);
  RowIcon[I].Parent := Parent;
  RowIcon[I].Font.Name := GLYPH_FONT;
  RowIcon[I].Font.Size := 11;
  RowIcon[I].Left := Left;

  RowText[I] := TNewStaticText.Create(Parent);
  RowText[I].Parent := Parent;
  RowText[I].Caption := Caption;
  RowText[I].Left := Left + ScaleX(26);

  RowDetail[I] := TNewStaticText.Create(Parent);
  RowDetail[I].Parent := Parent;
  RowDetail[I].Font.Color := CLR_MUTED;

  RowBar[I] := nil;
  if WithBar then
  begin
    RowBar[I] := TNewProgressBar.Create(Parent);
    RowBar[I].Parent := Parent;
    RowBar[I].Left := Left + ScaleX(26);
    RowBar[I].Width := Right - RowBar[I].Left;
    RowBar[I].Height := ScaleY(6);
    RowBar[I].Min := 0;
    RowBar[I].Max := 100;
    RowBar[I].Visible := False;
  end;
  RowBusyGlyph[I] := BusyGlyph;
  RowRight[I] := Right;
  RowState[I] := -1;
  Result := I;
end;

{ Stack rows First..Last from Top; returns the bottom. }
function LayoutRows(First, Last, Top: Integer): Integer;
var
  I: Integer;
begin
  for I := First to Last do
  begin
    RowIcon[I].Top := Top;
    RowText[I].Top := Top + ScaleY(2);
    RowDetail[I].Top := Top + ScaleY(2);
    Top := Top + ScaleY(24);
    if (RowBar[I] <> nil) and RowBar[I].Visible then
    begin
      RowBar[I].Top := Top - ScaleY(2);
      Top := Top + ScaleY(10);
    end;
  end;
  Result := Top;
end;

{ Stack a page: its text, big button, the optional small button under it,
  its rows, then the output box when it has something to show. }
procedure LayoutActionPage(Page: TOutputMsgMemoWizardPage; Button, Extra: TNewButton;
  First, Last: Integer);
var
  Bottom, Room: Integer;
begin
  Page.SubCaptionLabel.AdjustHeight();
  Button.Top := Page.SubCaptionLabel.Top + Page.SubCaptionLabel.Height + ScaleY(12);
  Bottom := Button.Top + Button.Height;
  if (Extra <> nil) and Extra.Visible then
  begin
    Extra.Top := Bottom + ScaleY(6);
    Extra.Left := (Page.SurfaceWidth - Extra.Width) div 2;
    Bottom := Extra.Top + Extra.Height;
  end;
  Bottom := LayoutRows(First, Last, Bottom + ScaleY(18));
  Room := Page.SurfaceHeight;
#ifdef DebugUi
  if Page = SignInPage then
    Room := Room - DebugButton.Height - ScaleY(6);
#endif
  Page.RichEditViewer.Top := Bottom + ScaleY(4);
  Page.RichEditViewer.Height := Room - Page.RichEditViewer.Top;
  Page.RichEditViewer.Visible := (Page.RichEditViewer.Text <> '') and
    (Page.RichEditViewer.Height > ScaleY(30));
end;

procedure Relayout();
begin
  if not LaidOut then
    exit;
  LayoutActionPage(SignInPage, SignInButton, OtherAccountButton, RowLogin, RowStart);
  LayoutActionPage(BeeperPage, BeeperButton, nil, RowCheck, RowMcp);
  LayoutActionPage(AllowPage, AllowButton, nil, RowRegister, RowRestart);
end;

procedure SetRow(I, State: Integer; Detail: String);
var
  WasBar: Boolean;
begin
  if (RowState[I] = State) and (RowDetail[I].Caption = Detail) then
    exit;
  RowState[I] := State;
  case State of
    RS_PENDING:
      begin
        RowIcon[I].Caption := GLYPH_PENDING;
        RowIcon[I].Font.Color := CLR_PENDING;
        RowText[I].Font.Color := CLR_MUTED;
      end;
    RS_BUSY:
      begin
        RowIcon[I].Caption := RowBusyGlyph[I];
        RowIcon[I].Font.Color := CLR_BUSY;
        RowText[I].Font.Color := clWindowText;
      end;
    RS_DONE:
      begin
        RowIcon[I].Caption := GLYPH_DONE;
        RowIcon[I].Font.Color := CLR_DONE;
        RowText[I].Font.Color := clWindowText;
      end;
    RS_FAILED:
      begin
        RowIcon[I].Caption := GLYPH_FAILED;
        RowIcon[I].Font.Color := CLR_FAILED;
        RowText[I].Font.Color := clWindowText;
      end;
    RS_SKIPPED:
      begin
        RowIcon[I].Caption := GLYPH_SKIPPED;
        RowIcon[I].Font.Color := CLR_PENDING;
        RowText[I].Font.Color := CLR_MUTED;
      end;
  end;
  RowDetail[I].Caption := Detail;
  RowDetail[I].Left := RowRight[I] - RowDetail[I].Width;
  if RowBar[I] <> nil then
  begin
    WasBar := RowBar[I].Visible;
    RowBar[I].Visible := State = RS_BUSY;
    if WasBar <> RowBar[I].Visible then
      Relayout();
  end;
end;

{ A busy row's bar: 0..100, or -1 for one that just moves. }
procedure SetRowProgress(I, Percent: Integer);
begin
  if Percent < 0 then
    RowBar[I].Style := npbstMarquee
  else begin
    RowBar[I].Style := npbstNormal;
    RowBar[I].Position := Percent;
  end;
end;

procedure SetRowCaption(I: Integer; Caption: String);
begin
  RowText[I].Caption := Caption;
end;

{ After a step ended: its busy rows become State. }
procedure EndBusyRows(First, Last, State: Integer; Detail: String);
var
  I: Integer;
begin
  for I := First to Last do
    if RowState[I] = RS_BUSY then
      SetRow(I, State, Detail);
end;

procedure PageRows(Page: TOutputMsgMemoWizardPage; var First, Last: Integer);
begin
  if Page = SignInPage then
  begin
    First := RowLogin;
    Last := RowStart;
  end else if Page = BeeperPage then
  begin
    First := RowCheck;
    Last := RowMcp;
  end else begin
    First := RowRegister;
    Last := RowRestart;
  end;
end;

{ Details under the rows: a step's output, or '' to hide the box. }
procedure Show(Page: TOutputMsgMemoWizardPage; Text: String);
begin
  if Page.RichEditViewer.Text = Text then
    exit;
  Page.RichEditViewer.Text := Text;
  Relayout();
  WizardForm.Refresh;
end;

{ ---- Steps ---- }

{ The bottom-right button: Skip, or Stop while a step runs. The big buttons
  are greyed out while a step runs. }
procedure UpdateButtons();
var
  Running: Boolean;
begin
  Running := StepKind <> STEP_NONE;
  if Running then
    WizardForm.NextButton.Caption := 'Stop'
  else begin
    WizardForm.NextButton.Caption := 'Skip';
    { Stop greys the button until the step has actually ended. }
    WizardForm.NextButton.Enabled := True;
  end;
  SignInButton.Enabled := not Running;
  OtherAccountButton.Enabled := not Running;
  BeeperButton.Enabled := not Running;
  AllowButton.Enabled := not Running;
end;

{ Give a page's big button the keyboard focus, when it can take it: Windows
  raises an error for a greyed-out or hidden one. }
procedure FocusButton(Button: TNewButton);
begin
  if Button.Enabled and Button.Visible then
    WizardForm.ActiveControl := Button;
end;

{ Leave the current page after its step succeeded. }
procedure MoveOn();
begin
  Advancing := True;
  try
    WizardForm.NextButton.OnClick(WizardForm.NextButton);
  finally
    Advancing := False;
  end;
end;

procedure StepFinished(Kind, Code: Integer; Output: String); forward;

{ The last "downloaded N%" figure in a step's output, or -1. }
function LastPercent(Output: String): Integer;
var
  P: Integer;
  Rest: String;
begin
  Result := -1;
  Rest := Output;
  P := Pos('downloaded ', Rest);
  while P > 0 do
  begin
    Rest := Copy(Rest, P + Length('downloaded '), Length(Rest));
    P := Pos('%', Rest);
    if (P > 0) and (P <= 4) then
      Result := StrToIntDef(Copy(Rest, 1, P - 1), Result);
    P := Pos('downloaded ', Rest);
  end;
end;

{ The Beeper rows, from what `setup install-beeper` has printed so far. }
procedure UpdateBeeperRows(Output: String);
var
  Percent: Integer;
begin
  if Pos('already installed', Output) > 0 then
  begin
    SetRow(RowCheck, RS_DONE, 'installed');
    SetRow(RowDownload, RS_SKIPPED, 'not needed');
    SetRow(RowInstall, RS_SKIPPED, 'not needed');
    exit;
  end;
  if Pos('downloading Beeper Desktop', Output) = 0 then
    exit;
  SetRow(RowCheck, RS_DONE, 'not installed');
  if Pos('signed by Beeper', Output) = 0 then
  begin
    Percent := LastPercent(Output);
    if Percent < 0 then
      SetRow(RowDownload, RS_BUSY, '')
    else
      SetRow(RowDownload, RS_BUSY, IntToStr(Percent) + '%');
    SetRowProgress(RowDownload, Percent);
    exit;
  end;
  SetRow(RowDownload, RS_DONE, '');
  if Pos('installed Beeper Desktop (', Output) > 0 then
    SetRow(RowInstall, RS_DONE, '')
  else if Pos('running the Beeper installer', Output) > 0 then
  begin
    SetRow(RowInstall, RS_BUSY, '');
    SetRowProgress(RowInstall, -1);
  end;
end;

{ m:ss left before `setup approve` gives up. }
function ApproveCountdown(): String;
var
  Left: Integer;
begin
  Left := APPROVE_TIMEOUT - (WinTickCount() - StepStarted) div 1000;
  if Left < 0 then
    Left := 0;
  Result := Format('%d:%.2d left', [Left div 60, Left mod 60]);
end;

{ Check the background step: show its progress so far, and finish it once
  it has written its exit code. }
procedure StepTick(Wnd, Msg, TimerId, Time: LongWord);
var
  Output, Rc: AnsiString;
  Kind, Code: Integer;
begin
  if StepKind = STEP_NONE then
    exit;
  Output := '';
  LoadStringFromFile(StepOut, Output);
  if not FileExists(StepRc) then
  begin
    case StepKind of
      STEP_BEEPER: UpdateBeeperRows(Output);
      { The browser link, in case the browser did not open. }
      STEP_LOGIN: Show(StepPage, Output);
      STEP_APPROVE:
        if not WizardForm.NextButton.Enabled then
          SetRow(StepRow, RS_BUSY, 'stopping...')
        else
          SetRow(StepRow, RS_BUSY, ApproveCountdown());
      STEP_RESTART, STEP_RESTART_ALLOW: SetRow(StepRow, RS_BUSY, 'restarting Beeper');
    end;
    exit;
  end;
  if not LoadStringFromFile(StepRc, Rc) then
    exit;
  KillTimer(0, StepTimer);
  Kind := StepKind;
  StepKind := STEP_NONE;
  Code := StrToIntDef(Trim(Rc), -1);
  UpdateButtons();
  StepFinished(Kind, Code, Output);
end;

{ Start a step that waits for the person, without waiting for it here. Row
  is the row that shows it as busy. }
procedure StartStep(Page: TOutputMsgMemoWizardPage; Kind: Integer; Params: String; Row: Integer);
var
  Base: String;
  Code: Integer;
begin
  Base := ExpandConstant('{tmp}\step');
  StepOut := Base + '.out';
  StepRc := Base + '.rc';
  StepStop := Base + '.stop';
  DeleteFile(StepOut);
  DeleteFile(StepRc);
  DeleteFile(StepStop);
  Show(Page, '');
  if not Exec(DaemonExe(), Params + ' --output-file "' + StepOut + '" --exit-code-file "' +
      StepRc + '" --stop-file "' + StepStop + '"', '', SW_HIDE, ewNoWait, Code) then
  begin
    SetRow(Row, RS_FAILED, '');
    Show(Page, 'Could not start SealGate: ' + SysErrorMessage(Code));
    exit;
  end;
  StepPage := Page;
  StepKind := Kind;
  StepRow := Row;
  StepStarted := WinTickCount();
  SetRow(Row, RS_BUSY, '');
  if RowBar[Row] <> nil then
    SetRowProgress(Row, -1);
  UpdateButtons();
  StepTimer := SetTimer(0, 0, 300, CreateCallback(@StepTick));
end;

{ Stop: the step sees the file and exits with EXIT_STOPPED. }
procedure StopStep();
begin
  SaveStringToFile(StepStop, 'stop', False);
  WizardForm.NextButton.Enabled := False;
  SetRow(StepRow, RS_BUSY, 'stopping...');
end;

{ A large bold button centred under the page's text. }
function AddActionButton(Page: TOutputMsgMemoWizardPage; Caption: String;
  Click: TNotifyEvent): TNewButton;
begin
  Result := TNewButton.Create(Page);
  Result.Parent := Page.Surface;
  Result.Caption := Caption;
  Result.Font.Style := [fsBold];
  Result.Font.Size := Result.Font.Size + 2;
  Result.Width := ScaleX(220);
  Result.Height := ScaleY(40);
  Result.Left := (Page.SurfaceWidth - Result.Width) div 2;
  Result.OnClick := Click;
end;

{ ---- Sign in ---- }

function SignInText(): String;
begin
  Result := 'Click Sign in on this window. Your browser will open on the SealGate ' +
    'Beeper dashboard page. Approve this computer when prompted and then ' +
    'return to this window.' + #13#10#13#10 + 'SealGate: ' + Backend;
end;

{ A string field from one line of `--json` output, or '' when it is absent
  or null. Enough for an email address, which has no quotes to escape. }
function JsonString(Json, Key: String): String;
var
  P: Integer;
  Rest: String;
begin
  Result := '';
  P := Pos('"' + Key + '":"', Json);
  if P = 0 then
    exit;
  Rest := Copy(Json, P + Length(Key) + 4, Length(Json));
  P := Pos('"', Rest);
  if P > 0 then
    Result := Copy(Rest, 1, P - 1);
end;

function SignedInText(): String;
begin
  Result := 'This computer is already signed in to SealGate (' + Backend + '). ' +
    'Click Continue to keep using that account.' + #13#10#13#10 +
    'To use a different account, click Sign in with a different account. Your ' +
    'browser will open so you can approve this computer again.';
end;

{ Show the version of the sign-in page that matches AlreadySignedIn. }
procedure ShowSignInState();
begin
  if AlreadySignedIn then
  begin
    SignInPage.SubCaptionLabel.Caption := SignedInText();
    SignInButton.Caption := 'Continue';
    SetRowCaption(RowLogin, 'Signed in to SealGate');
    SetRow(RowLogin, RS_DONE, SignedInEmail);
  end else begin
    SignInPage.SubCaptionLabel.Caption := SignInText();
    SignInButton.Caption := 'Sign in';
    SetRowCaption(RowLogin, 'Approve this computer in your browser');
    SetRow(RowLogin, RS_PENDING, '');
  end;
  SetRow(RowStart, RS_PENDING, '');
  OtherAccountButton.Visible := AlreadySignedIn;
  Relayout();
end;

{ Check the sign-in as the page opens, and show the version of the page
  that matches: the browser opens only when there is no sign-in to keep. }
procedure PrepareSignInPage();
var
  Output: String;
begin
  SetRow(RowLogin, RS_BUSY, 'checking...');
  WizardForm.Refresh;
  AlreadySignedIn :=
    Stdiod('setup signed-in --json --backend "' + Backend + '"', Output) = EXIT_OK;
  SignedInEmail := '';
  if AlreadySignedIn then
    SignedInEmail := JsonString(Output, 'email');
  ShowSignInState();
  Show(SignInPage, '');
end;

{ Start SealGate at logon; the last part of signing in. }
procedure FinishSignIn();
var
  Output: String;
begin
  SetRow(RowStart, RS_BUSY, '');
  WizardForm.Refresh;
  if Stdiod('install', Output) <> EXIT_OK then
  begin
    SetRow(RowStart, RS_FAILED, '');
    Show(SignInPage, 'Could not start SealGate in the background.' + #13#10#13#10 + Output);
    exit;
  end;
  SetRow(RowStart, RS_DONE, '');
  SignInDone := True;
  MoveOn();
end;

{ Approve this PC in the browser unless it is already signed in to this
  deployment (or the person chose another account), then start SealGate. }
procedure StartSignIn();
var
  Params: String;
begin
  if AlreadySignedIn and not UseOtherAccount then
  begin
    FinishSignIn();
    exit;
  end;
  Params := 'login --backend "' + Backend + '" --device-label "' +
    GetComputerNameString() + '"';
  { Another account: a new device record, so this PC is not left bound to
    the old account's. }
  if UseOtherAccount then
    Params := Params + ' --new-device';
  SetRowCaption(RowLogin, 'Approve this computer in your browser');
  StartStep(SignInPage, STEP_LOGIN, Params, RowLogin);
end;

procedure SignInClick(Sender: TObject);
begin
  UseOtherAccount := False;
  StartSignIn();
end;

{ "Sign in with a different account": a fresh browser approval as a new
  device, even though this PC is already signed in. }
procedure OtherAccountClick(Sender: TObject);
begin
  UseOtherAccount := True;
  StartSignIn();
end;

{ ---- Beeper ---- }

{ Set the Beeper page's text and big button for what it found. }
procedure SetBeeperState(State: Integer; Text, Button: String);
begin
  BeeperState := State;
  BeeperPage.SubCaptionLabel.Caption := Text;
  BeeperButton.Caption := Button;
  Relayout();
end;

{ As the page opens, and on Check again: find Beeper, and download and
  install it straight away when it is missing. }
procedure StartBeeperCheck();
begin
  SetBeeperState(BEEPER_CHECKING, 'Checking whether Beeper is installed. If it is ' +
    'not, it is downloaded (about 230 MB) and installed now.', 'Continue');
  SetRow(RowDownload, RS_PENDING, '');
  SetRow(RowInstall, RS_PENDING, '');
  SetRow(RowSignIn, RS_PENDING, '');
  SetRow(RowRestartBeeper, RS_PENDING, '');
  SetRow(RowMcp, RS_PENDING, '');
  StartStep(BeeperPage, STEP_BEEPER, 'setup install-beeper', RowCheck);
end;

const
  BEEPER_TURN_ON_MCP = 'In Beeper, turn on Settings > Developers > MCP, then click ' +
    'Continue here.';

{ Beeper answers, so it is signed in with MCP on: nothing left to do here. }
procedure BeeperAnswering(Restarted: Boolean);
begin
  SetRow(RowSignIn, RS_DONE, '');
  if not Restarted then
    SetRow(RowRestartBeeper, RS_SKIPPED, 'not needed');
  SetRow(RowMcp, RS_DONE, '');
  BeeperDone := True;
end;

{ Beeper is installed and the right build. On a first run, wait for the
  person to sign in, then restart Beeper (its first-run setup swallows
  SealGate's request); otherwise it is ready once it answers, which it does
  once signed in with MCP on. }
procedure FinishBeeper(Installed: String);
var
  Output: String;
begin
  UpdateBeeperRows(Installed);
  if Pos('installed Beeper Desktop (', Installed) > 0 then
    RegWriteStringValue(HKCU, SEALGATE_KEY, INSTALLED_BEEPER, '1');
  { On a first run Beeper answers before its own setup is done, so its
    answering is not ready: wait for the person either way. }
  if not BeeperFresh and (Stdiod('setup status', Output) = EXIT_OK) then
  begin
    BeeperAnswering(False);
    SetBeeperState(BEEPER_READY, 'Beeper is installed and ready. Click Continue.', 'Continue');
    exit;
  end;
  Stdiod('setup open-beeper', Output);
  SetRow(RowSignIn, RS_BUSY, '');
  if BeeperFresh then
  begin
    BeeperStage := STAGE_SIGN_IN;
    SetBeeperState(BEEPER_NOT_READY, 'Beeper is installed and running. Please sign in ' +
      'now and then click Continue.', 'Continue');
  end else begin
    { Set up before, so no restart: it only needs signing in or MCP. }
    BeeperStage := STAGE_MCP;
    SetRow(RowRestartBeeper, RS_SKIPPED, 'not needed');
    SetBeeperState(BEEPER_NOT_READY, 'Beeper is running. Sign in if it asks you to. ' +
      BEEPER_TURN_ON_MCP, 'Continue');
  end;
end;

procedure BeeperClick(Sender: TObject);
var
  Output: String;
begin
  if BeeperState = BEEPER_RETRY then
  begin
    StartBeeperCheck();
    exit;
  end;
  if BeeperState = BEEPER_READY then
  begin
    MoveOn();
    exit;
  end;
  if BeeperStage = STAGE_SIGN_IN then
  begin
    SetRow(RowSignIn, RS_DONE, '');
    StartStep(BeeperPage, STEP_RESTART, 'setup restart-beeper --timeout 30', RowRestartBeeper);
    exit;
  end;
  { Not answering when the page last looked: look again. }
  if Stdiod('setup status', Output) = EXIT_OK then
  begin
    BeeperAnswering(BeeperStage = STAGE_RESTARTED);
    MoveOn();
  end else begin
    SetRow(RowMcp, RS_BUSY, 'not yet');
    Show(BeeperPage, Output);
  end;
end;

{ ---- Allow ---- }

{ Register the Beeper connector, then wait for the Allow click. }
procedure AllowClick(Sender: TObject);
var
  Output: String;
  Code: Integer;
begin
  { Cleared only once the restart succeeds, so a stopped or failed one is
    tried again on the next click, as the message promised. }
  if AllowMissed then
  begin
    StartStep(AllowPage, STEP_RESTART_ALLOW, 'setup restart-beeper --timeout 60', RowAllow);
    exit;
  end;
  Show(AllowPage, '');
  SetRow(RowAllow, RS_PENDING, '');
  SetRow(RowRestart, RS_PENDING, '');
  SetRow(RowRegister, RS_BUSY, '');
  WizardForm.Refresh;
  Code := Stdiod('setup register', Output);
  if (Code <> EXIT_OK) and (Code <> EXIT_NOT_YET) then
  begin
    SetRow(RowRegister, RS_FAILED, '');
    Show(AllowPage, 'Could not register Beeper with SealGate. ' +
      'Click Connect Beeper with SealGate to try again.' + #13#10#13#10 + Output);
    exit;
  end;
  SetRow(RowRegister, RS_DONE, '');
  StartStep(AllowPage, STEP_APPROVE, 'setup approve --timeout ' + IntToStr(APPROVE_TIMEOUT),
    RowAllow);
end;

procedure StepFinished(Kind, Code: Integer; Output: String);
var
  First, Last: Integer;
begin
  PageRows(StepPage, First, Last);
  if Code = EXIT_STOPPED then
  begin
    EndBusyRows(First, Last, RS_PENDING, 'stopped');
    if (Kind = STEP_BEEPER) or (Kind = STEP_RESTART) then
      SetBeeperState(BEEPER_RETRY, 'Stopped. Click Check again to look for Beeper ' +
        'again, or Skip.', 'Check again');
    Show(StepPage, '');
    exit;
  end;
  if Code <> EXIT_OK then
    EndBusyRows(First, Last, RS_FAILED, '');
  case Kind of
    STEP_LOGIN:
      if Code = EXIT_OK then
      begin
        SetRow(RowLogin, RS_DONE, '');
        Show(SignInPage, '');
        AlreadySignedIn := True;
        FinishSignIn();
      end else
        Show(SignInPage, 'Sign-in did not finish. Try again.' + #13#10#13#10 + Output);
    STEP_BEEPER:
      if Code = EXIT_OK then
        FinishBeeper(Output)
      else if Code = EXIT_NOT_YET then
      begin
        { The emulated x64 build on an ARM PC: left in place, but it is the
          setup that does not work, so stop here and say so. }
        SetRow(RowCheck, RS_FAILED, 'x64 version');
        SetBeeperState(BEEPER_RETRY, 'Beeper is installed, but it is the x64 version, ' +
          'which does not run properly on this ARM computer. Uninstall Beeper ' +
          '(Settings > Apps), then click Check again.', 'Check again');
        Show(BeeperPage, Output);
      end else begin
        SetBeeperState(BEEPER_RETRY, 'Could not install Beeper. Click Check again to ' +
          'retry, or install it yourself from https://www.beeper.com/download.', 'Check again');
        Show(BeeperPage, Output);
      end;
    STEP_APPROVE:
      if Code = EXIT_OK then
      begin
        SetRow(RowAllow, RS_DONE, '');
        SetRow(RowRestart, RS_DONE, '');
        AllowDone := True;
        MoveOn();
      end else begin
        SetRow(RowAllow, RS_FAILED, 'timed out');
        AllowMissed := True;
        Show(AllowPage, 'Beeper did not get your Allow in time. Click Connect Beeper with ' +
          'SealGate to try again: Beeper restarts first, so its pop-up can show. Look ' +
          'for the pop-up behind your other windows too.' + #13#10#13#10 + Output);
      end;
    STEP_RESTART:
      if Code = EXIT_OK then
      begin
        { Answering after the restart: MCP was already on. }
        BeeperFresh := False;
        SetRow(RowRestartBeeper, RS_DONE, '');
        BeeperAnswering(True);
        MoveOn();
      end else if Pos('did not close', Output) > 0 then
      begin
        { Still on STAGE_SIGN_IN, so Continue restarts again. }
        SetRow(RowRestartBeeper, RS_FAILED, 'did not close');
        SetBeeperState(BEEPER_NOT_READY, 'Beeper did not close. Quit it (also from the ' +
          'tray next to the clock), then click Continue.', 'Continue');
        Show(BeeperPage, Output);
      end else begin
        { Restarted but not answering: MCP is off. }
        BeeperFresh := False;
        BeeperStage := STAGE_RESTARTED;
        SetRow(RowRestartBeeper, RS_DONE, '');
        SetRow(RowMcp, RS_BUSY, '');
        SetBeeperState(BEEPER_NOT_READY, 'Beeper restarted. ' + BEEPER_TURN_ON_MCP, 'Continue');
      end;
    STEP_RESTART_ALLOW:
      if Code = EXIT_OK then
      begin
        AllowMissed := False;
        AllowClick(nil);
      end else begin
        SetRow(RowAllow, RS_FAILED, 'not restarted');
        Show(AllowPage, 'Beeper did not restart. Click Connect Beeper with SealGate to ' +
          'try again.' + #13#10#13#10 + Output);
      end;
  end;
end;

{ ---- Last page ---- }

{ What was done, as ticks between the heading and the closing text. }
procedure ShowSummary();
var
  Top, I: Integer;
  Done: Boolean;
begin
  if SignInDone and BeeperDone and AllowDone then
  begin
    WizardForm.FinishedHeadingLabel.Caption := 'Beeper is connected to SealGate';
    WizardForm.FinishedLabel.Caption :=
      'Ask your AI assistant about your messages. SealGate runs in the background ' +
      'and starts with Windows.';
  end else begin
    WizardForm.FinishedHeadingLabel.Caption := 'SealGate is installed';
    WizardForm.FinishedLabel.Caption :=
      'Beeper is not connected yet because a step was skipped. Run SealGate for ' +
      'Beeper Setup again to finish.';
  end;
  for I := RowSummary to RowSummary + 2 do
  begin
    case I - RowSummary of
      0: Done := SignInDone;
      1: Done := BeeperDone;
    else
      Done := AllowDone;
    end;
    if Done then
      SetRow(I, RS_DONE, '')
    else
      SetRow(I, RS_SKIPPED, 'skipped');
  end;
  WizardForm.FinishedHeadingLabel.AdjustHeight();
  Top := WizardForm.FinishedHeadingLabel.Top + WizardForm.FinishedHeadingLabel.Height +
    ScaleY(16);
  Top := LayoutRows(RowSummary, RowSummary + 2, Top);
  WizardForm.FinishedLabel.Top := Top + ScaleY(10);
  WizardForm.FinishedLabel.AdjustHeight();
end;

#ifdef DebugUi
{ Debug builds only: cycle the sign-in page through its three versions
  without a real sign-in, to see them before the backend sends emails. }
procedure DebugClick(Sender: TObject);
begin
  DebugState := (DebugState + 1) mod 3;
  AlreadySignedIn := DebugState > 0;
  SignedInEmail := '';
  if DebugState = 2 then
    SignedInEmail := 'test@example.com';
  ShowSignInState();
  case DebugState of
    0: Show(SignInPage, 'Debug: not signed in');
    1: Show(SignInPage, 'Debug: signed in, backend sent no email');
    2: Show(SignInPage, 'Debug: signed in as test@example.com');
  end;
end;
#endif

procedure CancelClick(Sender: TObject); forward;
procedure WizardCloseQuery(Sender: TObject; var CanClose: Boolean); forward;

procedure InitializeWizard();
var
  W, Left: Integer;
begin
  Backend := GetBackend();
  StepKind := STEP_NONE;
  BeeperFresh := not DirExists(ExpandConstant('{userappdata}\BeeperTexts'));
  WizardForm.CancelButton.OnClick := @CancelClick;
  WizardForm.OnCloseQuery := @WizardCloseQuery;
  SignInPage := CreateOutputMsgMemoPage(wpInstalling,
    'Sign in to SealGate',
    'Approve this computer in your browser.',
    SignInText(), '');
  BeeperPage := CreateOutputMsgMemoPage(SignInPage.ID,
    'Set up Beeper',
    'Beeper Desktop connects SealGate to your chats.',
    'Checking whether Beeper is installed...', '');
  AllowPage := CreateOutputMsgMemoPage(BeeperPage.ID,
    'Connect Beeper with SealGate',
    'One click in Beeper.',
    'Click Connect Beeper with SealGate to allow SealGate to access Beeper. ' +
    'Beeper then shows a pop-up asking whether SealGate may access it: click ' +
    'Allow in that pop-up.' + #13#10#13#10 +
    'If you do not see the pop-up, check behind your other windows.', '');

  SignInButton := AddActionButton(SignInPage, 'Sign in', @SignInClick);
  OtherAccountButton := TNewButton.Create(SignInPage);
  OtherAccountButton.Parent := SignInPage.Surface;
  OtherAccountButton.Caption := 'Sign in with a different account';
  OtherAccountButton.Width := ScaleX(240);
  OtherAccountButton.Height := ScaleY(26);
  OtherAccountButton.OnClick := @OtherAccountClick;
  OtherAccountButton.Visible := False;
  BeeperButton := AddActionButton(BeeperPage, 'Continue', @BeeperClick);
  AllowButton := AddActionButton(AllowPage, 'Connect Beeper with SealGate', @AllowClick);
  { A longer label than the other pages' buttons. }
  AllowButton.Width := ScaleX(320);
  AllowButton.Left := (AllowPage.SurfaceWidth - AllowButton.Width) div 2;

  { Rows sit in a column a little narrower than the page, like the text. }
  W := SignInPage.SurfaceWidth;
  Left := ScaleX(8);
  RowLogin := AddRow(SignInPage.Surface, Left, W - Left,
    'Approve this computer in your browser', GLYPH_BROWSER, True);
  RowStart := AddRow(SignInPage.Surface, Left, W - Left,
    'Start SealGate in the background', GLYPH_SYNC, False);
  RowCheck := AddRow(BeeperPage.Surface, Left, W - Left,
    'Check whether Beeper is installed', GLYPH_WAIT, False);
  RowDownload := AddRow(BeeperPage.Surface, Left, W - Left,
    'Download Beeper', GLYPH_DOWNLOAD, True);
  RowInstall := AddRow(BeeperPage.Surface, Left, W - Left,
    'Install Beeper', GLYPH_PACKAGE, True);
  RowSignIn := AddRow(BeeperPage.Surface, Left, W - Left,
    'Sign in to Beeper', GLYPH_WAIT, False);
  RowRestartBeeper := AddRow(BeeperPage.Surface, Left, W - Left,
    'Restart Beeper', GLYPH_SYNC, False);
  RowMcp := AddRow(BeeperPage.Surface, Left, W - Left,
    'Turn on MCP in Beeper', GLYPH_WAIT, False);
  RowRegister := AddRow(AllowPage.Surface, Left, W - Left,
    'Register Beeper with SealGate', GLYPH_SYNC, False);
  RowAllow := AddRow(AllowPage.Surface, Left, W - Left,
    'Click Allow in the Beeper pop-up', GLYPH_WAIT, True);
  RowRestart := AddRow(AllowPage.Surface, Left, W - Left,
    'Restart SealGate with the new access', GLYPH_SYNC, False);
  Left := WizardForm.FinishedLabel.Left;
  W := Left + WizardForm.FinishedLabel.Width;
  RowSummary := AddRow(WizardForm.FinishedPage, Left, W,
    'This computer is signed in to SealGate', GLYPH_DONE, False);
  AddRow(WizardForm.FinishedPage, Left, W, 'Beeper is installed and ready', GLYPH_DONE, False);
  AddRow(WizardForm.FinishedPage, Left, W, 'SealGate may access Beeper', GLYPH_DONE, False);
  for W := 0 to RowCount - 1 do
    SetRow(W, RS_PENDING, '');

#ifdef DebugUi
  DebugButton := TNewButton.Create(SignInPage);
  DebugButton.Parent := SignInPage.Surface;
  DebugButton.Caption := 'Debug: next state';
  DebugButton.Width := ScaleX(130);
  DebugButton.Height := ScaleY(23);
  DebugButton.Left := 0;
  DebugButton.Top := SignInPage.SurfaceHeight - DebugButton.Height;
  DebugButton.OnClick := @DebugClick;
  DebugState := 0;
#endif
  LaidOut := True;
  Relayout();
end;

{ Cancel on a setup page: after asking, stop any running step, skip the
  remaining setup pages and finish, which Inno allows where closing is not. }
procedure CloseEarlyClick(Sender: TObject);
begin
  if MsgBox('SealGate is installed, but Beeper is not connected yet. Close ' +
      'setup anyway?' + #13#10#13#10 + 'You can run SealGate for Beeper Setup again ' +
      'later to finish.', mbConfirmation, MB_YESNO) <> IDYES then
    exit;
  if StepKind <> STEP_NONE then
  begin
    SaveStringToFile(StepStop, 'stop', False);
    KillTimer(0, StepTimer);
    StepKind := STEP_NONE;
  end;
  ClosingEarly := True;
  MoveOn();
  if WizardForm.CurPageID = wpFinished then
    MoveOn();
end;

function IsStepPage(PageID: Integer): Boolean;
begin
  Result := (PageID = SignInPage.ID) or (PageID = BeeperPage.ID) or (PageID = AllowPage.ID);
end;

{ Cancel (and the window's close button, which presses it). Inno blocks
  closing once the files are installed, so the setup pages close their own
  way; elsewhere this is what Inno's own handler does. }
procedure CancelClick(Sender: TObject);
begin
  if IsStepPage(WizardForm.CurPageID) then
    CloseEarlyClick(Sender)
  else
    WizardForm.Close();
end;

{ The window's close button. Inno ignores it once the files are installed,
  so on the setup pages it does what Cancel does; elsewhere Inno handles it. }
procedure WizardCloseQuery(Sender: TObject; var CanClose: Boolean);
begin
  if not IsStepPage(WizardForm.CurPageID) then
    exit;
  CanClose := False;
  CloseEarlyClick(Sender);
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  { A silent install puts the files in place and stops: every step after it
    needs the person. }
  Result := (WizardSilent or ClosingEarly) and IsStepPage(PageID);
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if IsStepPage(CurPageID) then
  begin
    UpdateButtons();
    { Inno hides Cancel once the files are installed and blocks closing
      after that; these pages still need a way out. }
    WizardForm.CancelButton.Visible := True;
    WizardForm.CancelButton.Enabled := True;
    { Inno greyed the close button before Cancel was shown again. }
    EnableMenuItem(GetSystemMenu(WizardForm.Handle, False), $F060, 0);
  end;
  { Before installing, Cancel is Exit: nothing is in place yet. It stays
    visible because the window's close button goes through it. }
  if CurPageID = wpWelcome then
    WizardForm.NextButton.Caption := SetupMessage(msgButtonInstall);
  if CurPageID < wpPreparing then
    WizardForm.CancelButton.Caption := 'Exit'
  else
    WizardForm.CancelButton.Caption := SetupMessage(msgButtonCancel);
  if CurPageID = SignInPage.ID then
  begin
    PrepareSignInPage();
    FocusButton(SignInButton);
  end
  else if CurPageID = BeeperPage.ID then
  begin
    { Focus first: the check greys the button out while it runs. }
    FocusButton(BeeperButton);
    StartBeeperCheck();
  end
  else if CurPageID = AllowPage.ID then
    FocusButton(AllowButton)
  else if CurPageID = wpFinished then
    ShowSummary();
end;

{ On the step pages the bottom-right button is Skip, or Stop while a step
  runs; the pages move on by themselves when a step succeeds. }
function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if not IsStepPage(CurPageID) or Advancing then
    exit;
  if StepKind <> STEP_NONE then
  begin
    StopStep();
    Result := False;
  end;
end;

{ Cancel, or the window's close button, on a setup page: the files are
  already installed, so say what closing now means instead of Inno's
  "Setup is not complete" question. }
procedure CancelButtonClick(CurPageID: Integer; var Cancel, Confirm: Boolean);
begin
  { Nothing installed yet: just close. }
  if CurPageID < wpPreparing then
    Confirm := False;
  if not IsStepPage(CurPageID) then
    exit;
  Confirm := False;
  Cancel := MsgBox('SealGate is installed, but Beeper is not connected yet. Close ' +
    'setup anyway?' + #13#10#13#10 + 'You can run SealGate for Beeper Setup again ' +
    'later to finish.', mbConfirmation, MB_YESNO) = IDYES;
  if Cancel and (StepKind <> STEP_NONE) then
    SaveStringToFile(StepStop, 'stop', False);
end;

{ Take the install folder back off the user's PATH. }
procedure RemoveFromPath(Dir: String);
var
  Path, Entry, Kept: String;
  P: Integer;
begin
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', Path) then
    exit;
  Kept := '';
  Path := Path + ';';
  while Path <> '' do
  begin
    P := Pos(';', Path);
    Entry := Copy(Path, 1, P - 1);
    Delete(Path, 1, P);
    if (Entry <> '') and (CompareText(RemoveBackslashUnlessRoot(Entry),
        RemoveBackslashUnlessRoot(Dir)) <> 0) then
    begin
      if Kept <> '' then
        Kept := Kept + ';';
      Kept := Kept + Entry;
    end;
  end;
  RegWriteExpandStringValue(HKCU, 'Environment', 'Path', Kept);
end;

{ The Beeper exe in Dir, or ''. }
function BeeperExeIn(Dir: String): String;
var
  Found: TFindRec;
begin
  Result := '';
  if (Dir = '') or not FindFirst(AddBackslash(Dir) + 'Beeper*.exe', Found) then
    exit;
  try
    repeat
      if Pos('Uninstall', Found.Name) = 0 then
      begin
        Result := AddBackslash(Dir) + Found.Name;
        exit;
      end;
    until not FindNext(Found);
  finally
    FindClose(Found);
  end;
end;

{ Beeper Desktop's per-user uninstall entry (Key): the command that removes
  it silently, and its exe ('' when it cannot be found). False when Beeper is
  not installed. }
function FindBeeper(var Key, Command, Exe: String): Boolean;
var
  Names: TArrayOfString;
  I, Comma: Integer;
  Name, Location: String;
begin
  Result := False;
  if not RegGetSubkeyNames(HKCU, UNINSTALL_KEY, Names) then
    exit;
  for I := 0 to GetArrayLength(Names) - 1 do
  begin
    Key := UNINSTALL_KEY + '\' + Names[I];
    if RegQueryStringValue(HKCU, Key, 'DisplayName', Name) and (Pos('Beeper', Name) = 1) then
    begin
      if not RegQueryStringValue(HKCU, Key, 'QuietUninstallString', Command) then
      begin
        if not RegQueryStringValue(HKCU, Key, 'UninstallString', Command) then
          continue;
        Command := Command + ' /S';
      end;
      { DisplayIcon is "C:\...\Beeper.exe",0 }
      Exe := '';
      if RegQueryStringValue(HKCU, Key, 'DisplayIcon', Exe) then
      begin
        Comma := Pos('.exe', Lowercase(Exe));
        if Comma > 0 then
          Exe := RemoveQuotes(Copy(Exe, 1, Comma + 3));
      end;
      { The exe sits in InstallLocation, beside the uninstaller. }
      if (Exe = '') and RegQueryStringValue(HKCU, Key, 'InstallLocation', Location) then
        Exe := BeeperExeIn(RemoveQuotes(Location));
      Result := True;
      exit;
    end;
  end;
end;

{ Split '"C:\path\Uninstall Beeper.exe" /currentuser /S' into the exe and
  its parameters. }
procedure SplitCommand(Command: String; var FileName, Params: String);
var
  P: Integer;
begin
  P := Pos('.exe', Lowercase(Command));
  if P = 0 then
  begin
    FileName := RemoveQuotes(Trim(Command));
    Params := '';
    exit;
  end;
  FileName := RemoveQuotes(Trim(Copy(Command, 1, P + 3)));
  Params := Copy(Command, P + 4, Length(Command));
  if (Length(Params) > 0) and (Params[1] = '"') then
    Delete(Params, 1, 1);
  Params := Trim(Params);
end;

{ Beeper has been removed: its uninstaller deleted its uninstall entry, and
  the exe, when known, is gone too. A missing exe alone is not enough: it says
  nothing when the exe was never found. }
function BeeperGone(Key, Exe: String): Boolean;
begin
  Result := not RegKeyExists(HKCU, Key) and ((Exe = '') or not FileExists(Exe));
end;

{ Remove Beeper and its data: its own uninstaller leaves %APPDATA%\BeeperTexts
  behind, and that folder holds the person's local chats. }
procedure RemoveBeeper(Key, Command, Exe: String);
var
  FileName, Params: String;
  ResultCode, Waited: Integer;
begin
  { A running Beeper holds its files open, and its uninstaller fails. }
  if Exe <> '' then
    Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM "' + ExtractFileName(Exe) + '"', '',
      SW_HIDE, ewWaitUntilTerminated, ResultCode);
  SplitCommand(Command, FileName, Params);
  if Exe = '' then
    Exe := BeeperExeIn(ExtractFileDir(FileName));
  if not Exec(FileName, Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    exit;
  { An NSIS uninstaller copies itself to %TEMP% and returns at once, so wait for
    Beeper itself to go. }
  Waited := 0;
  while not BeeperGone(Key, Exe) and (Waited < 60) do
  begin
    Sleep(1000);
    Waited := Waited + 1;
  end;
  { Only once Beeper is gone: its data without the app just signs the user out. }
  if BeeperGone(Key, Exe) then
    DelTree(ExpandConstant('{userappdata}\BeeperTexts'), True, True, True);
end;

{ What to remove besides SealGate itself, in one window. SealGate's data is
  ticked: a stale sign-in sends the next install to the old account's backend,
  and a stale Beeper access breaks the next install's approval. Beeper is
  ticked only when this setup installed it, since it is the person's messaging
  app. Shown before Inno's own confirmation, which cannot be turned off: this
  is the last point where Cancel still stops the uninstall cleanly. }
function ChooseWhatToRemove(): Boolean;
var
  Form: TSetupForm;
  Intro: TNewStaticText;
  DataBox, BeeperBox: TNewCheckBox;
  UninstallButton, CancelButton: TNewButton;
  Marker: String;
  Left, Width, Top: Integer;
begin
  Form := CreateCustomForm(ScaleX(460), ScaleY(200), False, False);
  try
    Form.Caption := 'Uninstall SealGate for Beeper';
    Left := ScaleX(16);
    Width := Form.ClientWidth - 2 * Left;

    Intro := TNewStaticText.Create(Form);
    Intro.Parent := Form;
    Intro.Left := Left;
    Intro.Top := ScaleY(16);
    Intro.Width := Width;
    Intro.Caption := 'Also remove:';

    DataBox := TNewCheckBox.Create(Form);
    DataBox.Parent := Form;
    DataBox.Left := Left;
    DataBox.Top := Intro.Top + Intro.Height + ScaleY(12);
    DataBox.Width := Width;
    DataBox.Height := ScaleY(20);
    DataBox.Caption := 'SealGate''s logs, settings and access to Beeper';
    DataBox.Checked := True;
    Top := DataBox.Top + DataBox.Height + ScaleY(8);

    BeeperBox := nil;
    if HasBeeper then
    begin
      BeeperBox := TNewCheckBox.Create(Form);
      BeeperBox.Parent := Form;
      BeeperBox.Left := Left;
      BeeperBox.Top := Top;
      BeeperBox.Width := Width;
      BeeperBox.Height := ScaleY(20);
      BeeperBox.Caption := 'Beeper, with the chats and settings it stored here';
      BeeperBox.Checked := RegQueryStringValue(HKCU, SEALGATE_KEY, INSTALLED_BEEPER, Marker) and
        (Marker = '1');
      Top := BeeperBox.Top + BeeperBox.Height + ScaleY(8);
    end;

    CancelButton := TNewButton.Create(Form);
    CancelButton.Parent := Form;
    CancelButton.Caption := 'Cancel';
    CancelButton.ModalResult := mrCancel;
    CancelButton.Cancel := True;
    CancelButton.Width := ScaleX(85);
    CancelButton.Height := ScaleY(25);
    CancelButton.Left := Form.ClientWidth - Left - CancelButton.Width;
    CancelButton.Top := Top + ScaleY(16);

    UninstallButton := TNewButton.Create(Form);
    UninstallButton.Parent := Form;
    UninstallButton.Caption := 'Uninstall';
    UninstallButton.ModalResult := mrOk;
    UninstallButton.Default := True;
    UninstallButton.Width := CancelButton.Width;
    UninstallButton.Height := CancelButton.Height;
    UninstallButton.Left := CancelButton.Left - ScaleX(8) - UninstallButton.Width;
    UninstallButton.Top := CancelButton.Top;

    Form.ClientHeight := CancelButton.Top + CancelButton.Height + ScaleY(16);
    Form.ActiveControl := UninstallButton;
    Result := Form.ShowModal() = mrOk;
    if Result then
    begin
      UninstallData := DataBox.Checked;
      UninstallBeeper := (BeeperBox <> nil) and BeeperBox.Checked;
    end;
  finally
    Form.Free();
  end;
end;

{ A silent uninstall removes SealGate's data and leaves Beeper. }
function InitializeUninstall(): Boolean;
begin
  UninstallData := True;
  UninstallBeeper := False;
  HasBeeper := FindBeeper(BeeperKey, BeeperCommand, BeeperExe);
  Result := True;
  if not UninstallSilent() then
    Result := ChooseWhatToRemove();
end;

{ Stop the daemon and remove its logon task before the files go, then remove
  what the person chose. }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Params: String;
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    Params := 'uninstall';
    if UninstallData then
      Params := 'uninstall --purge';
    if FileExists(DaemonExe()) then
      Exec(DaemonExe(), Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    if UninstallData then
    begin
      { Beeper's MCP proxy keeps SealGate's sign-in to Beeper here. }
      DelTree(ExpandConstant('{%USERPROFILE}\.beeper-mcp-auth'), True, True, True);
      RegDeleteValue(HKCU, SEALGATE_KEY, INSTALLED_BEEPER);
      RegDeleteKeyIfEmpty(HKCU, SEALGATE_KEY);
      RegDeleteKeyIfEmpty(HKCU, 'Software\SealGate');
    end;
    if UninstallBeeper then
      RemoveBeeper(BeeperKey, BeeperCommand, BeeperExe);
  end;
  if CurUninstallStep = usPostUninstall then
    RemoveFromPath(ExpandConstant('{app}'));
end;

procedure DeinitializeSetup();
begin
  { Closing the wizard mid-step must not leave the step running. }
  if StepKind <> STEP_NONE then
    SaveStringToFile(StepStop, 'stop', False);
end;

{ The running daemon holds its exe open; stop it before the files are
  replaced. Setup registers it again on the sign-in page. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  if FileExists(DaemonExe()) then
    Exec(DaemonExe(), 'uninstall', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
