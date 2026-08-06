@echo off
chcp 65001 >nul
title PromptKit 一键部署安装
setlocal enabledelayedexpansion

echo ============================================================
echo   PromptKit（咪卡MiK提示词助手）一键部署
echo   本脚本：装依赖 + 准备生成引擎CLI + 启动服务
echo   全程免安装、位置无关——整个文件夹可随意移动/拷贝
echo ============================================================
echo.

REM ---- 定位脚本所在目录（位置无关） ----
cd /d "%~dp0"
set "APP_DIR=%CD%"
echo [1/5] 应用目录: %APP_DIR%
echo.

REM ---- 检查 Python（便携优先：应用目录 python/ 内嵌版 → 系统 Python） ----
echo [2/5] 检查 Python 环境...
set "PYTHON="
if exist "%APP_DIR%\python\python.exe" (
    set "PYTHON=%APP_DIR%\python\python.exe"
    echo   便携 Python: %PYTHON%
)
if not defined PYTHON (
    where python >nul 2>nul && set "PYTHON=python"
)
if not defined PYTHON (
    if exist "%LOCALAPPDATA%\Programs\Python\Python*\python.exe" (
        for /f "delims=" %%i in ('dir /b /s "%LOCALAPPDATA%\Programs\Python\Python*\python.exe" 2^>nul') do (
            if not defined PYTHON set "PYTHON=%%i"
        )
    )
)
if not defined PYTHON (
    echo   [错误] 未找到 Python。
    echo   方式A（推荐便携）: 将 Python 便携版放入 %APP_DIR%\python\ 目录
    echo      - 下载 embeddable zip: https://www.python.org/downloads/windows/
    echo      - 解压后放入 %APP_DIR%\python\，并新建 python\python._pth 含 "Lib\site-packages"
    echo   方式B: 安装 Python 3.12+ 并勾选 "Add to PATH"
    echo   下载: https://www.python.org/downloads/
    pause
    exit /b 1
)
echo   Python: %PYTHON%
"%PYTHON%" --version
echo.

REM ---- 安装依赖 ----
echo [3/5] 安装 Python 依赖（首次较慢，约1-3分钟）...
"%PYTHON%" -m pip install -r requirements.txt --quiet
if errorlevel 1 (
    echo   [警告] 依赖安装可能有遗漏，尝试继续...
) else (
    echo   依赖安装完成
)
echo.

REM ---- 准备生成引擎 CLI ----
echo [4/5] 检查生成引擎 CLI...
set "NEED_DREAMINA=0"
set "NEED_LIBTV=0"

if not exist "%APP_DIR%\bin\dreamina.exe" (
    if not exist "%USERPROFILE%\bin\dreamina.exe" (
        set "NEED_DREAMINA=1"
    )
)
if not exist "%APP_DIR%\bin\libtv.exe" (
    if not exist "%USERPROFILE%\.libtv\libtv.exe" (
        set "NEED_LIBTV=1"
    )
)

if !NEED_DREAMINA!==1 (
    echo   - 即梦 CLI (dreamina.exe) 未找到
    echo     安装包位置: %APP_DIR%\bin\dreamina.exe 或 %USERPROFILE%\bin\
    echo     若已下载请放入 %APP_DIR%\bin\ 目录后重试
)
if !NEED_LIBTV!==1 (
    echo   - LibTV CLI (libtv.exe) 未找到
    echo     可用官方一键安装脚本: 
    echo     powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://liblibai-web-static.liblib.cloud/cli/latest/install-libtv-cli.ps1' -UseBasicParsing | Invoke-Expression"
    echo     或手动下载后放入 %APP_DIR%\bin\ 目录
)
if !NEED_DREAMINA!==0 if !NEED_LIBTV!==0 (
    echo   两个生成引擎 CLI 均已就绪
)
echo.

REM ---- 首次授权提示 ----
echo [5/5] 授权说明
echo   - 即梦 / LibTV 授权可在启动后，在网页「AI批量生成缩略图 → 授权中心」内完成
echo   - 未授权不影响词库浏览/搜索/ComfyUI 等其它功能
echo   - 仅在用到即梦/LibTV 生成时才需要授权
echo.

REM ---- 启动服务 ----
echo 启动 PromptKit 服务...
echo 访问地址: http://127.0.0.1:8080
echo 按 Ctrl+C 停止服务
echo.
"%PYTHON%" backend\main.py
pause
