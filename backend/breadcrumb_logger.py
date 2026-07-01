"""
Phase17: Breadcrumb Logger — 错误发生前的事件追溯
在内存中保留最近 100 个事件，发生 error/fatal 时自动刷到 DB
"""
import threading, json
from datetime import datetime

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
    except Exception as e:
        return []
