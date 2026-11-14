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

# The hook must never leave a script next to the app or launch a visible window.
Assert-True ($hook -notmatch '(?i)File\s+"/oname=install-firewall\.ps1"') 'hook still installs the script into $INSTDIR'
Assert-True ($hook -notmatch '(?i)-File\s+\$\"\$INSTDIR') 'hook still runs a script from $INSTDIR'
Assert-True ($hook -match [regex]::Escape('Delete "$INSTDIR\install-firewall.ps1"')) 'hook does not clean up the legacy installed script'
Assert-True ($hook -match [regex]::Escape('File "/oname=filebridge-firewall.ps1"')) 'hook does not embed the firewall script into the installer'
Assert-True ($hook -match [regex]::Escape('SetOutPath "$PLUGINSDIR"')) 'hook does not extract the script into $PLUGINSDIR'
Assert-True ($hook -match '(?i)findstr') 'hook has no native findstr probe'
Assert-True ($hook -match '(?i)netsh\s+advfirewall\s+firewall\s+show\s+rule') 'hook does not query the rules with netsh'
Assert-True ($hook -match '(?i)nsExec::ExecToStack') 'hook does not run the probe hidden with nsExec'
Assert-True ($hook -match '(?i)-Mode\s+apply') 'hook has no elevated apply step'
Assert-True ($hook -match '(?i)ExecShell\s+"runas"') 'hook does not elevate the apply step'
Assert-True ($hook -match '(?i)SW_HIDE') 'hook does not hide the elevated window'
Assert-True ($hook -match '(?i)-WindowStyle\s+Hidden') 'hook does not ask PowerShell to stay hidden'
Assert-True ($hook -match [regex]::Escape('-DonePath')) 'hook does not pass a completion marker path'
Assert-True ($hook -match '(?i)IfFileExists') 'hook does not wait for the elevated step'
Assert-True ($hook -notmatch '(?i)-Command\s') 'hook still uses an inline -Command'
Assert-True ($hook -notmatch '(?i)-Protocol\s+Any') 'hook still uses -Protocol Any'
Assert-True ($hook -notmatch '(?i)-Profile\s+Any') 'hook still uses -Profile Any'

# The embedded script keeps the hardened rule definition.
Assert-True ($script -match '(?i)\[ValidateSet\(''check'',\s*''apply''\)\]') 'firewall script has no check/apply mode'
Assert-True ($script -match '(?i)-LocalPort\s+42080') 'firewall script missing TCP 42080'
Assert-True ($script -match '(?i)-LocalPort\s+42081') 'firewall script missing UDP 42081'
Assert-True ($script -match '(?i)-Profile\s+Domain,Private') 'firewall script does not force Domain,Private'
Assert-True ($script -match '(?i)-Protocol\s+TCP') 'firewall script missing TCP protocol'
Assert-True ($script -match '(?i)-Protocol\s+UDP') 'firewall script missing UDP protocol'
Assert-True ($script -match 'Test-FirewallRule') 'firewall script has no post-create validation'
Assert-True ($script -match '(?i)Set-Marker') 'firewall script has no completion marker'
Assert-True ($script -notmatch '(?i)Disable-WindowsOptionalFeature|Set-MpPreference|Add-MpPreference') 'firewall script touches Defender'

# Behavioural check: -Mode check must resolve cleanly against a bogus exe path.
$tempDir = Join-Path $env:TEMP ('filebridge firewall $test ' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
try {
    $fakeExe = Join-Path $tempDir 'Program Files $test/filebridge-lan.exe'
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installScript -Mode check -ExePath $fakeExe 2>&1
    $exitCode = $LASTEXITCODE
    $text = ($output | Out-String).Trim()
    Assert-True ($exitCode -eq 1) "check mode against a bogus path should exit 1, got $exitCode`: $text"
    Assert-True ($text -notmatch '(?i)ParserError|Unexpected token') "check mode reported a parser error: $text"

    $markerPath = Join-Path $tempDir 'marker.txt'
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installScript -Mode apply -ExePath $fakeExe -DonePath $markerPath 2>&1
    $text = ($output | Out-String).Trim()
    Assert-True ($text -notmatch '(?i)ParserError|Unexpected token') "apply mode reported a parser error: $text"
} finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}

# Informational: does this machine already have the rules for the installed app?
$installedExe = Join-Path $env:LOCALAPPDATA 'Filebridge-Lan/filebridge-lan.exe'
if (Test-Path -LiteralPath $installedExe) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installScript -Mode check -ExePath $installedExe | Out-Null
    Write-Host ("firewall rules for the installed app: " + ($(if ($LASTEXITCODE -eq 0) { 'present' } else { 'missing' })))
}

if ($failures.Count -gt 0) {
    Write-Host 'FIREWALL_INSTALLER_TEST_FAILED'
    foreach ($failure in $failures) {
        Write-Host " - $failure"
    }
    exit 1
}

Write-Host 'FIREWALL_INSTALLER_TEST_OK'
