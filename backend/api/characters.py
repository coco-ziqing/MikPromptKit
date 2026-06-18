"""
v4.0.0-phase10.1: Character Library API
角色库 CRUD + 图片管理 + 镜头关联
"""
import json, os, uuid, shutil
from fastapi import APIRouter, Query, Body, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from database import get_db, safe_commit

CHAR_IMG_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "data", "character_images"
)
os.makedirs(CHAR_IMG_DIR, exist_ok=True)

router = APIRouter(prefix="/api/characters", tags=["characters"])


# ==================== 1. 角色 CRUD ====================

@router.get("")
def list_characters(
    project_id: int = Query(None),
    search: str = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200)
):
    """角色列表（支持按项目筛选 + 搜索）"""
    db = get_db()
    params = []
    where = []
    if project_id is not None:
        where.append("(cp.project_id=? OR cp.project_id=0)")
        params.append(project_id)
    if search:
        like = f"%{search}%"
        where.append("(cp.name LIKE ? OR cp.personality LIKE ? OR cp.occupation LIKE ? OR cp.appearance LIKE ?)")
        params += [like, like, like, like]

    where_clause = " WHERE " + " AND ".join(where) if where else ""
    total = db.execute(f"SELECT COUNT(*) as cnt FROM character_profiles cp{where_clause}", params).fetchone()["cnt"]

    offset = (page - 1) * page_size
    rows = db.execute(
        f"SELECT cp.*, (SELECT COUNT(*) FROM character_images WHERE character_id=cp.id) as image_count FROM character_profiles cp{where_clause} ORDER BY cp.is_builtin DESC, cp.sort_order, cp.name LIMIT ? OFFSET ?",
        params + [page_size, offset]
    ).fetchall()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [dict(r) for r in rows]
    }


@router.get("/{char_id}")
def get_character(char_id: int):
    """获取角色完整档案（含所有参考图）"""
    db = get_db()
    char = db.execute("SELECT * FROM character_profiles WHERE id=?", [char_id]).fetchone()
    if not char:
        raise HTTPException(404, "角色不存在")

    images = db.execute(
        "SELECT * FROM character_images WHERE character_id=? ORDER BY sort_order, id",
        [char_id]
    ).fetchall()

    # 解析 tags 为列表
    result = dict(char)
    try:
        result["tags"] = json.loads(result["tags"])
    except Exception:
        result["tags"] = []
    result["images"] = [dict(img) for img in images]
    return {"character": result}


@router.post("")
def create_character(data: dict = Body(...)):
    """新建角色"""
    db = get_db()
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "角色名称必填")

    fields = [
        "project_id", "name", "gender", "age_range", "occupation",
        "personality", "appearance", "voice_type", "voice_detail",
        "narration_style", "role_position", "backstory", "notes", "tags"
    ]
    columns, placeholders, values = [], [], []
    for f in fields:
        if f in data:
            columns.append(f)
            placeholders.append("?")
            val = data[f]
            if f == "tags" and isinstance(val, list):
                val = json.dumps(val, ensure_ascii=False)
            values.append(val)

    db.execute(
        f"INSERT INTO character_profiles ({','.join(columns)}) VALUES ({','.join(placeholders)})",
        values
    )
    safe_commit()
    char_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    return {"ok": True, "id": char_id}


@router.put("/{char_id}")
def update_character(char_id: int, data: dict = Body(...)):
    """更新角色档案"""
    db = get_db()
    char = db.execute("SELECT * FROM character_profiles WHERE id=?", [char_id]).fetchone()
    if not char:
        raise HTTPException(404, "角色不存在")

    updatable = [
        "name", "gender", "age_range", "occupation", "personality",
        "appearance", "voice_type", "voice_detail", "narration_style",
        "role_position", "backstory", "notes", "tags",
        "avatar", "preview_image", "sort_order"
    ]
    set_parts = []
    values = []
    for f in updatable:
        if f in data:
            set_parts.append(f"{f}=?")
            val = data[f]
            if f == "tags" and isinstance(val, list):
                val = json.dumps(val, ensure_ascii=False)
            values.append(val)
    if not set_parts:
        raise HTTPException(400, "无更新字段")

    values.append(char_id)
    db.execute(
        f"UPDATE character_profiles SET {','.join(set_parts)}, updated_at=datetime('now','localtime') WHERE id=?",
        values
    )
    safe_commit()
    return {"ok": True}


@router.delete("/{char_id}")
def delete_character(char_id: int):
    """删除角色（含关联图片文件）"""
    db = get_db()
    char = db.execute("SELECT * FROM character_profiles WHERE id=?", [char_id]).fetchone()
    if not char:
        raise HTTPException(404, "角色不存在")
    if char["is_builtin"]:
        raise HTTPException(403, "内置角色不可删除")

    # 清理图片文件
    images = db.execute("SELECT filename FROM character_images WHERE character_id=?", [char_id]).fetchall()
    for img in images:
        path = os.path.join(CHAR_IMG_DIR, img["filename"])
        try:
            os.remove(path)
        except Exception:
            pass
    # 清理头像
    for fld in ["avatar", "preview_image"]:
        if char[fld]:
            path = os.path.join(CHAR_IMG_DIR, char[fld])
            try:
                os.remove(path)
            except Exception:
                pass

    db.execute("DELETE FROM character_images WHERE character_id=?", [char_id])
    db.execute("DELETE FROM character_profiles WHERE id=?", [char_id])
    safe_commit()
    return {"ok": True}


# ==================== 2. 角色图片管理 ====================

