"""
API 路由 — Seedance V2 多镜头结构化组装器 (全功能版)
27套维度词库 / 分镜项目CRUD / 镜头管理 / 拼接引擎 / 联动
"""
import json, math, os, uuid
from fastapi import APIRouter, Query, Body, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from database import get_db, safe_commit
from seedance_v2_seed import init_seedance_v2_seed

router = APIRouter(prefix="/api/seedance/v2", tags=["seedance-v2"])

# 词卡缩略图存储目录
WC_THUMB_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "data", "wordcard_thumbs"
)
os.makedirs(WC_THUMB_DIR, exist_ok=True)

# 词卡视频存储目录
WC_VIDEO_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "data", "wordcard_videos"
)
os.makedirs(WC_VIDEO_DIR, exist_ok=True)


# ==================== 词库接口 (27套) ====================

@router.get("/libraries")
def list_libraries(category: str = Query(None)):
    """获取所有维度词库列表"""
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

    return {
        "library": dict(lib),
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "items": [dict(r) for r in rows]
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
    return {"card": dict(card)}


# ==================== 词卡缩略图 ====================

@router.post("/cards/{card_id}/thumbnail")
async def upload_word_card_thumbnail(card_id: int, file: UploadFile = File(...)):
    """为词卡上传缩略图（自动裁剪为 100x67 JPEG）"""
    db = get_db()
    card = db.execute("SELECT * FROM prompt_word_card WHERE id=?", [card_id]).fetchone()
    if not card:
        raise HTTPException(404, "词卡不存在")
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"):
        raise HTTPException(400, "仅支持 jpg/png/gif/webp/bmp 格式")
    try:
        from PIL import Image
        import io
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
    if card["preview_image"]:
        old_path = os.path.join(WC_THUMB_DIR, card["preview_image"])
        if os.path.exists(old_path):
            os.remove(old_path)
    # 若已有视频预览，一并清除（图片替换视频）
    if card["preview_video"]:
        old_v = os.path.join(WC_VIDEO_DIR, card["preview_video"])
        if os.path.exists(old_v):
            os.remove(old_v)
    db.execute("UPDATE prompt_word_card SET preview_image=?, preview_video='' WHERE id=?", [filename, card_id])
    safe_commit()
    return {"ok": True, "filename": filename}


@router.delete("/cards/{card_id}/thumbnail")
def delete_word_card_thumbnail(card_id: int):
    """删除词卡缩略图"""
    db = get_db()
    card = db.execute("SELECT preview_image FROM prompt_word_card WHERE id=?", [card_id]).fetchone()
    if not card:
        raise HTTPException(404, "词卡不存在")
    if card["preview_image"]:
        path = os.path.join(WC_THUMB_DIR, card["preview_image"])
        if os.path.exists(path):
            os.remove(path)
        db.execute("UPDATE prompt_word_card SET preview_image='' WHERE id=?", [card_id])
        safe_commit()
    return {"ok": True}


@router.get("/thumbnails/{filename}")
def serve_word_card_thumbnail(filename: str):
    """返回词卡缩略图文件"""
    path = os.path.join(WC_THUMB_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(404, "缩略图不存在")
    return FileResponse(path, media_type="image/jpeg")


# ==================== 词卡视频预览 ====================

@router.post("/cards/{card_id}/video")
async def upload_word_card_video(card_id: int, file: UploadFile = File(...)):
    """为词卡上传预览视频（mp4/webm/mov，最大50MB）"""
    db = get_db()
    card = db.execute("SELECT * FROM prompt_word_card WHERE id=?", [card_id]).fetchone()
    if not card:
        raise HTTPException(404, "词卡不存在")
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
    if card["preview_video"]:
        old_path = os.path.join(WC_VIDEO_DIR, card["preview_video"])
        if os.path.exists(old_path):
            os.remove(old_path)
    # 若已有图片预览，一并清除（视频替换图片）
    if card["preview_image"]:
        old_i = os.path.join(WC_THUMB_DIR, card["preview_image"])
        if os.path.exists(old_i):
            os.remove(old_i)
    db.execute("UPDATE prompt_word_card SET preview_video=?, preview_image='' WHERE id=?", [filename, card_id])
    safe_commit()
    return {"ok": True, "filename": filename}


@router.delete("/cards/{card_id}/video")
def delete_word_card_video(card_id: int):
    """删除词卡预览视频"""
    db = get_db()
    card = db.execute("SELECT preview_video FROM prompt_word_card WHERE id=?", [card_id]).fetchone()
    if not card:
        raise HTTPException(404, "词卡不存在")
    if card["preview_video"]:
        path = os.path.join(WC_VIDEO_DIR, card["preview_video"])
        if os.path.exists(path):
            os.remove(path)
        db.execute("UPDATE prompt_word_card SET preview_video='' WHERE id=?", [card_id])
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
    # 检查同名
    existing = db.execute(
        "SELECT id FROM prompt_library WHERE dimension_name=? AND category='custom'",
        [name]
    ).fetchone()
    if existing:
        raise HTTPException(400, "同名自定义分组已存在")
    cur = db.execute(
        "INSERT INTO prompt_library (dimension_key, dimension_name, category, description, sort_order) VALUES (?, ?, 'custom', ?, "
        "(SELECT COALESCE(MAX(sort_order),0)+1 FROM prompt_library))",
        [key, name, name]
    )
    safe_commit()
    return {"ok": True, "id": cur.lastrowid, "dimension_key": key}


@router.delete("/libraries/{lib_id}")
def delete_library(lib_id: int):
    """删除自定义分组词库（仅限 custom 类型）"""
    db = get_db()
    lib = db.execute("SELECT * FROM prompt_library WHERE id=? AND category='custom'", [lib_id]).fetchone()
    if not lib:
        raise HTTPException(404, "自定义分组不存在或不可删除")
    # 删除关联词卡
    db.execute("DELETE FROM prompt_word_card WHERE library_id=?", [lib_id])
    db.execute("DELETE FROM user_custom_word WHERE library_id=?", [lib_id])
    db.execute("DELETE FROM prompt_library WHERE id=?", [lib_id])
    safe_commit()
    return {"ok": True}


@router.put("/libraries/{lib_id}")
def rename_library(lib_id: int, data: dict = Body(...)):
    """重命名自定义分组（仅限 custom 类型）"""
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name 必填")
    db = get_db()
    lib = db.execute("SELECT * FROM prompt_library WHERE id=? AND category='custom'", [lib_id]).fetchone()
    if not lib:
        raise HTTPException(404, "自定义分组不存在或不可编辑")
    db.execute("UPDATE prompt_library SET dimension_name=? WHERE id=?", [name, lib_id])
    safe_commit()
    return {"ok": True}


@router.put("/cards/{card_id}")
def update_card(card_id: int, data: dict = Body(...)):
    """编辑自定义词条（仅限 is_system=0）"""
    db = get_db()
    card = db.execute("SELECT * FROM prompt_word_card WHERE id=? AND is_system=0", [card_id]).fetchone()
    if not card:
        raise HTTPException(404, "词条不存在或不可编辑")
    word_text = data.get("word_text", "").strip()
    definition = data.get("definition", "")
    if not word_text:
        raise HTTPException(400, "word_text 必填")
    db.execute("UPDATE prompt_word_card SET word_text=?, definition=? WHERE id=?", [word_text, definition, card_id])
    # 同步 user_custom_word
    db.execute("UPDATE user_custom_word SET word_text=?, definition=? WHERE library_id=? AND word_text=?",
               [word_text, definition, card["library_id"], card["word_text"]])
    safe_commit()
    return {"ok": True}


@router.delete("/cards/{card_id}")
def delete_card(card_id: int):
    """删除自定义词条（仅限 is_system=0）"""
    db = get_db()
    card = db.execute("SELECT * FROM prompt_word_card WHERE id=? AND is_system=0", [card_id]).fetchone()
    if not card:
        raise HTTPException(404, "词条不存在或不可删除")
    db.execute("DELETE FROM user_custom_word WHERE library_id=? AND word_text=?", [card["library_id"], card["word_text"]])
    db.execute("DELETE FROM prompt_word_card WHERE id=?", [card_id])
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
    # 写入词卡表
    cur = db.execute(
        "INSERT INTO prompt_word_card (library_id, word_text, definition, is_system, heat_weight) VALUES (?, ?, ?, 0, 0.5)",
        [lib_id, word_text, definition]
    )
    # 同时追加入自定义词条表
    db.execute(
        "INSERT INTO user_custom_word (library_id, word_text, definition) VALUES (?, ?, ?)",
        [lib_id, word_text, definition]
    )
    safe_commit()
    return {"ok": True, "id": cur.lastrowid}


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
    cur = db.execute(
        "INSERT INTO user_custom_word (library_id, word_text, definition) VALUES (?, ?, ?)",
        [lib_id, word_text, definition]
    )
    # 同时插入到词卡表方便检索
    db.execute(
        "INSERT INTO prompt_word_card (library_id, word_text, definition, is_system, heat_weight) VALUES (?, ?, ?, 0, 0.5)",
        [lib_id, word_text, definition]
    )
    safe_commit()
    return {"ok": True, "id": cur.lastrowid}


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


# ==================== 项目 CRUD ====================

@router.get("/projects")
def list_projects(search: str = Query(None), page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)):
    """获取所有分镜项目"""
    db = get_db()
    params = []
    sql_where = ""
    if search:
        sql_where = " WHERE p.name LIKE ?"
        params.append(f"%{search}%")

    total = db.execute(f"SELECT COUNT(*) as cnt FROM user_project p{sql_where}", params).fetchone()["cnt"]
    offset = (page - 1) * page_size
    rows = db.execute(
        f"SELECT p.*, (SELECT COUNT(*) FROM user_project_scene WHERE project_id=p.id) as scene_count "
        f"FROM user_project p{sql_where} ORDER BY p.updated_at DESC LIMIT ? OFFSET ?",
        params + [page_size, offset]
    ).fetchall()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "items": [dict(r) for r in rows]
    }


