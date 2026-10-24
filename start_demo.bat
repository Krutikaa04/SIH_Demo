
@echo off
REM Double-click to start the offline demo.
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install Python 3.11+ and run this again.
  pause
  exit /b 1
)

if not exist "frontend\dist\index.html" (
  echo The built frontend is missing.
  echo Download the demo bundle from the project's GitHub Releases,
  echo or install Node.js and run npm ci and npm run build in frontend.
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
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

python run.py
pause
