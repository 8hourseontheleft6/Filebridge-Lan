#Requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$ExePath,

    [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'

$logDir = Join-Path $env:LOCALAPPDATA 'Filebridge-Lan'
$logPath = Join-Path $logDir 'firewall-install.log'

function Write-Diag {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [ValidateSet('INFO', 'ERROR')][string]$Level = 'INFO'
    )

    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz'), $Level, $Message
    Write-Host $line
    try {
        if (-not (Test-Path -LiteralPath $logDir)) {
            New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        }
        Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
    } catch {
        # The console output remains the visible diagnostic if the log cannot be written.
    }
}

function Get-NormalizedProfile {
    param([Parameter(Mandatory = $true)][object]$Rule)
    return ([string]$Rule.Profile -replace '\s', '')
}

function Assert-FirewallRule {
    param(
        [Parameter(Mandatory = $true)][string]$DisplayName,
        [Parameter(Mandatory = $true)][string]$Protocol,
        [Parameter(Mandatory = $true)][string]$LocalPort
    )

    $rules = @(Get-NetFirewallRule -DisplayName $DisplayName -ErrorAction Stop)
    if ($rules.Count -ne 1) {
        throw "规则 '$DisplayName' 数量异常：$($rules.Count)，应为 1"
    }

    $rule = $rules[0]
    if ([string]$rule.Direction -ne 'Inbound') {
        throw "规则 '$DisplayName' Direction=$($rule.Direction)，应为 Inbound"
    }
    if ([string]$rule.Action -ne 'Allow') {
        throw "规则 '$DisplayName' Action=$($rule.Action)，应为 Allow"
    }
    $profile = Get-NormalizedProfile -Rule $rule
    if ($profile -ne 'Domain,Private') {
        throw "规则 '$DisplayName' Profile=$($rule.Profile)，应为 Domain,Private"
    }

    $portFilter = $rule | Get-NetFirewallPortFilter -ErrorAction Stop
    if (([string]$portFilter.Protocol).ToUpperInvariant() -ne $Protocol.ToUpperInvariant()) {
        throw "规则 '$DisplayName' Protocol=$($portFilter.Protocol)，应为 $Protocol"
    }
    if ([string]$portFilter.LocalPort -ne $LocalPort) {
        throw "规则 '$DisplayName' LocalPort=$($portFilter.LocalPort)，应为 $LocalPort"
    }

    $appFilter = $rule | Get-NetFirewallApplicationFilter -ErrorAction Stop
    if (-not $appFilter.Program) {
        throw "规则 '$DisplayName' 没有 Program"
    }
    if (-not [IO.Path]::GetFullPath([string]$appFilter.Program).Equals(
        [IO.Path]::GetFullPath($ExePath),
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "规则 '$DisplayName' Program=$($appFilter.Program)，不是 $ExePath"
    }
}

try {
    $resolvedExe = [IO.Path]::GetFullPath($ExePath)
    if ([IO.Path]::GetFileName($resolvedExe) -ne 'filebridge-lan.exe') {
        throw "ExePath 必须指向 filebridge-lan.exe：$resolvedExe"
    }

    # The installer test uses this path without touching the firewall.
    if ($VerifyOnly) {
        Write-Output "VERIFY_ONLY_EXE=$resolvedExe"
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

    # Remove stale/duplicate rules by display name, including the old malformed rule.
    foreach ($name in @('Filebridge-Lan', 'Filebridge-Lan Discovery', 'filebridge-lan.exe')) {
        @(Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue) |
            Where-Object { $_ } |
            Remove-NetFirewallRule -ErrorAction SilentlyContinue
    }

    # Remove every rule attached to this exact program, including Block rules and
    # any old Any-port/Any-profile rule created by a previous installer.
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
        -DisplayName 'Filebridge-Lan' `
        -Description 'Filebridge-Lan HTTP Hub' `
        -Direction Inbound `
        -Program $resolvedExe `
        -Action Allow `
        -Protocol TCP `
        -LocalPort 42080 `
        -Profile Domain,Private | Out-Null

    New-NetFirewallRule `
        -DisplayName 'Filebridge-Lan Discovery' `
        -Description 'Filebridge-Lan LAN peer discovery' `
        -Direction Inbound `
        -Program $resolvedExe `
        -Action Allow `
        -Protocol UDP `
        -LocalPort 42081 `
        -Profile Domain,Private | Out-Null

    Assert-FirewallRule -DisplayName 'Filebridge-Lan' -Protocol 'TCP' -LocalPort '42080'
    Assert-FirewallRule -DisplayName 'Filebridge-Lan Discovery' -Protocol 'UDP' -LocalPort '42081'

    Write-Diag '防火墙配置成功：TCP 42080、UDP 42081，Domain/Private，All Inbound Allow。'
    exit 0
} catch {
    $message = '防火墙配置失败：' + $_.Exception.Message
    Write-Diag $message -Level ERROR
    [Console]::Error.WriteLine($message)
    [Console]::Error.WriteLine("诊断日志：$logPath")
    exit 1
}
