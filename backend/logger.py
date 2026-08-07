"""
v4.3.0-phase16: Runtime Logging Engine
结构化日志 — SQLite 存储 + 级别过滤 + 来源标签 + 调用栈 + 前端实时流
"""
import json
import threading
import traceback
from datetime import datetime

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
            request_id TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        )
    """)
    # 2026-08-02 加固: 兼容旧库（早期版本建表缺 request_id 列，依赖外部迁移）
    # 若列缺失则补列，避免干净环境首启时 INSERT 报错导致日志静默丢失
    try:
        cols = [r[1] for r in db.execute("PRAGMA table_info(runtime_log)").fetchall()]
        if "request_id" not in cols:
            db.execute("ALTER TABLE runtime_log ADD COLUMN request_id TEXT DEFAULT ''")
    except Exception:
        pass
    db.execute("CREATE INDEX IF NOT EXISTS idx_log_level ON runtime_log(level)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_log_source ON runtime_log(source)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_log_created ON runtime_log(created_at)")
    db.commit()


def log(level: str, message: str, source: str = "system", detail: str = "",
        stack: str = "", path: str = "", status_code: int = 0, elapsed_ms: float = 0,
        request_id: str = ""):
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
        "detail": detail[:4000] if detail else "",
        "stack": stack[:8000] if stack else "",
        "path": path[:500] if path else "",
        "status_code": status_code,
        "elapsed_ms": round(elapsed_ms, 1),
        "request_id": request_id[:50],
        "created_at": ts,
        "timestamp": ts
    }

    # 写数据库
    try:
        _ensure_init()
        from database import get_db, safe_commit
        db = get_db()
        db.execute(
            "INSERT INTO runtime_log (seq,level,source,message,detail,stack,path,status_code,elapsed_ms,request_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
            [entry["seq"], entry["level"], entry["source"], entry["message"],
             entry["detail"], entry["stack"], entry["path"], entry["status_code"], entry["elapsed_ms"], entry["request_id"]]
        )
        safe_commit()
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


def capture_exception(e: Exception, source: str = "system", path: str = "", status_code: int = 500, request_body: str = "", request_id: str = ""):
    """捕获异常并记录完整调用栈 + 请求体 + request_id（独立存列，便于按请求追溯）"""
    msg = f"{type(e).__name__}: {e}"
    stack = traceback.format_exc()
    detail_parts = [str(e)[:1500]]
    if request_body and len(request_body) < 4000:
        detail_parts.append(f"[Body]: {request_body}")
    error(msg, source=source, detail=" | ".join(detail_parts), stack=stack, path=path, status_code=status_code, request_id=request_id)


def api_log(method: str, path: str, status: int, elapsed_ms: float, source: str = "api", request_body: str = "", request_id: str = ""):
    """记录 API 调用（request_id 独立存列）"""
    level = "error" if status >= 500 else ("warn" if status >= 400 else "info")
    detail_parts = [f"{method} {path} → {status} ({elapsed_ms:.0f}ms)"]
    if request_body and len(request_body) < 2000:
        detail_parts.append(f"[Body]: {request_body}")
    log(level, f"{method} {path} → {status} ({elapsed_ms:.0f}ms)", source=source,
        path=path, status_code=status, elapsed_ms=elapsed_ms, detail=" | ".join(detail_parts), request_id=request_id)


def query(level: str = None, source: str = None, search: str = None,
          limit: int = 100, offset: int = 0, order: str = "desc") -> list:
    """查询日志"""
    try:
        from database import get_db
        db = get_db()
        where = []; params = []
        if level:
            where.append("level=?"); params.append(level)
        if source:
            where.append("source=?"); params.append(source)
        if search:
            where.append("(message LIKE ? OR detail LIKE ?)")
            params.extend([f"%{search}%", f"%{search}%"])
        w = "WHERE " + " AND ".join(where) if where else ""
        o = "DESC" if order == "desc" else "ASC"
        # 2026-08-02 修复: seq 是内存序列（服务重启后重置），排序必须用自增主键 id
        rows = db.execute(
            f"SELECT * FROM runtime_log {w} ORDER BY id {o} LIMIT ? OFFSET ?",
            params + [limit, offset]
        ).fetchall()
        total = db.execute(
            f"SELECT COUNT(*) as c FROM runtime_log {w}", params
        ).fetchone()["c"]
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
            except TimeoutError:
                yield ": heartbeat\n\n"
    except GeneratorExit:
        pass
    finally:
        if q in _listeners:
            _listeners.remove(q)


# ===== 初始化（延迟到首次 log() 调用，避免 sys.path 未就绪时导入失败） =====
_init_done = False

def _ensure_init():
    global _init_done
    if _init_done:
        return
    _init_done = True
    try:
        _init_table()
    except Exception as e:
        print(f"[Logger] 初始化失败: {e}")


# ============================================================
# Phase 2.2: 日志体系统一 — Action 审计日志（原 action_logger.py 并入）
# 兼容：from action_logger import record_action 仍然可用（转发层）
# ============================================================
_actions_buffer = []
_actions_lock = threading.Lock()
_MAX_ACTIONS = 1000

# SSI 等待者（实时推送）
_action_listeners = []


def _init_action_table():
    from database import get_db
    db = get_db()
    db.execute("""
        CREATE TABLE IF NOT EXISTS user_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT 'click',
            target TEXT NOT NULL DEFAULT '',
            detail TEXT DEFAULT '',
            url TEXT DEFAULT '',
            user_agent TEXT DEFAULT '',
            client_ip TEXT DEFAULT '',
            elapsed_ms REAL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        )
    """)
    db.execute("CREATE INDEX IF NOT EXISTS idx_ua_action ON user_actions(action)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_ua_category ON user_actions(category)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_ua_created ON user_actions(created_at)")
    db.commit()


_init_done = False


def _ensure_action_init():
    global _init_done
    if _init_done:
        return
    _init_done = True
    try:
        _init_action_table()
    except Exception as e:
        print(f"[ActionLogger] init failed: {e}")


def record_action(
    action: str,
    category: str = "click",
    target: str = "",
    detail: str = "",
    url: str = "",
    user_agent: str = "",
    client_ip: str = "",
    elapsed_ms: float = 0,
    actor_id: int = None
):
    """记录用户操作 — 可从前端 POST /api/logs/action 调用"""
    _ensure_action_init()

    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    entry = {
        "action": action[:200],
        "category": category[:50],
        "target": target[:300],
        "detail": detail[:1000],
        "url": url[:500],
        "user_agent": user_agent[:500] if user_agent else "",
        "client_ip": client_ip[:50] if client_ip else "",
        "elapsed_ms": round(elapsed_ms, 1),
        "created_at": ts,
        "actor_id": actor_id,
    }

    try:
        from database import get_db, safe_commit
        db = get_db()
        db.execute(
            "INSERT INTO user_actions (action,category,target,detail,url,user_agent,client_ip,elapsed_ms,actor_id) VALUES (?,?,?,?,?,?,?,?,?)",
            [entry["action"], entry["category"], entry["target"], entry["detail"],
             entry["url"], entry["user_agent"], entry["client_ip"], entry["elapsed_ms"], actor_id]
        )
        safe_commit()
    except Exception as e:
        print(f"[ActionLogger] write failed: {e}")

    # 内存缓冲区
    with _actions_lock:
        _actions_buffer.append(entry)
        if len(_actions_buffer) > _MAX_ACTIONS:
            _actions_buffer.pop(0)

    # 通知监听者
    _notify_action_listeners(entry)


def query_actions(
    category: str = None,
    action: str = None,
    search: str = None,
    limit: int = 100,
    offset: int = 0
):
    """查询用户操作"""
    try:
        from database import get_db
        db = get_db()
        where = []
        params = []
        if category:
            where.append("category=?"); params.append(category)
        if action:
            where.append("action=?"); params.append(action)
        if search:
            where.append("(detail LIKE ? OR target LIKE ?)")
            params.extend([f"%{search}%", f"%{search}%"])
        w = "WHERE " + " AND ".join(where) if where else ""

        total = db.execute(f"SELECT COUNT(*) c FROM user_actions {w}", params).fetchone()["c"]
        rows = db.execute(
            f"SELECT * FROM user_actions {w} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            params + [limit, offset]
        ).fetchall()
        return [dict(r) for r in rows], total
    except Exception as e:
        print(f"[ActionLogger] query failed: {e}")
        return [], 0


def _notify_action_listeners(entry):
    for q in _action_listeners[:]:
        try:
            q.put_nowait(entry)
        except Exception:
            _action_listeners.remove(q)


async def action_stream_generator():
    import asyncio
    """SSE 实时推送用户操作"""
    q = asyncio.Queue(maxsize=200)
    _action_listeners.append(q)
    try:
        while True:
            try:
                entry = await asyncio.wait_for(q.get(), timeout=15)
                yield f"data: {json.dumps(entry, ensure_ascii=False)}\n\n"
            except TimeoutError:
                yield ": heartbeat\n\n"
    except GeneratorExit:
        pass
    finally:
        if q in _action_listeners:
            _action_listeners.remove(q)


# ============================================================
# Phase 2.2: 日志体系统一 — Breadcrumb 面包屑（原 breadcrumb_logger.py 并入）
# 兼容：from breadcrumb_logger import record_breadcrumb 仍然可用（转发层）
# ============================================================
_sessions = {}
_sessions_lock = threading.Lock()
_MAX_BREADCRUMBS = 100


def record_breadcrumb(session_id: str, event: str, data: dict = None):
    """记录一个面包屑事件（轻量级，仅内存）"""
    if not session_id:
        return
    with _sessions_lock:
        if session_id not in _sessions:
            _sessions[session_id] = []
        crumbs = _sessions[session_id]
        crumbs.append({
            "session_id": session_id,
            "event": event[:200],
            "data": json.dumps(data or {}, ensure_ascii=False, default=str)[:500],
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
        })
        while len(crumbs) > _MAX_BREADCRUMBS:
            crumbs.pop(0)


def flush_breadcrumbs(session_id: str):
    """错误发生时将面包屑写入 DB"""
    if not session_id:
        return
    with _sessions_lock:
        crumbs = _sessions.get(session_id, [])
        if not crumbs:
            return
        try:
            from database import get_db, safe_commit
            db = get_db()
            for c in crumbs:
                db.execute(
                    "INSERT INTO error_breadcrumbs (session_id, event, data) VALUES (?,?,?)",
                    [c["session_id"], c["event"], c["data"]]
                )
            safe_commit()
            _sessions[session_id] = []  # 清空已刷盘的
        except Exception as e:
            print(f"[Breadcrumb] flush failed: {e}")


def clear_breadcrumbs_before(days: int = 14):
    """清理 N 天前的面包屑记录（保留期清理，启动时调用）"""
    try:
        from database import get_db
        db = get_db()
        db.execute(
            "DELETE FROM error_breadcrumbs WHERE created_at < datetime('now','localtime',?)",
            [f"-{days} days"]
        )
        db.commit()
        deleted = db.execute("SELECT changes()").fetchone()[0]
        return deleted
    except Exception as e:
        print(f"[Breadcrumb] 清理失败: {e}")
        return 0


def get_breadcrumbs(session_id: str, limit: int = 100):
    """查询指定 session 的面包屑"""
    try:
        from database import get_db
        db = get_db()
        rows = db.execute(
            "SELECT * FROM error_breadcrumbs WHERE session_id=? ORDER BY created_at DESC LIMIT ?",
            [session_id, limit]
        ).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []
