"""
API 路由 — 提示词缩略图管理
上传 / 选取 / 取消关联 / 图库列表
"""
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

    # 生成唯一文件名，统一用 jpg
    unique_name = uuid.uuid4().hex + '.jpg'
    dest_path = os.path.join(THUMB_DIR, unique_name)

    # 读取文件内容
    file_bytes = await file.read()
    if len(file_bytes) > 10 * 1024 * 1024:
        raise HTTPException(400, "图片太大，最大 10MB")

    # 保存原图
    orig_path = os.path.join(ORIGINAL_DIR, unique_name)
    with open(orig_path, 'wb') as f:
        f.write(file_bytes)

    ok = _resize_and_save(file_bytes, dest_path)
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
    """获取缩略图库列表（分页）"""
    try:
        all_files = [f for f in os.listdir(THUMB_DIR)
                     if os.path.isfile(os.path.join(THUMB_DIR, f)) and
                     os.path.splitext(f)[1].lower() in ALLOWED_EXT]
    except FileNotFoundError:
        all_files = []

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
        items.append({
            "filename": f,
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
    """提供缩略图文件"""
    safe_name = os.path.basename(filename)
    fpath = os.path.join(THUMB_DIR, safe_name)
    if not os.path.exists(fpath):
        raise HTTPException(404, "文件不存在")
    return FileResponse(fpath, media_type="image/jpeg")


@router.get("/original/{filename}")
def serve_original(filename: str):
    """提供原图文件（用于大图查看）"""
    safe_name = os.path.basename(filename)
    fpath = os.path.join(ORIGINAL_DIR, safe_name)
    if not os.path.exists(fpath):
        # 回退到缩略图
        fpath = os.path.join(THUMB_DIR, safe_name)
        if not os.path.exists(fpath):
            raise HTTPException(404, "文件不存在")
    return FileResponse(fpath)


@router.post("/assign")
def assign_thumbnail(data: dict):
    """为提示词关联缩略图"""
    prompt_id = data.get("prompt_id")
    filename = data.get("filename")
    if not prompt_id or not filename:
        raise HTTPException(400, "缺少 prompt_id 或 filename")

    db = get_db()
    # 先确认文件存在
    fpath = os.path.join(THUMB_DIR, os.path.basename(filename))
    if not os.path.exists(fpath):
        raise HTTPException(404, "缩略图文件不存在")

    db.execute(
        "INSERT OR REPLACE INTO prompt_thumbnails (prompt_id, filename, updated_at) VALUES (?, ?, datetime('now','localtime'))",
        [prompt_id, os.path.basename(filename)]
    )
    db.commit()
    return {"ok": True, "prompt_id": prompt_id, "filename": os.path.basename(filename)}


@router.delete("/assign/{prompt_id}")
def remove_thumbnail(prompt_id: int):
    """取消提示词的缩略图关联（不删除文件）"""
    db = get_db()
    db.execute("DELETE FROM prompt_thumbnails WHERE prompt_id=?", [prompt_id])
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
    db.commit()
    return {"ok": True}


# ==================== 视频缩略图 ====================

VIDEO_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "data", "videos"
)
os.makedirs(VIDEO_DIR, exist_ok=True)

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
            ['ffmpeg', '-i', video_path, '-vframes', '1',
             '-vf', f'scale={THUMB_SIZE[0]}:{THUMB_SIZE[1]}:force_original_aspect_ratio=1,crop={THUMB_SIZE[0]}:{THUMB_SIZE[1]}',
             '-q:v', '2', poster_path, '-y'],
            capture_output=True, timeout=30
        )
        poster_ok = os.path.exists(poster_path)
    except Exception as e:
        print('[视频] 封面提取失败:', e)
        poster_ok = False

    # 获取视频时长
    duration = 0
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

    return {
        "ok": True,
        "video_filename": video_name,
        "poster_filename": poster_name if poster_ok else None,
        "video_url": f"/api/thumbnails/video/{video_name}",
        "poster_url": f"/api/thumbnails/file/{poster_name}" if poster_ok else None,
        "duration": round(duration, 1),
        "size": len(file_bytes)
    }


@router.get("/video/{filename}")
def serve_video(filename: str):
    """提供视频文件"""
    safe_name = os.path.basename(filename)
    fpath = os.path.join(VIDEO_DIR, safe_name)
    if not os.path.exists(fpath):
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

    db.execute(
        "INSERT OR REPLACE INTO prompt_videos (prompt_id, filename, poster, duration, updated_at) "
        "VALUES (?, ?, ?, ?, datetime('now','localtime'))",
        [prompt_id, os.path.basename(video_filename), poster_filename, data.get("duration", 0)]
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

    # 获取时长
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
        "needs_trim": file_size > 10 * 1024 * 1024
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
        subprocess.run(['ffmpeg', '-i', output_path, '-vframes', '1',
            '-vf', f'scale={THUMB_SIZE[0]}:{THUMB_SIZE[1]}:force_original_aspect_ratio=1,crop={THUMB_SIZE[0]}:{THUMB_SIZE[1]}',
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
            db.execute(
                "INSERT OR REPLACE INTO prompt_videos (prompt_id, filename, poster, duration, updated_at) "
                "VALUES (?, ?, ?, ?, datetime('now','localtime'))",
                [prompt_id, output_name, poster_name, round(duration_out, 1)]
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
