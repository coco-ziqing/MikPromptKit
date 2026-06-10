"""
API 路由 — Seedance V2 多镜头结构化组装器 (全功能版)
27套维度词库 / 分镜项目CRUD / 镜头管理 / 拼接引擎 / 联动
"""
import json, math
from fastapi import APIRouter, Query, Body, HTTPException
from database import get_db, safe_commit
from seedance_v2_seed import init_seedance_v2_seed

router = APIRouter(prefix="/api/seedance/v2", tags=["seedance-v2"])


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
    """新建分镜项目"""
    name = (data.get("name") or "").strip() or "未命名项目"
    total_duration = data.get("total_duration", 15)
    aspect_ratio = data.get("aspect_ratio", "16:9")
    resolution = data.get("resolution", "4K")

    max_duration = 15  # Seedance 硬性限制
    if total_duration < 4:
        total_duration = 4
    if total_duration > max_duration:
        raise HTTPException(400, f"总时长不能超过{max_duration}秒")

    db = get_db()
    cur = db.execute(
        "INSERT INTO user_project (name, total_duration, aspect_ratio, resolution) VALUES (?, ?, ?, ?)",
        [name, total_duration, aspect_ratio, resolution]
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
        if fields["total_duration"] < 4:
            fields["total_duration"] = 4
        elif fields["total_duration"] > 15:
            raise HTTPException(400, "总时长不能超过15秒")

    set_clause = ", ".join(f"{k}=?" for k in fields)
    values = list(fields.values()) + [project_id]
    db.execute(f"UPDATE user_project SET {set_clause}, updated_at=datetime('now','localtime') WHERE id=?", values)
    safe_commit()

    # 如果总时长变动，重算所有镜头时间
    if "total_duration" in fields:
        _recalculate_scene_times(project_id)

    return {"ok": True}


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
    extra_fields = ["camera_move", "subject", "scene_desc", "shot_scale", "composition", "lighting",
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
        "camera_move", "subject", "scene_desc", "shot_scale", "composition", "lighting",
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

@router.post("/projects/{project_id}/compose")
def compose_project(project_id: int, data: dict = Body({})):
    """
    核心拼接引擎
    将项目全局参数 + N个镜头的各维度字段 → 拼接为 Seedance 标准提示词
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

    fmt = data.get("format", "seedance")  # seedance | json

    # ---- 全局头部 ----
    header_parts = []
    # 画幅
    ar = proj["aspect_ratio"] or "16:9"
    res = proj["resolution"] or "4K"
    if ar == "16:9":
        header_parts.append(f"横屏{res}")
    elif ar == "9:16":
        header_parts.append(f"竖屏{res}")
    elif ar == "1:1":
        header_parts.append(f"方形{res}")
    elif ar == "2.35:1":
        header_parts.append(f"电影宽屏{res}")
    else:
        header_parts.append(f"{ar} {res}")

    # 全局画风
    if proj["global_style"]:
        header_parts.append(proj["global_style"])

    # 时长 + 帧率
    duration = proj["total_duration"]
    header_parts.append(f"{duration}s")

    # 全局转场
    if proj["global_transition"]:
        header_parts.append(proj["global_transition"])

    header_line = "，".join(header_parts)

    # ---- 多镜头描述 ----
    scene_lines = []
    json_scenes = []

    for sc in scenes:
        st = int(sc["start_time"])
        et = int(sc["end_time"])
        time_str = f"{st}-{et}s"

        # 按公式拼接: 运镜+主体+动作+场景+地域+构图+光影+焦段+质感+速率+氛围+特效+细节
        parts = []
        if sc["camera_move"]:
            parts.append(sc["camera_move"])
        if sc["subject"]:
            parts.append(sc["subject"])
        if sc["action"]:
            parts.append(sc["action"])
        if sc["scene_desc"]:
            parts.append(sc["scene_desc"])
        if sc["composition"]:
            parts.append(sc["composition"])
        if sc["lighting"]:
            parts.append(sc["lighting"])
        if sc["focal_length"]:
            parts.append(sc["focal_length"])
        if sc["texture"]:
            parts.append(sc["texture"])
        if sc["speed"]:
            parts.append(sc["speed"])

        # 氛围/情绪
        mood_parts = []
        if sc["emotion"]:
            mood_parts.append(sc["emotion"])
        if sc["color_grade"]:
            mood_parts.append(sc["color_grade"])
        if sc["weather"]:
            mood_parts.append(sc["weather"])
        if mood_parts:
            parts.append("，".join(mood_parts))

        # 特效
        fx_parts = []
        if sc["particles"]:
            fx_parts.append(sc["particles"])
        if sc["natural_force"]:
            fx_parts.append(sc["natural_force"])
        if sc["fantasy_physics"]:
            fx_parts.append(sc["fantasy_physics"])
        if sc["filter"]:
            fx_parts.append(sc["filter"])
        if fx_parts:
            parts.append("，".join(fx_parts))

        # 细节
        detail_parts = []
        if sc["perspective"]:
            detail_parts.append(sc["perspective"])
        if sc["depth_of_field"]:
            detail_parts.append(sc["depth_of_field"])
        if sc["texture"] and sc["texture"] not in str(parts):
            pass  # already added
        if sc["environment_detail"]:
            detail_parts.append(sc["environment_detail"])
        if sc["film_flaw"]:
            detail_parts.append(sc["film_flaw"])
        if sc["details"]:
            detail_parts.append(sc["details"])
        if detail_parts:
            parts.append("，".join(detail_parts))

        # 过滤空
        scene_desc = "，".join(p for p in parts if p.strip())
        if scene_desc:
            scene_lines.append(f"{time_str}：{scene_desc}")

        json_scenes.append({
            "shot": sc["scene_order"],
            "start": st,
            "end": et,
            "text": scene_desc,
            "fields": {
                "camera_move": sc["camera_move"],
                "subject": sc["subject"],
                "action": sc["action"],
                "scene": sc["scene_desc"],
                "composition": sc["composition"],
                "lighting": sc["lighting"],
                "focal_length": sc["focal_length"],
                "texture": sc["texture"],
                "speed": sc["speed"],
                "emotion": sc["emotion"],
                "color_grade": sc["color_grade"],
                "weather": sc["weather"],
                "particles": sc["particles"],
                "perspective": sc["perspective"],
            }
        })

    # ---- 负面词 ----
    neg = ""
    if proj["negative_prompt"]:
        neg = proj["negative_prompt"]

    # ---- 完整提示词 ----
    full_lines = [header_line]
    full_lines.append("")
    full_lines.extend(scene_lines)
    if neg:
        full_lines.append("")
        full_lines.append(f"负面：{neg}")

    full_text = "\n".join(full_lines).strip()

    # ---- 返回 ----
    json_output = {
        "global": {
            "aspect_ratio": ar,
            "resolution": res,
            "duration": duration,
            "style": proj["global_style"] or "",
            "transition": proj["global_transition"] or "",
            "negative": neg
        },
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
        "duration": duration
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
