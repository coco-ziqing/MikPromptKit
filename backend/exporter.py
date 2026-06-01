"""
PNG 提示词卡片 — 导出/导入引擎
用 Pillow 生成含元数据的 PNG 图片，类似 ComfyUI 工作流图片方案
"""
import os, json, io, uuid, base64, hashlib, zipfile
from PIL import Image, ImageDraw, ImageFont, PngImagePlugin
from database import get_db
from fastapi import HTTPException

# 卡片尺寸（加大高度，自适应内容）
CARD_WIDTH = 500
CARD_HEIGHT = 960  # 足够容纳所有信息
THUMB_SIZE = (460, 306)  # 卡片内缩略图区域（约 3:2）

# 颜色方案（暗色主题 + 白色文字）
COLORS = {
    "bg": "#1e1e2e",
    "card_bg": "#2a2a3e",
    "text": "#f0f0f0",
    "text_muted": "#a0a0c0",
    "primary": "#818cf8",
    "border": "#3a3a50",
    "badge_bg": "#3b3b58",
    "badge_text": "#c4b5fd",
    "tag_bg": "#33334d",
    "tag_text": "#c0c0e0",
    "accent": "#34d399",
    "shadow": (0, 0, 0, 0.3),
}


def _load_font(size=14):
    """加载中文字体，回退到默认"""
    try:
        font_paths = [
            "C:/Windows/Fonts/msyh.ttc",  # 微软雅黑
            "C:/Windows/Fonts/simsun.ttc",  # 宋体
            "C:/Windows/Fonts/simhei.ttf",  # 黑体
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]
        for fp in font_paths:
            if os.path.exists(fp):
                return ImageFont.truetype(fp, size, encoding="unic")
    except Exception:
        pass
    return ImageFont.load_default()


def _hex_to_rgb(hex_color):
    """#RRGGBB → (R,G,B)"""
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


def _truncate_text(text, max_chars, font, draw):
    """截断文本以适应宽度"""
    if not text:
        return ""
    text = str(text)
    # 先用字符数估算
    w = draw.textlength(text, font=font)
    if w <= max_chars:
        return text
    # 二分法截断
    lo, hi = 0, len(text)
    while lo < hi:
        mid = (lo + hi) // 2
        if draw.textlength(text[:mid] + "...", font=font) <= max_chars:
            lo = mid + 1
        else:
            hi = mid
    return text[:max(1, lo-3)] + "..."


def _wrap_text(text, font, draw, max_width):
    """分行包装文本"""
    if not text:
        return [""]
    lines = []
    for paragraph in text.split("\n"):
        words = list(paragraph)
        current = ""
        for ch in words:
            test = current + ch
            if draw.textlength(test, font=font) <= max_width:
                current = test
            else:
                lines.append(current)
                current = ch
        if current:
            lines.append(current)
    return lines if lines else [""]


