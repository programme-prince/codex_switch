@echo off
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8788" ^| findstr "LISTENING"') do taskkill /PID %%a /F 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8789" ^| findstr "LISTENING"') do taskkill /PID %%a /F 2>nul
echo All mimo2codex proxies stopped.