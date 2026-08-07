"""
Phase35.3-DAM 归档引擎
- 文件压缩（LZMA/WebP/FLAC 按类型自动选策略）
- 代理/预览生成（缩略图/视频代理/音频代理）
- 全局内容寻址去重（blob_store）
- 还原（解压放回设备）
"""
import hashlib
import os
import shutil
import sqlite3
import subprocess
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
DB = os.path.join(ROOT, "data", "prompts.db")
ARCHIVE_ROOT = os.path.join(ROOT, "data", "archive")
BLOB_STORE = os.path.join(ARCHIVE_ROOT, "blob_store")
PROXY_ROOT = os.path.join(ARCHIVE_ROOT, "proxy")
TEMP_ROOT = os.path.join(ARCHIVE_ROOT, "tmp")

for d in [ARCHIVE_ROOT, BLOB_STORE, PROXY_ROOT, TEMP_ROOT]:
    os.makedirs(d, exist_ok=True)

# ── 压缩策略映射 ──
COMPRESSION_MAP = {
    ".c4d":   ("lzma",  "3D工程"),
    ".blend": ("lzma",  "3D工程"),
    ".max":   ("lzma",  "3D工程"),
    ".fbx":   ("lzma",  "3D交换"),
    ".obj":   ("lzma",  "3D交换"),
    ".gltf":  ("lzma",  "3D交换"),
    ".psd":   ("lzma",  "图像工程"),
    ".ai":    ("lzma",  "矢量工程"),
    ".ae":    ("lzma",  "后期工程"),
    ".prproj":("lzma",  "剪辑工程"),
    ".exr":   ("lzma",  "高动态图"),
    ".tiff":  ("lzma",  "高动态图"),
    ".png":   ("webp_lossless", "图片"),
    ".jpg":   ("webp_q85", "图片"),
    ".jpeg":  ("webp_q85", "图片"),
    ".webp":  ("none",   "图片"),
    ".mp4":   ("none",   "视频"),
    ".mov":   ("none",   "视频"),
    ".avi":   ("none",   "视频"),
    ".mkv":   ("none",   "视频"),
    ".wav":   ("flac",   "音频"),
    ".aiff":  ("flac",   "音频"),
    ".mp3":   ("none",   "音频"),
    ".flac":  ("none",   "音频"),
    ".pdf":   ("lzma",   "文档"),
    ".docx":  ("lzma",   "文档"),
}

# ── 文件大小快速指纹（大文件跳过 sha256）──
FAST_FP_THRESHOLD = 500 * 1024 * 1024  # 500MB

