"""
标签管理 API
"""
from fastapi import APIRouter
from database import get_db, safe_commit
import json

router = APIRouter(prefix="/api/v2/tags", tags=["tags"])


@router.get("/list")
def list_all_tags():
    """获取所有已使用的标签列表（去重、排序）"""
    db = get_db()
    rows = db.execute("SELECT tags FROM prompts WHERE deleted_at IS NULL").fetchall()
    tag_set = set()
    for r in rows:
        try:
            t = json.loads(r["tags"]) if r["tags"] else []
            if isinstance(t, list):
                for tag in t:
                    if tag and isinstance(tag, str):
                        tag_set.add(tag.strip())
        except Exception:
            pass
    sorted_tags = sorted(tag_set, key=str.lower)
    return {"ok": True, "tags": sorted_tags, "total": len(sorted_tags)}


@router.post("/batch")
def batch_tag(data: dict):
    """批量添加/移除标签
    mode: 'add' | 'remove'
    prompt_ids: list[int]
    tags: list[str]
    """
    prompt_ids = data.get("prompt_ids", [])
    tags = data.get("tags", [])
    mode = data.get("mode", "add")

    if not prompt_ids or not tags:
        return {"ok": False, "error": "缺少参数"}

    db = get_db()
    updated = 0
    for pid in prompt_ids:
        row = db.execute("SELECT tags FROM prompts WHERE id=? AND deleted_at IS NULL", [pid]).fetchone()
        if not row:
            continue
        try:
            current = json.loads(row["tags"]) if row["tags"] else []
        except Exception:
            current = []
        if not isinstance(current, list):
            current = []

        if mode == "add":
            for t in tags:
                if t not in current:
                    current.append(t)
        elif mode == "remove":
            current = [t for t in current if t not in tags]

        db.execute("UPDATE prompts SET tags=? WHERE id=?", [json.dumps(current, ensure_ascii=False), pid])
        updated += 1

    safe_commit()
    return {"ok": True, "updated": updated}
