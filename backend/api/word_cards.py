"""
v4.1.0: 统一词卡 API
/api/v4/word-cards — 词卡 CRUD + 分组管理 + 多端选取
单一路由前缀，所有模块共享同一数据源
"""
import json, re, hashlib, os
from fastapi import APIRouter, Query, HTTPException
from database import get_db, safe_commit

router = APIRouter(prefix="/api/v4/word-cards", tags=["word-cards"])

# ⚠️ 路由顺序必须: 静态路径 → 动态路径 → 根路径

# ==================== 分组 ====================

@router.get("/groups")
def list_groups(group_type: str = Query(None), include_empty: bool = Query(False)):
    db = get_db()
    where = ["wg.is_active=1"]; params = []
    if group_type: where.append("wg.group_type=?"); params.append(group_type)
    rows = db.execute(f"SELECT wg.*, COUNT(wc.id) as card_count FROM word_card_group wg LEFT JOIN word_card wc ON wc.group_id=wg.id AND wc.is_deleted=0 WHERE {' AND '.join(where)} GROUP BY wg.id ORDER BY wg.sort_order", params).fetchall()
    return {"ok": True, "groups": [dict(r) for r in rows if include_empty or r["card_count"] > 0], "total": len(rows)}

@router.post("/groups")
def create_group(data: dict):
    name = (data.get("name") or "").strip()
    if not name: raise HTTPException(400, "分组名称不能为空")
    key = data.get("group_key") or "custom_" + hashlib.md5(name.encode()).hexdigest()[:8]
    db = get_db()
    if db.execute("SELECT id FROM word_card_group WHERE group_key=?", [key]).fetchone():
        raise HTTPException(409, "分组已存在")
    db.execute("INSERT INTO word_card_group (name,group_key,icon,description,group_type,sort_order) VALUES (?,?,?,?,'custom',(SELECT COALESCE(MAX(sort_order),0)+1 FROM word_card_group))",
               [name, key, data.get("icon", "📂"), data.get("description", "")])
    safe_commit()
    return {"ok": True, "id": db.execute("SELECT last_insert_rowid()").fetchone()[0], "name": name, "group_key": key}

@router.put("/groups/{group_id}")
def update_group(group_id: int, data: dict):
    db = get_db()
    if not db.execute("SELECT id FROM word_card_group WHERE id=? AND group_type='custom'", [group_id]).fetchone():
        raise HTTPException(404, "分组不存在或不可编辑")
    fields = []; params = []
    for k in ["name","icon","description"]:
        if data.get(k) is not None: fields.append(f"{k}=?"); params.append(data[k])
    if fields:
        params.append(group_id)
        db.execute(f"UPDATE word_card_group SET {', '.join(fields)}, updated_at=datetime('now','localtime') WHERE id=?", params)
        safe_commit()
    return {"ok": True}

@router.delete("/groups/{group_id}")
def delete_group(group_id: int):
    db = get_db()
    if not db.execute("SELECT id FROM word_card_group WHERE id=? AND group_type='custom'", [group_id]).fetchone():
        raise HTTPException(404, "分组不存在或不可删除")
    db.execute("UPDATE word_card SET group_id=NULL WHERE group_id=?", [group_id])
    db.execute("UPDATE word_card_group SET is_active=0 WHERE id=?", [group_id])
    safe_commit()
    return {"ok": True, "message": "分组已删除，词卡已移至未分类"}

# ==================== 选取器 (静态路径) ====================

