# -*- coding: utf-8 -*-
"""
Seedance V2 图像参考模块（v5.36.2）
分镜组装器：全局/镜头级图像参考（角色图 / 场景图 / 风格参考）
- 支持手动上传任意图 / 从媒体库选 / 从角色库选
- 角色图+场景图总数上限 9 张（对齐即梦 multimodal2video 2.0系上限）
路由挂载: seedance_v2.py include_router，prefix 同为 /api/seedance/v2
"""
import os
import time
import uuid

from fastapi import APIRouter, Body, File, HTTPException, Query, UploadFile

from database import get_db, safe_commit

router = APIRouter(tags=["seedance-v2-refs"])

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REF_DIR = os.path.join(_PROJECT_ROOT, "data", "video_refs")
os.makedirs(REF_DIR, exist_ok=True)

# 参考图总数上限（角色+场景合计，对齐即梦 multimodal2video 2.0系 image≤9）
MAX_REFS_PER_SCOPE = 9
ALLOWED_TYPES = {"character", "scene", "style"}
ALLOWED_SOURCES = {"upload", "media_lib", "character"}

_ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}


def _ensure_refs_table():
    db = get_db()
    db.execute("""CREATE TABLE IF NOT EXISTS seedance_image_refs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        scene_id INTEGER,
        ref_type TEXT DEFAULT 'character',
        ref_name TEXT DEFAULT '',
        source_kind TEXT DEFAULT 'upload',
        file_path TEXT DEFAULT '',
        url TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        created_at TEXT
    )""")
    safe_commit()


def _ref_dict(r):
    d = dict(r)
    d["preview_url"] = d.get("url") or ""
    return d


def _count_refs(project_id: int, scene_id) -> int:
    db = get_db()
    if scene_id:
        return db.execute(
            "SELECT COUNT(*) as c FROM seedance_image_refs WHERE project_id=? AND scene_id=?",
            [project_id, scene_id]).fetchone()["c"]
    return db.execute(
        "SELECT COUNT(*) as c FROM seedance_image_refs WHERE project_id=? AND scene_id IS NULL",
        [project_id]).fetchone()["c"]


def _resolve_media_lib_file(filename: str) -> tuple:
    """从媒体库解析本地磁盘路径：尝试 originals / wc_media/originals / thumbnails"""
    db = get_db()
    asset = db.execute("SELECT * FROM media_assets WHERE filename=? OR original_filename=?",
                       [filename, filename]).fetchone()
    if not asset:
        return None, None
    orig = asset["original_filename"] or asset["filename"]
    for base in ("originals", "wc_media/originals", "thumbnails", "comfyui_outputs"):
        p = os.path.join(_PROJECT_ROOT, "data", base, orig)
        if os.path.exists(p):
            return p, f"/api/media/original/{filename}"
    return None, None


def _resolve_character_file(char_id: int) -> tuple:
    """从角色库解析角色头像/人设图磁盘路径"""
    db = get_db()
    char = db.execute("SELECT * FROM character_profiles WHERE id=?", [char_id]).fetchone()
    if not char:
        return None, None
    fname = char["avatar"] or char["preview_image"] or ""
    if not fname:
        return None, None
    # 尝试 avatars/、character_images/
    for base in ("avatars", "character_images"):
        p = os.path.join(_PROJECT_ROOT, "data", base, fname)
        if os.path.exists(p):
            return p, f"/api/characters/{char_id}"
    return None, None


# ==================== API ====================

@router.get("/refs")
def list_refs(project_id: int = Query(...), scene_id: int = Query(None)):
    """列出参考图。scene_id 省略=全局参考；指定=该镜头参考"""
    _ensure_refs_table()
    db = get_db()
    if scene_id is None:
        rows = db.execute(
            "SELECT * FROM seedance_image_refs WHERE project_id=? AND scene_id IS NULL ORDER BY sort_order, id",
            [project_id]).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM seedance_image_refs WHERE project_id=? AND scene_id=? ORDER BY sort_order, id",
            [project_id, scene_id]).fetchall()
    return {"items": [_ref_dict(r) for r in rows],
            "limit": MAX_REFS_PER_SCOPE}


