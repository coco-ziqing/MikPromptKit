# -*- coding: utf-8 -*-
"""
Phase20: 全局画风/全局负面 — 建立二级子分组
============================================
- 为全局画风(88)创建 3 个子分组：写实风格 / 动漫卡通 / 艺术风格
- 为全局负面(89)创建 3 个子分组：人物形态 / 画面质量 / 技术渲染
- 归类现有卡片到对应子分组
- 角色设定(94)和场景设定(109)的二级子分组已存在（seed 脚本创建）
"""

import sqlite3, os, sys

DB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "prompts.db")

def migrate():
    conn = sqlite3.connect(DB, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    db = conn.cursor()

    # ============================================
    # 1. 全局画风 (parent_id=88) → 3 个子分组
    # ============================================
    # 检查是否已建
    existing = db.execute("SELECT id FROM word_card_group WHERE parent_group_id=88 AND is_active=1").fetchall()
    if not existing:
        sub_groups_style = [
            ("写实风格", "style_realistic", "🖼️"),
            ("动漫卡通", "style_anime", "✨"),
            ("艺术风格", "style_artistic", "🎨"),
        ]
        for name, key, icon in sub_groups_style:
            db.execute(
                "INSERT INTO word_card_group (name,group_key,icon,group_type,parent_group_id,sort_order,is_active) "
                "VALUES (?,?,?,'sub',?,?,1)",
                [f"🎨 {name}", f"global_{key}", icon, 88, len(existing) + 1]
            )
        conn.commit()
        print("[OK] 全局画风 3 个子分组已创建")
    else:
        print(f"[SKIP] 全局画风已有 {len(existing)} 个子分组")

    # 归类画风卡片
    style_map = {
        # 写实风格 (parent=first sub of 88 after insert, sort_order=1)
        "电影级逼真写实": 1,
        "油画质感": 1,
        "黑白胶片 noir": 1,
        # 动漫卡通 (sort_order=2)
        "日系清新动漫": 2,
        "皮克斯动画": 2,
        # 艺术风格 (sort_order=3)
        "水墨国风": 3,
        "水彩手绘": 3,
        "赛博朋克科幻": 3,
    }

    style_subs = db.execute(
        "SELECT id,sort_order FROM word_card_group WHERE parent_group_id=88 AND is_active=1 ORDER BY sort_order"
    ).fetchall()
    style_sort_to_id = {row[1]: row[0] for row in style_subs}

    moved_style = 0
    for content_str, sort_order in style_map.items():
        sub_id = style_sort_to_id.get(sort_order)
        if not sub_id:
            continue
        # 按 content 匹配（画风卡片没有中文名，content 即为值）
        cards = db.execute(
            "SELECT id FROM word_card WHERE group_id=88 AND content=? AND is_deleted=0", [content_str]
        ).fetchall()
        for c in cards:
            db.execute("UPDATE word_card SET group_id=? WHERE id=?", [sub_id, c[0]])
            moved_style += 1

    # 剩余未归类卡片移入第一个子组
    leftover = db.execute(
        "SELECT id FROM word_card WHERE group_id=88 AND is_deleted=0"
    ).fetchall()
    if leftover and style_subs:
        first_sub = style_subs[0][0]
        for c in leftover:
            db.execute("UPDATE word_card SET group_id=? WHERE id=?", [first_sub, c[0]])
            moved_style += 1

    conn.commit()
    print(f"[OK] 全局画风卡片归属: {moved_style} 条")

    # ============================================
    # 2. 全局负面 (parent_id=89) → 3 个子分组
    # ============================================
    existing_neg = db.execute("SELECT id FROM word_card_group WHERE parent_group_id=89 AND is_active=1").fetchall()
    if not existing_neg:
        sub_groups_neg = [
            ("人物形态", "neg_character", "👤"),
            ("画面质量", "neg_quality", "🔍"),
            ("技术渲染", "neg_render", "⚙️"),
        ]
        for name, key, icon in sub_groups_neg:
            db.execute(
                "INSERT INTO word_card_group (name,group_key,icon,group_type,parent_group_id,sort_order,is_active) "
                "VALUES (?,?,?,'sub',?,?,1)",
                [f"⚠️ {name}", f"global_{key}", icon, 89, len(existing_neg) + 1]
            )
        conn.commit()
        print("[OK] 全局负面 3 个子分组已创建")
    else:
        print(f"[SKIP] 全局负面已有 {len(existing_neg)} 个子分组")

    # 归类负面卡片
    neg_map = {
        # 人物形态
        "畸形": 1,
        "多余肢体": 1,
        # 画面质量
        "模糊": 2,
        "噪点过多": 2,
        "画面撕裂": 2,
        # 技术渲染
        "水印": 3,
        "色彩溢出": 3,
        "抖动不稳": 3,
        "3D渲染感": 3,
    }

    neg_subs = db.execute(
        "SELECT id,sort_order FROM word_card_group WHERE parent_group_id=89 AND is_active=1 ORDER BY sort_order"
    ).fetchall()
    neg_sort_to_id = {row[1]: row[0] for row in neg_subs}

    moved_neg = 0
    for content_str, sort_order in neg_map.items():
        sub_id = neg_sort_to_id.get(sort_order)
        if not sub_id:
            continue
        cards = db.execute(
            "SELECT id FROM word_card WHERE group_id=89 AND content=? AND is_deleted=0", [content_str]
        ).fetchall()
        for c in cards:
            db.execute("UPDATE word_card SET group_id=? WHERE id=?", [sub_id, c[0]])
            moved_neg += 1

    leftover_neg = db.execute(
        "SELECT id FROM word_card WHERE group_id=89 AND is_deleted=0"
    ).fetchall()
    if leftover_neg and neg_subs:
        first_sub = neg_subs[0][0]
        for c in leftover_neg:
            db.execute("UPDATE word_card SET group_id=? WHERE id=?", [first_sub, c[0]])
            moved_neg += 1

    conn.commit()
    print(f"[OK] 全局负面卡片归属: {moved_neg} 条")

    conn.close()
    print("\n[Migration] Phase20 子分组迁移完成.")

if __name__ == "__main__":
    migrate()
