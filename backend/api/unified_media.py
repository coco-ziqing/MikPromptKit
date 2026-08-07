"""Phase24 — 统一媒体库自检 + 修复覆盖 API

解决: media_assets 表未覆盖词卡视频/缩略图的覆盖问题
在服务启动时自动执行一次幂等扫描
"""
import os
import sqlite3


def ensure_unified_media():
    """幂等扫描所有媒体目录，补齐 media_assets 表中缺失的记录"""
    BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    DB = os.path.join(BASE, "data", "prompts.db")

    if not os.path.exists(DB):
        return

    THUMB_DIR = os.path.join(BASE, "data", "thumbnails")
    VIDEO_DIR = os.path.join(BASE, "data", "videos")
    WC_THUMB_DIR = os.path.join(BASE, "data", "wc_media", "thumbs")
    WC_VIDEO_DIR = os.path.join(BASE, "data", "wc_media", "videos")

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row

    # 确保表存在
    conn.execute("""
    CREATE TABLE IF NOT EXISTS media_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT,
        original_filename TEXT,
        file_size INTEGER DEFAULT 0,
        media_type TEXT DEFAULT 'image',
        source TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime'))
    )""")
    conn.commit()

    # 获取已有记录
    existing = set()
    for r in conn.execute("SELECT filename FROM media_assets").fetchall():
        existing.add(r["filename"])

    added = 0

    def _size(p):
        try: return os.path.getsize(p)
        except: return 0

    def _add(fn, media_type, source, directory):
        nonlocal added
        if fn not in existing:
            fp = os.path.join(directory, fn)
            sz = _size(fp) if os.path.exists(fp) else 0
            conn.execute(
                "INSERT OR IGNORE INTO media_assets (filename, original_filename, file_size, media_type, source) VALUES (?,?,?,?,?)",
                [fn, fn, sz, media_type, source])
            added += 1

    # 扫描 thumbnails/
    if os.path.isdir(THUMB_DIR):
        for f in os.listdir(THUMB_DIR):
            if f.endswith(('.jpg','.jpeg','.png','.gif','.webp')):
                _add(f, 'image', 'thumbnail', THUMB_DIR)

    # 扫描 videos/
    if os.path.isdir(VIDEO_DIR):
        for f in os.listdir(VIDEO_DIR):
            if f.endswith(('.mp4','.webm','.mov','.avi')):
                _add(f, 'video', 'video_upload', VIDEO_DIR)

    # 扫描 wc_media/thumbs/
    if os.path.isdir(WC_THUMB_DIR):
        for f in os.listdir(WC_THUMB_DIR):
            if f.endswith(('.jpg','.jpeg','.png')):
                _add(f, 'image', 'wordcard_thumb', WC_THUMB_DIR)

    # 扫描 wc_media/videos/
    if os.path.isdir(WC_VIDEO_DIR):
        for f in os.listdir(WC_VIDEO_DIR):
            if f.endswith(('.mp4','.webm','.mov','.avi')):
                _add(f, 'video', 'wordcard_video', WC_VIDEO_DIR)

    if added > 0:
        conn.commit()
        print(f"[Phase24] 统一媒体库: 新增 {added} 条记录")

    total = conn.execute("SELECT COUNT(*) FROM media_assets").fetchone()[0]
    conn.close()
    return total
