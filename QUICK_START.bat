@echo off
chcp 65001 >nul
title PromptKit 快捷启动 — v3.10.23
cd /d %~dp0

echo ========================================
echo    PromptKit v3.10.23 — 一键启动
echo    内网地址: http://192.168.0.103:8080
echo ========================================
echo.

:: 1. 检查 Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Python，请安装 Python 3.10+
    pause
    exit /b 1
)

:: 2. 检查目录完整性
if not exist "backend\main.py" (
    echo [错误] 缺少 backend\main.py，请确认工作目录正确
    pause
    exit /b 1
)
if not exist "data\prompts.db" (
    echo [注意] 数据库不存在，首次启动将自动创建
)

:: 3. 端口检测（8080 ~ 8100）
set PORT=8080
for /L %%p in (8080,1,8100) do (
    netstat -ano | findstr ":%%p " | findstr LISTEN >nul 2>&1
    if errorlevel 1 (
        set PORT=%%p
        goto FOUND
    )
)
echo [错误] 8080~8100 端口均被占用
pause
exit /b 1

:FOUND

:: 4. 防火墙提示
netsh advfirewall firewall show rule name="PromptKit %PORT%" >nul 2>&1
if %errorlevel% neq 0 (
    echo [提示] 防火墙规则 "PromptKit %PORT%" 未配置
    echo       如需局域网访问，请以管理员身份运行:
    echo       firewall_open.ps1
    echo.
)

:: 5. 显示访问信息
echo [信息] 启动端口: %PORT%
echo [信息] 内网访问: http://192.168.0.103:%PORT%
echo [信息] 本机访问: http://localhost:%PORT%
echo.
echo [信息] 服务启动中，请稍候...
echo.

:: 6. 启动后端服务（通过环境变量 PORT 传参）
cd backend
set PORT=%PORT%
python main.py
cd ..

echo.
echo 服务已停止。
pause
