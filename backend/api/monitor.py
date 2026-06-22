"""
v4.0.0-phase12: Service Runtime Monitor API
服务启动监测 — 实时运行时指标 + 健康状态 + 请求统计
"""
import os, sys, time, json, asyncio, threading, datetime, socket
from fastapi import APIRouter, Query

router = APIRouter(prefix="/api/monitor", tags=["monitor"])

# ============ 全局运行时状态 ============
START_TIME = time.time()
START_DATETIME = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

_request_stats = {
    "total": 0,
    "by_path": {},
    "by_method": {},
    "last_requests": [],  # 最近 50 条
    "errors": 0,
    "_lock": threading.Lock(),
}

_process_info = {
    "pid": os.getpid(),
    "python": sys.version.split()[0],
    "platform": sys.platform,
    "cwd": os.getcwd(),
}


def record_request(method: str, path: str, status: int, duration_ms: float):
    """记录每次 HTTP 请求（由中间件调用）"""
    with _request_stats["_lock"]:
        _request_stats["total"] += 1
        _request_stats["by_method"][method] = _request_stats["by_method"].get(method, 0) + 1

        # 简化路径（去掉动态段和 query）
        short_path = _simplify_path(path)
        _request_stats["by_path"][short_path] = _request_stats["by_path"].get(short_path, 0) + 1

        if status >= 400:
            _request_stats["errors"] += 1

        # 最近请求
        _request_stats["last_requests"].append({
            "method": method,
            "path": short_path,
            "status": status,
            "duration_ms": round(duration_ms, 1),
            "time": datetime.datetime.now().strftime("%H:%M:%S"),
        })
        if len(_request_stats["last_requests"]) > 50:
            _request_stats["last_requests"] = _request_stats["last_requests"][-50:]


def _simplify_path(path: str) -> str:
    """将 /api/prompts/123 简化为 /api/prompts/:id"""
    parts = path.split("/")
    out = []
    for p in parts:
        if not p:
            continue
        if p.isdigit() or (len(p) == 36 and p.count("-") == 4):
            out.append(":id")
        else:
            out.append(p)
    return "/" + "/".join(out)


# ============ 系统资源采集 ============

def _get_memory_info() -> dict:
    """获取进程内存信息"""
    try:
        import psutil
        proc = psutil.Process(os.getpid())
        mem = proc.memory_info()
        sys_mem = psutil.virtual_memory()
        return {
            "process_rss_mb": round(mem.rss / (1024 ** 2), 1),
            "process_vms_mb": round(mem.vms / (1024 ** 2), 1),
            "process_pct": round(proc.memory_percent(), 2),
            "system_total_gb": round(sys_mem.total / (1024 ** 3), 1),
            "system_used_gb": round(sys_mem.used / (1024 ** 3), 1),
            "system_available_gb": round(sys_mem.available / (1024 ** 3), 1),
            "system_pct": sys_mem.percent,
        }
    except Exception:
        return {"error": "psutil 不可用"}


def _get_cpu_info() -> dict:
    """获取 CPU 使用率"""
    try:
        import psutil
        proc = psutil.Process(os.getpid())
        return {
            "process_pct": round(proc.cpu_percent(interval=0.1), 1),
            "system_pct": round(psutil.cpu_percent(interval=0.1), 1),
            "cpu_count": psutil.cpu_count(),
            "cpu_count_logical": psutil.cpu_count(logical=True),
        }
    except Exception:
        return {"error": "psutil 不可用"}


def _get_uptime() -> dict:
    """获取服务运行时间"""
    elapsed = time.time() - START_TIME
    days, rem = divmod(int(elapsed), 86400)
    hours, rem = divmod(rem, 3600)
    minutes, seconds = divmod(rem, 60)
    parts = []
    if days: parts.append(f"{days}d")
    if hours: parts.append(f"{hours}h")
    if minutes: parts.append(f"{minutes}m")
    parts.append(f"{seconds}s")
    return {
        "seconds": round(elapsed, 1),
        "readable": " ".join(parts),
        "start_time": START_DATETIME,
        "start_timestamp": START_TIME,
    }


