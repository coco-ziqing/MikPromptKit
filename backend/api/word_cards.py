"""
v4.1.0: 统一词卡 API
/api/v4/word-cards — 词卡 CRUD + 分组管理 + 多端选取
单一路由前缀，所有模块共享同一数据源
"""
import json, re, hashlib, os, uuid, io
from fastapi import APIRouter, Query, HTTPException, UploadFile, File
from fastapi.responses import Response, FileResponse
from database import get_db, safe_count, safe_count_dict, safe_fetch_one, safe_commit

router = APIRouter(prefix="/api/v4/word-cards", tags=["word-cards"])

# 媒体存储目录：backend/api/ → backend/ → 项目根 → data/wc_media/
WC_MEDIA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "wc_media")
WC_THUMB_DIR = os.path.join(WC_MEDIA_DIR, "thumbs")
WC_VIDEO_DIR = os.path.join(WC_MEDIA_DIR, "videos")
for d in [WC_THUMB_DIR, WC_VIDEO_DIR]:
    os.makedirs(d, exist_ok=True)

def _safe_remove_media(thumbnail, preview_media):
    """安全清理旧媒体文件"""
    for fname, directory in [(thumbnail, WC_THUMB_DIR), (preview_media, WC_VIDEO_DIR)]:
        if fname:
            p = os.path.join(directory, os.path.basename(fname))
            if os.path.exists(p):
                try: os.remove(p)
                except: pass

# ⚠️ 路由顺序必须: 静态路径 → 动态路径 → 根路径

# ==================== 分组 ====================

@router.get("/groups")
def list_groups(group_type: str = Query(None), include_empty: bool = Query(False)):
    db = get_db()
    where = ["wg.is_active=1"]; params = []
    if group_type: where.append("wg.group_type=?"); params.append(group_type)
    rows = db.execute(f"SELECT wg.*, COUNT(wc.id) as card_count FROM word_card_group wg LEFT JOIN word_card wc ON wc.group_id=wg.id AND wc.is_deleted=0 WHERE {' AND '.join(where)} GROUP BY wg.id ORDER BY wg.group_type, wg.parent_group_id, wg.sort_order", params).fetchall()
    groups = [dict(r) for r in rows if include_empty or r["card_count"] > 0]
    # 计算 _depth（嵌套深度，用于前端缩进）
    id_map = {g["id"]: g for g in groups}
    def calc_depth(g):
        d = 0; pid = g.get("parent_group_id")
        while pid and pid in id_map: d += 1; pid = id_map[pid].get("parent_group_id")
        return d
    for g in groups: g["_depth"] = calc_depth(g)
    return {"ok": True, "groups": groups, "total": len(groups)}

@router.get("/groups/tree")
def groups_tree():
    """返回完整的嵌套分类树（三级：root→sub→leaf）"""
    db = get_db()
    rows = db.execute("""
        SELECT wg.*,
               (SELECT COUNT(*) FROM word_card wc WHERE wc.group_id=wg.id AND wc.is_deleted=0) as card_count,
               (SELECT COUNT(*) FROM word_card_group child WHERE child.parent_group_id=wg.id AND child.is_active=1) as child_count
        FROM word_card_group wg
        WHERE wg.is_active=1 AND wg.group_type IN ('root','sub','builtin','seedance','custom','atom')
        ORDER BY wg.group_type, wg.parent_group_id, wg.sort_order
    """).fetchall()

    def build_tree(items, parent_id=None):
        tree = []
        for r in items:
            if r["parent_group_id"] == parent_id:
                node = dict(r)
                node["children"] = build_tree(items, r["id"])
                tree.append(node)
        return tree

    return {"ok": True, "tree": build_tree(rows)}

@router.post("/groups")
def create_group(data: dict):
    name = (data.get("name") or "").strip()
    if not name: raise HTTPException(400, "分组名称不能为空")
    key = data.get("group_key") or "custom_" + hashlib.md5(name.encode()).hexdigest()[:8]
    parent_id = data.get("parent_group_id")  # Phase14: 支持嵌套
    icon = data.get("icon", "📂")
    desc = data.get("description", "")
    db = get_db()
    if safe_fetch_one("SELECT id FROM word_card_group WHERE group_key=?", [key]):
        raise HTTPException(409, "分组已存在")
    # sort_order = 同级最大+1
    sort_sql = "SELECT COALESCE(MAX(sort_order),0)+1 FROM word_card_group WHERE parent_group_id " + ("= ?" if parent_id else "IS NULL")
    sort_params = [parent_id] if parent_id else []
    new_sort = safe_count(sort_sql, sort_params)
    db.execute("INSERT INTO word_card_group (name,group_key,icon,description,group_type,parent_group_id,sort_order) VALUES (?,?,?,?,'custom',?,?)",
               [name, key, icon, desc, parent_id, new_sort])
    safe_commit()
    return {"ok": True, "id": safe_count("SELECT last_insert_rowid()"), "name": name, "group_key": key}

