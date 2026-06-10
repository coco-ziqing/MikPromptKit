@echo off
chcp 65001 >nul
cd /d "%~dp0"
python backend/main.py --host 0.0.0.0 --port 8081
pause
