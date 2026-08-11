"""
Seedance V2 词库管理模块（Phase 3.5 自 api/seedance_v2.py 拆分）
27套维度词库 / 词卡 / 自定义词 / 缩略图与视频管理。
路由挂载: 主模块 router.include_router(seedance_v2_library_router)，prefix 同为 /api/seedance/v2
"""
import os
import uuid

from fastapi import APIRouter, Body, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from database import get_db, safe_commit

router = APIRouter(tags=["seedance-v2-library"])

# 词卡缩略图存储目录
WC_THUMB_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "data", "wc_media", "thumbs"
)
os.makedirs(WC_THUMB_DIR, exist_ok=True)

# 词库 AI 缩略图目录（批量生成链路写入 data/thumbnails/）
AI_THUMB_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "data", "thumbnails"
)

# 词卡视频存储目录（统一到 wc_media）
WC_VIDEO_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "data", "wc_media", "videos"
)
os.makedirs(WC_VIDEO_DIR, exist_ok=True)


# ==================== 词库接口 (27套) ====================


def _attach_wc_thumbnail(db, card: dict) -> dict:
    """为 prompt_word_card 记录附加词库缩略图（wc_thumbnail）
    2026-08-11: 批量生成缩略图写入 word_card.thumbnail（新表），分镜组装器读旧表
    prompt_word_card 时无此图（旧 preview_image 文件多已丢失）→ 回退：
      1) word_text 与 word_card.name/content 精确匹配（词库中同名词卡 = 用户看到的图）
      2) seedance_id_map(old→new) 映射兜底
    仅接受文件真实存在的缩略图（避免返回 404 的旧文件）。
    """
    if card.get("wc_thumbnail"):
        return card
    thumb = ""
    wt = (card.get("word_text") or "").strip()
    cid = card.get("id")

    def _pick(fname):
        """只接受文件真实存在的词库缩略图（防旧文件已丢失导致 404）"""
        if not fname:
            return ""
        try:
            if os.path.exists(os.path.join(AI_THUMB_DIR, fname)) or os.path.exists(os.path.join(WC_THUMB_DIR, fname)):
                return fname
        except Exception:
            pass
        return ""

    if wt:
        try:
            m = db.execute(
                "SELECT thumbnail FROM word_card WHERE is_deleted=0 AND name=? AND thumbnail!='' LIMIT 1",
                [wt]).fetchone()
            if m:
                thumb = _pick(m["thumbnail"])
            if not thumb:
                m2 = db.execute(
                    "SELECT thumbnail FROM word_card WHERE is_deleted=0 AND content=? AND thumbnail!='' LIMIT 1",
                    [wt]).fetchone()
                if m2:
                    thumb = _pick(m2["thumbnail"])
        except Exception:
            thumb = ""
    if not thumb and cid is not None:
        try:
            m3 = db.execute(
                "SELECT nw.thumbnail FROM seedance_id_map m JOIN word_card nw ON nw.id=m.new_id "
                "WHERE m.old_id=? AND nw.is_deleted=0 AND nw.thumbnail!='' LIMIT 1", [cid]).fetchone()
            if m3:
                thumb = _pick(m3["thumbnail"])
        except Exception:
            thumb = ""
    card["wc_thumbnail"] = thumb
    return card


