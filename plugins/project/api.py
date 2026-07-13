# -*- coding: utf-8 -*-
"""
com.promptkit.project API路由 v1.1.0
挂载前缀: /api/plugins/com.promptkit.project/

新增: 任务详情/编辑弹窗支持/任务跨列移动/任务关联镜头/里程碑编辑/列编辑/甘特时间轴/项目CRUD
"""
import json, os, sqlite3, time
from fastapi import APIRouter, HTTPException, Query, Body
from typing import Optional

router = APIRouter(tags=["项目管理插件"])

DB = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "prompts.db")

def _ro():
    from database import get_db
    return get_db()

def _rw():
    conn = sqlite3.connect(DB, timeout=2)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=2000")
    return conn

def _rows(rows):
    return [dict(r) for r in rows]

def _safe_commit(db, max_retries=5):
    """WAL 模式下重试提交"""
    for i in range(max_retries):
        try:
            db.commit()
            return
        except sqlite3.OperationalError:
            if i == max_retries - 1:
                raise
            time.sleep(0.05 * (i + 1))

# ============================================================
# 项目 CRUD
# ============================================================

@router.get("/project/{project_id}")
def get_project(project_id: int):
    db = _ro()
    proj = db.execute("SELECT * FROM user_project WHERE id=?", [project_id]).fetchone()
    if not proj: raise HTTPException(404, "项目不存在")
    scenes = _rows(db.execute("SELECT * FROM user_project_scene WHERE project_id=? ORDER BY sort_order", [project_id]).fetchall())
    # 团队数据统一挂 master 层：由该 seedance 分镜项目反查所属总项目
    sub = db.execute("SELECT master_project_id FROM master_sub_project WHERE seedance_project_id=?", [project_id]).fetchone()
    mid = sub["master_project_id"] if sub else 0
    ts = db.execute("SELECT COUNT(*) as total, COALESCE(SUM(CASE WHEN status='done' THEN 1 ELSE 0 END),0) as done FROM project_tasks WHERE master_project_id=?", [mid]).fetchone()
    ms = db.execute("SELECT COUNT(*) as total, COALESCE(SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END),0) as done FROM project_milestones WHERE master_project_id=?", [mid]).fetchone()
    mems = db.execute("SELECT COUNT(*) FROM project_members WHERE master_project_id=?", [mid]).fetchone()[0]
    return {"ok": True, "project": dict(proj), "scenes": scenes,
            "stats": {"total_tasks": ts["total"], "done_tasks": ts["done"],
                      "total_milestones": ms["total"], "done_milestones": ms["done"],
                      "member_count": mems}}

@router.put("/project/{project_id}")
def update_project(project_id: int, data: dict = Body(...)):
    db = _rw()
    try:
        proj = db.execute("SELECT id FROM user_project WHERE id=?", [project_id]).fetchone()
        if not proj: raise HTTPException(404, "项目不存在")
        for k in ["name", "description", "aspect_ratio", "resolution", "total_duration", "progress_pct"]:
            if k in data:
                db.execute(f"UPDATE user_project SET {k}=?,updated_at=datetime('now','localtime') WHERE id=?",
                           [data[k], project_id])
        db.commit()
        return {"ok": True}
    finally: db.close()

@router.delete("/project/{project_id}")
def delete_project(project_id: int):
    """删除 seedance 镜头项目（手动级联清理分镜及关联，因运行时 FK 未开启）"""
    db = _rw()
    try:
        proj = db.execute("SELECT id FROM user_project WHERE id=?", [project_id]).fetchone()
        if not proj: raise HTTPException(404, "项目不存在")
        def _try(sql, p=()):
            try: db.execute(sql, p)
            except sqlite3.OperationalError: pass
        # 子项目引用置空（原 ON DELETE SET NULL 设计）
        _try("UPDATE master_sub_project SET seedance_project_id=NULL WHERE seedance_project_id=?", [project_id])
        # 镜头及其关联（任务-镜头 / 镜头-词卡）
        _try("DELETE FROM project_task_scene WHERE scene_id IN (SELECT id FROM user_project_scene WHERE project_id=?)", [project_id])
        _try("DELETE FROM user_scene_prompt WHERE scene_id IN (SELECT id FROM user_project_scene WHERE project_id=?)", [project_id])
        _try("DELETE FROM user_project_scene WHERE project_id=?", [project_id])
        db.execute("DELETE FROM user_project WHERE id=?", [project_id])
        db.commit()
        return {"ok": True, "message": "项目已删除"}
    finally: db.close()

# ============================================================
# 看板列 — 新增编辑 + 单列查询
# ============================================================

@router.get("/columns")
def list_columns(master_project_id: int = Query(..., description="总项目ID")):
    db = _ro()
    rows = db.execute("SELECT * FROM project_columns WHERE master_project_id=? ORDER BY sort_order", [master_project_id]).fetchall()
    cols = []
    for r in rows:
        c = dict(r)
        c["task_count"] = db.execute("SELECT COUNT(*) FROM project_tasks WHERE column_id=?", [r["id"]]).fetchone()[0]
        cols.append(c)
    return {"ok": True, "columns": cols}

@router.get("/columns/{column_id}")
def get_column(column_id: int):
    db = _ro()
    col = db.execute("SELECT * FROM project_columns WHERE id=?", [column_id]).fetchone()
    if not col: raise HTTPException(404, "列不存在")
    tasks = _rows(db.execute("SELECT * FROM project_tasks WHERE column_id=? ORDER BY sort_order", [column_id]).fetchall())
    return {"ok": True, "column": dict(col), "tasks": tasks}

@router.post("/columns")
def create_column(data: dict = Body(...)):
    mid = data.get("master_project_id")
    name = (data.get("name", "")).strip()
    if not name: raise HTTPException(400, "name 必填")
    if not mid: raise HTTPException(400, "master_project_id 必填")
    db = _rw()
    try:
        max_o = db.execute("SELECT COALESCE(MAX(sort_order),-1)+1 FROM project_columns WHERE master_project_id=?", [mid]).fetchone()[0]
        db.execute("INSERT INTO project_columns (master_project_id,name,color,sort_order,phase) VALUES (?,?,?,?,'P3')",
                   [mid, name, data.get("color", "#6b7280"), max_o])
        db.commit()
        nid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        return {"ok": True, "id": nid}
    finally: db.close()

@router.put("/columns/{column_id}")
def update_column(column_id: int, data: dict = Body(...)):
    db = _rw()
    try:
        col = db.execute("SELECT id FROM project_columns WHERE id=?", [column_id]).fetchone()
        if not col: raise HTTPException(404, "列不存在")
        for k in ["name", "color", "sort_order"]:
            if k in data:
                db.execute(f"UPDATE project_columns SET {k}=? WHERE id=?", [data[k], column_id])
        db.commit()
        return {"ok": True}
    finally: db.close()

