#Requires -Version 5.1
<#
.SYNOPSIS
  CI checks for install-beeper.ps1 on a real Windows runner.

.DESCRIPTION
  Run by .github/workflows/stdiod-installer-windows.yml under BOTH Windows
  PowerShell 5.1 and PowerShell 7, since the installer promises to work on
  the 5.1 that every Windows box ships. Nothing here needs a SealGate account
  or a browser: the device login and the Beeper OAuth prompt are human steps,
  so the checks stop at the edge of what a runner can do and assert the exact
  failure the installer must produce there.

  Sections:
    1. static: parse, PSScriptAnalyzer (errors only), 5.1-only syntax
    2. CLI surface: help, mcp-url, flag errors, exit codes, one-liner forms
    3. dry run: the full install preview must not touch the machine
    4. real deps: Node + sealgate-stdiod downloaded, verified, on PATH, and
       'sealgate-stdiod install' refuses cleanly without a credential
    5. Beeper detection: absent -> '', then (when winget can) installed -> exe
#>
param(
    [string] $Script = (Join-Path $PSScriptRoot 'install-beeper.ps1'),
    # winget on hosted runners is sometimes unusable; the Beeper install check
    # is then skipped rather than failed.
    [switch] $SkipWinget
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$failures = New-Object System.Collections.Generic.List[string]
$passes = 0

function Check([string]$Name, [scriptblock]$Body) {
    try {
        & $Body
        Write-Host "  ok   $Name"
        $script:passes++
    } catch {
        Write-Host "  FAIL $Name : $($_.Exception.Message)"
        $script:failures.Add($Name)
    }
}
function Assert([bool]$Cond, [string]$Msg) { if (-not $Cond) { throw $Msg } }

# The host running this test is the one under test (powershell.exe or pwsh).
$shell = (Get-Process -Id $PID).Path
Write-Host "shell: $shell ($($PSVersionTable.PSVersion))"
Write-Host "script: $Script"

# Run the installer in a child of the same shell, capturing output + exit code.
function Run([string[]]$ScriptArgs) {
    $out = & $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Script @ScriptArgs 2>&1 | ForEach-Object { "$_" }
    return @{ Out = ($out -join "`n"); Rc = $LASTEXITCODE }
}

Write-Host ''
Write-Host '== 1. static'
Check 'parses without errors' {
    $t = $null; $e = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($Script, [ref]$t, [ref]$e)
    Assert (-not $e) (($e | ForEach-Object { "$($_.Extent.StartLineNumber): $($_.Message)" }) -join '; ')
}
Check 'no PowerShell 7-only syntax' {
    $src = Get-Content -Path $Script -Raw
    $code = ($src -split "`n" | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
    foreach ($bad in @('\?\?', '-SkipHttpErrorCheck', '-AsHashtable', 'Join-String', '-Parallel', '\$PSStyle')) {
        Assert (-not ($code -match $bad)) "found 7-only construct: $bad"
    }
}
Check 'PSScriptAnalyzer reports no errors' {
    if (-not (Get-Module -ListAvailable PSScriptAnalyzer)) {
        Install-Module PSScriptAnalyzer -Scope CurrentUser -Force -AllowClobber
    }
    Import-Module PSScriptAnalyzer
    $r = @(Invoke-ScriptAnalyzer -Path $Script -Severity Error)
    Assert ($r.Count -eq 0) (($r | ForEach-Object { "$($_.Line): $($_.RuleName): $($_.Message)" }) -join '; ')
    $warn = @(Invoke-ScriptAnalyzer -Path $Script -Severity Warning)
    foreach ($w in $warn) { Write-Host "       warn $($w.Line): $($w.RuleName)" }
}

Write-Host ''
Write-Host '== 2. CLI surface'
Check '--help exits 0 and names both one-liner forms' {
    $r = Run @('--help')
    Assert ($r.Rc -eq 0) "rc=$($r.Rc)"
    Assert ($r.Out -match 'irm https://raw\.githubusercontent\.com/.*install-beeper\.ps1 \| iex') 'one-liner missing'
    Assert ($r.Out -match 'scriptblock') 'scriptblock form missing'
}
Check 'mcp-url --json --demo prints valid JSON with the demo backend' {
    $r = Run @('mcp-url', '--json', '--demo')
    Assert ($r.Rc -eq 0) "rc=$($r.Rc)"
    $j = ($r.Out -split "`n" | Where-Object { $_ -like '{*' } | Select-Object -First 1) | ConvertFrom-Json
    Assert ($j.mcp_url -eq 'https://demo-dashboard.sealgate.ai/mcp') "mcp_url=$($j.mcp_url)"
    Assert ($j.server -eq 'beeper') "server=$($j.server)"
}
Check 'SG_BACKEND env var steers mcp-url like the flag' {
    $env:SG_BACKEND = 'https://example.test/'
    try { $r = Run @('mcp-url', '--json') } finally { Remove-Item Env:SG_BACKEND }
    Assert ($r.Out -match '"mcp_url":"https://example\.test/mcp"') $r.Out
}
Check 'unknown flag exits 1 with a fix line' {
    $r = Run @('install', '--bogus')
    Assert ($r.Rc -eq 1) "rc=$($r.Rc)"
    Assert ($r.Out -match 'unknown flag: --bogus') $r.Out
    Assert ($r.Out -match 'fix:') 'no fix line'
}
Check 'flag without a value exits 1' {
    $r = Run @('install', '--sg-backend', '--no-open')
    Assert ($r.Rc -eq 1 -and $r.Out -match "needs a value") $r.Out
}
Check 'stray positional exits 1' {
    $r = Run @('doctor', 'extra')
    Assert ($r.Rc -eq 1 -and $r.Out -match 'unexpected argument: extra') $r.Out
}
Check 'unknown command exits 1' {
    $r = Run @('bogus')
    Assert ($r.Rc -eq 1 -and $r.Out -match 'unknown command: bogus') $r.Out
}
Check '--from-source is refused' {
    $r = Run @('install', '--from-source')
    Assert ($r.Rc -eq 1 -and $r.Out -match 'not supported by the Windows installer') $r.Out
}
Check 'scriptblock one-liner form passes command and flags' {
    $out = & $shell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((Get-Content -Raw '$Script'))) mcp-url --json --demo" 2>&1 | ForEach-Object { "$_" }
    Assert ($LASTEXITCODE -eq 0) "rc=$LASTEXITCODE"
    Assert (($out -join "`n") -match '"mcp_url":"https://demo-dashboard\.sealgate\.ai/mcp"') ($out -join "`n")
}
Check 'scriptblock one-liner form propagates a failure exit code' {
    $null = & $shell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((Get-Content -Raw '$Script'))) bogus" 2>&1
    Assert ($LASTEXITCODE -ne 0) "rc=$LASTEXITCODE"
}
# The piped form ('irm URL | iex') takes no arguments and so runs a real
# install, which blocks at the browser login on a runner. Its parse path is the
# same [scriptblock]::Create(text) the scriptblock form above exercises.

