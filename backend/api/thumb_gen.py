"""
公共图片落库模块 — 生成图片（即梦/LibTV/未来引擎）统一保存为词卡缩略图
从 dreamina.py 提取（2026-08-06）：save_generated_image 为多引擎共用链路
"""
import os, uuid
from database import get_db, safe_commit
from PIL import Image

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
THUMB_DIR = os.path.join(_PROJECT_ROOT, "data", "thumbnails")
ORIGINALS_DIR = os.path.join(_PROJECT_ROOT, "data", "originals")


def save_generated_image(img_bytes: bytes, prompt_id: int, card_type: str = "word_card",
                         source: str = "ai", ref_id: str = "") -> dict:
    """保存生成图片：缩略图 240x160 + 原图 + 落库（word_card/prompts 同链路）
    返回 {ok, thumbnail, thumbnail_url, width, height}
    source: dreamina / libtv / comfyui（写入 media_assets.source 溯源）"""
    try:
        os.makedirs(THUMB_DIR, exist_ok=True)
        os.makedirs(ORIGINALS_DIR, exist_ok=True)
        _base = uuid.uuid4().hex
        tf = _base + ".jpg"
        tp = os.path.join(THUMB_DIR, tf)
        iw = ih = 0
        try:
            _im = Image.open(__import__("io").BytesIO(img_bytes))
            iw, ih = _im.size
            sw, sh = _im.size
            tr = 240.0 / 160.0
            sr = sw / sh
            if sr > tr:
                nw = int(sh * tr); ox = (sw - nw) // 2; _im = _im.crop((ox, 0, ox + nw, sh))
            else:
                nh = int(sw / tr); oy = (sh - nh) // 2; _im = _im.crop((0, oy, sw, oy + nh))
            _im = _im.resize((240, 160), Image.LANCZOS)
            if _im.mode in ("RGBA", "P"):
                _im = _im.convert("RGB")
            _im.save(tp, "JPEG", quality=85)
        except Exception:
            with open(tp, "wb") as f:
                f.write(img_bytes)
        of = _base + ".jpg"
        with open(os.path.join(ORIGINALS_DIR, of), "wb") as f:
            f.write(img_bytes)
        db = get_db()
        src_table = card_type if card_type in ("word_card", "prompts") else ("word_card" if card_type == "word_card" else "prompts")
        if prompt_id > 0 and src_table == "word_card":
            db.execute("UPDATE word_card SET thumbnail=?, preview_media='', media_type='image', thumb_width=?, thumb_height=?, original_ref=?, updated_at=datetime('now','localtime') WHERE id=?",
                       [tf, iw, ih, of, prompt_id])
        elif prompt_id > 0:
            db.execute("DELETE FROM prompt_videos WHERE prompt_id=?", [prompt_id])
            db.execute("INSERT OR REPLACE INTO prompt_thumbnails (prompt_id, filename, media_type, updated_at) VALUES (?,?,'image',datetime('now','localtime'))",
                       [prompt_id, tf])
        try:
            db.execute("""INSERT OR IGNORE INTO media_assets
                (filename, original_filename, file_size, original_size, media_type, width, height, mime_type, prompt_id, source, workflow_id)
                VALUES (?,?,?,?,'image',?,?,'image/jpeg',?,?,?)""",
                [tf, of, len(img_bytes), len(img_bytes), iw, ih, prompt_id, source, ref_id])
        except Exception as e:
            print(f"[{source}] 媒体资产写入失败: {e}")
        safe_commit()
        return {"ok": True, "thumbnail": tf, "thumbnail_url": f"/api/thumbnails/file/{tf}",
                "width": iw, "height": ih}
    except Exception as e:
        return {"ok": False, "error": str(e)}
