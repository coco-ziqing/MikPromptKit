"""
API 路由 — Phase 2：收藏夹、词包、使用历史、导出、智能推荐、主题设置
"""
import json
import io
import os
import uuid
import zipfile
import datetime
import sqlite3
from fastapi import APIRouter, Query, HTTPException, Response, UploadFile, File, Form
from pydantic import BaseModel
from database import get_db, safe_commit
import traceback

router = APIRouter(prefix="/api/v2", tags=["v2"])

# P0-2 安全加固：表名白名单（防御深度——原代码中表名源自硬编码列表，但加一道防线）
_VALID_DELETE_TABLES = frozenset([
    "collection_items", "wordpack_items", "usage_history",
    "prompt_thumbnails", "prompt_videos", "atom_word_bridge",
    "scene_card_ref", "word_card_versions",
])

def _safe_delete_table(tbl: str) -> str:
    """白名单校验 DELETE 表名，拒绝非预期输入"""
    if tbl not in _VALID_DELETE_TABLES:
        raise HTTPException(400, f"非法的操作表: {tbl}")
    return tbl


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
    items = [dict(r) for r in rows]
    # 每个分组从数据库取缩略图字段，无则取最新收藏的词条缩略图
    for item in items:
        if item.get("thumbnail"):
            pass
        else:
            # Phase17: 先查 prompts 缩略图，再查 word_card 缩略图
            thumb = db.execute("""
                SELECT pt.filename FROM collection_items ci
                LEFT JOIN prompt_thumbnails pt ON pt.prompt_id = ci.prompt_id
                WHERE ci.collection_id = ? AND pt.filename IS NOT NULL
                ORDER BY ci.id DESC LIMIT 1
            """, [item["id"]]).fetchone()
            if thumb and thumb["filename"]:
                item["thumbnail"] = thumb["filename"]
            else:
                wc_thumb = db.execute("""
                    SELECT wc.thumbnail FROM collection_items ci
                    JOIN word_card wc ON wc.id = ci.prompt_id AND wc.is_deleted=0
                    WHERE ci.collection_id = ? AND wc.thumbnail IS NOT NULL AND wc.thumbnail != ''
                    ORDER BY ci.id DESC LIMIT 1
                """, [item["id"]]).fetchone()
                if wc_thumb:
                    item["thumbnail"] = wc_thumb["thumbnail"]
        # 补充 video_filename
        if not item.get("video_filename"):
            vrow = db.execute("""
                SELECT pv.filename FROM collection_items ci
                LEFT JOIN prompt_videos pv ON pv.prompt_id = ci.prompt_id
                WHERE ci.collection_id = ? AND pv.filename IS NOT NULL
                ORDER BY ci.id DESC LIMIT 1
            """, [item["id"]]).fetchone()
            if vrow:
                item["video_filename"] = vrow["filename"]
    return {"items": items}


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
    if "thumbnail" in data:
        fields.append("thumbnail=?")
        params.append(data["thumbnail"])
    if "video_filename" in data:
        fields.append("video_filename=?")
        params.append(data["video_filename"])
    if not fields:
        raise HTTPException(400, "无更新字段")
    params.append(cid)
    db.execute(f"UPDATE collections SET {', '.join(fields)} WHERE id=?", params)
    db.commit()
    return {"ok": True}


