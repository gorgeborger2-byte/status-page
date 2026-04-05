@echo off
setlocal

set "ROOT=%~dp0"
set "CF_BIN=C:\Program Files (x86)\cloudflared\cloudflared.exe"
if not exist "%CF_BIN%" set "CF_BIN=C:\Program Files\cloudflared\cloudflared.exe"

if not exist "%CF_BIN%" (
  echo cloudflared.exe not found.
  echo Install once with: winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  pause
  exit /b 1
)

echo Starting backend server window...
start "Cosmo Backend" cmd /k "cd /d "%ROOT%" && npm start"

timeout /t 3 >nul

echo Starting public tunnel window...
start "Cosmo Public URL" cmd /k ""%CF_BIN%" tunnel --url http://localhost:3000"

echo.
echo Done. Keep both windows open.
echo Share the HTTPS link shown in the "Cosmo Public URL" window.
echo Example pages:
echo   /auth.html
echo   /admin.html
echo.
pause
