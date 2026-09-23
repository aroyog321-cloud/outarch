@echo off
setlocal
cd /d "%~dp0"
title OUTARCH

where node.exe >nul 2>nul
if errorlevel 1 goto missing_node

for /f %%V in ('node.exe -v') do set "OUTARCH_NODE_VERSION=%%V"
rem Electron installs only on Node.js 22.12 or newer: its installer loads an
rem ES module with require(), which earlier releases refuse.
node.exe -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 12 ? 0 : 1)" >nul 2>nul
if errorlevel 1 goto unsupported_node

if not exist "node_modules\.bin\electron.cmd" goto install_dependencies
rem node-pty ships prebuilt binaries, so ask Node whether it loads rather than
rem looking for a locally compiled file.
node.exe -e "require('node-pty')" >nul 2>nul
if errorlevel 1 goto install_dependencies
goto launch

:install_dependencies
echo.
echo OUTARCH is preparing its Windows desktop runtime.
echo This one-time setup can take several minutes.
echo.
call npm.cmd install
if errorlevel 1 goto install_failed

:launch
echo.
echo Opening OUTARCH...
echo If OUTARCH is already open, its window is brought to the front.
echo.
call npm.cmd run groundstation -- %*
if errorlevel 1 goto launch_failed
exit /b 0

:missing_node
echo.
echo Node.js was not found. Install Node.js 22 LTS, then run this file again.
echo https://nodejs.org/
goto failed

:unsupported_node
echo.
echo OUTARCH requires Node.js 22 LTS, version 22.12 or newer.
echo Detected version: %OUTARCH_NODE_VERSION%
echo Install the latest Node.js 22 LTS, then run this file again.
goto failed

:install_failed
echo.
echo Windows runtime setup failed. Review the npm error above.
echo node-pty may require the Microsoft C++ Build Tools if a prebuilt binary is unavailable.
goto failed

:launch_failed
echo.
echo OUTARCH could not open. Review the error above.
goto failed

:failed
echo.
pause
exit /b 1
