@echo off
setlocal
cd /d "%~dp0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3340" ^| findstr "LISTENING"') do (
  echo Lukker eksisterende proces paa port 3340. PID %%p...
  taskkill /PID %%p /F >nul 2>&1
)
echo Starter Nanna STORE Quiz til Marius paa port 3340...
npm start
