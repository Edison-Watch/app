; Windows installer funnel telemetry (MVP, off by default).
;
; Goal: see WHERE a Windows install stops - after the download, inside the
; installer, or before the first app launch. The installer reports a few
; anonymous events straight to PostHog's capture API:
;
;   installer_started    .onInit finished (fresh install or upgrade, silent or not)
;   installer_step       step = install_clicked | old_version_checked | files_installed
;   installer_finished   outcome = success | failed | cancelled, with last_step,
;                        exit_code (old uninstaller) or error_level (NSIS)
;
; On success it also leaves %LOCALAPPDATA%\SealGate\install-telemetry.json so
; the app can send app_first_launch with the same install_id (see
; src/main/infra/installTelemetry.ts). A run that shows installer_started but
; never installer_finished hit one of electron-builder's hard `Quit` paths
; (decompression failed, app could not be closed) - those skip every callback;
; last step reached tells you which part of the run it was in.
;
; Privacy: install_id is a random GUID made per installer run. No user name,
; machine name, path, e-mail or account id is sent. Events are sent with
; $process_person_profile=false (no PostHog person) and $geoip_disable=true.
;
; Safety: every request goes through WinHTTP in-process with 1.5 s timeouts per
; phase, and every failure is ignored. Nothing here can stop or fail the install.
;
; Switches:
;   - Build time: only compiled in when build/installer-telemetry.config.nsh
;     exists (written by scripts/installer-telemetry-config.mjs from
;     SG_INSTALL_TELEMETRY_URL + SG_INSTALL_TELEMETRY_KEY). Without it, all
;     macros below are empty and the installer is unchanged.
;   - Run time: `/NOTELEMETRY` on the command line, or DO_NOT_TRACK=1 or
;     SEALGATE_NO_TELEMETRY=1 in the environment, turns it off for that run.

!if /FileExists "${BUILD_RESOURCES_DIR}/installer-telemetry.config.nsh"
  !include "${BUILD_RESOURCES_DIR}/installer-telemetry.config.nsh"
!endif

!ifdef SG_IT_ENABLED
!ifndef BUILD_UNINSTALLER

!include "FileFunc.nsh"
!include "x64.nsh"

!if ${SG_IT_SECURE} == 1
  !define SG_IT_FLAGS 0x00800000 ; WINHTTP_FLAG_SECURE
!else
  !define SG_IT_FLAGS 0
!endif

!if ${SG_IT_SECURE} == 1
  !if ${SG_IT_PORT} == 443
    !define SG_IT_URL_FOR_APP "https://${SG_IT_HOST}${SG_IT_PATH}"
  !else
    !define SG_IT_URL_FOR_APP "https://${SG_IT_HOST}:${SG_IT_PORT}${SG_IT_PATH}"
  !endif
!else
  !define SG_IT_URL_FOR_APP "http://${SG_IT_HOST}:${SG_IT_PORT}${SG_IT_PATH}"
!endif

!ifdef APP_ARM64
  !ifdef APP_64
    !define SG_IT_PKG_ARCH "multi"
  !else
    !define SG_IT_PKG_ARCH "arm64"
  !endif
!else
  !define SG_IT_PKG_ARCH "x64"
!endif

Var sgItOn        ; "1" when this run may send
Var sgItId        ; random GUID for this installer run
Var sgItStep      ; last step reached
Var sgItOutcome   ; "" until installer_finished was sent
Var sgItT0        ; GetTickCount at start
Var sgItUpgrade   ; "true" | "false"
Var sgItSilent    ; "true" | "false"
Var sgItOsBuild   ; Windows build number, e.g. 22631
Var sgItOsArch    ; x64 | arm64 | x86

