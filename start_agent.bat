@echo off
REM ============================================================
REM  Agent Launcher for Windows
REM ============================================================
REM  Copy this file to ANY folder you want as the sandbox root,
REM  then double-click to start the Agent backend.
REM  The sandbox root is auto-locked to this .bat file's folder.
REM  Edit AGENT_HOME below to point to your agent repo.
REM ============================================================

REM Switch console to UTF-8 so Python emoji output renders correctly
chcp 65001 >nul 2>&1

REM ===== EDIT THIS: path to your agent repo =====
set "AGENT_HOME=C:\Users\philips\Desktop\agent"

REM Sandbox root = folder containing this .bat
set "WORKSPACE=%~dp0"

REM Strip trailing backslash (argparse can be picky)
if "%WORKSPACE:~-1%"=="\" set "WORKSPACE=%WORKSPACE:~0,-1%"

echo.
echo ============================================================
echo   Agent Launcher
echo ============================================================
echo   Code home : %AGENT_HOME%
echo   Sandbox   : %WORKSPACE%
echo ============================================================
echo.

if not exist "%AGENT_HOME%\local_terminal_server.py" (
    echo [ERROR] Cannot find %AGENT_HOME%\local_terminal_server.py
    echo         Please edit AGENT_HOME at the top of this script.
    pause
    exit /b 1
)

python "%AGENT_HOME%\local_terminal_server.py" --workspace "%WORKSPACE%" %*

REM Keep window open after server exits so user can read errors
pause