@router.post("/collections/{cid}/copy")
def copy_collection(cid: int):
    """复制收藏分组（含所有词条）"""
    db = get_db()
    src = db.execute("SELECT * FROM collections WHERE id=?", [cid]).fetchone()
    if not src:
        raise HTTPException(404, "分组不存在")
    new_name = src["name"] + " (副本)"
    max_sort = db.execute("SELECT COALESCE(MAX(sort_order), -1) FROM collections").fetchone()[0]
    # 检查同名
    i = 1
    base = new_name
    while db.execute("SELECT COUNT(*) as c FROM collections WHERE name=?", [new_name]).fetchone()["c"] > 0:
        i += 1
        new_name = base + str(i)
    db.execute("INSERT INTO collections (name, icon, sort_order, thumbnail) VALUES (?, ?, ?, ?)",
               [new_name, src["icon"], max_sort + 1, src["thumbnail"] or ""])
    new_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    # 复制词条
    items = db.execute("SELECT prompt_id FROM collection_items WHERE collection_id=?", [cid]).fetchall()
    for item in items:
        db.execute("INSERT OR IGNORE INTO collection_items (collection_id, prompt_id) VALUES (?, ?)",
                   [new_id, item["prompt_id"]])
    db.commit()
    return {"ok": True, "id": new_id, "name": new_name}


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
    """查询收藏分组内的词条 — 优先 word_card，旧 prompts 为 fallback"""
    db = get_db()
    total = db.execute(
        "SELECT COUNT(*) as cnt FROM collection_items WHERE collection_id=?", [cid]
    ).fetchone()["cnt"]

    offset = (page - 1) * page_size
    # Phase17 修复：word_card 优先 + COALESCE 防重复，旧 prompts 表数据为 fallback
    all_rows = db.execute("""
        SELECT
            ci.prompt_id as id,
            COALESCE(wc.module, p.module, '') as module,
            COALESCE(wc.category, p.category, '') as category,
            CASE WHEN wc.id IS NOT NULL THEN '' WHEN p.subcategory IS NOT NULL THEN p.subcategory ELSE '' END as subcategory,
            COALESCE(wc.content, p.content, '') as content,
            COALESCE(wc.content_en, '') as content_en,
            COALESCE(wc.content_zh, '') as content_zh,
            COALESCE(wc.meaning, p.meaning, '') as meaning,
            COALESCE(wc.scene, p.scene, '') as scene,
            COALESCE(wc.tags, p.tags, '[]') as tags,
            COALESCE(wc.usage_count, p.usage_count, 0) as usage_count,
            COALESCE(wc.thumbnail, pt.filename, '') as thumbnail,
            COALESCE(wc.thumbnail, pv.poster, '') as original_ref,
            wc.preview_media as video_filename,
            COALESCE(wc.icon, '') as icon,
            COALESCE(wc.name, SUBSTR(wc.content, 1, 60), '') as name,
            COALESCE(wc.media_type, 'image') as media_type,
            '' as video_poster,
            '' as video_fps,
            '' as video_duration,
            ci.note, ci.added_at as collected_at
        FROM collection_items ci
        LEFT JOIN word_card wc ON wc.id = ci.prompt_id AND wc.is_deleted=0
        LEFT JOIN prompts p ON p.id = ci.prompt_id AND p.deleted_at IS NULL AND wc.id IS NULL
        LEFT JOIN prompt_thumbnails pt ON pt.prompt_id = ci.prompt_id
        LEFT JOIN prompt_videos pv ON pv.prompt_id = ci.prompt_id
        WHERE ci.collection_id = ?
        ORDER BY ci.added_at DESC
        LIMIT ? OFFSET ?
    """, [cid, page_size, offset]).fetchall()

    items = [dict(r) for r in all_rows]

    # 为每条词条补充收藏归属信息
    prompt_ids = [r["id"] for r in all_rows]
    if prompt_ids:
        placeholders = ",".join(["?"] * len(prompt_ids))
        coll_map = db.execute(f"""
            SELECT ci.prompt_id, c.id, c.name, c.icon
            FROM collection_items ci
            JOIN collections c ON c.id = ci.collection_id
            WHERE ci.prompt_id IN ({placeholders})
            ORDER BY ci.prompt_id
        """, prompt_ids).fetchall()
        by_prompt = {}
        for row in coll_map:
            by_prompt.setdefault(row["prompt_id"], []).append({
                "id": row["id"],
                "name": row["name"],
                "icon": row["icon"] or "⭐"
            })
        for item in items:
            item["collections"] = by_prompt.get(item["id"], [])
    else:
        for item in items:
            item["collections"] = []

    # SQL 已处理分页，直接返回
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "items": items
    }


@router.post("/collections/{cid}/items")
def add_to_collection(cid: int, data: dict):
    """添加词条到收藏（兼容 prompts + word_card 双数据源）"""
    db = get_db()
    prompt_id = data.get("prompt_id")
    if not prompt_id:
        raise HTTPException(400, "缺少 prompt_id")
    # Phase17: 先 check 再 insert + 重试防 WAL 锁
    existing = db.execute(
        "SELECT 1 FROM collection_items WHERE collection_id=? AND prompt_id=?",
        [cid, prompt_id]
    ).fetchone()
    if existing:
        raise HTTPException(409, "该词条已在收藏中")
    import time as _time
    for attempt in range(5):
        try:
            db.execute("INSERT INTO collection_items (collection_id, prompt_id) VALUES (?, ?)",
                       [cid, prompt_id])
            ok = safe_commit()
            if not ok:
                raise Exception("提交失败")
            return {"ok": True}
        except Exception as e:
            err = str(e).lower()
            # UNIQUE 约束冲突 → 已收藏
            if 'unique' in err or 'integrity' in err:
                raise HTTPException(409, "该词条已在收藏中")
            # 数据库锁 → 重试
            if 'locked' in err or 'busy' in err:
                if attempt < 4:
                    _time.sleep(0.2 * (attempt + 1))
                    continue
            raise HTTPException(500, f"添加收藏失败: {str(e)}")


@router.post("/collections/{cid}/reorder")
def reorder_collection(cid: int, data: dict):
    """重排收藏夹内词条顺序"""
    db = get_db()
    order = data.get("order", [])
    for idx, pid in enumerate(order):
        db.execute("UPDATE collection_items SET sort_order=? WHERE collection_id=? AND prompt_id=?",
                   [idx, cid, pid])
    db.commit()
    return {"ok": True}


@router.delete("/collections/{cid}/items/{prompt_id}")
def remove_from_collection(cid: int, prompt_id: int):
    """从收藏中移除词条"""
    db = get_db()
    db.execute("DELETE FROM collection_items WHERE collection_id=? AND prompt_id=?",
               [cid, prompt_id])
    db.commit()
    return {"ok": True}


@router.post("/collections/{cid}/items/batch-remove")
def batch_remove_from_collection(cid: int, data: dict):
    """批量从收藏中移除词条"""
    prompt_ids = data.get("prompt_ids", [])
    if not prompt_ids:
        raise HTTPException(400, "请提供 prompt_ids")
    db = get_db()
    removed = 0
    for pid in prompt_ids:
        db.execute("DELETE FROM collection_items WHERE collection_id=? AND prompt_id=?",
                   [cid, pid])
        removed += 1
    db.commit()
    return {"ok": True, "removed": removed}


