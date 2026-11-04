@echo off
REM Stops everything start_fusion.bat started.
setlocal
title EchoLabs stop
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 exit /b 1

node "scripts\fusion\stop.mjs"
timeout /t 2 /nobreak >nul
exit /b 0
