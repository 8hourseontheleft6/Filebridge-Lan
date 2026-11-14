#Requires -Version 5.1
<#
.SYNOPSIS
  Reclaim the local build output of Filebridge-Lan.

.DESCRIPTION
  By default this only lists what would be removed. Pass -Force to delete.
  Before target/ is removed, every installer in it is archived to release/
  so a published build never disappears with a clean.

.EXAMPLE
  pwsh -File scripts/clean.ps1            # dry run
  pwsh -File scripts/clean.ps1 -Force     # actually clean
#>
[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$archive = Join-Path $root 'release'

function Get-DirectorySize {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    $item = Get-Item -LiteralPath $Path
    if (-not $item.PSIsContainer) { return $item.Length }
    return (Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
}

function Format-Size {
    param([double]$Bytes)
    if ($Bytes -ge 1GB) { return ('{0:N2} GB' -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ('{0:N1} MB' -f ($Bytes / 1MB)) }
    return ('{0:N0} KB' -f ($Bytes / 1KB))
}

$paths = @(
    (Join-Path $root 'src-tauri\target'),
    (Join-Path $root 'dist'),
    (Join-Path $root 'screenshots'),
    (Join-Path $root '.filebridge-data'),
    (Join-Path $root '.filebridge-lan-data'),
    (Join-Path $root '.filebridge-bridge')
)

Get-ChildItem -LiteralPath $root -Filter '.tmp-*' -Force -ErrorAction SilentlyContinue |
    ForEach-Object { $paths += $_.FullName }

$total = 0
foreach ($path in $paths) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $size = Get-DirectorySize $path
    $total += $size
    Write-Output ('{0,-8} {1}' -f (Format-Size $size), $path.Replace($root + '\', ''))
}

Write-Output ''
Write-Output ('total {0}' -f (Format-Size $total))

if (-not $Force) {
    Write-Output 'dry run: nothing deleted. Re-run with -Force to remove the paths above.'
    exit 0
}

$nsis = Join-Path $root 'src-tauri\target\release\bundle\nsis'
if (Test-Path -LiteralPath $nsis) {
    if (-not (Test-Path -LiteralPath $archive)) { New-Item -ItemType Directory -Path $archive | Out-Null }
    Get-ChildItem -LiteralPath $nsis -Filter '*.exe' | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $archive $_.Name) -Force
        Write-Output ('archived {0}' -f $_.Name)
    }
}

foreach ($path in $paths) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    Remove-Item -LiteralPath $path -Recurse -Force
    Write-Output ('removed {0}' -f $path.Replace($root + '\', ''))
}

Write-Output ('freed {0}' -f (Format-Size $total))
