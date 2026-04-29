@echo off
REM Dobbeltklik denne fil for at committe + pushe til GitHub
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\01-commit-push.ps1"
