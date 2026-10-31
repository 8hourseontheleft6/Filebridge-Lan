$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$hookPath = Join-Path $root 'src-tauri/nsis/firewall.nsh'
$installScript = Join-Path $root 'src-tauri/nsis/install-firewall.ps1'
$failures = New-Object System.Collections.Generic.List[string]

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) {
        $failures.Add($Message)
    }
}

Assert-True (Test-Path -LiteralPath $hookPath) "missing $hookPath"
Assert-True (Test-Path -LiteralPath $installScript) "missing $installScript"

$hook = Get-Content -LiteralPath $hookPath -Raw
$script = Get-Content -LiteralPath $installScript -Raw

Assert-True ($hook -notmatch '(?i)-Command') 'NSIS hook still uses -Command'
Assert-True ($hook -notmatch '(?i)-Protocol\s+Any') 'NSIS hook still uses -Protocol Any'
Assert-True ($hook -notmatch '(?i)-Profile\s+Any') 'NSIS hook still uses -Profile Any'
Assert-True ($hook -notmatch '(?i)LocalPort\s+4(?:\s|$)') 'NSIS hook still references port 4'
Assert-True ($hook -notmatch '(?i)Any\s*,') 'NSIS hook still has Any profile/port'

$filePattern = [regex]::Escape('File "/oname=install-firewall.ps1" "${__FILEDIR__}\..\..\..\..\nsis\install-firewall.ps1"')
Assert-True ($hook -match $filePattern) 'NSIS hook does not install install-firewall.ps1 beside the executable'

$scriptArg = [regex]::Escape('-File $\"$INSTDIR\install-firewall.ps1$\"')
$exeArg = [regex]::Escape('-ExePath $\"$INSTDIR\filebridge-lan.exe$\"')
Assert-True ($hook -match $scriptArg) 'NSIS hook does not pass the script path via quoted -File'
Assert-True ($hook -match $exeArg) 'NSIS hook does not pass the installed exe path via quoted -ExePath'

Assert-True ($script -match '\[Parameter\(Mandatory\s*=\s*\$true\)\]') 'firewall script has no mandatory ExePath parameter'
Assert-True ($script -match '(?i)-LocalPort\s+42080') 'firewall script missing TCP 42080'
Assert-True ($script -match '(?i)-LocalPort\s+42081') 'firewall script missing UDP 42081'
Assert-True ($script -match '(?i)-Profile\s+Domain,Private') 'firewall script does not force Domain,Private'
Assert-True ($script -match '(?i)-Protocol\s+TCP') 'firewall script missing TCP protocol'
Assert-True ($script -match '(?i)-Protocol\s+UDP') 'firewall script missing UDP protocol'
Assert-True ($script -match 'Assert-FirewallRule') 'firewall script has no post-create validation'
Assert-True ($script -notmatch '(?i)Disable-WindowsOptionalFeature|Set-MpPreference|Add-MpPreference') 'firewall script touches Defender'

# Simulate the exact path forms that broke the previous installer. The script
# exits before admin/firewall work when -VerifyOnly is used.
$tempDir = Join-Path $env:TEMP ('filebridge firewall $test ' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
try {
    $copiedScript = Join-Path $tempDir 'install firewall $test.ps1'
    Copy-Item -LiteralPath $installScript -Destination $copiedScript -Force
    $fakeExe = Join-Path $tempDir 'Program Files $test/filebridge-lan.exe'
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $copiedScript -ExePath $fakeExe -VerifyOnly 2>&1
    $exitCode = $LASTEXITCODE
    $text = ($output | Out-String).Trim()
    Assert-True ($exitCode -eq 0) "verify-only invocation failed with exit code $exitCode`: $text"
    Assert-True ($text -match [regex]::Escape('VERIFY_ONLY_EXE=' + [IO.Path]::GetFullPath($fakeExe))) 'verify-only did not preserve spaced/$ exe path'
} finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}

if ($failures.Count -gt 0) {
    Write-Host 'FIREWALL_INSTALLER_TEST_FAILED'
    foreach ($failure in $failures) {
        Write-Host " - $failure"
    }
    exit 1
}

Write-Host 'FIREWALL_INSTALLER_TEST_OK'
