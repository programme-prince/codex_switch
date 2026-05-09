@echo off
taskkill /FI "WINDOWTITLE eq mimo2codex-mimo*" /F 2>nul
taskkill /FI "WINDOWTITLE eq mimo2codex-deepseek*" /F 2>nul
echo All mimo2codex proxies stopped.
