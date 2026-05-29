## 系统环境
- OS：Windows 11（64位）
- 终端：PowerShell
- 编码：UTF-8（全局）
- 内网IP：192.168.x.x（自动识别）
- 端口：8080（Web服务）

## 技术栈（已安装）
- Python 3.10+
- FastAPI / Uvicorn
- HTML5 + Bootstrap5 + 原生JS
- SQLite3
- PyInstaller（打包EXE）

## 常用路径
- 工作区：C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev
- 后端源码：./backend/
- 前端WebUI：./frontend/
- 数据文件：./data/prompts.db
- 启动脚本：./start.bat

## 可用命令
- 启动服务：uvicorn main:app --host 0.0.0.0 --port 8080
- 打包EXE：pyinstaller --onefile --windowed main.py
- 查看IP：ipconfig
- 放行端口：Windows Defender 防火墙 → 高级设置