@router.put("/groups/{group_id}")
def update_group(group_id: int, data: dict):
    db = get_db()
    g = db.execute("SELECT id,group_type FROM word_card_group WHERE id=? AND is_active=1", [group_id]).fetchone()
    if not g: raise HTTPException(404, "分组不存在")
    if g["group_type"] in ("root","builtin"): raise HTTPException(403, "内置分组不可编辑")
    fields = []; params = []
    for k in ["name","icon","description","parent_group_id","sort_order"]:
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
    card = safe_fetch_one("SELECT content FROM word_card WHERE id=?", [card_id])
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

# ==================== AI 智能分组推荐 (P0-2) ====================

@router.post("/suggest-group")
def suggest_group(data: dict):
    """根据词卡内容，AI 推荐最匹配的分组（关键词+样本匹配）"""
    content = (data.get("content") or "").strip()
    name = (data.get("name") or "").strip()
    meaning = (data.get("meaning") or "").strip()
    text = content or name
    if not text:
        raise HTTPException(400, "请提供词卡内容或名称")
    search_text = f"{name} {content} {meaning}"[:300]
    db = get_db()
    groups = db.execute("""
        SELECT wg.id, wg.name, wg.group_key, wg.group_type, wg.icon,
               (SELECT COUNT(*) FROM word_card wc WHERE wc.group_id=wg.id AND wc.is_deleted=0) as card_count,
               COALESCE((SELECT GROUP_CONCAT(content, ' | ') FROM (
                   SELECT wc2.content FROM word_card wc2
                   WHERE wc2.group_id=wg.id AND wc2.is_deleted=0
                   ORDER BY wc2.usage_count DESC LIMIT 5
               )), '') as sample_cards
        FROM word_card_group wg
        WHERE wg.is_active=1 AND wg.group_type NOT IN ('root','sub')
          AND (SELECT COUNT(*) FROM word_card wc WHERE wc.group_id=wg.id AND wc.is_deleted=0) > 0
        ORDER BY wg.group_type, wg.sort_order
    """).fetchall()
    if not groups:
        return {"ok": True, "suggestions": [], "message": "暂无可用分组"}
    suggestions = []
    text_lower = search_text.lower()
    for g in groups:
        score = 0.0
        reasons = []
        group_name = (g["name"] or "").lower()
        group_key = (g["group_key"] or "").lower()
        samples = (g["sample_cards"] or "").lower()
        # 1) 分组名关键词匹配
        name_words = re.split(r'[\s\-_\.·,/，]+', group_name)
        for w in name_words:
            if len(w) >= 2 and w in text_lower:
                score += 0.15
                reasons.append(f'关键词: "{w}"')
                break
        # 2) 分组 key 匹配
        if len(group_key) >= 3 and group_key in text_lower:
            score += 0.10
            reasons.append('标识匹配')
        # 3) 样本词卡相似度
        if samples:
            sample_words = set(re.findall(r'[\u4e00-\u9fff]{2,}|[a-zA-Z]{3,}', samples))
            text_words = set(re.findall(r'[\u4e00-\u9fff]{2,}|[a-zA-Z]{3,}', text_lower))
            overlap = len(sample_words & text_words)
            if overlap > 0:
                score += min(0.35, overlap * 0.04)
                if overlap >= 3:
                    reasons.append(f'样本匹配 ({overlap}词)')
        # 4) 热度加成
        if g["card_count"] > 10:
            score += 0.10
            reasons.append('热门分组')
        elif g["card_count"] > 5:
            score += 0.05
        score = min(1.0, round(score, 2))
        if score > 0.03:
            suggestions.append({
                "group_id": g["id"],
                "group_name": g["name"],
                "group_key": g["group_key"],
                "group_type": g["group_type"],
                "icon": g["icon"],
                "card_count": g["card_count"],
                "score": score,
                "confidence": "high" if score >= 0.5 else "medium" if score >= 0.2 else "low",
                "reasons": reasons[:3]
            })
    suggestions.sort(key=lambda x: x["score"], reverse=True)
    return {"ok": True, "query": search_text[:100], "suggestions": suggestions[:5]}

