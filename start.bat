@echo off
start "Filebridge-Lan-Hub" cmd /c "node server/hub.mjs"
timeout /t 1 /nobreak >nul
start "Filebridge-Lan-Signal" cmd /c "npx tsx server/signaling.ts"
timeout /t 2 /nobreak >nul
start "Filebridge-Lan-Dev" cmd /c "npm run dev"
echo Filebridge-Lan started!
echo Desktop: http://localhost:5173
echo Phone:   http://^<this-PC-IP^>:42080
pause
