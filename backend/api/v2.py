"""
API 路由 — Phase 2：收藏夹、词包、使用历史、导出、智能推荐、主题设置
"""
import json
import io
from fastapi import APIRouter, Query, HTTPException, Response
from pydantic import BaseModel
from database import get_db

router = APIRouter(prefix="/api/v2", tags=["v2"])


# ==================== 1. 收藏夹 ====================

@router.get("/collections")
def list_collections():
    """所有收藏分组（含词条数）"""
    db = get_db()
    rows = db.execute("""
        SELECT c.*,
               (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) as item_count
        FROM collections c
        ORDER BY c.sort_order ASC, c.id DESC
    """).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("/collections")
def create_collection(data: dict):
    """创建收藏分组"""
    db = get_db()
    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(400, "分组名称不能为空")
    icon = data.get("icon", "⭐")
    # 获取最大排序值
    max_sort = db.execute("SELECT COALESCE(MAX(sort_order), -1) FROM collections").fetchone()[0]
    db.execute("INSERT INTO collections (name, icon, sort_order) VALUES (?, ?, ?)",
               [name, icon, max_sort + 1])
    db.commit()
    return {"ok": True, "id": db.execute("SELECT last_insert_rowid()").fetchone()[0]}


@router.put("/collections/{cid}")
def update_collection(cid: int, data: dict):
    """更新收藏分组"""
    db = get_db()
    fields = []
    params = []
    if "name" in data:
        fields.append("name=?")
        params.append(data["name"])
    if "icon" in data:
        fields.append("icon=?")
        params.append(data["icon"])
    if not fields:
        raise HTTPException(400, "无更新字段")
    params.append(cid)
    db.execute(f"UPDATE collections SET {', '.join(fields)} WHERE id=?", params)
    db.commit()
    return {"ok": True}


@router.delete("/collections/{cid}")
def delete_collection(cid: int):
    """删除收藏分组（级联删除关联）"""
    db = get_db()
    db.execute("DELETE FROM collection_items WHERE collection_id=?", [cid])
    db.execute("DELETE FROM collections WHERE id=?", [cid])
    db.commit()
    return {"ok": True}


@router.get("/collections/{cid}/items")
def list_collection_items(cid: int, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)):
    """查询收藏分组内的词条"""
    db = get_db()
    total = db.execute(
        "SELECT COUNT(*) as cnt FROM collection_items WHERE collection_id=?", [cid]
    ).fetchone()["cnt"]

    offset = (page - 1) * page_size
    rows = db.execute("""
        SELECT p.id, p.module, p.category, p.subcategory, p.content,
               p.meaning, p.scene, p.tags, p.usage_count,
               ci.note, ci.added_at as collected_at
        FROM collection_items ci
        JOIN prompts p ON p.id = ci.prompt_id
        WHERE ci.collection_id = ?
        ORDER BY ci.added_at DESC
        LIMIT ? OFFSET ?
    """, [cid, page_size, offset]).fetchall()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "items": [dict(r) for r in rows]
    }


@router.post("/collections/{cid}/items")
def add_to_collection(cid: int, data: dict):
    """添加词条到收藏"""
    db = get_db()
    prompt_id = data.get("prompt_id")
    if not prompt_id:
        raise HTTPException(400, "缺少 prompt_id")
    try:
        db.execute("INSERT INTO collection_items (collection_id, prompt_id) VALUES (?, ?)",
                   [cid, prompt_id])
        db.commit()
        return {"ok": True}
    except Exception:
        raise HTTPException(409, "该词条已在收藏中")


@router.delete("/collections/{cid}/items/{prompt_id}")
def remove_from_collection(cid: int, prompt_id: int):
    """从收藏中移除词条"""
    db = get_db()
    db.execute("DELETE FROM collection_items WHERE collection_id=? AND prompt_id=?",
               [cid, prompt_id])
    db.commit()
    return {"ok": True}


