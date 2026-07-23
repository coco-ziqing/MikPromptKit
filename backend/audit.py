# -*- coding: utf-8 -*-
"""
用户活动审计日志（Audit Log）— Phase35-audit

目标：对每个账户的登录状态关键时间点 + 关键操作行为进行服务器端权威记录，
管理员可按账户追溯查看。与前端行为日志(user_actions)互补：
  - user_audit_log：服务器端权威事件（登录/登出/失败/用户管理/关键增删改），可信、干净。
  - user_actions  ：前端上报的细粒度行为（nav/edit/click...），本模块给其补齐 actor_id 归属。

端点（全部 admin-only）：
  GET /api/audit/user/{uid}            某账户审计事件（登录/操作）
  GET /api/audit/user/{uid}/actions    某账户前端行为（user_actions.actor_id=uid）
  GET /api/audit/user/{uid}/sessions   某账户登录会话历史
  GET /api/audit/user/{uid}/summary    某账户概览（首末登录/次数/最近活动/分类计数）
  GET /api/audit/feed                  全局审计流（管理总览）
  GET /api/audit/event-types           事件类型字典（前端筛选用）
  GET /api/audit/export                审计日志导出 CSV（支持 uid/分类/事件/天数筛选）
  GET/POST /api/audit/retention        保留期查看/设置（config: audit_retention_days，0=永久保留）
"""
import os, sqlite3, time, threading, csv, io
from datetime import datetime
from fastapi import APIRouter, Request, HTTPException, Query
from fastapi.responses import StreamingResponse
from jwt_auth import get_current_user, require_role

router = APIRouter(prefix="/api/audit", tags=["审计日志"])

try:
    from paths import get_db_path
    DB = get_db_path()
except Exception:
    DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "prompts.db")
_init_done = False
_init_lock = threading.Lock()

# 事件类型 → (中文名, 分类)
EVENT_DICT = {
    "login":            ("登录成功", "auth"),
    "login_failed":     ("登录失败", "auth"),
    "logout":           ("登出", "auth"),
    "register":         ("注册账户", "auth"),
    "user_create":      ("创建用户", "user_admin"),
    "user_update":      ("修改用户", "user_admin"),
    "user_delete":      ("删除用户", "user_admin"),
    "user_toggle":      ("启停用户", "user_admin"),
    "password_reset":   ("重置密码", "user_admin"),
    "project_create":   ("新建项目", "project"),
    "project_update":   ("修改项目", "project"),
    "project_delete":   ("删除项目", "project"),
    "asset_upload":     ("上传素材", "asset"),
    "asset_update":     ("修改素材", "asset"),
    "asset_delete":     ("删除素材", "asset"),
    "asset_version":    ("新增版本", "asset"),
    "asset_link":       ("关联词卡", "asset"),
    "asset_submit":     ("提交审核", "asset"),
    "asset_approve":    ("审核通过", "asset"),
    "asset_reject":     ("审核驳回", "asset"),
    "member_add":       ("添加成员", "project"),
    "member_update":    ("修改成员", "project"),
    "member_remove":    ("移除成员", "project"),
    "device_register":  ("设备注册", "system"),
    "device_revoke":    ("设备吊销", "system"),
    "device_backup_done": ("设备备份完成", "system"),
    "user_kick":        ("强制下线", "user_admin"),
}
CATEGORY_NAMES = {
    "auth": "登录认证", "user_admin": "用户管理", "project": "项目",
    "asset": "素材", "prompt": "提示词", "system": "系统",
}


def _conn():
    from database import get_db
    raw = get_db()
    raw.row_factory = sqlite3.Row
    # T3: shared conn wrapper — close() becomes no-op
    class _NC:
        def __init__(self, conn):
            object.__setattr__(self, '_conn', conn)
        def __getattribute__(self, name):
            if name == 'close':
                return lambda: None
            return getattr(object.__getattribute__(self, '_conn'), name)
    return _NC(raw)