@router.delete("/columns/{column_id}")
def delete_column(column_id: int):
    db = _rw()
    try:
        col = db.execute("SELECT master_project_id FROM project_columns WHERE id=?", [column_id]).fetchone()
        if not col: raise HTTPException(404, "列不存在")
        first = db.execute("SELECT id FROM project_columns WHERE master_project_id=? AND id!=? ORDER BY sort_order LIMIT 1",
                           [col["master_project_id"], column_id]).fetchone()
        if first: db.execute("UPDATE project_tasks SET column_id=? WHERE column_id=?", [first["id"], column_id])
        db.execute("DELETE FROM project_columns WHERE id=?", [column_id])
        db.commit()
        return {"ok": True}
    finally: db.close()

# ============================================================
# 任务 — 新增详情/跨列拖拽/关联镜头
# ============================================================

@router.get("/tasks")
def list_tasks(master_project_id: int = Query(..., description="总项目ID"), column_id: Optional[int] = Query(None)):
    db = _ro()
    sql = """SELECT t.*, c.name as col_name, c.color as col_color,
             m.real_name as assignee_name, m.avatar as assignee_avatar, m.avatar_color as assignee_color
             FROM project_tasks t
             LEFT JOIN project_columns c ON t.column_id=c.id
             LEFT JOIN project_members m ON t.assignee_id=m.id
             WHERE t.master_project_id=?"""
    params = [master_project_id]
    if column_id:
        sql += " AND t.column_id=?"
        params.append(column_id)
    sql += " ORDER BY t.sort_order"
    return {"ok": True, "tasks": _rows(db.execute(sql, params).fetchall())}

@router.get("/tasks/{task_id}")
def get_task(task_id: int):
    db = _ro()
    t = db.execute("""SELECT t.*, c.name as col_name, c.color as col_color,
                      m.real_name as assignee_name, m.avatar as assignee_avatar, m.avatar_color as assignee_color
                      FROM project_tasks t
                      LEFT JOIN project_columns c ON t.column_id=c.id
                      LEFT JOIN project_members m ON t.assignee_id=m.id
                      WHERE t.id=?""", [task_id]).fetchone()
    if not t: raise HTTPException(404, "任务不存在")
    task = dict(t)
    # 关联的镜头
    linked_scenes = _rows(db.execute(
        "SELECT s.* FROM user_project_scene s INNER JOIN project_task_scene ts ON ts.scene_id=s.id WHERE ts.task_id=?",
        [task_id]).fetchall())
    task["linked_scenes"] = linked_scenes
    return {"ok": True, "task": task}

@router.post("/tasks")
def create_task(data: dict = Body(...)):
    mid = data.get("master_project_id")
    title = (data.get("title", "")).strip()
    if not title: raise HTTPException(400, "title 必填")
    if not mid: raise HTTPException(400, "master_project_id 必填")
    db = _rw()
    try:
        cid = data.get("column_id")
        if not cid:
            r = db.execute("SELECT id FROM project_columns WHERE master_project_id=? ORDER BY sort_order LIMIT 1", [mid]).fetchone()
            cid = r["id"] if r else None
        db.execute("""INSERT INTO project_tasks
            (master_project_id,column_id,title,description,assignee_id,priority,due_date,sort_order,phase)
            VALUES (?,?,?,?,?,?,?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM project_tasks WHERE master_project_id=?),'P3')""",
            [mid, cid, title, data.get("description", ""), data.get("assignee_id"),
             data.get("priority", 0), data.get("due_date"), mid])
        db.commit()
        nid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        return {"ok": True, "id": nid}
    finally: db.close()

@router.put("/tasks/{task_id}")
def update_task(task_id: int, data: dict = Body(...)):
    db = _rw()
    try:
        t = db.execute("SELECT master_project_id FROM project_tasks WHERE id=?", [task_id]).fetchone()
        if not t: raise HTTPException(404, "任务不存在")
        for k in ["title", "description", "column_id", "assignee_id", "priority", "due_date", "status", "sort_order"]:
            if k in data:
                if k == "status" and data[k] == "done":
                    db.execute("UPDATE project_tasks SET status=?,completed_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE id=?", [data[k], task_id])
                elif k == "status":
                    db.execute("UPDATE project_tasks SET status=?,completed_at=NULL,updated_at=datetime('now','localtime') WHERE id=?", [data[k], task_id])
                else:
                    db.execute(f"UPDATE project_tasks SET {k}=?,updated_at=datetime('now','localtime') WHERE id=?", [data[k], task_id])
        db.commit()
        _sync(t["master_project_id"])
        return {"ok": True}
    finally: db.close()

@router.put("/tasks/{task_id}/move")
def move_task(task_id: int, data: dict = Body(...)):
    """跨列拖拽：更新 column_id + 可选 sort_order
    Body: {"column_id": int, "sort_order": int|null}
    """
    db = _rw()
    try:
        t = db.execute("SELECT master_project_id FROM project_tasks WHERE id=?", [task_id]).fetchone()
        if not t: raise HTTPException(404, "任务不存在")
        if "column_id" in data:
            db.execute("UPDATE project_tasks SET column_id=?,updated_at=datetime('now','localtime') WHERE id=?",
                       [data["column_id"], task_id])
        if "sort_order" in data:
            db.execute("UPDATE project_tasks SET sort_order=?,updated_at=datetime('now','localtime') WHERE id=?",
                       [data["sort_order"], task_id])
        db.commit()
        _sync(t["master_project_id"])
        return {"ok": True}
    finally: db.close()

@router.delete("/tasks/{task_id}")
def delete_task(task_id: int):
    db = _rw()
    try:
        t = db.execute("SELECT master_project_id FROM project_tasks WHERE id=?", [task_id]).fetchone()
        if not t: raise HTTPException(404, "任务不存在")
        db.execute("DELETE FROM project_task_scene WHERE task_id=?", [task_id])
        db.execute("DELETE FROM project_tasks WHERE id=?", [task_id])
        db.commit()
        _sync(t["master_project_id"])
        return {"ok": True}
    finally: db.close()

# ============================================================
# 任务 ↔ 镜头关联
# ============================================================

@router.get("/tasks/{task_id}/scenes")
def list_task_scenes(task_id: int):
    db = _ro()
    scenes = _rows(db.execute(
        "SELECT s.* FROM user_project_scene s INNER JOIN project_task_scene ts ON ts.scene_id=s.id WHERE ts.task_id=? ORDER BY s.sort_order",
        [task_id]).fetchall())
    return {"ok": True, "scenes": scenes}