@router.post("/collections/{cid}/items/batch-add")
def batch_add_to_collection(cid: int, data: dict):
    """批量添加词条到收藏（已存在跳过）"""
    prompt_ids = data.get("prompt_ids", [])
    if not prompt_ids:
        raise HTTPException(400, "请提供 prompt_ids")
    db = get_db()
    added = 0
    import time as _time
    for pid in prompt_ids:
        for attempt in range(5):
            try:
                cur = db.execute("INSERT OR IGNORE INTO collection_items (collection_id, prompt_id) VALUES (?, ?)", [cid, pid])
                added += cur.rowcount
                break
            except Exception:
                _time.sleep(0.05)
    db.commit()
    return {"ok": True, "added": added}


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
        JOIN prompts p ON p.id = uh.prompt_id AND p.deleted_at IS NULL
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


def _find_media_file(fname: str, dirs) -> str:
    """多目录探测媒体文件，返回存在路径或空串"""
    if not fname:
        return ""
    for d in dirs:
        fp = os.path.join(d, fname)
        if os.path.isfile(fp):
            return fp
    return ""


def _fetch_export_rows(db, prompt_ids):
    """双表查询导出数据：word_card(词库) 优先 + prompts(旧表) 兜底

    2026-08-03 修复: batch/export 与 pt/export 原只查 prompts 旧表，
    #batchBar 选择的词库(word_card 1433 张)导出为空 → 「无法导出词库的信息」。
    统一输出字段: id/module/category/subcategory/content/meaning/scene/tags/
    name/thumbnail/preview_media/group_id/source_table
    """
    if not prompt_ids:
        return []
    placeholders = ",".join("?" * len(prompt_ids))
    rows = []
    # 1) word_card 词库（主表）
    wc_rows = db.execute(
        f"SELECT id, module, category, '' AS subcategory, content, meaning, scene, tags, name, "
        f"thumbnail, preview_media, group_id FROM word_card "
        f"WHERE id IN ({placeholders}) AND is_deleted=0", prompt_ids).fetchall()
    found = set()
    for r in wc_rows:
        d = dict(r)
        d["source_table"] = "word_card"
        rows.append(d)
        found.add(d["id"])
    # 2) prompts 旧表补漏（word_card 查不到的 id）
    missing = [pid for pid in prompt_ids if pid not in found]
    if missing:
        mp = ",".join("?" * len(missing))
        pr_rows = db.execute(
            f"SELECT p.id, p.module, p.category, p.subcategory, p.content, p.meaning, p.scene, p.tags, "
            f"'' AS name, pt.filename AS thumbnail, pv.filename AS preview_media, NULL AS group_id "
            f"FROM prompts p "
            f"LEFT JOIN prompt_thumbnails pt ON pt.prompt_id=p.id "
            f"LEFT JOIN prompt_videos pv ON pv.prompt_id=p.id "
            f"WHERE p.id IN ({mp}) AND p.deleted_at IS NULL", missing).fetchall()
        for r in pr_rows:
            d = dict(r)
            d["source_table"] = "prompts"
            rows.append(d)
    return rows


@router.post("/batch/export")
def batch_export(data: dict):
    """批量导出为文件（txt/md/json）

    2026-08-03: 支持 name 参数自定义文件名（#batchBar 导出统一走命名弹窗）
    """
    prompt_ids = data.get("prompt_ids", [])
    fmt = data.get("format", "txt")
    if not prompt_ids:
        raise HTTPException(400, "缺少 prompt_ids")

    # 自定义文件名（安全过滤非法字符，缺省用 prompts_export）
    import re as _re
    from urllib.parse import quote as _quote
    raw_name = (data.get("name") or "").strip()
    safe_name = _re.sub(r'[\\/:*?"<>|\r\n]', '', raw_name).strip()[:80]
    if not safe_name:
        safe_name = "prompts_export"

    def _dl_header(filename: str):
        """Content-Disposition：ASCII 回退 + RFC5987 UTF-8 编码（中文文件名 header 必需）"""
        ascii_name = _re.sub(r'[^\x20-\x7e]', '_', filename)
        return f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{_quote(filename)}'

    placeholders = ",".join("?" * len(prompt_ids))
    db = get_db()
    # 2026-08-03 修复: 双表查询 — word_card(词库) + prompts(旧表)，词库导出不再为空
    rows = _fetch_export_rows(db, prompt_ids)
    if not rows:
        raise HTTPException(404, "未找到可导出的词条")

    if fmt == "json":
        export_data = {
            "exported_at": __import__("datetime").datetime.now().isoformat(),
            "count": len(rows),
            "prompts": [dict(r) for r in rows]
        }
        content = json.dumps(export_data, ensure_ascii=False, indent=2)
        filename = safe_name + ".json"
        return Response(content=content, media_type="application/json",
                        headers={"Content-Disposition": _dl_header(filename)})
    elif fmt == "md":
        lines = [f"# 提示词批量导出\n",
                 f"导出时间: {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M')}  |  共 {len(rows)} 条\n",
                 "---\n"]
        for i, r in enumerate(rows, 1):
            title = r.get('name') or r['content'] or '未命名'
            lines.append(f"### {i}. {title}\n")
            lines.append(f"- **模块**: {r['module']}  |  **分类**: {r['category']}")
            if r["meaning"]:
                lines.append(f"- **释义**: {r['meaning']}")
            lines.append("")
        content = "\n".join(lines)
        filename = safe_name + ".md"
        return Response(content=content, media_type="text/markdown; charset=utf-8",
                        headers={"Content-Disposition": _dl_header(filename)})
    else:
        lines = [f"# 批量导出 - {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M')}",
                 f"# 共 {len(rows)} 条", "", "---", ""]
        for i, r in enumerate(rows, 1):
            title = r.get('name') or r['content'] or '未命名'
            lines.append(f"[{i}] [{r['module']}/{r['category']}] {title}")
            if r["meaning"]:
                lines.append(f"    释义: {r['meaning']}")
            lines.append("")
        content = "\n".join(lines)
        filename = safe_name + ".txt"
        return Response(content=content, media_type="text/plain; charset=utf-8",
                        headers={"Content-Disposition": _dl_header(filename)})


