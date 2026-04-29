@echo off
REM Dobbeltklik for at deploye til Render via GitHub
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\04-deploy.ps1"