@router.post("/tasks/{task_id}/link-scene")
def link_scene_to_task(task_id: int, data: dict = Body(...)):
    """关联镜头到任务 Body: {"scene_id": int}"""
    sid = data.get("scene_id")
    if not sid: raise HTTPException(400, "scene_id 必填")
    db = _rw()
    try:
        t = db.execute("SELECT id FROM project_tasks WHERE id=?", [task_id]).fetchone()
        if not t: raise HTTPException(404, "任务不存在")
        s = db.execute("SELECT id FROM user_project_scene WHERE id=?", [sid]).fetchone()
        if not s: raise HTTPException(400, "镜头不存在")
        exists = db.execute("SELECT id FROM project_task_scene WHERE task_id=? AND scene_id=?", [task_id, sid]).fetchone()
        if not exists:
            db.execute("INSERT INTO project_task_scene (task_id, scene_id) VALUES (?,?)", [task_id, sid])
            db.commit()
        return {"ok": True}
    finally: db.close()

@router.delete("/tasks/{task_id}/unlink-scene/{scene_id}")
def unlink_scene_from_task(task_id: int, scene_id: int):
    db = _rw()
    try:
        db.execute("DELETE FROM project_task_scene WHERE task_id=? AND scene_id=?", [task_id, scene_id])
        db.commit()
        return {"ok": True}
    finally: db.close()

@router.get("/project/{project_id}/all-task-scenes")
def all_task_scenes(project_id: int):
    """返回该项目所有任务-镜头关联关系（团队任务挂 master 层，经子项目映射）"""
    db = _ro()
    sub = db.execute("SELECT master_project_id FROM master_sub_project WHERE seedance_project_id=?", [project_id]).fetchone()
    mid = sub["master_project_id"] if sub else 0
    rows = _rows(db.execute(
        """SELECT ts.task_id, ts.scene_id, s.name as scene_name, s.scene_number, t.title as task_title
           FROM project_task_scene ts
           JOIN user_project_scene s ON ts.scene_id=s.id
           JOIN project_tasks t ON ts.task_id=t.id
           WHERE t.master_project_id=? ORDER BY ts.task_id""",
        [mid]).fetchall())
    return {"ok": True, "links": rows}

# ============================================================
# 里程碑 — 原有 CRUD + 任务关联
# ============================================================

@router.get("/milestones")
def list_milestones(master_project_id: int = Query(..., description="总项目ID")):
    db = _ro()
    rows = db.execute("SELECT * FROM project_milestones WHERE master_project_id=? ORDER BY sort_order, due_date", [master_project_id]).fetchall()
    return {"ok": True, "milestones": _rows(rows)}

@router.get("/milestones/{milestone_id}")
def get_milestone(milestone_id: int):
    db = _ro()
    m = db.execute("SELECT * FROM project_milestones WHERE id=?", [milestone_id]).fetchone()
    if not m: raise HTTPException(404, "里程碑不存在")
    return {"ok": True, "milestone": dict(m)}

@router.post("/milestones")
def create_milestone(data: dict = Body(...)):
    mid = data.get("master_project_id")
    title = (data.get("title", "")).strip()
    if not title: raise HTTPException(400, "title 必填")
    if not mid: raise HTTPException(400, "master_project_id 必填")
    db = _rw()
    try:
        max_o = db.execute("SELECT COALESCE(MAX(sort_order),-1)+1 FROM project_milestones WHERE master_project_id=?", [mid]).fetchone()[0]
        db.execute("INSERT INTO project_milestones (master_project_id,title,description,due_date,sort_order,phase) VALUES (?,?,?,?,?,'P3')",
                   [mid, title, data.get("description", ""), data.get("due_date"), max_o])
        db.commit()
        return {"ok": True, "id": db.execute("SELECT last_insert_rowid()").fetchone()[0]}
    finally: db.close()

@router.put("/milestones/{milestone_id}")
def update_milestone(milestone_id: int, data: dict = Body(...)):
    db = _rw()
    try:
        for k in ["title", "description", "due_date", "sort_order"]:
            if k in data:
                db.execute(f"UPDATE project_milestones SET {k}=? WHERE id=?", [data[k], milestone_id])
        if data.get("completed"):
            db.execute("UPDATE project_milestones SET completed_at=datetime('now','localtime') WHERE id=? AND completed_at IS NULL", [milestone_id])
        elif "completed" in data and not data["completed"]:
            db.execute("UPDATE project_milestones SET completed_at=NULL WHERE id=?", [milestone_id])
        db.commit()
        return {"ok": True}
    finally: db.close()

@router.delete("/milestones/{milestone_id}")
def delete_milestone(milestone_id: int):
    db = _rw()
    try:
        db.execute("DELETE FROM project_milestones WHERE id=?", [milestone_id])
        db.commit()
        return {"ok": True}
    finally: db.close()

# ============================================================
# 甘特图 — 增强版：返回日期范围 + 任务时间线
# ============================================================

@router.get("/gantt")
def gantt(master_project_id: int = Query(0), project_id: int = Query(0)):
    db = _ro()
    mid = master_project_id or project_id  # 兼容前端历史传参（project_id 实为 masterId）
    proj = db.execute("SELECT * FROM master_project WHERE id=?", [mid]).fetchone()
    if not proj: raise HTTPException(404, "项目不存在")

    # 里程碑（含关联任务数）
    ms_raw = _rows(db.execute("SELECT * FROM project_milestones WHERE master_project_id=? ORDER BY sort_order", [mid]).fetchall())
    milestones = []
    for m in ms_raw:
        m["task_count"] = db.execute(
            "SELECT COUNT(*) FROM project_tasks WHERE master_project_id=? AND due_date=?",
            [mid, m["due_date"]]).fetchone()[0]
        milestones.append(m)

    # 任务（带成员信息）
    tasks = _rows(db.execute(
        """SELECT t.*, c.name as col_name, c.color as col_color,
           m.real_name as assignee_name, m.avatar as assignee_avatar
           FROM project_tasks t
           LEFT JOIN project_columns c ON t.column_id=c.id
           LEFT JOIN project_members m ON t.assignee_id=m.id
           WHERE t.master_project_id=? ORDER BY t.sort_order""",
        [mid]).fetchall())

    # 计算甘特图日期范围
    all_dates = []
    for m in milestones:
        if m["due_date"]: all_dates.append(m["due_date"])
    for t in tasks:
        if t["due_date"]: all_dates.append(t["due_date"])
        if t["created_at"]: all_dates.append(t["created_at"][:10])

    date_range = {"start": None, "end": None, "span_days": 0}
    if all_dates:
        all_dates.sort()
        date_range["start"] = all_dates[0][:10] if len(all_dates[0])>=10 else all_dates[0]
        date_range["end"] = all_dates[-1][:10] if len(all_dates[-1])>=10 else all_dates[-1]
        # 简单计算天数差（不依赖 datetime）
        try:
            from datetime import datetime
            s = datetime.strptime(date_range["start"][:10], "%Y-%m-%d")
            e = datetime.strptime(date_range["end"][:10], "%Y-%m-%d")
            date_range["span_days"] = max((e - s).days + 1, 30)
        except:
            date_range["span_days"] = 30

    return {"ok": True, "project": dict(proj), "milestones": milestones,
            "tasks": tasks, "date_range": date_range}

