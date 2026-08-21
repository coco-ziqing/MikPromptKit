# -*- coding: utf-8 -*-
"""
角色设定集 API — v5.47.0 链路验证版
能力：CRUD / 配置读写 / 版本快照与回滚 / 复制 / 收藏 / 回收站 / .style 导入导出
设计：五 Tab 配置统一存 config_json（单列 JSON 化，字段扩展不加表）
"""
import json
import os
import sqlite3
import time

from fastapi import APIRouter, Body, HTTPException, Query, Request
from pydantic import BaseModel

try:
    from database import get_db, safe_commit
except Exception:
    from ..database import get_db, safe_commit

from jwt_auth import get_current_user

router = APIRouter(tags=["角色设定集"])

# ==================== 工具 ====================

def _db():
    c = sqlite3.connect(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "data", "prompts.db"), timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=5000")
    return c


def _auth(request, require=True):
    u = get_current_user(request)
    if require and not (u and u.get("authenticated")):
        raise HTTPException(401, "请先登录")
    return u


def _now():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _suit_dict(r):
    return {
        "id": r["id"],
        "name": r["name"],
        "tags": json.loads(r["tags"] or "[]"),
        "cover_image": r["cover_image"],
        "remark": r["remark"],
        "config": json.loads(r["config_json"] or "{}"),
        "source": r["source"],
        "is_favorite": bool(r["is_favorite"]),
        "is_deleted": bool(r["is_deleted"]),
        "version_count": r["version_count"],
        "current_version_id": r["current_version_id"],
        "owner_user_id": r["owner_user_id"],
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
    }


def _default_config():
    """五 Tab 配置骨架"""
    return {
        "style_words": {"positive": "", "negative": ""},   # Tab1 风格词条
        "render_params": {                                  # Tab2 渲染参数
            "canvas_size": "1:1",
            "denoise": 0.6,
            "cfg": 5.0,
            "sampler": "",
            "steps": 25,
            "layer_render": False,
        },
        "output_parts": ["main"],                          # Tab3 产出配件
        "layout": {                                         # Tab4 整合排版
            "template": "default",
            "color_card": True,
            "title_text": "",
            "bg_color": "#ffffff",
        },
        "meta": {"name": "", "tags": [], "remark": "", "cover": ""},  # Tab5 基础信息
    }


def _snapshot(c, suit_id: int, config_json: str, name: str, u):
    """保存前自动快照到版本池"""
    cur = c.execute("SELECT COALESCE(MAX(version),0)+1 AS v FROM style_suit_version WHERE suit_id=?", [suit_id])
    v = cur.fetchone()["v"]
    cur = c.execute(
        "INSERT INTO style_suit_version (suit_id, version, config_json, name_snapshot, created_by, created_at) VALUES (?,?,?,?,?,?)",
        [suit_id, v, config_json, name, u.get("id") if u else None, _now()],
    )
    return cur.lastrowid


# ==================== Pydantic ====================

class StyleSuitCreate(BaseModel):
    name: str
    tags: list[str] = []
    cover_image: str = ""
    remark: str = ""
    config: dict | None = None


class StyleSuitUpdate(BaseModel):
    name: str | None = None
    tags: list[str] | None = None
    cover_image: str | None = None
    remark: str | None = None
    config: dict | None = None


# ==================== API ====================

