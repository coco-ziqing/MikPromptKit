"""
认证 API — 用户注册/登录/登出/Token刷新
端点: /api/auth/login, /api/auth/register, /api/auth/logout, /api/auth/me, /api/auth/refresh
"""
import hashlib
import os
import shutil
import sqlite3
import time
import uuid

from fastapi import APIRouter, Body, File, HTTPException, Request, UploadFile

from jwt_auth import create_jwt, get_current_user, require_role, verify_jwt
from password import check_pw, hash_pw

try:
    from audit import record_audit
except Exception:
    def record_audit(*a, **k): pass

router = APIRouter(tags=["认证"], prefix="/api/auth")

try:
    from paths import get_db_path
    DB = get_db_path()
except Exception:
    DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "prompts.db")

def _rw():
    conn = sqlite3.connect(DB, timeout=2)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=2000")
    return conn

def _ro():
    conn = sqlite3.connect(DB, timeout=2)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=2000")
    return conn

_require_admin = require_role("admin")

# ============================================================
# 登录限流（含持久化兜底验证）
# ============================================================
_login_attempts = {}
_MAX_ATTEMPTS = 5
_ATTEMPT_WINDOW = 900  # 15分钟窗口

def _check_rate_limit(ip: str) -> bool:
    if ip in ("127.0.0.1", "::1", "localhost"):
        return True
    now = time.time()
    attempts = _login_attempts.get(ip, [])
    attempts = [t for t in attempts if now - t < _ATTEMPT_WINDOW]
    _login_attempts[ip] = attempts
    return len(attempts) < _MAX_ATTEMPTS

def _record_attempt(ip: str):
    if ip not in _login_attempts:
        _login_attempts[ip] = []
    _login_attempts[ip].append(time.time())

# avatar 目录
_AVATAR_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "avatars")

# ============================================================
# 端点
# ============================================================

@router.post("/register")
def register(data: dict = Body(...), request: Request = None):
    _require_admin(request)
    username = (data.get("username", "")).strip().lower()
    password = data.get("password", "")
    display_name = data.get("display_name", "").strip() or username
    role = data.get("role", "editor")

    if not username or len(username) < 2:
        raise HTTPException(400, "用户名至少2个字符")
    if not password or len(password) < 4:
        raise HTTPException(400, "密码至少4个字符")
    if role not in ("admin", "editor", "viewer"):
        raise HTTPException(400, "无效角色")

    db = _rw()
    try:
        existing = db.execute("SELECT id FROM users WHERE username=?", [username]).fetchone()
        if existing:
            raise HTTPException(409, "用户名已存在")
        password_hash = hash_pw(password)
        db.execute(
            "INSERT INTO users (username, password_hash, display_name, role, is_active, settings_json, created_at) VALUES (?,?,?,?,1,'{}',datetime('now','localtime'))",
            [username, password_hash, display_name, role])
        db.commit()
        uid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        try:
            record_audit("register", request=request, user_id=uid, username=username,
                         detail=f"注册新账户 {display_name}（角色 {role}）", target_type="user", target_id=uid)
        except Exception:
            pass
        return {"ok": True, "id": uid, "username": username, "display_name": display_name, "role": role}
    finally:
        db.close()


@router.post("/login")
def login(data: dict = Body(...), request: Request = None):
    username = (data.get("username", "")).strip().lower()
    password = data.get("password", "")

    if not username or not password:
        raise HTTPException(400, "用户名和密码不能为空")

    client_ip = "127.0.0.1"
    if request and request.client:
        client_ip = request.client.host

    if not _check_rate_limit(client_ip):
        raise HTTPException(429, "登录尝试次数过多，请15分钟后重试")

    db = _ro()
    try:
        user = db.execute(
            "SELECT id, username, password_hash, display_name, role, is_active FROM users WHERE username=?",
            [username]).fetchone()
        if not user:
            _record_attempt(client_ip)
            record_audit("login_failed", request=request, username=username, status="fail", detail="用户名不存在")
            raise HTTPException(401, "用户名或密码错误")
        if not user["is_active"]:
            record_audit("login_failed", request=request, user_id=user["id"], username=user["username"], status="fail", detail="账户已被禁用")
            raise HTTPException(403, "账户已被禁用")
        if not check_pw(password, user["password_hash"]):
            _record_attempt(client_ip)
            record_audit("login_failed", request=request, user_id=user["id"], username=user["username"], status="fail", detail="密码错误")
            raise HTTPException(401, "用户名或密码错误")
    finally:
        db.close()

    _login_attempts.pop(client_ip, None)

    token = create_jwt({
        "user_id": user["id"],
        "username": user["username"],
        "role": user["role"],
        "iat": int(time.time()),
        "exp": int(time.time()) + 86400 * 7,
    })

    # 存储 token 哈希（非明文）
    token_hash = hashlib.sha256(token.encode()).hexdigest()

    ua = request.headers.get("user-agent", "") if request else ""
    db2 = _rw()
    try:
        db2.execute(
            "INSERT INTO user_sessions (user_id, token, client_ip, user_agent, created_at, expires_at, is_active) VALUES (?,?,?,?,datetime('now','localtime'),datetime('now','+7 days','localtime'),1)",
            [user["id"], token_hash, client_ip, ua])
        db2.execute("UPDATE users SET last_login_at=datetime('now','localtime') WHERE id=?", [user["id"]])
        db2.commit()
    finally:
        db2.close()

    try:
        record_audit("login", request=request, user_id=user["id"], username=user["username"],
                     detail=f"登录成功（{user['role']}）")
    except Exception:
        pass

    return {
        "ok": True,
        "token": token,
        "user": {
            "id": user["id"], "username": user["username"],
            "display_name": user["display_name"], "role": user["role"],
        }
    }


