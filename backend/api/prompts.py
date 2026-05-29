"""
API 路由 — 提示词 CRUD、搜索、统计
"""
from fastapi import APIRouter, Query, HTTPException
from database import get_db

router = APIRouter(prefix="/api", tags=["prompts"])


@router.get("/modules")
def list_modules():
    """获取所有模块列表"""
    db = get_db()
    rows = db.execute("""
        SELECT module, COUNT(*) as cnt
        FROM prompts
        WHERE is_builtin=1
        GROUP BY module
        ORDER BY module
    """).fetchall()
    return {
        "modules": [
            {
                "id": r["module"],
                "name": _module_name(r["module"]),
                "count": r["cnt"]
            }
            for r in rows
        ]
    }


@router.get("/categories")
def list_categories(module: str = Query(None)):
    """获取指定模块下的分类列表"""
    db = get_db()
    sql = "SELECT category, COUNT(*) as cnt FROM prompts WHERE is_builtin=1"
    params = []
    if module:
        sql += " AND module=?"
        params.append(module)
    sql += " GROUP BY category ORDER BY category"
    rows = db.execute(sql, params).fetchall()
    return {
        "categories": [
            {
                "id": r["category"],
                "name": r["category"],
                "count": r["cnt"]
            }
            for r in rows
        ]
    }


@router.get("/prompts")
def list_prompts(
    module: str = Query(None),
    category: str = Query(None),
    search: str = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200)
):
    """查询提示词列表，支持按模块/分类过滤 + 全文搜索"""
    db = get_db()
    params = []

    if search:
        like_search = f"%{search}%"
        where_clause = " WHERE (p.content LIKE ? OR p.meaning LIKE ? OR p.tags LIKE ?) "
        params = [like_search, like_search, like_search]
    else:
        where_clause = " WHERE 1=1 "

    from_clause = " FROM prompts p LEFT JOIN prompt_thumbnails pt ON pt.prompt_id = p.id LEFT JOIN prompt_videos pv ON pv.prompt_id = p.id "

    if module:
        where_clause += " AND p.module=? "
        params.append(module)
    if category:
        where_clause += " AND p.category=? "
        params.append(category)

    # 查询总数
    total = db.execute(
        f"SELECT COUNT(*) as total {from_clause} {where_clause}",
        params
    ).fetchone()["total"]

    # 分页查询
    offset = (page - 1) * page_size
    data_sql = f"""
        SELECT p.id, p.module, p.category, p.subcategory,
               p.content, p.meaning, p.scene, p.tags,
               p.usage_count,
               pt.filename as thumbnail,
               pv.filename as video_filename,
               pv.poster as video_poster
        {from_clause} {where_clause}
        ORDER BY p.usage_count DESC, p.id ASC
        LIMIT ? OFFSET ?
    """
    rows = db.execute(data_sql, params + [page_size, offset]).fetchall()
    items = [dict(r) for r in rows]

    # 批量查询每个提示词的收藏归属
    if items:
        ids = [str(item["id"]) for item in items]
        # 手动查 collection_items
        placeholders = ",".join("?" * len(ids))
        coll_rows = db.execute(f"""
            SELECT ci.prompt_id, c.id, c.name, c.icon
            FROM collection_items ci
            JOIN collections c ON c.id = ci.collection_id
            WHERE ci.prompt_id IN ({placeholders})
            ORDER BY ci.prompt_id, c.sort_order
        """, [int(x) for x in ids]).fetchall()

        coll_map = {}
        for r in coll_rows:
            pid = r["prompt_id"]
            if pid not in coll_map:
                coll_map[pid] = []
            coll_map[pid].append({
                "id": r["id"],
                "name": r["name"],
                "icon": r["icon"] or "⭐"
            })

        for item in items:
            item["collections"] = coll_map.get(item["id"], [])

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "items": items
    }


