# -*- coding: utf-8 -*-
"""给 112 张角色/场景词卡生成缩略图（纯色背景 + 词卡 icon emoji）。
幂等：已有 thumbnail 跳过。执行前备份。需要 Pillow。"""
import os, sys, sqlite3, time
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("NO_PIL"); sys.exit(1)

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "data", "prompts.db")
THUMB = os.path.join(HERE, "..", "data", "thumbnails")
BK = os.path.join(HERE, "..", "data", "backups")

COLORS = [
    (79, 70, 229), (219, 39, 119), (5, 150, 105), (217, 119, 6),
    (37, 99, 235), (139, 92, 246), (6, 182, 212), (245, 158, 11),
    (16, 185, 129), (239, 68, 68), (99, 102, 241), (20, 184, 166),
    (249, 115, 22), (236, 72, 153),
]


def _render_thumb(icon, cid):
    """80x80 纯色背景 + 中央 emoji 文字 → save as thumbnails/{cid}.png"""
    out = os.path.join(THUMB, "%d.png" % cid)
    if os.path.isfile(out):
        return "%d.png" % cid
    try:
        im = Image.new("RGB", (160, 120), COLORS[cid % len(COLORS)])
        draw = ImageDraw.Draw(im)
        # 用大字号渲染 icon（emoji 在有些字体中支持有限，回退到首个字符）
        text = (icon or "?").strip()
        if not text:
            text = "?"
        # 尝试用 emoji 本身（如果字体支持）→ 否则取 Unicode 首个
        try:
            font = ImageFont.truetype("seguiemj.ttf", 48) if os.path.exists("C:/Windows/Fonts/seguiemj.ttf") else ImageFont.load_default()
        except Exception:
            font = ImageFont.load_default()
        bbox = draw.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text(((160 - tw) // 2, (120 - th) // 2 - 4), text, font=font, fill=(255, 255, 255, 240))
        im.save(out, "PNG")
        return "%d.png" % cid
    except Exception as e:
        # 回退：纯色方块
        try:
            im.save(out, "PNG")
            return "%d.png" % cid
        except Exception:
            return ""
    return ""


def main():
    os.makedirs(BK, exist_ok=True)
    bak = os.path.join(BK, "thumbgen_pre_%s.db" % time.strftime("%Y%m%d_%H%M%S"))
    s = sqlite3.connect(DB, timeout=10)
    try:
        s.execute("PRAGMA wal_checkpoint(TRUNCATE)"); s.execute("VACUUM INTO ?", [bak]); print("[OK] 备份", bak)
    except Exception as e:
        import shutil; shutil.copy2(DB, bak); print("[WARN] copy", e)
    finally:
        s.close()

    c = sqlite3.connect(DB, timeout=15); c.row_factory = sqlite3.Row
    os.makedirs(THUMB, exist_ok=True)
    rows = c.execute("""SELECT wc.id, wc.icon, wc.name, wc.thumbnail
                        FROM word_card wc JOIN word_card_group wg ON wc.group_id=wg.id
                        WHERE (wg.group_key LIKE 'char_%' OR wg.group_key LIKE 'scene_%')
                        AND wc.is_deleted=0 AND (wc.thumbnail IS NULL OR wc.thumbnail='')
                        ORDER BY wc.id""").fetchall()
    n = 0
    for r in rows:
        fn = _render_thumb(r["icon"] or (r["name"][0] if r["name"] else "?"), r["id"])
        if fn:
            c.execute("UPDATE word_card SET thumbnail=? WHERE id=?", [fn, r["id"]])
            n += 1
            if n % 30 == 0:
                c.commit(); print("  ... %d" % n)
    c.commit()
    total = c.execute("""SELECT COUNT(1) FROM word_card wc JOIN word_card_group wg ON wc.group_id=wg.id
                         WHERE (wg.group_key LIKE 'char_%' OR wg.group_key LIKE 'scene_%') AND wc.thumbnail!=''""").fetchone()[0]
    print("\n[DONE] 生成 %d 张缩略图；char/scene 词卡含缩略图总计: %d" % (n, total))
    c.close()


if __name__ == "__main__":
    main()
