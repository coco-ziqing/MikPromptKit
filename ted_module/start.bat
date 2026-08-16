@echo off
chcp 65001 >nul
REM TED 素材需求分析合规模块 - 独立启动（零侵入主项目）
cd /d "%~dp0"
echo [TED] 启动素材需求分析合规模块（独立端口 8085，零外网/零抓取/零定时）...
"C:\Users\admin\AppData\Local\Python\bin\python.exe" main.py
pause