def _ensure_init():
    global _init_done
    if _init_done:
        return
    with _init_lock:
        if _init_done:
            return
        try:
            c = _conn()
            c.execute("""
                CREATE TABLE IF NOT EXISTS user_audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    username TEXT DEFAULT '',
                    event_type TEXT NOT NULL DEFAULT '',
                    category TEXT NOT NULL DEFAULT 'system',
                    status TEXT DEFAULT 'ok',
                    detail TEXT DEFAULT '',
                    target_type TEXT DEFAULT '',
                    target_id TEXT DEFAULT '',
                    client_ip TEXT DEFAULT '',
                    device TEXT DEFAULT '',
                    user_agent TEXT DEFAULT '',
                    created_at TEXT DEFAULT (datetime('now','localtime'))
                )
            """)
            c.execute("CREATE INDEX IF NOT EXISTS idx_audit_user ON user_audit_log(user_id, created_at)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_audit_cat ON user_audit_log(category)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_audit_event ON user_audit_log(event_type)")
            c.commit()
            c.close()
            _init_done = True
        except Exception as e:
            print(f"[Audit] init failed: {e}")


def _parse_device(ua: str) -> str:
    if not ua:
        return ""
    u = ua.lower()
    plat = ("iPhone" if "iphone" in u else "iPad" if "ipad" in u else "Android" if "android" in u
            else "Windows" if "windows" in u else "Mac" if ("mac os" in u or "macintosh" in u)
            else "Linux" if "linux" in u else "设备")
    br = ("Edge" if "edg" in u else "Chrome" if ("chrome" in u and "chromium" not in u)
          else "Firefox" if "firefox" in u else "Safari" if ("safari" in u and "chrome" not in u) else "浏览器")
    return f"{plat} · {br}"


def resolve_actor(request):
    """从请求解析当前已认证用户 → (user_id, username) 或 (None, '')。"""
    try:
        u = get_current_user(request)
        if u and u.get("authenticated"):
            return u.get("id"), u.get("username", "")
    except Exception:
        pass
    return None, ""


# PhaseE: 可推送通知的事件类型集合（target_type='user' 时推送给目标用户）
NOTIFY_EVENTS = {
    "asset_approve", "asset_reject", "asset_submit",
    "member_add", "member_remove",
    "device_backup_done", "user_kick",
    "user_toggle", "password_reset", "user_update",
}


def _maybe_notify(event_type, actor_id, actor_name, detail, target_type, target_id):
    """PhaseE: 审计事件写完后向相关用户推实时通知（异常完全忽略）。"""
    if event_type not in NOTIFY_EVENTS:
        return
    if target_type != "user" or not target_id:
        return
    try:
        tid = int(target_id)
        if actor_id and tid == int(actor_id):
            return  # 自己对自己的操作不推
        from notify import notify_user
        en = EVENT_DICT.get(event_type, (event_type, ""))[0]
        notify_user(tid, event=event_type, title=en, body=detail or "", category=event_type)
    except Exception:
        pass


