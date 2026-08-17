# ============================================================
#  MikPromptKit 咪卡词库 · 一键启动（开发版 v2 · 防御增强）
#  双击后自动: 版本检测 -> 环境自检 -> 实例检测 -> 启动验证 -> 浏览器
#  防御设计:
#    - 版本多源对照 (git describe --always / VERSION 文件 / tag 领先数)
#    - Python stub 过滤 + 版本下限校验
#    - 磁盘空间 / 数据库完整性 / 并发双击防抖
#    - 启动失败自动收集日志尾部, 无需用户翻文件
#    - HTTP 层健康检查 (端口通 != 应用正常)
#    - 防火墙入站规则检测 (局域网可达性)
# ============================================================

# --- 控制台 UTF-8（保证中文与 git 输出正常） ---
try { chcp 65001 | Out-Null } catch {}
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$ErrorActionPreference = "Continue"

$ROOT       = $PSScriptRoot
$PORT       = 8080
$URL        = "http://127.0.0.1:$PORT"
$DB         = Join-Path $ROOT "data\prompts.db"
$STDOUT_LOG = Join-Path $ROOT "data\start_dev_stdout.log"
$STDERR_LOG = Join-Path $ROOT "data\start_dev_stderr.log"

function Write-Step($msg)  { Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    [!]  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "    [X]  $msg" -ForegroundColor Red }
function Exit-Box($msg) {
    if ($msg) { Write-Fail $msg }
    Write-Host ""
    Read-Host "按回车键退出"
    exit 1
}
function Show-Tail($file, $lines = 25) {
    if (Test-Path $file) {
        Write-Host "    --- $file (尾部 $lines 行) ---" -ForegroundColor Yellow
        Get-Content $file -Tail $lines -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
    }
}
function Show-Diagnosis($file) {
    if (-not (Test-Path $file)) { return }
    $joined = ((Get-Content $file -Tail 80 -ErrorAction SilentlyContinue) -join "`n")
    if ($joined -match "ModuleNotFoundError|No module named") { Write-Host "    [诊断] 依赖缺失 → 运行: $py -m pip install -r requirements.txt" -ForegroundColor Yellow }
    elseif ($joined -match "address already in use|WinError 10048") { Write-Host "    [诊断] 端口被占用 → 结束占用进程或修改 PORT 后重试" -ForegroundColor Yellow }
    elseif ($joined -match "database is locked") { Write-Host "    [诊断] 数据库被锁 → 稍后重试，或重启机器释放锁" -ForegroundColor Yellow }
    elseif ($joined -match "SyntaxError|Traceback") { Write-Host "    [诊断] 代码/配置异常 → 查看上方 Traceback 定位问题" -ForegroundColor Yellow }
    elseif ($joined -match "disk|space|No space") { Write-Host "    [诊断] 磁盘空间不足 → 清理磁盘后重试" -ForegroundColor Yellow }
}
function Get-FirstLine($str) {
    if ($str -is [array]) { $str = $str[0] }
    if ($null -eq $str) { return "" }
    return ($str.ToString().Trim())
}

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "   MikPromptKit 咪卡词库 · 一键启动" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan

# ---------- 1/5 版本检测（多源对照，防识别错误） ----------
Write-Step "1/5 版本检测（当前开发版本）"
$gitOk = $false
if (Get-Command git -ErrorAction SilentlyContinue) { $gitOk = $true }
$curTag = ""; $commit = ""; $branch = ""; $describe = ""; $fileVer = ""

if ($gitOk) {
    $describe = Get-FirstLine (git -C $ROOT describe --tags --always --dirty 2>$null)
    $curTag   = Get-FirstLine (git -C $ROOT describe --tags --abbrev=0 2>$null)
    $commit   = Get-FirstLine (git -C $ROOT log -1 --format="%h %s" 2>$null)
    $branch   = Get-FirstLine (git -C $ROOT branch --show-current 2>$null)
}