@router.get("/picker/scene-cards/{scene_id}")
def get_scene_cards(scene_id: int):
    db = get_db()
    rows = db.execute("SELECT scr.*,wc.name,wc.content,wc.thumbnail,wc.media_type FROM scene_card_ref scr JOIN word_card wc ON wc.id=scr.card_id WHERE scr.scene_id=? ORDER BY scr.created_at", [scene_id]).fetchall()
    return {"ok":True,"scene_id":scene_id,"cards":[dict(r) for r in rows]}

# ==================== 统计 + 批量 (静态路径) ====================

@router.get("/stats")
def get_stats():
    db = get_db()
    total = safe_count_dict("SELECT COUNT(*) as c FROM word_card WHERE is_deleted=0", key="c")
    groups = db.execute("SELECT group_type,COUNT(*) as c FROM word_card_group WHERE is_active=1 GROUP BY group_type").fetchall()
    return {"ok":True,"total_cards":total,"groups":{g["group_type"]:g["c"] for g in groups}}

@router.post("/batch")
def batch_operation(data: dict):
    action = data.get("action",""); ids = data.get("ids",[])
    if not ids: raise HTTPException(400,"请提供词卡ID列表")
    db = get_db(); ph = ",".join("?" for _ in ids)
    if action == "move":
        tg = data.get("group_id")
        max_sort = db.execute("SELECT COALESCE(MAX(sort_order),0) FROM word_card WHERE group_id=?", [tg]).fetchone()[0]
        for idx, cid in enumerate(ids):
            db.execute("UPDATE word_card SET group_id=?,sort_order=?,updated_at=datetime('now','localtime') WHERE id=?", [tg, max_sort+1+idx, cid])
    elif action == "delete":
        # Phase17: 统一软删除 — 防止自定义词卡永久丢失
        db.execute(f"UPDATE word_card SET is_deleted=1,deleted_at=datetime('now','localtime') WHERE id IN ({ph})", ids)
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

# ==================== 缩略图/视频上传（必须在 /{card_id} 之前注册，避免被通配吞掉）====================

# ==================== P0-5: 自然语言批量录入 ====================

