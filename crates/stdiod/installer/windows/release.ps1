#Requires -Version 7
<#
.SYNOPSIS
  Build "SealGate for Beeper" setup for each deployment and upload it to a release.

.DESCRIPTION
  The release workflows' beeper-setup job (desktop-release.yml for stable,
  desktop-release-demo.yml for demo). Downloads the two daemon exes the windows
  legs put on the draft, checks them against the checksums published with them,
  builds one setup program per backend with build.ps1 and uploads each as
  SealGate-Beeper-Setup-<host>.exe, the name edison-watch's
  /get_sealgate_for_beeper redirects to (src/api/installer_scripts.py).

  -Sign signs the setup program, its uninstaller and the bundled daemon with
  -SignCommand, an Inno Setup sign tool command in which $f is the file. It
  fails rather than build unsigned when -Sign is given without a command.
#>
param(
    [Parameter(Mandatory = $true)] [string] $Tag,
    [Parameter(Mandatory = $true)] [string] $Version,
    # Space-separated backend origins, one setup program each.
    [Parameter(Mandatory = $true)] [string] $Backends,
    [string] $Repo = $env:GITHUB_REPOSITORY,
    [switch] $Sign,
    [string] $SignCommand = ''
)

$ErrorActionPreference = 'Stop'

if ($Sign -and -not $SignCommand) {
    throw 'signing was requested but no sign command is set (repo variable WINDOWS_SIGN_COMMAND); run again with sign off to build unsigned'
}

$daemons = Join-Path $PSScriptRoot 'daemons'
gh release download $Tag --repo $Repo --dir $daemons --clobber `
    --pattern 'sealgate-stdiod-windows-*.exe' --pattern 'SHA256SUMS-windows-*'
if ($LASTEXITCODE -ne 0) { throw "could not download the daemon exes from $Tag" }
foreach ($arch in 'x64', 'arm64') {
    $want = ((Get-Content (Join-Path $daemons "SHA256SUMS-windows-$arch")).Trim() -split '\s+')[0]
    $got = (Get-FileHash (Join-Path $daemons "sealgate-stdiod-windows-$arch.exe") -Algorithm SHA256).Hash
    if ($got -ne $want) { throw "checksum mismatch for the $arch daemon" }
}

$dist = Join-Path $PSScriptRoot 'dist'
foreach ($backend in $Backends -split '\s+' | Where-Object { $_ }) {
    # Must match setup_exe_asset_url in edison-watch.
    $hostName = ($backend -replace '^https?://', '') -replace ':', '-'
    $name = "SealGate-Beeper-Setup-$hostName"
    $build = @{
        X64Exe     = Join-Path $daemons 'sealgate-stdiod-windows-x64.exe'
        Arm64Exe   = Join-Path $daemons 'sealgate-stdiod-windows-arm64.exe'
        Backend    = $backend
        Version    = $Version
        OutputName = $name
        OutDir     = $dist
    }
    if ($Sign) { $build.SignCommand = $SignCommand }
    & (Join-Path $PSScriptRoot 'build.ps1') @build
    $exe = Join-Path $dist "$name.exe"
    gh release upload $Tag --repo $Repo --clobber $exe
    if ($LASTEXITCODE -ne 0) { throw "could not upload $name.exe to $Tag" }
    Write-Host "uploaded $name.exe ($(if ($Sign) { 'signed' } else { 'unsigned' }))"
}
