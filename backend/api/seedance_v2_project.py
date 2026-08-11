"""
Seedance V2 分镜项目模块（Phase 3.5 自 api/seedance_v2.py 拆分）
总项目/分镜项目 CRUD / 场景管理 / 拼接引擎 / 系统配置。
路由挂载: 主模块 router.include_router(seedance_v2_project_router)，prefix 同为 /api/seedance/v2
"""

from fastapi import APIRouter, Body, HTTPException, Query

from database import get_db, safe_commit

from .composer_engine import compose_full

router = APIRouter(tags=["seedance-v2-project"])


# ==================== 总项目（父级） ====================

@router.get("/master-projects")
def list_master_projects():
    """获取所有总项目及其子分镜组 — 两级树状导航"""
    db = get_db()
    masters = db.execute("""
        SELECT mp.*,
               (SELECT COUNT(*) FROM master_sub_project WHERE master_project_id=mp.id) as sub_count
        FROM master_project mp ORDER BY mp.updated_at DESC
    """).fetchall()

    result = []
    for m in masters:
        md = dict(m)
        # 加载该总项目下的所有分镜组
        subs = db.execute("""
            SELECT up.*,
                   (SELECT COUNT(*) FROM user_project_scene WHERE project_id=up.id) as scene_count
            FROM user_project up
            JOIN master_sub_project msp ON msp.seedance_project_id = up.id
            WHERE msp.master_project_id = ?
            ORDER BY msp.sort_order, up.updated_at DESC
        """, [m["id"]]).fetchall()
        md["sub_projects"] = [dict(s) for s in subs]
        md["total_sub_count"] = len(subs)
        md["total_scene_count"] = sum(s["scene_count"] for s in subs)
        result.append(md)

    # 未归类的分镜组（不属于任何总项目）
    orphans = db.execute("""
        SELECT up.*,
               (SELECT COUNT(*) FROM user_project_scene WHERE project_id=up.id) as scene_count
        FROM user_project up
        WHERE up.id NOT IN (SELECT seedance_project_id FROM master_sub_project WHERE seedance_project_id IS NOT NULL)
        ORDER BY up.updated_at DESC
    """).fetchall()
    orphan_list = [dict(o) for o in orphans]

    return {
        "masters": result,
        "orphans": orphan_list,
        "orphan_count": len(orphan_list),
        "total_masters": len(result)
    }


# ==================== 项目 CRUD ====================

