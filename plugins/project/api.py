# -*- coding: utf-8 -*-
"""
com.promptkit.project API路由
挂载前缀: /api/plugins/com.promptkit.project/

所有写操作使用独立连接避免与核心读事务锁竞争
"""
import json, os, sqlite3, time
from fastapi import APIRouter, HTTPException, Query, Body
from typing import Optional

router = APIRouter(tags=["项目管理插件"])

DB = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "prompts.db")

def _ro():
    """只读连接（复用核心线程池）"""
    from database import get_db
    return get_db()

def _rw():
    """写连接：独立新建，写完即关，避免锁竞争"""
    conn = sqlite3.connect(DB, timeout=2)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=2000")
    return conn

def _rows(rows):
    return [dict(r) for r in rows]

# ============================================================
# 看板列
# ============================================================

@router.get("/columns")
def list_columns(project_id: int = Query(..., ge=1)):
    db = _ro()
    rows = db.execute("SELECT * FROM project_columns WHERE project_id=? ORDER BY sort_order", [project_id]).fetchall()
    cols = []
    for r in rows:
        c = dict(r)
        c["task_count"] = db.execute("SELECT COUNT(*) FROM project_tasks WHERE column_id=?", [r["id"]]).fetchone()[0]
        cols.append(c)
    return {"ok": True, "columns": cols}

@router.post("/columns")
def create_column(data: dict = Body(...)):
    pid, name = data.get("project_id"), (data.get("name", "")).strip()
    if not pid or not name: raise HTTPException(400, "project_id 和 name 必填")
    db = _rw()
    try:
        max_o = db.execute("SELECT COALESCE(MAX(sort_order),-1)+1 FROM project_columns WHERE project_id=?", [pid]).fetchone()[0]
        db.execute("INSERT INTO project_columns (project_id,name,color,sort_order) VALUES (?,?,?,?)",
                   [pid, name, data.get("color", "#6b7280"), max_o])
        db.commit()
        nid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        return {"ok": True, "id": nid}
    finally: db.close()

@router.delete("/columns/{column_id}")
def delete_column(column_id: int):
    db = _rw()
    try:
        col = db.execute("SELECT project_id FROM project_columns WHERE id=?", [column_id]).fetchone()
        if not col: raise HTTPException(404, "列不存在")
        first = db.execute("SELECT id FROM project_columns WHERE project_id=? AND id!=? ORDER BY sort_order LIMIT 1",
                           [col["project_id"], column_id]).fetchone()
        if first: db.execute("UPDATE project_tasks SET column_id=? WHERE column_id=?", [first["id"], column_id])
        db.execute("DELETE FROM project_columns WHERE id=?", [column_id])
        db.commit()
        return {"ok": True}
    finally: db.close()

# ============================================================
# 任务
# ============================================================

@router.get("/tasks")
def list_tasks(project_id: int = Query(..., ge=1), column_id: Optional[int] = Query(None)):
    db = _ro()
    sql = "SELECT t.*,c.name as col_name,c.color as col_color FROM project_tasks t LEFT JOIN project_columns c ON t.column_id=c.id WHERE t.project_id=?"
    params = [project_id]
    if column_id: sql += " AND t.column_id=?"; params.append(column_id)
    sql += " ORDER BY t.sort_order"
    return {"ok": True, "tasks": _rows(db.execute(sql, params).fetchall())}

@router.post("/tasks")
def create_task(data: dict = Body(...)):
    pid, title = data.get("project_id"), (data.get("title", "")).strip()
    if not pid or not title: raise HTTPException(400, "project_id 和 title 必填")
    db = _rw()
    try:
        cid = data.get("column_id")
        if not cid:
            r = db.execute("SELECT id FROM project_columns WHERE project_id=? ORDER BY sort_order LIMIT 1", [pid]).fetchone()
            cid = r["id"] if r else None
        db.execute("INSERT INTO project_tasks (project_id,column_id,title,description,priority,due_date,sort_order) VALUES (?,?,?,?,?,?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM project_tasks WHERE project_id=?))",
                   [pid, cid, title, data.get("description", ""), data.get("priority", 0), data.get("due_date"), pid])
        db.commit()
        nid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        _sync(pid)
        return {"ok": True, "id": nid}
    finally: db.close()

@router.put("/tasks/{task_id}")
def update_task(task_id: int, data: dict = Body(...)):
    db = _rw()
    try:
        t = db.execute("SELECT project_id FROM project_tasks WHERE id=?", [task_id]).fetchone()
        if not t: raise HTTPException(404, "任务不存在")
        for k in ["title", "description", "column_id", "priority", "due_date", "status", "sort_order"]:
            if k in data:
                if k == "status" and data[k] == "done":
                    db.execute("UPDATE project_tasks SET status=?,completed_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE id=?", [data[k], task_id])
                elif k == "status":
                    db.execute("UPDATE project_tasks SET status=?,completed_at=NULL,updated_at=datetime('now','localtime') WHERE id=?", [data[k], task_id])
                else:
                    db.execute(f"UPDATE project_tasks SET {k}=?,updated_at=datetime('now','localtime') WHERE id=?", [data[k], task_id])
        db.commit()
        _sync(t["project_id"])
        return {"ok": True}
    finally: db.close()