; POST the JSON in $R9 to the configured endpoint. Synchronous, short timeouts,
; result ignored. Clobbers nothing (all registers saved).
Function sgItPost
  ${If} $sgItOn != "1"
    Return
  ${EndIf}
  Push $1
  Push $2
  Push $3
  Push $4
  StrCpy $2 0
  StrCpy $3 0
  System::Call 'winhttp::WinHttpOpen(w "SealGate-Installer", i 0, p 0, p 0, i 0) p.r1'
  ${If} $1 != 0
    System::Call 'winhttp::WinHttpSetTimeouts(p r1, i 1500, i 1500, i 1500, i 1500)'
    System::Call 'winhttp::WinHttpConnect(p r1, w "${SG_IT_HOST}", i ${SG_IT_PORT}, i 0) p.r2'
  ${EndIf}
  ${If} $2 != 0
    System::Call 'winhttp::WinHttpOpenRequest(p r2, w "POST", w "${SG_IT_PATH}", p 0, p 0, p 0, i ${SG_IT_FLAGS}) p.r3'
  ${EndIf}
  ${If} $3 != 0
    StrLen $4 $R9
    ; The body is plain ASCII, so the ANSI (m) conversion is byte-exact.
    System::Call 'winhttp::WinHttpSendRequest(p r3, w "Content-Type: application/json", i -1, m R9, i r4, i r4, p 0) i.r4'
    ${If} $4 != 0
      System::Call 'winhttp::WinHttpReceiveResponse(p r3, p 0)'
    ${EndIf}
    System::Call 'winhttp::WinHttpCloseHandle(p r3)'
  ${EndIf}
  ${If} $2 != 0
    System::Call 'winhttp::WinHttpCloseHandle(p r2)'
  ${EndIf}
  ${If} $1 != 0
    System::Call 'winhttp::WinHttpCloseHandle(p r1)'
  ${EndIf}
  Pop $4
  Pop $3
  Pop $2
  Pop $1
FunctionEnd

; Send EVENT with EXTRA (a JSON fragment that starts with a comma, or "").
!macro sgItSend EVENT EXTRA
  Push $R9
  Push $R8
  System::Call 'kernel32::GetTickCount() i.R8'
  IntOp $R8 $R8 - $sgItT0
  StrCpy $R9 '{"api_key":"${SG_IT_KEY}","event":"${EVENT}","distinct_id":"$sgItId","properties":{"install_id":"$sgItId","source":"nsis_installer","app_version":"${VERSION}","pkg_arch":"${SG_IT_PKG_ARCH}","os_arch":"$sgItOsArch","os_build":"$sgItOsBuild","upgrade":$sgItUpgrade,"silent":$sgItSilent,"step":"$sgItStep","duration_ms":$R8,"$$process_person_profile":false,"$$geoip_disable":true${EXTRA}}}'
  Call sgItPost
  Pop $R8
  Pop $R9
!macroend

; Called at the end of customInit (.onInit), after initMultiUser.
!macro sgItOnInit
  Push $R0
  Push $R1
  StrCpy $sgItOn "1"
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/NOTELEMETRY" $R1
  ${IfNot} ${Errors}
    StrCpy $sgItOn "0"
  ${EndIf}
  ReadEnvStr $R1 DO_NOT_TRACK
  ${If} $R1 == "1"
    StrCpy $sgItOn "0"
  ${EndIf}
  ReadEnvStr $R1 SEALGATE_NO_TELEMETRY
  ${If} $R1 == "1"
    StrCpy $sgItOn "0"
  ${EndIf}

  System::Call 'ole32::CoCreateGuid(g.R1)'
  StrCpy $sgItId $R1 36 1 ; strip the braces
  System::Call 'kernel32::GetTickCount() i.R1'
  StrCpy $sgItT0 $R1
  StrCpy $sgItStep "started"
  StrCpy $sgItOutcome ""

  StrCpy $sgItUpgrade "false"
  ${If} $hasPerUserInstallation == "1"
  ${OrIf} $hasPerMachineInstallation == "1"
    StrCpy $sgItUpgrade "true"
  ${EndIf}
  StrCpy $sgItSilent "false"
  ${If} ${Silent}
    StrCpy $sgItSilent "true"
  ${EndIf}

  ReadRegStr $sgItOsBuild HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuild"
  StrCpy $sgItOsArch "x86"
  ${If} ${IsNativeARM64}
    StrCpy $sgItOsArch "arm64"
  ${ElseIf} ${IsNativeAMD64}
    StrCpy $sgItOsArch "x64"
  ${EndIf}

  !insertmacro sgItSend "installer_started" ""
  Pop $R1
  Pop $R0
