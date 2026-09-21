$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
npm install
npm run windows:portable
$source = Join-Path (Get-Location) "release\SC2-UI-Workbench-Windows\*"
$zip = Join-Path (Get-Location) "release\SC2-UI-Workbench-Windows-x64.zip"
Compress-Archive -Path $source -DestinationPath $zip -Force
Write-Host "Created: $zip"
