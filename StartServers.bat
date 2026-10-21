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

rem Config.json is the single advertised IPv4 source for Granite and Opal.
rem Existing port overrides are supported by both services; stale host overrides are replaced.
set "PUBLIC_IP="
for /f "tokens=1-4" %%A in ('node -e "const c=require(process.argv[1]); const h=c.PublicHost||'127.0.0.1'; const p=[process.env.GRANITE_PORT||c.Port||21000,process.env.OPAL_PORT||c.WorldPort||20054,process.env.OPAL_RELAY_PORT||c.RelayPort||28091].map(Number); if (!require('node:net').isIPv4(h)||h==='0.0.0.0'||h==='255.255.255.255'||p.some(x=>!Number.isInteger(x)||x<1||x>65535)) throw Error('Config.json requires a reachable PublicHost IPv4 and ports in 1..65535'); console.log([h,...p].join(' '));" "%GRANITE_SERVER%\Config.json"') do (
  set "PUBLIC_IP=%%A"
  set "GRANITE_PORT=%%B"
  set "OPAL_PORT=%%C"
  set "OPAL_RELAY_PORT=%%D"
)
if not defined PUBLIC_IP (
  echo [ERROR] Could not load network settings from Granite\Server\Config.json.
  pause
  exit /b 1
)
set "OPAL_PUBLIC_HOST=%PUBLIC_IP%"
set "OPAL_RELAY_HOST=%PUBLIC_IP%"
if not defined OPAL_RELAY_BIND set "OPAL_RELAY_BIND=0.0.0.0"
rem Let Granite use Config.json Host unless explicitly overridden by GRANITE_HOST.

set "GRANITE_LOCKSTEP_BUFFER_FRAMES=6"
set "OPAL_LOCKSTEP_DELAY_FRAMES=6"
set "OPAL_LOCKSTEP_HZ=83"
if not "%OPAL_LOCKSTEP_DELAY_FRAMES%"=="%GRANITE_LOCKSTEP_BUFFER_FRAMES%" (
  echo [ERROR] GRANITE_LOCKSTEP_BUFFER_FRAMES and OPAL_LOCKSTEP_DELAY_FRAMES must match.
  pause
  exit /b 1
)

start "Granite HTTPS" /D "%GRANITE_SERVER%" cmd /k "node Server.js"
start "Opal WSS" /D "%OPAL_SERVER%" cmd /k "node Opal.js"

echo Granite and Opal were started in separate windows.
echo Granite HTTPS: https://%PUBLIC_IP%:%GRANITE_PORT%/
echo Opal WSS: wss://%OPAL_PUBLIC_HOST%:%OPAL_PORT%/  relay %OPAL_RELAY_HOST%:%OPAL_RELAY_PORT%
echo Clients: set Granite.ini [Network] ServerHost=%PUBLIC_IP% and ServerPort=%GRANITE_PORT%.
echo Close each server window or press Ctrl+C in it when finished.
endlocal