@router.get("/collections/prompt-batch")
def get_prompt_collections(ids: str = Query("...")):
    """
    批量查询多个提示词所属的收藏分组
    ids: 逗号分隔的 prompt_id 列表，如 "1,2,3"
    返回: { prompt_id: [{id, name, icon}, ...], ... }
    """
    db = get_db()
    try:
        id_list = [int(x.strip()) for x in ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(400, "ids 参数格式错误，应为逗号分隔的数字")
    if not id_list:
        return {}

    placeholders = ",".join("?" * len(id_list))
    rows = db.execute(f"""
        SELECT ci.prompt_id, c.id, c.name, c.icon
        FROM collection_items ci
        JOIN collections c ON c.id = ci.collection_id
        WHERE ci.prompt_id IN ({placeholders})
        ORDER BY ci.prompt_id, c.sort_order
    """, id_list).fetchall()

    result = {}
    for r in rows:
        pid = r["prompt_id"]
        if pid not in result:
            result[pid] = []
        result[pid].append({
            "id": r["id"],
            "name": r["name"],
            "icon": r["icon"] or "⭐"
        })
    return result


# ==================== 2. 自定义词包 ====================

@router.get("/wordpacks")
def list_wordpacks():
    """所有词包列表（含词条数）"""
    db = get_db()
    rows = db.execute("""
        SELECT w.*,
               (SELECT COUNT(*) FROM wordpack_items wi WHERE wi.wordpack_id = w.id) as item_count
        FROM wordpacks w
        ORDER BY w.sort_order ASC, w.id DESC
    """).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("/wordpacks")
def create_wordpack(data: dict):
    """创建词包"""
    db = get_db()
    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(400, "词包名称不能为空")
    desc = data.get("description", "")
    max_sort = db.execute("SELECT COALESCE(MAX(sort_order), -1) FROM wordpacks").fetchone()[0]
    db.execute("INSERT INTO wordpacks (name, description, sort_order) VALUES (?, ?, ?)",
               [name, desc, max_sort + 1])
    db.commit()
    return {"ok": True, "id": db.execute("SELECT last_insert_rowid()").fetchone()[0]}


@router.put("/wordpacks/{wid}")
def update_wordpack(wid: int, data: dict):
    """更新词包"""
    db = get_db()
    fields = []
    params = []
    if "name" in data:
        fields.append("name=?")
        params.append(data["name"])
    if "description" in data:
        fields.append("description=?")
        params.append(data["description"])
    if not fields:
        raise HTTPException(400, "无更新字段")
    params.append(wid)
    db.execute(f"UPDATE wordpacks SET {', '.join(fields)} WHERE id=?", params)
    db.commit()
    return {"ok": True}


@router.delete("/wordpacks/{wid}")
def delete_wordpack(wid: int):
    """删除词包"""
    db = get_db()
    db.execute("DELETE FROM wordpack_items WHERE wordpack_id=?", [wid])
    db.execute("DELETE FROM wordpacks WHERE id=?", [wid])
    db.commit()
    return {"ok": True}


@router.get("/wordpacks/{wid}/items")
def list_wordpack_items(wid: int):
    """查询词包内词条"""
    db = get_db()
    rows = db.execute("""
        SELECT p.id, p.module, p.category, p.subcategory, p.content,
               p.meaning, p.scene, p.tags, p.usage_count,
               wi.sort_order, wi.added_at
        FROM wordpack_items wi
        JOIN prompts p ON p.id = wi.prompt_id
        WHERE wi.wordpack_id = ?
        ORDER BY wi.sort_order ASC, wi.added_at DESC
    """, [wid]).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("/wordpacks/{wid}/items")
def add_to_wordpack(wid: int, data: dict):
    """添加词条到词包（支持批量）"""
    db = get_db()
    prompt_ids = data.get("prompt_ids", [])
    if isinstance(prompt_ids, int):
        prompt_ids = [prompt_ids]
    if not prompt_ids:
        raise HTTPException(400, "缺少 prompt_ids")
    added = 0
    for pid in prompt_ids:
        try:
            max_sort = db.execute(
                "SELECT COALESCE(MAX(sort_order), -1) FROM wordpack_items WHERE wordpack_id=?",
                [wid]
            ).fetchone()[0]
            db.execute(
                "INSERT INTO wordpack_items (wordpack_id, prompt_id, sort_order) VALUES (?, ?, ?)",
                [wid, pid, max_sort + 1]
            )
            added += 1
        except Exception:
            pass  # 跳过已存在的
    db.commit()
    return {"ok": True, "added": added}


@router.delete("/wordpacks/{wid}/items/{prompt_id}")
def remove_from_wordpack(wid: int, prompt_id: int):
    """从词包中移除词条"""
    db = get_db()
    db.execute("DELETE FROM wordpack_items WHERE wordpack_id=? AND prompt_id=?",
               [wid, prompt_id])
    db.commit()
    return {"ok": True}


@router.post("/wordpacks/{wid}/reorder")
def reorder_wordpack(wid: int, data: dict):
    """重排词包内词条顺序"""
    db = get_db()
    order = data.get("order", [])  # [prompt_id, ...] 按期望顺序排列
    for idx, pid in enumerate(order):
        db.execute("UPDATE wordpack_items SET sort_order=? WHERE wordpack_id=? AND prompt_id=?",
                   [idx, wid, pid])
    db.commit()
    return {"ok": True}


@router.get("/wordpacks/{wid}/export")
def export_wordpack(wid: int, fmt: str = Query("txt", regex="^(txt|json)$")):
    """导出词包为 TXT 或 JSON 文件"""
    db = get_db()
    wp = db.execute("SELECT * FROM wordpacks WHERE id=?", [wid]).fetchone()
    if not wp:
        raise HTTPException(404, "词包不存在")

    items = db.execute("""
        SELECT p.content, p.meaning, p.module, p.category
        FROM wordpack_items wi
        JOIN prompts p ON p.id = wi.prompt_id
        WHERE wi.wordpack_id = ?
        ORDER BY wi.sort_order ASC
    """, [wid]).fetchall()

    if fmt == "json":
        data = {
            "name": wp["name"],
            "description": wp["description"],
            "exported_at": __import__("datetime").datetime.now().isoformat(),
            "count": len(items),
            "prompts": [
                {
                    "content": r["content"],
                    "meaning": r["meaning"],
                    "module": r["module"],
                    "category": r["category"]
                }
                for r in items
            ]
        }
        content = json.dumps(data, ensure_ascii=False, indent=2)
        return Response(
            content=content,
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="{wp["name"]}.json"'
            }
        )
    else:
        lines = [f"# 词包: {wp['name']}", f"# 描述: {wp['description']}",
                 f"# 导出时间: {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M')}",
                 f"# 共 {len(items)} 条", "", "---", ""]
        for i, r in enumerate(items, 1):
            lines.append(f"[{i}] {r['content']}")
            if r["meaning"]:
                lines.append(f"    释义: {r['meaning']}")
            lines.append("")
        content = "\n".join(lines)
        return Response(
            content=content,
            media_type="text/plain; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="{wp["name"]}.txt"'
            }
        )