# ============================================================
# 仪表盘 — 增强版
# ============================================================

@router.get("/dashboard")
def dashboard(master_project_id: int = Query(..., description="总项目ID")):
    db = _ro()
    proj = db.execute("SELECT * FROM master_project WHERE id=?", [master_project_id]).fetchone()
    if not proj: raise HTTPException(404, "总项目不存在")
    sc = db.execute("SELECT COUNT(*) FROM user_project_scene WHERE project_id IN (SELECT seedance_project_id FROM master_sub_project WHERE master_project_id=?)", [master_project_id]).fetchone()[0]
    ts = db.execute("""SELECT COUNT(*) as t,
        COALESCE(SUM(CASE WHEN status='done' THEN 1 ELSE 0 END),0) as d,
        COALESCE(SUM(CASE WHEN status!='done' AND status!='' THEN 1 ELSE 0 END),0) as p,
        COALESCE(SUM(CASE WHEN priority>=2 THEN 1 ELSE 0 END),0) as hp
        FROM project_tasks WHERE master_project_id=?""", [master_project_id]).fetchone()
    ms = db.execute("""SELECT COUNT(*) as t,
        COALESCE(SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END),0) as c
        FROM project_milestones WHERE master_project_id=?""", [master_project_id]).fetchone()
    cd = _rows(db.execute("""SELECT c.name, c.color, COUNT(t.id) as tc
        FROM project_columns c LEFT JOIN project_tasks t ON t.column_id=c.id
        WHERE c.master_project_id=? GROUP BY c.id ORDER BY c.sort_order""", [master_project_id]).fetchall())
    recent = _rows(db.execute(
        "SELECT id, title, status, updated_at FROM project_tasks WHERE master_project_id=? AND updated_at IS NOT NULL ORDER BY updated_at DESC LIMIT 10",
        [master_project_id]).fetchall())
    workload = _rows(db.execute(
        """SELECT m.id as member_id, m.real_name, m.avatar, m.avatar_color, m.role,
           COUNT(t.id) as task_count,
           COALESCE(SUM(CASE WHEN t.status='done' THEN 1 ELSE 0 END),0) as done_count
           FROM project_members m
           LEFT JOIN project_tasks t ON t.assignee_id=m.id
           WHERE m.master_project_id=?
           GROUP BY m.id ORDER BY task_count DESC""",
        [master_project_id]).fetchall())

    tt, td = ts["t"], ts["d"]
    pct = round(td/tt*100) if tt > 0 else 0
    return {"ok": True, "project": dict(proj),
            "stats": {"scene_count": sc, "total_tasks": tt, "done_tasks": td,
                      "pending_tasks": ts["p"], "high_priority_tasks": ts["hp"],
                      "total_milestones": ms["t"], "completed_milestones": ms["c"],
                      "progress_pct": pct},
            "column_distribution": cd, "recent_activity": recent, "member_workload": workload}

# ============================================================
# 团队管理 — 保持不变 + org-tree 增强
# ============================================================

CREW_ROLES = {
    "executive_producer": {"name": "总制片人", "level": 10, "duty": "项目总控：预算/排期/资源协调/团队管理/交付验收", "icon": "🎬"},
    "director":          {"name": "总导演",     "level": 9,  "duty": "创意决策：整体风格定调/镜头审核/成片把控/艺术方向", "icon": "🎥"},
    "screenwriter":      {"name": "总编剧",     "level": 8,  "duty": "内容创作：剧本/角色设定/对白/叙事结构/AI提示词架构", "icon": "📝"},
    "prompt_engineer":   {"name": "提示词工程师", "level": 7, "duty": "提示词生产：正向/负向提示词库/风格模板/参数调优", "icon": "⚙️"},
    "storyboard_artist": {"name": "分镜师",     "level": 6,  "duty": "分镜设计：镜头构图/运镜方案/景别选取/画面连贯性", "icon": "🎞️"},
    "visual_designer":   {"name": "视觉设计师",   "level": 5, "duty": "视觉生产：角色立绘/场景概念图/色彩方案/风格样稿", "icon": "🎨"},
    "animator":          {"name": "动效师",     "level": 5,  "duty": "动效实现：图生视频/运动控制/转场特效/粒子系统", "icon": "✨"},
    "sound_designer":    {"name": "音频设计师",   "level": 4, "duty": "音频制作：BGM选曲/音效合成/对白配音/混音输出", "icon": "🎵"},
    "editor":            {"name": "剪辑师",     "level": 4,  "duty": "后期合成：素材拼接/节奏调整/字幕包装/成片输出", "icon": "✂️"},
    "qa_reviewer":       {"name": "质检员",     "level": 3,  "duty": "质量审查：逐镜头抽检/一致性问题/瑕疵标注/验收报告", "icon": "🔍"},
    "coordinator":       {"name": "统筹助理",     "level": 2, "duty": "协调支持：素材管理/进度追踪/跨组沟通/会议记录", "icon": "📋"},
    "viewer":            {"name": "观察者",     "level": 1,  "duty": "只读权限：查看项目进度/浏览看板/访问资产库", "icon": "👁️"},
}

DEFAULT_PERMISSIONS = {
    "executive_producer": {"can_manage_members": True, "can_edit_project": True, "can_delete_tasks": True, "can_approve": True, "can_export": True},
    "director":          {"can_manage_members": False, "can_edit_project": True, "can_delete_tasks": True, "can_approve": True, "can_export": True},
    "screenwriter":      {"can_manage_members": False, "can_edit_project": False, "can_delete_tasks": False, "can_approve": False, "can_export": True},
    "prompt_engineer":   {"can_manage_members": False, "can_edit_project": False, "can_delete_tasks": False, "can_approve": False, "can_export": True},
    "storyboard_artist": {"can_manage_members": False, "can_edit_project": False, "can_delete_tasks": False, "can_approve": False, "can_export": True},
    "visual_designer":   {"can_manage_members": False, "can_edit_project": False, "can_delete_tasks": False, "can_approve": False, "can_export": True},
    "animator":          {"can_manage_members": False, "can_edit_project": False, "can_delete_tasks": False, "can_approve": False, "can_export": True},
    "sound_designer":    {"can_manage_members": False, "can_edit_project": False, "can_delete_tasks": False, "can_approve": False, "can_export": True},
    "editor":            {"can_manage_members": False, "can_edit_project": False, "can_delete_tasks": False, "can_approve": False, "can_export": True},
    "qa_reviewer":       {"can_manage_members": False, "can_edit_project": False, "can_delete_tasks": False, "can_approve": True, "can_export": True},
    "coordinator":       {"can_manage_members": False, "can_edit_project": False, "can_delete_tasks": False, "can_approve": False, "can_export": False},
    "viewer":            {"can_manage_members": False, "can_edit_project": False, "can_delete_tasks": False, "can_approve": False, "can_export": False},
}

