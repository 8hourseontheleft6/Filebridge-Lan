; Windows firewall rules are part of the installer itself.
;
;  * the common path is native and silent: netsh + findstr check that both rules
;    already point at the installed executable, so upgrades and repairs finish
;    without a single prompt or window;
;  * only when the rules are missing or stale does the installer ask Windows for
;    administrator rights once and run the embedded script (packed into the setup
;    exe, extracted to $PLUGINSDIR, deleted afterwards) fully hidden - no console
;    window, and nothing is left next to the application.
;
; Helper: TRUE when both inbound rules exist for the exe in $R0 with the right
; port + profile; the answer lands in $R8 so the hook can branch on it.
Function FbFirewallConfigured
  StrCpy $R8 "0"

  StrCpy $R4 'cmd.exe /c netsh advfirewall firewall show rule name="Filebridge-Lan" verbose | findstr /i /c:"$R0" >nul'
  nsExec::ExecToStack '$R4'
  Pop $R5
  Pop $R6
  StrCmp $R5 "0" 0 fbFwProbeEnd

  StrCpy $R4 'cmd.exe /c netsh advfirewall firewall show rule name="Filebridge-Lan" verbose | findstr /c:"42080" >nul'
  nsExec::ExecToStack '$R4'
  Pop $R5
  Pop $R6
  StrCmp $R5 "0" 0 fbFwProbeEnd

  StrCpy $R4 'cmd.exe /c netsh advfirewall firewall show rule name="Filebridge-Lan Discovery" verbose | findstr /i /c:"$R0" >nul'
  nsExec::ExecToStack '$R4'
  Pop $R5
  Pop $R6
  StrCmp $R5 "0" 0 fbFwProbeEnd

  StrCpy $R4 'cmd.exe /c netsh advfirewall firewall show rule name="Filebridge-Lan Discovery" verbose | findstr /c:"42081" >nul'
  nsExec::ExecToStack '$R4'
  Pop $R5
  Pop $R6
  StrCmp $R5 "0" 0 fbFwProbeEnd

  StrCpy $R8 "1"

  fbFwProbeEnd:
FunctionEnd

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "配置 Windows 防火墙：TCP 42080 / UDP 42081（专用 + 域）"
  InitPluginsDir

  ; Older installers dropped the script beside the app; keep that directory clean.
  Delete "$INSTDIR\install-firewall.ps1"
  Delete "$INSTDIR\.filebridge-firewall.done"

  SetOutPath "$PLUGINSDIR"
  File "/oname=filebridge-firewall.ps1" "${__FILEDIR__}\..\..\..\..\nsis\install-firewall.ps1"
  SetOutPath "$INSTDIR"

  StrCpy $R0 "$INSTDIR\filebridge-lan.exe"
  StrCpy $R1 "$PLUGINSDIR\filebridge-firewall.ps1"
  StrCpy $R2 "$LOCALAPPDATA\Filebridge-Lan\firewall-install.log"
  StrCpy $R3 "$INSTDIR\.filebridge-firewall.done"

  Call FbFirewallConfigured
  StrCmp $R8 "1" fbFirewallReady

  fbFirewallApply:
  DetailPrint "Windows 会请求一次管理员授权以写入防火墙规则…"
  ExecShell "runas" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File $\"$R1$\" -Mode apply -ExePath $\"$R0$\" -DonePath $\"$R3$\" -LogPath $\"$R2$\"" SW_HIDE

  StrCpy $R7 0
  fbFirewallWait:
    Sleep 250
    IfFileExists "$R3" fbFirewallWritten
    IntOp $R7 $R7 + 1
    IntCmp $R7 80 fbFirewallTimeout fbFirewallWait fbFirewallWait

  fbFirewallWritten:
    Delete "$R3"
    Call FbFirewallConfigured
    StrCmp $R8 "1" fbFirewallReady fbFirewallFailed

  fbFirewallTimeout:
    DetailPrint "等待防火墙授权超时，首次连接时 Windows 可能再询问一次。"
    Goto fbFirewallDone

  fbFirewallFailed:
    DetailPrint "防火墙规则未能写入，首次连接时 Windows 可能再询问一次。"
    Goto fbFirewallDone

  fbFirewallReady:
    DetailPrint "防火墙已放行 TCP 42080 / UDP 42081（专用 + 域）"

  fbFirewallDone:
  Delete "$R1"
!macroend
