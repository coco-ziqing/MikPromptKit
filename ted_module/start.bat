@echo off
chcp 65001 >nul
REM 需求分析 - 独立启动（零侵入主项目）
cd /d "%~dp0"
echo [需求分析] 启动需求分析（独立端口 8085，零外网/零抓取/零定时）...
"C:\Users\admin\AppData\Local\Python\bin\python.exe" main.py
pause
