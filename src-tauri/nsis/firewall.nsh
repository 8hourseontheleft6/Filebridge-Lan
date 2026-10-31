!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Configuring Windows firewall: TCP 42080, UDP 42081 (Domain/Private)..."

  ; The script is shipped next to the installed executable. Passing paths via
  ; -File/-ExePath avoids the old long inline command and NSIS quote corruption.
  SetOutPath "$INSTDIR"
  File "/oname=install-firewall.ps1" "${__FILEDIR__}\..\..\..\..\nsis\install-firewall.ps1"

  ExecShell "runas" "powershell.exe" "-NoProfile -ExecutionPolicy Bypass -File $\"$INSTDIR\install-firewall.ps1$\" -ExePath $\"$INSTDIR\filebridge-lan.exe$\"" SW_SHOW
!macroend