# ==================== .pt 包导出/导入 ====================

@router.post("/pt/export")
def export_pt_package(data: dict):
    """导出 .pt 包：提示词 + 缩略图 + 视频，封装为 ZIP 压缩包"""
    prompt_ids = data.get("prompt_ids", [])
    if not prompt_ids:
        raise HTTPException(400, "缺少 prompt_ids")

    db = get_db()
    # 2026-08-03 修复: 双表查询 — 词库(word_card) + 旧表(prompts)，.pt 包导出词卡不再为空
    rows = _fetch_export_rows(db, prompt_ids)

    if not rows:
        raise HTTPException(404, "未找到可导出的词条")

    # 获取媒体文件路径（多目录探测：word_card 用 wc_media/，prompts 用根 data/）
    DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data")
    THUMB_DIRS = [
        os.path.join(DATA_DIR, "wc_media", "thumbs"),
        os.path.join(DATA_DIR, "thumbnails"),
    ]
    VIDEO_DIRS = [
        os.path.join(DATA_DIR, "wc_media", "videos"),
        os.path.join(DATA_DIR, "videos"),
    ]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        metadata = []
        for r in rows:
            rdict = dict(r)
            pid = rdict["id"]

            entry = {
                "module": rdict["module"],
                "category": rdict["category"],
                "subcategory": rdict.get("subcategory") or "",
                "content": rdict["content"],
                "meaning": rdict.get("meaning") or "",
                "scene": rdict.get("scene") or "",
                "tags": json.loads(rdict["tags"]) if rdict.get("tags") else [],
            }

            # 缩略图: word_card 用 thumbnail 字段，prompts 已 JOIN prompt_thumbnails.filename
            thumb_fn = rdict.get("thumbnail") or ""
            thumb_path = _find_media_file(os.path.basename(thumb_fn), THUMB_DIRS)
            if thumb_path:
                arc_name = f"thumbnails/{pid}_{os.path.basename(thumb_fn)}"
                zf.write(thumb_path, arc_name)
                entry["thumbnail"] = arc_name

            # 视频: word_card 用 preview_media，prompts 已 JOIN prompt_videos.filename
            vfn = rdict.get("preview_media") or ""
            video_path = _find_media_file(os.path.basename(vfn), VIDEO_DIRS)
            if video_path:
                arc_name = f"videos/{pid}_{os.path.basename(vfn)}"
                zf.write(video_path, arc_name)
                entry["video"] = arc_name

            metadata.append(entry)

        zf.writestr("metadata.json", json.dumps(metadata, ensure_ascii=False, indent=2))

    buf.seek(0)
    now_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    fname_part = ""
    if rows:
        clean = (rows[0]["content"] or "").replace("\\", "").replace("/", "").replace(":", "").replace("*", "").replace("?", "").replace('"', "").replace("<", "").replace(">", "").replace("|", "")[:12]
        if clean:
            fname_part = clean + "_"
    from urllib.parse import quote
    ascii_name = f"promptkit_{now_str}.pt"
    utf8_name = f"{fname_part}提示词包_{now_str}.pt"
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8\'\'{quote(utf8_name)}"
        }
    )


