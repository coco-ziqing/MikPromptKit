"""
API 路由 — 提示词缩略图管理
上传 / 选取 / 取消关联 / 图库列表
"""
import hashlib
import os, uuid, json, subprocess
from fastapi import APIRouter, Query, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from database import get_db

router = APIRouter(prefix="/api/thumbnails", tags=["thumbnails"])

# 缩略图存储目录
THUMB_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "data", "thumbnails"
)
os.makedirs(THUMB_DIR, exist_ok=True)

ALLOWED_EXT = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'}
THUMB_SIZE = (240, 160)  # 宽 x 高，3:2 比例

# 原图存储目录
ORIGINAL_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "data", "originals"
)
os.makedirs(ORIGINAL_DIR, exist_ok=True)

def _resize_and_save(file_bytes, dest_path):
    """用 Pillow 缩放裁剪并保存为质量 85 的 JPEG"""
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(file_bytes))
        # 统一转为 RGB
        if img.mode in ('RGBA', 'P'):
            img = img.convert('RGB')
        # 按目标比例裁剪中心区域
        target_w, target_h = THUMB_SIZE
        src_w, src_h = img.size
        src_ratio = src_w / src_h
        target_ratio = target_w / target_h
        if src_ratio > target_ratio:
            # 原图太宽：裁剪宽度
            new_w = int(src_h * target_ratio)
            new_h = src_h
            offset = (src_w - new_w) // 2
            img = img.crop((offset, 0, offset + new_w, new_h))
        else:
            # 原图太高：裁剪高度
            new_w = src_w
            new_h = int(src_w / target_ratio)
            offset = (src_h - new_h) // 2
            img = img.crop((0, offset, new_w, offset + new_h))
        # 缩放到目标尺寸
        img = img.resize(THUMB_SIZE, Image.LANCZOS)
        img.save(dest_path, 'JPEG', quality=85)
        return True
    except ImportError:
        # 无 Pillow，直接保存原始文件（前端会做 CSS cover）
        with open(dest_path, 'wb') as f:
            f.write(file_bytes)
        return False
    except Exception as e:
        print('[缩略图] 处理失败:', e)
        return False


@router.post("/upload")
async def upload_thumbnail(file: UploadFile = File(...)):
    """上传图片到缩略图库，自动裁剪为 3:2 比例"""
    # 验证扩展名
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"不支持的图片格式: {ext}，支持 {ALLOWED_EXT}")

    # 读取文件内容
    file_bytes = await file.read()
    if len(file_bytes) > 10 * 1024 * 1024:
        raise HTTPException(400, "图片太大，最大 10MB")

    # 计算文件 hash，检查是否已存在
    file_hash = hashlib.sha256(file_bytes).hexdigest()
    file_size = len(file_bytes)
    db = get_db()
    existing = db.execute("SELECT filename FROM thumb_hash WHERE hash=? AND size=?", [file_hash, file_size]).fetchone()
    if not existing:
        # hash 表为空时兜底检查磁盘文件（首次迁移后初次运行）
        # 只检查一次：如果表为空，遍历磁盘
        count = db.execute("SELECT COUNT(*) as c FROM thumb_hash").fetchone()
        if count and count["c"] == 0:
            for existing_f in os.listdir(THUMB_DIR):
                if not existing_f.endswith('.jpg'):
                    continue
                ep = os.path.join(THUMB_DIR, existing_f)
                try:
                    if os.path.getsize(ep) == file_size:
                        with open(ep, 'rb') as ef:
                            if hashlib.sha256(ef.read()).hexdigest() == file_hash:
                                existing = {"filename": existing_f}
                                break
                except Exception:
                    continue
    if existing:
        # 文件已在库中
        return {
            "ok": True,
            "filename": existing["filename"],
            "url": f"/api/thumbnails/file/{existing['filename']}",
            "duplicate": True,
            "size": file_size
        }

    # 生成唯一文件名
    unique_name = uuid.uuid4().hex + '.jpg'
    dest_path = os.path.join(THUMB_DIR, unique_name)

    # 保存原图
    orig_path = os.path.join(ORIGINAL_DIR, unique_name)
    with open(orig_path, 'wb') as f:
        f.write(file_bytes)

    ok = _resize_and_save(file_bytes, dest_path)

    # 写入 hash 缓存
    try:
        db.execute("INSERT OR REPLACE INTO thumb_hash (filename, hash, size) VALUES (?, ?, ?)",
                   [unique_name, file_hash, file_size])
        db.commit()
    except Exception:
        pass

    # 记录原始文件名
    try:
        db.execute("INSERT OR REPLACE INTO thumb_meta (filename, original_name, media_type) VALUES (?, ?, 'image')",
                   [unique_name, file.filename])
        db.commit()
    except Exception:
        pass

    # 同步写入媒体资产管理库
    try:
        from PIL import Image as PILImage
        import io
        _img = PILImage.open(io.BytesIO(file_bytes))
        _w, _h = _img.size
        db.execute("""
            INSERT OR IGNORE INTO media_assets
                (filename, original_filename, file_size, original_size,
                 media_type, width, height, mime_type, source)
            VALUES (?, ?, ?, ?, 'image', ?, ?, 'image/jpeg', 'upload')
        """, [unique_name, unique_name, os.path.getsize(dest_path) if os.path.exists(dest_path) else 0,
              file_size, _w, _h])
        db.commit()
    except Exception:
        pass
    return {
        "ok": True,
        "filename": unique_name,
        "url": f"/api/thumbnails/file/{unique_name}",
        "original_url": f"/api/thumbnails/original/{unique_name}",
        "resized": ok,
        "size": os.path.getsize(dest_path)
    }


