@echo off
REM Dobbeltklik denne fil for at starte serveren
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\02-start-server.ps1"
pause