@router.get("/picker")
def picker_cards(group_type: str = Query("seedance"), search: str = Query(None),
                  page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)):
    db = get_db()
    g_where = ["wg.is_active=1"]; g_params = []
    if group_type != "all": g_where.append("wg.group_type=?"); g_params.append(group_type)
    groups = db.execute(f"SELECT wg.*, COUNT(wc.id) as card_count FROM word_card_group wg LEFT JOIN word_card wc ON wc.group_id=wg.id AND wc.is_deleted=0 WHERE {' AND '.join(g_where)} GROUP BY wg.id HAVING card_count > 0 ORDER BY wg.sort_order", g_params).fetchall()
    result_groups = []; all_ids = []
    for g in groups:
        cw = ["wc.group_id=?","wc.is_deleted=0"]; cp = [g["id"]]
        if search:
            fids = _fts_search(db, search)
            if fids: cw.append(f"wc.id IN ({','.join(map(str,fids))})")
            else: cw.append("(wc.content LIKE ? OR wc.name LIKE ?)"); cp.extend([f"%{search}%"]*2)
        cards = db.execute(f"SELECT wc.id,wc.name,wc.content,wc.meaning,wc.thumbnail,wc.media_type,wc.icon,wc.usage_count,wc.heat_weight,wc.tags,wc.module FROM word_card wc WHERE {' AND '.join(cw)} ORDER BY wc.heat_weight DESC,wc.usage_count DESC,wc.sort_order ASC LIMIT ?", cp+[page_size]).fetchall()
        items = []
        for c in cards:
            it = dict(c)
            try: it["tags"] = json.loads(it["tags"]) if isinstance(it["tags"], str) else (it["tags"] or [])
            except: it["tags"] = []
            items.append(it); all_ids.append(c["id"])
        result_groups.append({"id":g["id"],"name":g["name"],"key":g["group_key"],"icon":g["icon"],"type":g["group_type"],"card_count":g["card_count"],"cards":items})
    return {"ok":True,"groups":result_groups,"group_count":len(result_groups),"card_count":len(all_ids)}

@router.post("/picker/link")
def link_card_to_scene(data: dict):
    scene_id = data.get("scene_id"); card_id = data.get("card_id")
    if not scene_id or not card_id: raise HTTPException(400, "请提供 scene_id 和 card_id")
    db = get_db()
    card = db.execute("SELECT content FROM word_card WHERE id=?", [card_id]).fetchone()
    if not card: raise HTTPException(404, "词卡不存在")
    db.execute("INSERT OR REPLACE INTO scene_card_ref (scene_id,card_id,card_content) VALUES (?,?,?)", [scene_id, card_id, card["content"]])
    db.execute("UPDATE word_card SET usage_count=usage_count+1 WHERE id=?", [card_id])
    safe_commit()
    return {"ok":True,"scene_id":scene_id,"card_id":card_id,"content":card["content"]}

@router.delete("/picker/unlink")
def unlink_card(scene_id: int = Query(...), card_id: int = Query(...)):
    db = get_db()
    db.execute("DELETE FROM scene_card_ref WHERE scene_id=? AND card_id=?", [scene_id, card_id])
    safe_commit()
    return {"ok":True}

@router.get("/picker/scene-cards/{scene_id}")
def get_scene_cards(scene_id: int):
    db = get_db()
    rows = db.execute("SELECT scr.*,wc.name,wc.content,wc.thumbnail,wc.media_type FROM scene_card_ref scr JOIN word_card wc ON wc.id=scr.card_id WHERE scr.scene_id=? ORDER BY scr.created_at", [scene_id]).fetchall()
    return {"ok":True,"scene_id":scene_id,"cards":[dict(r) for r in rows]}

# ==================== 统计 + 批量 (静态路径) ====================

@router.get("/stats")
def get_stats():
    db = get_db()
    total = db.execute("SELECT COUNT(*) as c FROM word_card WHERE is_deleted=0").fetchone()["c"]
    groups = db.execute("SELECT group_type,COUNT(*) as c FROM word_card_group WHERE is_active=1 GROUP BY group_type").fetchall()
    return {"ok":True,"total_cards":total,"groups":{g["group_type"]:g["c"] for g in groups}}