@router.get("/library")
def list_thumbnails(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)):
    """获取缩略图库列表（分页）— 排除视频自动生成的封面截图"""
    try:
        all_files = [f for f in os.listdir(THUMB_DIR)
                     if os.path.isfile(os.path.join(THUMB_DIR, f)) and
                     os.path.splitext(f)[1].lower() in ALLOWED_EXT]
    except FileNotFoundError:
        all_files = []

    # 排除视频自动生成的截图：_poster1.jpg, _poster2.jpg，以及 prompt_videos.poster 中的文件
    db = get_db()
    video_posters = set()
    for r in db.execute("SELECT poster FROM prompt_videos WHERE poster != ''").fetchall():
        video_posters.add(r["poster"])
    all_files = [f for f in all_files if '_poster' not in f and f not in video_posters]

    # 按修改时间倒序
    all_files.sort(key=lambda f: os.path.getmtime(os.path.join(THUMB_DIR, f)), reverse=True)

    total = len(all_files)
    offset = (page - 1) * page_size
    page_files = all_files[offset:offset + page_size]

    # 检查哪些已被使用
    db = get_db()
    used_rows = db.execute("SELECT prompt_id, filename FROM prompt_thumbnails").fetchall()
    used_set = {r["filename"]: r["prompt_id"] for r in used_rows}

    items = []
    for f in page_files:
        fpath = os.path.join(THUMB_DIR, f)
        # 查询原始文件名
        meta = db.execute("SELECT original_name FROM thumb_meta WHERE filename=?", [f]).fetchone()
        orig_name = meta["original_name"] if meta else f
        items.append({
            "filename": f,
            "original_name": orig_name,
            "url": f"/api/thumbnails/file/{f}",
            "size": os.path.getsize(fpath),
            "used_by": used_set.get(f)
        })

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "items": items
    }


@router.get("/file/{filename}")
def serve_thumbnail(filename: str):
    """提供缩略图文件 — 主目录 data/thumbnails/ → fallback 词卡目录 data/wc_media/thumbs/"""
    safe_name = os.path.basename(filename)
    fpath = os.path.join(THUMB_DIR, safe_name)
    if not os.path.exists(fpath):
        # Phase17: 统一媒体服务 — 回退到词卡缩略图目录
        wc_thumb_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            "data", "wc_media", "thumbs", safe_name
        )
        if os.path.exists(wc_thumb_path):
            return FileResponse(wc_thumb_path, media_type="image/jpeg")
        raise HTTPException(404, "文件不存在")
    return FileResponse(fpath, media_type="image/jpeg")


@router.get("/original/{filename}")
def serve_original(filename: str):
    """提供原图文件（用于大图查看）
    优先从 originals/ 目录取 original_filename（media_assets 关联），
    同一文件名找不到时回退到缩略图。
    对于 AI 生成的图片，缩略图和原图文件名不同，
    通过 media_assets.original_filename 映射找到正确原图。
    """
    safe_name = os.path.basename(filename)
    orig_name = safe_name

    # 查 media_assets 表获取正确的原图文件名
    try:
        db = get_db()
        asset = db.execute(
            "SELECT original_filename FROM media_assets WHERE filename=? OR original_filename=?",
            [safe_name, safe_name]
        ).fetchone()
        if asset and asset["original_filename"]:
            orig_name = asset["original_filename"]
    except Exception:
        pass

    fpath = os.path.join(ORIGINAL_DIR, orig_name)
    if not os.path.exists(fpath):
        # 回退到缩略图
        fpath = os.path.join(THUMB_DIR, safe_name)
        if not os.path.exists(fpath):
            # Phase17: 再回退到词卡缩略图目录
            wc_thumb_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                "data", "wc_media", "thumbs", safe_name
            )
            if os.path.exists(wc_thumb_path):
                return FileResponse(wc_thumb_path)
            raise HTTPException(404, "文件不存在")
    return FileResponse(fpath)


