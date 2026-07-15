# -*- coding: utf-8 -*-
"""
实时在线状态（Presence）系统 — Phase34

目标：局域网内多账户登录时，实时显示每个账户的在线状态。
状态机：online(在线) / idle(空闲) / away(离开) / busy(忙碌,手动) / offline(离线)

设计要点：
- 独立 WebSocket 通道 /ws/presence，登录即连、常驻，与 Phase29 通知通道解耦（零风险）。
- 一个用户可多设备/多标签并发连接，聚合为该用户的整体状态。
- 客户端心跳(ping)保活 + 活动信号(active)刷新 last_active；服务端后台巡检推导 idle/away。
- 任一状态变化 → 向全体在线客户端广播 presence_update，实现真正实时。
- GET /api/presence 提供快照（首屏/降级轮询/管理页初始化）。

端点：
  ws://host:8080/ws/presence?token=JWT     — 实时在线状态通道
  GET  /api/presence                        — 当前在线快照
  POST /api/presence/status {status}        — 手动设置自身状态(online/away/busy)
"""
import json, time, asyncio, sqlite3, os
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request, Body, HTTPException
from jwt_auth import verify_jwt, get_current_user

router = APIRouter(tags=["在线状态"])

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "prompts.db")

# ============================================================
# 状态阈值（秒）
# ============================================================
IDLE_AFTER = 90        # 90s 无活动 → 空闲
AWAY_AFTER = 300       # 5min 无活动 → 离开
SWEEP_INTERVAL = 15    # 后台巡检周期

# ============================================================
# 连接池
#   _conns: {user_id(int): {conn_id(str): {...meta, "ws": WebSocket}}}
#   每个连接的 meta: ws / conn_id / client_ip / device / ua / connected_at / last_active
#   _user_meta: {user_id: {username, display_name, role, avatar_color, manual_status}}
# ============================================================
_conns: dict = {}
_user_meta: dict = {}
_loop = None
_conn_seq = 0


def _capture_loop():
    global _loop
    try:
        _loop = asyncio.get_running_loop()
    except RuntimeError:
        pass


# ============================================================
# 工具
# ============================================================
def _parse_device(ua: str) -> str:
    """从 User-Agent 粗略解析设备类型 + 浏览器，用于在线列表展示。"""
    if not ua:
        return "未知设备"
    u = ua.lower()
    # 平台
    if "iphone" in u:
        plat = "iPhone"
    elif "ipad" in u:
        plat = "iPad"
    elif "android" in u:
        plat = "Android"
    elif "windows" in u:
        plat = "Windows"
    elif "mac os" in u or "macintosh" in u:
        plat = "Mac"
    elif "linux" in u:
        plat = "Linux"
    else:
        plat = "设备"
    # 浏览器
    if "edg" in u:
        br = "Edge"
    elif "chrome" in u and "chromium" not in u:
        br = "Chrome"
    elif "firefox" in u:
        br = "Firefox"
    elif "safari" in u and "chrome" not in u:
        br = "Safari"
    else:
        br = "浏览器"
    return f"{plat} · {br}"


def _load_user_profile(uid: int) -> dict:
    """从 DB 读取用户展示信息（display_name/role/avatar_color）。"""
    try:
        conn = sqlite3.connect(DB, timeout=2)
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT username, display_name, role, avatar_color FROM users WHERE id=?",
            [uid]).fetchone()
        conn.close()
        if row:
            return dict(row)
    except Exception:
        pass
    return {}


def _derive_status(uid: int) -> str:
    """根据该用户所有连接的 last_active + 手动状态，推导整体状态。"""
    meta = _user_meta.get(uid, {})
    manual = meta.get("manual_status")
    conns = _conns.get(uid) or {}
    if not conns:
        return "offline"
    # 手动 busy/away 优先（除非用户重新活动会被客户端清除）
    if manual in ("busy", "away"):
        return manual
    now = time.time()
    # 取所有连接中最近一次活动
    last = max((c.get("last_active", 0) for c in conns.values()), default=0)
    delta = now - last
    if delta < IDLE_AFTER:
        return "online"
    if delta < AWAY_AFTER:
        return "idle"
    return "away"


