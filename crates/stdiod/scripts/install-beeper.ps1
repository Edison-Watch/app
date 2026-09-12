#Requires -Version 5.1
<#
.SYNOPSIS
  install-beeper.ps1 - wire Beeper into the SealGate MCP gateway on Windows.

.DESCRIPTION
  The Windows counterpart of install-beeper.sh, with the same commands, flags
  and environment variables, so the docs and the agent prompt can name one
  surface for both platforms. Runs on Windows PowerShell 5.1 (preinstalled on
  every Windows 10/11) and on PowerShell 7+. No admin rights are needed:
  everything lands under the user's profile.

  One-liner (runs 'install' with the defaults):

    powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/Edison-Watch/app/main/crates/stdiod/scripts/install-beeper.ps1 | iex"

  With a command or flags (same names as the bash script):

    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Edison-Watch/app/main/crates/stdiod/scripts/install-beeper.ps1))) install --demo --no-open

  Every flag is also an UPPER_SNAKE environment variable (SG_BACKEND, ...), so
  the plain one-liner can be steered without the scriptblock form.

  What it automates:
    1. Install prerequisites: node/npx (official Node.js zip, checksum
       verified, into the daemon's own runtimes folder where the daemon looks
       for it on its own), sealgate-stdiod (prebuilt checksum-verified release
       exe), and Beeper Desktop itself via winget. Each behind the
       --install-deps consent gate (on by default for 'install').
    2. Authorize this device to SealGate via the stdiod browser/device flow
       ('sealgate-stdiod login').
    3. Supervise the tunnel daemon ('sealgate-stdiod install' registers a
       per-user Scheduled Task that starts at logon and restarts on failure).
    4. Submit Beeper's stdio MCP proxy ('npx @beeper/mcp-remote') as a tunnel
       server ('sealgate-stdiod server add', which requests admin approval).
    5. Prime the Beeper OAuth grant by driving one MCP handshake through the
       proxy, so the approval prompt fires now instead of at first daemon spawn.

  What still needs a human (each one printed with the exact action):
    A. Sign in to Beeper, enable MCP (Settings > Developers > MCP) so :23373
       answers, and link WhatsApp / Telegram / etc. in the Beeper app.
    B. Approve the submitted 'beeper' server in the SealGate dashboard, if the
       deployment queues submissions.
    C. Approve the Beeper OAuth prompt when step 5 raises it.

  Layout on disk (all per-user, no admin):
    %LOCALAPPDATA%\Programs\sealgate-stdiod\sealgate-stdiod.exe
    %LOCALAPPDATA%\Programs\sealgate-stdiod\runtimes\node\   (node, npm, npx)
    %USERPROFILE%\.config\sealgate-stdiod\config.toml         (credential)
    %USERPROFILE%\.config\sealgate-stdiod\state.json          (daemon state)
  The daemon resolves npx from '<exe dir>\runtimes\node' by itself, so the
  Scheduled Task works even before a new shell picks up the PATH change. Both
  directories are also added to the user PATH for the user's own shells.

  Compatibility notes: written for Windows PowerShell 5.1, so no ternaries,
  no '??', no -SkipHttpErrorCheck, no $IsWindows without a guard. Native
  commands run through Invoke-Native, which keeps their stderr from becoming
  a terminating error under $ErrorActionPreference = 'Stop'.
#>
param(
    # Command and GNU-style flags, parsed by hand below so they match the
    # bash script exactly ('install --demo --no-open'). PowerShell hands
    # '--x' tokens through untouched, and collects unknown '-x' ones here too.
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $Arguments
)

$ErrorActionPreference = 'Stop'
# PowerShell 7.4+ can turn a native command's non-zero exit into a terminating
# error under 'Stop'. Exit codes are read explicitly everywhere below.
$PSNativeCommandUseErrorActionPreference = $false
# Invoke-WebRequest under 5.1 is very slow with its progress bar on.
$ProgressPreference = 'SilentlyContinue'
# Older Windows 10 builds default .NET Framework to TLS 1.0/1.1, which GitHub
# and nodejs.org refuse.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

# Keep sealgate-stdiod (anyhow) from spilling a Rust backtrace on expected
# failures; its exit codes are translated into actionable messages here.
if (-not $env:RUST_BACKTRACE) { $env:RUST_BACKTRACE = '0' }
if (-not $env:RUST_LIB_BACKTRACE) { $env:RUST_LIB_BACKTRACE = '0' }

# ---------------------------------------------------------------------------
# Defaults (every one overridable by flag or environment variable)
# ---------------------------------------------------------------------------
$script:SG_BACKEND_SET = [bool]$env:SG_BACKEND
$script:SG_BACKEND = if ($env:SG_BACKEND) { $env:SG_BACKEND } else { 'https://dashboard.sealgate.ai' }
$script:SG_API_KEY = if ($env:SG_API_KEY) { $env:SG_API_KEY } else { '' }
$script:SERVER_NAME = if ($env:SERVER_NAME) { $env:SERVER_NAME } else { 'beeper' }
$script:DEVICE_LABEL = if ($env:DEVICE_LABEL) { $env:DEVICE_LABEL } elseif ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { 'my-pc' }
$script:MCP_PKG = if ($env:MCP_PKG) { $env:MCP_PKG } else { '@beeper/mcp-remote' }
$script:NODE_VERSION = if ($env:NODE_VERSION) { $env:NODE_VERSION } else { '' }
$script:NODE_VERSION_FALLBACK = 'v24.20.0'
$script:OAUTH_WAIT = if ($env:OAUTH_WAIT) { [int]$env:OAUTH_WAIT } else { 120 }
$script:BEEPER_WAIT = if ($env:BEEPER_WAIT) { [int]$env:BEEPER_WAIT } else { 30 }
$script:CONNECT_WAIT = if ($env:CONNECT_WAIT) { [int]$env:CONNECT_WAIT } else { 45 }
$script:STDIOD_REPO = if ($env:STDIOD_REPO) { $env:STDIOD_REPO } else { 'Edison-Watch/app' }
$script:STDIOD_TAG = if ($env:STDIOD_TAG) { $env:STDIOD_TAG } else { '' }
$script:STDIOD_CHANNEL_SET = [bool]$env:STDIOD_PRERELEASE
$script:STDIOD_PRERELEASE = ($env:STDIOD_PRERELEASE -eq '1')

$script:DRY_RUN = $false
$script:INSTALL_DEPS = $true
$script:ASSUME_YES = $false
$script:YES_SET = $false
$script:INTERACTIVE = $false
$script:JSON = $false
$script:VERBOSE_LOG = $false
$script:NO_COLOR_FLAG = $false
$script:NO_OPEN = $false
$script:RELOGIN = $false
$script:NEW_DEVICE = $false
$script:NO_PREAUTH = $false
$script:BEEPER_READY = $false
$script:STDIOD_CONNECTED = $false
$script:MCP_ENDPOINT = ''
$script:STDIOD_CRED_STATE = ''

$script:PROG = 'install-beeper.ps1'
$script:SCRIPT_URL = "https://raw.githubusercontent.com/$($script:STDIOD_REPO)/main/crates/stdiod/scripts/install-beeper.ps1"
# Per-user install root. The daemon looks for npx in '<exe dir>\runtimes\node'
# on its own (see proc.rs, bundled_runtime_dirs), so Node goes there.
$script:LOCALAPPDATA = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME 'AppData\Local' }
$script:INSTALL_DIR = Join-Path $script:LOCALAPPDATA 'Programs\sealgate-stdiod'
$script:NODE_DIR = Join-Path $script:INSTALL_DIR 'runtimes\node'
$script:STDIOD_EXE = Join-Path $script:INSTALL_DIR 'sealgate-stdiod.exe'
$script:HOME_DIR = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }

# How to re-run this script, for the 'fix:' lines. A file on disk is called
# by path; the piped one-liner has no path, so the scriptblock form is used.
$script:RERUN = if ($PSCommandPath) { "& '$PSCommandPath'" } else { "& ([scriptblock]::Create((irm $($script:SCRIPT_URL)))) " }

# ---------------------------------------------------------------------------
# Output helpers (data to the pipeline, diagnostics + progress to the host)
# ---------------------------------------------------------------------------
$script:COLOR = $false
function Initialize-Colors {
    if ($script:NO_COLOR_FLAG -or $env:NO_COLOR) { return }
    $script:COLOR = $true
}
function Write-Diag([string]$Text, [string]$Color) {
    if ($script:COLOR -and $Color) { Write-Host $Text -ForegroundColor $Color } else { Write-Host $Text }
}
function Log([string]$Text) { Write-Diag $Text }
function Step([string]$Text) { Write-Diag ">> $Text" 'Cyan' }
function Ok([string]$Text) { Write-Diag "   + $Text" 'Green' }
function Info([string]$Text) { Write-Diag "   - $Text" 'DarkGray' }
function Warn([string]$Text) { Write-Diag "   ! $Text" 'Yellow' }
function Todo([string]$Text) { Write-Diag "   action: $Text" 'Cyan' }
function Vlog([string]$Text) { if ($script:VERBOSE_LOG) { Write-Diag "   debug: $Text" 'DarkGray' } }

