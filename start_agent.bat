@echo off
REM ============================================================
REM  Agent Launcher for Windows
REM ============================================================
REM  Double-click to start the Agent backend and open the frontend.
REM  You can switch the sandbox folder from the frontend workspace card.
REM  The initial sandbox root is this .bat file's folder.
REM  Optional: set AGENT_HOME to point to your agent repo if this
REM  launcher is copied outside the repo.
REM ============================================================

REM Switch console to UTF-8 so Python emoji output renders correctly
chcp 65001 >nul 2>&1


REM Agent code home. Defaults to this script's folder.
if not defined AGENT_HOME set "AGENT_HOME=%~dp0"
if "%AGENT_HOME:~-1%"=="\" set "AGENT_HOME=%AGENT_HOME:~0,-1%"

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
    echo         Set AGENT_HOME to the agent repo path, then run this script again.
    echo         Example: set AGENT_HOME=D:\path\to\agent
    pause
    exit /b 1
)

set "HTML_FILE="
for %%F in ("%AGENT_HOME%\AI-Chat-*.html") do (
    if not defined HTML_FILE set "HTML_FILE=%%~fF"
)
if defined HTML_FILE (
    echo Opening frontend: %HTML_FILE%
    start "" "%HTML_FILE%"
) else (
    echo [WARN] Cannot find frontend HTML: %AGENT_HOME%\AI-Chat-*.html
)

python "%AGENT_HOME%\local_terminal_server.py" --workspace "%WORKSPACE%" %*

REM Keep window open after server exits so user can read errors
pause