@router.get("/libraries")
def list_libraries(category: str = Query(None)):
    """获取所有维度词库列表（含子组卡片递归统计）"""
    db = get_db()
    if category:
        rows = db.execute(
            "SELECT * FROM prompt_library WHERE category=? ORDER BY sort_order",
            [category]
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM prompt_library ORDER BY sort_order").fetchall()

    result = []
    for r in rows:
        card_count = db.execute(
            "SELECT COUNT(*) as cnt FROM prompt_word_card WHERE library_id=?",
            [r["id"]]
        ).fetchone()["cnt"]
        # Phase20 兼容：父容器组（global_style/global_negative）自身无卡片，
        # 递归统计其子组 word_card 数量
        if card_count == 0:
            child_count = db.execute("""
                SELECT COUNT(*) as cnt FROM word_card wc
                INNER JOIN word_card_group wcg ON wc.group_id = wcg.id
                WHERE wcg.parent_group_id = ? AND wc.is_deleted = 0
            """, [r["id"]]).fetchone()["cnt"]
            card_count = child_count
        result.append({**dict(r), "card_count": card_count})
    return {"libraries": result}


@router.get("/libraries/{lib_id}")
def get_library(lib_id: int):
    """获取单个词库详情"""
    db = get_db()
    lib = db.execute("SELECT * FROM prompt_library WHERE id=?", [lib_id]).fetchone()
    if not lib:
        raise HTTPException(404, "词库不存在")
    return {"library": dict(lib)}


@router.get("/libraries/{lib_id}/cards")
def list_cards(
    lib_id: int,
    search: str = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    recommend: int = Query(0)  # 1=按热度推荐排序
):
    """获取词库下的所有词卡（支持搜索+分页+AI推荐排序）"""
    db = get_db()
    lib = db.execute("SELECT * FROM prompt_library WHERE id=?", [lib_id]).fetchone()
    if not lib:
        raise HTTPException(404, "词库不存在")

    params = [lib_id]
    sql_where = " AND wc.library_id=?"

    if search:
        like = f"%{search}%"
        sql_where += " AND (wc.word_text LIKE ? OR wc.definition LIKE ?)"
        params += [like, like]

    # 统计总数
    total = db.execute(
        f"SELECT COUNT(*) as cnt FROM prompt_word_card wc WHERE 1=1{sql_where}",
        params
    ).fetchone()["cnt"]

    # 排序：推荐模式按热度权重，否则按ID
    order = "ORDER BY wc.heat_weight DESC, wc.usage_count DESC, wc.id ASC" if recommend else "ORDER BY wc.id ASC"

    offset = (page - 1) * page_size
    rows = db.execute(
        f"SELECT wc.* FROM prompt_word_card wc WHERE 1=1{sql_where} {order} LIMIT ? OFFSET ?",
        params + [page_size, offset]
    ).fetchall()

    # 2026-08-11: 附加词库缩略图（wc_thumbnail）——分镜组装器与词库预览图保持一致
    # 批量生成缩略图写入 word_card.thumbnail（新表），prompt_word_card 无此图，
    # 通过 seedance_id_map / 名称匹配回退，使选择词卡时显示与词库相同的预览图
    items = []
    for r in rows:
        items.append(_attach_wc_thumbnail(db, dict(r)))

    return {
        "library": dict(lib),
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "items": items
    }


@router.get("/cards/{card_id}")
def get_card(card_id: int):
    """获取单张词卡详情"""
    db = get_db()
    card = db.execute(
        "SELECT wc.*, pl.dimension_name, pl.dimension_key FROM prompt_word_card wc "
        "LEFT JOIN prompt_library pl ON pl.id=wc.library_id WHERE wc.id=?",
        [card_id]
    ).fetchone()
    if not card:
        raise HTTPException(404, "词卡不存在")
    d = dict(card)
    d = _attach_wc_thumbnail(db, d)
    return {"card": d}


# ==================== 词卡缩略图 ====================

def _resolve_card_id(db, card_id: int):
    """解析前端传入的card_id: 可能是VIEW的old_id或word_card真实new_id"""
    # 先查 seedance_id_map (old→new)
    m = db.execute("SELECT new_id FROM seedance_id_map WHERE old_id=?", [card_id]).fetchone()
    if m:
        return m["new_id"]
    # 再查 seedance_id_map 反向 (new→old, 前端直接传了真实ID)
    m2 = db.execute("SELECT new_id FROM seedance_id_map WHERE new_id=?", [card_id]).fetchone()
    if m2:
        return m2["new_id"]
    # 都不是→直接查 word_card 有无此ID
    row = db.execute("SELECT id FROM word_card WHERE id=? AND is_deleted=0", [card_id]).fetchone()
    return row["id"] if row else None


@router.post("/cards/{card_id}/thumbnail")
async def upload_word_card_thumbnail(card_id: int, file: UploadFile = File(...)):
    """为词卡上传缩略图（自动裁剪为 100x67 JPEG）"""
    db = get_db()
    resolved = _resolve_card_id(db, card_id)
    if not resolved:
        raise HTTPException(404, "词卡不存在")
    card_id = resolved
    card = db.execute("SELECT * FROM word_card WHERE id=?", [card_id]).fetchone()
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"):
        raise HTTPException(400, "仅支持 jpg/png/gif/webp/bmp 格式")
    try:
        import io

        from PIL import Image
        data = await file.read()
        img = Image.open(io.BytesIO(data))
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
    if card["thumbnail"]:
        old_path = os.path.join(WC_THUMB_DIR, card["thumbnail"])
        if os.path.exists(old_path):
            os.remove(old_path)
    # 若已有视频预览，一并清除（图片替换视频）
    if card["preview_media"]:
        old_v = os.path.join(WC_VIDEO_DIR, card["preview_media"])
        if os.path.exists(old_v):
            os.remove(old_v)
    db.execute("UPDATE word_card SET thumbnail=?, preview_media='' WHERE id=?", [filename, card_id])
    safe_commit()
    return {"ok": True, "filename": filename}


@router.delete("/cards/{card_id}/thumbnail")
def delete_word_card_thumbnail(card_id: int):
    """删除词卡缩略图"""
    db = get_db()
    card = db.execute("SELECT thumbnail FROM word_card WHERE id=?", [card_id]).fetchone()
    if not card:
        resolved = _resolve_card_id(db, card_id)
        if not resolved:
            raise HTTPException(404, "词卡不存在")
        card = db.execute("SELECT thumbnail FROM word_card WHERE id=?", [resolved]).fetchone()
        if card:
            card_id = resolved
    if card and card["thumbnail"]:
        path = os.path.join(WC_THUMB_DIR, card["thumbnail"])
        if os.path.exists(path):
            os.remove(path)
        db.execute("UPDATE word_card SET thumbnail='' WHERE id=?", [card_id])
        safe_commit()
    return {"ok": True}


@router.get("/thumbnails/{filename}")
def serve_word_card_thumbnail(filename: str):
    """返回词卡缩略图文件
    2026-08-11 增强: 优先 wc_media/thumbs(手动预览), 缺失时回退 data/thumbnails(词库 AI 缩略图),
    兼容悬停预览等旧调用点直接显示批量生成的词库预览图。"""
    base = os.path.basename(filename)  # 防目录穿越
    p1 = os.path.join(WC_THUMB_DIR, base)
    if os.path.exists(p1):
        return FileResponse(p1, media_type="image/jpeg")
    p2 = os.path.join(AI_THUMB_DIR, base)
    if os.path.exists(p2):
        return FileResponse(p2, media_type="image/jpeg")
    raise HTTPException(404, "缩略图不存在")


# ==================== 词卡视频预览 ====================

@router.post("/cards/{card_id}/video")
async def upload_word_card_video(card_id: int, file: UploadFile = File(...)):
    """为词卡上传预览视频（mp4/webm/mov，最大50MB）"""
    db = get_db()
    resolved = _resolve_card_id(db, card_id)
    if not resolved:
        raise HTTPException(404, "词卡不存在")
    card_id = resolved
    card = db.execute("SELECT * FROM word_card WHERE id=?", [card_id]).fetchone()
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".mp4", ".webm", ".mov"):
        raise HTTPException(400, "仅支持 mp4/webm/mov 格式")
    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(400, "视频不能超过50MB")
    filename = f"{uuid.uuid4().hex}{ext}"
    dest = os.path.join(WC_VIDEO_DIR, filename)
    with open(dest, "wb") as f:
        f.write(data)
    # 删除旧视频
    if card["preview_media"]:
        old_path = os.path.join(WC_VIDEO_DIR, card["preview_media"])
        if os.path.exists(old_path):
            os.remove(old_path)
    # 若已有图片预览，一并清除（视频替换图片）
    if card["thumbnail"]:
        old_i = os.path.join(WC_THUMB_DIR, card["thumbnail"])
        if os.path.exists(old_i):
            os.remove(old_i)
    db.execute("UPDATE word_card SET preview_media=?, thumbnail='' WHERE id=?", [filename, card_id])
    safe_commit()
    return {"ok": True, "filename": filename}