def _get_request_summary() -> dict:
    """获取请求统计摘要"""
    with _request_stats["_lock"]:
        # Top 10 paths
        sorted_paths = sorted(_request_stats["by_path"].items(), key=lambda x: -x[1])[:10]
        return {
            "total": _request_stats["total"],
            "errors": _request_stats["errors"],
            "by_method": dict(_request_stats["by_method"]),
            "top_paths": [{"path": p, "count": c} for p, c in sorted_paths],
            "recent": list(_request_stats["last_requests"][-20:]),
        }


def _get_network_info() -> dict:
    """获取网络接口信息"""
    try:
        import psutil
        net = psutil.net_io_counters()
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        lan_ip = s.getsockname()[0]
        s.close()
        return {
            "lan_ip": lan_ip,
            "bytes_sent_mb": round(net.bytes_sent / (1024 ** 2), 1),
            "bytes_recv_mb": round(net.bytes_recv / (1024 ** 2), 1),
            "packets_sent": net.packets_sent,
            "packets_recv": net.packets_recv,
        }
    except Exception as e:
        return {"error": str(e)[:80]}


# ============ API 端点 ============

@router.get("/runtime")
def get_runtime():
    """获取当前运行时指标"""
    return {
        "ok": True,
        "timestamp": datetime.datetime.now().isoformat(),
        "uptime": _get_uptime(),
        "cpu": _get_cpu_info(),
        "memory": _get_memory_info(),
        "network": _get_network_info(),
        "process": _process_info,
        "requests": _get_request_summary(),
    }


@router.get("/health-snapshot")
async def get_health_snapshot(timeout: float = Query(5.0, ge=1.0, le=10.0)):
    """快速健康快照（含后台监听状态 + 轻量自检）"""
    from health import (
        _check_ollama, _check_comfyui, _check_semantic, _check_ffmpeg,
        _check_pillow, _check_database, _check_disk, _check_self_reachable, _check_playground_llm, _check_wal_integrity,
    )

    # 并行检测（不阻塞）
    results = {}
    checks = {
        "ollama": (_check_ollama, True),
        "comfyui": (_check_comfyui, True),
    }

    async_tasks = {}
    for key, (fn, _) in checks.items():
        async_tasks[key] = fn(timeout)

    # 同步检测（新增 wal, port→self_reachable）
    sync_checks = {
        "db": _check_database,
        "wal": _check_wal_integrity,
        "pillow": _check_pillow,
        "disk": _check_disk,
        "semantic": _check_semantic,
        "ffmpeg": _check_ffmpeg,
        "port": _check_self_reachable,
        "llm": _check_playground_llm,
    }

    for key, fn in sync_checks.items():
        try:
            results[key] = fn()
        except Exception as e:
            results[key] = {"ok": False, "error": str(e)[:100]}

    # 等待异步结果
    for key, task in async_tasks.items():
        try:
            results[key] = await task
        except Exception as e:
            results[key] = {"ok": False, "error": str(e)[:100]}

    all_ok = all(v.get("ok", False) for v in results.values())
    critical_ok = all(results[k].get("ok", False) for k in ["db", "port", "pillow", "disk"] if k in results)

    return {
        "ok": all_ok,
        "critical_ok": critical_ok,
        "timestamp": datetime.datetime.now().isoformat(),
        "results": results,
    }


