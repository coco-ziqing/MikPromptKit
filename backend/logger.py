"""
v4.3.0-phase16: Runtime Logging Engine
结构化日志 — SQLite 存储 + 级别过滤 + 来源标签 + 调用栈 + 前端实时流
"""
import traceback, json, time, threading, asyncio
from datetime import datetime
from typing import Optional

LEVELS = {"debug": 0, "info": 1, "warn": 2, "error": 3, "fatal": 4}
LEVEL_LABELS = {0: "DEBUG", 1: "INFO", 2: "WARN", 3: "ERROR", 4: "FATAL"}

# 内存缓冲区 — 最近 500 条供实时流
_buffer: list = []
_buffer_lock = threading.Lock()
_MAX_BUFFER = 500
_seq = 0

# 异步等待者 (SSE)
_listeners: list = []


def _init_table():
    from database import get_db
    db = get_db()
    db.execute("""
        CREATE TABLE IF NOT EXISTS runtime_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            seq INTEGER NOT NULL,
            level TEXT NOT NULL DEFAULT 'info',
            source TEXT NOT NULL DEFAULT 'system',
            message TEXT NOT NULL,
            detail TEXT DEFAULT '',
            stack TEXT DEFAULT '',
            path TEXT DEFAULT '',
            status_code INTEGER DEFAULT 0,
            elapsed_ms REAL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        )
    """)
    db.execute("CREATE INDEX IF NOT EXISTS idx_log_level ON runtime_log(level)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_log_source ON runtime_log(source)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_log_created ON runtime_log(created_at)")
    db.commit()


def log(level: str, message: str, source: str = "system", detail: str = "",
        stack: str = "", path: str = "", status_code: int = 0, elapsed_ms: float = 0):
    """核心日志写入"""
    global _seq
    level = level.lower()
    if level not in LEVELS:
        level = "info"

    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]

    entry = {
        "id": None,
        "seq": _seq,
        "level": level,
        "source": source,
        "message": message[:500],
        "detail": detail[:2000] if detail else "",
        "stack": stack[:3000] if stack else "",
        "path": path[:300] if path else "",
        "status_code": status_code,
        "elapsed_ms": round(elapsed_ms, 1),
        "created_at": ts,
        "timestamp": ts
    }

    # 写数据库
    try:
        from database import get_db
        db = get_db()
        db.execute(
            "INSERT INTO runtime_log (seq,level,source,message,detail,stack,path,status_code,elapsed_ms) VALUES (?,?,?,?,?,?,?,?,?)",
            [entry["seq"], entry["level"], entry["source"], entry["message"],
             entry["detail"], entry["stack"], entry["path"], entry["status_code"], entry["elapsed_ms"]]
        )
        db.commit()
    except Exception as e:
        print(f"[Logger] DB写入失败: {e}")

    # 写内存缓冲区
    with _buffer_lock:
        _seq += 1
        entry["id"] = _seq
        _buffer.append(entry)
        if len(_buffer) > _MAX_BUFFER:
            _buffer.pop(0)

    # 通知 SSE 监听者
    _notify_listeners(entry)

    # 控制台输出（去 emoji 避免 Windows GBK 编码崩溃）
    label = {"debug": ".", "info": "OK", "warn": "WARN", "error": "ERR", "fatal": "FATAL"}
    print(f"  [{label.get(level, '?')}] [{source}] {message}")


def debug(msg, source="system", **kwargs): log("debug", msg, source, **kwargs)
def info(msg, source="system", **kwargs):  log("info", msg, source, **kwargs)
def warn(msg, source="system", **kwargs):  log("warn", msg, source, **kwargs)
def error(msg, source="system", **kwargs): log("error", msg, source, **kwargs)
def fatal(msg, source="system", **kwargs): log("fatal", msg, source, **kwargs)


def capture_exception(e: Exception, source: str = "system", path: str = ""):
    """捕获异常并记录完整调用栈"""
    msg = f"{type(e).__name__}: {e}"
    stack = traceback.format_exc()
    error(msg, source=source, detail=str(e)[:1000], stack=stack, path=path)


def api_log(method: str, path: str, status: int, elapsed_ms: float, source: str = "api"):
    """记录 API 调用"""
    level = "error" if status >= 500 else ("warn" if status >= 400 else "info")
    if level == "info" and elapsed_ms < 100:
        return  # 正常的快响应不记日志（减少噪音）
    log(level, f"{method} {path} → {status} ({elapsed_ms:.0f}ms)", source=source,
        path=path, status_code=status, elapsed_ms=elapsed_ms)


def query(level: str = None, source: str = None, search: str = None,
          limit: int = 100, offset: int = 0, order: str = "desc") -> list:
    """查询日志"""
    try:
        from database import get_db
        db = get_db()
        where = []; params = []
        if level:
            where.append(f"level=?"); params.append(level)
        if source:
            where.append(f"source=?"); params.append(source)
        if search:
            where.append("(message LIKE ? OR detail LIKE ?)")
            params.extend([f"%{search}%", f"%{search}%"])
        w = "WHERE " + " AND ".join(where) if where else ""
        o = "DESC" if order == "desc" else "ASC"
        rows = db.execute(
            f"SELECT * FROM runtime_log {w} ORDER BY seq {o} LIMIT ? OFFSET ?",
            params + [limit, offset]
        ).fetchall()
        total = db.execute(
            f"SELECT COUNT(*) as c FROM runtime_log {w}", params
        ).fetchone()["c"] if where else db.execute("SELECT MAX(seq) as c FROM runtime_log").fetchone()["c"]
        return [dict(r) for r in rows], total
    except Exception as e:
        print(f"[Logger] query failed: {e}")
        return [], 0


def stats():
    """各级别计数"""
    try:
        from database import get_db
        db = get_db()
        rows = db.execute("SELECT level, COUNT(*) as c FROM runtime_log GROUP BY level").fetchall()
        return {r["level"]: r["c"] for r in rows}
    except Exception:
        return {}


def clear_before(days: int = 7):
    """清理旧日志"""
    try:
        from database import get_db
        db = get_db()
        db.execute(
            "DELETE FROM runtime_log WHERE created_at < datetime('now','localtime',?)",
            [f"-{days} days"]
        )
        db.commit()
        deleted = db.execute("SELECT changes()").fetchone()[0]
        info(f"清理了 {deleted} 条 {days} 天前的日志", source="logger")
        return deleted
    except Exception as e:
        print(f"[Logger] 清理失败: {e}")
        return 0


# ===== SSE 实时推送 =====

def _notify_listeners(entry):
    for q in _listeners[:]:
        try:
            q.put_nowait(entry)
        except Exception:
            _listeners.remove(q)


async def stream_generator():
    """SSE 生成器 — 实时推送新日志"""
    import asyncio
    q = asyncio.Queue(maxsize=200)
    _listeners.append(q)
    try:
        # 先推送最近 50 条
        with _buffer_lock:
            recent = list(_buffer[-50:])
        for entry in recent:
            yield f"data: {json.dumps(entry, ensure_ascii=False)}\n\n"
        # 然后实时推送
        while True:
            try:
                entry = await asyncio.wait_for(q.get(), timeout=15)
                yield f"data: {json.dumps(entry, ensure_ascii=False)}\n\n"
            except asyncio.TimeoutError:
                yield ": heartbeat\n\n"
    except GeneratorExit:
        pass
    finally:
        if q in _listeners:
            _listeners.remove(q)


# ===== 初始化 =====
try:
    _init_table()
    info("日志引擎已就绪", source="logger")
except Exception as e:
    print(f"[Logger] 初始化失败: {e}")