@router.delete("/cards/{card_id}/video")
def delete_word_card_video(card_id: int):
    """删除词卡预览视频"""
    db = get_db()
    card = db.execute("SELECT preview_media FROM word_card WHERE id=?", [card_id]).fetchone()
    if not card:
        resolved = _resolve_card_id(db, card_id)
        if not resolved:
            raise HTTPException(404, "词卡不存在")
        card = db.execute("SELECT preview_media FROM word_card WHERE id=?", [resolved]).fetchone()
        if card:
            card_id = resolved
    if card and card["preview_media"]:
        path = os.path.join(WC_VIDEO_DIR, card["preview_media"])
        if os.path.exists(path):
            os.remove(path)
        db.execute("UPDATE word_card SET preview_media='' WHERE id=?", [card_id])
        safe_commit()
    return {"ok": True}


@router.get("/videos/{filename}")
def serve_word_card_video(filename: str):
    """返回词卡预览视频文件（支持Range请求）"""
    path = os.path.join(WC_VIDEO_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(404, "视频不存在")
    ext = os.path.splitext(filename)[1].lower()
    mime = {".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime"}.get(ext, "video/mp4")
    return FileResponse(path, media_type=mime)

@router.post("/cards/{card_id}/video-from-library")
def copy_word_card_video_from_library(card_id: int, data: dict = Body(...)):
    """从视频库选取视频复制到词卡预览"""
    source = (data.get("source_filename") or "").strip()
    if not source:
        raise HTTPException(400, "请提供 source_filename")
    import shutil
    db = get_db()
    # 必须通过 seedance_id_map 映射：前端传入的是 VIEW id (prompt_word_card.id)
    # 先解析到 word_card 真实 ID（与其他端点逻辑一致）
    resolved = _resolve_card_id(db, card_id)
    if resolved:
        card_id = resolved
    card = db.execute("SELECT * FROM word_card WHERE id=?", [card_id]).fetchone()
    if not card:
        raise HTTPException(404, "词卡不存在")
    # 源路径搜索
    VIDEO_LIB_DIRS = [
        os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "videos"),
        os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "thumbnails", "videos"),
        WC_VIDEO_DIR,
    ]
    src_path = None
    for d in VIDEO_LIB_DIRS:
        p = os.path.join(d, os.path.basename(source))
        if os.path.exists(p):
            src_path = p
            break
    if not src_path:
        raise HTTPException(404, "源视频文件不存在")
    # 复制到词卡视频目录
    ext = os.path.splitext(source)[1]
    dest_name = f"{uuid.uuid4().hex}{ext}"
    dest_path = os.path.join(WC_VIDEO_DIR, dest_name)
    shutil.copy2(src_path, dest_path)
    # 清除旧缩略图 + 更新视频
    if card["thumbnail"]:
        old_i = os.path.join(WC_THUMB_DIR, card["thumbnail"])
        if os.path.exists(old_i):
            os.remove(old_i)
    if card["preview_media"]:
        old_v = os.path.join(WC_VIDEO_DIR, card["preview_media"])
        if os.path.exists(old_v):
            os.remove(old_v)
    # 提取首帧封面（异步不阻塞主线程）
    poster_name = ""
    try:
        import subprocess
        poster_name = f"{uuid.uuid4().hex}.jpg"
        poster_path = os.path.join(WC_THUMB_DIR, poster_name)
        subprocess.run(
            ['ffmpeg', '-ss', '0.1', '-i', dest_path, '-vframes', '1', '-q:v', '2', poster_path, '-y'],
            capture_output=True, timeout=60,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
        )
        if not os.path.exists(poster_path):
            poster_name = ""
    except Exception:
        poster_name = ""
    db.execute("UPDATE word_card SET preview_media=?, thumbnail=? WHERE id=?", [dest_name, poster_name, card_id])
    safe_commit()
    return {"ok": True, "video_filename": dest_name, "poster_filename": poster_name}