@router.post("/assign")
def assign_thumbnail(data: dict):
    """为提示词关联缩略图（同时清除视频关联）"""
    prompt_id = data.get("prompt_id")
    filename = data.get("filename")
    if not prompt_id or not filename:
        raise HTTPException(400, "缺少 prompt_id 或 filename")

    db = get_db()
    # 先确认文件存在
    fpath = os.path.join(THUMB_DIR, os.path.basename(filename))
    if not os.path.exists(fpath):
        raise HTTPException(404, "缩略图文件不存在")

    # 清除视频关联（切换到图片模式）
    db.execute("DELETE FROM prompt_videos WHERE prompt_id=?", [prompt_id])

    db.execute(
        "INSERT OR REPLACE INTO prompt_thumbnails (prompt_id, filename, media_type, updated_at) VALUES (?, ?, 'image', datetime('now','localtime'))",
        [prompt_id, os.path.basename(filename)]
    )
    db.commit()

    # 同步更新媒体资产管理库的 prompt_id 关联
    try:
        db.execute("UPDATE media_assets SET prompt_id=?, updated_at=datetime('now','localtime') WHERE filename=?",
                   [prompt_id, os.path.basename(filename)])
        db.commit()
    except Exception:
        pass

    return {"ok": True, "prompt_id": prompt_id, "filename": os.path.basename(filename)}


@router.delete("/assign/{prompt_id}")
def remove_thumbnail(prompt_id: int):
    """取消提示词的缩略图关联（同时清除视频关联，不删除文件）"""
    db = get_db()
    db.execute("DELETE FROM prompt_thumbnails WHERE prompt_id=?", [prompt_id])
    db.execute("DELETE FROM prompt_videos WHERE prompt_id=?", [prompt_id])
    db.commit()
    return {"ok": True}


@router.delete("/file/{filename}")
def delete_thumbnail_file(filename: str):
    """从图库删除缩略图文件（同时清除关联）"""
    safe_name = os.path.basename(filename)
    fpath = os.path.join(THUMB_DIR, safe_name)
    if os.path.exists(fpath):
        os.remove(fpath)
    # 清除数据库关联
    db = get_db()
    db.execute("DELETE FROM prompt_thumbnails WHERE filename=?", [safe_name])
    db.execute("DELETE FROM thumb_hash WHERE filename=?", [safe_name])
    db.execute("DELETE FROM thumb_meta WHERE filename=?", [safe_name])
    db.commit()
    return {"ok": True}


# ==================== 视频缩略图 ====================

VIDEO_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "data", "videos"
)
os.makedirs(VIDEO_DIR, exist_ok=True)

def _probe_video_info(filepath):
    """用 ffprobe 探测视频 fps、分辨率、时长"""
    info = {"fps": 0, "width": 0, "height": 0, "duration": 0}
    try:
        import subprocess, json
        probe = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filepath],
            capture_output=True, timeout=15, text=True
        )
        data = json.loads(probe.stdout)
        # 时长
        fmt = data.get('format', {})
        info['duration'] = float(fmt.get('duration', 0))
        # 从视频流取 fps / 分辨率
        for s in data.get('streams', []):
            if s.get('codec_type') == 'video':
                r_frame_rate = s.get('r_frame_rate', '0/1')  # '30000/1001' or '24/1'
                if '/' in r_frame_rate:
                    num, den = r_frame_rate.split('/')
                    try:
                        info['fps'] = round(float(num) / max(float(den), 1), 3)
                    except:
                        info['fps'] = 0
                info['width'] = int(s.get('width', 0))
                info['height'] = int(s.get('height', 0))
                break
    except Exception as e:
        print('[视频探测] 失败:', e)
    return info


ALLOWED_VIDEO_EXT = {'.mp4', '.webm', '.mov', '.avi'}


@router.post("/upload-video")
async def upload_video(file: UploadFile = File(...)):
    """上传视频，自动提取第一帧作为封面"""
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_VIDEO_EXT:
        raise HTTPException(400, f"不支持的视频格式: {ext}，支持 {ALLOWED_VIDEO_EXT}")

    # 生成唯一名
    base_name = uuid.uuid4().hex
    video_name = base_name + ext
    poster_name = base_name + '.jpg'

    video_path = os.path.join(VIDEO_DIR, video_name)

    # 读取上传内容
    file_bytes = await file.read()
    if len(file_bytes) > 50 * 1024 * 1024:
        raise HTTPException(400, "视频太大，最大 50MB")

    with open(video_path, 'wb') as f:
        f.write(file_bytes)

    # 用 ffmpeg 提取第一帧作为封面
    poster_path = os.path.join(THUMB_DIR, poster_name)
    try:
        import subprocess
        subprocess.run(
            ['ffmpeg', '-ss', '0.1', '-i', video_path, '-vframes', '1',
             '-q:v', '2', poster_path, '-y'],
            capture_output=True, timeout=30
        )
        poster_ok = os.path.exists(poster_path)
    except Exception as e:
        print('[视频] 封面提取失败:', e)
        poster_ok = False

    # 获取视频时长 + fps/分辨率
    duration = 0
    vinfo = {}
    try:
        import subprocess, json
        probe = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', video_path],
            capture_output=True, timeout=10, text=True
        )
        info = json.loads(probe.stdout)
        duration = float(info.get('format', {}).get('duration', 0))
    except Exception:
        pass

    vinfo = _probe_video_info(video_path)

    # 写入数据库 poster 字段（持久化封面关联）
    if poster_ok:
        try:
            db = get_db()
            db.execute("INSERT OR REPLACE INTO prompt_videos (filename, poster, duration, fps, width, height, updated_at) "
                       "VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))",
                       [video_name, poster_name, round(duration, 1),
                        vinfo.get("fps", 0), vinfo.get("width", 0), vinfo.get("height", 0)])
            # 记录原始文件名
            db.execute("INSERT OR REPLACE INTO thumb_meta (filename, original_name, media_type) VALUES (?, ?, 'video')",
                       [video_name, file.filename])
            db.commit()
        except Exception:
            pass

    return {
        "ok": True,
        "video_filename": video_name,
        "poster_filename": poster_name if poster_ok else None,
        "video_url": f"/api/thumbnails/video/{video_name}",
        "poster_url": f"/api/thumbnails/file/{poster_name}" if poster_ok else None,
        "duration": round(duration, 1),
        "fps": vinfo.get("fps", 0),
        "width": vinfo.get("width", 0),
        "height": vinfo.get("height", 0),
        "size": len(file_bytes)
    }


