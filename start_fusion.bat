@echo off
REM Starts EchoLabs on http://localhost:5174, then closes this window on its own.
REM The services keep running hidden; stop them with stop_fusion.bat.
setlocal
title EchoLabs
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org then run install.bat.
  echo.
  pause
  exit /b 1
)

node "scripts\fusion\start.mjs"
timeout /t 3 /nobreak >nul
exit /b 0