# Die: print the error + fix and unwind to Main, which turns it into the exit
# code. A throw (not 'exit') so an interactive session that dot-sourced or
# scriptblock-invoked the script is not closed on error. The fix and code ride
# in script variables rather than a custom exception class: PowerShell classes
# have version-specific quirks under Invoke-Expression, and a marked string
# works the same on 5.1 and 7.
$script:DIE_MARK = 'install-beeper-die:'
$script:DIE_FIX = ''
$script:DIE_CODE = 1
function Die([string]$Message, [string]$Fix = '', [int]$Code = 1) {
    $script:DIE_FIX = $Fix
    $script:DIE_CODE = $Code
    throw "$($script:DIE_MARK)$Message"
}

# Run a native command, capturing stdout+stderr as text and the exit code in
# $script:LastRc. Native stderr under 2>&1 becomes ErrorRecords, which Windows
# PowerShell 5.1 turns into a terminating error when the preference is 'Stop';
# lowering it around the call is the documented way out.
function Invoke-Native([string]$File, [string[]]$ArgList) {
    Vlog "run: $File $($ArgList -join ' ')"
    if (-not (Get-Command $File -ErrorAction SilentlyContinue)) { $script:LastRc = 127; return "command not found: $File" }
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $File @ArgList 2>&1 | ForEach-Object { "$_" }
        $script:LastRc = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $eap
    }
    if ($null -eq $out) { return '' }
    return (($out -join "`n").TrimEnd())
}

# Run a native command with output shown live (login, install). Returns the
# exit code.
function Invoke-Live([string]$File, [string[]]$ArgList) {
    if ($script:DRY_RUN) { Write-Diag "   would run: $File $($ArgList -join ' ')" 'Cyan'; return 0 }
    Vlog "run: $File $($ArgList -join ' ')"
    if (-not (Get-Command $File -ErrorAction SilentlyContinue)) { Warn "command not found: $File"; return 127 }
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $File @ArgList 2>&1 | ForEach-Object { Write-Host "$_" }
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $eap
    }
}

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Confirm-Action([string]$Question) {
    if ($script:DRY_RUN) { return $true }
    if ($script:ASSUME_YES) { return $true }
    if (-not $script:INTERACTIVE) {
        Die "refusing to run a confirming action non-interactively: $Question" 'pass --yes to proceed, or --dry-run to preview'
    }
    $ans = Read-Host "$Question [y/N]"
    return ($ans -eq 'y' -or $ans -eq 'Y')
}

# Windows PowerShell 5.1 has no $IsWindows; 5.1 only ever runs on Windows.
function Test-IsWindows {
    if ($PSVersionTable.PSVersion.Major -lt 6) { return $true }
    return [bool]$IsWindows
}

function Require-SupportedPlatform {
    if (-not (Test-IsWindows)) {
        Die 'this installer is for Windows' 'on macOS or Linux run install-beeper.sh: curl -fsSL https://raw.githubusercontent.com/Edison-Watch/app/main/crates/stdiod/scripts/install-beeper.sh | bash -s -- install'
    }
}

# Machine architecture as the release/Node token: x64 or arm64. Reads the OS
# architecture (not the process one), so an x64 PowerShell on an ARM64 box
# still gets the native binaries.
function Get-Arch {
    $os = ''
    try { $os = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() } catch {}
    if (-not $os) {
        $os = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    }
    switch -Regex ($os) {
        '^(Arm64|ARM64)$' { return 'arm64' }
        '^(X64|AMD64)$' { return 'x64' }
    }
    return ''
}

# ---------------------------------------------------------------------------
# Flag parsing (shared across subcommands; unknown flags fail fast)
# ---------------------------------------------------------------------------
function Get-FlagValue([string[]]$List, [int]$Index, [string]$Flag) {
    if ($Index + 1 -ge $List.Count) { Die "flag '$Flag' needs a value" "example: $Flag <value>" }
    $val = $List[$Index + 1]
    if ($val.StartsWith('-')) { Die "flag '$Flag' needs a value" "example: $Flag <value>" }
    return $val
}

# Returns $true when --help was seen.
function Parse-Flags([string[]]$List) {
    $script:POSITIONAL = @()
    $i = 0
    while ($i -lt $List.Count) {
        $a = $List[$i]
        switch ($a) {
            '--sg-backend' { $script:SG_BACKEND = Get-FlagValue $List $i $a; $script:SG_BACKEND_SET = $true; $i += 2; continue }
            '--demo' { $script:SG_BACKEND = 'https://demo-dashboard.sealgate.ai'; $script:SG_BACKEND_SET = $true; $i++; continue }
            '--release' { $script:SG_BACKEND = 'https://dashboard.sealgate.ai'; $script:SG_BACKEND_SET = $true; $i++; continue }
            '--sg-api-key' { $script:SG_API_KEY = Get-FlagValue $List $i $a; $i += 2; continue }
            '--server-name' { $script:SERVER_NAME = Get-FlagValue $List $i $a; $i += 2; continue }
            '--device-label' { $script:DEVICE_LABEL = Get-FlagValue $List $i $a; $i += 2; continue }
            '--node-version' { $script:NODE_VERSION = Get-FlagValue $List $i $a; $i += 2; continue }
            '--oauth-wait' { $script:OAUTH_WAIT = [int](Get-FlagValue $List $i $a); $i += 2; continue }
            '--beeper-wait' { $script:BEEPER_WAIT = [int](Get-FlagValue $List $i $a); $i += 2; continue }
            '--no-open' { $script:NO_OPEN = $true; $i++; continue }
            '--relogin' { $script:RELOGIN = $true; $i++; continue }
            '--new-device' { $script:NEW_DEVICE = $true; $script:RELOGIN = $true; $i++; continue }
            '--no-preauth' { $script:NO_PREAUTH = $true; $i++; continue }
            '--stdiod-tag' { $script:STDIOD_TAG = Get-FlagValue $List $i $a; $i += 2; continue }
            '--stdiod-prerelease' { $script:STDIOD_PRERELEASE = $true; $script:STDIOD_CHANNEL_SET = $true; $i++; continue }
            '--stdiod-release' { $script:STDIOD_PRERELEASE = $false; $script:STDIOD_CHANNEL_SET = $true; $i++; continue }
            '--dry-run' { $script:DRY_RUN = $true; $i++; continue }
            '-y' { $script:ASSUME_YES = $true; $script:YES_SET = $true; $i++; continue }
            '--yes' { $script:ASSUME_YES = $true; $script:YES_SET = $true; $i++; continue }
            '--interactive' { $script:INTERACTIVE = $true; $script:ASSUME_YES = $false; $script:YES_SET = $true; $i++; continue }
            '--install-deps' { $script:INSTALL_DEPS = $true; $i++; continue }
            '--no-install-deps' { $script:INSTALL_DEPS = $false; $i++; continue }
            '--no-color' { $script:NO_COLOR_FLAG = $true; $i++; continue }
            '--json' { $script:JSON = $true; $i++; continue }
            '--verbose' { $script:VERBOSE_LOG = $true; $i++; continue }
            '-h' { return $true }
            '--help' { return $true }
            '--' { $i++; continue }
            # --from-source needs a Rust toolchain and a checkout, which the
            # Windows path does not carry; the prebuilt exe is the only path.
            '--from-source' { Die '--from-source is not supported by the Windows installer' 'drop the flag to download the prebuilt exe, or build with cargo from a checkout of crates/stdiod' }
            default {
                if ($a.StartsWith('-')) { Die "unknown flag: $a" "run '$($script:PROG) <command> --help' for accepted flags" }
                $script:POSITIONAL += $a
                $i++
            }
        }
    }
    return $false
}

# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------
function Get-Text([string]$Url, [int]$TimeoutSec = 20) {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
    if ($r.Content -is [byte[]]) { return [System.Text.Encoding]::UTF8.GetString($r.Content) }
    return [string]$r.Content
}