@router.get("/video-info/{filename}")
def get_video_info(filename: str):
    """返回视频的封面文件名等信息"""
    safe_name = os.path.basename(filename)
    db = get_db()
    row = db.execute("SELECT poster FROM prompt_videos WHERE filename=?", [safe_name]).fetchone()
    if row and row["poster"]:
        return {"ok": True, "filename": safe_name, "poster": row["poster"]}
    # 兜底：按文件名前缀查找
    base = os.path.splitext(safe_name)[0]
    for ext in ['.jpg', '.jpeg', '.png']:
        ppath = os.path.join(THUMB_DIR, base + ext)
        if os.path.exists(ppath):
            return {"ok": True, "filename": safe_name, "poster": base + ext}
    # 再兜底 _poster1
    for suffix in ['_poster1.jpg', '_poster2.jpg']:
        ppath = os.path.join(THUMB_DIR, base + suffix)
        if os.path.exists(ppath):
            return {"ok": True, "filename": safe_name, "poster": base + suffix}
    return {"ok": False, "filename": safe_name, "poster": None}


@router.get("/video/{filename}")
def serve_video(filename: str):
    """提供视频文件 — 主目录 data/thumbnails/ → fallback 词卡目录 data/wc_media/videos/"""
    safe_name = os.path.basename(filename)
    fpath = os.path.join(VIDEO_DIR, safe_name)
    if not os.path.exists(fpath):
        # Phase17: 统一媒体服务 — 回退到词卡视频目录
        wc_video_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            "data", "wc_media", "videos", safe_name
        )
        if os.path.exists(wc_video_path):
            fpath = wc_video_path
        else:
            raise HTTPException(404, "视频不存在")
    # 根据扩展名设置正确 mime
    ext = os.path.splitext(safe_name)[1].lower()
    mime = {
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo'
    }.get(ext, 'video/mp4')
    return FileResponse(fpath, media_type=mime)


@router.post("/assign-video")
def assign_video(data: dict):
    """为提示词关联视频"""
    prompt_id = data.get("prompt_id")
    video_filename = data.get("video_filename")
    poster_filename = data.get("poster_filename", "")
    if not prompt_id or not video_filename:
        raise HTTPException(400, "缺少 prompt_id 或 video_filename")

    db = get_db()
    # 检查视频文件存在
    vpath = os.path.join(VIDEO_DIR, os.path.basename(video_filename))
    if not os.path.exists(vpath):
        raise HTTPException(404, "视频文件不存在")

    # 探测 fps/分辨率
    vinfo = _probe_video_info(vpath)

    db.execute(
        "INSERT OR REPLACE INTO prompt_videos (prompt_id, filename, poster, duration, fps, width, height, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))",
        [prompt_id, os.path.basename(video_filename), poster_filename,
         data.get("duration", 0), vinfo.get("fps", 0),
         vinfo.get("width", 0), vinfo.get("height", 0)]
    )
    # 如果有封面，也设到缩略图表
    if poster_filename:
        db.execute(
            "INSERT OR REPLACE INTO prompt_thumbnails (prompt_id, filename, media_type, updated_at) "
            "VALUES (?, ?, 'video', datetime('now','localtime'))",
            [prompt_id, poster_filename]
        )
    db.commit()
    return {"ok": True, "prompt_id": prompt_id}


@router.delete("/video-assign/{prompt_id}")
def remove_video(prompt_id: int):
    """取消视频关联"""
    db = get_db()
    db.execute("DELETE FROM prompt_videos WHERE prompt_id=?", [prompt_id])
    db.commit()
    return {"ok": True}


