@echo off
setlocal
cd /d "%~dp0"
title OUTARCH Windows Acceptance

where node.exe >nul 2>nul
if errorlevel 1 goto missing_node
if not exist "node_modules\.bin\electron.cmd" call npm.cmd install
if errorlevel 1 goto failed
call npm.cmd run groundstation:build
if errorlevel 1 goto failed
node.exe scripts\windows-release-check.cjs
if errorlevel 1 goto failed
echo.
echo Core Windows and ConPTY smoke checks passed.
echo Continue with WINDOWS_ACCEPTANCE.md for interactive terminal checks.
pause
exit /b 0

:missing_node
echo Node.js 22 LTS is required.
goto failed

:failed
echo.
echo Windows acceptance did not pass. Review the result above.
pause
exit /b 1