def _rw():
    c = sqlite3.connect(DB, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=3000")
    return c

def _safe_commit(c):
    for i in range(5):
        try: c.commit(); return
        except sqlite3.OperationalError:
            if i == 4: raise
            time.sleep(0.05 * (i+1))

def compute_fingerprint(filepath, size=None):
    """计算文件指纹：<500MB 用sha256，>=500MB 用 sz:size:name 快速指纹"""
    if size is None:
        size = os.path.getsize(filepath)
    if size >= FAST_FP_THRESHOLD:
        fname = os.path.basename(filepath)
        return f"fast:{size}:{fname}"
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while True:
            buf = f.read(8 * 1024 * 1024)
            if not buf: break
            h.update(buf)
    return h.hexdigest()

def compute_blob_hash(filepath):
    """计算压缩后文件的内容寻址 hash（用于去重），比 fingerprint 更准"""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while True:
            buf = f.read(8 * 1024 * 1024)
            if not buf: break
            h.update(buf)
    return h.hexdigest()

# ════════════════════════════════════════
# 压缩
# ════════════════════════════════════════

def compress_file(src_path, strategy="auto", level=5):
    """
    返回: (compressed_path, method, original_size, compressed_size)
    strategy: auto|lzma|webp_lossless|webp_q85|flac|none
    level: 1-9 (lzma only)
    """
    ext = os.path.splitext(src_path)[1].lower()
    if strategy == "auto":
        strategy, _ = COMPRESSION_MAP.get(ext, ("lzma", "通用"))

    original_size = os.path.getsize(src_path)
    basename = os.path.basename(src_path)
    dest = os.path.join(TEMP_ROOT, f"compress_{int(time.time()*1000)}_{basename}")

    if strategy == "none":
        # 不压缩，直接拷贝
        shutil.copy2(src_path, dest)
        return (dest, "none", original_size, original_size)

    elif strategy == "lzma":
        import lzma
        with open(src_path, "rb") as fin, lzma.open(dest + ".lzma", "wb",
                                                      preset=level) as fout:
            while True:
                buf = fin.read(16 * 1024 * 1024)
                if not buf: break
                fout.write(buf)
        compressed_size = os.path.getsize(dest + ".lzma")
        return (dest + ".lzma", "lzma", original_size, compressed_size)

    elif strategy == "webp_lossless":
        try:
            from PIL import Image
            img = Image.open(src_path)
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGBA")
            else:
                img = img.convert("RGB")
            dest_webp = dest + ".webp"
            img.save(dest_webp, "WEBP", lossless=True, quality=100)
            compressed_size = os.path.getsize(dest_webp)
            return (dest_webp, "webp_lossless", original_size, compressed_size)
        except ImportError:
            shutil.copy2(src_path, dest)
            return (dest, "none", original_size, original_size)

    elif strategy == "webp_q85":
        try:
            from PIL import Image
            img = Image.open(src_path)
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGBA")
            else:
                img = img.convert("RGB")
            dest_webp = dest + ".webp"
            img.save(dest_webp, "WEBP", quality=85)
            compressed_size = os.path.getsize(dest_webp)
            return (dest_webp, "webp_q85", original_size, compressed_size)
        except ImportError:
            shutil.copy2(src_path, dest)
            return (dest, "none", original_size, original_size)

    elif strategy == "flac":
        try:
            # 用 ffmpeg 转 FLAC
            cmd = ["ffmpeg", "-y", "-i", src_path,
                   "-compression_level", "8",
                   dest + ".flac"]
            subprocess.run(cmd, capture_output=True, check=True, timeout=120)
            compressed_size = os.path.getsize(dest + ".flac")
            return (dest + ".flac", "flac", original_size, compressed_size)
        except Exception:
            import lzma
            with open(src_path, "rb") as fin, lzma.open(dest + ".lzma", "wb",
                                                          preset=level) as fout:
                while True:
                    buf = fin.read(16 * 1024 * 1024)
                    if not buf: break
                    fout.write(buf)
            compressed_size = os.path.getsize(dest + ".lzma")
            return (dest + ".lzma", "lzma", original_size, compressed_size)

    else:
        shutil.copy2(src_path, dest)
        return (dest, "none", original_size, original_size)


# ════════════════════════════════════════
# 代理/预览生成
# ════════════════════════════════════════

def generate_proxy(src_path, proxy_type="auto"):
    """
    根据文件类型生成轻量预览/代理
    返回: (proxy_path, proxy_type) 或 (None, None)
    """
    ext = os.path.splitext(src_path)[1].lower()
    basename = os.path.splitext(os.path.basename(src_path))[0]
    dest = os.path.join(TEMP_ROOT, f"proxy_{int(time.time()*1000)}_{basename}")

    # 图片 → 512px 缩略图
    if ext in (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".gif"):
        try:
            from PIL import Image
            img = Image.open(src_path)
            img.thumbnail((512, 512), Image.LANCZOS)
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGBA")
            else:
                img = img.convert("RGB")
            proxy_path = dest + ".jpg"
            img.save(proxy_path, "JPEG", quality=80)
            return (proxy_path, "thumb")
        except Exception:
            return (None, None)

    # 视频 → 720p h265 代理
    if ext in (".mp4", ".mov", ".avi", ".mkv", ".webm"):
        try:
            proxy_path = dest + ".mp4"
            cmd = ["ffmpeg", "-y", "-i", src_path,
                   "-vf", "scale='min(1280,iw)':min'(720,ih)':force_original_aspect_ratio=decrease",
                   "-c:v", "libx265", "-crf", "28", "-preset", "fast",
                   "-an",  # 去音频
                   "-t", "120",  # 最多2分钟
                   proxy_path]
            subprocess.run(cmd, capture_output=True, check=True, timeout=180)
            if os.path.exists(proxy_path):
                return (proxy_path, "video_proxy")
        except Exception:
            pass
        # fallback: 取首帧
        try:
            proxy_path = dest + ".jpg"
            cmd = ["ffmpeg", "-y", "-i", src_path,
                   "-vframes", "1", "-q:v", "3",
                   proxy_path]
            subprocess.run(cmd, capture_output=True, check=True, timeout=30)
            if os.path.exists(proxy_path):
                return (proxy_path, "thumb")
        except Exception:
            pass
        return (None, None)

    # 音频 → Opus 预览
    if ext in (".wav", ".aiff", ".mp3", ".flac", ".ogg"):
        try:
            proxy_path = dest + ".opus"
            cmd = ["ffmpeg", "-y", "-i", src_path,
                   "-c:a", "libopus", "-b:a", "64k",
                   "-t", "120",
                   proxy_path]
            subprocess.run(cmd, capture_output=True, check=True, timeout=60)
            if os.path.exists(proxy_path):
                return (proxy_path, "audio_proxy")
        except Exception:
            pass
        return (None, None)

    # PSD/AI/AE/C4D → 提取内嵌缩略图
    if ext in (".psd", ".ai", ".ae", ".c4d", ".blend", ".prproj"):
        # C4D 文件有内嵌 thumbnail，ffmpeg 无法处理
        # 用 Pillow 尝试读取（PSD等）
        try:
            from PIL import Image
            img = Image.open(src_path)
            img.thumbnail((512, 512), Image.LANCZOS)
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGBA")
            else:
                img = img.convert("RGB")
            proxy_path = dest + ".jpg"
            img.save(proxy_path, "JPEG", quality=80)
            return (proxy_path, "thumb")
        except Exception:
            pass
        return (None, None)

    return (None, None)


# ════════════════════════════════════════
# 内容寻址去重 — blob_store
# ════════════════════════════════════════

def add_to_blob_store(src_path, compression_method):
    """
    将文件加入内容寻址 blob_store
    返回: (blob_hash, storage_path, compressed_size, already_existed)
    """
    blob_hash = compute_blob_hash(src_path)
    csize = os.path.getsize(src_path)
    prefix = blob_hash[:2]
    store_dir = os.path.join(BLOB_STORE, prefix)
    os.makedirs(store_dir, exist_ok=True)
    store_path = os.path.join(store_dir, blob_hash)

    db = _rw()
    try:
        existing = db.execute("SELECT id, ref_count FROM blob_store WHERE blob_hash=?", [blob_hash]).fetchone()
        if existing:
            # 已存在 → 引用计数+1
            db.execute("UPDATE blob_store SET ref_count=ref_count+1, last_accessed_at=datetime('now','localtime') WHERE id=?",
                       [existing["id"]])
            _safe_commit(db)
            return (blob_hash, store_path, csize, True)
        else:
            # 新文件 → 移动到 blob_store
            shutil.move(src_path, store_path)
            db.execute("""INSERT INTO blob_store(blob_hash, compressed_size, original_size, compression, ref_count, storage_tier, storage_path)
                          VALUES (?,?,0,?,1,'hot',?)""",
                       [blob_hash, csize, compression_method, store_path])
            _safe_commit(db)
            return (blob_hash, store_path, csize, False)
    finally:
        db.close()


def remove_from_blob_store(blob_hash):
    """减少引用计数，计数归零时删除实体"""
    if not blob_hash: return
    db = _rw()
    try:
        row = db.execute("SELECT id, ref_count, storage_path FROM blob_store WHERE blob_hash=?", [blob_hash]).fetchone()
        if not row: return
        if row["ref_count"] <= 1:
            # 删除实体
            if row["storage_path"] and os.path.exists(row["storage_path"]):
                os.remove(row["storage_path"])
            db.execute("DELETE FROM blob_store WHERE id=?", [row["id"]])
        else:
            db.execute("UPDATE blob_store SET ref_count=ref_count-1 WHERE id=?", [row["id"]])
        _safe_commit(db)
    finally:
        db.close()


# ════════════════════════════════════════
# 还原（解压放回设备）
# ════════════════════════════════════════

def restore_from_blob(blob_hash, dest_path, compression_method=""):
    """
    从 blob_store 还原文件到 dest_path
    如果是压缩的自动解压
    """
    prefix = blob_hash[:2]
    store_path = os.path.join(BLOB_STORE, prefix, blob_hash)
    if not os.path.exists(store_path):
        raise FileNotFoundError(f"blob 实体不存在: {blob_hash}")

    os.makedirs(os.path.dirname(dest_path), exist_ok=True)

    if compression_method == "lzma":
        import lzma
        with lzma.open(store_path, "rb") as fin, open(dest_path, "wb") as fout:
            while True:
                buf = fin.read(16 * 1024 * 1024)
                if not buf: break
                fout.write(buf)
    elif compression_method in ("webp_lossless", "webp_q85"):
        try:
            from PIL import Image
            img = Image.open(store_path)
            # 保存为 PNG（无损恢复）或 JPG
            if dest_path.lower().endswith(".png"):
                img.save(dest_path, "PNG")
            else:
                if img.mode == "RGBA":
                    img = img.convert("RGBA")
                else:
                    img = img.convert("RGB")
                img.save(dest_path, "JPEG", quality=95)
        except Exception:
            shutil.copy2(store_path, dest_path)
    elif compression_method == "flac":
        try:
            cmd = ["ffmpeg", "-y", "-i", store_path, dest_path]
            subprocess.run(cmd, capture_output=True, check=True, timeout=120)
        except Exception:
            shutil.copy2(store_path, dest_path)
    else:
        # none → 直接拷贝
        shutil.copy2(store_path, dest_path)

    return os.path.getsize(dest_path)


# ════════════════════════════════════════
# 一站式归档：拷贝 + 压缩 + 去重 + 代理
# ════════════════════════════════════════

def do_full_archive(src_path, project_id, module_key, filename="", is_critical=0, device_id=0, source_path=""):
    """
    完整归档流程：
    1. 拷贝到临时目录
    2. 压缩
    3. 生成代理
    4. 内容寻址去重入 blob_store
    5. 写入 asset_catalog
    返回: {ok, catalog_id, blob_hash, compression, compressed_size, proxy_path, already_existed}
    """
    if not os.path.exists(src_path):
        return {"ok": False, "error": "源文件不存在"}

    fname = filename or os.path.basename(src_path)

    # 1. 拷贝到临时
    tmp_src = os.path.join(TEMP_ROOT, f"archive_src_{int(time.time()*1000)}_{fname}")
    shutil.copy2(src_path, tmp_src)
    original_size = os.path.getsize(tmp_src)

    # 2. 压缩
    cpath, method, osize, csize = compress_file(tmp_src)

    # 3. 代理
    proxy_path, proxy_type = generate_proxy(src_path)

    # 4. 去重入 blob_store
    blob_hash, store_path, _csz, already_existed = add_to_blob_store(cpath, method)

    # 5. 写入 asset_catalog
    db = _rw()
    try:
        proxy_rel = ""
        if proxy_path:
            proxy_rel = os.path.join("proxy", os.path.basename(proxy_path))
            final_proxy = os.path.join(PROXY_ROOT, os.path.basename(proxy_path))
            if not os.path.exists(final_proxy):
                shutil.move(proxy_path, final_proxy)

        db.execute("""INSERT INTO asset_catalog
            (project_space_id, module_key, filename, fingerprint, local_rel_path, size,
             archive_path, compression, compressed_size, original_size,
             proxy_path, proxy_type, frozen, source_device_id, source_path, blob_hash,
             is_critical, backup_status, status)
            VALUES (?,?,?,?,?,?,
                    ?,?,?,?,
                    ?,?,1,?,?,?,
                    ?,?,?)""",
            [project_id, module_key, fname, "", "", original_size,
             store_path, method, csize, original_size,
             proxy_rel, proxy_type or "", device_id, source_path or src_path, blob_hash,
             is_critical, "not_backed_up" if is_critical else "none", "active"])
        cat_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        _safe_commit(db)
    except Exception as e:
        db.close()
        # 清理临时文件
        for _f in [tmp_src, cpath]:
            try:
                if _f and os.path.exists(_f): os.remove(_f)
            except Exception: pass
        return {"ok": False, "error": str(e)}

    # 清理临时源文件
    try:
        if os.path.exists(tmp_src): os.remove(tmp_src)
    except Exception: pass

    # 更新 blob 引用计数? 已在 add_to_blob_store 中处理
    db.close()

    return {
        "ok": True,
        "catalog_id": cat_id,
        "blob_hash": blob_hash,
        "compression": method,
        "compressed_size": csize,
        "original_size": original_size,
        "saved_pct": round((1 - csize/max(original_size,1)) * 100, 1),
        "proxy_path": proxy_rel,
        "proxy_type": proxy_type,
        "already_existed": already_existed,
        "filename": fname,
    }


# ════════════════════════════════════════
# 清理临时目录
# ════════════════════════════════════════

def cleanup_temp():
    """清理超过1小时的临时文件"""
    now = time.time()
    for d in [TEMP_ROOT]:
        if not os.path.exists(d): continue
        for f in os.listdir(d):
            fp = os.path.join(d, f)
            try:
                if os.path.isfile(fp) and (now - os.path.getmtime(fp)) > 3600:
                    os.remove(fp)
            except Exception:
                pass


if __name__ == "__main__":
    # 自测
    print("[TEST] archive_engine loaded")
    print(f"  ARCHIVE_ROOT: {ARCHIVE_ROOT}")
    print(f"  BLOB_STORE: {BLOB_STORE}")
    print(f"  COMPRESSION_MAP: {len(COMPRESSION_MAP)} types")