# ==================== 核心: 时间重算引擎 ====================

def _recalculate_scene_times(project_id: int):
    """
    重新计算所有镜头的 duration 和时间轴。
    规则：
      - 已锁定镜头保持 duration 不变
      - 未锁定镜头均分剩余时长（最少 0.5s），从锁定镜头借时
      - 按 scene_order 顺序生成 start_time/end_time
      - 最后一个镜头吸收舍入误差
    """
    db = get_db()
    proj = db.execute("SELECT * FROM user_project WHERE id=?", [project_id]).fetchone()
    if not proj:
        return

    total = float(proj["total_duration"] or 15)
    scenes = db.execute(
        "SELECT id, COALESCE(duration, 3.0) as dur, is_locked FROM user_project_scene "
        "WHERE project_id=? ORDER BY scene_order ASC",
        [project_id]
    ).fetchall()

    if not scenes:
        return

    # 1) 确定锁定 vs 未锁定
    locked_ids = set(s["id"] for s in scenes if s["is_locked"])
    unlocked = [s for s in scenes if not s["is_locked"]]
    locked_total = sum(float(s["dur"]) for s in scenes if s["id"] in locked_ids)

    if unlocked:
        # 未锁定镜头均分剩余，最少 0.5s
        remaining = max(0, total - locked_total)
        min_needed = len(unlocked) * 0.5

        if remaining < min_needed:
            # 剩余不够，从锁定镜头借时（从时长最大的锁定镜头扣减）
            deficit = min_needed - remaining
            locked_sorted = sorted(
                [s for s in scenes if s["id"] in locked_ids],
                key=lambda x: float(x["dur"]), reverse=True
            )
            for s in locked_sorted:
                if deficit <= 0.01:
                    break
                old_dur = float(s["dur"])
                new_dur = max(0.5, old_dur - deficit)
                saved = old_dur - new_dur
                db.execute("UPDATE user_project_scene SET duration=? WHERE id=?", [new_dur, s["id"]])
                deficit = max(0, deficit - saved)
                locked_total -= saved
            remaining = total - max(0, locked_total)

        # 均分剩余
        per_unlocked = max(0.5, round(remaining / len(unlocked), 1))
        allocated = 0.0
        for idx, s in enumerate(unlocked):
            is_last = (idx == len(unlocked) - 1)
            dur = max(0.5, round(remaining - allocated, 1)) if is_last else per_unlocked
            db.execute("UPDATE user_project_scene SET duration=? WHERE id=?", [dur, s["id"]])
            allocated += dur

    # 2) 重新读取最新 duration，计算 start/end（锁定镜头保留duration）
    scenes = db.execute(
        "SELECT id, COALESCE(duration, 0.5) as dur, is_locked FROM user_project_scene "
        "WHERE project_id=? ORDER BY scene_order ASC",
        [project_id]
    ).fetchall()

    locked_ids2 = set(s["id"] for s in scenes if s["is_locked"])
    current = 0.0
    for idx, s in enumerate(scenes):
        seg = float(s["dur"])
        is_last = (idx == len(scenes) - 1)
        if current + seg > total:
            seg = max(0.5, total - current)
        start = round(current, 2)
        end = total if is_last else round(min(current + seg, total), 2)
        actual_dur = round(end - start, 1)
        if s["id"] in locked_ids2:
            # 锁定镜头：只更新 start/end，保留原有 duration
            db.execute(
                "UPDATE user_project_scene SET start_time=?, end_time=? WHERE id=?",
                [start, end, s["id"]]
            )
        else:
            db.execute(
                "UPDATE user_project_scene SET start_time=?, end_time=?, duration=? WHERE id=?",
                [start, end, actual_dur, s["id"]]
            )
        current = end

    safe_commit()


