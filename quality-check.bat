@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0quality-check.ps1" %*
exit /b %ERRORLEVEL%