# ==================== 镜头改造归档 (v5.36.0) ====================

# 字段 → 中文标签（与前端 _F 一致）
_SCENE_FIELD_LABELS = {
    'camera_move': '运镜', 'subject': '主体', 'scene_desc': '场景', 'composition': '构图',
    'lighting': '光影', 'action': '动作', 'focal_length': '焦段', 'texture': '质感',
    'speed': '速率', 'emotion': '情绪', 'color_grade': '调色', 'weather': '天气',
    'particles': '粒子', 'perspective': '视角', 'depth_of_field': '景深', 'filter': '滤镜',
    'natural_force': '外力', 'environment_detail': '环境', 'film_flaw': '瑕疵',
    'fantasy_physics': '奇幻', 'character_voice': '角色旁白', 'bgm': 'BGM', 'sfx': '音效',
}
# 字段 → 词库 dimension_key 映射（与前端 _fieldToDim 一致）
_SCENE_FIELD_TO_DIM = {
    'scene_desc': 'scene', 'environment_detail': 'env_detail',
    'character_voice': 'audio_char_narr', 'bgm': 'audio_bgm', 'sfx': 'audio_sfx',
}


@router.post("/scenes/archive")
def archive_scene_fields(data: dict = Body(...)):
    """镜头编辑模式改造归档：将编辑后的字段内容存为词卡

    body: {
      items: [{field, value}],        # 要归档的字段与内容
      target_lib_id: int|None,        # 指定目标词库（优先）
      new_group_name: str|None,       # 或新建自定义分组（二者填一，new_group 优先）
      definition: str                 # 释义/备注（可选）
    }
    查重规则: 同词库 + 同 word_text 已存在 → 跳过
    """
    items = data.get("items") or []
    target_lib_id = data.get("target_lib_id")
    new_group_name = (data.get("new_group_name") or "").strip()
    definition = (data.get("definition") or "").strip()
    if not items:
        raise HTTPException(400, "items 必填")

    db = get_db()
    lib_id = None
    new_lib_id = None

    # 1) 确定目标词库
    if new_group_name:
        # 新建自定义分组（或复用同名）— prompt_library 是 VIEW，直接写真实表 word_card_group
        existing = db.execute(
            "SELECT id FROM word_card_group WHERE name=? AND group_type='seedance' AND seedance_subtype='custom' AND is_active=1",
            [new_group_name]
        ).fetchone()
        if existing:
            lib_id = existing["id"]
        else:
            import time
            key = "custom_" + str(int(time.time() * 1000))
            cur = db.execute(
                "INSERT INTO word_card_group (name, group_key, group_type, seedance_subtype, description, sort_order) "
                "VALUES (?, ?, 'seedance', 'custom', ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM word_card_group))",
                [new_group_name, key, new_group_name]
            )
            lib_id = cur.lastrowid
            new_lib_id = lib_id
    elif target_lib_id:
        lib_id = int(target_lib_id)
        lib = db.execute("SELECT id FROM prompt_library WHERE id=?", [lib_id]).fetchone()
        if not lib:
            raise HTTPException(404, "目标词库不存在")
    else:
        # 自动按字段匹配维度词库
        field = items[0].get("field", "")
        dim = _SCENE_FIELD_TO_DIM.get(field, field)
        lib = db.execute("SELECT id FROM prompt_library WHERE dimension_key=?", [dim]).fetchone()
        if not lib:
            raise HTTPException(400, f"字段 {field} 无对应维度词库，请选择目标词库或新建分组")
        lib_id = lib["id"]

    # 2) 逐条写入词卡（查重跳过）
    saved, skipped = 0, 0
    for item in items:
        wt = (item.get("value") or "").strip()
        if not wt:
            continue
        field = item.get("field", "")
        dup = db.execute(
            "SELECT id FROM word_card WHERE group_id=? AND content=? AND is_deleted=0",
            [lib_id, wt]
        ).fetchone()
        if dup:
            skipped += 1
            continue
        label = _SCENE_FIELD_LABELS.get(field, field)
        note = definition
        if not note:
            note = f"[改造自: {label}]"
        elif definition:
            note = f"{definition} [改造自: {label}]"
        db.execute(
            "INSERT INTO word_card (group_id, content, meaning, is_builtin, heat_weight, module, category) "
            "VALUES (?, ?, ?, 0, 0.5, 'seedance_v2', 'seedance_v2')",
            [lib_id, wt, note]
        )
        db.execute(
            "INSERT INTO user_custom_word (library_id, word_text, definition) VALUES (?, ?, ?)",
            [lib_id, wt, note]
        )
        saved += 1

    safe_commit()
    return {
        "ok": True,
        "saved": saved,
        "skipped": skipped,
        "lib_id": lib_id,
        "new_lib_id": new_lib_id,
        "lib_ids": [lib_id],
    }


