# -*- coding: utf-8 -*-
"""生成咪卡灵感收藏助手扩展图标（16/48/128）— 蓝色圆角方块 + 白色收藏箭头"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "extensions", "mika-inspire-collect", "icons")
os.makedirs(OUT, exist_ok=True)

BG = (59, 130, 246)      # #3b82f6
FG = (255, 255, 255)


def draw_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * 0.22)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=BG)
    # 白色向下箭头（收藏/下载语义）
    cx = size / 2
    shaft_w = size * 0.16
    arrow_h = size * 0.30
    head_w = size * 0.52
    head_h = size * 0.26
    top = size * 0.18
    mid = top + arrow_h
    # 竖杆
    d.rectangle([cx - shaft_w / 2, top, cx + shaft_w / 2, mid + head_h * 0.35], fill=FG)
    # 箭头头部（多边形）
    d.polygon([
        (cx - head_w / 2, mid + head_h * 0.25),
        (cx + head_w / 2, mid + head_h * 0.25),
        (cx, mid + head_h * 0.25 + head_h),
    ], fill=FG)
    # 底部基线（收件箱横线）
    base_y = size * 0.78
    d.rounded_rectangle([size * 0.22, base_y, size * 0.78, base_y + size * 0.055], radius=size * 0.02, fill=FG)
    return img


for s in (16, 48, 128):
    draw_icon(s).save(os.path.join(OUT, f"icon{s}.png"))
    print(f"icon{s}.png OK")