# Download to a file; $false on any failure (the caller decides what it means).
function Get-File([string]$Url, [string]$Dest, [int]$TimeoutSec = 300) {
    try {
        Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing -TimeoutSec $TimeoutSec
        return (Test-Path $Dest)
    } catch {
        Vlog "download failed: $Url ($($_.Exception.Message))"
        return $false
    }
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

# Expected hash for $Name from a 'sha256  name' listing; '' when absent.
function Find-ChecksumFor([string]$Listing, [string]$Name) {
    foreach ($line in ($Listing -split "`n")) {
        $t = $line.Trim()
        if ($t -match "^([0-9a-fA-F]{64})\s+\*?$([regex]::Escape($Name))$") { return $matches[1].ToLowerInvariant() }
    }
    return ''
}

# True when a URL answers with any HTTP status (a 404 still means something is
# listening); false on connection failure or timeout.
function Test-HttpListening([string]$Url, [int]$TimeoutMs = 2000) {
    try {
        $req = [System.Net.HttpWebRequest]::Create($Url)
        $req.Timeout = $TimeoutMs
        $req.ReadWriteTimeout = $TimeoutMs
        $req.AllowAutoRedirect = $false
        $resp = $req.GetResponse()
        $resp.Close()
        return $true
    } catch [System.Net.WebException] {
        return ($null -ne $_.Exception.Response)
    } catch {
        return $false
    }
}

# ---------------------------------------------------------------------------
# PATH handling
# ---------------------------------------------------------------------------
# Prepend a directory to the user's persistent PATH (HKCU\Environment) and to
# this process. Reads and writes the raw registry value so REG_EXPAND_SZ entries
# like %USERPROFILE%\bin survive; [Environment]::SetEnvironmentVariable would
# flatten them.
function Add-UserPath([string]$Dir) {
    $parts = ($env:Path -split ';') | Where-Object { $_ }
    if ($parts -notcontains $Dir) { $env:Path = "$Dir;$env:Path" }
    if ($script:DRY_RUN) { return }
    try {
        $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
        if ($null -eq $key) { return }
        $raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        $entries = ($raw -split ';') | Where-Object { $_ }
        if ($entries -contains $Dir) { $key.Close(); return }
        $new = if ($raw) { "$Dir;$raw" } else { $Dir }
        $key.SetValue('Path', $new, [Microsoft.Win32.RegistryValueKind]::ExpandString)
        $key.Close()
        Send-EnvironmentChange
        Info "added $Dir to your user PATH (new terminals pick it up)"
    } catch {
        Warn "could not update the user PATH: $($_.Exception.Message)"
        Todo "add $Dir to your PATH yourself (Settings > System > About > Advanced system settings > Environment Variables)"
    }
}

# Tell Explorer the environment changed so shells started from the Start menu
# see the new PATH without a sign-out. Best effort.
function Send-EnvironmentChange {
    try {
        if (-not ('SealGate.Installer.Native' -as [type])) {
            Add-Type -Namespace SealGate.Installer -Name Native -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Auto)]
public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);
'@
        }
        $result = [System.UIntPtr]::Zero
        [void][SealGate.Installer.Native]::SendMessageTimeout([System.IntPtr]0xFFFF, 0x001A, [System.UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
    } catch {
        Vlog "WM_SETTINGCHANGE broadcast skipped: $($_.Exception.Message)"
    }
}

# ---------------------------------------------------------------------------
# Step 1: prerequisites
# ---------------------------------------------------------------------------
# node/npx comes from the official Node.js zip, unpacked into the daemon's own
# runtimes folder. No installer, no admin, no MSI: the daemon finds it there by
# itself, and the folder is added to the user PATH for their shells.

# Newest Node.js LTS tag (e.g. v24.20.0) from nodejs.org; '' on failure.
function Get-LatestNodeLts {
    try {
        $list = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing -TimeoutSec 15
        foreach ($rel in $list) {
            if ($rel.lts -and ($rel.lts -ne $false)) { return [string]$rel.version }
        }
    } catch {
        Vlog "nodejs.org listing unreachable: $($_.Exception.Message)"
    }
    return ''
}