def _enrich_member(m):
    role_key = m.get("role", "viewer")
    role_info = CREW_ROLES.get(role_key, CREW_ROLES["viewer"])
    perms = json.loads(m.get("permissions_json", "") or "{}")
    if not perms:
        perms = dict(DEFAULT_PERMISSIONS.get(role_key, DEFAULT_PERMISSIONS["viewer"]))
    m["role_name"] = role_info["name"]
    m["role_icon"] = role_info["icon"]
    m["role_level"] = role_info["level"]
    m["role_duty"] = role_info["duty"]
    m["real_name"] = m.get("real_name", "") or ""
    m["duty"] = m.get("duty", "") or ""
    m["avatar"] = m.get("avatar", "") or ""
    m["avatar_color"] = m.get("avatar_color", "") or ""
    m["phone"] = m.get("phone", "") or ""
    m["email"] = m.get("email", "") or ""
    m["permissions"] = perms
    return m

@router.get("/roles")
def list_roles():
    roles = []
    for key, info in sorted(CREW_ROLES.items(), key=lambda x: -x[1]["level"]):
        roles.append({"key": key, "name": info["name"], "level": info["level"], "duty": info["duty"], "icon": info["icon"]})
    return {"ok": True, "roles": roles}

@router.get("/members")
def list_members(master_project_id: int = Query(..., description="总项目ID")):
    db = _ro()
    rows = db.execute("SELECT * FROM project_members WHERE master_project_id=? ORDER BY joined_at", [master_project_id]).fetchall()
    return {"ok": True, "members": [_enrich_member(dict(r)) for r in rows]}

@router.get("/members/org-tree")
def get_org_tree(master_project_id: int = Query(..., description="总项目ID")):
    db = _ro()
    rows = db.execute(
        "SELECT * FROM project_members WHERE master_project_id=? ORDER BY parent_member_id NULLS FIRST, joined_at",
        [master_project_id]).fetchall()
    members = [_enrich_member(dict(r)) for r in rows]
    member_map = {m["id"]: m for m in members}
    for m in members:
        m["children"] = []
    roots = []
    for m in members:
        pid = m.get("parent_member_id")
        if pid and pid in member_map:
            member_map[pid]["children"].append(m)
        else:
            roots.append(m)
    return {"ok": True, "tree": roots, "total": len(members)}

@router.get("/members/{member_id}")
def get_member(member_id: int):
    db = _ro()
    r = db.execute("SELECT * FROM project_members WHERE id=?", [member_id]).fetchone()
    if not r: raise HTTPException(404, "成员不存在")
    m = _enrich_member(dict(r))
    proj = db.execute("SELECT name,id FROM master_project WHERE id=?", [m["master_project_id"]]).fetchone()
    m["project_name"] = proj["name"] if proj else ""
    ts = db.execute("SELECT COUNT(*) as t, COALESCE(SUM(CASE WHEN status='done' THEN 1 ELSE 0 END),0) as d FROM project_tasks WHERE assignee_id=?", [member_id]).fetchone()
    m["task_total"] = ts["t"]
    m["task_done"] = ts["d"]
    return {"ok": True, "member": m}

@router.post("/members")
def add_member(data: dict = Body(...)):
    mid = data.get("master_project_id")
    uid = data.get("user_id")
    role = data.get("role", "viewer")
    real_name = data.get("real_name", "")
    duty = data.get("duty", "")
    avatar = data.get("avatar", "")
    avatar_color = data.get("avatar_color", "")
    phone = data.get("phone", "")
    email = data.get("email", "")
    permissions = data.get("permissions")
    if not mid: raise HTTPException(400, "master_project_id 必填")
    if not uid: raise HTTPException(400, "user_id 必填")
    if role not in CREW_ROLES:
        raise HTTPException(400, f"无效角色: {role}")
    db = _rw()
    try:
        if db.execute("SELECT id FROM project_members WHERE master_project_id=? AND user_id=?", [mid, uid]).fetchone():
            raise HTTPException(409, "该用户已在项目中")
        perms_json = json.dumps(permissions or DEFAULT_PERMISSIONS.get(role, {}), ensure_ascii=False)
        db.execute(
            "INSERT INTO project_members (master_project_id,user_id,role,real_name,duty,avatar,avatar_color,phone,email,permissions_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
            [mid, uid, role, real_name, duty, avatar, avatar_color, phone, email, perms_json])
        db.commit()
        return {"ok": True}
    finally: db.close()

@router.put("/members/{member_id}")
def update_member(member_id: int, data: dict = Body(...)):
    db = _rw()
    try:
        for k in ["role", "real_name", "duty", "avatar", "avatar_color", "phone", "email"]:
            if k in data:
                db.execute(f"UPDATE project_members SET {k}=? WHERE id=?", [data[k], member_id])
        if "permissions" in data:
            db.execute("UPDATE project_members SET permissions_json=? WHERE id=?",
                       [json.dumps(data["permissions"], ensure_ascii=False), member_id])
        db.commit()
        return {"ok": True}
    finally: db.close()

@router.delete("/members/{member_id}")
def remove_member(member_id: int):
    db = _rw()
    try:
        db.execute("DELETE FROM project_members WHERE id=?", [member_id])
        db.commit()
        return {"ok": True}
    finally: db.close()

@router.put("/members/{member_id}/parent")
def set_member_parent(member_id: int, data: dict = Body(...)):
    db = _rw()
    try:
        member = db.execute("SELECT id, master_project_id FROM project_members WHERE id=?", [member_id]).fetchone()
        if not member: raise HTTPException(404, "成员不存在")
        parent_id = data.get("parent_member_id")
        if parent_id is not None:
            parent = db.execute("SELECT id, master_project_id, parent_member_id FROM project_members WHERE id=?", [parent_id]).fetchone()
            if not parent: raise HTTPException(400, "上级成员不存在")
            if parent["master_project_id"] != member["master_project_id"]: raise HTTPException(400, "上级成员不在同一项目")
            if parent_id == member_id: raise HTTPException(400, "不能将自己设为上级")
            cursor = parent_id; visited = set()
            while cursor:
                if cursor == member_id: raise HTTPException(400, "不能形成循环层级关系")
                if cursor in visited: break
                visited.add(cursor)
                anc = db.execute("SELECT parent_member_id FROM project_members WHERE id=?", [cursor]).fetchone()
                cursor = anc["parent_member_id"] if anc else None
        db.execute("UPDATE project_members SET parent_member_id=? WHERE id=?", [parent_id, member_id])
        db.commit()
        return {"ok": True, "message": "层级关系已更新"}
    finally: db.close()