def export_prompt_to_png(prompt_id: int) -> bytes:
    """导出单条提示词为 PNG 字节流"""
    db = get_db()
    row = db.execute("""
        SELECT p.*, pt.filename as thumbnail, pv.filename as video_filename
        FROM prompts p
        LEFT JOIN prompt_thumbnails pt ON pt.prompt_id = p.id
        LEFT JOIN prompt_videos pv ON pv.prompt_id = p.id
        WHERE p.id = ?
    """, [prompt_id]).fetchone()
    if not row:
        raise HTTPException(404, "提示词不存在")

    p = dict(row)

    # 查询中文翻译（如果有）
    translation_row = db.execute(
        "SELECT content FROM translations WHERE prompt_id=? AND lang='zh'",
        [prompt_id]
    ).fetchone()
    translation = translation_row["content"] if translation_row else None

    # 查询收藏归属
    coll_rows = db.execute("""
        SELECT c.name, c.icon FROM collection_items ci
        JOIN collections c ON c.id = ci.collection_id
        WHERE ci.prompt_id = ?
    """, [prompt_id]).fetchall()
    collections = [{"name": r["name"], "icon": r.get("icon") or "⭐"} for r in coll_rows]

    # 读取缩略图原图
    thumbnail_bytes = None
    THUMB_DIR = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "data", "thumbnails"
    )
    if p.get("thumbnail"):
        tpath = os.path.join(THUMB_DIR, p["thumbnail"])
        if os.path.exists(tpath):
            with open(tpath, "rb") as f:
                thumbnail_bytes = f.read()

    # 开始绘制卡片
    img = Image.new("RGB", (CARD_WIDTH, CARD_HEIGHT), _hex_to_rgb(COLORS["bg"]))
    draw = ImageDraw.Draw(img)

    # 字体
    font_title = _load_font(24)
    font_body = _load_font(17)
    font_small = _load_font(13)
    font_badge = _load_font(13)
    font_tiny = _load_font(12)

    y = 20

    # 1. 缩略图区域
    card_x, card_y = 20, 20
    thumb_w, thumb_h = 460, 306
    draw.rounded_rectangle(
        [card_x, card_y, card_x + thumb_w, card_y + thumb_h],
        radius=8, fill=_hex_to_rgb(COLORS["card_bg"]),
        outline=_hex_to_rgb(COLORS["border"])
    )
    if thumbnail_bytes:
        try:
            thumb_img = Image.open(io.BytesIO(thumbnail_bytes))
            thumb_img = thumb_img.resize((thumb_w, thumb_h), Image.LANCZOS)
            img.paste(thumb_img, (card_x, card_y))
        except Exception:
            pass
    y = card_y + thumb_h + 20

    # 2. 模块 + 分类徽标（并排）
    module_text = p.get("module", "")
    category = p.get("category", "")
    label_parts = []
    if module_text:
        label_parts.append(module_text)
    if category:
        label_parts.append(category)
    if label_parts:
        label_str = " / ".join(label_parts)
        badge_w = draw.textlength(label_str, font=font_badge) + 28
        badge_h = 28
        draw.rounded_rectangle(
            [20, y, 20 + badge_w, y + badge_h],
            radius=6, fill=_hex_to_rgb(COLORS["badge_bg"])
        )
        draw.text((34, y + 5), label_str, fill=_hex_to_rgb(COLORS["badge_text"]), font=font_badge)
        y += badge_h + 12

    # 3. 英文内容
    content = p.get("content", "")
    if content:
        # 英文标签
        en_label = "[EN]"
        en_w = draw.textlength(en_label, font=font_small) + 16
        draw.rounded_rectangle([20, y, 20 + en_w, y + 24], radius=4, fill=_hex_to_rgb(COLORS["primary"]))
        draw.text((28, y + 4), en_label, fill=_hex_to_rgb(COLORS["bg"]), font=font_small)
        en_x = 20 + en_w + 8
        en_lines = _wrap_text(content, font_body, draw, CARD_WIDTH - en_x - 20)
        for line in en_lines[:5]:
            draw.text((en_x, y), line, fill=_hex_to_rgb(COLORS["text"]), font=font_body)
            y += 27
        if len(en_lines) > 5:
            draw.text((en_x, y), "...", fill=_hex_to_rgb(COLORS["text_muted"]), font=font_body)
            y += 27
        y += 4

    # 4. 中文翻译（如果有）
    if translation:
        draw.line([20, y, CARD_WIDTH - 20, y], fill=_hex_to_rgb(COLORS["border"]), width=1)
        y += 10
        cn_label = "[CN]"
        cn_w = draw.textlength(cn_label, font=font_small) + 16
        draw.rounded_rectangle([20, y, 20 + cn_w, y + 24], radius=4, fill=_hex_to_rgb(COLORS["accent"]))
        draw.text((28, y + 4), cn_label, fill=_hex_to_rgb(COLORS["bg"]), font=font_small)
        cn_x = 20 + cn_w + 8
        cn_lines = _wrap_text(translation, font_body, draw, CARD_WIDTH - cn_x - 20)
        for line in cn_lines[:5]:
            draw.text((cn_x, y), line, fill=_hex_to_rgb(COLORS["text"]), font=font_body)
            y += 27
        if len(cn_lines) > 5:
            draw.text((cn_x, y), "...", fill=_hex_to_rgb(COLORS["text_muted"]), font=font_body)
            y += 27
        y += 4

    # 5. 释义（meaning）
    meaning = p.get("meaning", "")
    if meaning:
        draw.line([20, y, CARD_WIDTH - 20, y], fill=_hex_to_rgb(COLORS["border"]), width=1)
        y += 10
        draw.text((20, y), "📖 释义", fill=_hex_to_rgb(COLORS["text_muted"]), font=font_small)
        y += 22
        meaning_lines = _wrap_text(meaning, font_body, draw, CARD_WIDTH - 40)
        for line in meaning_lines[:3]:
            draw.text((20, y), line, fill=_hex_to_rgb(COLORS["text"]), font=font_body)
            y += 25
        if len(meaning_lines) > 3:
            draw.text((20, y), "...", fill=_hex_to_rgb(COLORS["text_muted"]), font=font_body)
            y += 25
        y += 2

    # 6. 适用场景（scene）
    scene = p.get("scene", "")
    if scene:
        draw.line([20, y, CARD_WIDTH - 20, y], fill=_hex_to_rgb(COLORS["border"]), width=1)
        y += 10
        draw.text((20, y), "🎯 适用场景", fill=_hex_to_rgb(COLORS["text_muted"]), font=font_small)
        y += 22
        scene_lines = _wrap_text(scene, font_body, draw, CARD_WIDTH - 40)
        for line in scene_lines[:3]:
            draw.text((20, y), line, fill=_hex_to_rgb(COLORS["text"]), font=font_body)
            y += 25
        if len(scene_lines) > 3:
            draw.text((20, y), "...", fill=_hex_to_rgb(COLORS["text_muted"]), font=font_body)
            y += 25
        y += 2

    # 7. 标签
    tags = p.get("tags", "")
    try:
        tag_list = json.loads(tags) if tags else []
    except Exception:
        tag_list = []
    if tag_list:
        draw.line([20, y, CARD_WIDTH - 20, y], fill=_hex_to_rgb(COLORS["border"]), width=1)
        y += 10
        x = 20
        for tag in tag_list[:8]:
            tag_w = draw.textlength(tag, font=font_tiny) + 16
            if x + tag_w > CARD_WIDTH - 20:
                x = 20
                y += 24
            draw.rounded_rectangle(
                [x, y, x + tag_w, y + 22],
                radius=4, fill=_hex_to_rgb(COLORS["tag_bg"])
            )
            draw.text((x + 8, y + 3), tag, fill=_hex_to_rgb(COLORS["tag_text"]), font=font_tiny)
            x += tag_w + 6
        y += 28

    # 8. 收藏分组
    if collections:
        y += 2
        draw.text((20, y), "⭐ 已收藏至:", fill=_hex_to_rgb(COLORS["text_muted"]), font=font_small)
        y += 22
        for coll in collections[:4]:
            coll_text = (coll.get("icon") or "⭐") + " " + coll["name"]
            draw.text((24, y), coll_text, fill=_hex_to_rgb(COLORS["text_muted"]), font=font_tiny)
            y += 20

    # 9. 底部信息
    y = CARD_HEIGHT - 36
    usage_text = f"使用 {p.get('usage_count', 0)} 次"
    draw.text((20, y), f"PromptKit v3.5", fill=_hex_to_rgb(COLORS["text_muted"]), font=font_tiny)
    draw.text((CARD_WIDTH - 20 - draw.textlength(usage_text, font=font_tiny), y),
              usage_text, fill=_hex_to_rgb(COLORS["text_muted"]), font=font_tiny)

    # ===== 写入元数据 =====
    meta = {
        "prompt_kit": {
            "version": "3.0.0.1",
            "exported_at": None,  # 由调用方填充
            "data": {
                "id": p["id"],
                "content": p.get("content", ""),
                "meaning": p.get("meaning", ""),
                "scene": p.get("scene", ""),
                "module": p.get("module", ""),
                "category": p.get("category", ""),
                "subcategory": p.get("subcategory", ""),
                "tags": tag_list,
                "collections": collections,
                "usage_count": p.get("usage_count", 0),
                "translation": translation,
                "thumbnail_base64": base64.b64encode(thumbnail_bytes).decode("utf-8") if thumbnail_bytes else None,
                "thumbnail_filename": p.get("thumbnail", ""),
            }
        }
    }

    # 计算 checksum
    raw_json = json.dumps(meta, ensure_ascii=False, sort_keys=True)
    meta["prompt_kit"]["checksum"] = hashlib.sha256(raw_json.encode()).hexdigest()

    # 写入到 PNG 元数据
    png_info = PngImagePlugin.PngInfo()
    png_info.add_text("prompt_kit", json.dumps(meta, ensure_ascii=False))

    # 输出 PNG
    buf = io.BytesIO()
    img.save(buf, format="PNG", pnginfo=png_info)
    return buf.getvalue()


