@echo off
REM ===================================================================
REM  EU4 Mod Viewer launcher  (English-named alias)
REM
REM  This file is deliberately PURE ASCII with CRLF line endings.
REM  cmd.exe reads batch files in the OEM code page, so non-ASCII text
REM  placed here gets mis-parsed (that is exactly what broke the old
REM  version of this file). Every localized message is printed by
REM  tools\launcher.js instead, which writes proper UTF-8 output that a
REM  chcp 65001 console renders correctly.
REM
REM  Usage:  double-click this file, or run
REM            start.bat --lang en --port 4173
REM ===================================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

chcp 65001 >nul 2>nul
title EU4 Mod Viewer
node "tools\launcher.js" %*
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" echo   [exit code %RC%]
pause
exit /b %RC%

:nonode
echo.
echo   Node.js was not found on this computer.
echo   EU4 Mod Viewer needs Node.js 18 or newer.
echo.
echo   Download        : https://nodejs.org/
echo   Chinese README  : README.md
echo.
pause
exit /b 1