# ==================== 3. 使用历史 ====================

@router.get("/history")
def list_history(limit: int = Query(30, ge=1, le=200)):
    """最近使用的提示词"""
    db = get_db()
    rows = db.execute("""
        SELECT p.id, p.module, p.category, p.subcategory, p.content,
               p.meaning, p.scene, p.tags, p.usage_count,
               uh.used_at
        FROM usage_history uh
        JOIN prompts p ON p.id = uh.prompt_id
        GROUP BY uh.prompt_id
        ORDER BY MAX(uh.used_at) DESC
        LIMIT ?
    """, [limit]).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.delete("/history")
def clear_history():
    """清空使用历史"""
    db = get_db()
    db.execute("DELETE FROM usage_history")
    db.commit()
    return {"ok": True}


@router.delete("/history/{prompt_id}")
def delete_history_item(prompt_id: int):
    """删除单条历史记录"""
    db = get_db()
    db.execute("DELETE FROM usage_history WHERE prompt_id=?", [prompt_id])
    db.commit()
    return {"ok": True}


# ==================== 4. 批量操作 ====================

@router.post("/batch/copy")
def batch_copy(data: dict):
    """批量复制：将多个词条内容合并为文本"""
    prompt_ids = data.get("prompt_ids", [])
    if not prompt_ids:
        raise HTTPException(400, "缺少 prompt_ids")
    placeholders = ",".join("?" * len(prompt_ids))
    db = get_db()
    rows = db.execute(
        f"SELECT id, content, meaning FROM prompts WHERE id IN ({placeholders})",
        prompt_ids
    ).fetchall()

    lines = []
    for r in rows:
        lines.append(f"[{r['id']}] {r['content']}")
        if r["meaning"]:
            lines.append(f"    {r['meaning']}")
        lines.append("")

    text = "\n".join(lines).strip()
    return {
        "ok": True,
        "count": len(rows),
        "text": text
    }