@router.post("/prepare-upload")
async def prepare_video_upload(file: UploadFile = File(...)):
    """
    视频预上传：接收文件、提取时长、返回临时路径等信息
    前端据此决定是否需要裁剪
    """
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_VIDEO_EXT:
        raise HTTPException(400, f"不支持的视频格式: {ext}")

    # 保存到临时文件
    base_name = uuid.uuid4().hex
    orig_name = base_name + ext
    orig_path = os.path.join(VIDEO_DIR, orig_name)

    file_bytes = await file.read()
    file_size = len(file_bytes)
    if file_size > 200 * 1024 * 1024:
        raise HTTPException(400, "视频太大，最大 200MB")

    with open(orig_path, 'wb') as f:
        f.write(file_bytes)

    # 获取时长 + fps/分辨率
    duration = 0
    try:
        probe = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', orig_path],
            capture_output=True, timeout=10, text=True
        )
        info = json.loads(probe.stdout)
        duration = float(info.get('format', {}).get('duration', 0))
    except Exception:
        pass
    vinfo = _probe_video_info(orig_path)

    # 生成截图供预览（第1帧和第25%位置帧）
    poster1 = base_name + '_poster1.jpg'
    poster2 = base_name + '_poster2.jpg'
    poster1_path = os.path.join(THUMB_DIR, poster1)
    poster2_path = os.path.join(THUMB_DIR, poster2)
    try:
        mid_time = duration * 0.25 if duration > 0 else 0
        subprocess.run(['ffmpeg', '-ss', '0', '-i', orig_path, '-vframes', '1',
            '-vf', f'scale=480:-2', '-q:v', '2', poster1_path, '-y'], capture_output=True, timeout=15)
        subprocess.run(['ffmpeg', '-ss', str(mid_time), '-i', orig_path, '-vframes', '1',
            '-vf', f'scale=480:-2', '-q:v', '2', poster2_path, '-y'], capture_output=True, timeout=15)
        poster_ok = True
    except Exception:
        poster_ok = False

    return {
        "ok": True,
        "temp_file": orig_name,
        "original_name": file.filename,
        "size": file_size,
        "size_mb": round(file_size / 1048576, 1),
        "duration": round(duration, 1),
        "fps": vinfo.get("fps", 0),
        "width": vinfo.get("width", 0),
        "height": vinfo.get("height", 0),
        "needs_trim": file_size > 10 * 1024 * 1024
    }


@router.post("/finalize-upload")
def finalize_video_upload(data: dict):
    """小视频最终确认：对 prepare-upload 已保存的视频生成封面、写入数据库"""
    temp_filename = data.get("temp_filename")
    original_name = data.get("original_name", temp_filename or "")
    if not temp_filename:
        raise HTTPException(400, "缺少 temp_filename")

    ext = os.path.splitext(temp_filename)[1].lower()
    if ext not in ALLOWED_VIDEO_EXT:
        # 清理
        vp = os.path.join(VIDEO_DIR, temp_filename)
        if os.path.exists(vp): os.remove(vp)
        raise HTTPException(400, "不支持的视频格式")

    video_path = os.path.join(VIDEO_DIR, temp_filename)
    if not os.path.exists(video_path):
        raise HTTPException(404, "临时文件不存在")

    base_name = os.path.splitext(temp_filename)[0]
    poster_name = base_name + '.jpg'
    poster_path = os.path.join(THUMB_DIR, poster_name)

    # 生成封面
    poster_ok = False
    try:
        subprocess.run(
            ['ffmpeg', '-ss', '0.1', '-i', video_path, '-vframes', '1',
             '-q:v', '2', poster_path, '-y'],
            capture_output=True, timeout=30
        )
        poster_ok = os.path.exists(poster_path)
    except Exception:
        pass

    # 探测信息
    vinfo = _probe_video_info(video_path)

    # 写入数据库
    if poster_ok:
        try:
            db = get_db()
            db.execute("INSERT OR REPLACE INTO prompt_videos (filename, poster, duration, fps, width, height, updated_at) "
                       "VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))",
                       [temp_filename, poster_name, round(vinfo.get("duration", 0), 1),
                        vinfo.get("fps", 0), vinfo.get("width", 0), vinfo.get("height", 0)])
            db.execute("INSERT OR REPLACE INTO thumb_meta (filename, original_name, media_type) VALUES (?, ?, 'video')",
                       [temp_filename, original_name])
            db.commit()
        except Exception:
            pass

    return {
        "ok": True,
        "video_filename": temp_filename,
        "poster_filename": poster_name if poster_ok else None,
        "video_url": f"/api/thumbnails/video/{temp_filename}",
        "poster_url": f"/api/thumbnails/file/{poster_name}" if poster_ok else None,
        "duration": round(vinfo.get("duration", 0), 1),
        "fps": vinfo.get("fps", 0),
        "width": vinfo.get("width", 0),
        "height": vinfo.get("height", 0),
    }


