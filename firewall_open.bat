@echo off
chcp 65001 >nul
title 一键放行防火墙

:: 自身提权到管理员
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo 请求管理员权限...
    powershell Start-Process "%~0" -Verb RunAs
    exit /b
)

:: 已经以管理员运行
echo [OK] 管理员权限已获得
echo.
echo 添加防火墙规则：TCP 8080 端口入站允许...
netsh advfirewall firewall add rule name="PromptKit 8080" dir=in action=allow protocol=TCP localport=8080
echo.
echo 验证规则...
netsh advfirewall firewall show rule name="PromptKit 8080" | findstr "Rule|规则"
echo.
echo ============================================
echo  完成！现在局域网应可访问：
echo  http://192.168.0.103:8080
echo ============================================
pause