@router.post("/batch/export")
def batch_export(data: dict):
    """批量导出为文件"""
    prompt_ids = data.get("prompt_ids", [])
    fmt = data.get("format", "txt")
    if not prompt_ids:
        raise HTTPException(400, "缺少 prompt_ids")

    placeholders = ",".join("?" * len(prompt_ids))
    db = get_db()
    rows = db.execute(
        f"SELECT id, content, meaning, module, category FROM prompts WHERE id IN ({placeholders})",
        prompt_ids
    ).fetchall()

    if fmt == "json":
        export_data = {
            "exported_at": __import__("datetime").datetime.now().isoformat(),
            "count": len(rows),
            "prompts": [dict(r) for r in rows]
        }
        content = json.dumps(export_data, ensure_ascii=False, indent=2)
        return Response(content=content, media_type="application/json",
                        headers={"Content-Disposition": 'attachment; filename="prompts_export.json"'})
    else:
        lines = [f"# 批量导出 - {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M')}",
                 f"# 共 {len(rows)} 条", "", "---", ""]
        for i, r in enumerate(rows, 1):
            lines.append(f"[{i}] [{r['module']}/{r['category']}] {r['content']}")
            if r["meaning"]:
                lines.append(f"    释义: {r['meaning']}")
            lines.append("")
        content = "\n".join(lines)
        return Response(content=content, media_type="text/plain; charset=utf-8",
                        headers={"Content-Disposition": 'attachment; filename="prompts_export.txt"'})


# ==================== 5. 智能推荐 ====================

@router.get("/recommend/{prompt_id}")
def recommend_prompts(prompt_id: int, limit: int = Query(6, ge=1, le=20)):
    """基于标签匹配的智能推荐"""
    db = get_db()
    # 获取当前词条的标签
    row = db.execute("SELECT module, category, tags, content FROM prompts WHERE id=?",
                     [prompt_id]).fetchone()
    if not row:
        raise HTTPException(404, "提示词不存在")

    try:
        tags = json.loads(row["tags"])
    except Exception:
        tags = []

    if not tags:
        # 无标签时：同模块同类最近似的词条
        rows = db.execute("""
            SELECT id, module, category, content, meaning, tags, usage_count
            FROM prompts
            WHERE id != ? AND module = ? AND category = ?
            ORDER BY usage_count DESC
            LIMIT ?
        """, [prompt_id, row["module"], row["category"], limit]).fetchall()
        return {"items": [dict(r) for r in rows], "reason": "same_category"}

    # 标签匹配：遍历所有其他词条，匹配标签交集数量
    all_rows = db.execute("""
        SELECT id, module, category, content, meaning, tags, usage_count
        FROM prompts WHERE id != ?
    """, [prompt_id]).fetchall()

    scored = []
    for r in all_rows:
        try:
            other_tags = set(json.loads(r["tags"]))
        except Exception:
            other_tags = set()
        # 标签交集数 * 2 + 同module加分 + usage_count加权
        match_count = len(set(tags) & other_tags)
        score = match_count * 10
        if r["module"] == row["module"]:
            score += 5
        score += r["usage_count"]
        if score > 0:
            scored.append((score, r))

    scored.sort(key=lambda x: -x[0])
    items = [dict(r) for _, r in scored[:limit]]
    return {"items": items, "reason": "tag_match"}


# ==================== 6. 主题设置 ====================

@router.get("/config/theme")
def get_theme():
    """获取当前主题设置"""
    db = get_db()
    row = db.execute("SELECT value FROM config WHERE key='theme'").fetchone()
    theme = row["value"] if row else "light"
    return {"theme": theme}


@router.post("/config/theme")
def set_theme(data: dict):
    """切换主题"""
    theme = data.get("theme", "light")
    if theme not in ("light", "dark"):
        raise HTTPException(400, "主题只能为 light 或 dark")
    db = get_db()
    db.execute("INSERT OR REPLACE INTO config (key, value) VALUES ('theme', ?)", [theme])
    db.commit()
    return {"ok": True, "theme": theme}