@router.post("/{char_id}/images")
def upload_character_image(char_id: int, file: UploadFile = File(...), image_type: str = "reference"):
    """上传角色参考图（头像/多角度图/其他）"""
    db = get_db()
    char = db.execute("SELECT * FROM character_profiles WHERE id=?", [char_id]).fetchone()
    if not char:
        raise HTTPException(404, "角色不存在")

    # 检查文件类型
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "仅支持图片文件")

    # 生成唯一文件名
    ext = os.path.splitext(file.filename or "img.jpg")[1] or ".jpg"
    fname = f"char_{char_id}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(CHAR_IMG_DIR, fname)

    with open(filepath, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # 排序号
    max_order = db.execute(
        "SELECT COALESCE(MAX(sort_order), 0) FROM character_images WHERE character_id=?",
        [char_id]
    ).fetchone()[0]

    db.execute(
        "INSERT INTO character_images (character_id, filename, image_type, sort_order) VALUES (?,?,?,?)",
        [char_id, fname, image_type, max_order + 1]
    )
    safe_commit()

    # 如果上传类型是 avatar，自动更新角色的 avatar 字段
    if image_type == "avatar":
        db.execute("UPDATE character_profiles SET avatar=? WHERE id=?", [fname, char_id])
        safe_commit()
    elif image_type == "preview":
        db.execute("UPDATE character_profiles SET preview_image=? WHERE id=?", [fname, char_id])
        safe_commit()

    return {
        "ok": True,
        "filename": fname,
        "url": f"/api/characters/images/{fname}"
    }


@router.delete("/{char_id}/images/{image_id}")
def delete_character_image(char_id: int, image_id: int):
    """删除角色参考图"""
    db = get_db()
    img = db.execute("SELECT * FROM character_images WHERE id=? AND character_id=?", [image_id, char_id]).fetchone()
    if not img:
        raise HTTPException(404, "图片不存在")

    path = os.path.join(CHAR_IMG_DIR, img["filename"])
    try:
        os.remove(path)
    except Exception:
        pass

    db.execute("DELETE FROM character_images WHERE id=?", [image_id])
    safe_commit()
    return {"ok": True}


@router.get("/images/{filename}")
def serve_character_image(filename: str):
    """提供角色图片"""
    path = os.path.join(CHAR_IMG_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(404, "图片不存在")
    return FileResponse(path)


# ==================== 3. 镜头角色关联 ====================

@router.put("/{char_id}/assign-scene")
def assign_character_to_scene(char_id: int, data: dict = Body(...)):
    """将角色分配到指定镜头（自动注入声线/旁白）"""
    scene_id = data.get("scene_id")
    if not scene_id:
        raise HTTPException(400, "scene_id 必填")

    db = get_db()
    char = db.execute("SELECT * FROM character_profiles WHERE id=?", [char_id]).fetchone()
    if not char:
        raise HTTPException(404, "角色不存在")

    # 自动注入：character_voice ← voice_type + voice_detail
    voice_parts = []
    if char["voice_type"]:
        voice_parts.append(char["voice_type"])
    if char["voice_detail"]:
        voice_parts.append(char["voice_detail"])
    auto_voice = "，".join(voice_parts) if voice_parts else ""
    auto_narration = char["narration_style"] or ""

    db.execute(
        "UPDATE user_project_scene SET character_id=?, character_voice=?, narration=? WHERE id=?",
        [char_id, auto_voice, auto_narration, scene_id]
    )

    # 增加使用计数
    db.execute("UPDATE character_profiles SET usage_count=usage_count+1 WHERE id=?", [char_id])
    safe_commit()

    return {
        "ok": True,
        "character_name": char["name"],
        "auto_voice": auto_voice,
        "auto_narration": auto_narration
    }


@router.delete("/{char_id}/unassign-scene")
def unassign_character_from_scene(char_id: int, data: dict = Body(...)):
    """从镜头取消角色分配"""
    scene_id = data.get("scene_id")
    if not scene_id:
        raise HTTPException(400, "scene_id 必填")

    db = get_db()
    db.execute("UPDATE user_project_scene SET character_id=NULL WHERE id=?", [scene_id])
    safe_commit()
    return {"ok": True}


# ==================== 4. 旁白风格枚举 ====================

NARRATION_STYLES = [
    {"key": "first_person", "name": "第一人称", "desc": "我如何如何，代入感强"},
    {"key": "third_person", "name": "第三人称", "desc": "客观叙述，他/她如何"},
    {"key": "omniscient", "name": "上帝视角", "desc": "全知全能叙述，俯瞰全局"},
    {"key": "documentary", "name": "纪录片风", "desc": "客观冷静，事实陈述"},
    {"key": "poetic", "name": "诗意旁白", "desc": "文学性强，比喻丰富"},
    {"key": "monologue", "name": "内心独白", "desc": "角色心理活动，情感细腻"},
    {"key": "conversational", "name": "对话式", "desc": "像跟观众聊天，亲切自然"},
    {"key": "suspense", "name": "悬念式", "desc": "营造悬疑氛围，层层递进"},
    {"key": "philosophical", "name": "哲理式", "desc": "金句频出，引人深思"},
    {"key": "fast_paced", "name": "快速节奏", "desc": "语速快，信息密集"},
    {"key": "slow_lingering", "name": "缓慢悠长", "desc": "语速慢，留白多"},
    {"key": "humorous", "name": "幽默吐槽", "desc": "轻松诙谐"},
    {"key": "epic", "name": "史诗感", "desc": "宏大叙事，历史厚重"},
    {"key": "diary", "name": "日记体", "desc": "如读日记，私密真实"},
    {"key": "fairy_tale", "name": "童话风", "desc": "故事感，梦幻童真"},
    {"key": "minimalist", "name": "留白式", "desc": "少说多留白，让画面说话"},
]

@router.get("/narration-styles")
def get_narration_styles():
    """获取旁白风格枚举（供角色编辑表单下拉选择）"""
    return {"items": NARRATION_STYLES}
