# 一键放行防火墙端口 8080
# 右键 → "使用 PowerShell 运行" → 自动提权

# 自动提权到管理员
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "正在请求管理员权限..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

Write-Host "[OK] 管理员权限已获取" -ForegroundColor Green

# 添加防火墙入站规则
Write-Host "添加防火墙规则: TCP 8080 端口入站允许..." -ForegroundColor Cyan
netsh advfirewall firewall add rule name="咪卡MiK 8080" dir=in action=allow protocol=TCP localport=8080

# 验证
$rule = netsh advfirewall firewall show rule name="咪卡MiK 8080" 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] 防火墙规则已生效" -ForegroundColor Green
} else {
    Write-Host "[!] 规则添加失败" -ForegroundColor Red
}

Write-Host ""
Write-Host "=================================" -ForegroundColor Cyan
Write-Host " 完成！现在尝试访问：" -ForegroundColor Green
Write-Host " http://192.168.0.103:8080" -ForegroundColor White
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "如果仍无法访问，检查杀毒软件(360/火绒/腾讯管家)" -ForegroundColor Yellow
Write-Host "在杀毒软件 → 防火墙设置 → 放行 8080 端口或 python.exe" -ForegroundColor Yellow
pause