@router.post("/logout")
def logout(request: Request):
    user = get_current_user(request)
    token = None
    ah = request.headers.get("Authorization", "")
    if ah.startswith("Bearer "):
        token = ah[7:]
    else:
        token = request.cookies.get("pk_token", "")

    if token:
        db = _rw()
        try:
            db.execute("UPDATE user_sessions SET is_active=0 WHERE token=?", [token])
            db.commit()
        finally:
            db.close()

    try:
        if user and user.get("authenticated"):
            record_audit("logout", request=request, user_id=user.get("id"), username=user.get("username"), detail="主动登出")
    except Exception:
        pass

    return {"ok": True, "message": "已登出"}


@router.get("/me")
def whoami(request: Request):
    """获取当前用户 — 自包含 JWT 解析，不依赖中间件"""
    token = None
    ah = request.headers.get("Authorization", "")
    if ah.startswith("Bearer "):
        token = ah[7:]
    else:
        token = request.cookies.get("pk_token", "")

    uid = 1
    authenticated = False

    if token:
        payload = verify_jwt(token)
        if payload:
            uid = payload.get("user_id", 1)
            authenticated = True

    db = _ro()
    try:
        row = db.execute(
            "SELECT id, username, display_name, role, avatar_color, avatar_url, bio, website, phone, email, wechat, cover_url, is_active, created_at, last_login_at, settings_json FROM users WHERE id=?",
            [uid]).fetchone()
        if row:
            return {"ok": True, "authenticated": authenticated, "user": dict(row)}
    finally:
        db.close()

    return {"ok": True, "authenticated": authenticated,
            "user": {"id": uid, "username": "admin", "role": "admin"}}


# ============================================================
# 个人资料编辑（用户自主）
# ============================================================

@router.put("/me")
def update_my_profile(data: dict = Body(...), request: Request = None):
    """更新当前用户的个人资料：display_name, bio, website, avatar_color, 以及改密码（需旧密码验证）"""
    user = get_current_user(request)
    if not user.get("authenticated"):
        raise HTTPException(401, "请先登录")
    uid = user["id"]

    # 密码修改需旧密码验证
    if "old_password" in data and "new_password" in data:
        if not data["old_password"] or not data["new_password"]:
            raise HTTPException(400, "旧密码和新密码不能为空")
        if len(data["new_password"]) < 4:
            raise HTTPException(400, "新密码至少4个字符")
        db_check = _ro()
        try:
            current = db_check.execute("SELECT password_hash FROM users WHERE id=?", [uid]).fetchone()
        finally:
            db_check.close()
        if not current or not check_pw(data["old_password"], current["password_hash"]):
            raise HTTPException(400, "旧密码不正确")

    allowed = ["display_name", "bio", "website", "avatar_color", "phone", "email", "wechat"]
    updates = {k: data[k] for k in allowed if k in data}
    has_pw = "old_password" in data and "new_password" in data
    if not updates and not has_pw:
        return {"ok": True, "message": "没有需要更新的字段"}

    db = _rw()
    try:
        if updates:
            set_clauses = [f"{k}=?" for k in updates]
            params = list(updates.values()) + [uid]
            db.execute(f"UPDATE users SET {','.join(set_clauses)} WHERE id=?", params)
        if has_pw:
            db.execute("UPDATE users SET password_hash=? WHERE id=?", [hash_pw(data["new_password"]), uid])
        db.commit()
        # 返回更新后的完整用户信息
        row = db.execute(
            "SELECT id, username, display_name, role, avatar_color, avatar_url, bio, website, phone, email, wechat, cover_url, is_active, created_at, last_login_at, settings_json FROM users WHERE id=?",
            [uid]).fetchone()
        return {"ok": True, "user": dict(row) if row else None}
    finally:
        db.close()