@router.delete("/tasks/{task_id}")
def delete_task(task_id: int):
    db = _rw()
    try:
        t = db.execute("SELECT project_id FROM project_tasks WHERE id=?", [task_id]).fetchone()
        if not t: raise HTTPException(404, "任务不存在")
        db.execute("DELETE FROM project_tasks WHERE id=?", [task_id])
        db.commit()
        _sync(t["project_id"])
        return {"ok": True}
    finally: db.close()

# ============================================================
# 里程碑
# ============================================================

@router.get("/milestones")
def list_milestones(project_id: int = Query(..., ge=1)):
    db = _ro()
    return {"ok": True, "milestones": _rows(db.execute("SELECT * FROM project_milestones WHERE project_id=? ORDER BY sort_order, due_date", [project_id]).fetchall())}

@router.post("/milestones")
def create_milestone(data: dict = Body(...)):
    pid, title = data.get("project_id"), (data.get("title", "")).strip()
    if not pid or not title: raise HTTPException(400, "project_id 和 title 必填")
    db = _rw()
    try:
        max_o = db.execute("SELECT COALESCE(MAX(sort_order),-1)+1 FROM project_milestones WHERE project_id=?", [pid]).fetchone()[0]
        db.execute("INSERT INTO project_milestones (project_id,title,description,due_date,sort_order) VALUES (?,?,?,?,?)",
                   [pid, title, data.get("description", ""), data.get("due_date"), max_o])
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
# 甘特图
# ============================================================

@router.get("/gantt")
def gantt(project_id: int = Query(..., ge=1)):
    db = _ro()
    proj = db.execute("SELECT * FROM user_project WHERE id=?", [project_id]).fetchone()
    if not proj: raise HTTPException(404, "项目不存在")
    ms = _rows(db.execute("SELECT * FROM project_milestones WHERE project_id=? ORDER BY sort_order", [project_id]).fetchall())
    ts = _rows(db.execute("SELECT t.*,c.name as col_name,c.color as col_color FROM project_tasks t LEFT JOIN project_columns c ON t.column_id=c.id WHERE t.project_id=? ORDER BY t.sort_order", [project_id]).fetchall())
    return {"ok": True, "project": dict(proj), "milestones": ms, "tasks": ts}

# ============================================================
# 仪表盘
# ============================================================

@router.get("/dashboard")
def dashboard(project_id: int = Query(..., ge=1)):
    db = _ro()
    proj = db.execute("SELECT * FROM user_project WHERE id=?", [project_id]).fetchone()
    if not proj: raise HTTPException(404, "项目不存在")
    sc = db.execute("SELECT COUNT(*) FROM user_project_scene WHERE project_id=?", [project_id]).fetchone()[0]
    ts = db.execute("SELECT COUNT(*) as t,COALESCE(SUM(CASE WHEN status='done' THEN 1 ELSE 0 END),0) as d,COALESCE(SUM(CASE WHEN status!='done' THEN 1 ELSE 0 END),0) as p FROM project_tasks WHERE project_id=?", [project_id]).fetchone()
    ms = db.execute("SELECT COUNT(*) as t,COALESCE(SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END),0) as c FROM project_milestones WHERE project_id=?", [project_id]).fetchone()
    cd = _rows(db.execute("SELECT c.name,c.color,COUNT(t.id) as tc FROM project_columns c LEFT JOIN project_tasks t ON t.column_id=c.id WHERE c.project_id=? GROUP BY c.id ORDER BY c.sort_order", [project_id]).fetchall())
    tt, td = ts["t"], ts["d"]
    pct = round(td/tt*100) if tt > 0 else 0
    return {"ok": True, "project": dict(proj),
            "stats": {"scene_count": sc, "total_tasks": tt, "done_tasks": td, "pending_tasks": ts["p"],
                      "high_priority_tasks": 0, "total_milestones": ms["t"], "completed_milestones": ms["c"],
                      "progress_pct": pct},
            "column_distribution": cd, "recent_activity": []}

# ============================================================
# 团队管理 — AIGC内容创作团队角色体系
# ============================================================

# 角色定义：权限等级 + 职责描述
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

@router.get("/roles")
def list_roles():
    """返回角色定义列表（供前端下拉选择）"""
    roles = []
    for key, info in sorted(CREW_ROLES.items(), key=lambda x: -x[1]["level"]):
        roles.append({"key": key, "name": info["name"], "level": info["level"], "duty": info["duty"], "icon": info["icon"]})
    return {"ok": True, "roles": roles}

# 角色默认权限矩阵
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

