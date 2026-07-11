# -*- coding: utf-8 -*-
"""
工作空间成员管理 API — 邀请/审批/角色/移交
端点: /api/plugins/com.promptkit.project/master/{id}/...
集成到 PM 插件 API 中

新增表: workspace_invites
"""
import json, os, sqlite3, time, secrets
from fastapi import APIRouter, HTTPException, Body, Request, Query
from typing import Optional

import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

router = APIRouter(tags=["工作空间管理"])

# 复用插件 API 的 DB 路径
_THIS = os.path.dirname(os.path.abspath(__file__))
_PLUGIN = os.path.dirname(_THIS)  # plugins/project/
_ROOT = os.path.dirname(os.path.dirname(_PLUGIN))  # project root
DB_PATH = os.path.join(_ROOT, "data", "prompts.db")

def _rw():
    conn = sqlite3.connect(DB_PATH, timeout=2)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def _ro():
    conn = sqlite3.connect(DB_PATH, timeout=2)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def _ensure_table():
    db = _rw()
    try:
        db.execute("""
        CREATE TABLE IF NOT EXISTS workspace_invites (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            master_project_id INTEGER NOT NULL,
            invite_code     TEXT UNIQUE NOT NULL,
            invite_link     TEXT DEFAULT '',
            invited_by      INTEGER NOT NULL,
            role            TEXT DEFAULT 'editor',
            status          TEXT DEFAULT 'pending',
            created_at      TEXT DEFAULT (datetime('now','localtime')),
            expires_at      TEXT,
            accepted_at     TEXT,
            FOREIGN KEY (master_project_id) REFERENCES master_project(id) ON DELETE CASCADE
        )
        """)
        db.commit()
    finally:
        db.close()

_ensure_table()


def _get_uid(request: Request) -> int:
    """从 JWT 获取 user_id"""
    if hasattr(request.state, 'user_id'):
        return request.state.user_id
    return 1

def _require_ws_admin(master_id: int, user_id: int):
    """检查用户是否为工作空间管理者"""
    db = _ro()
    try:
        # 全局 admin 或 项目所有者（total produced）均可管理
        urole = db.execute("SELECT role FROM users WHERE id=?", [user_id]).fetchone()
        if urole and urole["role"] == "admin":
            return
        # 检查是否是项目成员且角色等级足够高（L9+ = 总导演以上）
        member = db.execute(
            "SELECT role FROM project_members WHERE master_project_id=? AND user_id=?",
            [master_id, user_id]).fetchone()
        if not member:
            raise HTTPException(403, "你不是该工作空间的成员")
        # 检查角色等级
        from plugins.project.api import CREW_ROLES
        role_info = CREW_ROLES.get(member["role"], {})
        if role_info.get("level", 0) < 9:
            raise HTTPException(403, "仅总导演以上角色可管理成员")
    finally:
        db.close()


# ============================================================
# 邀请
# ============================================================

@router.post("/master/{master_id}/invites")
def create_invite(master_id: int, data: dict = Body(...), request: Request = None):
    """生成邀请码/链接"""
    uid = _get_uid(request) if request else 1
    _require_ws_admin(master_id, uid)

    role = data.get("role", "editor")
    db = _rw()
    try:
        code = secrets.token_hex(3).upper()  # 6-char hex
        link = f"/join?code={code}&ws={master_id}"
        db.execute(
            "INSERT INTO workspace_invites (master_project_id, invite_code, invite_link, invited_by, role, expires_at) VALUES (?,?,?,?,?,datetime('now','+7 days','localtime'))",
            [master_id, code, link, uid, role])
        db.commit()
        iid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        return {"ok": True, "id": iid, "code": code, "link": link, "role": role}
    finally:
        db.close()


