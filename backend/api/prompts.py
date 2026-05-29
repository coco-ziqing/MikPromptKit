"""
API 路由 — 提示词 CRUD、搜索、统计（加固版）
"""
import traceback
from fastapi import APIRouter, Query, HTTPException
from database import get_db

router = APIRouter(prefix="/api", tags=["prompts"])

def _safe_int(val, default=0):
    try: return int(val)
    except: return default

def _module_name(module_id):
    names = {"emotion": "人物表情", "color": "场景色彩", "tone": "画面色调", "composition": "构图运镜", "seedance": "Seedance视频"}
    return names.get(module_id, module_id)

def _safe_tags(tags_str):
    """安全解析 tags JSON"""
    import json as _j
    if not tags_str:
        return []
    try:
        return _j.loads(tags_str)
    except:
        return []


@router.get("/modules")
def list_modules():
    try:
        db = get_db()
        rows = db.execute("SELECT module, COUNT(*) as cnt FROM prompts WHERE is_builtin=1 GROUP BY module ORDER BY module").fetchall()
        return {"modules": [{"id": r["module"], "name": _module_name(r["module"]), "count": r["cnt"]} for r in rows]}
    except Exception:
        traceback.print_exc()
        return {"modules": []}


@router.get("/categories")
def list_categories(module: str = Query(None)):
    try:
        db = get_db()
        sql = "SELECT category, COUNT(*) as cnt FROM prompts WHERE is_builtin=1"
        params = []
        if module:
            sql += " AND module=?"
            params.append(module)
        sql += " GROUP BY category ORDER BY category"
        rows = db.execute(sql, params).fetchall()
        return {"categories": [{"id": r["category"], "name": r["category"], "count": r["cnt"]} for r in rows]}
    except Exception:
        traceback.print_exc()
        return {"categories": []}