@router.get("/api/style-packs")
def list_style_suits(request: Request,
                     tab: str = Query("all", description="all/user/system/favorite/trash"),
                     tag: str = Query(""),
                     q: str = Query(""),
                     limit: int = Query(200, le=500)):
    """套装背包列表：Tab 分类 + 标签筛选 + 搜索"""
    _auth(request)
    c = _db()
    try:
        where = []
        args = []
        if tab == "trash":
            where.append("is_deleted=1")
        else:
            where.append("is_deleted=0")
            if tab == "user":
                where.append("source='user'")
            elif tab == "system":
                where.append("source='system'")
            elif tab == "favorite":
                where.append("is_favorite=1")
        if tag:
            where.append("tags LIKE ?")
            args.append(f'%"{tag}"%')
        if q:
            where.append("(name LIKE ? OR tags LIKE ? OR remark LIKE ?)")
            args += [f"%{q}%", f"%{q}%", f"%{q}%"]
        sql = "SELECT * FROM style_suit WHERE " + " AND ".join(where) + " ORDER BY is_favorite DESC, updated_at DESC LIMIT ?"
        args.append(limit)
        rows = c.execute(sql, args).fetchall()
        return {"ok": True, "total": len(rows), "items": [_suit_dict(r) for r in rows]}
    finally:
        c.close()