def _user_snapshot(uid: int) -> dict:
    """构造单个用户的在线态快照。"""
    meta = _user_meta.get(uid, {})
    conns = _conns.get(uid) or {}
    devices = []
    connected_since = None
    for c in conns.values():
        devices.append({
            "device": c.get("device", "未知设备"),
            "client_ip": c.get("client_ip", ""),
            "connected_at": c.get("connected_at"),
            "last_active": c.get("last_active"),
        })
        ca = c.get("connected_at")
        if ca and (connected_since is None or ca < connected_since):
            connected_since = ca
    return {
        "user_id": uid,
        "username": meta.get("username", "?"),
        "display_name": meta.get("display_name") or meta.get("username", "?"),
        "role": meta.get("role", "editor"),
        "avatar_color": meta.get("avatar_color"),
        "status": _derive_status(uid),
        "connection_count": len(conns),
        "connected_since": connected_since,
        "devices": devices,
        # PhaseB: 所在位置
        "current_page": meta.get("current_page", ""),
        "current_project": meta.get("current_project", ""),
        "current_project_id": meta.get("current_project_id", 0),
    }


def _full_snapshot() -> list:
    """所有在线用户快照列表。"""
    return [_user_snapshot(uid) for uid in list(_conns.keys()) if _conns.get(uid)]


# ============================================================
# 广播
# ============================================================
async def _broadcast(message: dict, exclude_ws=None):
    """向全体在线连接广播。"""
    dead = []
    for uid, conns in list(_conns.items()):
        for cid, c in list(conns.items()):
            ws = c.get("ws")
            if ws is None or ws is exclude_ws:
                continue
            try:
                await ws.send_json(message)
            except Exception:
                dead.append((uid, cid))
    for uid, cid in dead:
        _drop_conn(uid, cid, broadcast=False)


async def _broadcast_user(uid: int):
    """广播某用户最新状态给全体。"""
    await _broadcast({"type": "presence_update", "user": _user_snapshot(uid)})


def _drop_conn(uid: int, cid: str, broadcast: bool = True):
    """移除一个连接；若该用户已无连接则清理并（可选）广播离线。"""
    conns = _conns.get(uid)
    if not conns:
        return False
    conns.pop(cid, None)
    if not conns:
        _conns.pop(uid, None)
        return True  # 该用户彻底离线
    return False


# ============================================================
# WebSocket 端点
# ============================================================
@router.websocket("/ws/presence")
async def ws_presence(websocket: WebSocket):
    global _conn_seq
    token = websocket.query_params.get("token", "")
    payload = verify_jwt(token) if token else None
    if not payload:
        await websocket.accept()
        await websocket.send_json({"type": "error", "message": "需要登录"})
        await websocket.close(code=4001)
        return

    try:
        uid = int(payload.get("user_id", 0))
    except Exception:
        uid = 0
    if not uid:
        await websocket.accept()
        await websocket.send_json({"type": "error", "message": "无效用户"})
        await websocket.close(code=4001)
        return

    await websocket.accept()
    _capture_loop()

    # 连接元数据
    _conn_seq += 1
    cid = f"c{_conn_seq}"
    client_ip = websocket.client.host if websocket.client else ""
    ua = websocket.headers.get("user-agent", "")
    now = time.time()

    # 用户展示信息（缓存）
    prof = _load_user_profile(uid)
    _user_meta[uid] = {
        "username": payload.get("username") or prof.get("username", "?"),
        "display_name": prof.get("display_name") or payload.get("username", "?"),
        "role": prof.get("role") or payload.get("role", "editor"),
        "avatar_color": prof.get("avatar_color"),
        "manual_status": _user_meta.get(uid, {}).get("manual_status"),
        "current_page": "",      # PhaseB: 所在页面
        "current_project": "",   # PhaseB: 所在项目
        "current_project_id": 0,  # PhaseB: 所在项目ID
    }

    was_offline = uid not in _conns or not _conns.get(uid)
    _conns.setdefault(uid, {})[cid] = {
        "ws": websocket,
        "conn_id": cid,
        "client_ip": client_ip,
        "ua": ua,
        "device": _parse_device(ua),
        "connected_at": now,
        "last_active": now,
    }

    # 首屏：把当前全体在线快照发给新连接
    await websocket.send_json({
        "type": "snapshot",
        "self_id": uid,
        "users": _full_snapshot(),
        "server_time": now,
    })
    # 广播本用户上线/新连接
    await _broadcast_user(uid)

    try:
        while True:
            data = await websocket.receive_json()
            mtype = data.get("type", "")
            entry = _conns.get(uid, {}).get(cid)
            if not entry:
                break
            if mtype == "ping":
                await websocket.send_json({"type": "pong", "t": time.time()})
            elif mtype == "active":
                # 用户活动 → 刷新，清除手动 away（busy 需显式清除）
                prev = _derive_status(uid)
                entry["last_active"] = time.time()
                if _user_meta.get(uid, {}).get("manual_status") == "away":
                    _user_meta[uid]["manual_status"] = None
                if _derive_status(uid) != prev:
                    await _broadcast_user(uid)
            elif mtype == "status":
                # 手动状态：online(清除) / away / busy
                s = data.get("status")
                _user_meta.setdefault(uid, {})
                if s == "online":
                    _user_meta[uid]["manual_status"] = None
                    entry["last_active"] = time.time()
                elif s in ("away", "busy"):
                    _user_meta[uid]["manual_status"] = s
                await _broadcast_user(uid)
            elif mtype == "location":
                # PhaseB: 上报所在页面/项目
                page = data.get("page", "")
                proj = data.get("project", "")
                pid = data.get("project_id", 0)
                _user_meta.setdefault(uid, {})
                if page: _user_meta[uid]["current_page"] = page
                if proj: _user_meta[uid]["current_project"] = proj
                if pid: _user_meta[uid]["current_project_id"] = pid
                await _broadcast_user(uid)
            elif mtype == "who":
                await websocket.send_json({"type": "snapshot", "self_id": uid,
                                           "users": _full_snapshot(), "server_time": time.time()})
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        went_offline = _drop_conn(uid, cid, broadcast=False)
        try:
            if went_offline:
                _user_meta.pop(uid, None)
                await _broadcast({"type": "presence_offline", "user_id": uid})
            else:
                await _broadcast_user(uid)
        except Exception:
            pass