@router.post("/batch-create")
async def batch_create_from_text(data: dict):
    """
    自然语言批量录入：用户输入描述文本，AI 自动拆解为多条词卡
    示例输入: "录入5个赛博朋克场景：霓虹雨夜、全息街市、废弃工厂、",
    "数据洪流、地下黑市", AI 解析为 5 条词卡 + 自动匹配分组
    """
    text = (data.get("text") or "").strip()
    target_group_id = data.get("group_id")  # 可选：强制指定分组
    auto_archive = data.get("auto_archive", True)  # 自动入库
    
    if not text:
        raise HTTPException(400, "请输入文本")
    db = get_db()

    # 获取分组列表供关键词匹配
    group_options = db.execute("""
        SELECT wg.id, wg.name, wg.group_type, wg.group_key,
               (SELECT COUNT(*) FROM word_card wc WHERE wc.group_id=wg.id AND wc.is_deleted=0) as card_count
        FROM word_card_group wg
        WHERE wg.is_active=1 AND wg.group_type NOT IN ('root','sub')
        ORDER BY wg.group_type, wg.sort_order
    """).fetchall()
    all_groups = [{"id": g["id"], "name": g["name"], "type": g["group_type"], "key": g["group_key"]} for g in group_options]

    # 纯规则引擎拆解：按中文标点 + 换行分词条
    clean = text.replace('\n', '，').replace('\r', '').replace(';', '，').replace('；', '，')
    # 去掉前缀描述
    clean = re.sub(r'^[^，,、]*?[:：]\s*', '', clean)
    clean = re.sub(r'录入\s*\d*\s*[个条项张]*\s*[:：]?\s*', '', clean)
    clean = re.sub(r'添加\s*\d*\s*[个条项张]*\s*[:：]?\s*', '', clean)
    clean = re.sub(r'新增\s*\d*\s*[个条项张]*\s*[:：]?\s*', '', clean)
    # 统一分隔符为逗号再拆
    clean = re.sub(r'[、，,]', ',', clean)
    segs = [s.strip() for s in clean.split(',')]
    items = []
    seen = set()
    for s in segs:
        if not s or len(s) < 2 or len(s) > 80:
            continue
        # 去编号前缀
        s = re.sub(r'^\d+[\.\)、，]\s*', '', s)
        s = s.strip(' \'"\u201c\u201d')
        if s in seen:
            continue
        seen.add(s)
        # 关键词匹配分组
        best_gid, best_name, best_score = target_group_id, "", 0
        if not best_gid:
            sl = s.lower()
            for g in all_groups:
                gn = (g["name"] or "").lower()
                score = 0
                for w in re.split(r'[\s\-_·/]+', gn):
                    if len(w) >= 2 and w in sl:
                        score += 1
                kw_map = {"style":["风格","画风","美术"],"color":["色","调色","配色"],"lighting":["光","影","光影"],"composition":["构图","取景","视角"],"camera":["镜头","运镜","焦段"],"quality":["画质","4k","细节"],"atmosphere":["氛围","环境","场景"],"subject":["人","角色","人物","主体"],"negative":["不要","排除","禁止"],"tone":["色调","影调","滤镜"],"action":["动作","动态","运动"]}
                for kt, kws in kw_map.items():
                    if g["type"] == kt or kt in (g["key"] or ""):
                        for kw in kws:
                            if kw in sl:
                                score += 1
                if score > best_score:
                    best_score, best_gid, best_name = score, g["id"], g["name"]
        items.append({"content": s, "meaning": s[:30], "group_id": best_gid or None, "group_name": best_name or "自动", "tags": []})

    if not items:
        raise HTTPException(400, "未识别出有效词条，请用逗号/顿号/换行分隔")

    if not auto_archive:
        return {"ok": True, "preview": True, "items": items, "count": len(items)}

    created = []
    errors = []
    for it in items:
        try:
            content = (it.get("content") or "").strip()
            if not content:
                continue
            gid = target_group_id or it.get("group_id")
            if gid and not db.execute("SELECT id FROM word_card_group WHERE id=? AND is_active=1", [gid]).fetchone():
                gid = None
            name = content[:60]
            meaning = it.get("meaning", "")[:200]
            max_sort = db.execute("SELECT COALESCE(MAX(sort_order),0) FROM word_card WHERE group_id=?", [gid]).fetchone()[0]
            db.execute(
                "INSERT INTO word_card (group_id,name,content,meaning,tags,module,card_role,media_type,structured,version,sort_order,is_builtin,source) VALUES (?,?,?,?,?,?,?,?,?,1,?,0,'batch_create')",
                [gid, name, content, meaning, "[]", "custom", "batch", "image", "{}", max_sort + 1]
            )
            cid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
            created.append({"id": cid, "content": content[:60], "name": name[:30], "group_id": gid, "group_name": it.get("group_name", ""), "meaning": meaning[:40]})
        except Exception as e:
            errors.append({"content": it.get("content", "")[:40], "error": str(e)[:100]})
    db.commit()
    return {"ok": True, "created": created, "created_count": len(created), "errors": errors, "total_parsed": len(items)}


# ==================== 缩略图/视频上传（必须在 /{card_id} 之前注册，避免被通配吞掉）====================

# ============ 缩略图（路由顺序: 静态 > 动态） ============