@router.get("/master/{master_id}/invites")
def list_invites(master_id: int, request: Request = None):
    uid = _get_uid(request) if request else 1
    _require_ws_admin(master_id, uid)
    db = _ro()
    try:
        rows = db.execute(
            """SELECT wi.*, u.username as invited_by_name
               FROM workspace_invites wi LEFT JOIN users u ON wi.invited_by=u.id
               WHERE wi.master_project_id=? AND wi.status='pending'
               ORDER BY wi.created_at DESC""",
            [master_id]).fetchall()
        return {"ok": True, "invites": [dict(r) for r in rows]}
    finally:
        db.close()


@router.delete("/master/{master_id}/invites/{invite_id}")
def revoke_invite(master_id: int, invite_id: int, request: Request = None):
    uid = _get_uid(request) if request else 1
    _require_ws_admin(master_id, uid)
    db = _rw()
    try:
        db.execute("DELETE FROM workspace_invites WHERE id=? AND master_project_id=?", [invite_id, master_id])
        db.commit()
        return {"ok": True}
    finally:
        db.close()


# ============================================================
# 加入工作空间
# ============================================================

@router.post("/master/{master_id}/join")
def join_workspace(master_id: int, data: dict = Body(...), request: Request = None):
    """通过邀请码加入工作空间 Body: {"code": str}"""
    uid = _get_uid(request) if request else 1
    code = (data.get("code", "")).strip().upper()
    if not code:
        raise HTTPException(400, "邀请码不能为空")

    db = _rw()
    try:
        invite = db.execute(
            "SELECT * FROM workspace_invites WHERE master_project_id=? AND invite_code=? AND status='pending'",
            [master_id, code]).fetchone()
        if not invite:
            raise HTTPException(404, "邀请码无效或已过期")

        # 检查是否已是成员
        existing = db.execute(
            "SELECT id FROM project_members WHERE master_project_id=? AND user_id=?",
            [master_id, uid]).fetchone()
        if existing:
            raise HTTPException(409, "你已是该工作空间成员")

        # 添加成员
        db.execute(
            "INSERT INTO project_members (master_project_id, user_id, role, real_name, joined_at) VALUES (?,?,?,(SELECT COALESCE(display_name,username) FROM users WHERE id=?),datetime('now','localtime'))",
            [master_id, uid, invite["role"], uid])
        # 标记邀请已使用
        db.execute(
            "UPDATE workspace_invites SET status='accepted', accepted_at=datetime('now','localtime') WHERE id=?",
            [invite["id"]])
        db.commit()
        return {"ok": True, "message": "已加入工作空间", "role": invite["role"]}
    finally:
        db.close()


# ============================================================
# 成员管理
# ============================================================

@router.put("/master/{master_id}/members/{member_id}/role")
def update_member_role(master_id: int, member_id: int, data: dict = Body(...), request: Request = None):
    """更新成员角色"""
    uid = _get_uid(request) if request else 1
    _require_ws_admin(master_id, uid)
    role = data.get("role")
    if not role:
        raise HTTPException(400, "role 必填")
    db = _rw()
    try:
        db.execute("UPDATE project_members SET role=? WHERE id=? AND master_project_id=?", [role, member_id, master_id])
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@router.delete("/master/{master_id}/members/{member_id}")
def remove_member(master_id: int, member_id: int, request: Request = None):
    uid = _get_uid(request) if request else 1
    _require_ws_admin(master_id, uid)

    # 不允许移出自己
    member = _ro().execute("SELECT user_id FROM project_members WHERE id=? AND master_project_id=?", [member_id, master_id]).fetchone()
    if member and member["user_id"] == uid:
        raise HTTPException(400, "不能移出自己，请使用退出功能")

    db = _rw()
    try:
        db.execute("DELETE FROM project_members WHERE id=? AND master_project_id=?", [member_id, master_id])
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@router.post("/master/{master_id}/leave")
def leave_workspace(master_id: int, request: Request = None):
    """退出工作空间"""
    uid = _get_uid(request) if request else 1
    db = _rw()
    try:
        db.execute("DELETE FROM project_members WHERE master_project_id=? AND user_id=?", [master_id, uid])
        db.commit()
        return {"ok": True}
    finally:
        db.close()
