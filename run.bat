@echo off
rem Start Icon Library on http://127.0.0.1:7876 (set PORT / HOST to change it).
setlocal
cd /d "%~dp0"
if not exist venv\Scripts\python.exe (
  echo Run install.bat first.
  pause & exit /b 1
)
set PYTHONUTF8=1
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:7876"
venv\Scripts\python.exe server.py
pause
