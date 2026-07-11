# -*- coding: utf-8 -*-
"""
团队小组 (Squad) API — 工作空间内按职能/项目分组
表: workspace_squads + squad_members
"""
import json, os, sqlite3, time
from fastapi import APIRouter, HTTPException, Body, Request, Query
from typing import Optional

router = APIRouter(tags=["团队小组"])

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "prompts.db")

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

def _ensure_tables():
    db = _rw()
    try:
        db.execute("""
        CREATE TABLE IF NOT EXISTS workspace_squads (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            master_project_id INTEGER NOT NULL,
            name              TEXT NOT NULL,
            description       TEXT DEFAULT '',
            color             TEXT DEFAULT '#3b82f6',
            icon              TEXT DEFAULT '👥',
            sort_order        INTEGER DEFAULT 0,
            created_at        TEXT DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (master_project_id) REFERENCES master_project(id) ON DELETE CASCADE
        )""")
        db.execute("""
        CREATE TABLE IF NOT EXISTS squad_members (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            squad_id   INTEGER NOT NULL,
            member_id  INTEGER NOT NULL,
            role       TEXT DEFAULT 'member',
            joined_at  TEXT DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (squad_id) REFERENCES workspace_squads(id) ON DELETE CASCADE,
            FOREIGN KEY (member_id) REFERENCES project_members(id) ON DELETE CASCADE,
            UNIQUE(squad_id, member_id)
        )""")
        db.commit()
    finally: db.close()

_ensure_tables()

def _get_uid(request: Request) -> int:
    if hasattr(request.state, 'user_id'): return request.state.user_id
    return 1

# ============================================================
# 小组 CRUD
# ============================================================

@router.get("/master/{master_id}/squads")
def list_squads(master_id: int):
    db = _ro()
    try:
        rows = db.execute(
            """SELECT s.*, (SELECT COUNT(*) FROM squad_members WHERE squad_id=s.id) as member_count
               FROM workspace_squads s WHERE s.master_project_id=? ORDER BY s.sort_order""",
            [master_id]).fetchall()
        squads = []
        for r in rows:
            s = dict(r)
            # 获取组成员详情
            members = db.execute(
                """SELECT sm.*, pm.real_name, pm.role as member_role, pm.avatar, pm.avatar_color
                   FROM squad_members sm JOIN project_members pm ON sm.member_id=pm.id
                   WHERE sm.squad_id=? ORDER BY sm.joined_at""",
                [s["id"]]).fetchall()
            s["members"] = [dict(m) for m in members]
            squads.append(s)
        return {"ok": True, "squads": squads}
    finally: db.close()

@router.post("/master/{master_id}/squads")
def create_squad(master_id: int, data: dict = Body(...)):
    name = (data.get("name", "")).strip()
    if not name: raise HTTPException(400, "name 必填")
    db = _rw()
    try:
        max_o = db.execute("SELECT COALESCE(MAX(sort_order),-1)+1 FROM workspace_squads WHERE master_project_id=?", [master_id]).fetchone()[0]
        db.execute(
            "INSERT INTO workspace_squads (master_project_id, name, description, color, icon, sort_order) VALUES (?,?,?,?,?,?)",
            [master_id, name, data.get("description",""), data.get("color","#3b82f6"), data.get("icon","👥"), max_o])
        db.commit()
        sid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        return {"ok": True, "id": sid}
    finally: db.close()

@router.put("/master/squads/{squad_id}")
def update_squad(squad_id: int, data: dict = Body(...)):
    db = _rw()
    try:
        for k in ["name", "description", "color", "icon", "sort_order"]:
            if k in data:
                db.execute(f"UPDATE workspace_squads SET {k}=? WHERE id=?", [data[k], squad_id])
        db.commit()
        return {"ok": True}
    finally: db.close()

@router.delete("/master/squads/{squad_id}")
def delete_squad(squad_id: int):
    db = _rw()
    try:
        db.execute("DELETE FROM workspace_squads WHERE id=?", [squad_id])
        db.commit()
        return {"ok": True}
    finally: db.close()

# ============================================================
# 组成员
# ============================================================

@router.post("/master/squads/{squad_id}/members")
def add_squad_member(squad_id: int, data: dict = Body(...)):
    mid = data.get("member_id")
    if not mid: raise HTTPException(400, "member_id 必填")
    db = _rw()
    try:
        sq = db.execute("SELECT master_project_id FROM workspace_squads WHERE id=?", [squad_id]).fetchone()
        if not sq: raise HTTPException(404, "小组不存在")
        # 检查成员是否在该工作空间
        pm = db.execute("SELECT id FROM project_members WHERE id=? AND master_project_id=?", [mid, sq["master_project_id"]]).fetchone()
        if not pm: raise HTTPException(400, "该成员不属于此工作空间")
        exists = db.execute("SELECT id FROM squad_members WHERE squad_id=? AND member_id=?", [squad_id, mid]).fetchone()
        if exists: return {"ok": True, "message": "已在组内"}
        db.execute("INSERT INTO squad_members (squad_id, member_id) VALUES (?,?)", [squad_id, mid])
        db.commit()
        return {"ok": True}
    finally: db.close()

@router.delete("/master/squads/{squad_id}/members/{member_id}")
def remove_squad_member(squad_id: int, member_id: int):
    db = _rw()
    try:
        db.execute("DELETE FROM squad_members WHERE squad_id=? AND id=?", [squad_id, member_id])
        db.commit()
        return {"ok": True}
    finally: db.close()

@router.get("/master/{master_id}/unassigned-members")
def unassigned_members(master_id: int):
    """返回未分配到任何小组的成员"""
    db = _ro()
    try:
        rows = db.execute(
            """SELECT pm.* FROM project_members pm
               WHERE pm.master_project_id=? AND pm.id NOT IN (SELECT DISTINCT member_id FROM squad_members sm JOIN workspace_squads ws ON sm.squad_id=ws.id WHERE ws.master_project_id=?)
               ORDER BY pm.joined_at""",
            [master_id, master_id]).fetchall()
        return {"ok": True, "members": [dict(r) for r in rows]}
    finally: db.close()
