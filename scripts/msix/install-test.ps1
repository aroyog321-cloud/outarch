# Install the local test build of the OUTARCH MSIX (npm run package:msix:test)
# on this PC, the way a Store install runs: with the package identity, the
# Start entry and the outarch:// link.
#
#   npm run package:msix:install-test                 install (replacing an earlier test install)
#   npm run package:msix:install-test -- -Launch      install and open it
#   npm run package:msix:install-test -- -Remove      uninstall it
#
# Windows never installs an unsigned package that contains a desktop program,
# so this unpacks the exact .msix that was built and registers its contents in
# Developer Mode (Settings > System > For developers), as Visual Studio does
# when it deploys a packaged app. No certificate and no administrator rights
# are needed. To install the .msix file itself, sign it with a trusted
# certificate instead (MICROSOFT_STORE.md, "Test the signed .msix").
# The Store build is never installed this way: the Store signs it.

param(
  [switch]$Remove,
  [switch]$Launch,
  [string]$Package
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$config = Get-Content -Raw -LiteralPath (Join-Path $root 'packaging\msix\store.config.json') | ConvertFrom-Json
$name = $config.identityName

$installed = Get-AppxPackage -Name $name -ErrorAction SilentlyContinue
if ($installed) {
  Write-Host "Removing the earlier install $($installed.PackageFullName)"
  Remove-AppxPackage -Package $installed.PackageFullName
}
if ($Remove) { Write-Host 'OUTARCH test package removed.'; exit 0 }

$unlock = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -ErrorAction SilentlyContinue
if (-not $unlock -or $unlock.AllowDevelopmentWithoutDevLicense -ne 1) {
  throw 'Developer Mode is off. Turn it on in Settings > System > For developers, then run this again.'
}

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
if (-not $Package) {
  $candidate = Get-ChildItem -LiteralPath (Join-Path $root 'out\msix\test') -Filter "OUTARCH_*_$arch.msix" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $candidate) { throw "No test package for $arch in out\msix\test. Run: npm run package:msix:test" }
  $Package = $candidate.FullName
}

$sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
$makeappx = Get-ChildItem -LiteralPath $sdk -Recurse -Filter makeappx.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.Directory.Name -eq 'x64' -or $_.Directory.Name -eq 'arm64' } |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) { throw 'makeappx.exe was not found. Install the Windows 11 SDK.' }

# A registered folder must outlive this script: it is where the app runs from.
$target = Join-Path $root "out\msix\installed-test\$arch"
if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
Write-Host "Unpacking $Package"
& $makeappx.FullName unpack /p $Package /d $target /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw "makeappx unpack failed ($LASTEXITCODE)" }

Write-Host 'Registering the package'
Add-AppxPackage -Register (Join-Path $target 'AppxManifest.xml') -ForceUpdateFromAnyVersion
$pkg = Get-AppxPackage -Name $name
if (-not $pkg) { throw 'The package did not register.' }
$manifest = Get-AppxPackageManifest -Package $pkg.PackageFullName
$appId = $manifest.Package.Applications.Application.Id
$aumid = "$($pkg.PackageFamilyName)!$appId"
Write-Host ''
Write-Host "Installed  $($pkg.PackageFullName)"
Write-Host "Location   $($pkg.InstallLocation)"
Write-Host "AUMID      $aumid"
Write-Host 'Open it from Start ("OUTARCH"), or run:'
Write-Host "  explorer.exe shell:AppsFolder\$aumid"
if ($Launch) { Start-Process explorer.exe "shell:AppsFolder\$aumid" }
