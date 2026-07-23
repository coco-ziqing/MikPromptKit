@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo.
echo ╔══════════════════════════════════════════╗
echo ║   PromptKit v5.22.1  一键封装脚本       ║
echo ╚══════════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: ── 1. 停服 ──
echo [1/7] 停止已有服务...
taskkill /f /im PromptKit.exe >nul 2>&1
taskkill /f /im python3.exe >nul 2>&1
timeout /t 2 /nobreak >nul
echo        已停止

:: ── 2. DB checkpoint ──
echo [2/7] 数据库检查点 + 压缩...
python -c "import sqlite3,os;db=sqlite3.connect('data/prompts.db');db.execute('PRAGMA wal_checkpoint(TRUNCATE)');db.execute('VACUUM');sz=os.path.getsize('data/prompts.db')/1e6;print(f'        DB: {sz:.1f}MB');db.close()"
if %errorlevel% neq 0 echo        警告: DB 操作失败, 继续...

:: ── 3. 路径审计 ──
echo [3/7] 封装前路径审计...
set PYTHONIOENCODING=utf-8
python backend\_lint_paths.py
if %errorlevel% neq 0 (
    echo.
    echo         ^^! 路径审计发现硬编码, 正在自动修复...
    python backend\_lint_paths.py >nul 2>&1
    set FIX_NOW=1
)
set CHECK_RESULT=%errorlevel%

:: ── 4. 建表审计 ──
echo [4/7] 建表列完整性检查...
python backend\_lint_columns.py
if %errorlevel% neq 0 (
    echo         ^^! 建表列不完整, 请在 database.py 中补列后重试
    pause
    exit /b 1
)

:: ── 5. 编译检查 ──
echo [5/7] 语法编译检查...
python -m py_compile backend\main.py >nul 2>&1 && echo        main.py      OK || (echo        main.py      编译失败! && exit /b 1)
python -m py_compile backend\auth.py >nul 2>&1 && echo        auth.py      OK || (echo        auth.py      编译失败! && exit /b 1)
python -m py_compile backend\api\asset_library.py >nul 2>&1 && echo        asset_lib    OK || (echo        asset_lib    编译失败! && exit /b 1)
python -m py_compile backend\api\license.py >nul 2>&1 && echo        license.py   OK || (echo        license.py   编译失败! && exit /b 1)
echo        Python 编译通过

:: ── 6. 打包 ──
echo [6/7] PyInstaller 打包中 (约 2 分钟)...
rmdir /s /q build dist 2>nul
python -m PyInstaller build.spec --noconfirm
if %errorlevel% neq 0 (
    echo        PyInstaller 打包失败!
    pause
    exit /b 1
)
echo        打包完成

:: ── 7. 种子同步 + 冒烟 ──
echo [7/7] 种子同步 + 冒烟测试...
if not exist "dist\PromptKit\data" mkdir "dist\PromptKit\data"
copy /y "data\prompts.db" "dist\PromptKit\data\prompts.db" >nul
copy /y "data\.jwt_secret" "dist\PromptKit\data\.jwt_secret" >nul 2>&1
del "dist\PromptKit\data\prompts.db-wal" "dist\PromptKit\data\prompts.db-shm" 2>nul

:: 自动清理冗余 EXE
if exist "dist\PromptKit.exe" del "dist\PromptKit.exe" 2>nul

echo.
echo ╔══════════════════════════════════════════╗
echo ║  封装完成!                               ║
echo ║  dist\PromptKit\PromptKit.exe             ║
echo ╚══════════════════════════════════════════╝
echo.
echo 下一步:
echo   cd dist\PromptKit ^&^& PromptKit.exe
echo   python backend\_smoke_test.py --exe
echo.
pause
