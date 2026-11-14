#Requires -Version 5.1

# Embedded firewall setup for the NSIS installer.
#   -Mode check : exits 0 when both rules already point at -ExePath (no elevation needed).
#   -Mode apply : elevated, rewrites the rules and writes -DonePath as its completion marker.
# The installer extracts this file into $PLUGINSDIR and deletes it afterwards, so
# no script is left next to the application and no console window is shown.

[CmdletBinding()]
param(
    [ValidateSet('check', 'apply')]
    [string]$Mode = 'check',

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$ExePath,

    [string]$DonePath,
    [string]$LogPath
)

$ErrorActionPreference = 'Stop'

$RuleHttp = 'Filebridge-Lan'
$RuleDiscovery = 'Filebridge-Lan Discovery'

function Write-Diag {
    param([string]$Message)

    if (-not $LogPath) { return }
    try {
        $dir = Split-Path -Parent $LogPath
        if ($dir -and -not (Test-Path -LiteralPath $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
        $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz'), $Mode, $Message
        Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
    } catch {
        # Diagnostics never break the install.
    }
}

function Set-Marker {
    param([string]$Value)

    if (-not $DonePath) { return }
    try {
        Set-Content -LiteralPath $DonePath -Value $Value -Encoding ASCII
    } catch {
        # The installer treats a missing marker as a timeout and continues.
    }
}

function Test-FirewallRule {
    param(
        [Parameter(Mandatory = $true)][string]$DisplayName,
        [Parameter(Mandatory = $true)][string]$Protocol,
        [Parameter(Mandatory = $true)][string]$LocalPort
    )

    $rules = @(Get-NetFirewallRule -DisplayName $DisplayName -ErrorAction SilentlyContinue)
    if ($rules.Count -ne 1) { return $false }

    $rule = $rules[0]
    if ([string]$rule.Direction -ne 'Inbound') { return $false }
    if ([string]$rule.Action -ne 'Allow') { return $false }
    if (([string]$rule.Profile -replace '\s', '') -ne 'Domain,Private') { return $false }

    $portFilter = $rule | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue
    if (-not $portFilter) { return $false }
    if (([string]$portFilter.Protocol).ToUpperInvariant() -ne $Protocol.ToUpperInvariant()) { return $false }
    if ([string]$portFilter.LocalPort -ne $LocalPort) { return $false }

    $appFilter = $rule | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue
    if (-not $appFilter -or -not $appFilter.Program) { return $false }
    return [IO.Path]::GetFullPath([string]$appFilter.Program).Equals(
        [IO.Path]::GetFullPath($ExePath),
        [StringComparison]::OrdinalIgnoreCase
    )
}

try {
    $resolvedExe = [IO.Path]::GetFullPath($ExePath)
    if ([IO.Path]::GetFileName($resolvedExe) -ne 'filebridge-lan.exe') {
        throw "ExePath 必须指向 filebridge-lan.exe：$resolvedExe"
    }

    $ready = (Test-FirewallRule -DisplayName $RuleHttp -Protocol 'TCP' -LocalPort '42080') -and
        (Test-FirewallRule -DisplayName $RuleDiscovery -Protocol 'UDP' -LocalPort '42081')

    if ($Mode -eq 'check') {
        if ($ready) { exit 0 } else { exit 1 }
    }

    if ($ready) {
        Write-Diag 'rules already configured, nothing to do'
        Set-Marker 'ok'
        exit 0
    }

    if (-not (Test-Path -LiteralPath $resolvedExe -PathType Leaf)) {
        throw "安装后的程序不存在：$resolvedExe"
    }

    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw '配置 Windows 防火墙需要管理员权限'
    }

    Write-Diag "开始配置防火墙，程序：$resolvedExe"

    # Drop stale rules by name (including the legacy display name) and every rule
    # that is bound to this exact program, whatever profile/protocol it carries.
    foreach ($name in @($RuleHttp, $RuleDiscovery, 'filebridge-lan.exe')) {
        @(Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue) |
            Where-Object { $_ } |
            Remove-NetFirewallRule -ErrorAction SilentlyContinue
    }

    $programFilters = @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Program -and
            [IO.Path]::GetFullPath([string]$_.Program).Equals(
                $resolvedExe,
                [StringComparison]::OrdinalIgnoreCase
            )
        })
    foreach ($filter in $programFilters) {
        $filter | Get-NetFirewallRule -ErrorAction SilentlyContinue |
            Remove-NetFirewallRule -ErrorAction SilentlyContinue
    }

    New-NetFirewallRule `
        -DisplayName $RuleHttp `
        -Description 'Filebridge-Lan HTTP Hub' `
        -Direction Inbound `
        -Program $resolvedExe `
        -Action Allow `
        -Protocol TCP `
        -LocalPort 42080 `
        -Profile Domain,Private | Out-Null

    New-NetFirewallRule `
        -DisplayName $RuleDiscovery `
        -Description 'Filebridge-Lan LAN peer discovery' `
        -Direction Inbound `
        -Program $resolvedExe `
        -Action Allow `
        -Protocol UDP `
        -LocalPort 42081 `
        -Profile Domain,Private | Out-Null

    $ready = (Test-FirewallRule -DisplayName $RuleHttp -Protocol 'TCP' -LocalPort '42080') -and
        (Test-FirewallRule -DisplayName $RuleDiscovery -Protocol 'UDP' -LocalPort '42081')
    if (-not $ready) { throw '写入后校验失败' }

    Write-Diag '防火墙配置成功：TCP 42080、UDP 42081，Domain/Private，Allow'
    Set-Marker 'ok'
    exit 0
} catch {
    $message = '防火墙配置失败：' + $_.Exception.Message
    Write-Diag $message
    Set-Marker 'fail'
    exit 1
}
