"""
媒体资产管理库 API
统一管理缩略图/原图/视频的存储、检索、关联
自动补齐：上传时同步写入 media_assets 表
"""
import os, json, datetime
from fastapi import APIRouter, Query
from fastapi.responses import FileResponse, JSONResponse
from database import get_db

router = APIRouter(prefix="/api/media", tags=["media"])

# 目录配置
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
THUMB_DIR = os.path.join(BASE_DIR, "data", "thumbnails")
ORIGINAL_DIR = os.path.join(BASE_DIR, "data", "originals")
VIDEO_DIR = os.path.join(BASE_DIR, "data", "videos")

# ============ 辅助函数 ============

def _get_image_dimensions(filepath: str) -> tuple:
    """获取图片尺寸 (width, height)，失败返回 (0,0)"""
    try:
        from PIL import Image
        img = Image.open(filepath)
        return img.size
    except Exception:
        return (0, 0)


def _get_mime_type(filename: str) -> str:
    """根据扩展名获取 MIME 类型"""
    ext = os.path.splitext(filename)[1].lower()
    mime_map = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".gif": "image/gif",
        ".webp": "image/webp", ".bmp": "image/bmp",
        ".mp4": "video/mp4", ".mov": "video/quicktime",
        ".avi": "video/x-msvideo", ".mkv": "video/x-matroska",
    }
    return mime_map.get(ext, "application/octet-stream")


