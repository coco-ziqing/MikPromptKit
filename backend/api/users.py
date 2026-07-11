# -*- coding: utf-8 -*-
"""
用户管理 API — admin 权限
端点: /api/auth/users (列表+创建) / PUT /:id (编辑+启停+重置密码) / DELETE /:id
"""
import json, os, sqlite3, time
from fastapi import APIRouter, HTTPException, Body, Request, Query
from typing import Optional

from password import hash_pw, check_pw
from jwt_auth import get_current_user, create_jwt

router = APIRouter(tags=["用户管理"], prefix="/api/auth")

DB = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "prompts.db")

def _rw():
    conn = sqlite3.connect(DB, timeout=2)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def _ro():
    conn = sqlite3.connect(DB, timeout=2)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def _require_admin(request: Request):
    user = get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(403, "仅管理员可执行此操作")
    return user

# ============================================================
# 用户列表
# ============================================================

@router.get("/users")
def list_users(request: Request, q: Optional[str] = Query(None), role: Optional[str] = Query(None)):
    _require_admin(request)
    db = _ro()
    try:
        sql = "SELECT id, username, display_name, role, avatar_color, is_active, created_at, last_login_at FROM users WHERE 1=1"
        params = []
        if q:
            sql += " AND (username LIKE ? OR display_name LIKE ?)"
            params += [f"%{q}%", f"%{q}%"]
        if role:
            sql += " AND role=?"
            params.append(role)
        sql += " ORDER BY created_at DESC"
        rows = [dict(r) for r in db.execute(sql, params).fetchall()]
        return {"ok": True, "users": rows, "total": len(rows)}
    finally:
        db.close()


@router.get("/users/{user_id}")
def get_user(user_id: int, request: Request):
    _require_admin(request)
    db = _ro()
    try:
        user = db.execute("SELECT id, username, display_name, role, avatar_color, is_active, created_at, last_login_at, settings_json FROM users WHERE id=?", [user_id]).fetchone()
        if not user: raise HTTPException(404, "用户不存在")
        return {"ok": True, "user": dict(user)}
    finally: db.close()


# ============================================================
# 用户编辑
# ============================================================

@router.put("/users/{user_id}")
def update_user(user_id: int, data: dict = Body(...), request: Request = None):
    _require_admin(request)
    db = _rw()
    try:
        user = db.execute("SELECT id FROM users WHERE id=?", [user_id]).fetchone()
        if not user: raise HTTPException(404, "用户不存在")

        for k in ["display_name", "role", "avatar_color", "is_active", "settings_json"]:
            if k in data:
                val = data[k]
                if k == "settings_json":
                    val = json.dumps(val, ensure_ascii=False)
                db.execute(f"UPDATE users SET {k}=? WHERE id=?", [val, user_id])

        # 重置密码（可选）
        if data.get("new_password"):
            if len(data["new_password"]) < 4:
                raise HTTPException(400, "新密码至少4个字符")
            db.execute("UPDATE users SET password_hash=? WHERE id=?", [hash_pw(data["new_password"]), user_id])

        db.commit()
        return {"ok": True, "message": "用户已更新"}
    finally: db.close()


@router.delete("/users/{user_id}")
def delete_user(user_id: int, request: Request):
    _require_admin(request)
    user = _require_admin(request)
    if user_id == user.get("id"):
        raise HTTPException(400, "不能删除自己")

    db = _rw()
    try:
        db.execute("DELETE FROM users WHERE id=?", [user_id])
        db.execute("DELETE FROM user_sessions WHERE user_id=?", [user_id])
        db.commit()
        return {"ok": True, "message": "用户已删除"}
    finally: db.close()


# ============================================================
# 批量操作
# ============================================================

@router.post("/users/batch-toggle")
def batch_toggle_users(data: dict = Body(...), request: Request = None):
    """批量启停用户 Body: {"user_ids": [1,2], "is_active": 0}"""
    _require_admin(request)
    ids = data.get("user_ids", [])
    active = data.get("is_active", 1)
    if not ids: raise HTTPException(400, "user_ids 不能为空")
    db = _rw()
    try:
        for uid in ids:
            db.execute("UPDATE users SET is_active=? WHERE id=?", [active, uid])
        db.commit()
        return {"ok": True, "affected": len(ids)}
    finally: db.close()