@router.post("/trim-video")
def trim_video(data: dict):
    """
    裁剪/压缩视频
    参数: temp_file, start_time, end_time, quality(1-5), prompt_id
    """
    temp_file = data.get("temp_file")
    start_time = data.get("start_time", 0)
    end_time = data.get("end_time", 0)
    quality = data.get("quality", 3)  # 1=最低 5=最高
    prompt_id = data.get("prompt_id")

    if not temp_file:
        raise HTTPException(400, "缺少 temp_file")

    safe_name = os.path.basename(temp_file)
    ext = os.path.splitext(safe_name)[1].lower()
    orig_path = os.path.join(VIDEO_DIR, safe_name)
    if not os.path.exists(orig_path):
        raise HTTPException(404, "临时文件不存在")

    # 生成最终文件名
    output_base = uuid.uuid4().hex
    output_name = output_base + '.mp4'
    output_path = os.path.join(VIDEO_DIR, output_name)

    # 拼装 ffmpeg 参数
    # quality 1-5 映射到 crf 40-18
    crf_map = {1: 40, 2: 35, 3: 28, 4: 23, 5: 18}
    crf = crf_map.get(quality, 28)

    ffmpeg_cmd = ['ffmpeg', '-i', orig_path]

    if end_time > 0 and end_time > start_time:
        duration = end_time - start_time
        ffmpeg_cmd += ['-ss', str(start_time), '-t', str(duration)]

    ffmpeg_cmd += ['-c:v', 'libx264', '-crf', str(crf),
                   '-preset', 'fast', '-c:a', 'aac', '-b:a', '96k',
                   '-movflags', '+faststart', output_path, '-y']

    duration_out = 0
    try:
        result = subprocess.run(ffmpeg_cmd, capture_output=True, timeout=300, text=True)
        if result.returncode != 0:
            raise HTTPException(500, f"ffmpeg 处理失败: {result.stderr[:500]}")

        # 提取封面
        poster_name = output_base + '.jpg'
        poster_path = os.path.join(THUMB_DIR, poster_name)
        subprocess.run(['ffmpeg', '-ss', '0.1', '-i', output_path, '-vframes', '1',
            '-q:v', '2', poster_path, '-y'], capture_output=True, timeout=15)

        # 获取最终时长
        probe = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', output_path],
            capture_output=True, timeout=10, text=True
        )
        info = json.loads(probe.stdout)
        duration_out = float(info.get('format', {}).get('duration', 0))

        out_size = os.path.getsize(output_path)

        # 如果设了 prompt_id，自动关联
        if prompt_id:
            db = get_db()
            # 探测 fps/分辨率
            vinfo = _probe_video_info(output_path)
            db.execute(
                "INSERT OR REPLACE INTO prompt_videos (prompt_id, filename, poster, duration, fps, width, height, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))",
                [prompt_id, output_name, poster_name, round(duration_out, 1),
                 vinfo.get("fps", 0), vinfo.get("width", 0), vinfo.get("height", 0)]
            )
            db.execute(
                "INSERT OR REPLACE INTO prompt_thumbnails (prompt_id, filename, media_type, updated_at) "
                "VALUES (?, ?, 'video', datetime('now','localtime'))",
                [prompt_id, poster_name]
            )
            db.commit()

        # 清理临时文件
        try:
            os.remove(orig_path)
        except Exception:
            pass

        return {
            "ok": True,
            "video_filename": output_name,
            "poster_filename": poster_name,
            "video_url": f"/api/thumbnails/video/{output_name}",
            "duration": round(duration_out, 1),
            "size": out_size,
            "size_mb": round(out_size / 1048576, 1)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"处理失败: {str(e)}")



# ==================== 视频库管理 ====================



