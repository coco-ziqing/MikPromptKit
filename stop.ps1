# ============================================================
#  MikPromptKit 一键停止
#  先停看门狗（防自动重启），再停服务进程，兜底清理 main.py 残留
# ============================================================

$ErrorActionPreference = "Continue"
$ROOT = $PSScriptRoot
$PORT = 8080

Write-Host ""
Write-Host "  MikPromptKit 咪卡词库 · 一键停止" -ForegroundColor Cyan
Write-Host ""

# ---------- 1/3 停看门狗（先停，防止其自动重启服务） ----------
$wd = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "watchdog\.ps1" })
if ($wd.Count -gt 0) {
    foreach ($w in $wd) { Stop-Process -Id $w.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-Host "    [OK] 已停止看门狗 ($($wd.Count) 个进程)" -ForegroundColor Green
} else {
    Write-Host "    [--] 未发现看门狗进程" -ForegroundColor DarkGray
}

# ---------- 2/3 按 PID 文件停服务 ----------
$pidFile = Join-Path $ROOT "data\server.pid"
if (Test-Path $pidFile) {
    $svcPid = (Get-Content $pidFile -ErrorAction SilentlyContinue).Trim()
    if ($svcPid -match "^\d+$") {
        $p = Get-Process -Id $svcPid -ErrorAction SilentlyContinue
        if ($p) {
            Stop-Process -Id $svcPid -Force -ErrorAction SilentlyContinue
            Write-Host "    [OK] 已停止服务 (PID $svcPid)" -ForegroundColor Green
        } else {
            Write-Host "    [--] PID $svcPid 已不存在" -ForegroundColor DarkGray
        }
    }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
} else {
    Write-Host "    [--] 未找到 data\server.pid" -ForegroundColor DarkGray
}

# ---------- 3/3 兜底：命令行匹配 main.py 的残留进程 ----------
$mainProcs = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "backend[\\/]main\.py" })
foreach ($mp in $mainProcs) {
    Stop-Process -Id $mp.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "    [OK] 清理残留服务进程 (PID $($mp.ProcessId))" -ForegroundColor Green
}

# 验证端口已释放
Start-Sleep -Seconds 1
$listener = netstat -ano | Select-String ":$PORT\s" | Select-String "LISTENING"
if (-not $listener) {
    Write-Host "`n  [OK] 端口 8080 已释放，服务已停止。" -ForegroundColor Green
} else {
    Write-Host "`n  [!] 端口 8080 仍被占用，请检查。" -ForegroundColor Yellow
}

Write-Host ""
