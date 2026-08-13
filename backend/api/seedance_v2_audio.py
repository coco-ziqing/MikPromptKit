# -*- coding: utf-8 -*-
"""
Seedance V2 音频参考模块（v5.36.35）
分镜组装器：全局/镜头级音频参考（BGM / 角色对白配音 / 画外音解说）
- 支持手动上传音频文件（mp3/wav/m4a/aac/flac/ogg）
- 全局级：BGM 背景音乐 + 画外音/解说旁白
- 镜头级：角色对白配音（voice）
- 提交视频时随 multimodal2video --audio 携带（seedance2.5 支持纯音频输入）
路由挂载: seedance_v2.py include_router，prefix 同为 /api/seedance/v2
"""
import os
import time
import uuid

from fastapi import APIRouter, Body, File, HTTPException, Query, UploadFile

from database import get_db, safe_commit

router = APIRouter(tags=["seedance-v2-audio"])

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AUDIO_DIR = os.path.join(_PROJECT_ROOT, "data", "video_audio")
os.makedirs(AUDIO_DIR, exist_ok=True)

# 音频类型：bgm=背景音乐  voice=角色对白  narration=画外音/解说
ALLOWED_TYPES = {"bgm", "voice", "narration"}
_ALLOWED_EXT = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".wma"}


def _ensure_audio_table():
    db = get_db()
    db.execute("""CREATE TABLE IF NOT EXISTS seedance_audio_refs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        scene_id INTEGER,
        audio_type TEXT DEFAULT 'bgm',
        ref_name TEXT DEFAULT '',
        file_path TEXT DEFAULT '',
        url TEXT DEFAULT '',
        duration REAL DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT
    )""")
    safe_commit()


def _audio_dict(r):
    d = dict(r)
    d["preview_url"] = d.get("url") or ""
    return d


# ==================== API ====================

@router.get("/audio-refs")
def list_audio_refs(project_id: int = Query(...), scene_id: int = Query(None)):
    """列出音频参考。scene_id 省略=全局（BGM/画外音）；指定=该镜头（角色对白）"""
    _ensure_audio_table()
    db = get_db()
    if scene_id is None:
        rows = db.execute(
            "SELECT * FROM seedance_audio_refs WHERE project_id=? AND scene_id IS NULL ORDER BY sort_order, id",
            [project_id]).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM seedance_audio_refs WHERE project_id=? AND scene_id=? ORDER BY sort_order, id",
            [project_id, scene_id]).fetchall()
    return {"items": [_audio_dict(r) for r in rows]}


@router.post("/audio-refs/upload")
async def upload_audio_file(file: UploadFile = File(...)):
    """上传音频文件，返回 file_path + url（仅落盘，不建关联）"""
    _ensure_audio_table()
    fname = (file.filename or "").lower()
    ext = os.path.splitext(fname)[1]
    if ext not in _ALLOWED_EXT:
        raise HTTPException(400, f"不支持的音频格式 {ext}，支持 mp3/wav/m4a/aac/flac/ogg/wma")
    try:
        data = await file.read()
        if not data:
            raise HTTPException(400, "文件为空")
        if len(data) > 50 * 1024 * 1024:
            raise HTTPException(400, "音频不能超过 50MB")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"读取失败: {e}")

    disk_name = f"aud_{int(time.time()*1000)}_{uuid.uuid4().hex[:8]}{ext}"
    fpath = os.path.join(AUDIO_DIR, disk_name)
    with open(fpath, "wb") as f:
        f.write(data)

    # 探测时长（ffprobe，失败不阻塞）
    duration = 0.0
    try:
        import subprocess
        import json as _json
        probe = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', fpath],
            capture_output=True, timeout=10, text=True)
        info = _json.loads(probe.stdout)
        duration = round(float(info.get('format', {}).get('duration', 0)), 1)
    except Exception:
        pass

    return {"ok": True, "file_path": fpath, "url": f"/api/seedance/v2/audio-refs/file/{disk_name}",
            "filename": disk_name, "duration": duration}


@router.get("/audio-refs/file/{filename}")
def serve_audio_file(filename: str):
    """提供音频预览"""
    from fastapi.responses import FileResponse
    safe = os.path.basename(filename)
    p = os.path.join(AUDIO_DIR, safe)
    if not os.path.exists(p):
        raise HTTPException(404, "文件不存在")
    return FileResponse(p)


@router.post("/audio-refs")
def add_audio_ref(data: dict = Body(...)):
    """添加音频关联
    body: { project_id, scene_id(可空=全局), audio_type: bgm|voice|narration,
            ref_name, file_path, url, duration }
    """
    _ensure_audio_table()
    project_id = data.get("project_id")
    if not project_id:
        raise HTTPException(400, "project_id 必填")
    scene_id = data.get("scene_id")
    audio_type = data.get("audio_type", "bgm")
    if audio_type not in ALLOWED_TYPES:
        raise HTTPException(400, f"audio_type 必须是 {sorted(ALLOWED_TYPES)}")
    file_path = (data.get("file_path") or "").strip()
    if not file_path:
        raise HTTPException(400, "file_path 必填")
    if not os.path.exists(file_path):
        raise HTTPException(400, f"音频文件不存在: {file_path}")

    db = get_db()
    cur = db.execute(
        "INSERT INTO seedance_audio_refs (project_id, scene_id, audio_type, ref_name, file_path, url, duration, sort_order, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM seedance_audio_refs WHERE project_id=? AND scene_id IS ?), datetime('now','localtime'))",
        [project_id, scene_id, audio_type, data.get("ref_name") or "", file_path,
         data.get("url") or "", float(data.get("duration") or 0),
         project_id, scene_id if scene_id is not None else None]
    )
    safe_commit()
    return {"ok": True, "id": cur.lastrowid}


@router.put("/audio-refs/{ref_id}")
def update_audio_ref(ref_id: int, data: dict = Body(...)):
    """更新音频参考（重命名 / 改类型）"""
    _ensure_audio_table()
    db = get_db()
    row = db.execute("SELECT * FROM seedance_audio_refs WHERE id=?", [ref_id]).fetchone()
    if not row:
        raise HTTPException(404, "音频参考不存在")
    sets, params = [], []
    if "ref_name" in data:
        sets.append("ref_name=?")
        params.append((data.get("ref_name") or "").strip())
    if "audio_type" in data:
        at = data.get("audio_type")
        if at not in ALLOWED_TYPES:
            raise HTTPException(400, f"audio_type 必须是 {sorted(ALLOWED_TYPES)}")
        sets.append("audio_type=?")
        params.append(at)
    if sets:
        db.execute(f"UPDATE seedance_audio_refs SET {', '.join(sets)} WHERE id=?", params + [ref_id])
        safe_commit()
    return {"ok": True}


@router.delete("/audio-refs/{ref_id}")
def delete_audio_ref(ref_id: int):
    """删除音频参考"""
    _ensure_audio_table()
    db = get_db()
    row = db.execute("SELECT * FROM seedance_audio_refs WHERE id=?", [ref_id]).fetchone()
    if not row:
        raise HTTPException(404, "音频参考不存在")
    db.execute("DELETE FROM seedance_audio_refs WHERE id=?", [ref_id])
    safe_commit()
    return {"ok": True}