@router.get("/video-library")
def list_video_library(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)):
    """获取视频库列表（分页）——缓存加速，封面延迟生成"""
    try:
        all_files = [f for f in os.listdir(VIDEO_DIR)
                     if os.path.isfile(os.path.join(VIDEO_DIR, f)) and
                     os.path.splitext(f)[1].lower() in ALLOWED_VIDEO_EXT]
    except FileNotFoundError:
        all_files = []
    all_files.sort(key=lambda f: os.path.getmtime(os.path.join(VIDEO_DIR, f)), reverse=True)
    total = len(all_files)
    offset = (page - 1) * page_size
    page_files = all_files[offset:offset + page_size]
    db = get_db()
    used_rows = db.execute("SELECT prompt_id, filename FROM prompt_videos").fetchall()
    used_set = {r["filename"]: r["prompt_id"] for r in used_rows}

    # 需要生成封面的视频列表（延迟到后台）
    needs_cover = []

    items = []
    for f in page_files:
        fpath = os.path.join(VIDEO_DIR, f)
        size = os.path.getsize(fpath)

        # 从 video_cache 读元数据（避免每次 ffprobe）
        cache = db.execute("SELECT fps, width, height, duration FROM video_cache WHERE filename=?", [f]).fetchone()
        if cache:
            fps = cache["fps"]
            width = cache["width"]
            height = cache["height"]
            duration = cache["duration"]
        else:
            vinfo = _probe_video_info(fpath)
            fps = vinfo.get("fps", 0)
            width = vinfo.get("width", 0)
            height = vinfo.get("height", 0)
            duration = vinfo.get("duration", 0)
            # 写缓存
            try:
                db.execute(
                    "INSERT OR REPLACE INTO video_cache (filename, fps, width, height, duration, cached_at) "
                    "VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))",
                    [f, fps, width, height, duration]
                )
                db.commit()
            except Exception:
                pass

        # 从 poster 取封面
        cover = None
        poster_row = db.execute("SELECT poster FROM prompt_videos WHERE filename=?", [f]).fetchone()
        if poster_row and poster_row["poster"]:
            ppath = os.path.join(THUMB_DIR, poster_row["poster"])
            if os.path.exists(ppath):
                cover = poster_row["poster"]

        # 兜底文件名匹配
        if not cover:
            base = os.path.splitext(f)[0]
            found = False
            for ext in ['.jpg', '.jpeg', '.png']:
                cpath = os.path.join(THUMB_DIR, base + ext)
                if os.path.exists(cpath):
                    cover = base + ext
                    found = True
                    break
            if not found:
                # 兜底检查 _poster1.jpg / _poster2.jpg
                for suffix in ['_poster1.jpg', '_poster2.jpg']:
                    cpath = os.path.join(THUMB_DIR, base + suffix)
                    if os.path.exists(cpath):
                        cover = base + suffix
                        break

        # 没有封面 → 记录需求，后续延迟生成
        if not cover:
            needs_cover.append(f)

        # 查询原始文件名
        meta = db.execute("SELECT original_name FROM thumb_meta WHERE filename=?", [f]).fetchone()
        orig_name = meta["original_name"] if meta else f

        items.append({
            "filename": f,
            "original_name": orig_name,
            "url": f"/api/thumbnails/video/{f}",
            "cover_url": f"/api/thumbnails/file/{cover}" if cover else None,
            "duration": round(duration, 1),
            "fps": fps,
            "width": width,
            "height": height,
            "size": size,
            "size_mb": round(size / 1048576, 1),
            "used_by": used_set.get(f)
        })

    # 同步生成缺失封面（即时可见）
    if needs_cover:
        for fname in needs_cover:
            try:
                fpath = os.path.join(VIDEO_DIR, fname)
                if not os.path.exists(fpath):
                    continue
                cover_name = os.path.splitext(fname)[0] + '.jpg'
                cover_path = os.path.join(THUMB_DIR, cover_name)
                if os.path.exists(cover_path):
                    continue
                subprocess.run(
                    ['ffmpeg', '-ss', '0.1', '-i', fpath, '-vframes', '1',
                     '-q:v', '2', cover_path, '-y'],
                    capture_output=True, timeout=30
                )
                if os.path.exists(cover_path):
                    # 更新响应中的 cover_url
                    for item in items:
                        if item["filename"] == fname:
                            item["cover_url"] = f"/api/thumbnails/file/{cover_name}"
                    # 更新数据库
                    _db = get_db()
                    _db.execute("UPDATE prompt_videos SET poster=? WHERE filename=?", [cover_name, fname])
                    _db.commit()
                    _db.close()
            except Exception:
                pass

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "items": items
    }

@router.delete("/video-file/{filename}")
def delete_video_file(filename: str):
    """从视频库删除视频文件（同时清除关联和封面）"""
    safe_name = os.path.basename(filename)
    vpath = os.path.join(VIDEO_DIR, safe_name)
    if os.path.exists(vpath):
        os.remove(vpath)
    base = os.path.splitext(safe_name)[0]
    # 删除封面文件（含 _poster1.jpg, _poster2.jpg）
    for suffix in ['', '_poster1', '_poster2']:
        for ext in ['.jpg', '.jpeg', '.png']:
            ppath = os.path.join(THUMB_DIR, base + suffix + ext)
            if os.path.exists(ppath):
                os.remove(ppath)
                break
    db = get_db()
    row = db.execute("SELECT poster FROM prompt_videos WHERE filename=?", [safe_name]).fetchone()
    if row and row["poster"]:
        poster_f = row["poster"]
        db.execute("DELETE FROM prompt_thumbnails WHERE filename=?", [poster_f])
        db.execute("DELETE FROM thumb_hash WHERE filename=?", [poster_f])
        db.execute("DELETE FROM thumb_meta WHERE filename=?", [poster_f])
        # 也清理 _poster1 / _poster2
        pbase = os.path.splitext(poster_f)[0]
        for pid_suffix in ['_poster1', '_poster2']:
            for p_ext in ['.jpg', '.jpeg', '.png']:
                pf = pbase + pid_suffix + p_ext
                db.execute("DELETE FROM thumb_hash WHERE filename=?", [pf])
                db.execute("DELETE FROM thumb_meta WHERE filename=?", [pf])
    db.execute("DELETE FROM prompt_videos WHERE filename=?", [safe_name])
    db.execute("DELETE FROM thumb_meta WHERE filename=?", [safe_name])
    db.execute("DELETE FROM video_cache WHERE filename=?", [safe_name])
    db.commit()
    return {"ok": True}


