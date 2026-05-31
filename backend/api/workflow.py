"""
AI 工作流集成 API
为 ComfyUI / AutoGPT / 外部脚本 提供简洁的提示词拉取接口
"""
import json
import random
from fastapi import APIRouter, Query
from database import get_db

router = APIRouter(prefix="/api/v2/workflow", tags=["workflow"])


def _format_prompt(row, fmt="json"):
    """统一格式化返回"""
    p = dict(row)
    try:
        tags = json.loads(p["tags"]) if p["tags"] else []
    except Exception:
        tags = []
    
    result = {
        "id": p["id"],
        "content": p["content"],
        "meaning": p["meaning"] or "",
        "module": p["module"] or "",
        "category": p["category"] or "",
        "tags": tags,
        "usage_count": p.get("usage_count", 0)
    }
    
    if fmt == "text":
        # 纯文本格式，适合管道操作
        text = p["content"]
        if p.get("meaning"):
            text += "\n# " + p["meaning"]
        if tags:
            text += "\n# tags: " + ", ".join(tags)
        return text
    
    return result


@router.get("/random")
def random_prompt(fmt: str = Query("json", regex="^(json|text)$")):
    """随机取一条提示词"""
    db = get_db()
    row = db.execute("""
        SELECT id, content, meaning, module, category, tags, usage_count
        FROM prompts WHERE deleted_at IS NULL
        ORDER BY RANDOM() LIMIT 1
    """).fetchone()
    if not row:
        return {"ok": False, "error": "词库为空"}
    return {"ok": True, "prompt": _format_prompt(row, fmt)}


@router.get("/latest")
def latest_prompts(count: int = Query(5, ge=1, le=20), fmt: str = Query("json", regex="^(json|text)$")):
    """获取最新添加的提示词"""
    db = get_db()
    rows = db.execute("""
        SELECT id, content, meaning, module, category, tags, usage_count
        FROM prompts WHERE deleted_at IS NULL
        ORDER BY id DESC LIMIT ?
    """, [count]).fetchall()
    return {"ok": True, "prompts": [_format_prompt(r, fmt) for r in rows], "total": len(rows)}


@router.get("/by-module/{module}")
def prompts_by_module(module: str, count: int = Query(10, ge=1, le=50), fmt: str = Query("json", regex="^(json|text)$")):
    """按模块取提示词（如 emotion / color / camera_move / seedance）"""
    db = get_db()
    rows = db.execute("""
        SELECT id, content, meaning, module, category, tags, usage_count
        FROM prompts WHERE deleted_at IS NULL AND module=?
        ORDER BY usage_count DESC, id DESC LIMIT ?
    """, [module, count]).fetchall()
    return {"ok": True, "prompts": [_format_prompt(r, fmt) for r in rows], "total": len(rows)}


@router.get("/by-category/{category}")
def prompts_by_category(category: str, count: int = Query(10, ge=1, le=50), fmt: str = Query("json", regex="^(json|text)$")):
    """按分类取提示词"""
    db = get_db()
    rows = db.execute("""
        SELECT id, content, meaning, module, category, tags, usage_count
        FROM prompts WHERE deleted_at IS NULL AND category=?
        ORDER BY usage_count DESC, id DESC LIMIT ?
    """, [category, count]).fetchall()
    return {"ok": True, "prompts": [_format_prompt(r, fmt) for r in rows], "total": len(rows)}


@router.get("/search")
def workflow_search(q: str = Query("", min_length=1), count: int = Query(10, ge=1, le=30), fmt: str = Query("json", regex="^(json|text)$")):
    """关键词搜索（支持 FTS5 全文检索），专为工作流优化"""
    db = get_db()
    try:
        rows = db.execute("""
            SELECT p.id, p.content, p.meaning, p.module, p.category, p.tags, p.usage_count
            FROM prompts p
            JOIN prompts_fts fts ON fts.rowid = p.id
            WHERE prompts_fts MATCH ? AND p.deleted_at IS NULL
            ORDER BY rank
            LIMIT ?
        """, [q, count]).fetchall()
    except Exception:
        # FTS5 搜索失败时降级为 LIKE
        rows = db.execute("""
            SELECT id, content, meaning, module, category, tags, usage_count
            FROM prompts WHERE deleted_at IS NULL AND content LIKE ?
            ORDER BY usage_count DESC LIMIT ?
        """, [f"%{q}%", count]).fetchall()
    
    return {"ok": True, "query": q, "prompts": [_format_prompt(r, fmt) for r in rows], "total": len(rows)}


@router.get("/{prompt_id}")
def get_prompt(prompt_id: int, fmt: str = Query("json", regex="^(json|text)$")):
    """按 ID 获取单条提示词"""
    db = get_db()
    row = db.execute("""
        SELECT id, content, meaning, module, category, tags, usage_count
        FROM prompts WHERE id=? AND deleted_at IS NULL
    """, [prompt_id]).fetchone()
    if not row:
        return {"ok": False, "error": "提示词不存在"}
    return {"ok": True, "prompt": _format_prompt(row, fmt)}