@router.post("/batch")
def batch_operation(data: dict):
    action = data.get("action",""); ids = data.get("ids",[])
    if not ids: raise HTTPException(400,"请提供词卡ID列表")
    db = get_db(); ph = ",".join("?" for _ in ids)
    if action == "move":
        db.execute(f"UPDATE word_card SET group_id=?,updated_at=datetime('now','localtime') WHERE id IN ({ph})", [data.get("group_id")]+ids)
    elif action == "delete":
        db.execute(f"UPDATE word_card SET is_deleted=1,deleted_at=datetime('now','localtime') WHERE id IN ({ph}) AND is_builtin=1", ids)
        db.execute(f"DELETE FROM word_card WHERE id IN ({ph}) AND is_builtin=0", ids)
    elif action == "copy":
        tg = data.get("group_id")
        for cid in ids:
            row = db.execute("SELECT * FROM word_card WHERE id=?", [cid]).fetchone()
            if not row: continue
            db.execute("INSERT INTO word_card (group_id,name,content,meaning,scene,module,category,tags,icon,thumbnail,media_type,structured,sort_order,is_builtin,usage_count,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,'batch_copy')",
                       [tg, row["name"]+" (副本)", row["content"], row["meaning"], row["scene"], row["module"], row["category"], row["tags"], row["icon"], row["thumbnail"], row["media_type"], row["structured"]])
    else: raise HTTPException(400,f"不支持: {action}")
    safe_commit()
    return {"ok":True,"action":action,"count":len(ids)}

# ==================== 单条 CRUD (动态路径) ====================

@router.get("/{card_id}")
def get_card(card_id: int):
    db = get_db()
    r = db.execute("SELECT wc.*,wg.name as group_name,wg.group_type as group_type_name FROM word_card wc LEFT JOIN word_card_group wg ON wg.id=wc.group_id WHERE wc.id=?", [card_id]).fetchone()
    if not r: raise HTTPException(404,"词卡不存在")
    item = dict(r)
    try: item["tags"] = json.loads(item["tags"]) if isinstance(item["tags"], str) else (item["tags"] or [])
    except: item["tags"] = []
    try: item["structured"] = json.loads(item["structured"]) if isinstance(item["structured"], str) else (item["structured"] or {})
    except: item["structured"] = {}
    return {"ok":True,"card":item}

@router.put("/{card_id}")
def update_card(card_id: int, data: dict):
    db = get_db()
    if not db.execute("SELECT id FROM word_card WHERE id=?", [card_id]).fetchone():
        raise HTTPException(404,"词卡不存在")
    fields = []; params = []
    for k in ["name","content","meaning","scene","module","category","icon","thumbnail","preview_media","media_type","group_id","sort_order"]:
        if data.get(k) is not None: fields.append(f"{k}=?"); params.append(data[k])
    if data.get("tags") is not None: fields.append("tags=?"); params.append(json.dumps(data["tags"], ensure_ascii=False))
    if data.get("structured") is not None: fields.append("structured=?"); params.append(json.dumps(data["structured"], ensure_ascii=False))
    if fields:
        fields.append("updated_at=datetime('now','localtime')"); fields.append("version=version+1")
        params.append(card_id)
        db.execute(f"UPDATE word_card SET {', '.join(fields)} WHERE id=?", params); safe_commit()
        if data.get("content"):
            try: from semantic import update_embedding; update_embedding(card_id, data["content"])
            except: pass
    return {"ok":True}

@router.delete("/{card_id}")
def delete_card(card_id: int):
    db = get_db()
    r = db.execute("SELECT id,is_builtin FROM word_card WHERE id=?", [card_id]).fetchone()
    if not r: raise HTTPException(404,"词卡不存在")
    if r["is_builtin"]: db.execute("UPDATE word_card SET is_deleted=1,deleted_at=datetime('now','localtime') WHERE id=?", [card_id])
    else: db.execute("DELETE FROM word_card WHERE id=?", [card_id])
    safe_commit()
    return {"ok":True}

# ==================== 列表 (根路径 — 必须放在最后) ====================