# VERSION 文件（.NET 读取自动剥 BOM）与 git tag 对照
$verFile = Join-Path $ROOT "VERSION"
if (Test-Path $verFile) {
    try { $fileVer = [System.IO.File]::ReadAllText($verFile).Trim() } catch {}
}
if ($fileVer -and $curTag -and ($fileVer -ne $curTag)) {
    Write-Warn "VERSION 文件 ($fileVer) 与 git tag ($curTag) 不一致，以 git 为准"
}

if (-not $gitOk) {
    Write-Warn "git 不可用，版本回退到 VERSION 文件"
    Write-Host "    版本    : $(if ($fileVer) { $fileVer } else { 'unknown' })" -ForegroundColor White
} elseif (-not $curTag) {
    # 裸开发状态（从未打 tag）——describe --always 输出短 commit
    Write-Host "    版本    : 开发版（无 tag）$describe" -ForegroundColor White
} else {
    # 距最近 tag 的提交数：开发中打 commit 未打 tag 时明确标注"领先 N"
    $ahead = Get-FirstLine (git -C $ROOT rev-list --count "$curTag..HEAD" 2>$null)
    if ($ahead -match "^\d+$" -and [int]$ahead -gt 0) {
        Write-Host "    版本    : $curTag + $ahead commits（最新开发版，未打 tag）" -ForegroundColor White
    } else {
        Write-Host "    版本    : $curTag（正式版本）" -ForegroundColor White
    }
}
if ($commit) { Write-Host "    Commit  : $commit" -ForegroundColor Gray }
if ($branch) {
    Write-Host "    分支    : $branch" -ForegroundColor Gray
    # 与 origin 同步检查
    $local  = Get-FirstLine (git -C $ROOT rev-parse HEAD 2>$null)
    $remote = Get-FirstLine (git -C $ROOT rev-parse "origin/$branch" 2>$null)
    if ($remote -and $local -and ($remote -ne $local)) {
        $ab = Get-FirstLine (git -C $ROOT rev-list --left-right --count "HEAD...origin/$branch" 2>$null)
        if ($ab -match "^\d+\s+\d+$") {
            $p = $ab -split "\s+"
            Write-Warn "本地落后 origin/$branch（领先 $($p[0]) / 落后 $($p[1])），建议 git pull 后重启"
        } else { Write-Warn "本地与 origin/$branch 不同步" }
    } else { Write-Ok "与 origin/$branch 同步" }
} elseif ($gitOk) {
    Write-Warn "HEAD detached（不在任何分支上），跳过远端同步检查"
}

# ---------- 2/5 环境健康自检 ----------
Write-Step "2/5 环境健康自检"

# 磁盘空间（SQLite 写库失败的前置杀手）
$driveName = (Split-Path $ROOT -Qualifier).TrimEnd(':')
$disk = Get-PSDrive -Name $driveName -ErrorAction SilentlyContinue
if ($disk) {
    $freeGB = [math]::Round($disk.Free / 1GB, 1)
    if ($disk.Free -lt 500MB) { Write-Fail "磁盘剩余仅 $freeGB GB，SQLite 写入可能失败，请先清理磁盘" }
    elseif ($disk.Free -lt 2GB) { Write-Warn "磁盘剩余 $freeGB GB，建议清理" }
    else { Write-Ok "磁盘剩余 $freeGB GB" }
}

# WAL 文件大小（SQLite 异常退出时膨胀，服务启动后自动 checkpoint 回收）
$walFile = "$DB-wal"
if (Test-Path $walFile) {
    $walMB = [math]::Round((Get-Item $walFile).Length / 1MB, 1)
    if ($walMB -gt 100) { Write-Warn "WAL 文件 ${walMB}MB 偏大（可能上次异常退出），服务启动后会自动 checkpoint 回收" }
    elseif ($walMB -gt 10) { Write-Host "    WAL 文件 ${walMB}MB（正常范围）" -ForegroundColor Gray }
}

