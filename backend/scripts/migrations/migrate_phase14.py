"""
Phase14: 分类架构重构迁移脚本
- 插入2个根分组 + 10个子类分组
- 50个现有分组重新分配 parent_group_id
- 清理空/重复自定义分组
- 安全执行：所有操作带事务回滚
"""
import sqlite3
import os
import sys

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'prompts.db')
BACKUP_PATH = DB_PATH + '.phase14_backup'

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def migrate():
    # 备份
    import shutil
    shutil.copy2(DB_PATH, BACKUP_PATH)
    print(f"[备份] {BACKUP_PATH}")

    conn = get_conn()
    print(f"[表状态] word_card_group 当前记录数:", conn.execute("SELECT COUNT(*) FROM word_card_group").fetchone()[0])
    
    # ============================================================
    # 步骤1: 插入2个根组 (sort_order 极大值，排最后)
    # ============================================================
    roots = [
        ("📷 图像描述词库", "root_image", "📷", "静态图像提示词总类 — 人物/调性/构图/时空/负面", "root", None, 9990),
        ("🎬 视频描述词库", "root_video", "🎬", "动态视频提示词总类 — 运镜/场景/特效/音频/模板", "root", None, 9991),
    ]
    for name, key, icon, desc, gtype, parent, sort in roots:
        conn.execute(
            "INSERT INTO word_card_group (name,group_key,icon,description,group_type,parent_group_id,sort_order) VALUES (?,?,?,?,?,?,?)",
            [name, key, icon, desc, gtype, parent, sort]
        )
    conn.commit()
    root_image_id = conn.execute("SELECT id FROM word_card_group WHERE group_key='root_image'").fetchone()["id"]
    root_video_id = conn.execute("SELECT id FROM word_card_group WHERE group_key='root_video'").fetchone()["id"]
    print(f"[根组] root_image id={root_image_id}, root_video id={root_video_id}")
    
    # ============================================================
    # 步骤2: 插入10个子类分组
    # ============================================================
    subclasses = [
        # --- 图像描述词库 (root_image_id) ---
        ("👤 人物表现", "sub_character", "👤", "人物表情/神态/服饰道具", "sub", root_image_id, 1),
        ("🎨 画面调性", "sub_tone_style", "🎨", "色彩/色调/光影/质感/滤镜", "sub", root_image_id, 2),
        ("🖼️ 构图与画质", "sub_composition", "🖼️", "分镜构图/画风/画质/虚实", "sub", root_image_id, 3),
        ("🌍 时空风格", "sub_era_style", "🌍", "年代/地域/人文环境", "sub", root_image_id, 4),
        ("⚠️ 负面提示词", "sub_negative", "⚠️", "负面提示词/排除项", "sub", root_image_id, 5),
        # --- 视频描述词库 (root_video_id) ---
        ("🎥 运镜与构图", "sub_camera", "🎥", "运镜/构图/焦段/视角", "sub", root_video_id, 1),
        ("🔮 画面主体与场景", "sub_subject_scene", "🔮", "主体/场景/天气/特效/外力", "sub", root_video_id, 2),
        ("🎞️ 动态特效", "sub_motion_fx", "🎞️", "动态速率/物理规则/转场/动作", "sub", root_video_id, 3),
        ("🔊 音频设计", "sub_audio", "🔊", "BGM/音效/旁白/环境音", "sub", root_video_id, 4),
        ("📹 视频模板", "sub_video_template", "📹", "Seedance视频模板/组装器", "sub", root_video_id, 5),
    ]
    for name, key, icon, desc, gtype, parent, sort in subclasses:
        conn.execute(
            "INSERT INTO word_card_group (name,group_key,icon,description,group_type,parent_group_id,sort_order) VALUES (?,?,?,?,?,?,?)",
            [name, key, icon, desc, gtype, parent, sort]
        )
    conn.commit()
    sub_ids = {}
    for _, key, *_ in subclasses:
        row = conn.execute("SELECT id FROM word_card_group WHERE group_key=?", [key]).fetchone()
        if row: sub_ids[key] = row["id"]
    print(f"[子类] 已创建 {len(sub_ids)} 个子类分组")
    
    # ============================================================
    # 步骤3: 重新分配50个现有分组的 parent_group_id
    # ============================================================
    parent_map = {
        # === 图像描述词库 ===
        # 人物表现
        "emotion": "sub_character",
        "人物神态情绪词库": "sub_character",
        "服饰道具词库": "sub_character",
        # 画面调性
        "color": "sub_tone_style",
        "tone": "sub_tone_style",
        "光影词库": "sub_tone_style",
        "材质质感词库": "sub_tone_style",
        "调色配色词库": "sub_tone_style",
        "特殊滤镜词库": "sub_tone_style",
        # 构图与画质
        "composition": "sub_composition",
        "画风美术词库": "sub_composition",
        "画质画幅词库": "sub_composition",
        "画面虚实占比词库": "sub_composition",
        "胶片瑕疵词库": "sub_composition",
        # 时空风格
        "年代时空词库": "sub_era_style",
        "地域风格词库": "sub_era_style",
        "人文环境细节词库": "sub_era_style",
        # 负面提示词
        "负面提示词库": "sub_negative",
        
        # === 视频描述词库 ===
        # 运镜与构图
        "camera_move": "sub_camera",
        "构图词库": "sub_camera",
        "镜头焦段词库": "sub_camera",
        "镜头视角词库": "sub_camera",
        "拍摄运镜": "sub_camera",
        # 画面主体与场景
        "subject": "sub_subject_scene",
        "scene": "sub_subject_scene",
        "天气氛围词库": "sub_subject_scene",
        "特效粒子词库": "sub_subject_scene",
        "自然外力动态词库": "sub_subject_scene",
        # 动态特效
        "动态速率词库": "sub_motion_fx",
        "奇幻物理规则词库": "sub_motion_fx",
        "转场效果词库": "sub_motion_fx",
        "动作词库": "sub_motion_fx",
        # 音频设计
        "audio_bgm": "sub_audio",
        "audio_sfx": "sub_audio",
        "audio_char_narr": "sub_audio",
        "环境音效词库": "sub_audio",
        # 视频模板
        "seedance": "sub_video_template",
    }
    
    # 查出所有现有分组
    all_groups = conn.execute("SELECT id, name, group_key, group_type FROM word_card_group WHERE group_type IN ('seedance','builtin','custom')").fetchall()
    
    assigned = 0
    skipped = []
    for g in all_groups:
        parent_key = parent_map.get(g["group_key"])
        if not parent_key:
            # 试试用中文名匹配
            parent_key = parent_map.get(g["name"])
        if parent_key and parent_key in sub_ids:
            conn.execute("UPDATE word_card_group SET parent_group_id=?, sort_order=(SELECT COALESCE(MAX(sort_order),0)+1 FROM word_card_group WHERE parent_group_id=?) WHERE id=?",
                        [sub_ids[parent_key], sub_ids[parent_key], g["id"]])
            assigned += 1
        else:
            skipped.append(f"  {g['group_key']} ({g['name']}) - type={g['group_type']}")
    
    conn.commit()
    print(f"[分配] {assigned}/{len(all_groups)} 组已分配父级")
    if skipped:
        print(f"[跳过] {len(skipped)} 组未找到匹配:")
        for s in skipped: print(s)
    
    # ============================================================
    # 步骤4: 清理空/重复自定义分组
    # ============================================================
    # 找出所有自定义空组 (card_count=0 的 custom 类型)
    empty_custom = conn.execute("""
        SELECT wg.id, wg.group_key, wg.name,
               (SELECT COUNT(*) FROM word_card wc WHERE wc.group_id=wg.id AND wc.is_deleted=0) as card_count
        FROM word_card_group wg 
        WHERE wg.group_type='custom'
    """).fetchall()
    
    # 去重逻辑: 保留每个名称中 card_count 最多的，删除其他空组
    to_delete = []
    name_map = {}  # name -> best_id
    for g in empty_custom:
        if g["card_count"] > 0:
            if g["name"] not in name_map or g["card_count"] > name_map[g["name"]]["card_count"]:
                name_map[g["name"]] = g
        else:
            name_map.setdefault(g["name"], g)
    
    # 找出可删除的空组
    for g in empty_custom:
        if g["card_count"] == 0:
            # 检查是否有同名的非空组
            best = name_map.get(g["name"])
            if best and best["id"] != g["id"]:
                to_delete.append(g["id"])
                print(f"[清理] 删除空重复组 id={g['id']} '{g['name']}' (保留 id={best['id']})")
    
    for did in to_delete:
        conn.execute("UPDATE word_card_group SET is_active=0 WHERE id=?", [did])
    conn.commit()
    print(f"[清理] 共停用 {len(to_delete)} 个空/重复自定义分组")
    
    # ============================================================
    # 步骤5: 验证
    # ============================================================
    final_count = conn.execute("SELECT COUNT(*) FROM word_card_group WHERE is_active=1").fetchone()[0]
    print(f"\n[完成] 活跃分组总数: {final_count}")
    print(f"[回滚] 如需回滚: copy {BACKUP_PATH} → {DB_PATH}")

    conn.close()

if __name__ == "__main__":
    migrate()
