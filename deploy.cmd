@echo off
set NODE_USE_ENV_PROXY=1
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Downloading portable Node 22...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" %*
  if errorlevel 1 pause
  exit /b %ERRORLEVEL%
)
node deploy.mjs %*