def _record_asset(filename: str, original_filename: str = "",
                  file_size: int = 0, original_size: int = 0,
                  media_type: str = "image", width: int = 0, height: int = 0,
                  prompt_id: int = 0, source: str = "upload"):
    """写入 media_assets 记录（INSERT OR IGNORE 防止重复）"""
    try:
        db = get_db()
        mime = _get_mime_type(original_filename or filename)
        db.execute("""
            INSERT OR IGNORE INTO media_assets
                (filename, original_filename, file_size, original_size,
                 media_type, width, height, mime_type, prompt_id, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [filename, original_filename, file_size, original_size,
              media_type, width, height, mime, prompt_id, source])
        db.commit()
    except Exception as e:
        print("[媒体库] 记录失败:", filename, e)


def _update_asset_prompt(filename: str, prompt_id: int):
    """更新 media_assets 的 prompt_id 关联"""
    try:
        db = get_db()
        db.execute("UPDATE media_assets SET prompt_id=?, updated_at=datetime('now','localtime') WHERE filename=?",
                   [prompt_id, filename])
        db.commit()
    except Exception as e:
        print("[媒体库] 更新关联失败:", e)


# ============ API: 存储概览 ============

@router.get("/status")
def media_status():
    """媒体库存储概览：总数、类型分布、总大小"""
    db = get_db()
    total = db.execute("SELECT COUNT(*) as c FROM media_assets").fetchone()["c"]
    by_type = db.execute(
        "SELECT media_type, COUNT(*) as c, SUM(file_size) as total_size FROM media_assets GROUP BY media_type"
    ).fetchall()
    orphaned = db.execute("SELECT COUNT(*) as c FROM media_assets WHERE prompt_id=0").fetchone()["c"]
    return {
        "total": total,
        "orphaned": orphaned,
        "by_type": [dict(r) for r in by_type],
        "thumbnails_dir": len(os.listdir(THUMB_DIR)) if os.path.exists(THUMB_DIR) else 0,
        "originals_dir": len(os.listdir(ORIGINAL_DIR)) if os.path.exists(ORIGINAL_DIR) else 0,
        "videos_dir": len(os.listdir(VIDEO_DIR)) if os.path.exists(VIDEO_DIR) else 0,
    }


# ============ API: 资产库列表 ============

@router.get("/library")
def media_library(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
                  media_type: str = Query("", regex="^(image|video|)$")):
    """分页获取媒体资产库，可按类型筛选"""
    db = get_db()
    where = ""
    params = []
    if media_type:
        where = "WHERE media_type=?"
        params.append(media_type)

    total = db.execute(f"SELECT COUNT(*) as c FROM media_assets {where}", params).fetchone()["c"]
    total_pages = max(1, (total + page_size - 1) // page_size)
    offset = (page - 1) * page_size

    rows = db.execute(
        f"SELECT * FROM media_assets {where} ORDER BY updated_at DESC LIMIT ? OFFSET ?",
        params + [page_size, offset]
    ).fetchall()

    items = []
    for r in rows:
        d = dict(r)
        # 检查文件是否实际存在
        thumb_path = os.path.join(THUMB_DIR, d["filename"])
        orig_path = os.path.join(ORIGINAL_DIR, d.get("original_filename", "") or d["filename"]) if d.get("original_filename") else ""
        video_path = os.path.join(VIDEO_DIR, d["filename"]) if d["media_type"] == "video" else ""

        d["file_exists"] = os.path.exists(thumb_path) or os.path.exists(video_path)
        d["original_exists"] = bool(orig_path and os.path.exists(orig_path))
        d["thumbnail_url"] = f"/api/thumbnails/file/{d['filename']}"
        d["original_url"] = f"/api/thumbnails/original/{d.get('original_filename') or d['filename']}"
        if d["media_type"] == "video":
            d["video_url"] = f"/api/thumbnails/video/{d['filename']}"
        items.append(d)

    return {"total": total, "page": page, "page_size": page_size, "total_pages": total_pages, "items": items}


# ============ API: 提供原图文件 ============

@router.get("/original/{filename}")
def serve_original(filename: str):
    """提供原图文件，优先 from originals/，回退到 thumbnails/"""
    safe = os.path.basename(filename)
    db = get_db()
    asset = db.execute("SELECT * FROM media_assets WHERE filename=? OR original_filename=?", [safe, safe]).fetchone()
    if asset:
        orig_name = asset["original_filename"] or asset["filename"]
        # 尝试 originals/
        fpath = os.path.join(ORIGINAL_DIR, orig_name)
        if os.path.exists(fpath):
            return FileResponse(fpath, media_type=_get_mime_type(orig_name))
        # 尝试 videos/
        if asset["media_type"] == "video":
            fpath = os.path.join(VIDEO_DIR, orig_name)
            if os.path.exists(fpath):
                return FileResponse(fpath, media_type="video/mp4")
    # 回退 thumbnails/
    fpath = os.path.join(THUMB_DIR, safe)
    if os.path.exists(fpath):
        return FileResponse(fpath, media_type="image/jpeg")
    return JSONResponse({"error": "文件不存在"}, status_code=404)


# ============ API: 文件元数据 ============

@router.get("/info/{filename}")
def media_info(filename: str):
    """获取媒体文件元数据"""
    safe = os.path.basename(filename)
    db = get_db()
    asset = db.execute("SELECT * FROM media_assets WHERE filename=? OR original_filename=?", [safe, safe]).fetchone()
    if not asset:
        # 查磁盘
        for d, label in [(THUMB_DIR, "thumbnails"), (ORIGINAL_DIR, "originals"), (VIDEO_DIR, "videos")]:
            fpath = os.path.join(d, safe)
            if os.path.exists(fpath):
                sz = os.path.getsize(fpath)
                w, h = _get_image_dimensions(fpath) if label in ("thumbnails", "originals") else (0, 0)
                return {
                    "filename": safe, "file_size": sz, "width": w, "height": h,
                    "storage": label, "in_db": False,
                    "mime_type": _get_mime_type(safe),
                    "url": f"/api/thumbnails/file/{safe}",
                    "original_url": f"/api/thumbnails/original/{safe}",
                }
        return JSONResponse({"error": "文件不存在"}, status_code=404)

    d = dict(asset)
    thumb_path = os.path.join(THUMB_DIR, d["filename"])
    d["file_exists"] = os.path.exists(thumb_path)
    d["thumbnail_url"] = f"/api/thumbnails/file/{d['filename']}"
    d["original_url"] = f"/api/thumbnails/original/{d.get('original_filename') or d['filename']}"
    if d["media_type"] == "video":
        d["video_url"] = f"/api/thumbnails/video/{d['filename']}"
    return d


# ============ API: 同步补齐（扫描磁盘重建索引） ============

@router.post("/reindex")
def media_reindex():
    """扫描磁盘，将现有文件补齐到 media_assets 表（幂等）"""
    db = get_db()
    added = 0

    # 1. originals/ → 匹配同名缩略图
    if os.path.exists(ORIGINAL_DIR):
        for f in os.listdir(ORIGINAL_DIR):
            fpath = os.path.join(ORIGINAL_DIR, f)
            if not os.path.isfile(fpath):
                continue
            sz = os.path.getsize(fpath)
            # 检查是否已有记录
            exists = db.execute("SELECT id FROM media_assets WHERE original_filename=?", [f]).fetchone()
            if exists:
                continue
            # 查找对应缩略图（相同文件名）
            thumb_path = os.path.join(THUMB_DIR, f)
            thumb_sz = os.path.getsize(thumb_path) if os.path.exists(thumb_path) else 0
            w, h = _get_image_dimensions(fpath)
            db.execute("""
                INSERT OR IGNORE INTO media_assets
                    (filename, original_filename, file_size, original_size,
                     media_type, width, height, source, prompt_id)
                VALUES (?, ?, ?, ?, 'image', ?, ?, 'upload', 0)
            """, [f, f, thumb_sz, sz, w, h])
            added += 1

    # 2. thumbnails/ → 无 original 匹配的补齐
    if os.path.exists(THUMB_DIR):
        for f in os.listdir(THUMB_DIR):
            fpath = os.path.join(THUMB_DIR, f)
            if not os.path.isfile(fpath) or not f.endswith(".jpg"):
                continue
            exists = db.execute("SELECT id FROM media_assets WHERE filename=?", [f]).fetchone()
            if exists:
                continue
            # 检查是否是视频 poster（_poster 后缀）→ 跳过
            if "_poster" in f:
                continue
            sz = os.path.getsize(fpath)
            orig_path = os.path.join(ORIGINAL_DIR, f)
            orig_sz = os.path.getsize(orig_path) if os.path.exists(orig_path) else 0
            w, h = _get_image_dimensions(fpath)
            db.execute("""
                INSERT OR IGNORE INTO media_assets
                    (filename, original_filename, file_size, original_size,
                     media_type, width, height, source)
                VALUES (?, ?, ?, ?, 'image', ?, ?, 'scan')
            """, [f, f if orig_sz > 0 else "", sz, orig_sz, w, h])
            added += 1

    # 3. videos/ → 补齐
    if os.path.exists(VIDEO_DIR):
        for f in os.listdir(VIDEO_DIR):
            fpath = os.path.join(VIDEO_DIR, f)
            if not os.path.isfile(fpath):
                continue
            exists = db.execute("SELECT id FROM media_assets WHERE filename=?", [f]).fetchone()
            if exists:
                continue
            sz = os.path.getsize(fpath)
            db.execute("""
                INSERT OR IGNORE INTO media_assets
                    (filename, file_size, media_type, source)
                VALUES (?, ?, 'video', 'scan')
            """, [f, sz])
            added += 1

    db.commit()

    # 4. 关联 prompt_thumbnails 和 prompt_videos 中已有的 prompt_id
    linked = 0
    for r in db.execute("SELECT prompt_id, filename FROM prompt_thumbnails").fetchall():
        db.execute("UPDATE media_assets SET prompt_id=? WHERE filename=? AND prompt_id=0",
                   [r["prompt_id"], r["filename"]])
        linked += db.execute("SELECT changes()").fetchone()[0]
    for r in db.execute("SELECT prompt_id, filename FROM prompt_videos").fetchall():
        db.execute("UPDATE media_assets SET prompt_id=? WHERE filename=? AND prompt_id=0",
                   [r["prompt_id"], r["filename"]])
        linked += db.execute("SELECT changes()").fetchone()[0]
    db.commit()

    return {"ok": True, "added": added, "linked": linked}


# ============ API: 清理孤儿记录 ============

@router.post("/cleanup-orphans")
def media_cleanup():
    """删除 media_assets 表中磁盘文件不存在的记录"""
    db = get_db()
    removed = 0
    for r in db.execute("SELECT id, filename, original_filename, media_type FROM media_assets").fetchall():
        thumb_path = os.path.join(THUMB_DIR, r["filename"])
        video_path = os.path.join(VIDEO_DIR, r["filename"])
        exists = os.path.exists(thumb_path) or os.path.exists(video_path)
        if not exists:
            db.execute("DELETE FROM media_assets WHERE id=?", [r["id"]])
            removed += 1
    db.commit()
    return {"ok": True, "removed": removed}


# ============ API: 手动关联 prompt ============

@router.post("/associate")
def media_associate(data: dict):
    """关联媒体文件到提示词"""
    filename = data.get("filename", "").strip()
    prompt_id = data.get("prompt_id", 0)
    if not filename or not prompt_id:
        return JSONResponse({"ok": False, "error": "缺少 filename 或 prompt_id"}, status_code=400)
    _update_asset_prompt(filename, prompt_id)
    return {"ok": True, "filename": filename, "prompt_id": prompt_id}