# Python 真实解释器（过滤 stub + 版本下限 >= 3.10）
$py = $null
$candidates = @()
$cmdPy = Get-Command python -ErrorAction SilentlyContinue
if ($cmdPy) { $candidates += $cmdPy.Source }
$candidates += "C:\Users\admin\AppData\Local\Python\bin\python.exe"
foreach ($c in ($candidates | Select-Object -Unique)) {
    if (-not $c -or -not (Test-Path $c)) { continue }
    if ($c -match "WindowsApps") { Write-Warn "跳过 WindowsApps store stub: $c"; continue }
    $verOut = Get-FirstLine (& $c -c "import sys;print(sys.version_info.major, sys.version_info.minor, sys.version.split()[0])" 2>$null)
    if ($verOut -match "^(\d+) (\d+) (.+)$") {
        $pyMajor = [int]$matches[1]; $pyMinor = [int]$matches[2]; $pyVerStr = $matches[3]
        if ($pyMajor -lt 3 -or ($pyMajor -eq 3 -and $pyMinor -lt 10)) {
            Write-Fail "Python 版本过低: $pyVerStr（项目要求 >= 3.10）"
        } else {
            $py = $c; Write-Ok "Python $pyVerStr ($py)"; break
        }
    }
}
if (-not $py) { Exit-Box "未找到可用的 Python 解释器" }

# 关键目录/文件
if (-not (Test-Path (Join-Path $ROOT "data"))) { Exit-Box "data/ 目录缺失，请检查项目完整性" }
if (-not (Test-Path $DB)) { Exit-Box "数据库不存在: $DB" }

# 依赖检查（失败自动安装）
& $py -c "import fastapi, uvicorn" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Warn "依赖缺失，正在安装 requirements.txt ..."
    & $py -m pip install -r "$ROOT\requirements.txt" -q 2>$null
    if ($LASTEXITCODE -ne 0) { Exit-Box "依赖安装失败，请手动执行: $py -m pip install -r requirements.txt" }
}
Write-Ok "依赖就绪 (fastapi / uvicorn)"

# 数据库完整性（integrity_check + 核心表计数）
$healthPy = @'
import sqlite3, sys
sys.stdout.reconfigure(encoding='utf-8')
db = sys.argv[1]
try:
    conn = sqlite3.connect(db, timeout=5)
    row = conn.execute('PRAGMA integrity_check').fetchone()
    print('integrity:' + str(row[0]))
    for t in ('word_card', 'prompts', 'cards'):
        try:
            print('count_%s:%d' % (t, conn.execute('SELECT COUNT(*) FROM ' + t).fetchone()[0]))
        except Exception:
            print('count_%s:N/A(无此表)' % t)
    conn.close()
except Exception as e:
    print('integrity:ERROR %s' % e)
    sys.exit(1)
'@
$dbOut = & $py -c $healthPy $DB 2>$null
if ($LASTEXITCODE -eq 0 -and ($dbOut | Select-String "integrity:ok")) {
    Write-Ok "数据库完整性通过 (integrity_check: ok)"
    foreach ($l in $dbOut) {
        if ($l -match "^count_(\w+):(.+)$") { Write-Host "      $($matches[1]) : $($matches[2])" -ForegroundColor Gray }
    }
} else {
    Exit-Box "数据库自检异常: $($dbOut -join ' ')"
}

# ---------- 3/5 端口与实例检测（防并发双击） ----------
Write-Step "3/5 端口与实例检测"
$alreadyRunning = $false
$listener = netstat -ano | Select-String ":$PORT\s" | Select-String "LISTENING"
if ($listener) {
    $pidStr = (($listener[0].ToString().Trim()) -split "\s+")[-1]
    $proc = Get-Process -Id $pidStr -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -match "python") {
        Write-Warn "端口 $PORT 已被本服务占用 (PID $pidStr)，跳过启动"
        $alreadyRunning = $true
    } else {
        $occPath = ""; $occStart = ""
        try { $occPath = (Get-Process -Id $pidStr -ErrorAction SilentlyContinue).Path } catch {}
        try { $occStart = (Get-Process -Id $pidStr -ErrorAction SilentlyContinue).StartTime.ToString("yyyy-MM-dd HH:mm:ss") } catch {}
        Write-Host "    占用进程: $($proc.ProcessName) (PID $pidStr)" -ForegroundColor Yellow
        if ($occPath) { Write-Host "    程序路径: $occPath" -ForegroundColor Gray }
        if ($occStart) { Write-Host "    启动时间: $occStart" -ForegroundColor Gray }
        Write-Host "    处理建议: 残留进程请 taskkill /PID $pidStr /F；其他程序请修改 PORT 后重试" -ForegroundColor Yellow
        Exit-Box "端口 $PORT 被其他程序占用，请先释放该端口"
    }
} else {
    # 端口未监听但已有 main.py 进程 → 服务正在启动中（防并发双击重复拉起）
    $mainProcs = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match "backend[\\/]main\.py" })
    if ($mainProcs.Count -gt 0) {
        Write-Warn "检测到服务进程已在启动中 (PID $($mainProcs[0].ProcessId))，等待就绪..."
        $alreadyRunning = $true
    }
}

