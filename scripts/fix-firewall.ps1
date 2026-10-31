#Requires -RunAsAdministrator
# Filebridge-Lan Windows firewall repair (manual helper)
# Usage (Administrator PowerShell):
#   powershell -ExecutionPolicy Bypass -File .\scripts\fix-firewall.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\fix-firewall.ps1 -ExePath "C:\Path\filebridge-lan.exe"

[CmdletBinding()]
param(
    [string]$ExePath
)

$ErrorActionPreference = 'Stop'

if (-not $ExePath) {
    $ExePath = Join-Path $env:LOCALAPPDATA 'Filebridge-Lan\filebridge-lan.exe'
}

$installerScript = Join-Path $PSScriptRoot '..\src-tauri\nsis\install-firewall.ps1'
if (-not (Test-Path -LiteralPath $installerScript)) {
    throw "Firewall install script not found: $installerScript"
}

& $installerScript -ExePath $ExePath
exit $LASTEXITCODE
