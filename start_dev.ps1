# ============================================================
#  MikPromptKit 咪卡词库 · 一键启动（开发版）
#  双击后自动: 版本检测 -> 健康自检 -> 后台启动 -> 打开浏览器
# ============================================================

# --- 控制台 UTF-8（保证中文与 git 输出正常） ---
try { chcp 65001 | Out-Null } catch {}
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$ErrorActionPreference = "Continue"

$ROOT = $PSScriptRoot
$PORT = 8080
$URL  = "http://127.0.0.1:$PORT"

function Write-Step($msg)  { Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    [!]  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "    [X]  $msg" -ForegroundColor Red }
function Exit-Box($msg)   { Write-Host ""; Read-Host "按回车键退出"; exit 1 }

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "   MikPromptKit 咪卡词库 · 一键启动" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan

# ---------- 1/4 版本检测 ----------
Write-Step "1/4 版本检测（当前开发版本）"
$ver = "unknown"; $commit = ""; $branch = ""
if (Get-Command git -ErrorAction SilentlyContinue) {
    $ver    = git -C $ROOT describe --tags --abbrev=0 2>$null | Select-Object -First 1
    $commit = git -C $ROOT log -1 --format="%h %s" 2>$null | Select-Object -First 1
    $branch = git -C $ROOT branch --show-current 2>$null | Select-Object -First 1
    if ($ver)    { $ver    = $ver.Trim() }    else { $ver = "dev" }
    if ($commit) { $commit = $commit.Trim() }
    if ($branch) { $branch = $branch.Trim() }
    $local  = git -C $ROOT rev-parse HEAD 2>$null | Select-Object -First 1
    $remote = git -C $ROOT rev-parse "origin/$branch" 2>$null | Select-Object -First 1
    if ($remote -and $local -and ($remote.Trim() -ne $local.Trim())) {
        $ab = git -C $ROOT rev-list --left-right --count "HEAD...origin/$branch" 2>$null | Select-Object -First 1
        $ab = ($ab -replace "\s+", " ").Trim()
        if ($ab -match "^\d+ \d+$") {
            $p = $ab -split " "
            Write-Warn "本地落后于 origin/$branch（领先 $($p[0]) / 落后 $($p[1])），建议 git pull 后重启"
        } else {
            Write-Warn "本地与 origin/$branch 不同步"
        }
    } else {
        Write-Ok "与 origin/$branch 同步"
    }
} else {
    Write-Warn "未找到 git，跳过版本检测"
}
Write-Host "    版本    : $ver" -ForegroundColor White
if ($commit) { Write-Host "    Commit  : $commit" -ForegroundColor Gray }
if ($branch) { Write-Host "    分支    : $branch" -ForegroundColor Gray }

# ---------- 2/4 健康自检 ----------
Write-Step "2/4 健康自检"

# Python 解释器（优先真实路径，避开 WindowsApps store stub）
$py = $null
$candidates = @()
$cmdPy = Get-Command python -ErrorAction SilentlyContinue
if ($cmdPy) { $candidates += $cmdPy.Source }
$candidates += "C:\Users\admin\AppData\Local\Python\bin\python.exe"
foreach ($c in ($candidates | Select-Object -Unique)) {
    if (-not $c -or -not (Test-Path $c)) { continue }
    if ($c -match "WindowsApps") { Write-Warn "跳过 WindowsApps store stub: $c"; continue }
    $v = & $c -c "import sys;print(sys.version.split()[0])" 2>$null | Select-Object -First 1
    if ($v) { $py = $c; Write-Ok "Python $v" ; break }
}
if (-not $py) { Write-Fail "未找到可用的 Python 解释器"; Exit-Box }

# 依赖检查
& $py -c "import fastapi, uvicorn" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Warn "依赖缺失，正在安装 requirements.txt ..."
    & $py -m pip install -r "$ROOT\requirements.txt" -q 2>$null
    if ($LASTEXITCODE -ne 0) { Write-Fail "依赖安装失败，请手动执行 pip install -r requirements.txt"; Exit-Box }
}
Write-Ok "依赖就绪 (fastapi / uvicorn)"