# ---------- 4/5 启动与就绪验证 ----------
Write-Step "4/5 服务启动"
if (-not $alreadyRunning) {
    Write-Host "    启动服务（后台运行，日志: data/start_dev_*.log）..." -ForegroundColor Gray
    $env:PORT = "$PORT"
    $env:PK_ENFORCE_AUTH = "1"
    $p = Start-Process -FilePath $py -ArgumentList "backend/main.py" -WorkingDirectory $ROOT -WindowStyle Hidden `
         -RedirectStandardOutput $STDOUT_LOG -RedirectStandardError $STDERR_LOG -PassThru
    Start-Sleep -Seconds 3
    if ($p.HasExited) {
        Write-Fail "服务进程启动即退出 (code $($p.ExitCode))"
        Show-Tail $STDERR_LOG; Show-Tail $STDOUT_LOG; Show-Tail (Join-Path $ROOT "data\server_stderr.log")
        Show-Diagnosis $STDERR_LOG
        Exit-Box
    }
    Write-Host "    等待服务就绪（启动时可能重建语义索引，最多 120 秒）..." -ForegroundColor Gray
} else {
    Write-Host "    已有服务进程/端口，等待就绪（最多 120 秒）..." -ForegroundColor Gray
}
# 统一等待端口就绪（新启动与已运行场景都验证，防止"误报就绪"）
$ready = $false
for ($i = 0; $i -lt 120; $i++) {
    if ($p -and $p.HasExited) { break }
    if (netstat -ano | Select-String ":$PORT\s" | Select-String "LISTENING") { $ready = $true; break }
    if ($i % 10 -eq 9) { Write-Host "      ...已等待 $($i + 1) 秒" -ForegroundColor DarkGray }
    Start-Sleep -Seconds 1
}
if (-not $ready) {
    Write-Fail "等待端口 $PORT 就绪超时（120 秒）"
    if ($p -and $p.HasExited) { Write-Fail "服务进程已退出 (code $($p.ExitCode))" }
    Show-Tail $STDERR_LOG; Show-Tail $STDOUT_LOG; Show-Tail (Join-Path $ROOT "data\server_stderr.log")
    Show-Diagnosis $STDERR_LOG
    Exit-Box
}
Write-Ok "服务已就绪，监听 0.0.0.0:$PORT"

# 记录服务 PID（供停止/诊断脚本使用）
$ln0 = netstat -ano | Select-String ":$PORT\s" | Select-String "LISTENING"
if ($ln0) {
    $svcPid = (($ln0[0].ToString().Trim()) -split "\s+")[-1]
    try { Set-Content -Path (Join-Path $ROOT "data\server.pid") -Value $svcPid -Encoding ASCII } catch {}
    Write-Host "    服务 PID: $svcPid（已写入 data\server.pid）" -ForegroundColor Gray
}

# 就绪后短窗二次确认（防"端口一闪而过"的启动即崩）
Start-Sleep -Seconds 2
if (-not (netstat -ano | Select-String ":$PORT\s" | Select-String "LISTENING")) {
    Write-Warn "服务端口在就绪后消失，疑似进程崩溃，请查看 data/start_dev_stderr.log"
}

# 强力加固: 就绪后存活探针（8 秒后端口仍在 = 稳定；崩溃则自动重启一次）
Start-Sleep -Seconds 8
if (-not (netstat -ano | Select-String ":$PORT\s" | Select-String "LISTENING")) {
    Write-Warn "检测到服务崩溃，自动重启一次..."
    Start-Process -FilePath $py -ArgumentList "backend/main.py" -WorkingDirectory $ROOT -WindowStyle Hidden `
         -RedirectStandardOutput $STDOUT_LOG -RedirectStandardError $STDERR_LOG | Out-Null
    Start-Sleep -Seconds 12
    if (netstat -ano | Select-String ":$PORT\s" | Select-String "LISTENING") { Write-Ok "自动重启成功" }
    else {
        Write-Fail "自动重启失败，请查看日志"
        Show-Tail $STDERR_LOG; Show-Diagnosis $STDERR_LOG
    }
}