@router.post("/pt/import")
async def import_pt_package(
    file: UploadFile = File(...),
    conflict: str = Form("skip"),
    overrides: str = Form("[]")
):
    """导入 .pt 包：解析元数据，写入数据库，还原缩略图/视频
    overrides: JSON 数组，按索引覆盖 metadata 中的 module/category/content
    """
    import json, io, zipfile, os, uuid, shutil

    if conflict not in ("skip", "overwrite", "rename"):
        conflict = "skip"

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(400, "文件为空")

    # 解析用户编辑覆盖
    override_list = []
    try:
        override_list = json.loads(overrides) if overrides and overrides != "[]" else []
    except Exception:
        override_list = []

    DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data")
    THUMB_DIR = os.path.join(DATA_DIR, "thumbnails")
    VIDEO_DIR = os.path.join(DATA_DIR, "videos")
    ORIGINAL_DIR = os.path.join(DATA_DIR, "originals")
    os.makedirs(THUMB_DIR, exist_ok=True)
    os.makedirs(VIDEO_DIR, exist_ok=True)
    os.makedirs(ORIGINAL_DIR, exist_ok=True)

    db = get_db()
    created = 0
    skipped = 0
    failed = 0

    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
            # 读取元数据
            if "metadata.json" not in zf.namelist():
                raise HTTPException(400, "无效的 .pt 包：缺少 metadata.json")

            metadata = json.loads(zf.read("metadata.json"))
            if not isinstance(metadata, list):
                raise HTTPException(400, "无效的 .pt 包：metadata 格式错误")

            for idx, entry in enumerate(metadata):
                # 应用用户编辑覆盖
                if idx < len(override_list) and override_list[idx]:
                    ov = override_list[idx]
                    if ov.get("content"):
                        entry["content"] = ov["content"]
                    if ov.get("module"):
                        entry["module"] = ov["module"]
                    if ov.get("category"):
                        entry["category"] = ov["category"]
                content = (entry.get("content") or "").strip()
                if not content:
                    failed += 1
                    continue

                existing = db.execute("SELECT id FROM prompts WHERE content=?", [content]).fetchone()
                if existing:
                    if conflict == "skip":
                        skipped += 1
                        continue
                    elif conflict == "rename":
                        content += " (导入副本 " + uuid.uuid4().hex[:4] + ")"
                    elif conflict == "overwrite":
                        for tbl in ["collection_items", "wordpack_items", "usage_history", "prompt_thumbnails", "prompt_videos"]:
                            db.execute(f"DELETE FROM {_safe_delete_table(tbl)} WHERE prompt_id=?", [existing["id"]])
                        db.execute("DELETE FROM prompts WHERE id=?", [existing["id"]])
                        # 同步清理 prompt_cards
                        db.execute("DELETE FROM prompt_cards WHERE name=? AND content=?", [entry.get("subcategory","") or entry.get("content","")[:30], existing["content"]])

                module = entry.get("module", "custom")
                category = entry.get("category", "通用")
                subcategory = entry.get("subcategory", "")
                meaning = entry.get("meaning", "")
                scene = entry.get("scene", "")
                tags = json.dumps(entry.get("tags", []), ensure_ascii=False)

                db.execute(
                    "INSERT INTO prompts (module, category, subcategory, content, meaning, scene, tags, is_builtin) VALUES (?,?,?,?,?,?,?,?)",
                    [module, category, subcategory, content, meaning, scene, tags, 0]
                )
                new_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
                # 同步写入 prompt_cards（v4 主表，id 与 prompts 同步）
                db.execute(
                    "INSERT INTO prompt_cards (id, card_type, name, content, meaning, scene, module, category, tags, structured_fields, is_builtin, is_deleted, created_at, updated_at) VALUES (?,'image',?,?,?,?,?,?,?,'{}',0,0,datetime('now','localtime'),datetime('now','localtime'))",
                    [new_id, subcategory or content[:30], content, meaning, scene, module, category, tags]
                )
                db.commit()

                # 还原缩略图（路径穿越防护）
                thumb_arc = entry.get("thumbnail")
                if thumb_arc and thumb_arc in zf.namelist():
                    try:
                        # 校验 arcname 不包含 .. 或绝对路径
                        if ".." in thumb_arc or os.path.isabs(thumb_arc):
                            continue
                        thumb_data = zf.read(thumb_arc)
                        ext = os.path.splitext(thumb_arc)[1] or ".jpg"
                        thumb_fn = f"{uuid.uuid4().hex}{ext}"
                        thumb_path = os.path.join(THUMB_DIR, thumb_fn)
                        with open(thumb_path, "wb") as f:
                            f.write(thumb_data)
                        media_type = entry.get("thumbnail_media_type", "image/jpeg")
                        db.execute(
                            "INSERT OR REPLACE INTO prompt_thumbnails (prompt_id, filename, media_type) VALUES (?,?,?)",
                            [new_id, thumb_fn, media_type]
                        )
                        db.commit()
                    except Exception:
                        pass

                # 还原视频
                video_arc = entry.get("video")
                if video_arc and video_arc in zf.namelist():
                    try:
                        video_data = zf.read(video_arc)
                        ext = os.path.splitext(video_arc)[1] or ".mp4"
                        vfn = f"{uuid.uuid4().hex}{ext}"
                        video_path = os.path.join(VIDEO_DIR, vfn)
                        with open(video_path, "wb") as f:
                            f.write(video_data)
                        db.execute(
                            "INSERT OR REPLACE INTO prompt_videos (prompt_id, filename, poster, duration, fps) VALUES (?,?,?,?,?)",
                            [new_id, vfn, entry.get("video_poster", ""), entry.get("video_duration", 0), entry.get("video_fps", 0)]
                        )
                        db.commit()
                    except Exception:
                        pass

                created += 1

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"导入失败: {e}")

    return {
        "ok": True,
        "created": created,
        "skipped": skipped,
        "failed": failed,
        "total": len(metadata) if 'metadata' in locals() else 0
    }


