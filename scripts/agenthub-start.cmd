@echo off
REM Double-click launcher for Windows: runs the PowerShell starter.
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0agenthub-start.ps1"
pause