# ==================== 自定义词库管理 ====================

@router.post("/libraries")
def create_library(data: dict = Body(...)):
    """创建自定义分组词库"""
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name 必填")
    import time
    key = "custom_" + str(int(time.time() * 1000))
    db = get_db()
    # 检查同名（prompt_library 是 VIEW，真实表为 word_card_group）
    existing = db.execute(
        "SELECT id FROM word_card_group WHERE name=? AND group_type='seedance' AND seedance_subtype='custom' AND is_active=1",
        [name]
    ).fetchone()
    if existing:
        raise HTTPException(400, "同名自定义分组已存在")
    cur = db.execute(
        "INSERT INTO word_card_group (name, group_key, group_type, seedance_subtype, description, sort_order) VALUES (?, ?, 'seedance', 'custom', ?, "
        "(SELECT COALESCE(MAX(sort_order),0)+1 FROM word_card_group))",
        [name, key, name]
    )
    safe_commit()
    return {"ok": True, "id": cur.lastrowid, "dimension_key": key}


@router.delete("/libraries/{lib_id}")
def delete_library(lib_id: int):
    """删除自定义分组词库（仅限 custom 类型）"""
    db = get_db()
    lib = db.execute("SELECT * FROM word_card_group WHERE id=? AND group_type='seedance' AND seedance_subtype='custom' AND is_active=1", [lib_id]).fetchone()
    if not lib:
        raise HTTPException(404, "自定义分组不存在或不可删除")
    # 删除关联词卡（真实表 word_card；prompt_word_card 是 VIEW 不可 DELETE）
    db.execute("DELETE FROM word_card WHERE group_id=?", [lib_id])
    db.execute("DELETE FROM user_custom_word WHERE library_id=?", [lib_id])
    db.execute("UPDATE word_card_group SET is_active=0, updated_at=datetime('now','localtime') WHERE id=?", [lib_id])
    safe_commit()
    return {"ok": True}


