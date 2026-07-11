# -*- coding: utf-8 -*-
"""
封面内容管理 API — 首页封面页的标题/描述/图片可编辑存储
表: app_cover_content
"""
import json, os, sqlite3, time
from fastapi import APIRouter, HTTPException, Body, Request

router = APIRouter(tags=["封面管理"], prefix="/api/cover")

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

def _ensure_table():
    db = _rw()
    try:
        db.execute("""
        CREATE TABLE IF NOT EXISTS app_cover_content (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            config_key   TEXT UNIQUE NOT NULL,
            config_value TEXT DEFAULT '',
            updated_at   TEXT DEFAULT (datetime('now','localtime'))
        )""")
        # 种子默认内容
        defaults = {
            "title": "咪卡Mik词库",
            "subtitle": "AIGC 提示词全流程管理平台",
            "description": "专为 AI 影视创作者打造。从剧本构思到分镜输出，\n一站管理角色、场景、提示词，支持局域网多端协同。\n内置 Ollama 16 模型池 + ComfyUI 无缝集成。",
            "cover_images": json.dumps([
                {"src":"/static/img/cover_hero.svg","alt":"工作台总览","label":"全流程看板"},
                {"src":"/static/img/cover_search.svg","alt":"智能检索","label":"提示词检索"},
                {"src":"/static/img/cover_assets.svg","alt":"资产管理","label":"角色场景资产库"}
            ], ensure_ascii=False),
            "version": "v5.7",
            "login_hint": "登录以使用全部功能",
        }
        for k, v in defaults.items():
            db.execute(
                "INSERT OR IGNORE INTO app_cover_content (config_key, config_value) VALUES (?,?)",
                [k, v])
        db.commit()
    finally:
        db.close()

_ensure_table()

# ============================================================
# API
# ============================================================

@router.get("")
def get_cover():
    """获取封面内容"""
    db = _ro()
    try:
        rows = db.execute("SELECT config_key, config_value FROM app_cover_content").fetchall()
        data = {}
        for r in rows:
            k, v = r["config_key"], r["config_value"]
            if k == "cover_images":
                try: data[k] = json.loads(v)
                except: data[k] = []
            else:
                data[k] = v
        return {"ok": True, "cover": data}
    finally: db.close()


@router.put("")
def update_cover(data: dict = Body(...)):
    """更新封面内容"""
    db = _rw()
    try:
        for k, v in data.items():
            val = json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else str(v)
            db.execute(
                "INSERT INTO app_cover_content (config_key, config_value) VALUES (?,?) ON CONFLICT(config_key) DO UPDATE SET config_value=?, updated_at=datetime('now','localtime')",
                [k, val, val])
        db.commit()
        return {"ok": True, "message": "封面内容已更新"}
    finally: db.close()
