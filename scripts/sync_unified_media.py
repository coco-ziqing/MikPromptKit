# -*- coding: utf-8 -*-
"""
统一媒体库同步 — 扫描所有图片/视频目录，写入 media_assets 表
数据源:
  1. data/thumbnails/ + thumb_meta      → media_assets (image/video)
  2. data/videos/    + prompt_videos     → media_assets (video)
  3. data/wc_media/thumbs/ + word_card   → media_assets (image)
  4. data/wc_media/videos/ + word_card   → media_assets (video)
"""
import os, sys, sqlite3, hashlib
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(BASE, "data", "prompts.db")
THUMB_DIR = os.path.join(BASE, "data", "thumbnails")
VIDEO_DIR = os.path.join(BASE, "data", "videos")
ORIGINAL_DIR = os.path.join(BASE, "data", "originals")
WC_THUMB_DIR = os.path.join(BASE, "data", "wc_media", "thumbs")
WC_VIDEO_DIR = os.path.join(BASE, "data", "wc_media", "videos")
WC_ORIG_DIR = os.path.join(BASE, "data", "wc_media", "originals")

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
conn.execute("PRAGMA journal_mode=WAL")

def ensure_table():
    conn.execute("""
    CREATE TABLE IF NOT EXISTS media_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT,
        original_filename TEXT,
        file_size INTEGER DEFAULT 0,
        original_size INTEGER DEFAULT 0,
        media_type TEXT DEFAULT 'image',
        width INTEGER DEFAULT 0,
        height INTEGER DEFAULT 0,
        mime_type TEXT DEFAULT '',
        source TEXT DEFAULT '',
        prompt_id INTEGER,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime'))
    )""")
    conn.commit()

ensure_table()

def _file_size(p):
    try: return os.path.getsize(p)
    except: return 0

def _hash_short(p):
    try:
        with open(p,'rb') as f:
            return hashlib.sha256(f.read(4096)).hexdigest()[:16]
    except: return ''

def upsert_media(fn, orig_fn, media_type, size, source):
    conn.execute("""
    INSERT OR IGNORE INTO media_assets (filename, original_filename, file_size, media_type, source)
    VALUES (?,?,?,?,?)
    """, [fn, orig_fn, size, media_type, source])
    conn.execute("UPDATE media_assets SET original_filename=?, file_size=?, media_type=?, source=? WHERE filename=?",
                 [orig_fn, size, media_type, source, fn])

print("=== 统一媒体库同步 ===")

# 1. 扫描 thumbnails/ (图片)
print(f"\n--- thumbnails/ ---")
cnt = 0
for f in sorted(os.listdir(THUMB_DIR)):
    if not f.endswith(('.jpg','.jpeg','.png','.gif','.webp')): continue
    fp = os.path.join(THUMB_DIR, f)
    sz = _file_size(fp)
    upsert_media(f, f, 'image', sz, 'thumbnail')
    cnt += 1
print(f"  同步 {cnt} 张图片")

# 2. 扫描 videos/ (视频)
print(f"\n--- videos/ ---")
cnt2 = 0
for f in sorted(os.listdir(VIDEO_DIR)):
    if not f.endswith(('.mp4','.webm','.mov','.avi')): continue
    fp = os.path.join(VIDEO_DIR, f)
    sz = _file_size(fp)
    upsert_media(f, f, 'video', sz, 'video_upload')
    cnt2 += 1
print(f"  同步 {cnt2} 个视频")

# 3. 扫描 prompt_videos 补叙
rows = conn.execute("SELECT filename, poster FROM prompt_videos").fetchall()
for r in rows:
    fp = os.path.join(VIDEO_DIR, r["filename"])
    if os.path.exists(fp):
        upsert_media(r["filename"], r["filename"], 'video', _file_size(fp), 'prompt_video')
    if r["poster"]:
        pp = os.path.join(THUMB_DIR, r["poster"])
        if os.path.exists(pp):
            upsert_media(r["poster"], r["poster"], 'image', _file_size(pp), 'video_poster')

# 4. 扫描 thumb_meta 补叙
meta_rows = conn.execute("SELECT filename, original_name, media_type FROM thumb_meta").fetchall()
for r in meta_rows:
    fn = r["filename"]
    mtype = r["media_type"] or 'image'
    if mtype == 'video':
        fp = os.path.join(VIDEO_DIR, fn)
    else:
        fp = os.path.join(THUMB_DIR, fn)
    if os.path.exists(fp):
        upsert_media(fn, r["original_name"] or fn, mtype, _file_size(fp), 'thumb_meta')

# 5. 扫描 wc_media/thumbs/ (词卡缩略图)
if os.path.isdir(WC_THUMB_DIR):
    print(f"\n--- wc_media/thumbs/ ---")
    cnt3 = 0
    for f in sorted(os.listdir(WC_THUMB_DIR)):
        if not f.endswith(('.jpg','.jpeg','.png')): continue
        fp = os.path.join(WC_THUMB_DIR, f)
        sz = _file_size(fp)
        upsert_media(f, f, 'image', sz, 'wordcard_thumb')
        cnt3 += 1
    print(f"  同步 {cnt3} 张词卡缩略图")

# 6. 扫描 wc_media/videos/ (词卡视频)
if os.path.isdir(WC_VIDEO_DIR):
    print(f"\n--- wc_media/videos/ ---")
    cnt4 = 0
    for f in sorted(os.listdir(WC_VIDEO_DIR)):
        if not f.endswith(('.mp4','.webm','.mov','.avi')): continue
        fp = os.path.join(WC_VIDEO_DIR, f)
        sz = _file_size(fp)
        upsert_media(f, f, 'video', sz, 'wordcard_video')
        cnt4 += 1
    print(f"  同步 {cnt4} 个词卡视频")

conn.commit()
total = conn.execute("SELECT COUNT(*) FROM media_assets").fetchone()[0]
print(f"\n=== 统一媒体库: {total} 条记录 ===")
conn.close()