@router.post("/pt/preview")
async def preview_pt_package(file: UploadFile = File(...)):
    """预览 .pt 包内容（只读 metadata.json，不导入）"""
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(400, "文件为空")
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
            if "metadata.json" not in zf.namelist():
                raise HTTPException(400, "无效的 .pt 包")
            metadata = json.loads(zf.read("metadata.json"))
            if not isinstance(metadata, list):
                raise HTTPException(400, "格式错误")
            # 返回预览用的精简信息
            preview = []
            for entry in metadata:
                preview.append({
                    "content": (entry.get("content") or ""),
                    "module": entry.get("module", "custom"),
                    "category": entry.get("category", "通用"),
                    "has_thumbnail": bool(entry.get("thumbnail")),
                    "has_video": bool(entry.get("video")),
                })
            return {"ok": True, "items": preview, "count": len(metadata)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"解析失败: {e}")


@router.post("/import/from-json-data")
def import_json_data(data: dict):
    """从 JSON 数据批量导入 — Phase17.6: 写入 word_card + 支持 group_id"""
    items = data.get("items", [])
    conflict = data.get("conflict", "skip")
    if not items:
        raise HTTPException(400, "缺少 items")
    if conflict not in ("skip", "overwrite", "rename"):
        conflict = "skip"

    db = get_db()
    created = 0
    skipped = 0
    failed = 0
    for item in items:
        content = item.get("content", "")
        if not content:
            failed += 1
            continue
        # 去重检测（word_card 优先）
        existing = db.execute("SELECT id FROM word_card WHERE content=? AND is_deleted=0", [content]).fetchone()
        if not existing:
            existing = db.execute("SELECT id FROM prompts WHERE content=? AND deleted_at IS NULL", [content]).fetchone()
        if existing:
            if conflict == "skip":
                skipped += 1
                continue
            elif conflict == "rename":
                content += " (导入副本 " + uuid.uuid4().hex[:4] + ")"
            elif conflict == "overwrite":
                db.execute("DELETE FROM word_card WHERE id=?", [existing["id"]])
                db.execute("DELETE FROM prompts WHERE id=?", [existing["id"]])
                db.execute("DELETE FROM prompt_cards WHERE id=?", [existing["id"]])

        group_id = item.get("group_id") or item.get("module")  # group_id 优先，module 兼容
        if isinstance(group_id, str) and group_id.isdigit():
            group_id = int(group_id)
        elif isinstance(group_id, str):
            group_id = None
        category = item.get("category", "通用")
        meaning = item.get("meaning", "")
        scene = item.get("scene", "")
        tags = json.dumps(item.get("tags", []), ensure_ascii=False)
        name = (item.get("name") or content)[:60]

        db.execute(
            "INSERT INTO word_card (group_id, name, content, meaning, scene, module, category, tags, is_builtin, is_deleted, sort_order, card_role, source) VALUES (?,?,?,?,?,?,?,?,0,0,0,'custom','import')",
            [group_id, name, content, meaning, scene, "custom", category, tags]
        )
        safe_commit()
        created += 1

    return {
        "ok": True,
        "created": created,
        "skipped": skipped,
        "failed": failed,
        "total": len(items)
    }


@router.post("/trash/batch-trash")
def batch_trash(data: dict):
    """批量移入回收站 — Phase17.4: 兼容 word_card + prompt_cards + prompts 三表"""
    prompt_ids = data.get("prompt_ids", [])
    if not prompt_ids:
        raise HTTPException(400, "缺少 prompt_ids")
    db = get_db()
    trashed = 0
    for pid in prompt_ids:
        deleted = False
        # 1) word_card（新引擎主表，1074+ 条）
        row = db.execute("SELECT id FROM word_card WHERE id=? AND is_deleted=0", [pid]).fetchone()
        if row:
            db.execute("UPDATE word_card SET is_deleted=1, deleted_at=datetime('now','localtime') WHERE id=?", [pid])
            deleted = True
        # 2) prompt_cards（v4 迁移表，152 条）
        row = db.execute("SELECT id FROM prompt_cards WHERE id=? AND is_deleted=0", [pid]).fetchone()
        if row:
            db.execute("UPDATE prompt_cards SET is_deleted=1, deleted_at=datetime('now','localtime') WHERE id=?", [pid])
            db.execute("UPDATE prompts SET deleted_at=datetime('now','localtime') WHERE id=? AND deleted_at IS NULL", [pid])
            deleted = True
        # 3) prompts（最旧表，156 条，无 is_deleted 字段）
        row = db.execute("SELECT id FROM prompts WHERE id=? AND deleted_at IS NULL", [pid]).fetchone()
        if row:
            db.execute("UPDATE prompts SET deleted_at=datetime('now','localtime') WHERE id=?", [pid])
            deleted = True
        if deleted:
            db.execute("DELETE FROM collection_items WHERE prompt_id=?", [pid])
            db.execute("DELETE FROM wordpack_items WHERE prompt_id=?", [pid])
            trashed += 1
    db.commit()
    return {"ok": True, "trashed": trashed}


# ==================== 5. 智能推荐 ====================

