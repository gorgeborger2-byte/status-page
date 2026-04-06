@echo off
setlocal

set "ROOT=%~dp0"
set "CF_BIN=C:\Program Files (x86)\cloudflared\cloudflared.exe"
if not exist "%CF_BIN%" set "CF_BIN=C:\Program Files\cloudflared\cloudflared.exe"
if "%STATUS_PASSWORD%"=="" set "STATUS_PASSWORD=support"

if not exist "%CF_BIN%" (
  echo cloudflared.exe not found.
  echo Install once with: winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  pause
  exit /b 1
)

echo Starting backend server window...
start "Cosmo Backend 24x7" cmd /k "cd /d "%ROOT%" & set STATUS_PASSWORD=%STATUS_PASSWORD% & :backend_loop & npm start & echo [backend] stopped - restarting in 5s... & timeout /t 5 >nul & goto backend_loop"

timeout /t 3 >nul

echo Starting public tunnel window...
start "Cosmo Tunnel 24x7" cmd /k "cd /d "%ROOT%" & :tunnel_loop & "%CF_BIN%" tunnel --url http://localhost:3000 & echo [tunnel] stopped - restarting in 5s... & timeout /t 5 >nul & goto tunnel_loop"

echo.
echo Done. Keep both windows open for 24/7 mode.
echo Share the HTTPS link shown in the "Cosmo Tunnel 24x7" window.
echo Example pages:
echo   /auth.html
echo   /admin.html
echo.
pause