# HTTP 层健康检查（/api/health/check JSON：error_count=0 视为健康；ComfyUI 未启动属正常 warning）
$healthJson = $null
for ($i = 0; $i -lt 6; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "$URL/api/health/check" -UseBasicParsing -TimeoutSec 10
        if ($resp.StatusCode -eq 200) {
            try { $healthJson = $resp.Content | ConvertFrom-Json } catch {}
            break
        }
    } catch {}
    if ($i -lt 5) {
        Write-Host "      健康检查第 $($i + 1) 次未就绪（启动期索引重建属正常），5 秒后重试..." -ForegroundColor DarkGray
        Start-Sleep -Seconds 5
    }
}
if ($healthJson) {
    $errN = [int]$healthJson.error_count
    if ($errN -eq 0) { Write-Ok "健康检查通过 (checked $($healthJson.checked)/$($healthJson.total_checks), error 0)" }
    else { Write-Warn "健康检查异常: error_count=$errN" }
    foreach ($ck in ($healthJson.results.PSObject.Properties)) {
        $v = $ck.Value
        if (-not $v.ok) {
            $hint = ""; if ($v.hint) { $hint = " · $($v.hint)" }
            Write-Host "      ⚠ $($v.label): 未通过$hint" -ForegroundColor Yellow
        }
    }
    if ([int]$healthJson.skipped -gt 0) { Write-Host "      跳过 $($healthJson.skipped) 项（可选服务未启动属正常）" -ForegroundColor Gray }
} else {
    Write-Warn "健康检查端点未就绪（服务可能仍在启动或异常），请查看 data/start_dev_stderr.log"
}

# ---------- 5/5 防火墙检查 + 打开浏览器 ----------
Write-Step "5/5 网络与浏览器"
$fwText = netsh advfirewall firewall show rule name=all dir=in 2>$null
if ($fwText -match "PromptKit") {
    Write-Ok "防火墙入站规则已存在 (PromptKit)"
} else {
    Write-Warn "未检测到 PromptKit 入站规则，局域网设备可能无法访问；可运行 firewall_open.bat 或管理员放行 TCP $PORT"
}

$lanIPs = @()
ipconfig | Select-String "IPv4" | ForEach-Object {
    if ($_ -match '(\d+\.\d+\.\d+\.\d+)') { $lanIPs += $matches[1] }
}
$lanIPs = @($lanIPs | Select-Object -Unique)
Write-Host "    本机访问 : $URL" -ForegroundColor Yellow
if ($lanIPs.Count) {
    foreach ($ip in $lanIPs) { Write-Host "    局域网   : http://$ip`:$PORT" -ForegroundColor Yellow }
    try {
        $r2 = Invoke-WebRequest -Uri "http://$($lanIPs[0])`:$PORT" -UseBasicParsing -TimeoutSec 6
        Write-Ok "局域网可达: http://$($lanIPs[0])`:$PORT ($($r2.StatusCode))"
    } catch {
        Write-Warn "局域网自测未通: http://$($lanIPs[0])`:$PORT（防火墙未放行或网络隔离）"
    }
} else {
    Write-Warn "未检测到 IPv4 地址，仅本机可访问"
}
try { Start-Process $URL } catch { Write-Warn "自动打开浏览器失败，请手动访问 $URL" }

Write-Host ""
Write-Host "  ✅ 启动完成。服务在后台运行，本窗口可最小化。" -ForegroundColor Green
Write-Host "  ℹ 停止服务：任务管理器结束 python 进程即可" -ForegroundColor Gray
Read-Host "`n按回车键关闭本窗口"