# 数据库完整性自检（PRAGMA integrity_check + 核心表计数）
$db = Join-Path $ROOT "data\prompts.db"
if (-not (Test-Path $db)) { Write-Fail "数据库不存在: $db"; Exit-Box }
$healthPy = @'
import sqlite3, sys
db = sys.argv[1]
try:
    conn = sqlite3.connect(db, timeout=5)
    row = conn.execute('PRAGMA integrity_check').fetchone()
    print('integrity:' + str(row[0]))
    for t in ('word_card', 'prompts', 'cards'):
        try:
            print('count_%s:%d' % (t, conn.execute('SELECT COUNT(*) FROM ' + t).fetchone()[0]))
        except Exception:
            print('count_%s:N/A' % t)
    conn.close()
except Exception as e:
    print('integrity:ERROR %s' % e)
    sys.exit(1)
'@
$dbOut = & $py -c $healthPy $db 2>$null
if ($LASTEXITCODE -eq 0 -and ($dbOut | Select-String "integrity:ok")) {
    Write-Ok "数据库完整性通过 (integrity_check: ok)"
    foreach ($l in $dbOut) {
        if ($l -match "^count_(\w+):(.+)$") {
            $t = $matches[1]; $n = $matches[2]
            Write-Host "      $t : $n" -ForegroundColor Gray
        }
    }
} else {
    Write-Fail "数据库自检异常: $($dbOut -join ' ')"
    Exit-Box
}

# ---------- 3/4 服务启动 ----------
Write-Step "3/4 服务启动"
$alreadyRunning = $false
$listener = netstat -ano | Select-String ":$PORT\s" | Select-String "LISTENING"
if ($listener) {
    $line = $listener[0].ToString().Trim()
    $pidStr = ($line -split "\s+")[-1]
    $proc = Get-Process -Id $pidStr -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -match "python") {
        Write-Warn "端口 $PORT 已被本服务占用 (PID $pidStr)，跳过启动"
        $alreadyRunning = $true
    } else {
        Write-Fail "端口 $PORT 被其他程序占用: $($proc.ProcessName) (PID $pidStr)"
        Exit-Box
    }
}
if (-not $alreadyRunning) {
    Write-Host "    启动服务（后台运行，日志写入 data/）..." -ForegroundColor Gray
    $env:PORT = "$PORT"
    $env:PK_ENFORCE_AUTH = "1"
    $p = Start-Process -FilePath $py -ArgumentList "backend/main.py" -WorkingDirectory $ROOT -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 3
    if ($p.HasExited) {
        Write-Fail "服务进程异常退出 (code $($p.ExitCode))，请查看 data/server_stderr.log"
        Exit-Box
    }
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        if (netstat -ano | Select-String ":$PORT\s" | Select-String "LISTENING") { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) {
        Write-Fail "等待端口 $PORT 就绪超时（60 秒），请查看 data/server_stderr.log"
        Exit-Box
    }
}
Write-Ok "服务已就绪，监听 0.0.0.0:$PORT"

# 局域网 IP（优先 192.168.0.x）
$lanIP = "127.0.0.1"
ipconfig | Select-String "IPv4" | ForEach-Object {
    if ($_ -match '(\d+\.\d+\.\d+\.\d+)') {
        $ip = $matches[1]
        if ($ip -match '^192\.168\.0\.') { $lanIP = $ip }
    }
}

# ---------- 4/4 打开浏览器 ----------
Write-Step "4/4 打开浏览器"
Write-Host "    本机访问 : $URL" -ForegroundColor Yellow
Write-Host "    局域网   : http://$lanIP`:$PORT" -ForegroundColor Yellow
try { Start-Process $URL } catch { Write-Warn "自动打开浏览器失败，请手动访问 $URL" }

Write-Host ""
Write-Host "  ✅ 启动完成。服务在后台运行，本窗口可最小化。" -ForegroundColor Green
Write-Host "  ℹ 停止服务：任务管理器结束 python 进程即可" -ForegroundColor Gray
Read-Host "`n按回车键关闭本窗口"
