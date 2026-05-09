@echo off
setlocal
set PROJECT_DIR=%~dp0
if "%PROJECT_DIR:~-1%"=="\" set PROJECT_DIR=%PROJECT_DIR:~0,-1%
start "mimo2codex-mimo" /min cmd /c "cd /d "%PROJECT_DIR%" && set MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1 && node dist/cli.js --provider mimo --no-web-search --port 8788"
start "mimo2codex-deepseek" /min cmd /c "cd /d "%PROJECT_DIR%" && node dist/cli.js --provider deepseek --port 8789"
echo.
echo mimo2codex proxies started:
echo   MiMo      - http://127.0.0.1:8788
echo   DeepSeek  - http://127.0.0.1:8789
echo.
echo Close the two minimized windows to stop, or run: stop_all_proxies.bat
pause