# ============================================================
# 辅助
# ============================================================

def _sync(mid):
    """进度在 dashboard 读取时按 master 实时计算，无需写回 user_project；保留占位以兼容调用点"""
    return

# ============================================================
# Phase22 — 总项目 (master_project)
# ============================================================

PROJECT_TYPES = ["short_film", "ad", "mv", "tutorial", "other"]
PHASES = ["P0", "P1", "P2", "P3", "P4", "P5", "P6"]
PHASE_NAMES = {
    "P0": {"zh": "前期策划", "en": "Ideation", "icon": "🧠"},
    "P1": {"zh": "预生产", "en": "Pre-production", "icon": "📝"},
    "P2": {"zh": "资产准备", "en": "Assets", "icon": "🎨"},
    "P3": {"zh": "分镜生产", "en": "Production", "icon": "🎬"},
    "P4": {"zh": "后期合成", "en": "Post-production", "icon": "✂️"},
    "P5": {"zh": "审核交付", "en": "Review", "icon": "✅"},
    "P6": {"zh": "复盘归档", "en": "Archive", "icon": "📊"},
}

@router.get("/master/list")
def list_master_projects():
    """列出所有总项目"""
    db = _ro()
    rows = _rows(db.execute(
        "SELECT mp.*, (SELECT COUNT(*) FROM master_sub_project WHERE master_project_id=mp.id) as sub_count, (SELECT COUNT(*) FROM master_asset WHERE master_project_id=mp.id) as asset_count FROM master_project mp ORDER BY mp.updated_at DESC"
    ).fetchall())
    return {"ok": True, "projects": rows}

@router.get("/master/{master_id}")
def get_master_project(master_id: int):
    """获取总项目详情 — 包含子项目、资产、阶段统计"""
    db = _ro()
    mp = db.execute("SELECT * FROM master_project WHERE id=?", [master_id]).fetchone()
    if not mp: raise HTTPException(404, "项目不存在")
    subs = _rows(db.execute(
        "SELECT sp.*, p.name as seedance_name, p.progress_pct FROM master_sub_project sp LEFT JOIN user_project p ON sp.seedance_project_id=p.id WHERE sp.master_project_id=? ORDER BY sp.sort_order",
        [master_id]).fetchall())
    assets = _rows(db.execute(
        "SELECT * FROM master_asset WHERE master_project_id=? ORDER BY asset_type, sort_order",
        [master_id]).fetchall())
    phase_stats = {}
    for ph in PHASES:
        tc = db.execute("SELECT COUNT(*) FROM project_tasks WHERE master_project_id=? AND phase=?", [master_id, ph]).fetchone()[0]
        dc = db.execute("SELECT COUNT(*) FROM project_tasks WHERE master_project_id=? AND phase=? AND status='done'", [master_id, ph]).fetchone()[0]
        phase_stats[ph] = {"total": tc, "done": dc}
    return {"ok": True, "project": dict(mp), "sub_projects": subs, "assets": assets, "phase_stats": phase_stats}

@router.post("/master")
def create_master_project(data: dict = Body(...)):
    """创建总项目"""
    name = (data.get("name", "")).strip()
    if not name: raise HTTPException(400, "name 必填")
    db = _rw()
    try:
        db.execute(
            "INSERT INTO master_project (name,description,project_type,aspect_ratio,resolution) VALUES (?,?,?,?,?)",
            [name, data.get("description", ""), data.get("project_type", "short_film"),
             data.get("aspect_ratio", "16:9"), data.get("resolution", "4K")])
        db.commit()
        mid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        return {"ok": True, "id": mid}
    finally: db.close()

@router.put("/master/{master_id}")
def update_master_project(master_id: int, data: dict = Body(...)):
    """更新总项目"""
    db = _rw()
    try:
        for k in ["name", "description", "project_type", "aspect_ratio", "resolution", "status", "cover_image"]:
            if k in data:
                db.execute(f"UPDATE master_project SET {k}=?,updated_at=datetime('now','localtime') WHERE id=?", [data[k], master_id])
        db.commit()
        return {"ok": True}
    finally: db.close()

def _cascade_delete_master(db, master_id: int):
    """Phase30.1: 手动级联删除总项目及其所有子数据。
    因 app 运行时 PRAGMA foreign_keys 默认 OFF，ON DELETE CASCADE 不会触发，故手动按 FK 安全顺序清理，避免孤儿。
    保留 seedance user_project（遵循原 master_sub_project.seedance_project_id ON DELETE SET NULL 设计，镜头项目独立）。"""
    def _try(sql, params=()):
        try:
            db.execute(sql, params)
        except sqlite3.OperationalError:
            pass  # 表不存在（不同部署 schema 变体）则跳过
    # 看板/任务/里程碑/成员
    _try("DELETE FROM project_task_scene WHERE task_id IN (SELECT id FROM project_tasks WHERE master_project_id=?)", [master_id])
    _try("DELETE FROM project_tasks WHERE master_project_id=?", [master_id])
    _try("DELETE FROM project_columns WHERE master_project_id=?", [master_id])
    _try("DELETE FROM project_milestones WHERE master_project_id=?", [master_id])
    _try("DELETE FROM project_members WHERE master_project_id=?", [master_id])
    # 团队小组
    _try("DELETE FROM squad_members WHERE squad_id IN (SELECT id FROM workspace_squads WHERE master_project_id=?)", [master_id])
    _try("DELETE FROM workspace_squads WHERE master_project_id=?", [master_id])
    # 邀请
    _try("DELETE FROM workspace_invites WHERE master_project_id=?", [master_id])
    # 资产 / 子项目
    _try("DELETE FROM master_asset WHERE master_project_id=?", [master_id])
    _try("DELETE FROM master_sub_project WHERE master_project_id=?", [master_id])
    # 活动流
    _try("DELETE FROM activity_feed WHERE project_id=?", [master_id])
    # 主项目
    db.execute("DELETE FROM master_project WHERE id=?", [master_id])


@router.delete("/master/{master_id}")
def delete_master_project(master_id: int):
    """删除总项目（手动级联清理：子项目/资产/看板/成员/里程碑/邀请/小组/活动）"""
    db = _rw()
    try:
        _cascade_delete_master(db, master_id)
        db.commit()
        return {"ok": True}
    finally: db.close()

