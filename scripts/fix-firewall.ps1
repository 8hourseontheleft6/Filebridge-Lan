#Requires -RunAsAdministrator
# Filebridge-Lan Windows firewall repair
# Usage (Administrator PowerShell):
#   powershell -ExecutionPolicy Bypass -File .\scripts\fix-firewall.ps1

$ErrorActionPreference = 'Stop'
$exe = Join-Path $env:LOCALAPPDATA 'Filebridge-Lan\filebridge-lan.exe'

if (-not (Test-Path $exe)) {
    throw "Filebridge-Lan executable not found: $exe"
}

Write-Host "Repairing Filebridge-Lan firewall rules..."
Write-Host "Program: $exe"

# Remove all existing rules for this program, including Block rules.
$filters = @(Get-NetFirewallApplicationFilter | Where-Object {
    $_.Program -and $_.Program.Equals($exe, [StringComparison]::OrdinalIgnoreCase)
})
foreach ($filter in $filters) {
    $filter | Get-NetFirewallRule -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
}

Get-NetFirewallRule -DisplayName 'Filebridge-Lan' -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue

New-NetFirewallRule `
    -DisplayName 'Filebridge-Lan' `
    -Description 'Filebridge-Lan LAN file transfer' `
    -Direction Inbound `
    -Program $exe `
    -Action Allow `
    -Protocol TCP `
    -Profile Private,Domain | Out-Null

Write-Host 'Done: Filebridge-Lan inbound is allowed on Private/Domain networks.'
Write-Host 'If the phone still cannot connect, set the Wi-Fi network to Private and disable AP isolation.'
