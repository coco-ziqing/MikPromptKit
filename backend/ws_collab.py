"""
WebSocket 实时协作端点 — Phase23.4

端点:
  ws://host:8080/ws/collab/{project_id}  — 项目协作（看板/任务同步）
  ws://host:8080/ws/notifications/{user_id} — 通知推送

功能:
  - JWT token 认证（query param: ?token=xxx）
  - 房间管理（project_id 隔离）
  - 在线状态广播（user_joined / user_left）
  - 消息类型: task_update / column_update / milestone_update / comment
  - 优雅断开 + 清理
"""
import json, time, asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jwt_auth import verify_jwt

router = APIRouter()

# 连接池: {project_id: {user_id: WebSocket}}
_rooms: dict = {}
# 用户在线状态: {user_id: {"username": str, "projects": [project_ids]}}
_online_users: dict = {}
# 通知连接池: {user_id(int): set(WebSocket)} — 一个用户可多标签/多设备
from typing import Set
_notif_conns: dict = {}
# 主事件循环引用（供同步请求处理器线程安全推送）
_loop = None
# P0-7 连接数限制：每个用户最多 5 个 WebSocket 连接，全局最多 200
MAX_USER_WS_CONNS = 5
MAX_GLOBAL_WS_CONNS = 200


def _capture_loop():
    global _loop
    try:
        _loop = asyncio.get_running_loop()
    except RuntimeError:
        pass

# ============================================================
# 项目协作 WebSocket
# ============================================================

@router.websocket("/ws/collab/{master_id}")
async def ws_collab(websocket: WebSocket, master_id: str):
    token = websocket.query_params.get("token", "")
    user = None

    if token:
        payload = verify_jwt(token)
        if payload:
            user = {"id": payload.get("user_id", 0), "username": payload.get("username", "anon")}
    
    if not user:
        await websocket.accept()
        await websocket.send_json({"type":"error","message":"需要登录","code":401})
        await websocket.close(code=4001)
        return

    await websocket.accept()
    _capture_loop()

    # P0-7 连接数限制：单用户最多5连接，全局最多200
    uid = user["id"]
    user_conn_count = sum(1 for r in _rooms.values() for ruid in r if ruid == uid)
    if user_conn_count >= MAX_USER_WS_CONNS:
        await websocket.send_json({"type":"error","message":"连接数已达上限（5个），请关闭其他标签页","code":429})
        await websocket.close(code=4002)
        return
    total_conns = sum(len(r) for r in _rooms.values())
    if total_conns >= MAX_GLOBAL_WS_CONNS:
        await websocket.send_json({"type":"error","message":"服务器连接池已满，请稍后重试","code":429})
        await websocket.close(code=4003)
        return

    # 加入房间
    if master_id not in _rooms:
        _rooms[master_id] = {}
    _rooms[master_id][user["id"]] = websocket

    # 更新在线状态（uid 已在连接限制中解析）
    if uid not in _online_users:
        _online_users[uid] = {"username": user["username"], "projects": [], "last_seen": time.time()}
    if master_id not in _online_users[uid]["projects"]:
        _online_users[uid]["projects"].append(master_id)
    _online_users[uid]["last_seen"] = time.time()

    # 发送欢迎 + 当前在线列表
    await websocket.send_json({
        "type": "connected", "user": user, "master_id": master_id,
        "online_users": [_online_users[k]["username"] for k in _rooms.get(master_id, {})],
    })

    # 广播加入事件
    await _broadcast(master_id, {
        "type": "user_joined", "user": user["username"], "user_id": uid, "timestamp": time.time(),
    }, exclude=uid)

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "")
            data["user_id"] = uid
            data["username"] = user["username"]
            data["timestamp"] = time.time()

            if msg_type in ("task_update", "task_move", "column_update", "milestone_update", "comment", "cursor_move"):
                # 广播给房间内其他用户
                await _broadcast(master_id, data, exclude=uid)
            elif msg_type == "ping":
                await websocket.send_json({"type": "pong", "timestamp": time.time()})
                _online_users[uid]["last_seen"] = time.time()
            else:
                await websocket.send_json({"type": "ack", "ref": data.get("id", ""), "status": "received"})

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        # 离开房间
        if master_id in _rooms and uid in _rooms[master_id]:
            del _rooms[master_id][uid]
            if not _rooms[master_id]:
                del _rooms[master_id]

        # 更新在线状态
        if uid in _online_users:
            _online_users[uid]["projects"] = [p for p in _online_users[uid]["projects"] if p != master_id]
            if not _online_users[uid]["projects"]:
                del _online_users[uid]

        # 广播离开
        await _broadcast(master_id, {
            "type": "user_left", "user": user["username"], "user_id": uid, "timestamp": time.time(),
        })


# ============================================================
# 通知推送
# ============================================================