@router.put("/libraries/{lib_id}")
def rename_library(lib_id: int, data: dict = Body(...)):
    """重命名自定义分组（仅限 custom 类型）"""
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name 必填")
    db = get_db()
    lib = db.execute("SELECT * FROM word_card_group WHERE id=? AND group_type='seedance' AND seedance_subtype='custom' AND is_active=1", [lib_id]).fetchone()
    if not lib:
        raise HTTPException(404, "自定义分组不存在或不可编辑")
    db.execute("UPDATE word_card_group SET name=?, updated_at=datetime('now','localtime') WHERE id=?", [name, lib_id])
    safe_commit()
    return {"ok": True}


@router.put("/cards/{card_id}")
def update_card(card_id: int, data: dict = Body(...)):
    """编辑自定义词条（仅限 is_system=0）"""
    db = get_db()
    resolved = _resolve_card_id(db, card_id)
    if not resolved:
        raise HTTPException(404, "词条不存在或不可编辑")
    card_id = resolved
    card = db.execute("SELECT * FROM word_card WHERE id=? AND is_builtin=0", [card_id]).fetchone()
    if not card:
        raise HTTPException(404, "词条不存在或不可编辑")
    word_text = data.get("word_text", "").strip()
    definition = data.get("definition", "")
    if not word_text:
        raise HTTPException(400, "word_text 必填")
    db.execute("UPDATE word_card SET content=?, meaning=? WHERE id=?", [word_text, definition, card_id])
    safe_commit()
    return {"ok": True}