@router.post("/projects")
def create_project(data: dict = Body(...)):
    """新建分镜项目（支持全局风格/转场/负词/音频字段）"""
    name = (data.get("name") or "").strip() or "未命名项目"
    total_duration = data.get("total_duration", 15)
    aspect_ratio = data.get("aspect_ratio", "16:9")
    resolution = data.get("resolution", "4K")

    max_duration = 60  # 升级：最长60秒
    if total_duration < 2:
        total_duration = 2
    if total_duration > max_duration:
        raise HTTPException(400, f"总时长不能超过{max_duration}秒")

    template_id = data.get("template_id", None)  # 模板↔项目关联

    db = get_db()
    cur = db.execute(
        """INSERT INTO user_project 
            (name, total_duration, aspect_ratio, resolution,
             global_style, global_transition, negative_prompt, bgm, sfx, dialogue, template_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [name, total_duration, aspect_ratio, resolution,
         data.get("global_style", ""), data.get("global_transition", ""),
         data.get("negative_prompt", ""), data.get("bgm", ""),
         data.get("sfx", ""), data.get("dialogue", ""), template_id]
    )

    # 创建默认第一个镜头（duration = 总时长，重算后精确贴合）
    db.execute(
        "INSERT INTO user_project_scene (project_id, scene_order, start_time, end_time, duration) VALUES (?, 1, 0, ?, ?)",
        [cur.lastrowid, total_duration, total_duration]
    )
    safe_commit()
    _recalculate_scene_times(cur.lastrowid)
    return {"ok": True, "id": cur.lastrowid}


@router.get("/projects/{project_id}")
def get_project(project_id: int):
    """获取项目详情（含所有镜头）"""
    db = get_db()
    proj = db.execute("SELECT * FROM user_project WHERE id=?", [project_id]).fetchone()
    if not proj:
        raise HTTPException(404, "项目不存在")

    scenes = db.execute(
        "SELECT * FROM user_project_scene WHERE project_id=? ORDER BY scene_order ASC",
        [project_id]
    ).fetchall()

    # 计算已分配时长（基于用户输入的 duration）
    total_dur_input = sum(float(s["duration"] if s["duration"] else 3.0) for s in scenes)
    allocated = sum(s["end_time"] - s["start_time"] for s in scenes)
    remaining = proj["total_duration"] - allocated
    remaining_duration = max(0, proj["total_duration"] - total_dur_input)

    return {
        "project": {
            **dict(proj),
            "allocated": round(allocated, 1),
            "remaining": round(remaining, 1),
            "total_dur_input": round(total_dur_input, 1),
            "remaining_duration": round(remaining_duration, 1)
        },
        "scenes": [dict(s) for s in scenes]
    }


@router.put("/projects/{project_id}")
def update_project(project_id: int, data: dict = Body(...)):
    """更新项目配置"""
    db = get_db()
    proj = db.execute("SELECT * FROM user_project WHERE id=?", [project_id]).fetchone()
    if not proj:
        raise HTTPException(404, "项目不存在")

    fields = {}
    for key in ["name", "total_duration", "aspect_ratio", "resolution", "global_style", "global_transition", "negative_prompt"]:
        if key in data:
            fields[key] = data[key]

    if not fields:
        raise HTTPException(400, "无更新字段")

    if "total_duration" in fields:
        try:
            fields["total_duration"] = int(fields["total_duration"])
        except (ValueError, TypeError):
            raise HTTPException(400, "时长格式无效")
        if fields["total_duration"] < 2:
            fields["total_duration"] = 2
        elif fields["total_duration"] > 60:
            raise HTTPException(400, "总时长不能超过60秒")

    set_clause = ", ".join(f"{k}=?" for k in fields)
    values = list(fields.values()) + [project_id]
    db.execute(f"UPDATE user_project SET {set_clause}, updated_at=datetime('now','localtime') WHERE id=?", values)
    safe_commit()

    # 如果总时长变动，重算所有镜头时间
    if "total_duration" in fields:
        _recalculate_scene_times(project_id)

    return {"ok": True}


@router.put("/projects/{project_id}/update-template")
def update_project_to_template(project_id: int, data: dict = Body(...)):
    """闭环: 组装器编辑 → 回写场景模版 或 新建副本"""
    db = get_db()
    proj = db.execute(
        "SELECT * FROM user_project WHERE id=?", [project_id]
    ).fetchone()
    if not proj:
        raise HTTPException(404, "项目不存在")
    if not proj["template_id"]:
        raise HTTPException(400, "该项目未关联场景模版，无法操作")

    new_content = (data.get("content") or "").strip()
    new_scene = (data.get("scene") or "").strip()
    if not new_content:
        raise HTTPException(400, "内容不能为空")

    duplicate = data.get("duplicate", False)
    if duplicate:
        # 新建副本: 读取原模版字段，插入新行
        tpl = db.execute(
            "SELECT * FROM prompts WHERE id=?", [proj["template_id"]]
        ).fetchone()
        if not tpl:
            raise HTTPException(404, "原模版不存在")
        # 新标题 = 原分类原名 + (副本)
        old_name = (tpl["subcategory"] or tpl["module"] or "未命名").strip()
        if not old_name.endswith("(副本)"):
            old_name = old_name + " (副本)"
        db.execute(
            """INSERT INTO prompts (module, category, subcategory, content, scene, meaning, tags, is_builtin, usage_count, created_at, deleted_at)
               VALUES (?, ?, ?, ?, ?, ?, '', 0, 0, datetime('now','localtime'), NULL)""",
            [tpl["module"], tpl["category"], old_name, new_content, new_scene, tpl["meaning"]]
        )
        new_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        safe_commit()
        return {"ok": True, "template_id": proj["template_id"], "new_template_id": new_id, "duplicate": True}
    else:
        # 覆盖原模版
        db.execute(
            "UPDATE prompts SET content=?, scene=?, updated_at=datetime('now','localtime') WHERE id=?",
            [new_content, new_scene, proj["template_id"]]
        )
        safe_commit()
        return {"ok": True, "template_id": proj["template_id"], "duplicate": False}


@router.delete("/projects/{project_id}")
def delete_project(project_id: int):
    """删除项目"""
    db = get_db()
    proj = db.execute("SELECT id FROM user_project WHERE id=?", [project_id]).fetchone()
    if not proj:
        raise HTTPException(404, "项目不存在")
    # 级联删除镜头和关联（CASCADE）
    db.execute("DELETE FROM user_scene_prompt WHERE scene_id IN (SELECT id FROM user_project_scene WHERE project_id=?)", [project_id])
    db.execute("DELETE FROM user_project_scene WHERE project_id=?", [project_id])
    db.execute("DELETE FROM user_project WHERE id=?", [project_id])
    safe_commit()
    return {"ok": True}


# ==================== 镜头管理 ====================

@router.post("/projects/{project_id}/scenes")
def create_scene(project_id: int, data: dict = Body(...)):
    """在项目中新增镜头（用户只需传入 duration，系统自动重算 start/end）"""
    db = get_db()
    proj = db.execute("SELECT * FROM user_project WHERE id=?", [project_id]).fetchone()
    if not proj:
        raise HTTPException(404, "项目不存在")

    scene_order = data.get("scene_order")
    duration = data.get("duration")

    if scene_order is None:
        scene_order = db.execute(
            "SELECT COALESCE(MAX(scene_order),0)+1 FROM user_project_scene WHERE project_id=?",
            [project_id]
        ).fetchone()[0]

    if duration is None or duration <= 0:
        # 自动计算剩余时长：总时长 - 已有镜头duration之和
        existing_dur_total = db.execute(
            "SELECT COALESCE(SUM(duration), 0) FROM user_project_scene WHERE project_id=?",
            [project_id]
        ).fetchone()[0]
        remaining = float(proj["total_duration"]) - float(existing_dur_total)
        if remaining > 0.5:
            duration = round(min(remaining, 3.0), 1)  # 最多取3秒，最少0.5秒
        else:
            # 无剩余时长，所有镜头均分
            existing_count = db.execute(
                "SELECT COUNT(*) as cnt FROM user_project_scene WHERE project_id=?",
                [project_id]
            ).fetchone()["cnt"]
            avg = float(proj["total_duration"]) / max(1, existing_count + 1)
            duration = round(max(0.5, avg), 1)

    # 检查 scene_order 是否已有镜头（更新模式）
    existing_scene = db.execute(
        "SELECT id FROM user_project_scene WHERE project_id=? AND scene_order=?",
        [project_id, scene_order]
    ).fetchone()

    if existing_scene:
        # 已有 order=插入模式：后移同序号+以后的所有镜头
        db.execute(
            "UPDATE user_project_scene SET scene_order=scene_order+1 WHERE project_id=? AND scene_order>=?",
            [project_id, scene_order]
        )

    # 镜头数上限保护（最多30个）
    cc = db.execute("SELECT COUNT(*) as cnt FROM user_project_scene WHERE project_id=?", [project_id]).fetchone()["cnt"]
    if cc >= 30: raise HTTPException(400, "镜头数量不能超过30个")

    # 插入新镜头（duration 存为用户原始输入，start/end 由重算引擎填充）
    extra_fields = ["camera_move", "subject", "scene_desc", "composition", "lighting",
                   "focal_length", "texture", "speed", "perspective", "particles", "weather",
                   "color_grade", "emotion", "natural_force", "depth_of_field", "filter",
                   "film_flaw", "fantasy_physics", "environment_detail", "action", "details"]
    extra_keys = []
    extra_vals = []
    for f in extra_fields:
        if f in data and data[f]:
            extra_keys.append(f)
            extra_vals.append(data[f])

    columns = "project_id, scene_order, start_time, end_time, duration"
    placeholders = "?, ?, ?, ?, ?"
    values = [project_id, scene_order, 0, float(duration), duration]
    if extra_keys:
        columns += ", " + ", ".join(extra_keys)
        placeholders += ", " + ", ".join(["?" for _ in extra_keys])
        values += extra_vals
    if "is_locked" in data:
        columns += ", is_locked"
        placeholders += ", ?"
        values.append(1 if data["is_locked"] else 0)

    cur = db.execute(
        f"INSERT INTO user_project_scene ({columns}) VALUES ({placeholders})",
        values
    )
    safe_commit()

    # 重算所有镜头时间
    _recalculate_scene_times(project_id)

    return {"ok": True, "id": cur.lastrowid}

@router.put("/projects/{project_id}/scenes/{scene_id}")
def update_scene(project_id: int, scene_id: int, data: dict = Body(...)):
    """更新单个镜头字段（支持 duration，自动重算时间线）"""
    db = get_db()
    scene = db.execute(
        "SELECT * FROM user_project_scene WHERE id=? AND project_id=?",
        [scene_id, project_id]
    ).fetchone()
    if not scene:
        raise HTTPException(404, "镜头不存在")

    # 可更新字段
    updatable = [
        "scene_order", "duration",
        "camera_move", "subject", "scene_desc", "composition", "lighting",
        "focal_length", "texture", "speed", "perspective", "particles", "weather",
        "color_grade", "emotion", "natural_force", "depth_of_field", "filter",
        "film_flaw", "fantasy_physics", "environment_detail", "action", "details"
    ]

    has_recalc = "duration" in data or "scene_order" in data

    # ---- 时长超限保护 ----
    if "duration" in data:
        new_dur = float(data["duration"])
        # 计算其他锁定镜头总时长
        other_locked = db.execute(
            "SELECT COALESCE(SUM(duration), 0) FROM user_project_scene WHERE project_id=? AND id!=? AND is_locked=1",
            [project_id, scene_id]
        ).fetchone()[0]
        proj = db.execute("SELECT total_duration FROM user_project WHERE id=?", [project_id]).fetchone()
        max_allowed = max(0.5, float(proj["total_duration"]) - float(other_locked))
        if new_dur > max_allowed:
            # 自动截断到上限
            data["duration"] = max_allowed
            new_dur = max_allowed

    set_parts = []
    values = []
    for f in updatable:
        if f in data:
            set_parts.append(f"{f}=?")
            values.append(data[f])

    if not set_parts:
        raise HTTPException(400, "无更新字段")

    set_clause = ", ".join(set_parts)
    values += [scene_id]
    db.execute(f"UPDATE user_project_scene SET {set_clause} WHERE id=?", values)
    safe_commit()

    if has_recalc:
        _recalculate_scene_times(project_id)

    return {"ok": True}


@router.put("/projects/{project_id}/scenes/{scene_id}/lock")
def toggle_lock_scene(project_id: int, scene_id: int, data: dict = Body(...)):
    """切换镜头时长锁定状态"""
    locked = data.get("locked", True)
    db = get_db()
    scene = db.execute(
        "SELECT * FROM user_project_scene WHERE id=? AND project_id=?",
        [scene_id, project_id]
    ).fetchone()
    if not scene:
        raise HTTPException(404, "镜头不存在")
    db.execute("UPDATE user_project_scene SET is_locked=? WHERE id=?", [1 if locked else 0, scene_id])
    safe_commit()
    _recalculate_scene_times(project_id)
    return {"ok": True, "locked": locked}


@router.delete("/projects/{project_id}/scenes/{scene_id}")
def delete_scene(project_id: int, scene_id: int):
    """删除镜头"""
    db = get_db()
    scene = db.execute(
        "SELECT scene_order FROM user_project_scene WHERE id=? AND project_id=?",
        [scene_id, project_id]
    ).fetchone()
    if not scene:
        raise HTTPException(404, "镜头不存在")

    # 删除关联
    db.execute("DELETE FROM user_scene_prompt WHERE scene_id=?", [scene_id])
    db.execute("DELETE FROM user_project_scene WHERE id=?", [scene_id])

    # 重排序号
    db.execute(
        "UPDATE user_project_scene SET scene_order=scene_order-1 WHERE project_id=? AND scene_order>?",
        [project_id, scene["scene_order"]]
    )
    safe_commit()

    # 删除后重算时间线
    _recalculate_scene_times(project_id)

    return {"ok": True}


@router.post("/projects/{project_id}/scenes/reorder")
def reorder_scenes(project_id: int, data: dict = Body(...)):
    """镜头拖拽排序"""
    scene_ids = data.get("scene_ids", [])
    if not scene_ids:
        raise HTTPException(400, "scene_ids 必填")
    db = get_db()
    for idx, sid in enumerate(scene_ids):
        db.execute(
            "UPDATE user_project_scene SET scene_order=? WHERE id=? AND project_id=?",
            [idx + 1, sid, project_id]
        )
    safe_commit()

    # 排序后重算时间线
    _recalculate_scene_times(project_id)

    return {"ok": True}


# ==================== 镜头-词卡关联 ====================

@router.get("/projects/{project_id}/scenes/{scene_id}/prompts")
def get_scene_prompts(project_id: int, scene_id: int):
    db = get_db()

    sc = db.execute("SELECT id FROM user_project_scene WHERE id=? AND project_id=?", [scene_id, project_id]).fetchone()
    if not sc: raise HTTPException(404, "镜头不存在")
    """获取镜头关联的词卡列表"""
    db = get_db()
    rows = db.execute(
        "SELECT sp.*, wc.word_text, wc.definition, pl.dimension_name, pl.dimension_key "
        "FROM user_scene_prompt sp "
        "LEFT JOIN prompt_word_card wc ON wc.id=sp.word_card_id "
        "LEFT JOIN prompt_library pl ON pl.id=wc.library_id "
        "WHERE sp.scene_id=? ORDER BY sp.id",
        [scene_id]
    ).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("/projects/{project_id}/scenes/{scene_id}/prompts")
def add_scene_prompt(project_id: int, scene_id: int, data: dict = Body(...)):
    """为镜头关联词卡"""
    word_card_id = data.get("word_card_id")
    dimension_key = data.get("dimension_key", "")
    if not word_card_id:
        raise HTTPException(400, "word_card_id 必填")
    db = get_db()
    # 检查是否已存在
    existing = db.execute(
        "SELECT id FROM user_scene_prompt WHERE scene_id=? AND word_card_id=? AND dimension_key=?",
        [scene_id, word_card_id, dimension_key]
    ).fetchone()
    if existing:
        return {"ok": True, "id": existing["id"], "message": "已存在"}
    cur = db.execute(
        "INSERT INTO user_scene_prompt (scene_id, word_card_id, dimension_key) VALUES (?, ?, ?)",
        [scene_id, word_card_id, dimension_key]
    )
    # 更新词卡使用次数
    db.execute("UPDATE prompt_word_card SET usage_count=usage_count+1 WHERE id=?", [word_card_id])
    safe_commit()
    return {"ok": True, "id": cur.lastrowid}


@router.delete("/projects/{project_id}/scenes/{scene_id}/prompts/{sp_id}")
def remove_scene_prompt(project_id: int, scene_id: int, sp_id: int):
    """移除镜头词卡关联"""
    db = get_db()
    db.execute("DELETE FROM user_scene_prompt WHERE id=? AND scene_id=?", [sp_id, scene_id])
    safe_commit()
    return {"ok": True}


# ==================== 核心: 提示词拼接引擎 ====================

# ==================== 分辨率映射表 ====================
RESOLUTION_MAP = {
    "1080p": (1920, 1080), "2K": (2560, 1440), "4K": (3840, 2160),
    "6K": (5760, 3240), "8K": (7680, 4320),
}
ASPECT_MAX_MAP = {
    "16:9": 2160, "9:16": 2160, "1:1": 2160, "21:9": 2160,
    "2.35:1": 2160, "4:3": 2160, "3:4": 2160, "3:2": 2160, "2:3": 2160,
}


def _make_structured_description(scene_data: dict, density: str) -> str:
    """将镜头维度字段拼接为自然语言描述（按标准公式）
   
    拼接公式（行业标准）：
    运镜 → 主体 → 动作 → 场景 → 构图 → 光影 → 焦段 → 质感 → 速率 → 氛围 → 特效 → 细节
  
    密度:
      compact  = 运镜+主体+场景 (Sora/Kling 模式，简洁有力)
      standard = 运镜+主体+动作+场景+构图+光影+氛围 (Midjourney/Seedance)
      detailed = 全部维度 (ComfyUI/专业后期排错用)
    """
    d = scene_data
    parts = []

    # Layer 1: 运镜（所有密度）
    if d.get("camera_move"):
        parts.append(d["camera_move"])

    # Layer 2: 主体（所有密度）
    if d.get("subject"):
        parts.append(d["subject"])

    # Layer 3: 动作 (standard+)
    if d.get("action") and density != "compact":
        parts.append(d["action"])

    # Layer 4: 场景 (所有密度)
    if d.get("scene_desc"):
        parts.append(d["scene_desc"])

    # Layer 5: 构图 (standard+)
    if d.get("composition") and density != "compact":
        parts.append(d["composition"])

    # Layer 6: 光影 (standard+)
    if d.get("lighting") and density != "compact":
        parts.append(d["lighting"])

    # Layer 7: 焦段 (detailed only)
    if d.get("focal_length") and density == "detailed":
        parts.append(d["focal_length"])

    # Layer 8: 质感 (detailed only)
    if d.get("texture") and density == "detailed":
        parts.append(d["texture"])

    # Layer 9: 速率 (detailed only)
    if d.get("speed") and density == "detailed":
        parts.append(d["speed"])

    # Layer 10: 氛围组 (standard+)
    if density != "compact":
        mood = _pick_non_empty(d, ["emotion", "color_grade", "weather"])
        if mood:
            parts.append(mood)

    # Layer 11: 特效组 (detailed only)
    if density == "detailed":
        fx = _pick_non_empty(d, ["particles", "natural_force", "fantasy_physics", "filter"])
        if fx:
            parts.append(fx)

    # Layer 12: 细节组 (detailed only)
    if density == "detailed":
        detail = _pick_non_empty(d, ["perspective", "depth_of_field", "environment_detail",
                                      "film_flaw", "details"])
        if detail:
            parts.append(detail)

    return "，".join(p for p in parts if p.strip())


def _pick_non_empty(d: dict, keys: list) -> str:
    vals = [d.get(k) for k in keys if d.get(k)]
    return "，".join(vals) if vals else ""


def _calc_pixel_res(ar: str, res: str) -> str:
    """计算画幅像素分辨率 e.g. 16:9 4K -> 3840x2160, 9:16 4K -> 2160x3840"""
    base_w, base_h = RESOLUTION_MAP.get(res, (1920, 1080))
    w_ratio, h_ratio = map(int, ar.split(":"))
    base_short = min(base_w, base_h)
    if w_ratio >= h_ratio:
        h = base_short
        w = int(h * w_ratio / h_ratio)
    else:
        w = base_short
        h = int(w * h_ratio / w_ratio)
    return f"{w}x{h}"


def _fmt_header(proj: dict, fmt: str) -> str:
    """按目标平台格式生成全局头部"""
    ar = proj["aspect_ratio"] or "16:9"
    res = proj["resolution"] or "4K"
    dur = int(proj["total_duration"] or 15)
    style = proj["global_style"] or ""
    transition = proj["global_transition"] or ""
    neg = proj["negative_prompt"] or ""
    pix = _calc_pixel_res(ar, res)

    AR_LABEL = {
        "16:9": "横屏", "9:16": "竖屏", "1:1": "方形",
        "21:9": "超宽", "2.35:1": "电影宽屏", "4:3": "方屏", "3:4": "竖屏3:4"
    }
    ar_label = AR_LABEL.get(ar, ar)

    if fmt == "kling":
        # Kling 1.6 / 2.0 格式: 镜头语言前缀+主体+环境
        line = f"{ar_label}{res} 视频 {dur}s"
        if style:
            line += f" {style}"
        return line

    elif fmt == "minimax":
        # MiniMax Hailuo 格式: 英文为主
        line = f"{ar_label}_{res}_{pix}_{dur}s"
        if style:
            line += f", {style}"
        return line

    elif fmt == "comfyui":
        # ComfyUI 格式: 技术标注精确
        line = f"resolution={pix}, duration={dur}s, fps=24"
        if style:
            line += f", style={style}"
        return line

    elif fmt == "raw":
        return ""  # 纯镜头描述，无全局头

    else:  # seedance (default)
        parts = [f"{ar_label}{res}"]
        if style:
            parts.append(style)
        parts.append(f"{dur}s")
        if transition:
            parts.append(transition)
        return "，".join(parts)


def _fmt_scene(shot: int, start: float, end: float, desc: str, sc: dict, fmt: str) -> str:
    """按目标平台格式生成单个镜头行"""
    st, et = int(start), int(end)
    dur = round(end - start, 1)

    if fmt == "kling":
        return f"Shot{shot}[{st}s-{et}s]({dur}s): {desc}"
    elif fmt == "minimax":
        return f"[{st}-{et}]({dur}s) {desc}"
    elif fmt == "comfyui":
        fields = []
        if sc.get("camera_move"):
            fields.append(f"camera:{sc['camera_move']}")
        fields.append(f"desc:{desc}")
        return f"frame{shot}[{st}-{et}]: {'; '.join(fields)}"
    elif fmt == "raw":
        return desc
    else:  # seedance
        return f"{st}-{et}s：{desc}"


@router.post("/projects/{project_id}/compose")
def compose_project(project_id: int, data: dict = Body({})):
    """
    核心拼接引擎 v2.0 — 5平台多格式输出
    
    参数:
      format: seedance|kling|minimax|comfyui|raw (default: seedance)
      density: compact|standard|detailed (default: standard)
      include_audio: bool (default: false)
    """
    db = get_db()
    proj = db.execute("SELECT * FROM user_project WHERE id=?", [project_id]).fetchone()
    if not proj:
        raise HTTPException(404, "项目不存在")

    scenes = db.execute(
        "SELECT * FROM user_project_scene WHERE project_id=? ORDER BY scene_order ASC",
        [project_id]
    ).fetchall()

    if not scenes:
        return {"text": "", "json": {}, "error": "无镜头数据"}

    fmt = data.get("format", "seedance")
    density = data.get("density", "standard")
    include_audio = data.get("include_audio", False)

    # ---- 全局头部 ----
    ar = proj["aspect_ratio"] or "16:9"
    res = proj["resolution"] or "4K"
    duration = int(proj["total_duration"] or 15)
    pix = _calc_pixel_res(ar, res)
    header_line = _fmt_header(dict(proj), fmt)

    # ---- 多镜头描述 ----
    scene_lines = []
    json_scenes = []
    all_negatives = []  # 镜头级负词汇总

    for sc in scenes:
        scd = dict(sc)
        st = float(scd["start_time"])
        et = float(scd["end_time"])

        # 拼接镜头描述
        scene_desc = _make_structured_description(scd, density)

        # 镜头负词
        shot_neg = scd.get("details") or ""
        if shot_neg and shot_neg.startswith("--neg"):
            all_negatives.append(shot_neg.replace("--neg", "").strip())
            shot_neg = ""

        # 格式化镜头行
        if scene_desc:
            scene_lines.append(
                _fmt_scene(scd["scene_order"], st, et, scene_desc, scd, fmt)
            )

        json_scenes.append({
            "shot": scd["scene_order"],
            "start": st,
            "end": et,
            "duration": round(et - st, 1),
            "text": scene_desc,
            "negative": shot_neg,
            "fields": {
                "camera_move": scd.get("camera_move") or "",
                "subject": scd.get("subject") or "",
                "action": scd.get("action") or "",
                "scene": scd.get("scene_desc") or "",
                "composition": scd.get("composition") or "",
                "lighting": scd.get("lighting") or "",
                "focal_length": scd.get("focal_length") or "",
                "texture": scd.get("texture") or "",
                "speed": scd.get("speed") or "",
                "emotion": scd.get("emotion") or "",
                "color_grade": scd.get("color_grade") or "",
                "weather": scd.get("weather") or "",
                "particles": scd.get("particles") or "",
                "perspective": scd.get("perspective") or "",
                "depth_of_field": scd.get("depth_of_field") or "",
                "environment_detail": scd.get("environment_detail") or "",
                "film_flaw": scd.get("film_flaw") or "",
                "fantasy_physics": scd.get("fantasy_physics") or "",
            }
        })

    # ---- 负面词 ----
    global_neg = proj["negative_prompt"] or ""
    all_neg = []
    if global_neg:
        all_neg.append(global_neg)
    all_neg.extend(all_negatives)
    neg_line = "，".join(all_neg) if all_neg else ""

    # ---- 音频（可选）----
    audio_text = ""
    if include_audio:
        bgm = data.get("bgm", "") or proj["bgm"] or ""
        sfx = data.get("sfx", "") or proj["sfx"] or ""
        dialogue = data.get("dialogue", "") or proj["dialogue"] or ""
        if bgm:
            audio_text += f"BGM: {bgm}\n"
        if sfx:
            audio_text += f"音效: {sfx}\n"
        if dialogue:
            audio_text += f"对白: {dialogue}\n"

    # ---- 完整提示词 ----
    full_lines = []
    if header_line:
        full_lines.append(header_line)
    if audio_text:
        full_lines.append(audio_text.strip())
    if full_lines and scene_lines:
        full_lines.append("")
    full_lines.extend(scene_lines)
    if neg_line:
        full_lines.append("")
        full_lines.append(f"负面：{neg_line}")

    full_text = "\n".join(full_lines).strip()

    # ---- JSON 输出 ----
    json_output = {
        "meta": {
            "format": fmt,
            "density": density,
            "pixel_res": pix,
            "fps": 24,
        },
        "global": {
            "aspect_ratio": ar,
            "resolution": res,
            "pixel_width": int(pix.split("x")[0]) if "x" in pix else 0,
            "pixel_height": int(pix.split("x")[1]) if "x" in pix else 0,
            "duration": duration,
            "style": proj["global_style"] or "",
            "transition": proj["global_transition"] or "",
            "negative": neg_line,
        },
        "audio": {
            "bgm": data.get("bgm", "") or proj["bgm"] or "",
            "sfx": data.get("sfx", "") or proj["sfx"] or "",
            "dialogue": data.get("dialogue", "") or proj["dialogue"] or "",
        } if include_audio else None,
        "shots": json_scenes,
        "full_text": full_text
    }

    if fmt == "json":
        return json_output

    return {
        "text": full_text,
        "json": json_output,
        "length": len(full_text),
        "shot_count": len(scenes),
        "duration": duration,
        "format": fmt,
        "density": density,
        "pixel_res": pix,
    }


# ==================== 智能推荐 ====================

@router.get("/recommend/{project_id}/{scene_id}")
def recommend_cards(project_id: int, scene_id: int):
    """基于镜头已有字段，AI推荐同维度的补齐词条"""
    db = get_db()
    scene = db.execute(
        "SELECT * FROM user_project_scene WHERE id=? AND project_id=?",
        [scene_id, project_id]
    ).fetchone()
    if not scene:
        raise HTTPException(404, "镜头不存在")

    # 找出哪些字段为空，推荐top5
    recommendations = {}
    field_card_map = {
        "camera_move": "运镜", "subject": "主体", "scene_desc": "场景",
        "composition": "构图", "lighting": "光影", "focal_length": "焦段",
        "texture": "质感", "speed": "速率", "emotion": "情绪",
        "color_grade": "调色", "particles": "特效", "weather": "天气"
    }

    for field, field_name in field_card_map.items():
        if not scene[field] or scene[field].strip() == "":
            # 找对应词库推荐
            lib = db.execute(
                "SELECT id FROM prompt_library WHERE dimension_key=?",
                [field]
            ).fetchone()
            if lib:
                cards = db.execute(
                    "SELECT * FROM prompt_word_card WHERE library_id=? ORDER BY heat_weight DESC, usage_count DESC LIMIT 5",
                    [lib["id"]]
                ).fetchall()
                if cards:
                    recommendations[field_name] = [dict(c) for c in cards]

    return {"recommendations": recommendations}


# ==================== 系统配置 ====================

@router.get("/config")
def get_config(key: str = Query(None)):
    """获取系统配置"""
    db = get_db()
    if key:
        row = db.execute("SELECT * FROM sys_global_config WHERE config_key=?", [key]).fetchone()
        if not row:
            raise HTTPException(404, "配置不存在")
        return {"config": dict(row)}
    rows = db.execute("SELECT * FROM sys_global_config").fetchall()
    return {"configs": [dict(r) for r in rows]}


@router.put("/config/{key}")
def update_config(key: str, data: dict = Body(...)):
    """更新系统配置"""
    value = data.get("config_value")
    if value is None:
        raise HTTPException(400, "config_value 必填")
    db = get_db()
    db.execute(
        "INSERT INTO sys_global_config (config_key, config_value) VALUES (?, ?) "
        "ON CONFLICT(config_key) DO UPDATE SET config_value=excluded.config_value, updated_at=datetime('now','localtime')",
        [key, value]
    )
    safe_commit()
    return {"ok": True}


# ==================== 反向解析（文本→结构化） ====================

@router.post("/parse")
def parse_prompt(data: dict = Body(...)):
    """
    将已有的纯文本提示词 反向解析为结构化镜头数据
    用于从已有的Seedance提示词导入到编辑器
    """
    text = data.get("text", "")
    if not text:
        raise HTTPException(400, "text 必填")

    lines = text.strip().split("\n")
    result = {
        "global": {"style": "", "duration": 15, "aspect_ratio": "16:9", "resolution": "4K", "transition": "", "negative": ""},
        "shots": [],
        "unparsed": []
    }

    # 简单解析: 第一行非空为全局头部
    # 带"负面"的为尾部
    # 中间每行匹配 "数字-数字s：" 格式为镜头
    shot_lines = []
    after_negative = False
    neg_parts = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        # 负面提示
        if "负面" in stripped or "negative" in stripped.lower():
            after_negative = True
            # 提取负面内容
            neg_text = stripped.split("：")[-1] if "：" in stripped else stripped.split(":")[-1] if ":" in stripped else ""
            if neg_text:
                neg_parts.append(neg_text.strip())
            continue

        if after_negative:
            continue

        # 尝试匹配镜头时间戳
        import re
        match = re.match(r"(\d+)[-~](\d+)s?[：:]\s*(.*)", stripped)
        if match:
            st = int(match.group(1))
            et = int(match.group(2))
            desc = match.group(3).strip()
            shot_lines.append({"start": st, "end": et, "text": desc})
        elif not result["global"]["style"]:
            # 第一个非空非镜头行作为全局风格
            result["global"]["style"] = stripped
            # 尝试提取画幅和时长
            if "16:9" in stripped:
                result["global"]["aspect_ratio"] = "16:9"
            elif "9:16" in stripped:
                result["global"]["aspect_ratio"] = "9:16"
            elif "1:1" in stripped:
                result["global"]["aspect_ratio"] = "1:1"
            elif "2.35" in stripped:
                result["global"]["aspect_ratio"] = "2.35:1"

            dur_match = re.search(r"(\d+)s", stripped)
            if dur_match:
                result["global"]["duration"] = int(dur_match.group(1))

            if "4K" in stripped:
                result["global"]["resolution"] = "4K"
            elif "8K" in stripped:
                result["global"]["resolution"] = "8K"
        else:
            result["unparsed"].append(stripped)

    if neg_parts:
        result["global"]["negative"] = "，".join(neg_parts)

    # 尝试进一步拆解镜头描述
    dim_keywords = {
        "camera_move": ["推镜头", "拉镜头", "摇镜头", "移镜头", "跟镜头", "升降", "环绕", "滑动变焦", "手持", "固定", "俯视", "穿越机", "FPV", "dolly", "pan", "tracking", "orbit"],
        "composition": ["特写", "中景", "远景", "全景", "俯拍", "仰拍", "斜角", "对称", "三分法", "引导线", "框架", "第一人称", "POV", "过肩", "OTS"],
        "lighting": ["逆光", "侧光", "顺光", "顶光", "漫射", "聚光", "霓虹", "烛光", "月光", "硬光", "柔光", "晨光", "黄昏", "金色"],
        "speed": ["慢动作", "升格", "慢放", "快进", "延时", "timelapse", "slow motion"],
        "emotion": ["治愈", "紧张", "悬疑", "浪漫", "悲伤", "孤独", "热血", "神秘", "幽默", "安静", "温馨", "清冷"],
        "weather": ["晴朗", "细雨", "暴雨", "晨雾", "黄昏", "暴风雪", "雷雨", "彩虹", "雪", "雨", "雾"],
    }

    for sl in shot_lines:
        fields = {}
        desc = sl["text"]
        for dim, keywords in dim_keywords.items():
            for kw in keywords:
                if kw in desc:
                    fields[dim] = kw
                    break
        sl["fields"] = fields

    result["shots"] = shot_lines
    return {"ok": True, "result": result}


# ==================== 智能模版导入（词卡匹配+自动创建词卡+拆镜填充） ====================

@router.post("/import-from-template")
def import_from_template(data: dict = Body(...)):
    """
    智能模版导入：取一条场景模版→解析时间轴→多镜头拆分→
    词库维度匹配→自动创建自定义词卡→创建项目并填充镜头字段
    """
    tpl_id = data.get("template_id")
    if not tpl_id:
        raise HTTPException(400, "template_id 必填")

    db = get_db()
    row = db.execute("SELECT * FROM prompts WHERE id=? AND module='seedance'", [tpl_id]).fetchone()
    if not row:
        raise HTTPException(404, "模版不存在")

    tpl_content = row["content"] or ""
    tpl_meaning = row["meaning"] or ""
    tpl_category = row["category"] or "Seedance"
    try:
        tpl_tags = json.loads(row["tags"] or "[]")
    except Exception:
        tpl_tags = []

    # ── 1. 解析模版文本 ──
    lines = tpl_content.strip().split("\n")
    global_style = ""
    global_aspect = "16:9"
    global_resolution = "4K"
    global_duration = 15
    global_negative = ""
    global_transition = ""
    shots_raw = []  # [{start, end, desc}]
    extra_lines = []
    in_negative = False
    negative_lines = []

    import re
    for line in lines:
        s = line.strip()
        if not s:
            continue

        # 负面提示词区域
        if re.search(r"负面|negative", s, re.IGNORECASE):
            in_negative = True
            t = re.split(r"[：:]", s, maxsplit=1)
            if len(t) > 1 and t[1].strip():
                negative_lines.append(t[1].strip())
            continue
        if in_negative:
            negative_lines.append(s)
            continue

        # 全局元数据行（风格/画幅/时长）
        if re.match(r"^【.*】$", s):
            inner = s[1:-1]
            if not global_style:
                global_style = inner[:80]
            # 提取数字元素
            dur_m = re.search(r"(\d+)秒", inner)
            if dur_m:
                global_duration = int(dur_m.group(1))
            for ratio in ["2.35:1","21:9","16:9","9:16","1:1","4:3","3:4"]:
                if ratio in inner:
                    global_aspect = ratio if ratio != "2.35:1" else "21:9"
                    break
            for res in ["8K","6K","4K","2K","1080p","720p"]:
                if res in inner:
                    global_resolution = res
                    break
            continue

        # 时间轴镜头行: "0-3秒：xxx" / "0-3s: xxx"
        shot_m = re.match(r"(\d+)[-~](\d+)\s*秒?[：:]\s*(.+)", s)
        if shot_m:
            shots_raw.append({
                "start": int(shot_m.group(1)),
                "end": int(shot_m.group(2)),
                "desc": shot_m.group(3).strip()
            })
            continue

        # 英文冒号格式
        shot_m2 = re.match(r"(\d+)[-~](\d+)s?\s*:\s*(.+)", s)
        if shot_m2:
            shots_raw.append({
                "start": int(shot_m2.group(1)),
                "end": int(shot_m2.group(2)),
                "desc": shot_m2.group(3).strip()
            })
            continue

        # 纯数字间隔: "0-3s 开场"
        shot_m3 = re.match(r"(\d+)[-~](\d+)s?\s+(.+)", s)
        if shot_m3:
            shots_raw.append({
                "start": int(shot_m3.group(1)),
                "end": int(shot_m3.group(2)),
                "desc": shot_m3.group(3).strip()
            })
            continue

        # 非结构行存为额外提示
        extra_lines.append(s)

    if negative_lines:
        global_negative = "，".join(negative_lines)

    if not global_style:
        global_style = tpl_category

    # 如果没有解析出镜头，整段作为单镜头
    if not shots_raw and tpl_content.strip():
        shots_raw = [{"start": 0, "end": global_duration, "desc": tpl_content.strip()[:500]}]

    # ── 2. 加载词库全维度的词卡索引 ──
    all_libs = db.execute("SELECT * FROM prompt_library ORDER BY sort_order").fetchall()
    dim_cards = {}  # {dimension_key: [{id, word, definition, heat_weight}]}
    dim_lib_id = {}  # {dimension_key: library_id}
    for lib in all_libs:
        lk = lib["dimension_key"]
        cards = db.execute(
            "SELECT id, word_text, definition, heat_weight, usage_count FROM prompt_word_card WHERE library_id=?",
            [lib["id"]]
        ).fetchall()
        dim_cards[lk] = [dict(c) for c in cards]
        dim_lib_id[lk] = lib["id"]

    # ── 3. 每镜头匹配词卡 ──
    def _match_dim(desc, dim_key, cards):
        """在描述文本中匹配维度词卡
        策略: ①纯中文部分精确/子串匹配 ②2-gram交叉命中 ③拆词反向匹配"""
        import unicodedata
        matched = []
        desc_no_punc = re.sub(r"[，。、；：！？\s·""''「」『』【】（）\\-]+", "", desc)

        for card in cards:
            raw = (card["word_text"] or "").strip()
            if not raw or len(raw) < 1:
                continue

            # 提取纯中文核心词(去掉英文标注)
            cn_core = re.sub(r"[a-zA-Z0-9]+", "", raw).strip()
            if not cn_core:
                cn_core = raw

            score = 0

            # ① 精确匹配: 完整词卡文本出现在描述中
            if raw in desc:
                score = 10

            # ② 中文核心词完全匹配: cn_core 是 desc_no_punc 的子串
            elif len(cn_core) >= 1 and cn_core in desc_no_punc:
                score = min(10, 4 + len(cn_core))

            # ③ 中文词拆为2~3字短语分别匹配(如"中景构图"→"中景"+"构图")
            if score == 0 and len(cn_core) >= 2:
                sub_hits = 0
                # 生成所有2-3字连续子串
                sub_parts = []
                for length in (3, 2):
                    for i in range(len(cn_core) - length + 1):
                        sub_parts.append(cn_core[i:i+length])
                for sp in set(sub_parts):  # 去重
                    if sp in desc_no_punc:
                        sub_hits += 1
                if sub_hits >= 1:
                    score = min(7, sub_hits * 3 + 1)

            # ④ 2-gram反向匹配: 描述中的短语出现在词卡中
            if score == 0 and len(desc_no_punc) >= 2:
                desc_phrases = set()
                for i in range(len(desc_no_punc) - 1):
                    desc_phrases.add(desc_no_punc[i:i+2])
                card_phrases = set()
                for i in range(len(cn_core) - 1):
                    card_phrases.add(cn_core[i:i+2])
                overlap = len(desc_phrases & card_phrases)
                if overlap >= 2:
                    score = min(5, overlap + 1)

            # ⑤ 英文token匹配: 描述中的英文词出现在词卡中
            if score == 0:
                eng_tokens = re.findall(r"[a-zA-Z]{2,}", desc)
                for tok in eng_tokens:
                    if tok.lower() in raw.lower():
                        score = 6
                        break

            if score > 0:
                matched.append({"card_id": card["id"], "word": raw, "score": score})

        matched.sort(key=lambda x: x["score"], reverse=True)
        seen = set()
        filtered = []
        for m in matched:
            cn = re.sub(r"[a-zA-Z0-9\s]+", "", m["word"]).strip() or m["word"]
            if cn not in seen:
                filtered.append(m)
                seen.add(cn)
        return filtered[:3]

    scene_matches = []  # [{scene_index, dim_matches: {dim_key: [card_ids]}, unmatched_terms: [str]}]

    for si, shot in enumerate(shots_raw):
        desc = shot["desc"]
        dim_result = {}
        all_matched_words = set()

        # 对每个维度尝试匹配
        for dim_key, cards in dim_cards.items():
            # 跳过非镜头级别的全局维度
            if dim_key in ("quality", "art_style", "era", "region", "transition", "sound_effect", "costume", "negative"):
                continue
            ms = _match_dim(desc, dim_key, cards)
            if ms:
                dim_result[dim_key] = [m["card_id"] for m in ms]
                for m in ms:
                    all_matched_words.add(m["word"])

        scene_matches.append({
            "scene_index": si,
            "start": shot["start"],
            "end": shot["end"],
            "desc": desc,
            "dim_matches": dim_result
        })

    # ── 4. 全局维度的匹配（对整个模版） ──
    full_text = tpl_content
    global_matches = {}
    for dim_key in ("quality", "art_style", "era", "region", "transition", "sound_effect", "costume"):
        if dim_key in dim_cards:
            ms = _match_dim(full_text, dim_key, dim_cards[dim_key])
            if ms:
                global_matches[dim_key] = [m["card_id"] for m in ms]
    # 负面
    if global_negative and "negative" in dim_cards:
        ms = _match_dim(global_negative, "negative", dim_cards["negative"])
        if ms:
            global_matches["negative"] = [m["card_id"] for m in ms]

    # ── 5. 创建项目 ──
    cur = db.execute(
        """INSERT INTO user_project
            (name, total_duration, aspect_ratio, resolution,
             global_style, global_transition, negative_prompt, bgm, sfx, dialogue, template_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        [f"模版: {tpl_meaning[:20] or tpl_category}", global_duration, global_aspect, global_resolution,
         global_style, global_transition, global_negative, "", "", "", tpl_id]
    )
    project_id = cur.lastrowid

    # ── 6. 创建镜头并填充字段 ──
    scene_ids = []
    for si, shot in enumerate(shots_raw):
        duration = shot["end"] - shot["start"]
        if duration <= 0:
            duration = 3
        # 组装镜头字段文本
        field_texts = {}
        sm = scene_matches[si]
        for dim_key, card_ids in sm["dim_matches"].items():
            if not card_ids:
                continue
            words = []
            for cid in card_ids:
                # 查找词卡文本
                cards = dim_cards.get(dim_key, [])
                for c in cards:
                    if c["id"] == cid:
                        words.append(c["word_text"])
                        break
            if words:
                field_texts[dim_key] = ", ".join(words)

        sc = db.execute(
            "INSERT INTO user_project_scene (project_id, scene_order, start_time, end_time, duration, scene_desc) VALUES (?,?,?,?,?,?)",
            [project_id, si + 1, float(shot["start"]), float(shot["end"]), float(duration), shot["desc"]]
        )
        scene_id = sc.lastrowid
        scene_ids.append(scene_id)

        # 立即更新镜头字段（填充匹配到的词卡文本），但跳过 scene_desc（已从模版原文写入）
        if field_texts:
            set_parts = []
            values = []
            for k, v in field_texts.items():
                if k == "scene":
                    continue  # scene_desc 已写模版原文，不覆盖
                col = _scene_field_to_db_column(k)
                if col:
                    set_parts.append(f"{col}=?")
                    values.append(v)
            if set_parts:
                db.execute(
                    f"UPDATE user_project_scene SET {', '.join(set_parts)} WHERE id=?",
                    values + [scene_id]
                )

    # 重算时间轴
    _recalculate_scene_times(project_id)
    safe_commit()

    # ── 7. 构建返回 ──
    return {
        "ok": True,
        "project_id": project_id,
        "scene_count": len(shots_raw),
        "scenes": [
            {
                "id": scene_ids[si],
                "start": shot["start"],
                "end": shot["end"],
                "desc": shot["desc"],
                "fields": sm["dim_matches"]
            }
            for si, (shot, sm) in enumerate(zip(shots_raw, scene_matches))
        ],
        "global_style": global_style,
        "global_aspect": global_aspect,
        "global_duration": global_duration,
        "global_matches": global_matches,
        "fields_populated": sum(
            1 for s in scene_matches if s["dim_matches"]
        )
    }


def _scene_field_to_db_column(field_key):
    """前端词卡字段名 → DB 列名映射"""
    mapping = {
        "camera_move": "camera_move",
        "subject": "subject",
        "scene": "scene_desc",
        "composition": "composition",
        "lighting": "lighting",
        "action": "action",
        "focal_length": "focal_length",
        "texture": "texture",
        "speed": "speed",
        "perspective": "perspective",
        "particles": "particles",
        "weather": "weather",
        "color_grade": "color_grade",
        "emotion": "emotion",
        "natural_force": "natural_force",
        "depth_of_field": "depth_of_field",
        "filter": "filter",
        "film_flaw": "film_flaw",
        "fantasy_physics": "fantasy_physics",
        "env_detail": "environment_detail",
        "shot_scale": "shot_scale",
    }
    return mapping.get(field_key)