@router.get("/members")
def list_members(project_id: int = Query(..., ge=1)):
    db = _ro()
    rows = db.execute("SELECT * FROM project_members WHERE project_id=? ORDER BY joined_at", [project_id]).fetchall()
    return {"ok": True, "members": [_enrich_member(dict(r)) for r in rows]}

@router.get("/members/org-tree")
def get_org_tree(project_id: int = Query(..., ge=1)):
    """返回项目成员组织架构树，支持多层嵌套"""
    db = _ro()
    rows = db.execute(
        "SELECT * FROM project_members WHERE project_id=? ORDER BY parent_member_id NULLS FIRST, joined_at",
        [project_id]
    ).fetchall()
    members = [_enrich_member(dict(r)) for r in rows]
    
    # 构建树：找出根节点（无 parent 的成员），递归挂子节点
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
    # 附加上该成员参与的项目信息
    proj = db.execute("SELECT name,id FROM user_project WHERE id=?", [m["project_id"]]).fetchone()
    m["project_name"] = proj["name"] if proj else ""
    # 该成员的任务统计
    ts = db.execute("SELECT COUNT(*) as t, COALESCE(SUM(CASE WHEN status='done' THEN 1 ELSE 0 END),0) as d FROM project_tasks WHERE assignee_id=?", [member_id]).fetchone()
    m["task_total"] = ts["t"]
    m["task_done"] = ts["d"]
    return {"ok": True, "member": m}

@router.post("/members")
def add_member(data: dict = Body(...)):
    pid = data.get("project_id")
    uid = data.get("user_id")
    role = data.get("role", "viewer")
    real_name = data.get("real_name", "")
    duty = data.get("duty", "")
    avatar = data.get("avatar", "")
    avatar_color = data.get("avatar_color", "")
    phone = data.get("phone", "")
    email = data.get("email", "")
    permissions = data.get("permissions")
    if not pid or not uid: raise HTTPException(400, "project_id 和 user_id 必填")
    if role not in CREW_ROLES:
        raise HTTPException(400, f"无效角色: {role}")
    db = _rw()
    try:
        if db.execute("SELECT id FROM project_members WHERE project_id=? AND user_id=?", [pid, uid]).fetchone():
            raise HTTPException(409, "该用户已在项目中")
        perms_json = json.dumps(permissions or DEFAULT_PERMISSIONS.get(role, {}), ensure_ascii=False)
        db.execute(
            "INSERT INTO project_members (project_id,user_id,role,real_name,duty,avatar,avatar_color,phone,email,permissions_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
            [pid, uid, role, real_name, duty, avatar, avatar_color, phone, email, perms_json])
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

# ============================================================
# 组织架构图
# ============================================================

@router.put("/members/{member_id}/parent")
def set_member_parent(member_id: int, data: dict = Body(...)):
    """
    设置成员的上级。
    Body: {"parent_member_id": int | null}
    parent_member_id=null 表示提升为顶级成员（无上级）。
    """
    db = _rw()
    try:
        member = db.execute("SELECT id, project_id FROM project_members WHERE id=?", [member_id]).fetchone()
        if not member:
            raise HTTPException(404, "成员不存在")
        
        parent_id = data.get("parent_member_id")
        
        if parent_id is not None:
            # 校验：父节点必须在同一项目中，且不能是自己或其子孙
            parent = db.execute(
                "SELECT id, project_id, parent_member_id FROM project_members WHERE id=?",
                [parent_id]
            ).fetchone()
            if not parent:
                raise HTTPException(400, "上级成员不存在")
            if parent["project_id"] != member["project_id"]:
                raise HTTPException(400, "上级成员不在同一项目")
            if parent_id == member_id:
                raise HTTPException(400, "不能将自己设为上级")
            # 防止循环引用：检查 parent 的祖先链中是否包含 member_id
            cursor = parent_id
            visited = set()
            while cursor:
                if cursor == member_id:
                    raise HTTPException(400, "不能形成循环层级关系")
                if cursor in visited:
                    break
                visited.add(cursor)
                anc = db.execute(
                    "SELECT parent_member_id FROM project_members WHERE id=?", [cursor]
                ).fetchone()
                cursor = anc["parent_member_id"] if anc else None
        
        db.execute(
            "UPDATE project_members SET parent_member_id=? WHERE id=?",
            [parent_id, member_id]
        )
        db.commit()
        return {"ok": True, "message": "层级关系已更新"}
    finally:
        db.close()


# ============================================================
# 辅助
# ============================================================

def _sync(pid):
    db = _rw()
    try:
        s = db.execute("SELECT COUNT(*) as t,COALESCE(SUM(CASE WHEN status='done' THEN 1 ELSE 0 END),0) as d FROM project_tasks WHERE project_id=?", [pid]).fetchone()
        db.execute("UPDATE user_project SET progress_pct=?,updated_at=datetime('now','localtime') WHERE id=?", [round(s["d"]/s["t"]*100) if s["t"]>0 else 0, pid])
        db.commit()
    finally: db.close()