def import_prompt_from_png(file_bytes: bytes, conflict: str = "skip") -> dict:
    """从 PNG 字节流导入提示词，返回创建结果"""
    try:
        img = Image.open(io.BytesIO(file_bytes))
        meta_str = img.info.get("prompt_kit")
        if not meta_str:
            raise HTTPException(400, "该图片不包含有效的提示词数据")
        meta = json.loads(meta_str)
        data = meta.get("prompt_kit", {}).get("data", {})
        if not data or not data.get("content"):
            raise HTTPException(400, "元数据中缺少提示词内容")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"无法解析图片元数据: {e}")

    db = get_db()

    # 重复检测（基于 content 完全匹配）
    content = data["content"]
    existing = db.execute("SELECT id FROM prompts WHERE content=?", [content]).fetchone()
    if existing:
        if conflict == "skip":
            return {"created": False, "reason": "skip", "existing_id": existing["id"]}
        elif conflict == "rename":
            # 追加随机后缀
            content = content + " (导入副本 " + uuid.uuid4().hex[:4] + ")"
        # "overwrite" 删除旧记录重建
        elif conflict == "overwrite":
            db.execute("DELETE FROM prompts WHERE id=?", [existing["id"]])

    # 提取字段
    module = data.get("module", "emotion")
    category = data.get("category", "通用")
    subcategory = data.get("subcategory", "")
    meaning = data.get("meaning", "")
    scene = data.get("scene", "")
    tags = json.dumps(data.get("tags", []), ensure_ascii=False)

    # 插入词条
    db.execute("""
        INSERT INTO prompts (module, category, subcategory, content, meaning, scene, tags, usage_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, [module, category, subcategory, content, meaning, scene, tags, data.get("usage_count", 0)])
    db.commit()
    new_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]

    # 还原缩略图
    thumbnail_base64 = data.get("thumbnail_base64")
    thumbnail_filename = data.get("thumbnail_filename", "")
    if thumbnail_base64:
        try:
            thumb_bytes = base64.b64decode(thumbnail_base64)
            THUMB_DIR = os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                "data", "thumbnails"
            )
            os.makedirs(THUMB_DIR, exist_ok=True)
            # 使用原文件名或新 UUID
            if thumbnail_filename and os.path.splitext(thumbnail_filename)[1].lower() in ['.jpg', '.jpeg', '.png']:
                new_thumb = thumbnail_filename
                # 检查冲突
                if os.path.exists(os.path.join(THUMB_DIR, new_thumb)):
                    new_thumb = uuid.uuid4().hex + '.jpg'
            else:
                new_thumb = uuid.uuid4().hex + '.jpg'
            with open(os.path.join(THUMB_DIR, new_thumb), "wb") as f:
                f.write(thumb_bytes)
            db.execute("INSERT OR REPLACE INTO prompt_thumbnails (prompt_id, filename, media_type, updated_at) "
                       "VALUES (?, ?, 'image', datetime('now','localtime'))",
                       [new_id, new_thumb])
            db.commit()
        except Exception:
            pass

    # 还原收藏分组
    for coll in data.get("collections", []):
        cname = coll.get("name", "")
        if not cname:
            continue
        icon = coll.get("icon", "⭐")
        # 查找或创建
        existing_coll = db.execute("SELECT id FROM collections WHERE name=?", [cname]).fetchone()
        if existing_coll:
            cid = existing_coll["id"]
        else:
            max_sort = db.execute("SELECT COALESCE(MAX(sort_order), -1) FROM collections").fetchone()[0]
            db.execute("INSERT INTO collections (name, icon, sort_order) VALUES (?, ?, ?)",
                       [cname, icon, max_sort + 1])
            db.commit()
            cid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        # 添加关联（防止重复）
        exists_rel = db.execute(
            "SELECT id FROM collection_items WHERE collection_id=? AND prompt_id=?",
            [cid, new_id]
        ).fetchone()
        if not exists_rel:
            db.execute("INSERT INTO collection_items (collection_id, prompt_id) VALUES (?, ?)",
                       [cid, new_id])
    db.commit()

    return {"created": True, "id": new_id, "content_preview": content[:60]}


def batch_export_prompts(prompt_ids: list) -> bytes:
    """批量导出为 ZIP 包"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for pid in prompt_ids:
            try:
                png_bytes = export_prompt_to_png(pid)
                fname = f"prompt_{pid}.png"
                zf.writestr(fname, png_bytes)
            except Exception:
                continue
    return buf.getvalue()


def batch_import_pngs(file_list: list, conflict: str = "skip") -> list:
    """批量导入多个 PNG 文件"""
    results = []
    for file_bytes in file_list:
        try:
            r = import_prompt_from_png(file_bytes, conflict=conflict)
            results.append(r)
        except Exception as e:
            results.append({"created": False, "reason": str(e)})
    return results
