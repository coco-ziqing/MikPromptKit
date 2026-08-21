# -*- coding: utf-8 -*-
"""
v5.49.0 预置风格模板种子 — 5 套系统预置（影视写实/二次元/国风/卡通/科幻）
幂等：按 name 检测已存在则跳过
"""
import json
import os
import sqlite3
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from paths import get_data_dir

DB = os.path.join(get_data_dir(), "prompts.db")

PRESETS = [
    {
        "name": "影视写实 · 电影感",
        "tags": ["影视写实", "电影感"],
        "remark": "35mm 电影镜头质感，浅景深，真实皮肤细节，适合写实角色设定",
        "config": {
            "style_words": {
                "positive": "电影级写实摄影，35mm镜头，浅景深，真实皮肤质感，自然光影，高细节，8k",
                "negative": "卡通，动漫，变形，低质量，模糊，水印"
            },
            "render_params": {"model_version": "5.0", "ratio": "1:1", "resolution_type": "2k",
                              "cfg": 5.5, "steps": 28, "denoise": 0.6, "sampler": "dpmpp_2m",
                              "canvas_size": "1:1", "layer_render": False},
            "output_parts": ["main", "three_view", "face"],
            "layout": {"template": "default", "color_card": True, "title_text": "影视写实角色设定", "bg_color": "#1a1a2e"},
            "meta": {}
        }
    },
    {
        "name": "二次元 · 赛璐璐",
        "tags": ["二次元", "赛璐璐"],
        "remark": "经典日系赛璐璐上色，干净线稿，明快配色",
        "config": {
            "style_words": {
                "positive": "日系二次元赛璐璐风格，干净线稿，明快配色，大眼睛，动漫角色设定",
                "negative": "写实，3D，模糊，低质量，变形"
            },
            "render_params": {"model_version": "5.0", "ratio": "1:1", "resolution_type": "2k",
                              "cfg": 6.0, "steps": 25, "denoise": 0.65, "sampler": "dpmpp_2m",
                              "canvas_size": "1:1", "layer_render": False},
            "output_parts": ["main", "three_view", "face", "expressions"],
            "layout": {"template": "portrait", "color_card": True, "title_text": "二次元角色设定", "bg_color": "#2d1b4e"},
            "meta": {}
        }
    },
    {
        "name": "国风 · 水墨意境",
        "tags": ["国风", "水墨"],
        "remark": "传统水墨晕染，留白意境，古风人物设定",
        "config": {
            "style_words": {
                "positive": "中国风水墨画，宣纸质感，墨色晕染，留白意境，古风人物，淡雅配色",
                "negative": "油画，写实照片，现代，低质量，模糊"
            },
            "render_params": {"model_version": "5.0", "ratio": "1:1", "resolution_type": "2k",
                              "cfg": 6.5, "steps": 30, "denoise": 0.7, "sampler": "dpmpp_2m",
                              "canvas_size": "1:1", "layer_render": False},
            "output_parts": ["main", "three_view"],
            "layout": {"template": "default", "color_card": True, "title_text": "国风角色设定", "bg_color": "#f5f0e6"},
            "meta": {}
        }
    },
    {
        "name": "卡通 · 萌系扁平",
        "tags": ["卡通", "萌系"],
        "remark": "扁平化卡通，圆润造型，萌系表情，适合儿童向角色",
        "config": {
            "style_words": {
                "positive": "扁平卡通风格，圆润造型，萌系大眼睛，简洁线条，明亮色彩，可爱角色",
                "negative": "写实，阴暗，复杂背景，低质量"
            },
            "render_params": {"model_version": "5.0", "ratio": "1:1", "resolution_type": "2k",
                              "cfg": 5.0, "steps": 22, "denoise": 0.55, "sampler": "dpmpp_2m",
                              "canvas_size": "1:1", "layer_render": False},
            "output_parts": ["main", "face", "expressions"],
            "layout": {"template": "grid4", "color_card": True, "title_text": "卡通角色设定", "bg_color": "#fff7ed"},
            "meta": {}
        }
    },
    {
        "name": "科幻 · 赛博朋克",
        "tags": ["科幻", "赛博朋克"],
        "remark": "霓虹光影，赛博朋克都市，未来感装备，高对比配色",
        "config": {
            "style_words": {
                "positive": "赛博朋克科幻风格，霓虹灯光，未来都市，高对比配色，机械细节，科技感",
                "negative": "古代，田园，低质量，模糊，变形"
            },
            "render_params": {"model_version": "5.0", "ratio": "1:1", "resolution_type": "2k",
                              "cfg": 6.0, "steps": 28, "denoise": 0.65, "sampler": "dpmpp_2m",
                              "canvas_size": "1:1", "layer_render": False},
            "output_parts": ["main", "three_view", "costume"],
            "layout": {"template": "wide", "color_card": True, "title_text": "科幻角色设定", "bg_color": "#0a0a2e"},
            "meta": {}
        }
    },
]


def seed_presets(db=None):
    own = db is None
    c = db or sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    seeded = 0
    for p in PRESETS:
        exist = c.execute("SELECT id FROM style_suit WHERE name=? AND source='system'", [p["name"]]).fetchone()
        if exist:
            print(f"  [SKIP] {p['name']}（已存在）")
            continue
        cfg = dict(p["config"])
        cfg["meta"] = {"name": p["name"], "tags": p["tags"], "remark": p["remark"], "cover": ""}
        now = time.strftime("%Y-%m-%d %H:%M:%S")
        cur = c.execute(
            """INSERT INTO style_suit (name, tags, cover_image, remark, config_json, source, owner_user_id, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            [p["name"], json.dumps(p["tags"], ensure_ascii=False), "", p["remark"],
             json.dumps(cfg, ensure_ascii=False), "system", None, now, now],
        )
        sid = cur.lastrowid
        cur = c.execute(
            """INSERT INTO style_suit_version (suit_id, version, config_json, name_snapshot, created_by, created_at)
               VALUES (?,1,?,?,?,?)""",
            [sid, json.dumps(cfg, ensure_ascii=False), p["name"], None, now],
        )
        c.execute("UPDATE style_suit SET current_version_id=? WHERE id=?", [cur.lastrowid, sid])
        seeded += 1
        print(f"  [OK] {p['name']} (id={sid})")
    if own:
        c.commit()
        c.close()
    print(f"\n预置模板: 新增 {seeded} 套，共 {len(PRESETS)} 套定义")
    return seeded


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print("MikPromptKit v5.49.0 预置风格模板种子")
    print("=" * 50)
    seed_presets()
