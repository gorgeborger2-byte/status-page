@echo off
echo Stopping cloudflared and node processes...
taskkill /IM cloudflared.exe /F >nul 2>nul
taskkill /IM node.exe /F >nul 2>nul
echo Done.
pause
