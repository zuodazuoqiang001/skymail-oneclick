@echo off
set NODE_USE_ENV_PROXY=1
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Need Node.js 20+
  pause
  exit /b 1
)
node deploy.mjs %*