@router.post("/refs/upload")
async def upload_ref_image(file: UploadFile = File(...)):
    """上传任意参考图，返回 file_path + url"""
    _ensure_refs_table()
    fname = (file.filename or "").lower()
    ext = os.path.splitext(fname)[1]
    if ext not in _ALLOWED_EXT:
        raise HTTPException(400, f"不支持的图片格式 {ext}，支持 jpg/png/webp/bmp/gif")
    try:
        data = await file.read()
        if not data:
            raise HTTPException(400, "文件为空")
        if len(data) > 15 * 1024 * 1024:
            raise HTTPException(400, "图片不能超过 15MB")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"读取失败: {e}")

    disk_name = f"ref_{int(time.time()*1000)}_{uuid.uuid4().hex[:8]}{ext}"
    fpath = os.path.join(REF_DIR, disk_name)
    with open(fpath, "wb") as f:
        f.write(data)
    return {"ok": True, "file_path": fpath, "url": f"/api/seedance/v2/refs/file/{disk_name}",
            "filename": disk_name}


@router.get("/refs/file/{filename}")
def serve_ref_file(filename: str):
    """提供参考图预览"""
    from fastapi.responses import FileResponse
    safe = os.path.basename(filename)
    p = os.path.join(REF_DIR, safe)
    if not os.path.exists(p):
        raise HTTPException(404, "文件不存在")
    return FileResponse(p)


@router.post("/refs")
def add_ref(data: dict = Body(...)):
    """添加参考图
    body: {
      project_id, scene_id(可空=全局),
      ref_type: character|scene|style,
      ref_name: 备注名,
      source_kind: upload|media_lib|character,
      file_path, url(来自上传/媒体库/角色库)
    }
    """
    _ensure_refs_table()
    project_id = data.get("project_id")
    if not project_id:
        raise HTTPException(400, "project_id 必填")
    scene_id = data.get("scene_id")  # None=全局
    ref_type = data.get("ref_type", "character")
    if ref_type not in ALLOWED_TYPES:
        raise HTTPException(400, f"ref_type 必须是 {ALLOWED_TYPES}")
    source_kind = data.get("source_kind", "upload")
    if source_kind not in ALLOWED_SOURCES:
        raise HTTPException(400, f"source_kind 必须是 {ALLOWED_SOURCES}")

    # 数量限制（角色+场景合计 ≤9）
    count = _count_refs(project_id, scene_id)
    if count >= MAX_REFS_PER_SCOPE:
        raise HTTPException(400, f"参考图已达上限 {MAX_REFS_PER_SCOPE} 张（角色+场景合计），请先删除再添加")

    file_path = (data.get("file_path") or "").strip()
    url = (data.get("url") or "").strip()

    # 从媒体库/角色库解析真实磁盘路径（CLI 需要）
    if source_kind == "media_lib":
        fname = (data.get("filename") or "").strip()
        if fname:
            fp, u = _resolve_media_lib_file(fname)
            if fp:
                file_path, url = fp, u or url
    elif source_kind == "character":
        char_id = data.get("character_id")
        if char_id:
            fp, u = _resolve_character_file(int(char_id))
            if fp:
                file_path, url = fp, u or url

    if not file_path:
        raise HTTPException(400, "无法解析图片文件路径，请改用上传")
    if not os.path.exists(file_path):
        raise HTTPException(400, f"图片文件不存在: {file_path}")

    db = get_db()
    cur = db.execute(
        "INSERT INTO seedance_image_refs (project_id, scene_id, ref_type, ref_name, source_kind, file_path, url, sort_order, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM seedance_image_refs WHERE project_id=? AND scene_id IS ?), datetime('now','localtime'))",
        [project_id, scene_id, ref_type, data.get("ref_name") or "", source_kind, file_path, url,
         project_id, scene_id if scene_id is not None else None]
    )
    safe_commit()
    return {"ok": True, "id": cur.lastrowid}


@router.delete("/refs/{ref_id}")
def delete_ref(ref_id: int):
    """删除参考图"""
    _ensure_refs_table()
    db = get_db()
    row = db.execute("SELECT * FROM seedance_image_refs WHERE id=?", [ref_id]).fetchone()
    if not row:
        raise HTTPException(404, "参考图不存在")
    db.execute("DELETE FROM seedance_image_refs WHERE id=?", [ref_id])
    safe_commit()
    return {"ok": True}