@router.get("/prompts/{prompt_id}")
def get_prompt(prompt_id: int):
    """获取单条提示词详情（含缩略图 + 收藏归属）"""
    db = get_db()
    row = db.execute("""
        SELECT p.*, pt.filename as thumbnail
        FROM prompts p
        LEFT JOIN prompt_thumbnails pt ON pt.prompt_id = p.id
        WHERE p.id=?
    """, [prompt_id]).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="提示词不存在")

    result = dict(row)
    # 查收藏归属
    coll_rows = db.execute("""
        SELECT c.id, c.name, c.icon
        FROM collection_items ci
        JOIN collections c ON c.id = ci.collection_id
        WHERE ci.prompt_id=?
        ORDER BY c.sort_order
    """, [prompt_id]).fetchall()
    result["collections"] = [{"id": r["id"], "name": r["name"], "icon": r["icon"] or "⭐"} for r in coll_rows]
    return result


@router.post("/prompts")
def create_prompt(data: dict):
    """创建自定义提示词"""
    module = data.get("module", "")
    category = data.get("category", "")
    content = data.get("content", "").strip()
    if not content:
        raise HTTPException(400, "提示词内容不能为空")
    meaning = data.get("meaning", "")
    scene = data.get("scene", "")
    tags = data.get("tags", "[]")
    db = get_db()
    db.execute(
        "INSERT INTO prompts (module, category, subcategory, content, meaning, scene, tags, is_builtin) "
        "VALUES (?, ?, '', ?, ?, ?, ?, 0)",
        [module or "custom", category or "自定义", content, meaning, scene, tags]
    )
    db.commit()
    new_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    return {"ok": True, "id": new_id}


@router.put("/prompts/{prompt_id}")
def update_prompt(prompt_id: int, data: dict):
    """更新提示词内容"""
    db = get_db()
    row = db.execute("SELECT * FROM prompts WHERE id=?", [prompt_id]).fetchone()
    if not row:
        raise HTTPException(404, "提示词不存在")
    fields = []
    params = []
    for key in ["module", "category", "content", "meaning", "scene", "tags"]:
        if key in data:
            fields.append(f"{key}=?")
            params.append(data[key])
    if not fields:
        raise HTTPException(400, "无更新字段")
    params.append(prompt_id)
    db.execute(f"UPDATE prompts SET {', '.join(fields)} WHERE id=?", params)
    db.commit()
    return {"ok": True}


@router.delete("/prompts/{prompt_id}")
def delete_prompt(prompt_id: int):
    """删除提示词（仅允许删除用户自建 is_builtin=0）"""
    db = get_db()
    row = db.execute("SELECT is_builtin FROM prompts WHERE id=?", [prompt_id]).fetchone()
    if not row:
        raise HTTPException(404, "提示词不存在")
    if row["is_builtin"] == 1:
        raise HTTPException(403, "内置提示词不可删除")
    # 级联删除关联数据
    db.execute("DELETE FROM collection_items WHERE prompt_id=?", [prompt_id])
    db.execute("DELETE FROM wordpack_items WHERE prompt_id=?", [prompt_id])
    db.execute("DELETE FROM usage_history WHERE prompt_id=?", [prompt_id])
    db.execute("DELETE FROM prompt_thumbnails WHERE prompt_id=?", [prompt_id])
    db.execute("DELETE FROM prompt_videos WHERE prompt_id=?", [prompt_id])
    db.execute("DELETE FROM prompts WHERE id=?", [prompt_id])
    db.commit()
    return {"ok": True}


@router.post("/prompts/{prompt_id}/usage")
def increment_usage(prompt_id: int):
    """增加提示词使用次数 + 记录使用历史"""
    db = get_db()
    db.execute("UPDATE prompts SET usage_count = usage_count + 1 WHERE id=?", [prompt_id])
    db.execute("INSERT INTO usage_history (prompt_id) VALUES (?)", [prompt_id])
    db.commit()
    return {"ok": True}


@router.get("/stats/top")
def get_top_prompts(limit: int = Query(10, ge=1, le=100)):
    """获取高频使用 TOP 提示词"""
    db = get_db()
    rows = db.execute("""
        SELECT p.id, p.module, p.category, p.content, p.usage_count
        FROM prompts p
        ORDER BY p.usage_count DESC, p.id ASC
        LIMIT ?
    """, [limit]).fetchall()
    return {"items": [dict(r) for r in rows]}


def _module_name(module_id: str) -> str:
    """模块 ID 转中文名"""
    names = {
        "emotion": "人物表情",
        "color": "场景色彩",
        "tone": "画面色调",
        "composition": "构图运镜",
        "seedance": "Seedance视频",
    }
    return names.get(module_id, module_id)
