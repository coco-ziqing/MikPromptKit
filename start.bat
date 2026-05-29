@echo off
chcp 65001 >nul
title 提示词检索工具 v3.0

echo ============================================
echo     [启动] 提示词检索工具 v3.0
echo     含四大模块 + 收藏夹 + 词包 + Seedance
echo ============================================
echo.

:: 切换到项目根目录
cd /d "%~dp0"

:: 检查 Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Python 3.8+
    echo 下载: https://www.python.org/downloads/
    pause
    exit /b 1
)

:: 检查/安装依赖
echo [1/4] 检查依赖...
python -c "import fastapi, uvicorn" >nul 2>&1
if %errorlevel% neq 0 (
    echo   - 首次运行，安装依赖...
    pip install -r requirements.txt -q
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败，请手动执行: pip install -r requirements.txt
        pause
        exit /b 1
    )
    echo   [OK] 依赖安装完成
) else (
    echo   [OK] 依赖已就绪
)

:: 检测端口
echo [2/4] 检测端口...
set PORT=8080

:check_port
netstat -ano | findstr ":%PORT% " >nul 2>&1
if %errorlevel% equ 0 (
    echo   - 端口 %PORT% 已被占用，尝试下一个...
    set /a PORT+=1
    if %PORT% gtr 8100 (
        echo [错误] 8080~8100 均被占用，请手动指定端口
        pause
        exit /b 1
    )
    goto check_port
)
echo   [OK] 端口 %PORT% 可用

:: 获取内网IP
echo [3/4] 检测局域网 IP...
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set IP_ADDR=%%a
    goto :found_ip
)
:found_ip
set IP_ADDR=%IP_ADDR: =%
echo   [OK] 本机IP: %IP_ADDR%

:: 防火墙放行提示
echo [4/4] 启动服务...
echo.
echo ============================================
echo  本机访问:  http://127.0.0.1:%PORT%
echo  局域网访问: http://%IP_ADDR%:%PORT%
echo.
echo  手机/其他电脑访问失败时的排查步骤：
echo  1. 检查手机/电脑是否在同一局域网
echo  2. Windows防火墙放行端口:
echo     控制面板 → Windows Defender防火墙
echo     → 高级设置 → 入站规则 → 新建规则
echo     → 端口 → TCP → 特定本地端口 %PORT%
echo     → 允许连接 → 完成
echo  3. 杀毒软件可能拦截，请放行
echo ============================================
echo.
echo  按 Ctrl+C 停止服务
echo.

:: 启动
set PORT=%PORT%
python backend\main.py

echo.
echo 服务已停止。
pause