@router.get("/phases")
def list_phases():
    """返回7阶段定义"""
    return {"ok": True, "phases": [{"key": k, **v} for k, v in PHASE_NAMES.items()]}


@router.post("/master/{master_id}/init-board")
def init_board(master_id: int, data: dict = Body(default={})):
    """Phase30: 一键初始化总项目的团队看板—默认看板列 + 可选创始成员 + 可选起始里程碑。
    幂等：已有看板列/成员则跳过，不重复创建。"""
    data = data or {}
    db = _rw()
    try:
        mp = db.execute("SELECT id, name FROM master_project WHERE id=?", [master_id]).fetchone()
        if not mp:
            raise HTTPException(404, "总项目不存在")
        created = {"columns": 0, "members": 0, "milestones": 0}

        # 1) 默认看板列（仅当当前无列时）
        has_cols = db.execute("SELECT COUNT(*) FROM project_columns WHERE master_project_id=?", [master_id]).fetchone()[0]
        if not has_cols:
            cols = data.get("columns") or ["待办", "进行中", "审核中", "已完成"]
            colors = ["#e5e7eb", "#dbeafe", "#fef3c7", "#d1fae5"]
            for i, name in enumerate(cols):
                nm = (name or "").strip()
                if not nm:
                    continue
                db.execute("INSERT INTO project_columns (master_project_id,name,color,sort_order,phase) VALUES (?,?,?,?,'P3')",
                           [master_id, nm, colors[i % len(colors)], i])
                created["columns"] += 1

        # 2) 创始成员（可选，已在项目则跳过）
        founder = data.get("founder_user_id")
        founder_role = data.get("founder_role", "executive_producer")
        if founder and founder_role in CREW_ROLES:
            dup = db.execute("SELECT id FROM project_members WHERE master_project_id=? AND user_id=?", [master_id, founder]).fetchone()
            if not dup:
                u = db.execute("SELECT COALESCE(display_name,username) n FROM users WHERE id=?", [founder]).fetchone()
                rname = u["n"] if u else ("用户%d" % founder)
                perms = json.dumps(DEFAULT_PERMISSIONS.get(founder_role, {}), ensure_ascii=False)
                db.execute("INSERT INTO project_members (master_project_id,user_id,role,real_name,permissions_json) VALUES (?,?,?,?,?)",
                           [master_id, founder, founder_role, rname, perms])
                created["members"] += 1

        # 3) 起始里程碑（可选）
        ms = data.get("milestones") or []
        if ms:
            base = db.execute("SELECT COALESCE(MAX(sort_order),-1)+1 FROM project_milestones WHERE master_project_id=?", [master_id]).fetchone()[0]
            for i, m in enumerate(ms):
                title = (m.get("title") if isinstance(m, dict) else str(m)).strip()
                if not title:
                    continue
                due = m.get("due_date") if isinstance(m, dict) else None
                db.execute("INSERT INTO project_milestones (master_project_id,title,description,due_date,sort_order,phase) VALUES (?,?,'',?,?,'P3')",
                           [master_id, title, due, base + i])
                created["milestones"] += 1

        db.commit()
        return {"ok": True, "master_id": master_id, "created": created}
    finally:
        db.close()

# ============================================================
# Phase22 — 子项目 (master_sub_project)
# ============================================================

@router.get("/master/{master_id}/subs")
def list_sub_projects(master_id: int):
    db = _ro()
    rows = _rows(db.execute(
        "SELECT sp.*, p.name as seedance_name, p.progress_pct, p.aspect_ratio, p.resolution FROM master_sub_project sp LEFT JOIN user_project p ON sp.seedance_project_id=p.id WHERE sp.master_project_id=? ORDER BY sp.sort_order",
        [master_id]).fetchall())
    return {"ok": True, "subs": rows}

@router.post("/master/{master_id}/subs")
def create_sub_project(master_id: int, data: dict = Body(...)):
    """创建子项目 — 自动创建对应 seedance 分镜项目"""
    name = (data.get("name", "")).strip()
    if not name: raise HTTPException(400, "name 必填")
    db = _rw()
    try:
        mp = db.execute("SELECT id FROM master_project WHERE id=?", [master_id]).fetchone()
        if not mp: raise HTTPException(404, "总项目不存在")
        max_o = db.execute("SELECT COALESCE(MAX(sort_order),-1)+1 FROM master_sub_project WHERE master_project_id=?", [master_id]).fetchone()[0]
        db.execute(
            "INSERT INTO master_sub_project (master_project_id,name,sub_type,description,phase,sort_order) VALUES (?,?,?,?,?,?)",
            [master_id, name, data.get("sub_type", "storyboard"), data.get("description", ""), data.get("phase", "P3"), max_o])
        db.commit()
        sid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        try:
            db2 = _rw()
            db2.execute("INSERT INTO user_project (name,aspect_ratio,resolution,progress_pct) VALUES (?,?,?,0)",
                        [name, data.get("aspect_ratio", "16:9"), data.get("resolution", "4K")])
            db2.commit()
            spid = db2.execute("SELECT last_insert_rowid()").fetchone()[0]
            db2.close()
            db.execute("UPDATE master_sub_project SET seedance_project_id=? WHERE id=?", [spid, sid])
            db.commit()
            return {"ok": True, "id": sid, "seedance_project_id": spid}
        except Exception as e:
            db.commit()
            return {"ok": True, "id": sid, "seedance_error": str(e)}
    finally: db.close()

@router.put("/master/subs/{sub_id}")
def update_sub_project(sub_id: int, data: dict = Body(...)):
    db = _rw()
    try:
        for k in ["name", "sub_type", "description", "phase", "sort_order"]:
            if k in data:
                db.execute(f"UPDATE master_sub_project SET {k}=? WHERE id=?", [data[k], sub_id])
        db.commit()
        return {"ok": True}
    finally: db.close()

@router.delete("/master/subs/{sub_id}")
def delete_sub_project(sub_id: int):
    db = _rw()
    try:
        # 资产对该子项目的引用置空（原 ON DELETE SET NULL 设计），避免悬空
        try:
            db.execute("UPDATE master_asset SET sub_project_id=NULL WHERE sub_project_id=?", [sub_id])
        except sqlite3.OperationalError:
            pass
        db.execute("DELETE FROM master_sub_project WHERE id=?", [sub_id])
        db.commit()
        return {"ok": True}
    finally: db.close()

# ============================================================
# Phase22 — 资产 (master_asset)
# ============================================================

ASSET_TYPES = ["script", "character", "scene", "prompt_template", "ref_image", "bgm", "sfx", "other"]