@router.post("/assign-video-from-library")
def assign_video_from_library(data: dict):
    """从视频库选择视频关联到提示词"""
    prompt_id = data.get("prompt_id")
    video_filename = data.get("video_filename")
    if not prompt_id or not video_filename:
        raise HTTPException(400, "缺少 prompt_id 或 video_filename")
    db = get_db()
    vpath = os.path.join(VIDEO_DIR, os.path.basename(video_filename))
    if not os.path.exists(vpath):
        raise HTTPException(404, "视频文件不存在")
    base_name = uuid.uuid4().hex
    poster_name = base_name + '.jpg'
    poster_path = os.path.join(THUMB_DIR, poster_name)
    try:
        import subprocess
        subprocess.run(
            ['ffmpeg', '-ss', '0.1', '-i', vpath, '-vframes', '1',
             '-q:v', '2', poster_path, '-y'],
            capture_output=True, timeout=30
        )
    except Exception:
        poster_name = ''
    vinfo = _probe_video_info(vpath)
    db.execute("DELETE FROM prompt_thumbnails WHERE prompt_id=? AND media_type='image'", [prompt_id])
    db.execute(
        "INSERT OR REPLACE INTO prompt_videos (prompt_id, filename, poster, duration, fps, width, height, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))",
        [prompt_id, os.path.basename(video_filename), poster_name,
         vinfo.get("duration", 0), vinfo.get("fps", 0),
         vinfo.get("width", 0), vinfo.get("height", 0)]
    )
    if poster_name:
        db.execute(
            "INSERT OR REPLACE INTO prompt_thumbnails (prompt_id, filename, media_type, updated_at) "
            "VALUES (?, ?, 'video', datetime('now','localtime'))",
            [prompt_id, poster_name]
        )
    db.commit()
    return {"ok": True, "prompt_id": prompt_id, "poster_filename": poster_name, "duration": round(vinfo.get("duration", 0), 1)}


@router.post("/batch-delete-thumbnails")
def batch_delete_thumbnails(data: dict):
    """批量删除缩略图文件（同时清除关联）"""
    filenames = data.get("filenames", [])
    if not filenames:
        raise HTTPException(400, "缺少 filenames")
    db = get_db()
    deleted = []
    for fname in filenames:
        safe_name = os.path.basename(fname)
        fpath = os.path.join(THUMB_DIR, safe_name)
        if os.path.exists(fpath):
            os.remove(fpath)
        # 清除数据库关联
        db.execute("DELETE FROM prompt_thumbnails WHERE filename=?", [safe_name])
        db.execute("DELETE FROM thumb_hash WHERE filename=?", [safe_name])
        db.execute("DELETE FROM thumb_meta WHERE filename=?", [safe_name])
        deleted.append(safe_name)
    db.commit()
    return {"ok": True, "deleted_count": len(deleted), "deleted": deleted}


@router.post("/batch-delete-videos")
def batch_delete_videos(data: dict):
    """批量删除视频文件（同时清除关联和封面）"""
    filenames = data.get("filenames", [])
    if not filenames:
        raise HTTPException(400, "缺少 filenames")
    db = get_db()
    deleted = []
    for fname in filenames:
        safe_name = os.path.basename(fname)
        vpath = os.path.join(VIDEO_DIR, safe_name)
        if os.path.exists(vpath):
            os.remove(vpath)
        # 删除封面
        base = os.path.splitext(safe_name)[0]
        row = db.execute("SELECT poster FROM prompt_videos WHERE filename=?", [safe_name]).fetchone()
        poster = row["poster"] if row else None
        if poster:
            ppath = os.path.join(THUMB_DIR, poster)
            if os.path.exists(ppath):
                os.remove(ppath)
            db.execute("DELETE FROM prompt_thumbnails WHERE filename=?", [poster])
        # 兜底删除同名的 jpg
        for ext in ['.jpg', '.jpeg', '.png']:
            ppath = os.path.join(THUMB_DIR, base + ext)
            if os.path.exists(ppath):
                os.remove(ppath)
                break
        # 删除 poster1/poster2
        for suffix in ['_poster1.jpg', '_poster2.jpg']:
            ppath = os.path.join(THUMB_DIR, base + suffix)
            if os.path.exists(ppath):
                os.remove(ppath)
        db.execute("DELETE FROM prompt_videos WHERE filename=?", [safe_name])
        db.execute("DELETE FROM video_cache WHERE filename=?", [safe_name])
        db.execute("DELETE FROM thumb_meta WHERE filename=?", [safe_name])
        deleted.append(safe_name)
    db.commit()
    return {"ok": True, "deleted_count": len(deleted), "deleted": deleted}
