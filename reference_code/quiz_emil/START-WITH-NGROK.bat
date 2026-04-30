@echo off
REM Dobbeltklik for at starte server + ngrok-tunnel (offentlig URL)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\03-start-with-ngrok.ps1"
pause