@router.post("/api/style-packs")
def create_style_suit(data: StyleSuitCreate, request: Request):
    """新建套装（含默认五 Tab 配置）"""
    u = _auth(request)
    if not data.name or not data.name.strip():
        raise HTTPException(400, "套装名称必填")
    c = _db()
    try:
        cfg = data.config or _default_config()
        cfg.setdefault("meta", {})["name"] = data.name
        cfg["meta"]["tags"] = data.tags
        cfg["meta"]["remark"] = data.remark
        cfg["meta"]["cover"] = data.cover_image
        now = _now()
        cur = c.execute(
            """INSERT INTO style_suit (name, tags, cover_image, remark, config_json, source, owner_user_id, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            [data.name.strip(), json.dumps(data.tags, ensure_ascii=False), data.cover_image,
             data.remark, json.dumps(cfg, ensure_ascii=False), "user",
             u.get("id") if u else None, now, now],
        )
        sid = cur.lastrowid
        vid = _snapshot(c, sid, json.dumps(cfg, ensure_ascii=False), data.name.strip(), u)
        c.execute("UPDATE style_suit SET current_version_id=? WHERE id=?", [vid, sid])
        c.commit()
        r = c.execute("SELECT * FROM style_suit WHERE id=?", [sid]).fetchone()
        return {"ok": True, "item": _suit_dict(r)}
    finally:
        c.close()


@router.get("/api/style-packs/{suit_id}")
def get_style_suit(suit_id: int, request: Request):
    _auth(request)
    c = _db()
    try:
        r = c.execute("SELECT * FROM style_suit WHERE id=?", [suit_id]).fetchone()
        if not r:
            raise HTTPException(404, "套装不存在")
        return {"ok": True, "item": _suit_dict(r)}
    finally:
        c.close()


@router.put("/api/style-packs/{suit_id}")
def update_style_suit(suit_id: int, data: StyleSuitUpdate, request: Request):
    """更新套装：保存覆盖 + 自动版本快照"""
    u = _auth(request)
    c = _db()
    try:
        r = c.execute("SELECT * FROM style_suit WHERE id=? AND is_deleted=0", [suit_id]).fetchone()
        if not r:
            raise HTTPException(404, "套装不存在")
        cfg = json.loads(r["config_json"] or "{}")
        if data.config is not None:
            cfg = data.config
        name = data.name.strip() if data.name is not None and data.name.strip() else r["name"]
        tags = data.tags if data.tags is not None else json.loads(r["tags"] or "[]")
        cover = data.cover_image if data.cover_image is not None else r["cover_image"]
        remark = data.remark if data.remark is not None else r["remark"]
        cfg.setdefault("meta", {})["name"] = name
        cfg["meta"]["tags"] = tags
        cfg["meta"]["remark"] = remark
        cfg["meta"]["cover"] = cover
        vid = _snapshot(c, suit_id, json.dumps(cfg, ensure_ascii=False), name, u)
        c.execute(
            """UPDATE style_suit SET name=?, tags=?, cover_image=?, remark=?, config_json=?,
               version_count=version_count+1, current_version_id=?, updated_at=? WHERE id=?""",
            [name, json.dumps(tags, ensure_ascii=False), cover, remark,
             json.dumps(cfg, ensure_ascii=False), vid, _now(), suit_id],
        )
        c.commit()
        r2 = c.execute("SELECT * FROM style_suit WHERE id=?", [suit_id]).fetchone()
        return {"ok": True, "item": _suit_dict(r2)}
    finally:
        c.close()


@router.delete("/api/style-packs/{suit_id}")
def delete_style_suit(suit_id: int, request: Request, force: bool = Query(False)):
    """删除：软删除进回收站；force=true 永久删除"""
    _auth(request)
    c = _db()
    try:
        r = c.execute("SELECT * FROM style_suit WHERE id=?", [suit_id]).fetchone()
        if not r:
            raise HTTPException(404, "套装不存在")
        if force:
            c.execute("DELETE FROM style_suit_version WHERE suit_id=?", [suit_id])
            c.execute("DELETE FROM style_suit WHERE id=?", [suit_id])
        else:
            c.execute("UPDATE style_suit SET is_deleted=1, deleted_at=? WHERE id=?", [_now(), suit_id])
        c.commit()
        return {"ok": True}
    finally:
        c.close()


@router.post("/api/style-packs/{suit_id}/restore")
def restore_style_suit(suit_id: int, request: Request):
    """从回收站恢复"""
    _auth(request)
    c = _db()
    try:
        c.execute("UPDATE style_suit SET is_deleted=0, deleted_at='' WHERE id=?", [suit_id])
        c.commit()
        return {"ok": True}
    finally:
        c.close()


@router.post("/api/style-packs/{suit_id}/duplicate")
def duplicate_style_suit(suit_id: int, request: Request):
    """一键复制衍生新套装"""
    u = _auth(request)
    c = _db()
    try:
        r = c.execute("SELECT * FROM style_suit WHERE id=?", [suit_id]).fetchone()
        if not r:
            raise HTTPException(404, "套装不存在")
        cfg = json.loads(r["config_json"] or "{}")
        cfg.setdefault("meta", {})["name"] = r["name"] + " 副本"
        now = _now()
        cur = c.execute(
            """INSERT INTO style_suit (name, tags, cover_image, remark, config_json, source, owner_user_id, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            [r["name"] + " 副本", r["tags"], r["cover_image"], r["remark"],
             json.dumps(cfg, ensure_ascii=False), "user",
             u.get("id") if u else None, now, now],
        )
        sid = cur.lastrowid
        vid = _snapshot(c, sid, json.dumps(cfg, ensure_ascii=False), r["name"] + " 副本", u)
        c.execute("UPDATE style_suit SET current_version_id=? WHERE id=?", [vid, sid])
        c.commit()
        r2 = c.execute("SELECT * FROM style_suit WHERE id=?", [sid]).fetchone()
        return {"ok": True, "item": _suit_dict(r2)}
    finally:
        c.close()


@router.put("/api/style-packs/{suit_id}/favorite")
def favorite_style_suit(suit_id: int, request: Request, fav: bool = Body(True, embed=True)):
    _auth(request)
    c = _db()
    try:
        c.execute("UPDATE style_suit SET is_favorite=? WHERE id=?", [1 if fav else 0, suit_id])
        c.commit()
        return {"ok": True}
    finally:
        c.close()


@router.get("/api/style-packs/{suit_id}/versions")
def list_suit_versions(suit_id: int, request: Request):
    _auth(request)
    c = _db()
    try:
        rows = c.execute(
            "SELECT id, version, name_snapshot, created_by, created_at FROM style_suit_version WHERE suit_id=? ORDER BY version DESC",
            [suit_id],
        ).fetchall()
        return {"ok": True, "items": [dict(r) for r in rows]}
    finally:
        c.close()


@router.post("/api/style-packs/{suit_id}/rollback")
def rollback_suit(suit_id: int, request: Request, version_id: int = Body(..., embed=True)):
    """回滚到指定版本（回滚本身也生成新快照）"""
    u = _auth(request)
    c = _db()
    try:
        v = c.execute("SELECT * FROM style_suit_version WHERE id=? AND suit_id=?", [version_id, suit_id]).fetchone()
        if not v:
            raise HTTPException(404, "版本不存在")
        cfg = json.loads(v["config_json"] or "{}")
        name = v["name_snapshot"]
        tags = cfg.get("meta", {}).get("tags", [])
        remark = cfg.get("meta", {}).get("remark", "")
        cover = cfg.get("meta", {}).get("cover", "")
        vid = _snapshot(c, suit_id, json.dumps(cfg, ensure_ascii=False), name + " (回滚)", u)
        c.execute(
            """UPDATE style_suit SET name=?, tags=?, cover_image=?, remark=?, config_json=?,
               version_count=version_count+1, current_version_id=?, updated_at=? WHERE id=?""",
            [name, json.dumps(tags, ensure_ascii=False), cover, remark,
             json.dumps(cfg, ensure_ascii=False), vid, _now(), suit_id],
        )
        c.commit()
        r = c.execute("SELECT * FROM style_suit WHERE id=?", [suit_id]).fetchone()
        return {"ok": True, "item": _suit_dict(r)}
    finally:
        c.close()


# ==================== .style 导入导出 ====================

STYLE_SCHEMA_VERSION = 1


@router.get("/api/style-packs/{suit_id}/export")
def export_style_suit(suit_id: int, request: Request):
    """导出 .style 文件（JSON，含 schema 版本）"""
    _auth(request)
    c = _db()
    try:
        r = c.execute("SELECT * FROM style_suit WHERE id=?", [suit_id]).fetchone()
        if not r:
            raise HTTPException(404, "套装不存在")
        cfg = json.loads(r["config_json"] or "{}")
        doc = {
            "format": "mikpromptkit.style-pack",
            "schema_version": STYLE_SCHEMA_VERSION,
            "name": r["name"],
            "tags": json.loads(r["tags"] or "[]"),
            "remark": r["remark"],
            "cover_image": r["cover_image"],
            "config": cfg,
            "exported_at": _now(),
        }
        return {"ok": True, "filename": f"{r['name']}.style", "doc": doc}
    finally:
        c.close()


@router.post("/api/style-packs/import")
def import_style_suit(request: Request, doc: dict = Body(...)):
    """导入 .style 文件（schema 版本校验）"""
    u = _auth(request)
    if doc.get("format") != "mikpromptkit.style-pack":
        raise HTTPException(400, "非法的 .style 文件格式")
    ver = int(doc.get("schema_version") or 1)
    if ver > STYLE_SCHEMA_VERSION:
        raise HTTPException(400, f".style schema v{ver} 高于当前支持 v{STYLE_SCHEMA_VERSION}，请升级系统")
    name = (doc.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "套装名称缺失")
    c = _db()
    try:
        cfg = doc.get("config") or _default_config()
        tags = doc.get("tags") or []
        remark = doc.get("remark") or ""
        cover = doc.get("cover_image") or ""
        now = _now()
        cur = c.execute(
            """INSERT INTO style_suit (name, tags, cover_image, remark, config_json, source, owner_user_id, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            [name, json.dumps(tags, ensure_ascii=False), cover, remark,
             json.dumps(cfg, ensure_ascii=False), "user",
             u.get("id") if u else None, now, now],
        )
        sid = cur.lastrowid
        vid = _snapshot(c, sid, json.dumps(cfg, ensure_ascii=False), name, u)
        c.execute("UPDATE style_suit SET current_version_id=? WHERE id=?", [vid, sid])
        c.commit()
        r = c.execute("SELECT * FROM style_suit WHERE id=?", [sid]).fetchone()
        return {"ok": True, "item": _suit_dict(r)}
    finally:
        c.close()
