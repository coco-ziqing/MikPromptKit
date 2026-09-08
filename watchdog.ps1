# ============================================================
#  MikPromptKit 服务看门狗（自愈）
#  监控 :8080 服务存活，崩溃自动重启（带重启风暴保护）
#  由 start_dev.ps1 在服务就绪后拉起；stop.ps1 先停本进程再停服务
# ============================================================

$ErrorActionPreference = "Continue"

$ROOT          = $PSScriptRoot
$PORT          = 8080
$PY            = "C:\Users\admin\AppData\Local\Python\bin\python.exe"
$LOG           = Join-Path $ROOT "data\watchdog.log"
$RST_STDOUT    = Join-Path $ROOT "data\watchdog_restart_stdout.log"
$RST_STDERR    = Join-Path $ROOT "data\watchdog_restart_stderr.log"

$INTERVAL      = 30     # 探测间隔（秒）
$FAIL_THRESHOLD = 3     # 连续失败次数阈值（约 90 秒失联判定崩溃）
$STORM_WINDOW  = 600    # 重启风暴窗口（秒，10 分钟）
$STORM_MAX     = 5      # 窗口内最大重启次数，超限停止（防重启风暴）

# ---------- 单实例检测（防 start_dev.ps1 重复拉起） ----------
$existing = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "watchdog\.ps1" -and $_.ProcessId -ne $PID })
if ($existing.Count -gt 0) {
    # 已有看门狗在跑，本实例直接退出
    exit 0
}

function Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] $msg"
    try { Add-Content -Path $LOG -Value $line -Encoding ASCII } catch {}
    # 日志轮转（1MB，防长期膨胀）
    try {
        if ((Get-Item $LOG).Length -gt 1MB) { Rename-Item $LOG "$LOG.old" -Force }
    } catch {}
}

function Test-ServiceAlive {
    # 端口监听 = 服务存活（最可靠的进程存活信号）
    $listening = netstat -ano | Select-String ":$PORT\s" | Select-String "LISTENING"
    return [bool]$listening
}

function Start-Service {
    $env:PORT = "$PORT"
    $env:PK_ENFORCE_AUTH = "1"
    $p = Start-Process -FilePath $PY -ArgumentList "-u", "backend/main.py" -WorkingDirectory $ROOT -WindowStyle Hidden `
         -RedirectStandardOutput $RST_STDOUT -RedirectStandardError $RST_STDERR -PassThru
    try { $p.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::BelowNormal } catch {}
    try { Set-Content -Path (Join-Path $ROOT "data\server.pid") -Value $p.Id -Encoding ASCII } catch {}
    return $p
}

Log "watchdog started (pid $PID), watching port $PORT, interval ${INTERVAL}s, threshold ${FAIL_THRESHOLD}"

$failCount = 0
$restartTimes = @()   # 重启时间戳（内存态，风暴保护用）

while ($true) {
    Start-Sleep -Seconds $INTERVAL

    if (Test-ServiceAlive) {
        if ($failCount -gt 0) { Log "service recovered (was down $failCount consecutive probes)" }
        $failCount = 0
        continue
    }

    $failCount++
    Log "probe #$failCount failed: port $PORT not listening"

    if ($failCount -lt $FAIL_THRESHOLD) { continue }

    # 达到阈值 → 自动重启
    $now = Get-Date
    $restartTimes = @($restartTimes | Where-Object { ($now - $_).TotalSeconds -lt $STORM_WINDOW })
    if ($restartTimes.Count -ge $STORM_MAX) {
        Log "RESTART STORM: $STORM_MAX restarts within ${STORM_WINDOW}s, watchdog exiting for manual intervention"
        exit 1
    }

    Log "service lost ($failCount consecutive probes), auto-restarting..."
    $restartTimes += $now
    Start-Service
    $failCount = 0
    Log "service restarted, waiting for readiness..."
}

Log "watchdog exited"
