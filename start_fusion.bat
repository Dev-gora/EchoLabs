@echo off
echo Starting EchoLabs...

REM Kill any existing processes on our ports
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5002') do taskkill /F /PID %%a 2>/dev/null
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5174') do taskkill /F /PID %%a 2>/dev/null
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8002') do taskkill /F /PID %%a 2>/dev/null

timeout /t 2 /nobreak > /dev/null

REM Start ASR Service
start "ASR Service" cmd /k "cd /d "%~dp0artifacts\asr-service" && set ASR_PORT=8002 && python app.py"

timeout /t 5 /nobreak > /dev/null

REM Start API Server
start "API Server" cmd /k "cd /d "%~dp0artifacts\api-server" && set ASR_SERVICE_URL=http://127.0.0.1:8002 && set PORT=5002 && node --enable-source-maps ./dist/index.mjs"

timeout /t 5 /nobreak > /dev/null

REM Start Frontend
start "Frontend" cmd /k "cd /d "%~dp0artifacts\echo-labs" && npx --yes vite --config vite.config.ts --host 0.0.0.0 --port 5174"

timeout /t 15 /nobreak > /dev/null

start http://localhost:5174

echo All services started!
pause
