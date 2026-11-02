@echo off
rem Copyright (c) 2026 Celestial
rem Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
setlocal EnableExtensions DisableDelayedExpansion

set "ROOT=%~dp0"
set "OPAL_SERVER=%ROOT%Opal"
set "GRANITE_SERVER=%ROOT%Granite\Server"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not available on PATH.
  pause
  exit /b 1
)

if not exist "%OPAL_SERVER%\Opal.js" (
  echo [ERROR] Opal server entry point was not found: %OPAL_SERVER%\Opal.js
  pause
  exit /b 1
)

if not exist "%GRANITE_SERVER%\Server.js" (
  echo [ERROR] Granite server entry point was not found: %GRANITE_SERVER%\Server.js
  pause
  exit /b 1
)

rem Both services read the root Config.json directly, including network and timing.
set "PUBLIC_IP="
for /f "tokens=1-4" %%A in ('node -e "const c=require(process.argv[1]); const n=c.Network(); c.FrameRate(); c.LockstepBufferFrames(); console.log([n.PublicHost,n.Port,n.WorldPort,n.RelayPort].join(' '));" "%ROOT%Shared\Config.js"') do (
  set "PUBLIC_IP=%%A"
  set "GRANITE_PORT=%%B"
  set "OPAL_PORT=%%C"
  set "OPAL_RELAY_PORT=%%D"
)
if not defined PUBLIC_IP (
  echo [ERROR] Could not load network or timing settings from the root Config.json.
  pause
  exit /b 1
)

start "Granite HTTPS" /D "%GRANITE_SERVER%" cmd /k "node Server.js"
start "Opal WSS" /D "%OPAL_SERVER%" cmd /k "node Opal.js"

echo Granite and Opal were started in separate windows.
echo Granite HTTPS: https://%PUBLIC_IP%:%GRANITE_PORT%/
echo Opal WSS: wss://%PUBLIC_IP%:%OPAL_PORT%/  relay %PUBLIC_IP%:%OPAL_RELAY_PORT%
echo Clients: set Granite.ini [Network] ServerHost=%PUBLIC_IP% and ServerPort=%GRANITE_PORT%.
echo Close each server window or press Ctrl+C in it when finished.
endlocal