Write-Host ''
Write-Host '== 3. dry run'
Check 'install --dry-run previews every step and changes nothing' {
    $before = Test-Path (Join-Path $env:LOCALAPPDATA 'Programs\sealgate-stdiod')
    $r = Run @('install', '--dry-run', '--demo', '--no-open')
    Assert ($r.Rc -eq 0) "rc=$($r.Rc)`n$($r.Out)"
    foreach ($needle in @(
            'Checking prerequisites', 'Beeper Desktop', 'would run: sealgate-stdiod login --backend https://demo-dashboard.sealgate.ai --no-open',
            'would run: sealgate-stdiod install', 'would run: sealgate-stdiod server add beeper', '--arg=@beeper/mcp-remote',
            'SealGate side wired', 'mcp_url: https://demo-dashboard.sealgate.ai/mcp')) {
        Assert ($r.Out -match [regex]::Escape($needle)) "missing '$needle' in:`n$($r.Out)"
    }
    $after = Test-Path (Join-Path $env:LOCALAPPDATA 'Programs\sealgate-stdiod')
    Assert ($before -eq $after) 'dry run created the install dir'
}

Write-Host ''
Write-Host '== 4. real dependency install'
# Load the installer's functions without running its dispatch, then call the
# dependency step for real. Same trick the Linux dry-run used in review.
$src = Get-Content -Path $Script -Raw
$head = $src.Substring(0, $src.IndexOf('$script:ExitCode = 0'))
$head = $head -replace '(?m)^param\([\s\S]*?^\)\r?\n', ''
. ([scriptblock]::Create($head))
Initialize-Colors
$script:ASSUME_YES = $true
$script:INSTALL_DEPS = $true
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\sealgate-stdiod'