@router.get("/recommend/{prompt_id}")
def recommend_prompts(prompt_id: int, limit: int = Query(6, ge=1, le=20)):
    """基于标签匹配的智能推荐 — 同时查 word_card + prompts 表"""
    db = get_db()

    # 先查 word_card (v4 主表，id 范围大)，再查 prompts (旧表)
    row = db.execute(
        "SELECT module, category, tags, content FROM word_card WHERE id=? AND is_deleted=0",
        [prompt_id]
    ).fetchone()
    table_name = "word_card"
    if not row:
        row = db.execute(
            "SELECT module, category, tags, content FROM prompts WHERE id=? AND deleted_at IS NULL",
            [prompt_id]
        ).fetchone()
        table_name = "prompts"
    if not row:
        raise HTTPException(404, "提示词不存在")

    try:
        tags = json.loads(row["tags"])
    except Exception:
        tags = []

    # partner column 映射 — word_card 用 name，prompts 用 content
    content_col = "name" if table_name == "word_card" else "content"
    is_deleted_filter = "is_deleted=0" if table_name == "word_card" else "deleted_at IS NULL"

    # 无标签：同 module + category 推荐
    if not tags:
        rows = db.execute(f"""
            SELECT id, module, category, {content_col} as content, meaning, tags, usage_count
            FROM {table_name}
            WHERE id != ? AND module = ? AND category = ? AND {is_deleted_filter}
            ORDER BY usage_count DESC
            LIMIT ?
        """, [prompt_id, row["module"], row["category"], limit]).fetchall()
        return {"items": [dict(r) for r in rows], "reason": "same_category"}

    # 标签匹配：跨表 union all
    candidates = []
    # v4 word_card
    wc_rows = db.execute(f"""
        SELECT id, module, category, {content_col} as content, meaning, tags, usage_count
        FROM {table_name} WHERE id != ? AND {is_deleted_filter}
    """, [prompt_id]).fetchall()
    candidates.extend(wc_rows)

    # 如果当前表是 word_card，也加入 prompts 作为候选池
    if table_name == "word_card":
        p_rows = db.execute("""
            SELECT id, module, category, content, meaning, tags, usage_count
            FROM prompts WHERE deleted_at IS NULL
        """).fetchall()
        # 避免 id 冲突 — prompts 的 id 范围远小于 word_card
        for pr in p_rows:
            candidates.append(pr)

    scored = []
    for r in candidates:
        try:
            other_tags = set(json.loads(r["tags"]))
        except Exception:
            other_tags = set()
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


# ==================== 7. 回收站 ====================

@router.get("/trash")
def list_trash(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)):
    """回收站列表 — Phase17.4: UNION word_card + prompt_cards 双源"""
    db = get_db()
    # word_card 软删除项
    wc_sql = """
        SELECT wc.id, wc.module, wc.category, '' as subcategory, wc.content, wc.meaning, wc.scene, wc.tags,
               wc.usage_count, wc.deleted_at, wc.thumbnail, '' as video_filename,
               '' as video_poster, 0 as video_fps, 0 as video_duration,
               wc.is_builtin
        FROM word_card wc WHERE wc.is_deleted=1
    """
    # prompt_cards 软删除项（此表无 subcategory 列）
    pc_sql = """
        SELECT pc.id, pc.module, pc.category, '' as subcategory, pc.content, pc.meaning, pc.scene, pc.tags,
               pc.usage_count, pc.deleted_at, '' as thumbnail, '' as video_filename,
               '' as video_poster, 0 as video_fps, 0 as video_duration,
               pc.is_builtin
        FROM prompt_cards pc WHERE pc.is_deleted=1
    """
    # 旧 prompts 表（deleted_at 方式）
    p_sql = """
        SELECT p.id, p.module, p.category, p.subcategory, p.content, p.meaning, p.scene, p.tags,
               p.usage_count, p.deleted_at, pt.filename as thumbnail, pv.filename as video_filename,
               pv.poster as video_poster, pv.fps as video_fps, pv.duration as video_duration,
               p.is_builtin
        FROM prompts p
        LEFT JOIN prompt_thumbnails pt ON pt.prompt_id = p.id
        LEFT JOIN prompt_videos pv ON pv.prompt_id = p.id
        WHERE p.deleted_at IS NOT NULL
    """
    # 合并三源，按 deleted_at 降序
    union_sql = f"SELECT * FROM ({wc_sql} UNION ALL {pc_sql} UNION ALL {p_sql}) AS trash_items"
    total_row = db.execute(f"SELECT COUNT(*) as cnt FROM ({union_sql})").fetchone()
    total = total_row["cnt"] if total_row else 0

    offset = (page - 1) * page_size
    rows = db.execute(f"{union_sql} ORDER BY deleted_at DESC LIMIT ? OFFSET ?", [page_size, offset]).fetchall()
    items = [dict(r) for r in rows]
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "items": items
    }


@router.post("/trash/{prompt_id}/restore")
def restore_from_trash(prompt_id: int):
    """从回收站恢复词条 — Phase17.4: 兼容 word_card + prompt_cards 双表"""
    db = get_db()
    # 1) word_card（新引擎主表）
    row = db.execute("SELECT id FROM word_card WHERE id=? AND is_deleted=1", [prompt_id]).fetchone()
    if row:
        db.execute("UPDATE word_card SET is_deleted=0, deleted_at=NULL WHERE id=?", [prompt_id])
        db.commit()
        return {"ok": True}
    # 2) prompt_cards（v4 迁移表）
    row = db.execute("SELECT id FROM prompt_cards WHERE id=? AND is_deleted=1", [prompt_id]).fetchone()
    if row:
        db.execute("UPDATE prompt_cards SET is_deleted=0, deleted_at=NULL WHERE id=?", [prompt_id])
        db.execute("UPDATE prompts SET deleted_at=NULL WHERE id=? AND deleted_at IS NOT NULL", [prompt_id])
        db.commit()
        return {"ok": True}
    raise HTTPException(404, "提示词不存在或不在回收站")


