# Run the Windows App Certification Kit (WACK) on a built OUTARCH package:
# the same automated checks Partner Center runs during certification.
#
# Needs an elevated PowerShell (WACK refuses to run otherwise):
#   powershell -ExecutionPolicy Bypass -File scripts\msix\run-wack.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\msix\run-wack.ps1 -Package out\msix\store\OUTARCH_2.19.0.0_x64.msix
#
# The report lands next to the package as wack-report.xml. WACK installs the
# package while it tests, so test a signed package or run it in Developer Mode.

param([string]$Package)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this from an elevated PowerShell (Run as administrator).'
}
$appcert = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\App Certification Kit\appcert.exe'
if (-not (Test-Path -LiteralPath $appcert)) { throw 'The Windows App Certification Kit is not installed (it ships with the Windows 11 SDK).' }

if (-not $Package) {
  foreach ($mode in 'store', 'test') {
    $candidate = Get-ChildItem -LiteralPath (Join-Path $root "out\msix\$mode") -Filter 'OUTARCH_*_x64.msix' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($candidate) { $Package = $candidate.FullName; break }
  }
  if (-not $Package) { throw 'No package in out\msix. Build one first (npm run package:store).' }
}
$Package = (Resolve-Path -LiteralPath $Package).Path
$report = Join-Path (Split-Path -Parent $Package) 'wack-report.xml'
if (Test-Path -LiteralPath $report) { Remove-Item -LiteralPath $report -Force }

Write-Host "WACK: $Package"
& $appcert reset | Out-Null
& $appcert test -appxpackagepath $Package -reportoutputpath $report
if (-not (Test-Path -LiteralPath $report)) { throw "WACK did not write a report (exit $LASTEXITCODE)." }
[xml]$xml = Get-Content -LiteralPath $report
$overall = $xml.REPORT.OVERALL_RESULT
Write-Host ''
Write-Host "Overall result: $overall"
foreach ($test in $xml.SelectNodes('//TEST')) {
  if ($test.RESULT.'#cdata-section' -and $test.RESULT.'#cdata-section' -ne 'PASS') {
    Write-Host ("  {0}: {1}" -f $test.NAME, $test.RESULT.'#cdata-section')
  }
}
Write-Host "Report: $report"
