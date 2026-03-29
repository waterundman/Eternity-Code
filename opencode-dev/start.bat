@echo off
setlocal

if defined USERPROFILE set "PATH=%PATH%;%USERPROFILE%\.bun\bin"

echo ========================================
echo   Eternity Code
echo ========================================
echo.

if not defined OPENROUTER_API_KEY (
  echo [Warning] OPENROUTER_API_KEY is not set.
  echo Set it before launching Eternity Code if your provider requires it.
  echo.
)

cd /d "%~dp0"

echo   TUI: starting terminal UI...
if exist ".meta\design.yaml" (
  echo   Dashboard: http://localhost:7777
  echo.
  echo   Opening the dashboard in 3 seconds...
  start /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:7777"
)

echo ========================================
echo.

bun dev .

endlocal
