@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
:loop
call npm start
echo Scanner stopped - restarting in 10 seconds (Ctrl+C to quit)
timeout /t 10 >nul
goto loop
