@echo off
REM One-click installer: Node dependencies, .env, API build, Python ASR venv.
setlocal
title EchoLabs installer
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org then run this file again.
  echo.
  pause
  exit /b 1
)

node "scripts\fusion\install.mjs" %*

echo.
pause
exit /b 0
