@echo off
rem Create the virtualenv and install pinned dependencies from vendor\wheels.
rem No network access is needed. Requires 64-bit Python 3.12, 3.13 or 3.14.
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  echo Python 3.12-3.14 is required.
  echo Install it from https://www.python.org/downloads/windows/ and tick
  echo "Add python.exe to PATH", then run this file again.
  pause & exit /b 1
)

set PYL=
for %%V in (3.14 3.13 3.12) do (
  if not defined PYL (
    py -%%V -c "import sys" >nul 2>nul && set PYL=-%%V
  )
)
if not defined PYL (
  echo This bundle has wheels for Python 3.12, 3.13 and 3.14 only.
  echo Installed interpreters:
  py -0p
  pause & exit /b 1
)

if not exist venv\Scripts\python.exe py %PYL% -m venv venv
if errorlevel 1 (
  echo Could not create the virtualenv.
  pause & exit /b 1
)

venv\Scripts\python.exe -m pip install --no-index --find-links vendor\wheels -r requirements.txt
if errorlevel 1 (
  echo Install failed: no matching wheel for this Python.
  venv\Scripts\python.exe -V
  pause & exit /b 1
)

echo.
echo Done. Double-click run.bat to start.
pause