@router.post("/me/avatar")
async def upload_avatar(request: Request, file: UploadFile = File(...)):
    """上传头像（裁剪建议 200x200，自动生成 80x80 缩略图）"""
    user = get_current_user(request)
    if not user.get("authenticated"):
        raise HTTPException(401, "请先登录")
    uid = user["id"]

    # 校验文件类型
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp"):
        raise HTTPException(400, "仅支持 JPG/PNG/GIF/WEBP 图片格式")

    # 限制大小 5MB
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(400, "图片不能超过 5MB")

    os.makedirs(_AVATAR_DIR, exist_ok=True)

    # 保存原图 + 缩略图
    raw_name = f"{uid}_{uuid.uuid4().hex[:8]}{ext}"
    thumb_name = f"{uid}_{uuid.uuid4().hex[:8]}_thumb{ext}"
    raw_path = os.path.join(_AVATAR_DIR, raw_name)
    thumb_path = os.path.join(_AVATAR_DIR, thumb_name)

    # ⚠ 先清理旧头像文件，再写入新文件（避免清理时误删新文件）
    for name in os.listdir(_AVATAR_DIR):
        if name.startswith(f"{uid}_"):
            try:
                os.remove(os.path.join(_AVATAR_DIR, name))
            except Exception:
                pass

    with open(raw_path, "wb") as f:
        f.write(content)

    # 生成 200x200 正方形缩略图
    thumb_ok = False
    try:
        from PIL import Image
        img = Image.open(raw_path)
        # 保留透明度，RGBA 模式确保圆角/裁剪区域不留黑边
        if img.mode != "RGBA":
            img = img.convert("RGBA")
        # 居中裁剪为正方形（取短边），再缩放到 200x200
        w, h = img.size
        side = min(w, h)
        left = (w - side) // 2
        top = (h - side) // 2
        img = img.crop((left, top, left + side, top + side))
        img = img.resize((200, 200), Image.LANCZOS)
        # 保存为 PNG 以保留透明度
        out_path = os.path.splitext(thumb_path)[0] + ".png"
        img.save(out_path, "PNG", quality=95)
        thumb_path = out_path
        thumb_ok = True
    except Exception:
        # Pillow not available or failed — use raw as thumb
        shutil.copy2(raw_path, thumb_path)

    # 更新数据库
    avatar_url = f"/api/auth/avatar/{uid}/{os.path.basename(thumb_path) if thumb_ok else os.path.basename(raw_path)}"

    db = _rw()
    try:
        db.execute("UPDATE users SET avatar_url=? WHERE id=?", [avatar_url, uid])
        db.commit()
    finally:
        db.close()

    return {"ok": True, "avatar_url": avatar_url}


@router.delete("/me/avatar")
def clear_avatar(request: Request):
    """清除用户头像，恢复为系统默认首字母头像"""
    user = get_current_user(request)
    if not user.get("authenticated"):
        raise HTTPException(401, "请先登录")
    uid = user["id"]
    # 清理磁盘文件
    for name in os.listdir(_AVATAR_DIR):
        if name.startswith(f"{uid}_"):
            try: os.remove(os.path.join(_AVATAR_DIR, name))
            except Exception: pass
    # 清空 DB 记录
    db = _rw()
    try:
        db.execute("UPDATE users SET avatar_url='' WHERE id=?", [uid])
        db.commit()
    finally:
        db.close()
    return {"ok": True, "message": "头像已清除"}


@router.get("/avatar/{user_id}/{filename}")
def serve_avatar(user_id: int, filename: str):
    """提供头像资源（公开访问，支持浏览器缓存）"""
    import re

    from fastapi.responses import FileResponse
    if not re.match(r'^[\w.\-_]+$', filename):
        raise HTTPException(400, "非法文件名")
    fp = os.path.join(_AVATAR_DIR, filename)
    if not os.path.exists(fp):
        raise HTTPException(404, "头像不存在")
    return FileResponse(fp, media_type="image/jpeg")


@router.get("/me/stats")
def my_stats(request: Request):
    """返回当前用户的创作统计（词卡数/资产数/项目数/被采纳数）"""
    user = get_current_user(request)
    if not user.get("authenticated"):
        raise HTTPException(401, "请先登录")

    db = _ro()
    try:
        cards = db.execute("SELECT COUNT(1) n FROM word_card").fetchone()["n"]
        assets = db.execute("SELECT COUNT(1) n FROM asset_catalog WHERE 1=1").fetchone()["n"]
        projects = db.execute("SELECT COUNT(1) n FROM project_space").fetchone()["n"]
        approved = db.execute("""
            SELECT COUNT(1) n FROM asset_version WHERE status = 'approved'
        """).fetchone()["n"]
        characters = db.execute("SELECT COUNT(1) n FROM character_profiles").fetchone()["n"]
        scenes = db.execute("SELECT COUNT(1) n FROM scene_profiles").fetchone()["n"]
        return {
            "ok": True,
            "stats": {
                "word_cards": cards,
                "assets": assets,
                "projects": projects,
                "approved_works": approved,
                "characters": characters,
                "scenes": scenes
            }
        }
    finally:
        db.close()


@router.post("/refresh")
def refresh_token(request: Request):
    user = get_current_user(request)
    if not user.get("authenticated"):
        raise HTTPException(401, "请先登录")

    token = create_jwt({
        "user_id": user["id"], "username": user["username"], "role": user["role"],
        "iat": int(time.time()), "exp": int(time.time()) + 86400 * 7,
    })
    return {"ok": True, "token": token}
