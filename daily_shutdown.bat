@echo off
chcp 65001 >nul
setlocal

echo ╔══════════════════════════════════════════════╗
echo ║   PromptKit 每日关机流程                    ║
echo ╚══════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: ========== Step 1: 检查未提交变更 ==========
echo [1/6] 检查工作区状态...
git status --short > "%TEMP%\pk_status.txt"
for /f %%i in ('type "%TEMP%\pk_status.txt" ^| find /c /v ""') do set CHANGES=%%i
if %CHANGES% GTR 0 (
    echo   ⚠ 发现 %CHANGES% 个未提交文件, 自动提交中...
    git add -A
    git commit -m "daily: auto-commit before shutdown (%date%)"
    echo   已自动提交
) else (
    echo   ✅ 工作区干净
)

:: ========== Step 2: 推送远程 ==========
echo [2/6] 推送到远程仓库...
git push origin main 2>nul
if errorlevel 1 (
    echo   ⚠ 推送失败(可能无远程配置), 跳过
) else (
    echo   ✅ 已推送
)

:: ========== Step 3: 服务健康检查 ==========
echo [3/6] 服务健康检查...
python -c "import urllib.request; r=urllib.request.urlopen('http://localhost:8080/api/health/check',timeout=5); print('  ✅ 服务正常'); import sys; sys.exit(0)" 2>nul
if errorlevel 1 (
    echo   ⚠ 服务可能未运行或不可达
)

:: ========== Step 4: 数据库备份 ==========
echo [4/6] 执行数据库 WAL checkpoint + 备份...
python -c "import sqlite3,shutil,datetime; conn=sqlite3.connect('data/prompts.db'); conn.execute('PRAGMA wal_checkpoint(TRUNCATE)'); conn.close(); print('  ✅ WAL checkpoint 完成')" 2>nul
set BACKUP_NAME=data\backups\prompts_%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%.db
set BACKUP_NAME=%BACKUP_NAME: =0%
copy /Y data\prompts.db "%BACKUP_NAME%" >nul
if exist "%BACKUP_NAME%" (
    echo   ✅ 数据库备份: %BACKUP_NAME%
) else (
    echo   ⚠ 备份失败
)

:: ========== Step 5: 生成并发送日报 ==========
echo [5/6] 生成并发送开发日报...
python backend\daily_report.py --send --date %date:~0,4%-%date:~5,2%-%date:~8,2% 2>&1
set REPORT_RESULT=%errorlevel%
if %REPORT_RESULT% EQU 0 (
    echo   ✅ 日报已发送
) else (
    echo   ❌ 日报发送失败 (exit code: %REPORT_RESULT%)
    echo   请检查 .env.mail 配置: 邮箱地址 + 授权码
)

:: ========== Step 6: 停止服务 ==========
echo [6/6] 提示关机...
echo.
echo ╔══════════════════════════════════════════════╗
echo ║  所有步骤完成，可以安全关机了！              ║
echo ╚══════════════════════════════════════════════╝
echo.
echo 按任意键关闭此窗口...
pause >nul
