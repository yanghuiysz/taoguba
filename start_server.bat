@echo off
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "PORT=8765"
set "URL=http://127.0.0.1:%PORT%/web/"

cd /d "%ROOT%"

echo [Taoguba] Root: %ROOT%
echo [Taoguba] Checking whether a post-close refresh is needed...
python .\scripts\refresh_latest_after_close.py

if errorlevel 1 (
  echo [Taoguba] Data refresh failed, startup aborted.
  pause
  exit /b 1
)

echo [Taoguba] Starting web server on port %PORT% ...
start "Taoguba Web Server" /D "%ROOT%" cmd /k "python -m http.server %PORT%"

echo [Taoguba] Starting intraday radar daemon ...
start "Taoguba Intraday Radar" /D "%ROOT%" cmd /k "python .\scripts\intraday_radar_daemon.py"

echo [Taoguba] Opening dashboard in browser ...
start "" "%URL%"

echo [Taoguba] Startup complete.
endlocal
