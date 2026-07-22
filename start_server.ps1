# PromptKit 词库服务启动脚本
# 用法: 双击桌面快捷键 或 PowerShell 执行本脚本

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  [PromptKit] 词库服务启动中" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# 读取版本号
$ver = "v5"
$verFile = Join-Path $PSScriptRoot "VERSION"
if (Test-Path $verFile) {
    $ver = Get-Content $verFile -Raw -ErrorAction SilentlyContinue
    $ver = $ver.Trim()
}
Write-Host "  Version : $ver" -ForegroundColor Gray
Write-Host "  DB      : prompts.db (SQLite)" -ForegroundColor Gray
Write-Host ""

# 检查 Python
try {
    $pyVer = python --version 2>&1
    Write-Host "  Python  : $pyVer" -ForegroundColor Gray
} catch {
    Write-Host "  [ERROR] 未检测到 Python，请先安装 python.org" -ForegroundColor Red
    pause
    exit 1
}

# 确认依赖
python -c "import fastapi, uvicorn" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [*] 安装依赖中..." -ForegroundColor Yellow
    pip install -r "$PSScriptRoot\requirements.txt" -q
}
Write-Host "  [OK] 依赖已就绪" -ForegroundColor Green

# 检测可用端口 (8080 -> 8100)
$port = 8080
while ($port -le 8100) {
    $inUse = netstat -ano | Select-String ":$port "
    if (-not $inUse) { break }
    $port++
}
if ($port -gt 8100) {
    Write-Host "  [ERROR] 8080~8100 端口均被占用" -ForegroundColor Red
    pause
    exit 1
}
Write-Host "  [OK] 端口 $port 可用" -ForegroundColor Green

# 获取局域网 IP（优先 192.168.0.x，其次是其他 192.168.x.x，排除虚拟网卡）
$lanIP = "127.0.0.1"
$ipconfig = ipconfig
foreach ($line in $ipconfig) {
    if ($line -match 'IPv4.*:\s*(\d+\.\d+\.\d+\.\d+)') {
        $ip = $matches[1]
        if ($ip -match '^192\.168\.0\.') { $lanIP = $ip; break }
        if ($ip -match '^192\.168\.' -and $lanIP -eq "127.0.0.1") { $lanIP = $ip }
    }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  服务访问地址:" -ForegroundColor White
Write-Host "    本机        http://127.0.0.1:$port" -ForegroundColor Yellow
Write-Host "    局域网      http://$lanIP`:$port" -ForegroundColor Yellow
Write-Host ""
Write-Host "  提示: 手机/其他电脑访问失败?" -ForegroundColor Gray
Write-Host "  请 Windows 防火墙放行 TCP $port 端口" -ForegroundColor Gray
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  按 Ctrl+C 停止服务" -ForegroundColor Gray
Write-Host ""

# 设置环境变量并启动
$env:PORT = $port
$env:PK_ENFORCE_AUTH = "1"
Set-Location $PSScriptRoot
python backend/main.py

Write-Host ""
Write-Host "服务已停止。" -ForegroundColor Red
pause