@router.get("/dashboard")
async def get_dashboard(timeout: float = Query(5.0, ge=1.0, le=10.0)):
    """
    启动监测仪表盘 — 一站式聚合：
    - 运行时指标（CPU/内存/网络/uptime/请求统计）
    - 健康快照（所有外部依赖状态）
    - 后台监听器状态
    - 数据库统计
    """
    # 收集所有数据（并行化）
    runtime_data = {
        "uptime": _get_uptime(),
        "cpu": _get_cpu_info(),
        "memory": _get_memory_info(),
        "network": _get_network_info(),
        "process": _process_info,
        "requests": _get_request_summary(),
    }

    # 健康状态
    try:
        from health import _check_database, _check_pillow, _check_disk, _check_self_reachable, _check_ffmpeg, _check_wal_integrity
        from health import _check_ollama, _check_comfyui

        health_snapshot = {}
        for fn, key in [
            (_check_database, "db"),
            (_check_wal_integrity, "wal"),
            (_check_pillow, "pillow"),
            (_check_disk, "disk"),
            (_check_self_reachable, "port"),
            (_check_ffmpeg, "ffmpeg"),
        ]:
            try:
                health_snapshot[key] = fn()
            except Exception as e:
                health_snapshot[key] = {"ok": False, "error": str(e)[:80]}

        # Async
        try:
            health_snapshot["ollama"] = await _check_ollama(timeout)
        except Exception as e:
            health_snapshot["ollama"] = {"ok": False, "error": str(e)[:80]}
        try:
            health_snapshot["comfyui"] = await _check_comfyui(timeout)
        except Exception as e:
            health_snapshot["comfyui"] = {"ok": False, "error": str(e)[:80]}

    except Exception as e:
        health_snapshot = {"error": str(e)[:100]}

    # 后台监听器状态
    try:
        from health import _watch_status
        watch = {
            "ollama": dict(_watch_status["ollama"]),
            "comfyui": dict(_watch_status["comfyui"]),
            "running": _watch_status["running"],
        }
    except Exception:
        watch = None

    # 数据库统计
    try:
        from database import get_db
        db = get_db()
        db_stats = {
            "prompts": db.execute("SELECT COUNT(*) as c FROM prompts").fetchone()["c"],
            "cards": db.execute("SELECT COUNT(*) as c FROM prompt_cards WHERE is_deleted=0").fetchone()["c"],
            "cards_deleted": db.execute("SELECT COUNT(*) as c FROM prompt_cards WHERE is_deleted=1").fetchone()["c"],
            "library_assets": db.execute("SELECT COUNT(*) as c FROM library_assets").fetchone()["c"],
            "collections": db.execute("SELECT COUNT(*) as c FROM collections").fetchone()["c"],
            "wordpacks": db.execute("SELECT COUNT(*) as c FROM wordpacks").fetchone()["c"],
        }
        # WAL 文件大小
        from paths import get_data_dir
        db_path = os.path.join(get_data_dir(), "prompts.db")
        wal_path = db_path + "-wal"
        shm_path = db_path + "-shm"
        db_stats["db_size_mb"] = round(os.path.getsize(db_path) / (1024 ** 2), 2) if os.path.exists(db_path) else 0
        db_stats["wal_size_mb"] = round(os.path.getsize(wal_path) / (1024 ** 2), 2) if os.path.exists(wal_path) else 0
    except Exception as e:
        db_stats = {"error": str(e)[:80]}

    return {
        "ok": True,
        "timestamp": datetime.datetime.now().isoformat(),
        "runtime": runtime_data,
        "health": health_snapshot,
        "watcher": watch,
        "database": db_stats,
    }


@router.get("/history")
def get_monitor_history(limit: int = Query(100, ge=10, le=500)):
    """获取最近请求历史"""
    return {
        "ok": True,
        "total_requests": _request_stats["total"],
        "history": list(_request_stats["last_requests"][-limit:]),
    }


@router.post("/reset-stats")
def reset_request_stats():
    """重置请求计数器"""
    with _request_stats["_lock"]:
        _request_stats["total"] = 0
        _request_stats["by_path"] = {}
        _request_stats["by_method"] = {}
        _request_stats["last_requests"] = []
        _request_stats["errors"] = 0
    return {"ok": True, "message": "请求计数器已重置"}
