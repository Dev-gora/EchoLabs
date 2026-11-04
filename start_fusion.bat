@echo off
REM EchoLabs shortcut: starts the whole local stack on http://localhost:5174
REM and closes this window on its own. Services run hidden in the background.
REM Stop them with stop_fusion.bat.
setlocal
title EchoLabs launcher
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\fusion\start.ps1"
echo.
echo Closing in 3 seconds...
timeout /t 3 /nobreak >nul
exit /b 0
