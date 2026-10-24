!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "配置 Windows 防火墙，允许手机访问 Filebridge-Lan..."
  ; 安装结束后请求一次 UAC：删除旧的 Block/Allow 规则，再添加专用/域网络的入站允许。
  ExecShell "runas" "powershell.exe" "-NoProfile -ExecutionPolicy Bypass -Command $\"Get-NetFirewallRule -DisplayName 'filebridge-lan.exe' -ErrorAction SilentlyContinue | Remove-NetFirewallRule; Get-NetFirewallRule -DisplayName 'Filebridge-Lan' -ErrorAction SilentlyContinue | Remove-NetFirewallRule; New-NetFirewallRule -DisplayName 'Filebridge-Lan' -Direction Inbound -Program '$INSTDIR\filebridge-lan.exe' -Action Allow -Protocol TCP -Profile Private,Domain$\"" SW_HIDE
!macroend