# Download + verify + unpack the official Node.js build. $false on any
# recoverable miss so the caller can print the manual step. A checksum
# MISMATCH is never recoverable and dies on the spot.
function Install-NodeUserspace {
    $arch = Get-Arch
    if (-not $arch) { Info "no official Node.js build for this architecture ($env:PROCESSOR_ARCHITECTURE)"; return $false }
    $ver = $script:NODE_VERSION
    if (-not $ver) { $ver = Get-LatestNodeLts }
    if (-not $ver) { $ver = $script:NODE_VERSION_FALLBACK }
    $name = "node-$ver-win-$arch"
    $zip = "$name.zip"
    $base = "https://nodejs.org/dist/$ver"
    Step "downloading Node.js $ver (win-$arch, per-user, no admin)"
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("install-beeper-node-" + [System.IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    try {
        $zipPath = Join-Path $tmp $zip
        if (-not (Get-File "$base/$zip" $zipPath)) { Warn "could not download $zip from nodejs.org"; return $false }
        $sums = ''
        try { $sums = Get-Text "$base/SHASUMS256.txt" 60 } catch {}
        if (-not $sums) { Warn "could not download Node's SHASUMS256.txt; refusing the unverified zip"; return $false }
        $want = Find-ChecksumFor $sums $zip
        $got = Get-Sha256 $zipPath
        if (-not $want -or $want -ne $got) {
            $shown = if ($want) { $want } else { '<absent>' }
            Die "checksum mismatch for $zip (expected $shown, got $got)" "retry, or install Node yourself from https://nodejs.org and re-run: $($script:RERUN) install"
        }
        $extract = Join-Path $tmp 'x'
        Expand-Archive -Path $zipPath -DestinationPath $extract -Force
        $inner = Join-Path $extract $name
        if (-not (Test-Path (Join-Path $inner 'npx.cmd'))) { Warn "unexpected zip layout: $name\npx.cmd missing"; return $false }
        if (Test-Path $script:NODE_DIR) { Remove-Item $script:NODE_DIR -Recurse -Force }
        New-Item -ItemType Directory -Path (Split-Path $script:NODE_DIR -Parent) -Force | Out-Null
        Move-Item -Path $inner -Destination $script:NODE_DIR
    } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
    Add-UserPath $script:NODE_DIR
    if (-not (Test-Command 'npx.cmd')) { Warn 'Node unpacked but npx is still not on PATH'; return $false }
    Ok "installed Node.js $ver -> $($script:NODE_DIR) (node/npm/npx)"
    return $true
}

function Ensure-Node {
    if (Test-Command 'npx.cmd') { return }
    if (Test-Path (Join-Path $script:NODE_DIR 'npx.cmd')) {
        $env:Path = "$($script:NODE_DIR);$env:Path"
        if (Test-Command 'npx.cmd') { Ok "found npx in $($script:NODE_DIR) (added to PATH for this run)"; return }
    }
    $fix = "install Node from https://nodejs.org, then re-run: $($script:RERUN) install"
    if ($script:DRY_RUN) {
        Info "dep 'npx' missing; would download the official Node.js LTS zip into $($script:NODE_DIR) (per-user, no admin)"
        return
    }
    if (-not $script:INSTALL_DEPS -and -not $script:INTERACTIVE) {
        Die "'npx' is not installed" "$fix, or re-run with --install-deps to fetch a per-user Node automatically"
    }
    if (-not (Confirm-Action "Node (npx) is missing. Download the official Node.js LTS build into $($script:NODE_DIR) now (no admin)?")) {
        Die "declined; 'npx' not installed" $fix
    }
    if (Install-NodeUserspace) { return }
    Die 'could not install Node (npx)' "$fix, or pin a version with NODE_VERSION=vX.Y.Z (e.g. $($script:NODE_VERSION_FALLBACK)) and re-run"
}

# ---------------------------------------------------------------------------
# sealgate-stdiod binary: download the prebuilt release exe
# ---------------------------------------------------------------------------
# The desktop app's release workflow (.github/workflows/desktop-release.yml)
# publishes sealgate-stdiod-windows-<arch>.exe plus SHA256SUMS-windows-<arch>
# onto the app's own v<version> release. The daemon version follows the app
# version, so the newest app release IS the newest daemon.

function Get-StdiodReleaseAsset {
    $arch = Get-Arch
    if (-not $arch) { return $null }
    return @{ Asset = "sealgate-stdiod-windows-$arch.exe"; Sums = "SHA256SUMS-windows-$arch" }
}

# Sort key for a tag: its numbers as a padded string, so v0.6.4-beta.10 sorts
# after v0.6.4-beta.9.
function Get-TagSortKey([string]$Tag) {
    $nums = [regex]::Matches($Tag, '\d+') | ForEach-Object { $_.Value.PadLeft(8, '0') }
    return ($nums -join '.')
}

# Newest app release tag for the requested channel; '' when none is found.
# Stable and demo (-beta) are separate lineages: --stdiod-prerelease picks the
# newest BETA, never "the newest release of any kind".
function Get-LatestStdiodTag {
    $repo = $script:STDIOD_REPO
    try {
        if ($script:STDIOD_PRERELEASE) {
            $rels = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases?per_page=100" -UseBasicParsing -TimeoutSec 15
            $tags = @($rels | ForEach-Object { [string]$_.tag_name } | Where-Object { $_ -match '^v[0-9]+\.[0-9]+\.[0-9]+-[0-9A-Za-z.]+$' })
            if ($tags.Count -gt 0) {
                return ($tags | Sort-Object { Get-TagSortKey $_ } | Select-Object -Last 1)
            }
        } else {
            $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -UseBasicParsing -TimeoutSec 15
            if ($rel.tag_name) { return [string]$rel.tag_name }
        }
    } catch {
        Vlog "GitHub API unreachable: $($_.Exception.Message)"
    }
    # Fallback without the API (proxy, unauthenticated rate limit): the
    # /releases/latest page redirects to /releases/tag/<tag>. Only the stable
    # channel has such a pointer.
    if (-not $script:STDIOD_PRERELEASE) {
        try {
            $req = [System.Net.HttpWebRequest]::Create("https://github.com/$repo/releases/latest")
            $req.AllowAutoRedirect = $false
            $req.Timeout = 15000
            $resp = $req.GetResponse()
            $loc = [string]$resp.Headers['Location']
            $resp.Close()
            if ($loc -match '/releases/tag/(v[0-9]+\.[0-9]+\.[0-9]+)$') { return $matches[1] }
        } catch {
            Vlog "release redirect probe failed: $($_.Exception.Message)"
        }
    }
    return ''
}

# Download + verify + install the prebuilt exe. $false on any recoverable
# miss; a checksum MISMATCH dies on the spot.
function Install-StdiodPrebuilt {
    $pair = Get-StdiodReleaseAsset
    if ($null -eq $pair) { Info "no prebuilt sealgate-stdiod for this architecture ($env:PROCESSOR_ARCHITECTURE)"; return $false }
    $asset = $pair.Asset
    $sums = $pair.Sums
    $tag = $script:STDIOD_TAG
    if (-not $tag) { $tag = Get-LatestStdiodTag }
    $channel = if ($script:STDIOD_PRERELEASE) { 'demo (-beta)' } else { 'stable' }
    if (-not $tag) { Warn "no $channel release found on $($script:STDIOD_REPO) (or the GitHub API is unreachable)"; return $false }
    $base = "https://github.com/$($script:STDIOD_REPO)/releases/download/$tag"
    Step "downloading prebuilt sealgate-stdiod ($tag)"
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("install-beeper-stdiod-" + [System.IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    try {
        $exe = Join-Path $tmp $asset
        if (-not (Get-File "$base/$asset" $exe)) { Warn "release $tag has no asset '$asset' (or the download failed)"; return $false }
        $listing = ''
        try { $listing = Get-Text "$base/$sums" 60 } catch {}
        if (-not $listing) { Warn "release $tag has no checksums file '$sums'; refusing the unverified binary"; return $false }
        $want = Find-ChecksumFor $listing $asset
        $got = Get-Sha256 $exe
        if (-not $want -or $want -ne $got) {
            $shown = if ($want) { $want } else { '<absent>' }
            Die "checksum mismatch for $asset from $tag (expected $shown, got $got)" 'the release assets may be corrupt or tampered with; retry, or pin another release with --stdiod-tag <tag>'
        }
        # Drop the mark-of-the-web so SmartScreen does not block a verified exe.
        Unblock-File -Path $exe -ErrorAction SilentlyContinue
        $null = Invoke-Native $exe @('--version')
        if ($script:LastRc -ne 0) { Warn "downloaded $asset does not run on this machine ('--version' failed)"; return $false }
        New-Item -ItemType Directory -Path $script:INSTALL_DIR -Force | Out-Null
        if (Test-Path $script:STDIOD_EXE) {
            try { Remove-Item $script:STDIOD_EXE -Force } catch {
                Die "cannot replace $($script:STDIOD_EXE): it is in use (the daemon may be running)" "stop it first ('sealgate-stdiod uninstall'), then re-run: $($script:RERUN) install"
            }
        }
        Move-Item -Path $exe -Destination $script:STDIOD_EXE
    } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
    Add-UserPath $script:INSTALL_DIR
    Ok "installed prebuilt sealgate-stdiod $tag -> $($script:STDIOD_EXE) (sha256 verified)"
    return $true
}

function Ensure-StdiodBin {
    if (Test-Command 'sealgate-stdiod') { return }
    if (Test-Path $script:STDIOD_EXE) {
        $env:Path = "$($script:INSTALL_DIR);$env:Path"
        if (Test-Command 'sealgate-stdiod') { Ok "found sealgate-stdiod in $($script:INSTALL_DIR) (added to PATH for this run)"; return }
    }
    if ($script:DRY_RUN) {
        Info "dep 'sealgate-stdiod' missing; would download the prebuilt release exe into $($script:INSTALL_DIR)"
        return
    }
    $fix = 're-run with --install-deps'
    if (-not $script:INSTALL_DEPS -and -not $script:INTERACTIVE) { Die "'sealgate-stdiod' is not installed" $fix }
    if (-not (Confirm-Action 'sealgate-stdiod is missing. Download the prebuilt release exe now?')) { Die "declined; 'sealgate-stdiod' not installed" $fix }
    if (Install-StdiodPrebuilt) { return }
    Die 'could not install a prebuilt sealgate-stdiod (see the warnings above)' "check https://github.com/$($script:STDIOD_REPO)/releases for an asset matching windows-$(Get-Arch), or pin one with --stdiod-tag <tag>"
}

function Ensure-Deps {
    Step 'Checking prerequisites'
    Require-SupportedPlatform
    Ensure-Node
    Ensure-StdiodBin
    if ($script:DRY_RUN) { Info 'deps: preview only (nothing was installed)' } else { Ok 'npx and sealgate-stdiod present' }
}

# ---------------------------------------------------------------------------
# Step A: Beeper Desktop app + its MCP endpoint
# ---------------------------------------------------------------------------
function Test-LoopbackUrl([string]$Url) {
    try { $h = ([System.Uri]$Url).Host } catch { return $false }
    return ($h -in @('127.0.0.1', 'localhost', '::1', '[::1]'))
}

# The first reachable Beeper Desktop API base URL, or ''. The app answers on
# 127.0.0.1:23373 by default; it may also bind IPv6 or scan 23373-23378.
# BEEPER_API_URL overrides the probe (loopback only).
function Get-BeeperApiBase {
    $wk = '/.well-known/oauth-authorization-server'
    if ($env:BEEPER_API_URL) {
        if (Test-LoopbackUrl $env:BEEPER_API_URL) {
            if (Test-HttpListening "$($env:BEEPER_API_URL)$wk" 3000) { return $env:BEEPER_API_URL }
        } else {
            Warn "ignoring non-loopback BEEPER_API_URL ($($env:BEEPER_API_URL)); the Beeper Client API is local-only"
        }
    }
    foreach ($h in @('127.0.0.1', 'localhost', '[::1]')) {
        foreach ($p in 23373..23378) {
            $url = "http://${h}:$p"
            if (Test-HttpListening "$url$wk" 1500) { return $url }
        }
    }
    return ''
}

# Sets MCP_ENDPOINT (the full /v0/mcp URL) when Beeper answers on a base other
# than the proxy's built-in default, so the proxy must be told where to go.
function Resolve-McpEndpoint {
    $script:MCP_ENDPOINT = ''
    $base = Get-BeeperApiBase
    if (-not $base) { return }
    if ($base -notin @('http://127.0.0.1:23373', 'http://localhost:23373')) { $script:MCP_ENDPOINT = "$base/v0/mcp" }
}

# Installed Beeper Desktop exe, or ''. The per-user NSIS installer records
# itself under HKCU Uninstall with DisplayIcon pointing at the exe; the known
# install folders are a fallback for a registry entry that names no icon.
function Get-BeeperDesktopExe {
    $roots = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    foreach ($root in $roots) {
        $keys = @(Get-ChildItem -Path $root -ErrorAction SilentlyContinue)
        foreach ($k in $keys) {
            $p = Get-ItemProperty -Path $k.PSPath -ErrorAction SilentlyContinue
            if (-not $p -or -not $p.DisplayName -or $p.DisplayName -notlike 'Beeper*') { continue }
            if ($p.DisplayIcon) {
                $icon = ([string]$p.DisplayIcon) -replace ',\s*-?\d+$', ''
                $icon = $icon.Trim('"')
                if ($icon -like '*.exe' -and (Test-Path $icon)) { return $icon }
            }
            if ($p.InstallLocation) {
                $hit = Get-ChildItem -Path $p.InstallLocation -Filter 'Beeper*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($hit) { return $hit.FullName }
            }
        }
    }
    $programs = Join-Path $script:LOCALAPPDATA 'Programs'
    foreach ($dir in @(Get-ChildItem -Path $programs -Directory -Filter '*beeper*' -ErrorAction SilentlyContinue)) {
        $hit = Get-ChildItem -Path $dir.FullName -Filter 'Beeper*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return ''
}

# Offer to install Beeper Desktop via winget (the package is Beeper.Beeper).
# Shared consent model, NON-FATAL throughout: install can still wire the whole
# SealGate side with Beeper absent, so every failure path prints the manual
# action and returns $false instead of dying.
function Install-BeeperDesktop {
    $fix = 'install Beeper Desktop: winget install --id Beeper.Beeper -e   (or https://www.beeper.com/download)'
    if (-not ($script:INSTALL_DEPS -or $script:INTERACTIVE) -or -not ($script:ASSUME_YES -or $script:INTERACTIVE)) {
        Todo "$fix, then re-run: $($script:RERUN) install"
        return $false
    }
    if (-not (Confirm-Action 'Beeper Desktop is not installed. Install it now via: winget install --id Beeper.Beeper -e')) {
        Todo "$fix, then re-run: $($script:RERUN) install"
        return $false
    }
    if (-not (Test-Command 'winget')) {
        Warn 'winget is not available on this machine; cannot auto-install Beeper Desktop'
        Todo 'download it from https://www.beeper.com/download, install it, then re-run'
        return $false
    }
    Step 'installing Beeper Desktop via: winget install --id Beeper.Beeper -e'
    $out = Invoke-Native 'winget' @('install', '--id', 'Beeper.Beeper', '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity')
    if ($script:LastRc -ne 0) {
        Warn "winget install failed (exit $($script:LastRc))"
        if ($out) { Info "winget said: $(($out -split "`n" | Select-Object -Last 2) -join ' ')" }
        Todo $fix
        return $false
    }
    $app = Get-BeeperDesktopExe
    if (-not $app) {
        Warn 'winget reported success but Beeper Desktop was not found afterwards'
        Todo "reinstall it: winget install --id Beeper.Beeper -e --force   (or https://www.beeper.com/download)"
        return $false
    }
    Ok "installed Beeper Desktop: $app"
    return $true
}

# Poll the Beeper client API for up to N seconds; the base URL, or ''.
function Wait-BeeperApi([int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        $base = Get-BeeperApiBase
        if ($base) { return $base }
        Start-Sleep -Seconds 2
    }
    return ''
}

function Ensure-BeeperDesktop {
    Step 'Beeper Desktop'
    if ($script:DRY_RUN) {
        Info 'would look for Beeper Desktop in the per-user uninstall registry and %LOCALAPPDATA%\Programs'
        Info 'would probe 127.0.0.1:23373-23378 for the Beeper Client API'
        Info "if either is missing: would offer 'winget install --id Beeper.Beeper -e' and open the app"
        return
    }
    $app = Get-BeeperDesktopExe
    if ($app) { Ok "app:        $app" } else { Warn 'app:        Beeper Desktop not found (registry, %LOCALAPPDATA%\Programs)' }
    $base = Get-BeeperApiBase
    if ($base) {
        Ok "client API: responding at $base"
        $script:BEEPER_READY = $true
        return
    }
    Warn 'client API: no response on 127.0.0.1:23373-23378'
    if (-not $app) {
        if (Install-BeeperDesktop) { $app = Get-BeeperDesktopExe }
    }
    if ($app) {
        Info "opening $app"
        $opened = $false
        try { Start-Process -FilePath $app | Out-Null; $opened = $true } catch { Warn "could not start Beeper: $($_.Exception.Message)" }
        if ($opened -and $script:BEEPER_WAIT -gt 0) {
            Info "waiting up to $($script:BEEPER_WAIT)s for the client API"
            $base = Wait-BeeperApi $script:BEEPER_WAIT
            if ($base) {
                Ok "client API: responding at $base"
                $script:BEEPER_READY = $true
                return
            }
        }
    }
    Todo 'in Beeper Desktop: sign in (create the account if needed), then enable Settings > Developers > MCP'
    Todo 'link the chats you want (WhatsApp / Telegram / ...) in Beeper'
    Info "once MCP is enabled, re-run '$($script:RERUN) install' (idempotent) or '$($script:RERUN) preauth' to finish the Beeper side"
    Info '@beeper/mcp-remote proxies this local Client API, so the Desktop app is all the daemon needs'
    Warn 'continuing to wire the SealGate side; the Beeper child stays idle until Beeper is reachable'
}

# ---------------------------------------------------------------------------
# Step 5 / C: prime the Beeper OAuth grant
# ---------------------------------------------------------------------------
# Read a file another process still has open for writing.
function Read-SharedFile([string]$Path) {
    if (-not (Test-Path $Path)) { return '' }
    try {
        $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try {
            $sr = New-Object System.IO.StreamReader($fs)
            return $sr.ReadToEnd()
        } finally { $fs.Close() }
    } catch { return '' }
}

# Spawn the proxy, send one MCP initialize over stdio, and poll for a reply;
# the proxy only answers once the OAuth grant exists. Beeper raises its
# approve/deny prompt on the first connect and caches the grant for later
# spawns (same profile, so the daemon's child reuses it).
function Invoke-PrimeOauthGrant {
    Step 'Beeper OAuth grant (approve in Beeper if prompted)'
    if ($script:DRY_RUN) {
        Info "would run 'npx -y $($script:MCP_PKG)', send an MCP initialize, and wait up to $($script:OAUTH_WAIT)s for the grant"
        return
    }
    if (-not (Get-BeeperApiBase)) {
        Warn 'skipping: the Beeper Client API is not reachable, so there is nothing to authorize yet'
        Todo "once Beeper is running with MCP enabled, run: $($script:RERUN) preauth"
        return
    }
    Resolve-McpEndpoint
    if ($script:MCP_ENDPOINT) { Info "Beeper answers on a non-default port; pointing the proxy at $($script:MCP_ENDPOINT)" }
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) ("install-beeper-" + [System.IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $outFile = Join-Path $dir 'out'
    $errFile = Join-Path $dir 'err'
    $init = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"install-beeper","version":"1.0.0"}}}'
    # npx is a .cmd shim, so it runs through cmd.exe; cmd also does the file
    # redirection. Our end of stdin stays open while OAuth completes, exactly
    # like the bash script's 'sleep' keeping the pipe alive.
    $line = "npx -y $($script:MCP_PKG)"
    if ($script:MCP_ENDPOINT) { $line += " $($script:MCP_ENDPOINT)" }
    $line += " 1>""$outFile"" 2>""$errFile"""
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'cmd.exe'
    $psi.Arguments = "/d /s /c ""$line"""
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.CreateNoWindow = $true
    $proc = [System.Diagnostics.Process]::Start($psi)
    $proc.StandardInput.WriteLine($init)
    $proc.StandardInput.Flush()
    Info "if Beeper raises an approval prompt, approve it (waiting up to $($script:OAUTH_WAIT)s)"
    $waited = 0
    $authUrl = ''
    $done = $false
    while ($waited -lt $script:OAUTH_WAIT) {
        if ((Read-SharedFile $outFile) -match '"result"') { $done = $true; break }
        if ($proc.HasExited) { break }
        if (-not $authUrl) {
            $err = Read-SharedFile $errFile
            $m = [regex]::Match($err, 'https?://[^\s"'']*authorize[^\s"'']*')
            if ($m.Success) { $authUrl = $m.Value; Todo "no prompt? open this URL in a browser to approve: $authUrl" }
        }
        Start-Sleep -Seconds 1
        $waited++
    }
    if (-not $done -and (Read-SharedFile $outFile) -match '"result"') { $done = $true }
    # Teardown: EOF on stdin winds the proxy down; the tree kill catches a
    # child that ignores it.
    try { $proc.StandardInput.Close() } catch {}
    Start-Sleep -Seconds 1
    if (-not $proc.HasExited) { $null = Invoke-Native 'taskkill' @('/pid', "$($proc.Id)", '/t', '/f') }
    if ($done) {
        if ($waited -le 3) { Ok 'MCP handshake completed immediately (grant already cached)' } else { Ok 'OAuth grant approved; the MCP handshake completed' }
        Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
        return
    }
    Warn "no MCP handshake within $($script:OAUTH_WAIT)s"
    $errTail = Read-SharedFile $errFile
    if ($errTail) { Info "proxy stderr (tail): $((($errTail -split "`n") | Where-Object { $_.Trim() } | Select-Object -Last 3) -join ' ')" }
    Todo "keep Beeper running and re-run: $($script:RERUN) preauth   (then approve the prompt it raises)"
    Info "until the grant exists, the daemon's '$($script:SERVER_NAME)' child cannot reach Beeper"
    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------
# Shared: is SERVER_NAME already an approved server bound to this device?
# ---------------------------------------------------------------------------
function Test-ServerRegistered([string]$Name = $script:SERVER_NAME) {
    if (-not (Test-Command 'sealgate-stdiod')) { return $false }
    $json = Invoke-Native 'sealgate-stdiod' @('server', 'list', '--json')
    if ($script:LastRc -ne 0 -or -not $json) { return $false }
    try {
        $data = $json | ConvertFrom-Json
    } catch {
        return ($json -match ('"' + [regex]::Escape($Name) + '"'))
    }
    return (Test-JsonHasName $data $Name)
}

# Walk a parsed JSON tree for any object whose .name equals $Name.
function Test-JsonHasName($Node, [string]$Name) {
    if ($null -eq $Node) { return $false }
    if ($Node -is [System.Array]) {
        foreach ($item in $Node) { if (Test-JsonHasName $item $Name) { return $true } }
        return $false
    }
    if ($Node -is [System.Management.Automation.PSCustomObject]) {
        foreach ($prop in $Node.PSObject.Properties) {
            if ($prop.Name -eq 'name' -and "$($prop.Value)" -eq $Name) { return $true }
            if (Test-JsonHasName $prop.Value $Name) { return $true }
        }
    }
    return $false
}

# ---------------------------------------------------------------------------
# Step 2 + 3: authorize this device and supervise the daemon
# ---------------------------------------------------------------------------
function Get-StdiodConfigPath {
    if ($env:SEALGATE_STDIOD_CONFIG) { return $env:SEALGATE_STDIOD_CONFIG }
    return (Join-Path $script:HOME_DIR '.config\sealgate-stdiod\config.toml')
}
function Get-StdiodStatePath {
    if ($env:SEALGATE_STDIOD_STATE) { return $env:SEALGATE_STDIOD_STATE }
    return (Join-Path $script:HOME_DIR '.config\sealgate-stdiod\state.json')
}

function Test-StdiodLoggedIn {
    $f = Get-StdiodConfigPath
    return ((Test-Path $f) -and ((Get-Content -Path $f -Raw -ErrorAction SilentlyContinue) -match 'client_access_token'))
}

# Real state of the saved credential: absent | live | dead | unknown. 'dead'
# (a 401) is the one that used to be invisible and is repaired by --relogin;
# 'unknown' (backend unreachable) must not be mistaken for it.
function Get-StdiodCredentialState {
    if ($script:STDIOD_CRED_STATE) { return $script:STDIOD_CRED_STATE }
    if (-not (Test-StdiodLoggedIn)) {
        $script:STDIOD_CRED_STATE = 'absent'
    } elseif (-not (Test-Command 'sealgate-stdiod')) {
        $script:STDIOD_CRED_STATE = 'unknown'
    } else {
        $out = Invoke-Native 'sealgate-stdiod' @('server', 'list', '--json')
        if ($script:LastRc -eq 0) {
            $script:STDIOD_CRED_STATE = 'live'
        } elseif ($out -match '(?i)\b401\b|unauthorized|invalid[-_ ]?token|token (expired|revoked)') {
            $script:STDIOD_CRED_STATE = 'dead'
        } else {
            Vlog "credential check inconclusive: $(($out -split "`n") | Select-Object -Last 1)"
            $script:STDIOD_CRED_STATE = 'unknown'
        }
    }
    return $script:STDIOD_CRED_STATE
}

# Value of a top-level 'key = "value"' line in config.toml, or ''.
function Get-StdiodConfigValue([string]$Key) {
    $f = Get-StdiodConfigPath
    if (-not (Test-Path $f)) { return '' }
    foreach ($line in (Get-Content -Path $f -ErrorAction SilentlyContinue)) {
        if ($line -match "^\s*$Key\s*=\s*""?([^""]*)""?") { return $matches[1] }
    }
    return ''
}

function Get-StdiodSavedBackend {
    return ((Get-StdiodConfigValue 'backend_url') -replace '/+$', '')
}

# With no explicit backend, follow the one this device is already authorized to.
function Resolve-Backend {
    if ($script:SG_BACKEND_SET) { return }
    $saved = Get-StdiodSavedBackend
    if ($saved -and $saved -ne ($script:SG_BACKEND -replace '/+$', '')) {
        $script:SG_BACKEND = $saved
        Info "using the backend this device is authorized to: $($script:SG_BACKEND) (override with --sg-backend / --demo / --release)"
    }
}

# Match the daemon channel to the backend unless pinned (see the bash script).
function Resolve-StdiodChannel {
    if ($script:STDIOD_CHANNEL_SET) { return }
    if ($script:STDIOD_TAG) { return }
    if (($script:SG_BACKEND -replace '/+$', '') -match '//demo-|//[^/]*-demo\.') {
        $script:STDIOD_PRERELEASE = $true
        Vlog "demo backend ($($script:SG_BACKEND)): taking the daemon from the demo channel"
    }
}

function Ensure-StdiodAuth {
    Step 'SealGate device authorization (browser)'
    $loginArgs = @('login', '--backend', $script:SG_BACKEND)
    if ($script:NO_OPEN) { $loginArgs += '--no-open' }
    if ($script:NEW_DEVICE) { $loginArgs += '--new-device' }
    if ($script:DRY_RUN) { $null = Invoke-Live 'sealgate-stdiod' $loginArgs; return }
    $cred = 'skip'
    if (-not $script:RELOGIN) { $cred = Get-StdiodCredentialState }
    switch ($cred) {
        { $_ -in @('live', 'unknown') } {
            $saved = Get-StdiodSavedBackend
            if ($saved -and $saved -ne ($script:SG_BACKEND -replace '/+$', '')) {
                if ($script:SG_BACKEND_SET) {
                    Die "this device is authorized to $saved, but --sg-backend asked for $($script:SG_BACKEND)" "pass --relogin to switch to $($script:SG_BACKEND), or drop --sg-backend to keep $saved"
                }
                Warn "using the authorized backend $saved (pass --sg-backend <url> --relogin to switch)"
                $script:SG_BACKEND = $saved
            }
            if ($cred -eq 'unknown') {
                Warn 'could not verify the saved credential (backend unreachable); using it as-is'
            } else {
                Ok "already authorized on this device (client credential in $(Get-StdiodConfigPath))"
            }
            return
        }
        'dead' {
            Warn "the saved credential is expired or revoked ($($script:SG_BACKEND -replace '/+$', '') returned 401)"
            Info 're-running the browser device flow to replace it'
        }
    }
    Info 'a browser opens to approve this device; on a headless box pass --no-open and open the printed URL elsewhere'
    $rc = Invoke-Live 'sealgate-stdiod' $loginArgs
    if ($rc -ne 0) {
        Die 'sealgate-stdiod login failed' "check --sg-backend ($($script:SG_BACKEND)) and complete the browser approval, then re-run: $($script:RERUN) install"
    }
    $script:STDIOD_CRED_STATE = ''
    Ok "device authorized to $($script:SG_BACKEND)"
}

function Get-StdiodConnectionState {
    $f = Get-StdiodStatePath
    if (-not (Test-Path $f)) { return '' }
    try {
        $st = (Get-Content -Path $f -Raw -ErrorAction SilentlyContinue) | ConvertFrom-Json
        return [string]$st.connection_state
    } catch { return '' }
}

# Wait for the daemon to register with the backend. Submitting a server before
# that answers with a 409 that looks exactly like a name conflict.
function Wait-StdiodConnected([int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        switch (Get-StdiodConnectionState) {
            'connected' { return $true }
            'needs_reauth' { Warn "the daemon's credential was rejected (run: $($script:RERUN) install --relogin)"; return $false }
            'needs_upgrade' { Warn 'the daemon is too old for this backend; update it'; return $false }
        }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Ensure-StdiodSupervised {
    Step 'SealGate tunnel daemon (Scheduled Task)'
    # Drop the previous run's state file first: a stale 'needs_reauth' from
    # before this login would otherwise be read as a live verdict.
    if (-not $script:DRY_RUN) { Remove-Item (Get-StdiodStatePath) -Force -ErrorAction SilentlyContinue }
    $rc = Invoke-Live 'sealgate-stdiod' @('install')
    if ($rc -ne 0) {
        Die 'sealgate-stdiod install could not register the Scheduled Task' "the daemon registers a per-user logon task via schtasks (no admin needed). Run this from a normal signed-in user session (not a service or a bare WinRM shell), then re-run: $($script:RERUN) install"
    }
    Ok 'daemon installed and supervised'
    if ($script:DRY_RUN) { return }
    Info "waiting up to $($script:CONNECT_WAIT)s for the daemon to register with the backend"
    if (Wait-StdiodConnected $script:CONNECT_WAIT) {
        Ok 'daemon connected'
        $script:STDIOD_CONNECTED = $true
    } else {
        Warn "the daemon has not connected yet (state: $(Get-StdiodConnectionState))"
    }
}

# ---------------------------------------------------------------------------
# Step 4: submit the Beeper stdio server for approval
# ---------------------------------------------------------------------------
function Get-StdiodUidSuffix {
    $uid = Get-StdiodConfigValue 'authenticated_user_id'
    if ($uid.Length -gt 3) { return $uid.Substring(0, 3) }
    return $uid
}

function Get-ServerAddArgs([string]$Name) {
    # --arg=VALUE form: clap rejects a hyphen-leading value in the space form.
    $a = @('server', 'add', $Name, '--display-name', 'Beeper', '--command', 'npx', '--arg=-y', "--arg=$($script:MCP_PKG)")
    if ($script:MCP_ENDPOINT) { $a += "--arg=$($script:MCP_ENDPOINT)" }
    return $a
}

function Test-NameTaken([string]$Out) { return ($Out -match '(?i)HTTP 409') }
function Test-AutoApproved([string]$Out) { return ($Out -match '(?i)auto-approved') }

function Submit-BeeperServer {
    Step 'Submitting the Beeper server'
    Resolve-McpEndpoint
    if ($script:MCP_ENDPOINT) { Info "Beeper answers on a non-default port; the server command includes $($script:MCP_ENDPOINT)" }
    if ($script:DRY_RUN) { $null = Invoke-Live 'sealgate-stdiod' (Get-ServerAddArgs $script:SERVER_NAME); return }

    $suffix = Get-StdiodUidSuffix
    $alt = ''
    if ($suffix) { $alt = "$($script:SERVER_NAME)-$suffix" }

    if (Test-ServerRegistered $script:SERVER_NAME) {
        Ok "server '$($script:SERVER_NAME)' is already approved and bound to this device"
        return
    }
    if ($alt -and (Test-ServerRegistered $alt)) {
        $script:SERVER_NAME = $alt
        Ok "server '$($script:SERVER_NAME)' is already approved and bound to this device"
        return
    }

    $tried = $script:SERVER_NAME
    $out = Invoke-Native 'sealgate-stdiod' (Get-ServerAddArgs $tried)
    $rc = $script:LastRc
    if ($out) { foreach ($l in ($out -split "`n")) { if ($l.Trim()) { Log $l } } }

    if ($rc -ne 0 -and (Test-NameTaken $out) -and $alt) {
        Warn "'$tried' is already taken on this backend; retrying as '$alt'"
        $tried = $alt
        $out = Invoke-Native 'sealgate-stdiod' (Get-ServerAddArgs $tried)
        $rc = $script:LastRc
        if ($out) { foreach ($l in ($out -split "`n")) { if ($l.Trim()) { Log $l } } }
    }

    if ($rc -ne 0) {
        if (Test-NameTaken $out) {
            Ok "a request for '$tried' already exists on the backend"
            Info 'approve it in the dashboard if it is still pending'
            Info "if that request predates this script version its command may be stale; run 'sealgate-stdiod server remove $tried' and re-run install to resubmit"
            return
        }
        Die "sealgate-stdiod server add failed for '$tried'" "check 'sealgate-stdiod status' shows the daemon connected, then re-run: $($script:RERUN) install"
    }
    $script:SERVER_NAME = $tried
    if (Test-AutoApproved $out) {
        Ok "'$($script:SERVER_NAME)' (npx $($script:MCP_PKG)) is registered; no dashboard approval needed"
        Info "Beeper is wired up. To check the daemon's connection, run 'sealgate-stdiod status'."
    } else {
        Ok "submitted '$($script:SERVER_NAME)' (npx $($script:MCP_PKG)) for approval"
        Todo "approve '$($script:SERVER_NAME)' as an admin: $($script:SG_BACKEND -replace '/+$', '')  ->  Servers page (pending requests), or Overview"
        Info "a 'not verified' badge before the first successful spawn is expected and does not block approval"
    }
}

# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------
function Write-Result {
    $mcpUrl = "$($script:SG_BACKEND -replace '/+$', '')/mcp"
    if ($script:JSON) {
        $obj = [ordered]@{ mcp_url = $mcpUrl; server = $script:SERVER_NAME; device_label = $script:DEVICE_LABEL; mcp_pkg = $script:MCP_PKG }
        Write-Output (ConvertTo-Json -InputObject $obj -Compress)
        return
    }
    Write-Output "mcp_url: $mcpUrl"
    Write-Output "server:  $($script:SERVER_NAME) (gateway prefix: $($script:SERVER_NAME)_*)"
    Write-Output "device:  $($script:DEVICE_LABEL) (display label)"
    if ($script:SG_API_KEY) {
        Write-Output ''
        Write-Output '# add to Claude Code (gateway auth uses your SealGate API key):'
        Write-Output "claude mcp add sealgate $mcpUrl -t http -H ""Authorization: Bearer $($script:SG_API_KEY)"" -s user"
    } else {
        Write-Output ''
        Write-Output '# the AI client authenticates to the gateway with your SealGate API key or OAuth;'
        Write-Output '# pass --sg-api-key to print a ready-to-run claude-mcp-add snippet.'
    }
}

# ===========================================================================
# Subcommands
# ===========================================================================
function Invoke-CmdInstall {
    # Assume yes for this command only, unless --yes or --interactive spoke.
    if (-not $script:YES_SET) { $script:ASSUME_YES = $true }
    Ensure-Deps
    Ensure-BeeperDesktop
    Ensure-StdiodAuth
    Ensure-StdiodSupervised

    if ($script:DRY_RUN) {
        Submit-BeeperServer
        Invoke-PrimeOauthGrant
    } elseif (-not $script:STDIOD_CONNECTED) {
        Warn "not registering the '$($script:SERVER_NAME)' server: the daemon has not registered its device yet"
        Todo "check 'sealgate-stdiod status', then re-run: $($script:RERUN) install"
    } elseif (-not $script:BEEPER_READY) {
        Warn "not registering the '$($script:SERVER_NAME)' server: Beeper is not reachable yet"
        Todo "sign in to Beeper with MCP enabled, then re-run: $($script:RERUN) install"
    } else {
        Submit-BeeperServer
        if ($script:NO_PREAUTH) {
            Info "skipping OAuth priming (--no-preauth); the grant prompt appears at the child's first spawn, or run: $($script:RERUN) preauth"
        } else {
            Invoke-PrimeOauthGrant
        }
    }
    Write-Diag ''
    Write-Diag '== SealGate side wired ==' 'Green'
    Log "remaining human steps are printed above as 'action:' lines."
    Write-Result
}

function Invoke-CmdDoctor {
    Step 'Doctor'
    $allgood = $true
    foreach ($c in @('npx.cmd', 'sealgate-stdiod')) {
        if (Test-Command $c) { Ok $c } else { Warn "$c missing"; $allgood = $false }
    }
    if (Get-BeeperApiBase) { Ok 'Beeper Client API reachable' } else { Warn 'Beeper Client API not reachable (start Beeper Desktop with MCP enabled)'; $allgood = $false }
    $cred = Get-StdiodCredentialState
    $fix = "$($script:RERUN) install --install-deps"
    switch ($cred) {
        'live' { Ok 'device authorized to SealGate' }
        'dead' {
            Warn 'SealGate credential expired or revoked (backend returned 401)'
            Todo "re-authorize this device: $($script:RERUN) install --relogin"
            $fix = "$($script:RERUN) install --relogin"; $allgood = $false
        }
        'unknown' { Warn 'could not verify the SealGate credential (backend unreachable)'; $allgood = $false }
        default { Warn "not authorized (run: $($script:RERUN) install)"; $allgood = $false }
    }
    if (-not (Test-Command 'sealgate-stdiod')) {
        Warn 'cannot check the daemon: sealgate-stdiod is not installed'; $allgood = $false
    } else {
        # status exit codes: 0 running, 3 installed-but-not-running, 4 not installed.
        $null = Invoke-Native 'sealgate-stdiod' @('status')
        switch ($script:LastRc) {
            0 { Ok 'stdiod daemon running' }
            3 { Warn 'Scheduled Task installed but the daemon is not running'; Todo 'check why it exited: sealgate-stdiod logs --follow'; $allgood = $false }
            4 { Warn "no Scheduled Task installed (run: $($script:RERUN) install)"; $allgood = $false }
            default { Warn "sealgate-stdiod status failed (exit $($script:LastRc))"; $allgood = $false }
        }
    }
    if ($cred -eq 'live') {
        if (Test-ServerRegistered $script:SERVER_NAME) { Ok "server '$($script:SERVER_NAME)' approved on this device" }
        else { Warn "server '$($script:SERVER_NAME)' is not bound to this device yet (run '$($script:RERUN) install'; approve in the dashboard if submissions are queued)" }
    } else {
        Info "skipped the '$($script:SERVER_NAME)' server check: it needs a working credential"
    }
    if ($allgood) { Ok 'core checks passed' } else { Die 'some checks failed (see above)' $fix }
}

# tags: list the releases a daemon exe can be pulled from, marking which carry
# an asset for this machine. Rows are DATA (pipeline); headings go to the host.
function Invoke-CmdTags {
    $pair = Get-StdiodReleaseAsset
    if ($null -eq $pair) { Die "no prebuilt sealgate-stdiod exists for this architecture ($env:PROCESSOR_ARCHITECTURE)" 'build with cargo from a checkout of crates/stdiod instead' }
    Step "Releases on $($script:STDIOD_REPO) carrying $($pair.Asset)"
    $rels = $null
    try { $rels = Invoke-RestMethod -Uri "https://api.github.com/repos/$($script:STDIOD_REPO)/releases?per_page=100" -UseBasicParsing -TimeoutSec 20 }
    catch { Die 'could not reach the GitHub API' "check connectivity, or browse https://github.com/$($script:STDIOD_REPO)/releases" }
    Write-Diag ('{0,-24} {1,-8} {2}' -f 'TAG', 'CHANNEL', 'DAEMON')
    $rows = @($rels | Where-Object { -not $_.draft } | Sort-Object { Get-TagSortKey ([string]$_.tag_name) } -Descending)
    foreach ($r in $rows) {
        $channel = if ($r.prerelease) { 'demo' } else { 'stable' }
        $has = 'no'
        foreach ($a in @($r.assets)) { if ($a.name -eq $pair.Asset) { $has = 'yes'; break } }
        Write-Output ('{0,-24} {1,-8} {2}' -f [string]$r.tag_name, $channel, $has)
    }
    Log ''
    Info "install from one:   $($script:RERUN) install --install-deps --stdiod-tag <tag>"
    Info "newest stable:      $($script:RERUN) install --install-deps            (or --release)"
    Info "newest demo build:  $($script:RERUN) install --install-deps --demo     (or --stdiod-prerelease)"
}

function Invoke-CmdStatus {
    if (-not (Test-Command 'sealgate-stdiod')) { Die "required command 'sealgate-stdiod' not found" "run: $($script:RERUN) install" }
    $null = Invoke-Live 'sealgate-stdiod' @('status')
    $base = Get-BeeperApiBase
    if ($base) { Ok "Beeper Client API: $base" } else { Warn 'Beeper Client API not reachable (Beeper Desktop with MCP enabled)' }
}

function Invoke-CmdPreauth {
    if (-not $script:DRY_RUN -and -not (Get-BeeperApiBase)) {
        Die 'the Beeper Client API is not reachable on 23373-23378' "start Beeper Desktop with MCP enabled, then re-run: $($script:RERUN) preauth"
    }
    Invoke-PrimeOauthGrant
}

function Invoke-CmdUninstall {
    if (-not (Confirm-Action "withdraw the '$($script:SERVER_NAME)' request/server and remove the stdiod Scheduled Task?")) { Die 'aborted' '' }
    if (Test-Command 'sealgate-stdiod') {
        $null = Invoke-Live 'sealgate-stdiod' @('server', 'remove', $script:SERVER_NAME)
        $null = Invoke-Live 'sealgate-stdiod' @('uninstall')
    }
    Log 'uninstall complete. Approved-server removal may need a dashboard/admin action; Beeper Desktop was left untouched.'
}

# ===========================================================================
# Help
# ===========================================================================
function Show-Usage {
    $p = $script:PROG
    Log @"
$p - wire Beeper into the SealGate MCP gateway (Windows)

Beeper only serves MCP from the Desktop app, so this automates the SealGate side
and prints the exact human steps Beeper and the dashboard still require. Same
commands and flags as install-beeper.sh (macOS/Linux).

Usage:
  powershell -ExecutionPolicy Bypass -Command "irm $($script:SCRIPT_URL) | iex"
      (no command runs 'install' with the defaults)
  & ([scriptblock]::Create((irm $($script:SCRIPT_URL)))) [command] [flags]
  $p [command] [flags]        (from a saved copy)

Commands:
  install     Deps, Beeper check, device auth, supervise daemon, submit Beeper server, prime OAuth
  doctor      Check prerequisites and current state (read-only)
  status      Show stdiod daemon + Beeper Client API status
  tags        List releases the sealgate-stdiod exe can be pulled from
  preauth     Prime the Beeper OAuth grant (approve once in Beeper)
  mcp-url     Print the SealGate MCP URL and client snippet
  uninstall   Withdraw the server and remove the Scheduled Task

Common flags (also settable as UPPER_SNAKE env vars, which is how the plain
one-liner takes options):
  --sg-backend URL     SealGate backend        (SG_BACKEND, default $($script:SG_BACKEND))
  --demo               Shortcut for --sg-backend https://demo-dashboard.sealgate.ai (main deploy).
                       Also selects the DEMO daemon build (newest v*-beta.N).
  --release            Shortcut for --sg-backend https://dashboard.sealgate.ai (the default).
                       Also selects the STABLE daemon build.
  --sg-api-key KEY     SealGate API key for the client snippet only (SG_API_KEY)
  --server-name NAME   Tunnel server name, and the gateway tool prefix (SERVER_NAME, default beeper)
  --device-label TEXT  Label for this script's own output only (DEVICE_LABEL, default this PC's name)
  --oauth-wait SECS    How long to wait for the Beeper OAuth approval (OAUTH_WAIT, default $($script:OAUTH_WAIT))
  --beeper-wait SECS   After opening Beeper, how long to wait for its client API (BEEPER_WAIT, default $($script:BEEPER_WAIT))
  --no-preauth         Skip OAuth priming during install (prompt then fires at first spawn)
  --no-open            Headless device auth: print the approval URL, do not open a browser
  --relogin            Force a fresh device authorization even if already authorized
  --new-device         Register as a NEW device instead of re-binding this machine's record. Implies --relogin.
  --no-install-deps    Do not install missing deps; print the manual step instead.
  --interactive        Prompt before each action instead of assuming yes. Needs a terminal.
  --install-deps       On by default. Auto-install missing deps: node/npx (official
                       Node.js zip into %LOCALAPPDATA%\Programs\sealgate-stdiod\runtimes\node,
                       no admin), sealgate-stdiod (prebuilt release exe, sha256 verified),
                       and Beeper Desktop via 'winget install --id Beeper.Beeper'.
  --node-version VER   Pin the Node.js build, e.g. v24.20.0 (NODE_VERSION, default: newest LTS)
  --stdiod-tag TAG     Pin the release the sealgate-stdiod exe comes from (STDIOD_TAG;
                       STDIOD_REPO overrides the repo, default $($script:STDIOD_REPO))
  --stdiod-prerelease  Force the DEMO daemon channel (STDIOD_PRERELEASE=1)
  --stdiod-release     Force the STABLE daemon channel (STDIOD_PRERELEASE=0)
  --dry-run            Print what would run; change nothing
  --yes                Skip confirmations. 'install' already does; 'uninstall' needs this (or --interactive).
  --json               Machine-readable output where supported
  --no-color           Disable colored output (also honors NO_COLOR)
  --verbose            Debug logging
  -h, --help           This help

Examples:
  # Agent-friendly: install deps and wire the SealGate side, headless device auth
  & ([scriptblock]::Create((irm $($script:SCRIPT_URL)))) install --yes --no-open --demo

  # Preview without changing anything
  & ([scriptblock]::Create((irm $($script:SCRIPT_URL)))) install --dry-run

  # Re-run the one-time Beeper OAuth approval (e.g. after enabling MCP later)
  & ([scriptblock]::Create((irm $($script:SCRIPT_URL)))) preauth

Exit codes: 0 ok, 1 error (message + fix printed).
"@
}

function Show-SubcommandHelp([string]$Cmd) {
    switch ($Cmd) {
        'install' { Log 'install - wire the SealGate side and print remaining human steps. Idempotent; safe to re-run.'; Log '  optional: --sg-backend, --no-open, --install-deps, --yes, --dry-run, --no-preauth, --oauth-wait, --stdiod-tag <tag>' }
        'preauth' { Log "preauth - drive one MCP handshake through 'npx $($script:MCP_PKG)' so Beeper raises its approve/deny prompt and caches the OAuth grant. Idempotent; optional --oauth-wait." }
        'mcp-url' { Log 'mcp-url - print the gateway URL + client snippet. pass --sg-api-key for a ready-to-run snippet. supports --json.' }
        'status' { Log 'status - show stdiod daemon + Beeper Client API status.' }
        'doctor' { Log 'doctor - verify prerequisites and current state (read-only).' }
        'uninstall' { Log 'uninstall - withdraw the server and remove the Scheduled Task. pass --yes to skip the prompt.' }
        'tags' { Log 'tags - list releases a sealgate-stdiod exe can come from, and whether each carries one for this machine. Feed a tag to --stdiod-tag.' }
        default { Show-Usage }
    }
}

# ===========================================================================
# Dispatch
# ===========================================================================
function Invoke-Main([string[]]$Argv) {
    $cmd = ''
    $rest = @()
    if ($Argv.Count -gt 0 -and -not $Argv[0].StartsWith('-')) {
        $cmd = $Argv[0]
        if ($Argv.Count -gt 1) { $rest = $Argv[1..($Argv.Count - 1)] }
    } else {
        $rest = $Argv
    }
    if (Parse-Flags $rest) { Initialize-Colors; Show-SubcommandHelp $cmd; return }
    Initialize-Colors
    # An exe this script installed may not be on the user's PATH yet.
    if ((Test-Path $script:STDIOD_EXE) -and -not (Test-Command 'sealgate-stdiod')) { $env:Path = "$($script:INSTALL_DIR);$env:Path" }
    if ((Test-Path (Join-Path $script:NODE_DIR 'npx.cmd')) -and -not (Test-Command 'npx.cmd')) { $env:Path = "$($script:NODE_DIR);$env:Path" }
    if ($script:POSITIONAL.Count -gt 0) { Die "unexpected argument: $($script:POSITIONAL[0])" "run '$($script:PROG) --help' for usage" }
    Resolve-Backend
    Resolve-StdiodChannel
    switch ($cmd) {
        'install' { Invoke-CmdInstall }
        'doctor' { Invoke-CmdDoctor }
        'status' { Invoke-CmdStatus }
        'preauth' { Invoke-CmdPreauth }
        'mcp-url' { Write-Result }
        'uninstall' { Invoke-CmdUninstall }
        'tags' { Invoke-CmdTags }
        '' { Invoke-CmdInstall }
        'help' { Show-Usage }
        default { Die "unknown command: $cmd" "run '$($script:PROG) --help' for the command list" }
    }
}

# True when this process exists only to run this script (the one-liner or a
# saved copy run by path), so ending it with an exit code is right. In an
# interactive session, including a -NoExit one such as the VS Code terminal,
# 'exit' would close the user's window, so a terminating error is raised
# instead.
function Test-OneShotHost {
    if ($PSCommandPath) { return $true }
    try {
        $cl = @([Environment]::GetCommandLineArgs())
        foreach ($a in $cl) { if ($a -match '^[-/](noexit|i|interactive)$') { return $false } }
        foreach ($a in $cl) { if ($a -match '^[-/](c|command|ec|encodedcommand|f|file)$') { return $true } }
    } catch {}
    return $false
}

$script:ExitCode = 0
$script:ARGV = @()
if ($Arguments) { $script:ARGV = @($Arguments | Where-Object { $null -ne $_ }) }
try {
    Invoke-Main $script:ARGV
} catch {
    $msg = $_.Exception.Message
    if ($msg.StartsWith($script:DIE_MARK)) {
        Write-Diag "x error: $($msg.Substring($script:DIE_MARK.Length))" 'Red'
        if ($script:DIE_FIX) { Write-Diag "     fix: $($script:DIE_FIX)" 'Cyan' }
        $script:ExitCode = $script:DIE_CODE
    } else {
        Write-Diag "x error: $msg" 'Red'
        if ($script:VERBOSE_LOG) { Write-Diag ($_.ScriptStackTrace) 'DarkGray' }
        $script:ExitCode = 1
    }
}
if ($script:ExitCode -ne 0) {
    if (Test-OneShotHost) { exit $script:ExitCode }
    throw "$($script:PROG) failed (exit $($script:ExitCode)); see the error above"
}