!macroend

; Shared body of customUnInstallCheck / customUnInstallCheckCurrentUser.
; Defining those macros REPLACES electron-builder's default handling in
; handleUninstallResult (installUtil.nsh, app-builder-lib 26.x), so the default
; behaviour is reproduced below unchanged: a launch error is only logged, and a
; non-zero exit code shows the error, sets error level 2 and quits.
!macro sgItUninstallCheck
  ${If} ${Errors}
    DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
    StrCpy $sgItStep "old_version_uninstaller_missing"
    !insertmacro sgItSend "installer_step" ""
  ${ElseIf} $R0 != 0
    StrCpy $sgItStep "old_version_checked"
    StrCpy $sgItOutcome "failed"
    !insertmacro sgItSend "installer_finished" ',"outcome":"failed","exit_code":$R0'
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
    DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
    SetErrorLevel 2
    Quit
  ${Else}
    StrCpy $sgItStep "old_version_checked"
    !insertmacro sgItSend "installer_step" ',"exit_code":0'
  ${EndIf}
!macroend

!macro customUnInstallCheck
  !insertmacro sgItUninstallCheck
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro sgItUninstallCheck
!macroend

; Invisible page between the directory page and the install page: it only
; records that the user pressed "Install", then skips itself.
!macro customPageAfterChangeDir
  Page custom sgItInstallClicked
!macroend

Function sgItInstallClicked
  StrCpy $sgItStep "install_clicked"
  !insertmacro sgItSend "installer_step" ""
  Abort
FunctionEnd

; End of the install section: files, registry and shortcuts are in place.
!macro customInstall
  StrCpy $sgItStep "files_installed"
  !insertmacro sgItSend "installer_step" ""
  ; Written here, not in .onInstSuccess: that callback only runs when the
  ; wizard closes, which is AFTER the finish page's "Run SealGate" starts the app.
  Call sgItWriteMarker
!macroend

; Hand the install_id to the app for app_first_launch. Only written when this
; run may send; the app deletes it after reporting.
Function sgItWriteMarker
  ${If} $sgItOn != "1"
    Return
  ${EndIf}
  Push $0
  ; CreateDirectory sets the error flag when the folder already exists, so
  ; test the file handle, not ${Errors}.
  CreateDirectory "$LOCALAPPDATA\SealGate"
  ClearErrors
  StrCpy $0 ""
  FileOpen $0 "$LOCALAPPDATA\SealGate\install-telemetry.json" w
  ${If} $0 != ""
    FileWrite $0 '{"install_id":"$sgItId","app_version":"${VERSION}","upgrade":$sgItUpgrade,"silent":$sgItSilent,"url":"${SG_IT_URL_FOR_APP}","key":"${SG_IT_KEY}"}'
    FileClose $0
  ${EndIf}
  ClearErrors
  Pop $0
FunctionEnd

Function .onInstSuccess
  StrCpy $sgItOutcome "success"
  !insertmacro sgItSend "installer_finished" ',"outcome":"success"'
FunctionEnd

Function .onInstFailed
  StrCpy $sgItOutcome "failed"
  Push $R7
  GetErrorLevel $R7
  !insertmacro sgItSend "installer_finished" ',"outcome":"failed","error_level":$R7'
  Pop $R7
FunctionEnd

; Runs when the wizard closes. If neither success nor failure was reported,
; the user closed or cancelled the wizard.
Function .onGUIEnd
  ${If} $sgItOutcome == ""
    StrCpy $sgItOutcome "cancelled"
    !insertmacro sgItSend "installer_finished" ',"outcome":"cancelled"'
  ${EndIf}
FunctionEnd

!define SG_IT_HOOK_INIT "!insertmacro sgItOnInit"

!endif ; BUILD_UNINSTALLER
!endif ; SG_IT_ENABLED

; Used by customInit in installer.nsh; empty when telemetry is compiled out.
!macro sgItInit
  !ifdef SG_IT_HOOK_INIT
    !insertmacro sgItOnInit
  !endif
!macroend