# ============================================================
# 后台巡检：推导 idle/away 状态切换并广播
# ============================================================
async def presence_sweep_loop():
    """定期扫描，当某用户因久无活动跨越 idle/away 阈值时广播状态变化。"""
    _capture_loop()
    last_status: dict = {}
    while True:
        try:
            await asyncio.sleep(SWEEP_INTERVAL)
            for uid in list(_conns.keys()):
                if not _conns.get(uid):
                    continue
                cur = _derive_status(uid)
                if last_status.get(uid) != cur:
                    last_status[uid] = cur
                    await _broadcast_user(uid)
            # 清理已离线用户的记录
            for uid in list(last_status.keys()):
                if uid not in _conns:
                    last_status.pop(uid, None)
        except asyncio.CancelledError:
            break
        except Exception:
            pass


# ============================================================
# REST：快照 + 手动状态
# ============================================================
@router.get("/api/presence")
def get_presence():
    """当前在线快照（管理页初始化 / WS 不可用时降级轮询）。"""
    users = _full_snapshot()
    counts = {"online": 0, "idle": 0, "away": 0, "busy": 0}
    for u in users:
        counts[u["status"]] = counts.get(u["status"], 0) + 1
    return {
        "ok": True,
        "online_total": len(users),
        "counts": counts,
        "users": users,
        "server_time": time.time(),
    }


@router.post("/api/presence/status")
def set_presence_status(data: dict = Body(...), request: Request = None):
    """手动设置自身状态（online/away/busy）。通过 REST 兜底，实际推荐走 WS。"""
    user = get_current_user(request)
    uid = user.get("id")
    status = data.get("status")
    if status not in ("online", "away", "busy"):
        raise HTTPException(400, "无效状态")
    if uid not in _conns:
        return {"ok": True, "message": "当前无在线连接", "applied": False}
    _user_meta.setdefault(uid, {})
    _user_meta[uid]["manual_status"] = None if status == "online" else status
    if _loop:
        try:
            asyncio.run_coroutine_threadsafe(_broadcast_user(uid), _loop)
        except Exception:
            pass
    return {"ok": True, "applied": True, "status": _derive_status(uid)}


@router.post("/api/presence/disconnect/{uid}")
def admin_disconnect_user(uid: int, request: Request = None):
    """PhaseB: admin 强制下线指定用户的所有连接（管理员专权）。"""
    user = get_current_user(request)
    if not user or user.get("role") != "admin" or not user.get("authenticated"):
        raise HTTPException(403, "仅管理员可强制下线")
    if uid == user.get("id"):
        raise HTTPException(400, "不能强制下线自己")
    conns = _conns.get(uid, {})
    if not conns:
        return {"ok": True, "message": "该用户无在线连接", "closed": 0}
    count = 0
    for cid, c in list(conns.items()):
        ws = c.get("ws")
        if ws:
            try:
                asyncio.run_coroutine_threadsafe(
                    ws.send_json({"type": "kick", "reason": "管理员已将您下线"}), _loop)
                asyncio.run_coroutine_threadsafe(ws.close(), _loop)
                count += 1
            except Exception:
                pass
    # 广播离线
    _conns.pop(uid, None)
    _user_meta.pop(uid, None)
    asyncio.run_coroutine_threadsafe(
        _broadcast({"type": "presence_offline", "user_id": uid}), _loop)
    # 审计
    try:
        from audit import record_audit
        record_audit("user_kick", request, detail=f"管理员强制下线 user#{uid}",
                     target_type="user", target_id=uid)
    except Exception:
        pass
    return {"ok": True, "closed": count}
