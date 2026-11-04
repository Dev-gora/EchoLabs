@echo off
REM Stops every process the EchoLabs launcher started.
setlocal
title EchoLabs stop
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\fusion\stop.ps1"
echo.
timeout /t 2 /nobreak >nul
exit /b 0
