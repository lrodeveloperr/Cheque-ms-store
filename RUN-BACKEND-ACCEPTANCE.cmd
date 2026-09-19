@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 24 or later, then run this file again.
  pause
  exit /b 1
)

for /f "delims=." %%V in ('node -p "process.versions.node"') do set "WORKSBIEN_NODE_MAJOR=%%V"
if %WORKSBIEN_NODE_MAJOR% LSS 24 (
  echo WorksBien requires Node.js 24 or later. Found Node.js %WORKSBIEN_NODE_MAJOR%.
  pause
  exit /b 1
)

echo Running the WorksBien backend acceptance test...
call npm run acceptance -- --outcome printed
if errorlevel 1 (
  echo.
  echo The acceptance test failed. Review the error above.
  pause
  exit /b 1
)

echo.
echo Test complete. Open the output folder shown above.
pause