@router.post("/{card_id}/thumbnail-from-library")
def copy_thumbnail_from_library(card_id: int, data: dict):
    """从图库复制图片到词卡缩略图（避免前端 blob 中转）"""
    source = (data.get("source_filename") or "").strip()
    if not source:
        raise HTTPException(400, "请提供 source_filename")
    db = get_db()
    card = safe_fetch_one("SELECT * FROM word_card WHERE id=?", [card_id])
    if not card:
        raise HTTPException(404, "词卡不存在")
    # 源文件路径: data/thumbnails/（缩略图库）
    THUMB_LIB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "thumbnails")
    src_path = os.path.join(THUMB_LIB_DIR, os.path.basename(source))
    if not os.path.exists(src_path):
        raise HTTPException(404, f"图库文件不存在: {source}")
    try:
        from PIL import Image
        img = Image.open(src_path)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        TW, TH = 100, 67
        sw, sh = img.size
        target_ratio = TW / TH
        src_ratio = sw / sh
        if src_ratio > target_ratio:
            new_w = int(sh * target_ratio)
            img = img.crop(((sw - new_w) // 2, 0, (sw + new_w) // 2, sh))
        else:
            new_h = int(sw / target_ratio)
            img = img.crop((0, (sh - new_h) // 2, sw, (sh + new_h) // 2))
        img = img.resize((TW, TH), Image.LANCZOS)
        dest_name = f"{uuid.uuid4().hex}.jpg"
        dest_path = os.path.join(WC_THUMB_DIR, dest_name)
        img.save(dest_path, "JPEG", quality=82)
    except ImportError:
        # Pillow 不可用时直接复制
        import shutil
        dest_name = f"{uuid.uuid4().hex}{os.path.splitext(source)[1] or '.jpg'}"
        dest_path = os.path.join(WC_THUMB_DIR, dest_name)
        shutil.copy2(src_path, dest_path)
    except Exception as e:
        raise HTTPException(500, f"文件处理失败: {str(e)}")
    _safe_remove_media(card["thumbnail"] if card else "", card["preview_media"] if card else "")
    db.execute("UPDATE word_card SET thumbnail=?, preview_media='', media_type='image', updated_at=datetime('now','localtime') WHERE id=?", [dest_name, card_id])
    safe_commit()
    return {"ok": True, "filename": dest_name, "source": source}


@router.post("/{card_id}/thumbnail")
async def upload_card_thumbnail(card_id: int, file: UploadFile = File(...)):
    """为词卡上传缩略图（自动裁剪为 100x67 JPEG）"""
    # Phase17: 先读文件再开DB — 避免 async await 断点持锁冲突
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"):
        raise HTTPException(400, "仅支持 jpg/png/gif/webp/bmp 格式")
    raw_data = await file.read()
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(raw_data))
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        TW, TH = 100, 67
        sw, sh = img.size
        target_ratio = TW / TH
        src_ratio = sw / sh
        if src_ratio > target_ratio:
            new_w = int(sh * target_ratio)
            img = img.crop(((sw - new_w) // 2, 0, (sw + new_w) // 2, sh))
        else:
            new_h = int(sw / target_ratio)
            img = img.crop((0, (sh - new_h) // 2, sw, (sh + new_h) // 2))
        img = img.resize((TW, TH), Image.LANCZOS)
        filename = f"{uuid.uuid4().hex}.jpg"
        dest = os.path.join(WC_THUMB_DIR, filename)
        img.save(dest, "JPEG", quality=82)
    except ImportError:
        raise HTTPException(500, "Pillow 未安装")
    except Exception as e:
        raise HTTPException(500, f"缩略图处理失败: {str(e)}")
    # DB 操作放在最后 — 无 async 断点，不会持锁等待
    db = get_db()
    card = safe_fetch_one("SELECT * FROM word_card WHERE id=?", [card_id])
    if not card:
        if os.path.exists(dest): os.remove(dest)
        raise HTTPException(404, "词卡不存在")
    _safe_remove_media(card["thumbnail"] if card else "", card["preview_media"] if card else "")
    db.execute("UPDATE word_card SET thumbnail=?, preview_media='', media_type='image', updated_at=datetime('now','localtime') WHERE id=?", [filename, card_id])
    safe_commit()
    return {"ok": True, "filename": filename}@router.delete("/{card_id}/thumbnail")
def delete_card_thumbnail(card_id: int):
    """删除词卡缩略图"""
    db = get_db()
    card = safe_fetch_one("SELECT thumbnail FROM word_card WHERE id=?", [card_id])
    if not card:
        raise HTTPException(404, "词卡不存在")
    if card["thumbnail"]:
        p = os.path.join(WC_THUMB_DIR, os.path.basename(card["thumbnail"]))
        if os.path.exists(p):
            os.remove(p)
        db.execute("UPDATE word_card SET thumbnail='', updated_at=datetime('now','localtime') WHERE id=?", [card_id])
        safe_commit()
    return {"ok": True}


@router.get("/thumbnails/{filename}")
def serve_card_thumbnail(filename: str):
    """返回词卡缩略图文件"""
    path = os.path.join(WC_THUMB_DIR, os.path.basename(filename))
    if not os.path.exists(path):
        raise HTTPException(404, "缩略图不存在")
    return FileResponse(path, media_type="image/jpeg")


@router.post("/{card_id}/video-from-library")
def copy_video_from_library(card_id: int, data: dict):
    """从视频库复制到词卡预览视频"""
    source = (data.get("source_filename") or "").strip()
    if not source:
        raise HTTPException(400, "请提供 source_filename")
    db = get_db()
    card = safe_fetch_one("SELECT * FROM word_card WHERE id=?", [card_id])
    if not card:
        raise HTTPException(404, "词卡不存在")
    # 源路径: data/videos/ or data/thumbnails/video/
    import shutil
    VIDEO_LIB_DIRS = [
        os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "videos"),
        os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "thumbnails", "videos"),
    ]
    src_path = None
    for d in VIDEO_LIB_DIRS:
        p = os.path.join(d, os.path.basename(source))
        if os.path.exists(p):
            src_path = p
            break
    if not src_path:
        raise HTTPException(404, f"视频文件不存在: {source}")
    dest_name = f"{uuid.uuid4().hex}{os.path.splitext(source)[1] or '.mp4'}"
    dest_path = os.path.join(WC_VIDEO_DIR, dest_name)
    shutil.copy2(src_path, dest_path)
    _safe_remove_media(card["thumbnail"] if card else "", card["preview_media"] if card else "")
    db.execute("UPDATE word_card SET thumbnail='', preview_media=?, media_type='video', updated_at=datetime('now','localtime') WHERE id=?", [dest_name, card_id])
    safe_commit()
    return {"ok": True, "filename": dest_name, "source": source}


@router.post("/{card_id}/video")
async def upload_card_video(card_id: int, file: UploadFile = File(...)):
    """为词卡上传预览视频（mp4/webm/mov，最大50MB）"""
    # Phase17: 先读文件再开DB — 避免 async await 断点持锁冲突
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".mp4", ".webm", ".mov"):
        raise HTTPException(400, "仅支持 mp4/webm/mov 格式")
    raw_data = await file.read()
    if len(raw_data) > 50 * 1024 * 1024:
        raise HTTPException(400, "视频不能超过50MB")
    filename = f"{uuid.uuid4().hex}{ext}"
    dest = os.path.join(WC_VIDEO_DIR, filename)
    with open(dest, "wb") as f:
        f.write(raw_data)
    # DB 操作放在最后 — 无 async 断点，不会持锁等待
    db = get_db()
    card = safe_fetch_one("SELECT * FROM word_card WHERE id=?", [card_id])
    if not card:
        if os.path.exists(dest): os.remove(dest)
        raise HTTPException(404, "词卡不存在")
    _safe_remove_media(card["thumbnail"] if card else "", card["preview_media"] if card else "")
    db.execute("UPDATE word_card SET thumbnail='', preview_media=?, media_type='video', updated_at=datetime('now','localtime') WHERE id=?", [filename, card_id])
    safe_commit()
    return {"ok": True, "filename": filename}


@router.delete("/{card_id}/video")
def delete_card_video(card_id: int):
    """删除词卡预览视频"""
    db = get_db()
    card = safe_fetch_one("SELECT preview_media FROM word_card WHERE id=?", [card_id])
    if not card:
        raise HTTPException(404, "词卡不存在")
    if card["preview_media"]:
        p = os.path.join(WC_VIDEO_DIR, os.path.basename(card["preview_media"]))
        if os.path.exists(p):
            os.remove(p)
        db.execute("UPDATE word_card SET preview_media='', updated_at=datetime('now','localtime') WHERE id=?", [card_id])
        safe_commit()
    return {"ok": True}


@router.get("/videos/{filename}")
def serve_card_video(filename: str):
    """返回词卡预览视频文件（支持Range请求）"""
    path = os.path.join(WC_VIDEO_DIR, os.path.basename(filename))
    if not os.path.exists(path):
        raise HTTPException(404, "视频不存在")
    ext = os.path.splitext(filename)[1].lower()
    media_map = {".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime"}
    return FileResponse(path, media_type=media_map.get(ext, "video/mp4"))


# ==================== 单条 CRUD (动态路径 — 必须放在媒体端点之后) ====================

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

# ==================== P0-3: 版本管理 ====================

def _ensure_version_table(db):
    db.execute("""
        CREATE TABLE IF NOT EXISTS word_card_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            card_id INTEGER NOT NULL,
            version INTEGER NOT NULL,
            snapshot TEXT NOT NULL,
            changed_fields TEXT DEFAULT '',
            editor TEXT DEFAULT 'manual',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (card_id) REFERENCES word_card(id)
        )
    """)
    db.execute("CREATE INDEX IF NOT EXISTS idx_wcv_card ON word_card_versions(card_id)")


def _save_version_snapshot(db, card_id: int):
    """保存当前词卡完整快照作为版本记录"""
    _ensure_version_table(db)
    row = db.execute("SELECT * FROM word_card WHERE id=?", [card_id]).fetchone()
    if not row:
        return
    data = dict(row)
    snapshot = json.dumps(data, ensure_ascii=False, default=str)
    ver = data.get("version", 1)
    db.execute(
        "INSERT INTO word_card_versions (card_id, version, snapshot, editor) VALUES (?,?,?,?)",
        [card_id, ver, snapshot, "manual"]
    )
    # 保留最近 20 个版本
    db.execute("""
        DELETE FROM word_card_versions WHERE card_id=?
        AND id NOT IN (
            SELECT id FROM word_card_versions WHERE card_id=?
            ORDER BY id DESC LIMIT 20
        )
    """, [card_id, card_id])


@router.get("/{card_id}/versions")
def get_card_versions(card_id: int):
    """获取词卡版本历史"""
    db = get_db()
    _ensure_version_table(db)
    current = db.execute("SELECT id, version FROM word_card WHERE id=?", [card_id]).fetchone()
    if not current:
        raise HTTPException(404, "词卡不存在")
    rows = db.execute(
        "SELECT id, card_id, version, editor, changed_fields, created_at FROM word_card_versions WHERE card_id=? ORDER BY id DESC",
        [card_id]
    ).fetchall()
    versions = []
    for r in rows:
        v = dict(r)
        v["is_current"] = v["version"] == current["version"]
        versions.append(v)
    return {"ok": True, "card_id": card_id, "current_version": current["version"], "versions": versions, "total": len(versions)}


@router.get("/{card_id}/versions/{ver_id}")
def get_version_detail(card_id: int, ver_id: int):
    """获取某个版本快照的详细内容"""
    db = get_db()
    row = db.execute("SELECT * FROM word_card_versions WHERE id=? AND card_id=?", [ver_id, card_id]).fetchone()
    if not row:
        raise HTTPException(404, "版本不存在")
    snapshot = json.loads(row["snapshot"])
    return {"ok": True, "card_id": card_id, "version_id": ver_id, "snapshot": snapshot}


@router.post("/{card_id}/rollback")
def rollback_card(card_id: int, data: dict):
    """回滚到指定版本"""
    ver_id = data.get("version_id")
    if not ver_id:
        raise HTTPException(400, "请提供 version_id")
    db = get_db()
    row = db.execute("SELECT * FROM word_card_versions WHERE id=? AND card_id=?", [ver_id, card_id]).fetchone()
    if not row:
        raise HTTPException(404, "版本不存在")
    snapshot = json.loads(row["snapshot"])
    _save_version_snapshot(db, card_id)
    fields = ["name", "content", "meaning", "scene", "module", "category", "tags", "icon", "group_id", "sort_order", "card_role", "structured"]
    for k in fields:
        if k in snapshot and snapshot[k] is not None:
            db.execute(f"UPDATE word_card SET {k}=?, updated_at=datetime('now','localtime'), version=version+1 WHERE id=?", [snapshot[k], card_id])
    safe_commit()
    return {"ok": True, "card_id": card_id, "rolled_to_version": row["version"]}


@router.put("/{card_id}")
def update_card(card_id: int, data: dict):
    db = get_db()
    if not db.execute("SELECT id FROM word_card WHERE id=?", [card_id]).fetchone():
        raise HTTPException(404,"词卡不存在")
    _save_version_snapshot(db, card_id)
    fields = []; params = []
    for k in ["name","content","meaning","scene","module","category","icon","thumbnail","preview_media","media_type","group_id","sort_order","card_role"]:
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
    # Phase17: 统一软删除 — 非内置词卡也不物理删除，防止数据丢失
    db.execute("UPDATE word_card SET is_deleted=1,deleted_at=datetime('now','localtime') WHERE id=?", [card_id])
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
    total = safe_count_dict(f"SELECT COUNT(*) as c FROM word_card wc WHERE {w}", params, key="c")
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
    card_role = data.get('card_role', 'custom')
    db.execute("INSERT INTO word_card (group_id,name,content,meaning,scene,module,category,tags,icon,thumbnail,preview_media,media_type,structured,card_role,sort_order,is_builtin,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'{}',?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM word_card WHERE group_id=?),0,'manual')",
               [gid,(data.get("name") or content)[:60],content,data.get("meaning",""),data.get("scene",""),data.get("module","custom"),data.get("category",""),json.dumps(data.get("tags",[]),ensure_ascii=False),data.get("icon",""),data.get("thumbnail",""),data.get("preview_media",""),data.get("media_type","image"),card_role,gid])
    safe_commit()
    cid = safe_count("SELECT last_insert_rowid()")
    try: from semantic import update_embedding; update_embedding(cid, content)
    except: pass
    return {"ok":True,"id":cid}

# ==================== 导出/导入 (Phase13.1) ====================

@router.post("/export")
def export_cards(data: dict):
    """导出词卡为 CSV/JSON 格式"""
    fmt = data.get("format", "json")
    ids = data.get("ids", [])
    group_id = data.get("group_id")
    db = get_db()
    where = ["wc.is_deleted=0"]
    params = []
    if ids:
        ph = ",".join("?" * len(ids))
        where.append(f"wc.id IN ({ph})")
        params.extend(ids)
    if group_id:
        where.append("wc.group_id=?")
        params.append(group_id)
    w = " AND ".join(where)
    rows = db.execute(f"SELECT wc.*,wg.name as group_name,wg.group_key FROM word_card wc LEFT JOIN word_card_group wg ON wg.id=wc.group_id WHERE {w} ORDER BY wc.group_id,wc.sort_order", params).fetchall()
    items = []
    for r in rows:
        it = dict(r)
        try: it["tags"] = json.loads(it["tags"]) if isinstance(it["tags"], str) else (it["tags"] or [])
        except: it["tags"] = []
        items.append(it)
    if fmt == "csv":
        import csv, io
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["id","group_id","group_name","name","content","meaning","tags","module"])
        for it in items:
            writer.writerow([it["id"],it["group_id"],it.get("group_name",""),it["name"],it["content"],it["meaning"],json.dumps(it.get("tags",[]),ensure_ascii=False),it["module"]])
        return Response(output.getvalue(), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": "attachment; filename=word_cards.csv"})
    return {"ok": True, "items": items, "total": len(items)}


@router.post("/import")
async def import_cards(file: UploadFile = File(...)):
    """从 CSV/JSON 文件导入词卡"""
    content = await file.read()
    ext = os.path.splitext(file.filename or "")[1].lower()
    db = get_db()
    count = 0
    errors = []
    if ext == ".json":
        try:
            data = json.loads(content)
            items = data if isinstance(data, list) else data.get("items", [])
        except Exception as e:
            raise HTTPException(400, f"JSON 解析失败: {e}")
        for it in items:
            try:
                gid = it.get("group_id")
                if not gid:
                    errors.append(f"第{count+1}条缺少group_id，跳过")
                    continue
                max_sort = db.execute("SELECT COALESCE(MAX(sort_order),0) FROM word_card WHERE group_id=?", [gid]).fetchone()[0]
                db.execute("INSERT INTO word_card (group_id,name,content,meaning,tags,module,is_builtin,sort_order) VALUES (?,?,?,?,?,?,0,?)",
                          [gid, (it.get("name") or it.get("content",""))[:60], it.get("content",""), it.get("meaning",""),
                           json.dumps(it.get("tags",[]), ensure_ascii=False), it.get("module","custom"), max_sort+1])
                count += 1
            except Exception as e:
                errors.append(f"第{count+1}条导入失败: {e}")
    elif ext == ".csv":
        import csv, io
        try:
            reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig")))
            for row in reader:
                try:
                    gid = int(row.get("group_id", 0))
                    if not gid:
                        errors.append(f"第{count+1}行缺少group_id，跳过")
                        continue
                    max_sort = db.execute("SELECT COALESCE(MAX(sort_order),0) FROM word_card WHERE group_id=?", [gid]).fetchone()[0]
                    db.execute("INSERT INTO word_card (group_id,name,content,meaning,tags,module,is_builtin,sort_order) VALUES (?,?,?,?,?,?,0,?)",
                              [gid, (row.get("name") or row.get("content",""))[:60], row.get("content",""), row.get("meaning",""),
                               row.get("tags","[]"), row.get("module","custom"), max_sort+1])
                    count += 1
                except Exception as e:
                    errors.append(f"第{count+1}行导入失败: {e}")
        except Exception as e:
            raise HTTPException(400, f"CSV 解析失败: {e}")
    else:
        raise HTTPException(400, "仅支持 .json 和 .csv 格式")
    safe_commit()
    return {"ok": True, "imported": count, "errors": errors[:20], "total_errors": len(errors)}


@router.put("/reorder")
def reorder_cards(data: dict):
    """批量重排词卡顺序"""
    order = data.get("order", [])
    if not order: raise HTTPException(400, "缺少 order 列表")
    db = get_db()
    for idx, cid in enumerate(order):
        db.execute("UPDATE word_card SET sort_order=?,updated_at=datetime('now','localtime') WHERE id=?", [idx, cid])
    safe_commit()
    return {"ok": True, "updated": len(order)}


# ==================== 辅助 ====================

def _fts_search(db, query: str) -> list:
    try:
        safe = ' AND '.join(f'"{w}"' for w in query.split() if len(w) >= 2)
        if not safe: safe = query
        return [r["rowid"] for r in db.execute("SELECT rowid FROM word_card_fts WHERE word_card_fts MATCH ? LIMIT 100", [safe]).fetchall()]
    except: return []
