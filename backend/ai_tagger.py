# -*- coding: utf-8 -*-
"""
AI 自动标签引擎
- 图片/视频/3D缩略图 → Ollama vision 模型分析 → 中文标签
- 音频 → ffprobe 元数据提取
- 文件类型/格式 → 自动标记
"""
import os, json, time, hashlib, subprocess, threading, sqlite3, urllib.request, base64
from pathlib import Path
from io import BytesIO

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
DB = os.path.join(ROOT, "data", "prompts.db")
OLLAMA_URL = "http://127.0.0.1:11434"

# 标签队列（后台异步处理）
_TAG_QUEUE = []
_TAG_LOCK = threading.Lock()
_TAG_THREAD = None

VISION_MODEL = "llava:7b"  # 轻量视觉模型

def _rw():
    c = sqlite3.connect(DB, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c

def _safe_commit(c):
    for i in range(5):
        try: c.commit(); return
        except sqlite3.OperationalError:
            if i == 4: raise
            time.sleep(0.05*(i+1))

# ═══════════════════════════
# Vision 标签（图片/视频首帧）
# ═══════════════════════════

def image_to_base64(img_path, max_size=800):
    """图片转 base64，缩放到 max_size 以内"""
    if not HAS_PIL:
        with open(img_path, "rb") as f:
            return base64.b64encode(f.read()).decode()
    img = Image.open(img_path)
    img.thumbnail((max_size, max_size), Image.LANCZOS)
    buf = BytesIO()
    fmt = "JPEG" if img.mode != "RGBA" else "PNG"
    img.convert("RGB").save(buf, format=fmt, quality=75 if fmt == "JPEG" else 90)
    return base64.b64encode(buf.getvalue()).decode()

def ollama_vision_tag(image_path, model=None):
    """用 Ollama vision 模型分析图片，返回标签列表"""
    model = model or VISION_MODEL
    b64 = image_to_base64(image_path, 640)
    payload = {
        "model": model,
        "messages": [{
            "role": "user",
            "content": "请用中文简要描述这张图片的内容，用5-8个逗号分隔的关键词标签描述（如：人物,机甲,蓝色,赛博朋克,特写,科幻）。不要多余文字，只输出标签。",
            "images": [b64]
        }],
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": 120}
    }
    try:
        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/chat",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            d = json.loads(resp.read())
            content = d.get("message", {}).get("content", "")
            # 解析逗号分隔标签
            tags = [t.strip() for t in content.replace("\n", ",").split(",") if t.strip()]
            # 限制每标签长度
            tags = [t[:30] for t in tags if len(t) > 1]
            return tags[:10]
    except Exception as e:
        return [f"__error__:{str(e)[:50]}"]


# ═══════════════════════════
# 视频元数据标签
# ═══════════════════════════

def ffprobe_metadata(video_path):
    """用 ffprobe 提取视频元数据"""
    tags = []
    try:
        cmd = ["ffprobe", "-v", "quiet", "-print_format", "json",
               "-show_format", "-show_streams", video_path]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if proc.returncode != 0:
            return tags
        data = json.loads(proc.stdout)
        fmt = data.get("format", {})
        # 格式标签
        fmt_name = fmt.get("format_name", "")
        if fmt_name:
            tags.extend([f"格式:{t}" for t in fmt_name.split(",")[:3]])
        # 时长
        duration = float(fmt.get("duration", 0))
        if duration > 0:
            if duration > 600: tags.append("长片")
            elif duration > 60: tags.append("中片")
            else: tags.append("短片")
        # 分辨率
        for stream in data.get("streams", []):
            if stream.get("codec_type") == "video":
                w = stream.get("width", 0)
                h = stream.get("height", 0)
                codec = stream.get("codec_name", "")
                if w and h:
                    if w >= 3840: tags.append("4K")
                    elif w >= 1920: tags.append("1080p")
                    elif w >= 1280: tags.append("720p")
                    else: tags.append("SD")
                if codec: tags.append(f"编码:{codec}")
                break
        # 比特率
        br = int(fmt.get("bit_rate", 0))
        if br > 10_000_000: tags.append("高码率")
        elif br > 2_000_000: tags.append("标准码率")

    except Exception:
        pass
    return tags


# ═══════════════════════════
# 文件类型标签
# ═══════════════════════════

def filetype_tags(ext, filename=""):
    """根据扩展名生成类型标签"""
    ext = ext.lower()
    tags = []
    _map = {
        ".c4d": ["3D工程", "Cinema4D"],
        ".blend": ["3D工程", "Blender"],
        ".max": ["3D工程", "3dsMax"],
        ".fbx": ["3D交换格式"],
        ".obj": ["3D模型"],
        ".gltf": ["3D模型", "GLTF"],
        ".psd": ["图像工程", "Photoshop"],
        ".ai": ["矢量工程", "Illustrator"],
        ".ae": ["后期合成", "AfterEffects"],
        ".prproj": ["剪辑工程", "Premiere"],
        ".png": ["图片", "PNG"],
        ".jpg": ["图片", "JPEG"],
        ".jpeg": ["图片", "JPEG"],
        ".webp": ["图片", "WebP"],
        ".tiff": ["图片", "TIFF", "高动态范围"],
        ".exr": ["图片", "EXR", "高动态范围"],
        ".mp4": ["视频", "MP4"],
        ".mov": ["视频", "MOV"],
        ".avi": ["视频", "AVI"],
        ".mkv": ["视频", "MKV"],
        ".wav": ["音频", "WAV", "无损"],
        ".mp3": ["音频", "MP3"],
        ".aiff": ["音频", "AIFF", "无损"],
        ".flac": ["音频", "FLAC", "无损"],
        ".pdf": ["文档", "PDF"],
        ".docx": ["文档", "Word"],
        ".txt": ["文本"],
        ".json": ["数据"],
    }
    return _map.get(ext, [ext.replace(".", "").upper()])


# ═══════════════════════════
# 一站式标签（分析文件，返回标签列表）
# ═══════════════════════════

def analyze_file(file_path, ext="", use_vision=True):
    """
    分析文件，返回标签列表
    - 图片：vision 模型 + 文件类型标签
    - 视频：首帧 vision + ffprobe 元数据 + 文件类型标签
    - 其他：文件类型标签
    """
    ext = ext.lower() or os.path.splitext(file_path)[1].lower()
    tags = filetype_tags(ext)

    if not os.path.exists(file_path):
        return tags

    # 图片 → vision 分析
    if ext in (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff") and use_vision:
        try:
            vt = ollama_vision_tag(file_path)
            tags.extend([t for t in vt if not t.startswith("__error__")])
        except Exception:
            pass

    # 视频 → 首帧 + 元数据
    if ext in (".mp4", ".mov", ".avi", ".mkv"):
        # ffprobe 元数据
        tags.extend(ffprobe_metadata(file_path))
        # 首帧 vision 分析
        if use_vision:
            try:
                thumb = os.path.join(os.path.dirname(file_path),
                                     f"_thumb_{int(time.time())}.jpg")
                cmd = ["ffmpeg", "-y", "-i", file_path, "-vframes", "1",
                       "-q:v", "3", thumb]
                subprocess.run(cmd, capture_output=True, timeout=30)
                if os.path.exists(thumb):
                    vt = ollama_vision_tag(thumb)
                    tags.extend([t for t in vt if not t.startswith("__error__")])
                    os.remove(thumb)
            except Exception:
                pass

    # 音频 → ffprobe
    if ext in (".wav", ".mp3", ".aiff", ".flac", ".ogg"):
        try:
            cmd = ["ffprobe", "-v", "quiet", "-print_format", "json",
                   "-show_format", file_path]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if proc.returncode == 0:
                data = json.loads(proc.stdout)
                fmt = data.get("format", {})
                dur = float(fmt.get("duration", 0))
                if dur > 0:
                    if dur > 600: tags.append("长音频")
                    elif dur > 60: tags.append("中音频")
                    else: tags.append("短音频")
                br = int(fmt.get("bit_rate", 0))
                if br: tags.append(f"{br//1000}kbps")
        except Exception:
            pass

    # 去重
    return list(dict.fromkeys(tags))


# ═══════════════════════════
# 后台异步标签队列
# ═══════════════════════════

def enqueue_tag_analysis(catalog_id, file_path, ext=""):
    """加入后台标签分析队列"""
    with _TAG_LOCK:
        _TAG_QUEUE.append((catalog_id, file_path, ext))
    _ensure_tag_thread()

def _ensure_tag_thread():
    global _TAG_THREAD
    if _TAG_THREAD and _TAG_THREAD.is_alive():
        return
    _TAG_THREAD = threading.Thread(target=_tag_worker, daemon=True)
    _TAG_THREAD.start()

def _tag_worker():
    """后台标签分析工作线程"""
    while True:
        item = None
        with _TAG_LOCK:
            if _TAG_QUEUE:
                item = _TAG_QUEUE.pop(0)
        if not item:
            time.sleep(2)
            continue

        catalog_id, file_path, ext = item
        try:
            tags = analyze_file(file_path, ext, use_vision=True)
            if tags:
                _store_tags(catalog_id, tags)
        except Exception as e:
            print(f"[TAGGER] Error analyzing catalog {catalog_id}: {e}")
            time.sleep(1)

def _store_tags(catalog_id, tags):
    """存储标签到数据库"""
    if not tags: return
    db = _rw()
    try:
        # 更新 asset_catalog 的 metadata_json
        existing = db.execute("SELECT metadata_json FROM asset_catalog WHERE id=?", [catalog_id]).fetchone()
        if existing:
            meta = {}
            try:
                if existing["metadata_json"]:
                    meta = json.loads(existing["metadata_json"])
            except Exception:
                pass
            meta["ai_tags"] = tags
            db.execute("UPDATE asset_catalog SET metadata_json=? WHERE id=?",
                       [json.dumps(meta, ensure_ascii=False), catalog_id])

        # 写入 asset_tags 表
        for tag in tags:
            tag_clean = tag.strip()[:50]
            if not tag_clean: continue
            # 幂等
            row = db.execute("SELECT id FROM asset_tags WHERE asset_id=? AND tag=?",
                             [catalog_id, tag_clean]).fetchone()
            if not row:
                db.execute("INSERT INTO asset_tags(asset_id, tag) VALUES (?,?)",
                           [catalog_id, tag_clean])

        _safe_commit(db)
    except Exception as e:
        print(f"[TAGGER] DB error: {e}")
    finally:
        db.close()


# ═══════════════════════════
# 批量标签（对所有无标签资产）
# ═══════════════════════════

def batch_tag_unlabeled(limit=20):
    """给尚未有标签的资产生成标签"""
    db = _rw()
    try:
        rows = db.execute("""
            SELECT ac.id, ac.filename, ac.ext, ac.proxy_path, ac.archive_path
            FROM asset_catalog ac
            LEFT JOIN asset_tags at ON ac.id = at.asset_id
            WHERE at.asset_id IS NULL
            LIMIT ?
        """, [limit]).fetchall()
    finally:
        db.close()

    for r in rows:
        enqueue_tag_analysis(r["id"], r["archive_path"] or "", r["ext"] or "")

    return len(rows)


if __name__ == "__main__":
    print("[TEST] AI Tagger")
    print("  Vision model:", VISION_MODEL)
    # 自测
    tags = filetype_tags(".c4d")
    print("  .c4d tags:", tags)