@router.get("/master/{master_id}/assets")
def list_assets(master_id: int, asset_type: Optional[str] = Query(None), sub_project_id: Optional[int] = Query(None)):
    db = _ro()
    sql = "SELECT * FROM master_asset WHERE master_project_id=?"
    params = [master_id]
    if asset_type: sql += " AND asset_type=?"; params.append(asset_type)
    if sub_project_id is not None: sql += " AND sub_project_id=?"; params.append(sub_project_id)
    sql += " ORDER BY asset_type, sort_order"
    return {"ok": True, "assets": _rows(db.execute(sql, params).fetchall())}

@router.get("/master/assets/{asset_id}")
def get_asset(asset_id: int):
    db = _ro()
    a = db.execute("SELECT * FROM master_asset WHERE id=?", [asset_id]).fetchone()
    if not a: raise HTTPException(404, "资产不存在")
    return {"ok": True, "asset": dict(a)}

@router.post("/master/{master_id}/assets")
def create_asset(master_id: int, data: dict = Body(...)):
    a_type = data.get("asset_type", "other")
    name = (data.get("name", "")).strip()
    if not name: raise HTTPException(400, "name 必填")
    if a_type not in ASSET_TYPES: raise HTTPException(400, f"无效资产类型: {a_type}")
    db = _rw()
    try:
        mp = db.execute("SELECT id FROM master_project WHERE id=?", [master_id]).fetchone()
        if not mp: raise HTTPException(404, "总项目不存在")
        max_o = db.execute("SELECT COALESCE(MAX(sort_order),-1)+1 FROM master_asset WHERE master_project_id=? AND asset_type=?", [master_id, a_type]).fetchone()[0]
        db.execute(
            "INSERT INTO master_asset (master_project_id,sub_project_id,asset_type,name,description,content,image_path,tags,word_card_id,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)",
            [master_id, data.get("sub_project_id"), a_type, name, data.get("description", ""),
             data.get("content", ""), data.get("image_path", ""),
             json.dumps(data.get("tags", []), ensure_ascii=False),
             data.get("word_card_id"), max_o])
        db.commit()
        aid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        return {"ok": True, "id": aid}
    finally: db.close()

@router.put("/master/assets/{asset_id}")
def update_asset(asset_id: int, data: dict = Body(...)):
    db = _rw()
    try:
        for k in ["name", "description", "content", "image_path", "tags", "word_card_id", "sub_project_id", "sort_order"]:
            if k in data:
                val = json.dumps(data[k], ensure_ascii=False) if k == "tags" else data[k]
                db.execute(f"UPDATE master_asset SET {k}=?,updated_at=datetime('now','localtime') WHERE id=?", [val, asset_id])
        db.commit()
        return {"ok": True}
    finally: db.close()

@router.delete("/master/assets/{asset_id}")
def delete_asset(asset_id: int):
    db = _rw()
    try:
        db.execute("DELETE FROM master_asset WHERE id=?", [asset_id])
        db.commit()
        return {"ok": True}
    finally: db.close()

# ============================================================
# Phase22 — 提示词继承链引擎
# ============================================================

@router.get("/master/{master_id}/prompt-chain")
def get_prompt_chain(master_id: int, sub_project_id: Optional[int] = Query(None)):
    """
    三层提示词继承链：全局风格词卡 + 段落词卡 = 熔合输出
    """
    db = _ro()
    global_templates = _rows(db.execute(
        "SELECT * FROM master_asset WHERE master_project_id=? AND asset_type='prompt_template' AND sub_project_id IS NULL ORDER BY sort_order",
        [master_id]).fetchall())
    segment_templates = []
    if sub_project_id:
        segment_templates = _rows(db.execute(
            "SELECT * FROM master_asset WHERE master_project_id=? AND asset_type='prompt_template' AND sub_project_id=? ORDER BY sort_order",
            [master_id, sub_project_id]).fetchall())
    global_prompt = "\n".join([t.get("content", "") for t in global_templates if t.get("content", "").strip()])
    segment_prompt = "\n".join([t.get("content", "") for t in segment_templates if t.get("content", "").strip()])
    merged_prompt = f"{global_prompt}\n{segment_prompt}".strip()
    return {"ok": True,
            "global": global_templates, "segment": segment_templates,
            "global_prompt": global_prompt, "segment_prompt": segment_prompt,
            "merged_prompt": merged_prompt}

@router.post("/master/{master_id}/prompt-chain/merge")
def merge_prompt_chain(master_id: int, data: dict = Body(...)):
    """AI融合三层提示词"""
    gc = data.get("global_content", "")
    sc = data.get("segment_content", "")
    shc = data.get("shot_content", "")
    parts = []
    if gc.strip(): parts.append(f"[全局风格]\n{gc.strip()}")
    if sc.strip(): parts.append(f"[段落设定]\n{sc.strip()}")
    if shc.strip(): parts.append(f"[镜头需求]\n{shc.strip()}")
    merged = "\n\n".join(parts)
    # 尝试 LLM 融合
    try:
        from openai import OpenAI
        import os as _os
        ollama_host = _os.environ.get("OLLAMA_HOST", "http://localhost:11434")
        client = OpenAI(base_url=f"{ollama_host}/v1", api_key="ollama")
        resp = client.chat.completions.create(
            model="qwen3.5:9b",
            messages=[{"role": "system", "content": "你是AIGC提示词优化专家。将以下多层提示词融合为一个高质量、无冗余、风格统一的中文正向提示词："}, {"role": "user", "content": merged}],
            max_tokens=500, temperature=0.3, timeout=15
        )
        if resp.choices and resp.choices[0].message.content:
            merged = resp.choices[0].message.content.strip()
    except Exception:
        pass
    return {"ok": True, "merged": merged}

# ============================================================
# Phase22 — 批量生成面板
# ============================================================

@router.post("/master/{master_id}/batch-generate")
def batch_generate(master_id: int, data: dict = Body(...)):
    """批量提交生成任务 — 按子项目拉取所有镜头"""
    db = _ro()
    sp_ids = data.get("sub_project_ids", [])
    mode = data.get("mode", "comfyui")
    jobs = []
    for sp_id in sp_ids:
        sp = db.execute("SELECT * FROM master_sub_project WHERE id=? AND master_project_id=?", [sp_id, master_id]).fetchone()
        if not sp or not sp["seedance_project_id"]: continue
        scenes = db.execute("SELECT * FROM user_project_scene WHERE project_id=? ORDER BY sort_order", [sp["seedance_project_id"]]).fetchall()
        for sc in scenes:
            job = {"sub_project_id": sp_id, "seedance_project_id": sp["seedance_project_id"],
                   "scene_id": sc["id"], "scene_name": sc.get("name", ""),
                   "status": "queued", "mode": mode}
            jobs.append(job)
    return {"ok": True, "total": len(jobs), "jobs": jobs}
