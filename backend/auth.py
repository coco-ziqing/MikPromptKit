# -*- coding: utf-8 -*-
"""
认证 API — 用户注册/登录/登出/Token刷新
端点: /api/auth/login, /api/auth/register, /api/auth/logout, /api/auth/me, /api/auth/refresh
"""
import json, os, sqlite3, time, hashlib, hmac, base64
from fastapi import APIRouter, HTTPException, Body, Request
from typing import Optional

from password import hash_pw, check_pw
from jwt_auth import create_jwt, verify_jwt, get_current_user
try:
    from audit import record_audit
except Exception:
    def record_audit(*a, **k): pass

router = APIRouter(tags=["认证"], prefix="/api/auth")

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

# ============================================================
# 登录限流
# ============================================================
_login_attempts = {}

def _check_rate_limit(ip: str) -> bool:
    if ip in ("127.0.0.1", "::1", "localhost"):
        return True
    now = time.time()
    attempts = _login_attempts.get(ip, [])
    attempts = [t for t in attempts if now - t < 900]
    _login_attempts[ip] = attempts
    return len(attempts) < 5

def _record_attempt(ip: str):
    if ip not in _login_attempts:
        _login_attempts[ip] = []
    _login_attempts[ip].append(time.time())

# ============================================================
# 端点
# ============================================================

@router.post("/register")
def register(data: dict = Body(...), request: Request = None):
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

    ua = request.headers.get("user-agent", "") if request else ""
    db2 = _rw()
    try:
        db2.execute(
            "INSERT INTO user_sessions (user_id, token, client_ip, user_agent, created_at, expires_at, is_active) VALUES (?,?,?,?,datetime('now','localtime'),datetime('now','+7 days','localtime'),1)",
            [user["id"], token, client_ip, ua])
        db2.commit()
    finally:
        db2.close()

    db3 = _rw()
    try:
        db3.execute("UPDATE users SET last_login_at=datetime('now','localtime') WHERE id=?", [user["id"]])
        db3.commit()
    finally:
        db3.close()

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

    if token and "." in token:
        try:
            parts = token.split(".")
            if len(parts) == 3:
                payload_b64 = parts[1]
                payload_b64 = payload_b64 + "=" * (-len(payload_b64) % 4)
                payload_json = base64.urlsafe_b64decode(payload_b64)
                payload = json.loads(payload_json)
                if payload.get("exp", 0) > time.time():
                    uid = payload.get("user_id", 1)
                    authenticated = True
        except Exception:
            pass

    db = _ro()
    try:
        row = db.execute(
            "SELECT id, username, display_name, role, is_active, created_at, last_login_at FROM users WHERE id=?",
            [uid]).fetchone()
        if row:
            return {"ok": True, "authenticated": authenticated, "user": dict(row)}
    finally:
        db.close()

    return {"ok": True, "authenticated": authenticated,
            "user": {"id": uid, "username": "admin", "role": "admin"}}


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