@router.websocket("/ws/notifications/{user_id}")
async def ws_notifications(websocket: WebSocket, user_id: str):
    token = websocket.query_params.get("token", "")
    payload = verify_jwt(token) if token else None

    if not payload:
        await websocket.accept()
        await websocket.send_json({"type":"error","message":"需要登录"})
        await websocket.close(code=4001)
        return

    # 以 token 内的 user_id 为准，防止冒用他人 user_id 订阅
    try:
        uid = int(payload.get("user_id", 0))
    except Exception:
        uid = 0
    if not uid:
        await websocket.accept()
        await websocket.send_json({"type":"error","message":"无效用户"})
        await websocket.close(code=4001)
        return

    await websocket.accept()
    _capture_loop()
    _notif_conns.setdefault(uid, set()).add(websocket)
    await websocket.send_json({"type":"connected","message":"通知通道已建立","user_id":uid})

    try:
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "ping":
                await websocket.send_json({"type":"pong"})
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        conns = _notif_conns.get(uid)
        if conns:
            conns.discard(websocket)
            if not conns:
                _notif_conns.pop(uid, None)


# ============================================================
# 辅助
# ============================================================

async def _broadcast(room_id: str, message: dict, exclude: int = None):
    """广播消息给房间内所有用户"""
    if room_id not in _rooms:
        return
    dead = []
    for uid, ws in _rooms[room_id].items():
        if uid == exclude:
            continue
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(uid)
    for uid in dead:
        _rooms[room_id].pop(uid, None)


async def _send_to_user(uid: int, message: dict):
    """推送给某用户的所有在线连接"""
    conns = _notif_conns.get(uid)
    if not conns:
        return
    dead = []
    for ws in list(conns):
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        conns.discard(ws)
    if not conns:
        _notif_conns.pop(uid, None)


def push_to_user(user_id, message: dict) -> int:
    """线程安全：从同步请求处理器把通知实时推送给某用户的所有在线连接。
    返回该用户当前在线连接数（0 表示离线，调用方无需处理，已落库供下次拉取）。"""
    try:
        uid = int(user_id)
    except Exception:
        return 0
    conns = _notif_conns.get(uid)
    if not conns or _loop is None:
        return 0
    try:
        asyncio.run_coroutine_threadsafe(_send_to_user(uid, message), _loop)
    except Exception:
        return 0
    return len(conns)


# ============================================================
# 状态查询 API
# ============================================================

@router.get("/ws/status")
def collab_status():
    """查询协作系统状态"""
    rooms_info = {}
    for rid, users in _rooms.items():
        rooms_info[rid] = {
            "user_count": len(users),
            "users": [{"user_id": uid, "username": _online_users.get(uid, {}).get("username", "?")} for uid in users],
        }
    return {
        "ok": True,
        "rooms": len(_rooms),
        "online_users": len(_online_users),
        "notif_online_users": len(_notif_conns),
        "notif_connections": sum(len(v) for v in _notif_conns.values()),
        "details": rooms_info,
    }


@router.get("/ws/remote/check")
def remote_check():
    """检测远程接入就绪状态"""
    import socket, platform, subprocess
    result = {
        "hostname": socket.gethostname(),
        "platform": platform.platform(),
        "lan_ip": None,
        "tailscale": {"installed": False, "ip": None, "status": "not_installed"},
        "relay": {"available": False, "url": None},
        "recommendation": "局域网内可直接访问 http://<lan_ip>:8080"
    }

    # 获取局域网 IP
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        result["lan_ip"] = s.getsockname()[0]
        s.close()
    except:
        pass

    # 检测 Tailscale
    try:
        ts = subprocess.run(["tailscale", "status"], capture_output=True, encoding='utf-8', errors='replace', timeout=5, 
                           creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess,'CREATE_NO_WINDOW') else 0)
        if ts.returncode == 0:
            result["tailscale"]["installed"] = True
            result["tailscale"]["status"] = "running"
            for line in ts.stdout.split("\n"):
                if "100." in line or "fd7a:" in line:
                    result["tailscale"]["ip"] = line.strip().split()[0]
                    break
            if result["tailscale"]["ip"]:
                result["recommendation"] = f"远程用户可通过 Tailscale 访问 http://{result['tailscale']['ip']}:8080"
            else:
                result["recommendation"] = "Tailscale 已安装但未获取到 IP，请运行 tailscale up"
        else:
            result["tailscale"]["status"] = "not_running"
    except FileNotFoundError:
        result["tailscale"]["status"] = "not_installed"
        result["recommendation"] = "安装 Tailscale 可实现安全的远程协作: https://tailscale.com/download"
    except Exception:
        pass

    return {"ok": True, "remote": result}


@router.post("/ws/remote/access-code")
def generate_access_code():
    """生成6位临时访问码（用于局域网快速接入）"""
    import secrets
    code = secrets.token_hex(3).upper()
    return {"ok": True, "code": code, "expires_in": "5分钟", "usage": f"局域网内访问 http://<host>:8080/join?code={code}"}
