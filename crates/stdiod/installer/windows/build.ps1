#Requires -Version 5.1
<#
.SYNOPSIS
  Build "SealGate for Beeper" setup for one SealGate deployment.

.DESCRIPTION
  Stages both daemon builds and the official Node.js zip for each architecture
  (checksum-verified, as the install script does), then compiles
  SealGateBeeper.iss with Inno Setup 6.3+. One setup program per deployment:
  the backend is compiled in, because a downloaded .exe cannot tell where it
  came from.

.EXAMPLE
  ./build.ps1 -X64Exe sealgate-stdiod-x64.exe -Arm64Exe sealgate-stdiod-arm64.exe `
      -Backend https://beeper.sealgate.ai -Version 0.6.17
#>
param(
    [Parameter(Mandatory = $true)] [string] $X64Exe,
    [Parameter(Mandatory = $true)] [string] $Arm64Exe,
    [Parameter(Mandatory = $true)] [string] $Backend,
    [string] $Version = '0.0.0',
    [string] $OutputName = 'SealGate-Beeper-Setup',
    [string] $OutDir = (Join-Path $PSScriptRoot 'dist'),
    # Pin the bundled Node, e.g. v24.20.0 (default: newest LTS).
    [string] $NodeVersion = '',
    # Inno Setup's compiler, when it is not on PATH or in Program Files (for
    # example a wrapper that runs it under Wine).
    [string] $Iscc = '',
    # Adds a button that previews the sign-in page's versions without a real
    # sign-in; for trying the wizard, never for release.
    [switch] $DebugUi
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Get-NodeLts {
    $list = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing -TimeoutSec 30
    foreach ($rel in $list) { if ($rel.lts) { return [string]$rel.version } }
    throw 'no LTS release in the nodejs.org listing'
}

# Download node-<ver>-win-<arch>.zip, check it against SHASUMS256.txt, and
# unpack it to $Dest (node.exe, npm.cmd, npx.cmd at its root).
function Stage-Node([string]$Ver, [string]$Arch, [string]$Dest, [string]$Sums, [string]$Tmp) {
    $name = "node-$Ver-win-$Arch"
    $zip = Join-Path $Tmp "$name.zip"
    Invoke-WebRequest -Uri "https://nodejs.org/dist/$Ver/$name.zip" -OutFile $zip -UseBasicParsing -TimeoutSec 600
    $want = ''
    foreach ($line in ($Sums -split "`n")) {
        $parts = $line.Trim() -split '\s+'
        if ($parts.Count -eq 2 -and $parts[1] -eq "$name.zip") { $want = $parts[0].ToLower() }
    }
    $got = (Get-FileHash -Path $zip -Algorithm SHA256).Hash.ToLower()
    if (-not $want -or $want -ne $got) { throw "checksum mismatch for $name.zip (expected '$want', got '$got')" }
    Expand-Archive -Path $zip -DestinationPath $Tmp -Force
    $inner = Join-Path $Tmp $name
    if (-not (Test-Path (Join-Path $inner 'npx.cmd'))) { throw "unexpected layout: $name\npx.cmd missing" }
    Move-Item -Path $inner -Destination $Dest
}

function Find-Iscc {
    $cmd = Get-Command 'ISCC.exe' -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $roots = @(${env:ProgramFiles(x86)}, $env:ProgramFiles)
    if ($env:LOCALAPPDATA) { $roots += (Join-Path $env:LOCALAPPDATA 'Programs') }
    foreach ($root in $roots) {
        if (-not $root) { continue }
        $path = Join-Path $root 'Inno Setup 6\ISCC.exe'
        if (Test-Path $path) { return $path }
    }
    throw 'Inno Setup 6.3+ (ISCC.exe) not found; install it from https://jrsoftware.org/isdl.php'
}

foreach ($exe in @($X64Exe, $Arm64Exe)) { if (-not (Test-Path $exe)) { throw "not found: $exe" } }
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("sealgate-beeper-setup-" + [guid]::NewGuid().ToString('N'))
$stage = Join-Path $work 'stage'
try {
    if (-not $NodeVersion) { $NodeVersion = Get-NodeLts }
    Write-Host "Node.js $NodeVersion"
    $sums = [string](Invoke-WebRequest -Uri "https://nodejs.org/dist/$NodeVersion/SHASUMS256.txt" -UseBasicParsing -TimeoutSec 60).Content
    foreach ($pair in @(@('x64', $X64Exe), @('arm64', $Arm64Exe))) {
        $arch = $pair[0]
        $dir = Join-Path $stage $arch
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Copy-Item -Path $pair[1] -Destination (Join-Path $dir 'sealgate-stdiod.exe')
        $tmp = Join-Path $work "node-$arch"
        New-Item -ItemType Directory -Path $tmp -Force | Out-Null
        Stage-Node $NodeVersion $arch (Join-Path $dir 'node') $sums $tmp
        Write-Host "staged $arch"
    }
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
    $iscc = if ($Iscc) { $Iscc } else { Find-Iscc }
    $defines = @("/DBackend=$Backend", "/DAppVersion=$Version", "/DStage=$stage")
    if ($DebugUi) {
        $OutputName = "$OutputName-debug"
        $defines += '/DDebugUi=1'
    }
    $defines += "/DOutputName=$OutputName"
    & $iscc @defines "/O$OutDir" (Join-Path $PSScriptRoot 'SealGateBeeper.iss')
    if ($LASTEXITCODE -ne 0) { throw "ISCC failed (exit $LASTEXITCODE)" }
    Write-Host "built $(Join-Path $OutDir "$OutputName.exe")"
} finally {
    Remove-Item -Path $work -Recurse -Force -ErrorAction SilentlyContinue
}