@router.get("/projects")
def list_projects(search: str = Query(None), master_project_id: int = Query(None), orphaned: bool = Query(False), page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)):
    """获取分镜项目（支持按总项目过滤 or 获取未归类）"""
    db = get_db()
    params = []
    sql_where = ""
    if master_project_id is not None:
        sql_where = " WHERE up.id IN (SELECT seedance_project_id FROM master_sub_project WHERE master_project_id=?)"
        params.append(master_project_id)
    elif orphaned:
        sql_where = " WHERE up.id NOT IN (SELECT seedance_project_id FROM master_sub_project WHERE seedance_project_id IS NOT NULL)"
    if search:
        if sql_where: sql_where += " AND up.name LIKE ?"
        else: sql_where = " WHERE up.name LIKE ?"
        params.append(f"%{search}%")

    total = db.execute(f"SELECT COUNT(*) as cnt FROM user_project up{sql_where}", params).fetchone()["cnt"]
    offset = (page - 1) * page_size
    rows = db.execute(
        f"""SELECT up.*,
        (SELECT COUNT(*) FROM user_project_scene WHERE project_id=up.id) as scene_count,
        (SELECT mp.name FROM master_sub_project msp JOIN master_project mp ON mp.id=msp.master_project_id WHERE msp.seedance_project_id=up.id) as master_project_name
        FROM user_project up{sql_where} ORDER BY up.updated_at DESC LIMIT ? OFFSET ?""",
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

def _recalculate_scene_times(project_id: int, commit: bool = False):
    """
    重新计算所有镜头的 duration 和时间轴。
    规则：
      - 已锁定镜头保持 duration 不变
      - 未锁定镜头均分剩余时长（最少 0.5s），从锁定镜头借时
      - 按 scene_order 顺序生成 start_time/end_time
      - 最后一个镜头吸收舍入误差

    参数:
      commit: 为 True 时内部执行 safe_commit()，否则由调用者管理（推荐）
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

    if commit:
        safe_commit()


@router.post("/projects")
def create_project(data: dict = Body(...)):
    """新建分镜项目（支持全局风格/转场/负词/音频字段 + 可选关联总项目）"""
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
    _recalculate_scene_times(cur.lastrowid)
    safe_commit()

    # 关联总项目
    master_pid = data.get("master_project_id")
    if master_pid:
        existing = db.execute(
            "SELECT id FROM master_sub_project WHERE seedance_project_id=?",
            [cur.lastrowid]
        ).fetchone()
        if not existing:
            max_sort = db.execute(
                "SELECT COALESCE(MAX(sort_order), -1) as mx FROM master_sub_project WHERE master_project_id=?",
                [master_pid]
            ).fetchone()["mx"]
            mp = db.execute("SELECT name FROM master_project WHERE id=?", [master_pid]).fetchone()
            sub_name = (mp["name"] + " · " + name) if mp else name
            db.execute(
                "INSERT INTO master_sub_project"
                "(master_project_id, seedance_project_id, name, sub_type, phase, sort_order)"
                "VALUES (?, ?, ?, 'storyboard', 'P3', ?)",
                [master_pid, cur.lastrowid, sub_name, max_sort + 1]
            )
            safe_commit()

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
    for key in ["name", "total_duration", "aspect_ratio", "resolution", "global_style", "global_transition", "negative_prompt", "audio_enabled"]:
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
    # 关闭外键检查（user_scene_prompt 有残留FK引用已删除的表）
    db.execute("PRAGMA foreign_keys = OFF")
    try:
        # 级联删除镜头和关联 + 清理总项目关联
        db.execute("DELETE FROM master_sub_project WHERE seedance_project_id=?", [project_id])
        db.execute("DELETE FROM user_scene_prompt WHERE scene_id IN (SELECT id FROM user_project_scene WHERE project_id=?)", [project_id])
        db.execute("DELETE FROM user_project_scene WHERE project_id=?", [project_id])
        db.execute("DELETE FROM user_project WHERE id=?", [project_id])
        safe_commit()
    finally:
        db.execute("PRAGMA foreign_keys = ON")
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
                   "film_flaw", "fantasy_physics", "environment_detail", "action", "details",
                   # v4.0.0-phase10: audio
                   "character_voice", "narration", "bgm", "sfx", "audio_enabled"]
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
    # 重算所有镜头时间（统一提交）
    _recalculate_scene_times(project_id)
    safe_commit()

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
        "scene_order", "duration", "is_locked",
        "camera_move", "subject", "scene_desc", "composition", "lighting",
        "focal_length", "texture", "speed", "perspective", "particles", "weather",
        "color_grade", "emotion", "natural_force", "depth_of_field", "filter",
        "film_flaw", "fantasy_physics", "environment_detail", "action", "details",
        # v4.0.0-phase10: audio 4-elements
        "character_voice", "narration", "bgm", "sfx", "audio_enabled",
        # Phase17: 场景模板绑定 + 角色绑定
        "scene_profile_id", "character_id"
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
            val = data[f]
            # 防御：字符串字段自动 trim，空白值统一为空串
            if isinstance(val, str):
                val = val.strip()
            set_parts.append(f"{f}=?")
            values.append(val)

    if not set_parts:
        raise HTTPException(400, "无更新字段")

    set_clause = ", ".join(set_parts)
    values += [scene_id]
    db.execute(f"UPDATE user_project_scene SET {set_clause} WHERE id=?", values)

    if has_recalc:
        _recalculate_scene_times(project_id)
    safe_commit()  # 统一提交：字段更新 + 时间重算

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
    _recalculate_scene_times(project_id)  # 重算时间轴
    safe_commit()  # 统一提交：锁定 + 时间重算
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

    # 关闭外键检查（user_scene_prompt 有残留FK引用已删除的表）
    db.execute("PRAGMA foreign_keys = OFF")
    try:
        db.execute("DELETE FROM user_scene_prompt WHERE scene_id=?", [scene_id])
        db.execute("DELETE FROM user_project_scene WHERE id=?", [scene_id])
        # 重排序号
        db.execute(
            "UPDATE user_project_scene SET scene_order=scene_order-1 WHERE project_id=? AND scene_order>?",
            [project_id, scene["scene_order"]]
        )
        _recalculate_scene_times(project_id)
        safe_commit()
    finally:
        db.execute("PRAGMA foreign_keys = ON")
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
    # 排序后重算时间线并统一提交
    _recalculate_scene_times(project_id)
    safe_commit()

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

# 引擎函数已移至 composer_engine.py，此处保留别名向后兼容
# 直接使用导入的 make_structured_description / fmt_header / fmt_scene 等


@router.post("/projects/{project_id}/compose")
def compose_project(project_id: int, data: dict = Body({})):
    """
    核心拼接引擎 v2.0 — 5平台多格式输出（使用共享引擎 composer_engine）

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
    proj_dict = dict(proj)
    if not include_audio and proj_dict.get("audio_enabled"):
        include_audio = bool(int(proj_dict["audio_enabled"]))

    # 合并前端实时全局参数（未保存的修改也生效）
    for key in ["global_style", "global_transition", "negative_prompt", "aspect_ratio", "resolution", "total_duration"]:
        val = data.get(key)
        if val is not None and str(val).strip():
            proj_dict[key] = str(val).strip()

    # 委托给共享引擎
    result = compose_full(scenes, proj_dict, fmt=fmt, density=density,
                          include_audio=include_audio, db=db)

    # 添加遗留兼容字段（注意 scenes 是 Row 对象，不能用 .get）
    if include_audio:
        audio_shots = []
        for s in scenes:
            audio_shots.append({
                "shot": s["scene_order"],
                "character_voice": s["character_voice"] or s["narration"] or "",
                "bgm": s["bgm"] or "",
                "sfx": s["sfx"] or "",
                "enabled": bool(s["audio_enabled"])
            })
        result["json"]["audio"] = {
            "bgm": data.get("bgm", "") or proj_dict.get("bgm", ""),
            "sfx": data.get("sfx", "") or proj_dict.get("sfx", ""),
            "dialogue": data.get("dialogue", "") or proj_dict.get("dialogue", ""),
            "shot_audio": audio_shots
        }
    else:
        result["json"]["audio"] = None

    if fmt == "json":
        return result["json"]

    return result


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
                    # 2026-08-11: 附加词库缩略图（与词库预览图一致）
                    try:
                        from api.seedance_v2_library import _attach_wc_thumbnail
                        recommendations[field_name] = [_attach_wc_thumbnail(db, dict(c)) for c in cards]
                    except Exception:
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