@router.delete("/cards/{card_id}")
def delete_card(card_id: int):
    """删除自定义词条（仅限 is_system=0）"""
    db = get_db()
    resolved = _resolve_card_id(db, card_id)
    if not resolved:
        raise HTTPException(404, "词条不存在或不可删除")
    card_id = resolved
    card = db.execute("SELECT * FROM word_card WHERE id=? AND is_builtin=0", [card_id]).fetchone()
    if not card:
        raise HTTPException(404, "词条不存在或不可删除")
    db.execute("UPDATE word_card SET is_deleted=1, deleted_at=datetime('now','localtime') WHERE id=?", [card_id])
    safe_commit()
    return {"ok": True}


@router.post("/libraries/{lib_id}/cards")
def create_library_card(lib_id: int, data: dict = Body(...)):
    """在指定词库中手动添加自定义词条"""
    word_text = (data.get("word_text") or "").strip()
    definition = data.get("definition", "")
    if not word_text:
        raise HTTPException(400, "word_text 必填")
    db = get_db()
    lib = db.execute("SELECT * FROM prompt_library WHERE id=?", [lib_id]).fetchone()
    if not lib:
        raise HTTPException(404, "词库不存在")
    # 写入词卡表（直接写 word_card，VIEW 不支持 lastrowid）
    db.execute(
        "INSERT INTO word_card (group_id, content, meaning, is_builtin, heat_weight, module, category) VALUES (?, ?, ?, 0, 0.5, 'seedance_v2', 'seedance_v2')",
        [lib_id, word_text, definition]
    )
    new_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    # 同时追加入自定义词条表
    db.execute(
        "INSERT INTO user_custom_word (library_id, word_text, definition) VALUES (?, ?, ?)",
        [lib_id, word_text, definition]
    )
    safe_commit()
    return {"ok": True, "id": new_id}


# ==================== 用户自定义词条 ====================

@router.get("/custom-words")
def list_custom_words(library_id: int = Query(None)):
    """获取用户自定义词条"""
    db = get_db()
    if library_id:
        rows = db.execute(
            "SELECT cw.*, pl.dimension_name FROM user_custom_word cw "
            "LEFT JOIN prompt_library pl ON pl.id=cw.library_id WHERE cw.library_id=? ORDER BY cw.id DESC",
            [library_id]
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT cw.*, pl.dimension_name FROM user_custom_word cw "
            "LEFT JOIN prompt_library pl ON pl.id=cw.library_id ORDER BY cw.id DESC"
        ).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("/custom-words")
def create_custom_word(data: dict = Body(...)):
    """创建用户自定义词条"""
    lib_id = data.get("library_id")
    word_text = data.get("word_text", "").strip()
    definition = data.get("definition", "")
    if not lib_id or not word_text:
        raise HTTPException(400, "library_id 和 word_text 必填")
    db = get_db()
    # 检查词库存在
    lib = db.execute("SELECT id FROM prompt_library WHERE id=?", [lib_id]).fetchone()
    if not lib:
        raise HTTPException(404, "词库不存在")
    db.execute(
        "INSERT INTO user_custom_word (library_id, word_text, definition) VALUES (?, ?, ?)",
        [lib_id, word_text, definition]
    )
    # 同时插入到词卡表方便检索（直接写 word_card）
    db.execute(
        "INSERT INTO word_card (group_id, content, meaning, is_builtin, heat_weight, module, category) VALUES (?, ?, ?, 0, 0.5, 'seedance_v2', 'seedance_v2')",
        [lib_id, word_text, definition]
    )
    new_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    safe_commit()
    return {"ok": True, "id": new_id}


@router.delete("/custom-words/{word_id}")
def delete_custom_word(word_id: int):
    """删除自定义词条"""
    db = get_db()
    row = db.execute("SELECT word_text, library_id FROM user_custom_word WHERE id=?", [word_id]).fetchone()
    if not row:
        raise HTTPException(404, "词条不存在")
    # 从词卡表也删除对应的自定义词条
    db.execute("DELETE FROM prompt_word_card WHERE library_id=? AND word_text=? AND is_system=0",
               [row["library_id"], row["word_text"]])
    db.execute("DELETE FROM user_custom_word WHERE id=?", [word_id])
    safe_commit()
    return {"ok": True}