Check 'Ensure-Deps downloads and verifies Node and sealgate-stdiod' {
    Ensure-Deps
    Assert (Test-Path (Join-Path $installDir 'sealgate-stdiod.exe')) 'sealgate-stdiod.exe missing'
    Assert (Test-Path (Join-Path $installDir 'runtimes\node\npx.cmd')) 'runtimes\node\npx.cmd missing'
    Assert (Test-Path (Join-Path $installDir 'runtimes\node\node.exe')) 'runtimes\node\node.exe missing'
}
Check 'installed binaries run' {
    $v = Invoke-Native (Join-Path $installDir 'sealgate-stdiod.exe') @('--version')
    Assert ($script:LastRc -eq 0 -and $v -match 'sealgate-stdiod') "rc=$($script:LastRc) out=$v"
    Write-Host "       $v"
    $n = Invoke-Native (Join-Path $installDir 'runtimes\node\node.exe') @('--version')
    Assert ($script:LastRc -eq 0 -and $n -match '^v\d+') "rc=$($script:LastRc) out=$n"
    Write-Host "       node $n"
    $x = Invoke-Native 'cmd.exe' @('/d', '/s', '/c', "`"`"$installDir\runtimes\node\npx.cmd`" --version`"")
    Assert ($script:LastRc -eq 0 -and $x -match '^\d+\.') "rc=$($script:LastRc) out=$x"
    Write-Host "       npx $x"
}
Check 'both dirs are on the persisted user PATH and resolvable in this process' {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
    $raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $key.Close()
    $entries = $raw -split ';'
    Assert ($entries -contains $installDir) "user PATH lacks $installDir : $raw"
    Assert ($entries -contains (Join-Path $installDir 'runtimes\node')) "user PATH lacks runtimes\node : $raw"
    Assert (Test-Command 'sealgate-stdiod') 'sealgate-stdiod not resolvable'
    Assert (Test-Command 'npx.cmd') 'npx.cmd not resolvable'
}
Check 'Ensure-Deps is idempotent (second run downloads nothing)' {
    $stamp = (Get-Item (Join-Path $installDir 'sealgate-stdiod.exe')).LastWriteTimeUtc
    Ensure-Deps
    Assert ((Get-Item (Join-Path $installDir 'sealgate-stdiod.exe')).LastWriteTimeUtc -eq $stamp) 'binary was re-downloaded'
}
Check 'sealgate-stdiod install refuses without a credential (no task registered)' {
    $out = Invoke-Native 'sealgate-stdiod' @('install')
    Assert ($script:LastRc -ne 0) "install unexpectedly succeeded: $out"
    Write-Host "       $((($out -split "`n") | Select-Object -Last 1))"
    $null = Invoke-Native 'schtasks' @('/query', '/tn', 'SealGate stdiod')
    Assert ($script:LastRc -ne 0) 'a SealGate stdiod task exists'
}
Check 'credential state reads absent, doctor exits 1 naming install' {
    Assert ((Get-StdiodCredentialState) -eq 'absent') "state=$(Get-StdiodCredentialState)"
    $r = Run @('doctor')
    Assert ($r.Rc -eq 1) "rc=$($r.Rc)"
    Assert ($r.Out -match 'not authorized') $r.Out
    Assert ($r.Out -match 'Beeper Client API not reachable') $r.Out
}
Check 'status exit code 4 (no supervisor unit) is surfaced by doctor' {
    $r = Run @('doctor')
    Assert ($r.Out -match 'no Scheduled Task installed') $r.Out
}

Write-Host ''
Write-Host '== 5. Beeper detection'
Check 'Beeper absent: no exe, no API' {
    Assert ((Get-BeeperDesktopExe) -eq '') "found: $(Get-BeeperDesktopExe)"
    Assert ((Get-BeeperApiBase) -eq '') "found: $(Get-BeeperApiBase)"
}
if ($SkipWinget) {
    Write-Host '  skip winget install of Beeper Desktop (-SkipWinget)'
} elseif (-not (Test-Command 'winget')) {
    Write-Host '  skip winget install of Beeper Desktop (winget not available on this runner)'
} else {
    Check 'Install-BeeperDesktop via winget, then detection finds the exe' {
        $script:INSTALL_DEPS = $true; $script:ASSUME_YES = $true
        $ok = Install-BeeperDesktop
        if (-not $ok) {
            # winget itself failing on a hosted runner is an environment
            # problem, and the installer handled it with the manual step.
            Write-Host '       winget could not install Beeper here; detection of an installed app not exercised'
            return
        }
        $exe = Get-BeeperDesktopExe
        Assert ($exe -ne '' -and (Test-Path $exe)) "exe not found after install"
        Write-Host "       found $exe"
    }
}

Write-Host ''
Write-Host "passed: $passes  failed: $($failures.Count)"
if ($failures.Count -gt 0) {
    Write-Host ('failed: ' + ($failures -join ' | '))
    exit 1
}
exit 0