@router.post("/trash/batch-restore")
def batch_restore_from_trash(data: dict):
    """批量恢复 — Phase17.4: 兼容 word_card + prompt_cards 双表"""
    prompt_ids = data.get("prompt_ids", [])
    if not prompt_ids:
        raise HTTPException(400, "缺少 prompt_ids")
    db = get_db()
    for pid in prompt_ids:
        db.execute("UPDATE word_card SET is_deleted=0, deleted_at=NULL WHERE id=? AND is_deleted=1", [pid])
        db.execute("UPDATE prompt_cards SET is_deleted=0, deleted_at=NULL WHERE id=? AND is_deleted=1", [pid])
        db.execute("UPDATE prompts SET deleted_at=NULL WHERE id=? AND deleted_at IS NOT NULL", [pid])
    db.commit()
    return {"ok": True, "count": len(prompt_ids)}


@router.delete("/trash/{prompt_id}")
def permanent_delete_prompt(prompt_id: int):
    """永久删除（内置词条禁止永久删除）— Phase17.4: 兼容 word_card + prompt_cards 双表"""
    db = get_db()
    # 1) word_card（新引擎主表）
    row = db.execute("SELECT id, is_builtin FROM word_card WHERE id=?", [prompt_id]).fetchone()
    if row:
        if row["is_builtin"] == 1:
            raise HTTPException(403, "内置提示词不可永久删除，可恢复")
        for tbl in ["collection_items", "wordpack_items", "usage_history"]:
            db.execute(f"DELETE FROM {_safe_delete_table(tbl)} WHERE prompt_id=?", [prompt_id])
        db.execute("DELETE FROM atom_word_bridge WHERE word_card_id=?", [prompt_id])
        db.execute("DELETE FROM scene_card_ref WHERE card_id=?", [prompt_id])
        db.execute("DELETE FROM word_card_versions WHERE card_id=?", [prompt_id])
        db.execute("DELETE FROM word_card WHERE id=?", [prompt_id])
        safe_commit()
        return {"ok": True}
    # 2) prompt_cards（v4 迁移表）
    row = db.execute("SELECT id, is_builtin FROM prompt_cards WHERE id=?", [prompt_id]).fetchone()
    if row:
        if row["is_builtin"] == 1:
            raise HTTPException(403, "内置提示词不可永久删除，可恢复")
        for tbl in ["collection_items", "wordpack_items", "usage_history", "prompt_thumbnails", "prompt_videos"]:
            db.execute(f"DELETE FROM {_safe_delete_table(tbl)} WHERE prompt_id=?", [prompt_id])
        db.execute("DELETE FROM prompts WHERE id=?", [prompt_id])
        db.execute("DELETE FROM prompt_cards WHERE id=?", [prompt_id])
        safe_commit()
        return {"ok": True}
    raise HTTPException(404, "提示词不存在")


@router.post("/trash/empty")
def empty_trash():
    """清空回收站（内置词条跳过不清除）— Phase17.4.1: 分批提交防止大事务锁死"""
    db = get_db()
    done = 0
    # 1) word_card — 批量删除（每次 50 条 + safe_commit）
    wc_rows = db.execute("SELECT id, is_builtin FROM word_card WHERE is_deleted=1").fetchall()
    for i in range(0, len(wc_rows), 50):
        batch = wc_rows[i:i+50]
        for row in batch:
            pid = row["id"]
            if row["is_builtin"] == 1:
                db.execute("UPDATE word_card SET is_deleted=0, deleted_at=NULL WHERE id=?", [pid])
                continue
            for tbl in ["collection_items", "wordpack_items", "usage_history"]:
                db.execute(f"DELETE FROM {_safe_delete_table(tbl)} WHERE prompt_id=?", [pid])
            # FK 列名不同的表
            db.execute("DELETE FROM atom_word_bridge WHERE word_card_id=?", [pid])
            db.execute("DELETE FROM scene_card_ref WHERE card_id=?", [pid])
            db.execute("DELETE FROM word_card_versions WHERE card_id=?", [pid])
            db.execute("DELETE FROM word_card WHERE id=?", [pid])
            done += 1
        safe_commit()
    # 2) prompt_cards — 批量删除
    pc_rows = db.execute("SELECT id, is_builtin FROM prompt_cards WHERE is_deleted=1").fetchall()
    for i in range(0, len(pc_rows), 50):
        batch = pc_rows[i:i+50]
        for row in batch:
            pid = row["id"]
            if row["is_builtin"] == 1:
                db.execute("UPDATE prompt_cards SET is_deleted=0, deleted_at=NULL WHERE id=?", [pid])
                db.execute("UPDATE prompts SET deleted_at=NULL WHERE id=?", [pid])
                continue
            for tbl in ["collection_items", "wordpack_items", "usage_history", "prompt_thumbnails", "prompt_videos"]:
                db.execute(f"DELETE FROM {_safe_delete_table(tbl)} WHERE prompt_id=?", [pid])
            db.execute("DELETE FROM prompts WHERE id=?", [pid])
            db.execute("DELETE FROM prompt_cards WHERE id=?", [pid])
            done += 1
        safe_commit()
    return {"ok": True, "count": done}