def record_audit(event_type, request=None, user_id=None, username=None,
                 detail="", target_type="", target_id=None, status="ok", category=None):
    """记录一条审计事件（安全：任何异常都不影响主流程）。
    同时向相关用户推送实时通知（PhaseE）。"""
    _ensure_init()
    try:
        if category is None:
            category = EVENT_DICT.get(event_type, ("", "system"))[1]
        client_ip, ua = "", ""
        if request is not None:
            try:
                client_ip = request.client.host if request.client else ""
                ua = request.headers.get("user-agent", "")
            except Exception:
                pass
            if user_id is None:
                user_id, username = resolve_actor(request)
        c = _conn()
        c.execute(
            """INSERT INTO user_audit_log
               (user_id, username, event_type, category, status, detail, target_type, target_id, client_ip, device, user_agent)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            [user_id, username or "", event_type, category, status,
             (detail or "")[:1000], target_type or "", str(target_id) if target_id is not None else "",
             client_ip[:50], _parse_device(ua), ua[:400]]
        )
        c.commit()
        c.close()
        # PhaseE: 实时通知推送
        _maybe_notify(event_type, user_id, username, detail, target_type, target_id)
    except Exception as e:
        print(f"[Audit] record failed ({event_type}): {e}")


# ============================================================
# 管理端查询
# ============================================================
_require_admin = require_role("admin")


def _enrich(rows):
    out = []
    for r in rows:
        d = dict(r)
        et = d.get("event_type", "")
        d["event_name"] = EVENT_DICT.get(et, (et, ""))[0]
        d["category_name"] = CATEGORY_NAMES.get(d.get("category", ""), d.get("category", ""))
        out.append(d)
    return out


@router.get("/user/{uid}")
def user_audit(uid: int, request: Request,
               category: str = Query(None), event: str = Query(None),
               search: str = Query(None), days: int = Query(0, ge=0),
               limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
    _require_admin(request)
    _ensure_init()
    c = _conn()
    try:
        # 展示“该账户自己做的” OR “针对该账户做的（如管理员改其角色）”
        where = ["(user_id=? OR (target_type='user' AND target_id=?))"]
        params = [uid, str(uid)]
        if category:
            where.append("category=?"); params.append(category)
        if event:
            where.append("event_type=?"); params.append(event)
        if search:
            where.append("(detail LIKE ? OR event_type LIKE ?)"); params += [f"%{search}%", f"%{search}%"]
        if days > 0:
            where.append("created_at >= datetime('now','localtime',?)"); params.append(f"-{days} days")
        w = "WHERE " + " AND ".join(where)
        total = c.execute(f"SELECT COUNT(1) n FROM user_audit_log {w}", params).fetchone()["n"]
        rows = c.execute(f"SELECT * FROM user_audit_log {w} ORDER BY id DESC LIMIT ? OFFSET ?",
                         params + [limit, offset]).fetchall()
        return {"ok": True, "items": _enrich(rows), "total": total, "limit": limit, "offset": offset}
    finally:
        c.close()


@router.get("/user/{uid}/actions")
def user_actions(uid: int, request: Request,
                 category: str = Query(None), search: str = Query(None),
                 limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
    """该账户的前端细粒度行为（user_actions.actor_id=uid）。"""
    _require_admin(request)
    c = _conn()
    try:
        where, params = ["actor_id=?"], [uid]
        if category:
            where.append("category=?"); params.append(category)
        if search:
            where.append("(detail LIKE ? OR target LIKE ? OR action LIKE ?)"); params += [f"%{search}%", f"%{search}%", f"%{search}%"]
        w = "WHERE " + " AND ".join(where)
        try:
            total = c.execute(f"SELECT COUNT(1) n FROM user_actions {w}", params).fetchone()["n"]
            rows = c.execute(f"SELECT id,action,category,target,detail,url,client_ip,created_at FROM user_actions {w} ORDER BY id DESC LIMIT ? OFFSET ?",
                             params + [limit, offset]).fetchall()
        except Exception:
            return {"ok": True, "items": [], "total": 0, "limit": limit, "offset": offset}
        return {"ok": True, "items": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}
    finally:
        c.close()


@router.get("/user/{uid}/sessions")
def user_sessions(uid: int, request: Request, limit: int = Query(50, ge=1, le=200)):
    """登录会话历史（含在线/失效）。"""
    _require_admin(request)
    c = _conn()
    try:
        rows = c.execute(
            """SELECT id, client_ip, user_agent, created_at, expires_at, is_active
               FROM user_sessions WHERE user_id=? ORDER BY id DESC LIMIT ?""",
            [uid, limit]).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["device"] = _parse_device(d.get("user_agent", ""))
            out.append(d)
        return {"ok": True, "items": out, "total": len(out)}
    finally:
        c.close()


@router.get("/user/{uid}/summary")
def user_summary(uid: int, request: Request):
    _require_admin(request)
    _ensure_init()
    c = _conn()
    try:
        s = {"user_id": uid}
        # 登录统计
        row = c.execute(
            """SELECT COUNT(1) n, MIN(created_at) first_at, MAX(created_at) last_at
               FROM user_audit_log WHERE user_id=? AND event_type='login'""", [uid]).fetchone()
        s["login_count"] = row["n"] or 0
        s["first_login_at"] = row["first_at"]
        s["last_login_at"] = row["last_at"]
        # 失败登录
        s["login_failed_count"] = c.execute(
            "SELECT COUNT(1) n FROM user_audit_log WHERE user_id=? AND event_type='login_failed'", [uid]).fetchone()["n"] or 0
        # 最近活动时间（审计 + 行为）
        la = c.execute("SELECT MAX(created_at) t FROM user_audit_log WHERE user_id=?", [uid]).fetchone()["t"]
        try:
            la2 = c.execute("SELECT MAX(created_at) t FROM user_actions WHERE actor_id=?", [uid]).fetchone()["t"]
        except Exception:
            la2 = None
        s["last_activity_at"] = max([x for x in [la, la2] if x], default=None)
        # 分类计数
        cats = {}
        for r in c.execute("SELECT category, COUNT(1) n FROM user_audit_log WHERE user_id=? GROUP BY category", [uid]):
            cats[r["category"]] = r["n"]
        s["audit_by_category"] = cats
        s["audit_total"] = sum(cats.values())
        try:
            s["actions_total"] = c.execute("SELECT COUNT(1) n FROM user_actions WHERE actor_id=?", [uid]).fetchone()["n"] or 0
        except Exception:
            s["actions_total"] = 0
        # 当前在线态（Phase34）
        try:
            import presence
            s["presence"] = presence._derive_status(uid) if uid in presence._conns else "offline"
        except Exception:
            s["presence"] = "unknown"
        return {"ok": True, "summary": s}
    finally:
        c.close()


@router.get("/feed")
def audit_feed(request: Request, category: str = Query(None), event: str = Query(None),
               search: str = Query(None), limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
    """全局审计流（管理总览，跨账户）。"""
    _require_admin(request)
    _ensure_init()
    c = _conn()
    try:
        where, params = [], []
        if category:
            where.append("category=?"); params.append(category)
        if event:
            where.append("event_type=?"); params.append(event)
        if search:
            where.append("(detail LIKE ? OR username LIKE ? OR event_type LIKE ?)"); params += [f"%{search}%", f"%{search}%", f"%{search}%"]
        w = ("WHERE " + " AND ".join(where)) if where else ""
        total = c.execute(f"SELECT COUNT(1) n FROM user_audit_log {w}", params).fetchone()["n"]
        rows = c.execute(f"SELECT * FROM user_audit_log {w} ORDER BY id DESC LIMIT ? OFFSET ?",
                         params + [limit, offset]).fetchall()
        return {"ok": True, "items": _enrich(rows), "total": total, "limit": limit, "offset": offset}
    finally:
        c.close()


@router.get("/event-types")
def event_types(request: Request):
    _require_admin(request)
    return {"ok": True,
            "events": [{"type": k, "name": v[0], "category": v[1]} for k, v in EVENT_DICT.items()],
            "categories": [{"key": k, "name": v} for k, v in CATEGORY_NAMES.items()]}


# ============================================================
# 导出 CSV + 保留期清理（遗留项，2026-07-15）
# ============================================================

CSV_COLS = ["id", "created_at", "user_id", "username", "event_type", "event_name",
            "category", "status", "detail", "target_type", "target_id", "client_ip", "device"]


@router.get("/export")
def export_csv(request: Request, uid: int = Query(None), category: str = Query(None),
               event: str = Query(None), days: int = Query(0, ge=0),
               search: str = Query(None), limit: int = Query(50000, ge=1, le=200000)):
    """导出审计日志为 CSV（Excel 可直接打开，utf-8-sig BOM）。筛选同 /feed。"""
    _require_admin(request)
    _ensure_init()
    c = _conn()
    try:
        where, params = [], []
        if uid is not None:
            where.append("(user_id=? OR (target_type='user' AND target_id=?))"); params += [uid, str(uid)]
        if category:
            where.append("category=?"); params.append(category)
        if event:
            where.append("event_type=?"); params.append(event)
        if search:
            where.append("(detail LIKE ? OR username LIKE ? OR event_type LIKE ?)"); params += [f"%{search}%", f"%{search}%", f"%{search}%"]
        if days > 0:
            where.append("created_at >= datetime('now','localtime',?)"); params.append(f"-{days} days")
        w = ("WHERE " + " AND ".join(where)) if where else ""
        rows = c.execute(f"SELECT * FROM user_audit_log {w} ORDER BY id DESC LIMIT ?",
                         params + [limit]).fetchall()
    finally:
        c.close()

    buf = io.StringIO()
    wcsv = csv.writer(buf, lineterminator="\n")
    wcsv.writerow(CSV_COLS)
    for r in rows:
        d = dict(r)
        d["event_name"] = EVENT_DICT.get(d.get("event_type", ""), (d.get("event_type", ""), ""))[0]
        wcsv.writerow([d.get(k, "") for k in CSV_COLS])
    data = "\ufeff" + buf.getvalue()  # BOM 保 Excel 中文不乱码
    fname = f"audit_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(iter([data.encode("utf-8")]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})


def _get_retention_days(c) -> int:
    try:
        row = c.execute("SELECT value FROM config WHERE key='audit_retention_days'").fetchone()
        return int(row["value"]) if row else 0
    except Exception:
        return 0


def apply_retention() -> dict:
    """按 config.audit_retention_days 清理过期审计日志（0=不清理）。启动时/设置时调用。"""
    _ensure_init()
    try:
        c = _conn()
        days = _get_retention_days(c)
        deleted = 0
        if days > 0:
            cur = c.execute("DELETE FROM user_audit_log WHERE created_at < datetime('now','localtime',?)",
                            [f"-{days} days"])
            deleted = cur.rowcount
            c.commit()
            if deleted:
                print(f"[Audit] 保留期清理: 删除 {deleted} 条超过 {days} 天的审计记录")
        c.close()
        return {"days": days, "deleted": deleted}
    except Exception as e:
        print(f"[Audit] retention failed: {e}")
        return {"days": 0, "deleted": 0, "error": str(e)}


@router.get("/retention")
def get_retention(request: Request):
    _require_admin(request)
    _ensure_init()
    c = _conn()
    try:
        days = _get_retention_days(c)
        row = c.execute("SELECT COUNT(1) n, MIN(created_at) oldest FROM user_audit_log").fetchone()
        return {"ok": True, "days": days, "total": row["n"], "oldest": row["oldest"]}
    finally:
        c.close()


@router.post("/retention")
def set_retention(request: Request, data: dict = None):
    """设置保留天数并立即执行一次清理。{days: 0=永久保留}"""
    _require_admin(request)
    _ensure_init()
    days = int((data or {}).get("days", 0))
    if days < 0 or days > 3650:
        raise HTTPException(400, "days 范围 0-3650")
    c = _conn()
    try:
        c.execute("INSERT INTO config(key,value) VALUES('audit_retention_days',?) "
                  "ON CONFLICT(key) DO UPDATE SET value=excluded.value", [str(days)])
        c.commit()
    finally:
        c.close()
    result = apply_retention()
    return {"ok": True, "days": days, "deleted": result.get("deleted", 0)}
