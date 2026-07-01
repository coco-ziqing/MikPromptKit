#!/usr/bin/env python
"""Phase17: User Action Logger — 前端用户行为追踪 + 全局错误捕获"""
import traceback, json, threading, asyncio
from datetime import datetime

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


def _ensure_init():
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
    elapsed_ms: float = 0
):
    """记录用户操作 — 可从前端 POST /api/logs/action 调用"""
    _ensure_init()

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
    }

    try:
        from database import get_db, safe_commit
        db = get_db()
        db.execute(
            "INSERT INTO user_actions (action,category,target,detail,url,user_agent,client_ip,elapsed_ms) VALUES (?,?,?,?,?,?,?,?)",
            [entry["action"], entry["category"], entry["target"], entry["detail"],
             entry["url"], entry["user_agent"], entry["client_ip"], entry["elapsed_ms"]]
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
    _notify_listeners(entry)


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


def _notify_listeners(entry):
    for q in _action_listeners[:]:
        try:
            q.put_nowait(entry)
        except Exception:
            _action_listeners.remove(q)


async def action_stream_generator():
    """SSE 实时推送用户操作"""
    q = asyncio.Queue(maxsize=200)
    _action_listeners.append(q)
    try:
        while True:
            try:
                entry = await asyncio.wait_for(q.get(), timeout=15)
                yield f"data: {json.dumps(entry, ensure_ascii=False)}\n\n"
            except asyncio.TimeoutError:
                yield ": heartbeat\n\n"
    except GeneratorExit:
        pass
    finally:
        if q in _action_listeners:
            _action_listeners.remove(q)