@router.get("/prompts")
def list_prompts(
    module: str = Query(None), category: str = Query(None), search: str = Query(None),
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)
):
    try:
        db = get_db()
        params = []
        if search:
            like = f"%{search}%"
            where = " WHERE (p.content LIKE ? OR p.meaning LIKE ? OR p.tags LIKE ?) "
            params = [like, like, like]
        else:
            where = " WHERE 1=1 "
        from_clause = " FROM prompts p LEFT JOIN prompt_thumbnails pt ON pt.prompt_id = p.id LEFT JOIN prompt_videos pv ON pv.prompt_id = p.id "
        if module:
            where += " AND p.module=? "
            params.append(module)
        if category:
            where += " AND p.category=? "
            params.append(category)

        total_row = db.execute(f"SELECT COUNT(*) as cnt {from_clause} {where}", params).fetchone()
        total = total_row["cnt"] if total_row else 0

        offset = (page - 1) * page_size
        rows = db.execute(f"""
            SELECT p.id, p.module, p.category, p.subcategory, p.content, p.meaning, p.scene, p.tags,
                   p.usage_count, pt.filename as thumbnail, pv.filename as video_filename, pv.poster as video_poster
            {from_clause} {where}
            ORDER BY p.usage_count DESC, p.id ASC LIMIT ? OFFSET ?
        """, params + [page_size, offset]).fetchall()

        items = [dict(r) for r in rows] if rows else []

        # 收藏归属
        if items:
            ids = [str(item["id"]) for item in items]
            placeholders = ",".join("?" * len(ids))
            coll_rows = db.execute(f"""
                SELECT ci.prompt_id, c.id, c.name, c.icon
                FROM collection_items ci JOIN collections c ON c.id = ci.collection_id
                WHERE ci.prompt_id IN ({placeholders}) ORDER BY ci.prompt_id, c.sort_order
            """, [int(x) for x in ids]).fetchall() if ids else []
            coll_map = {}
            for r in coll_rows:
                pid = r["prompt_id"]
                if pid not in coll_map: coll_map[pid] = []
                coll_map[pid].append({"id": r["id"], "name": r["name"], "icon": r["icon"] or "⭐"})
            for item in items:
                item["collections"] = coll_map.get(item["id"], [])

        return {"total": total, "page": page, "page_size": page_size,
                "total_pages": max(1, (total + page_size - 1) // page_size), "items": items}
    except Exception:
        traceback.print_exc()
        return {"total": 0, "page": page, "page_size": page_size, "total_pages": 0, "items": []}


@router.get("/prompts/{prompt_id}")
def get_prompt(prompt_id: int):
    try:
        db = get_db()
        row = db.execute("""
            SELECT p.*, pt.filename as thumbnail
            FROM prompts p LEFT JOIN prompt_thumbnails pt ON pt.prompt_id = p.id WHERE p.id=?
        """, [prompt_id]).fetchone()
        if not row:
            raise HTTPException(404, "提示词不存在")
        result = dict(row)
        coll_rows = db.execute("""
            SELECT c.id, c.name, c.icon FROM collection_items ci
            JOIN collections c ON c.id = ci.collection_id WHERE ci.prompt_id=? ORDER BY c.sort_order
        """, [prompt_id]).fetchall()
        result["collections"] = [{"id": r["id"], "name": r["name"], "icon": r["icon"] or "⭐"} for r in coll_rows]
        return result
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        raise HTTPException(500, "查询失败")


@router.post("/prompts")
def create_prompt(data: dict):
    try:
        content = (data.get("content") or "").strip()
        if not content:
            raise HTTPException(400, "提示词内容不能为空")
        db = get_db()
        db.execute("INSERT INTO prompts (module, category, subcategory, content, meaning, scene, tags, is_builtin) "
                   "VALUES (?, ?, '', ?, ?, ?, ?, 0)",
                   [data.get("module", "custom") or "custom", data.get("category", "自定义") or "自定义",
                    content, data.get("meaning", "") or "", data.get("scene", "") or "", data.get("tags", "[]") or "[]"])
        db.commit()
        new_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        return {"ok": True, "id": new_id}
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        raise HTTPException(500, "创建失败")


@router.put("/prompts/{prompt_id}")
def update_prompt(prompt_id: int, data: dict):
    try:
        db = get_db()
        row = db.execute("SELECT id FROM prompts WHERE id=?", [prompt_id]).fetchone()
        if not row:
            raise HTTPException(404, "提示词不存在")
        fields = []
        params = []
        for key in ["module", "category", "content", "meaning", "scene", "tags"]:
            if key in data and data[key] is not None:
                fields.append(f"{key}=?")
                params.append(data[key])
        if not fields:
            raise HTTPException(400, "无更新字段")
        params.append(prompt_id)
        db.execute(f"UPDATE prompts SET {', '.join(fields)} WHERE id=?", params)
        db.commit()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        raise HTTPException(500, "更新失败")


@router.delete("/prompts/{prompt_id}")
def delete_prompt(prompt_id: int):
    try:
        db = get_db()
        row = db.execute("SELECT is_builtin FROM prompts WHERE id=?", [prompt_id]).fetchone()
        if not row:
            raise HTTPException(404, "提示词不存在")
        if row["is_builtin"] == 1:
            raise HTTPException(403, "内置提示词不可删除")
        for tbl in ["collection_items", "wordpack_items", "usage_history", "prompt_thumbnails", "prompt_videos"]:
            db.execute(f"DELETE FROM {tbl} WHERE prompt_id=?", [prompt_id])
        db.execute("DELETE FROM prompts WHERE id=?", [prompt_id])
        db.commit()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        raise HTTPException(500, "删除失败")


@router.post("/prompts/{prompt_id}/usage")
def increment_usage(prompt_id: int):
    try:
        db = get_db()
        db.execute("UPDATE prompts SET usage_count = usage_count + 1 WHERE id=?", [prompt_id])
        db.execute("INSERT INTO usage_history (prompt_id) VALUES (?)", [prompt_id])
        db.commit()
        return {"ok": True}
    except Exception:
        traceback.print_exc()
        return {"ok": False}


@router.get("/stats/top")
def get_top_prompts(limit: int = Query(10, ge=1, le=100)):
    try:
        db = get_db()
        rows = db.execute("""
            SELECT p.id, p.module, p.category, p.content, p.usage_count
            FROM prompts p ORDER BY p.usage_count DESC, p.id ASC LIMIT ?
        """, [limit]).fetchall()
        return {"items": [dict(r) for r in rows]}
    except Exception:
        traceback.print_exc()
        return {"items": []}