@router.get("")
def list_cards(page: int = Query(1,ge=1), page_size: int = Query(50,ge=1,le=200),
               group_id: int = Query(None), group_type: str = Query(None),
               module: str = Query(None), search: str = Query(None), category: str = Query(None),
               sort: str = Query("sort_order"), order: str = Query("asc"), is_builtin: int = Query(None)):
    db = get_db()
    where = ["wc.is_deleted=0"]; params = []
    if group_id: where.append("wc.group_id=?"); params.append(group_id)
    if group_type: where.append("wc.group_id IN (SELECT id FROM word_card_group WHERE group_type=?)"); params.append(group_type)
    if module: where.append("wc.module=?"); params.append(module)
    if category: where.append("wc.category=?"); params.append(category)
    if is_builtin is not None: where.append("wc.is_builtin=?"); params.append(is_builtin)
    if search and search.strip():
        s = search.strip(); like = f"%{s}%"
        fids = _fts_search(db, s)
        if fids: where.append(f"wc.id IN ({','.join(map(str,fids))})")
        else: where.append("(wc.content LIKE ? OR wc.name LIKE ? OR wc.meaning LIKE ? OR wc.tags LIKE ?)"); params.extend([like]*4)
    w = " AND ".join(where)
    sc = {"sort_order":"wc.sort_order","usage_count":"wc.usage_count","updated_at":"wc.updated_at","created_at":"wc.created_at","name":"wc.name"}.get(sort, "wc.sort_order")
    sd = "DESC" if order == "desc" else "ASC"
    total = db.execute(f"SELECT COUNT(*) as c FROM word_card wc WHERE {w}", params).fetchone()["c"]
    rows = db.execute(f"SELECT wc.*,wg.name as group_name,wg.group_type as group_type_name,wg.icon as group_icon FROM word_card wc LEFT JOIN word_card_group wg ON wg.id=wc.group_id WHERE {w} ORDER BY {sc} {sd} LIMIT ? OFFSET ?",
                      params+[page_size, (page-1)*page_size]).fetchall()
    items = []
    for r in rows:
        it = dict(r)
        try: it["tags"] = json.loads(it["tags"]) if isinstance(it["tags"], str) else (it["tags"] or [])
        except: it["tags"] = []
        try: it["structured"] = json.loads(it["structured"]) if isinstance(it["structured"], str) else (it["structured"] or {})
        except: it["structured"] = {}
        items.append(it)
    return {"ok":True,"items":items,"total":total,"total_pages":max(1,-(-total//page_size)),"page":page,"page_size":page_size}

@router.post("")
def create_card(data: dict):
    content = (data.get("content") or "").strip()
    if not content: raise HTTPException(400,"词卡内容不能为空")
    db = get_db(); gid = data.get("group_id")
    db.execute("INSERT INTO word_card (group_id,name,content,meaning,scene,module,category,tags,icon,thumbnail,preview_media,media_type,structured,sort_order,is_builtin,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'{}',(SELECT COALESCE(MAX(sort_order),0)+1 FROM word_card WHERE group_id=?),0,'manual')",
               [gid,(data.get("name") or content)[:60],content,data.get("meaning",""),data.get("scene",""),data.get("module","custom"),data.get("category",""),json.dumps(data.get("tags",[]),ensure_ascii=False),data.get("icon",""),data.get("thumbnail",""),data.get("preview_media",""),data.get("media_type","image"),gid])
    safe_commit()
    cid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    try: from semantic import update_embedding; update_embedding(cid, content)
    except: pass
    return {"ok":True,"id":cid}

# ==================== 辅助 ====================

def _fts_search(db, query: str) -> list:
    try:
        safe = ' AND '.join(f'"{w}"' for w in query.split() if len(w) >= 2)
        if not safe: safe = query
        return [r["rowid"] for r in db.execute("SELECT rowid FROM word_card_fts WHERE word_card_fts MATCH ? LIMIT 100", [safe]).fetchall()]
    except: return []
