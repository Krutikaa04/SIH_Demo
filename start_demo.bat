@echo off
REM Double-click to start the demo. Installs dependencies from the bundled wheelhouse if they are missing.
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install Python 3.12+ and run this again.
  pause
  exit /b 1
)
python -c "import fastapi, uvicorn, rapidfuzz, sklearn" >nul 2>nul
if errorlevel 1 (
  echo Installing dependencies...
  if exist vendor\wheels (
    python -m pip install --no-index --find-links vendor\wheels -r requirements.txt
  ) else (
    python -m pip install -r requirements.txt
  )
)
python run.py %*
pause
