# -*- coding: utf-8 -*-
"""
Phase16-v5.2.0: migrate_atom_asset_library — 原子化资产闭环 · DB 迁移脚本

功能:
  ① 创建 atom_asset_library 统一原子资产表（四大域 + 两大媒体类别）
  ② 迁移现有数据: word_card → atom_asset_library (694条)
  ③ 迁移 atom_decompose 拆解结果 → atom_asset_library (233条)
  ④ 从 character_profiles 提取外观关键词 → 角色域原子
  ⑤ 从 scene_profiles 提取场景维度 → 场景域原子
  ⑥ 补全 media_category 推断逻辑
  ⑦ 创建索引 + 统计报告

执行方式: python backend/migrate_atom_asset_library.py
幂等安全: 所有 CREATE TABLE 使用 IF NOT EXISTS
"""
import sys, os, json, hashlib, re, time

sys.path.insert(0, os.path.dirname(__file__))
from database import get_db, safe_execute, safe_commit


def migrate():
    db = get_db()
    start = time.time()
    print("=" * 60)
    print("  Phase16-v5.2.0: atom_asset_library 迁移开始")
    print("=" * 60)

    # =============================================
    # ① 创建 atom_asset_library 主表
    # =============================================
    print("\n[Step 1/7] 创建 atom_asset_library 主表...")

    safe_execute("""
        CREATE TABLE IF NOT EXISTS atom_asset_library (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            atom_hash       TEXT    NOT NULL UNIQUE,
            atom_text       TEXT    NOT NULL,
            atom_type       TEXT    NOT NULL DEFAULT 'general',
            media_category  TEXT    NOT NULL DEFAULT 'image',
            linked_type     TEXT    DEFAULT 'general',
            linked_id       INTEGER DEFAULT NULL,
            source          TEXT    DEFAULT 'manual',
            source_decompose_id INTEGER DEFAULT NULL,
            usage_count     INTEGER DEFAULT 0,
            combo_count     INTEGER DEFAULT 0,
            quality_score   REAL    DEFAULT 0,
            is_active       INTEGER DEFAULT 1,
            is_verified     INTEGER DEFAULT 0,
            tags_json       TEXT    DEFAULT '[]',
            created_at      TEXT DEFAULT (datetime('now','localtime')),
            updated_at      TEXT DEFAULT (datetime('now','localtime')),
            last_used_at    TEXT DEFAULT NULL
        )
    """, commit=True)

    # 索引
    for idx_name, idx_sql in [
        ("idx_aal_hash",   "CREATE INDEX IF NOT EXISTS idx_aal_hash ON atom_asset_library(atom_hash)"),
        ("idx_aal_media",  "CREATE INDEX IF NOT EXISTS idx_aal_media ON atom_asset_library(media_category)"),
        ("idx_aal_linked", "CREATE INDEX IF NOT EXISTS idx_aal_linked ON atom_asset_library(linked_type, linked_id)"),
        ("idx_aal_usage",  "CREATE INDEX IF NOT EXISTS idx_aal_usage ON atom_asset_library(usage_count DESC)"),
        ("idx_aal_source", "CREATE INDEX IF NOT EXISTS idx_aal_source ON atom_asset_library(source)"),
        ("idx_aal_type",   "CREATE INDEX IF NOT EXISTS idx_aal_type ON atom_asset_library(atom_type)"),
    ]:
        safe_execute(idx_sql)
    safe_commit()
    print("  ✓ 主表 + 6个索引创建完成")

    # =============================================
    # ② 迁移 word_card → atom_asset_library
    # =============================================
    print("\n[Step 2/7] 迁移 word_card → atom_asset_library...")

    # 获取 word_card 总数
    wc_total = db.execute(
        "SELECT COUNT(*) as c FROM word_card WHERE is_deleted=0"
    ).fetchone()["c"]
    print(f"  源数据: word_card (is_deleted=0) = {wc_total} 条")

    # 获取分组信息用于推断 media_category
    group_map = {}
    gr_rows = db.execute(
        "SELECT id, group_key, group_type, name FROM word_card_group WHERE is_active=1"
    ).fetchall()
    for g in gr_rows:
        group_map[g["id"]] = {
            "key": (g["group_key"] or "").lower(),
            "type": (g["group_type"] or "").lower(),
            "name": (g["name"] or "").lower()
        }

    def _infer_media_category(group_key: str, group_name: str, atom_type: str) -> str:
        """根据分组key/名称/原子类型推断媒体类别"""
        key_lower = (group_key or "").lower()
        name_lower = (group_name or "").lower()
        # 视频专属关键词
        video_kw = ["video", "camera", "运镜", "镜头", "seedance", "视频", "动画",
                     "audio", "bgm", "音效", "旁白", "转场", "速率", "动作", "动态"]
        # 图片专属关键词
        image_kw = ["image", "color", "色彩", "配色", "光影", "画质", "画风",
                     "构图", "质感", "负面", "negative", "表情", "服饰"]
        for kw in video_kw:
            if kw in key_lower or kw in name_lower or kw in atom_type:
                return "video"
        for kw in image_kw:
            if kw in key_lower or kw in name_lower or kw in atom_type:
                return "image"
        return "both"  # 通用

    def _infer_linked_type(group_key: str, group_name: str) -> str:
        """推断原子域归属"""
        key = (group_key or "").lower()
        name = (group_name or "").lower()
        char_kw = ["character", "emotion", "表情", "神态", "角色", "人物", "服饰"]
        scene_kw = ["scene", "tone", "weather", "composition", "场景", "环境", "色调", "光影", "天气"]
        camera_kw = ["camera", "运镜", "镜头", "焦段", "视角", "seedance", "构图"]
        audio_kw = ["audio", "bgm", "音效", "旁白", "声音"]

        for kw in char_kw:
            if kw in key or kw in name:
                return "character"
        for kw in camera_kw:
            if kw in key or kw in name:
                return "camera"
        for kw in audio_kw:
            if kw in key or kw in name:
                return "audio"
        for kw in scene_kw:
            if kw in key or kw in name:
                return "scene"
        return "general"

    migrated_wc = 0
    skipped_wc = 0
    wc_rows = db.execute("""
        SELECT wc.id, wc.name, wc.content, wc.meaning, wc.group_id,
               wc.usage_count, wc.module, wc.media_type, wc.tags
        FROM word_card wc
        WHERE wc.is_deleted=0 AND wc.content IS NOT NULL AND wc.content != ''
        ORDER BY wc.id
    """).fetchall()

    for row in wc_rows:
        content = (row["content"] or "").strip()
        name = (row["name"] or "").strip()
        if not content or len(content) < 2:
            skipped_wc += 1
            continue

        gid = row["group_id"]
        ginfo = group_map.get(gid, {"key": "", "type": "", "name": ""})
        atom_text = content[:100]  # 取前100字符作为原子文本
        atom_type = row["module"] or "general"

        # 解析 tags
        tags = row["tags"] or "[]"
        try:
            tags = json.loads(tags) if isinstance(tags, str) else (tags or [])
        except:
            tags = []

        media_cat = _infer_media_category(ginfo["key"], ginfo["name"], atom_type)
        linked_t = _infer_linked_type(ginfo["key"], ginfo["name"])

        h = hashlib.md5(f"{atom_text}|{media_cat}".encode()).hexdigest()

        # 去重检查
        existing = db.execute(
            "SELECT id, usage_count, combo_count FROM atom_asset_library WHERE atom_hash=?",
            [h]
        ).fetchone()

        if existing:
            # 更新统计
            db.execute(
                "UPDATE atom_asset_library SET usage_count=usage_count+?, updated_at=datetime('now','localtime') WHERE atom_hash=?",
                [row["usage_count"] or 0, h]
            )
            skipped_wc += 1
        else:
            db.execute("""
                INSERT INTO atom_asset_library
                    (atom_hash, atom_text, atom_type, media_category,
                     linked_type, linked_id, source, usage_count,
                     tags_json, quality_score)
                VALUES (?,?,?,?,?,?,?,?,?,?)
            """, [
                h, atom_text, atom_type or "general", media_cat,
                linked_t, gid, "word_card_migrate",
                row["usage_count"] or 0,
                json.dumps(tags, ensure_ascii=False),
                round(min(len(content) / 30, 1.0), 2)
            ])
            migrated_wc += 1

    safe_commit()
    print(f"  ✓ word_card 迁移: {migrated_wc} 条新增, {skipped_wc} 条去重跳过")

    # =============================================
    # ③ 迁移 atom_decompose → atom_asset_library
    # =============================================
    print("\n[Step 3/7] 迁移 atom_decompose 拆解结果...")

    ad_total = db.execute("SELECT COUNT(*) as c FROM atom_decompose").fetchone()["c"]
    print(f"  源数据: atom_decompose = {ad_total} 条")

    migrated_ad = 0
    skipped_ad = 0

    ad_rows = db.execute("""
        SELECT id, source_prompt, media_type, atoms_json, quality_score
        FROM atom_decompose ORDER BY id
    """).fetchall()

    for ad in ad_rows:
        try:
            atoms = json.loads(ad["atoms_json"] or "[]")
        except:
            atoms = []

        if not atoms:
            skipped_ad += 1
            continue

        for atom in atoms:
            atom_text = (atom.get("text") or "").strip()
            atom_type = atom.get("type") or "creative"
            if not atom_text or len(atom_text) < 1:
                continue

            media_cat = ad["media_type"] or "image"
            if media_cat not in ("image", "video"):
                media_cat = "image"

            h = hashlib.md5(f"{atom_text}|{media_cat}".encode()).hexdigest()

            existing = db.execute(
                "SELECT id FROM atom_asset_library WHERE atom_hash=?", [h]
            ).fetchone()

            if existing:
                db.execute(
                    "UPDATE atom_asset_library SET usage_count=usage_count+1, updated_at=datetime('now','localtime') WHERE atom_hash=?",
                    [h]
                )
                skipped_ad += 1
            else:
                db.execute("""
                    INSERT INTO atom_asset_library
                        (atom_hash, atom_text, atom_type, media_category,
                         linked_type, source, source_decompose_id, quality_score)
                    VALUES (?,?,?,?,?,?,?,?)
                """, [
                    h, atom_text, atom_type or "creative", media_cat,
                    "general", "ai_decompose", ad["id"],
                    round(atom.get("weight", ad["quality_score"] or 0), 2)
                ])
                migrated_ad += 1

    safe_commit()
    print(f"  ✓ atom_decompose 迁移: {migrated_ad} 条新增, {skipped_ad} 条去重跳过")

    # =============================================
    # ④ 从 character_profiles 提取角色域原子
    # =============================================
    print("\n[Step 4/7] 提取角色档案关键词 → 角色域原子...")

    migrated_char = 0
    char_rows = db.execute("""
        SELECT id, name, appearance, personality, occupation, gender, age_range, usage_count
        FROM character_profiles WHERE is_builtin>=0
    """).fetchall()

    for ch in char_rows:
        # 从 appearance / personality 提取关键词原子
        appearance = (ch["appearance"] or "").strip()
        personality = (ch["personality"] or "").strip()

        for field_text in [appearance, personality]:
            if not field_text:
                continue
            # 按中文标点拆分为短语
            phrases = re.split(r'[，,、；;。．\.\s]+', field_text)
            for phrase in phrases:
                phrase = phrase.strip()
                if len(phrase) < 2 or len(phrase) > 40:
                    continue
                # 推断 atom_type
                if any(kw in phrase for kw in ["发", "眼", "皮肤", "身", "脸", "眉", "唇", "鼻"]):
                    atom_type = "subject"
                elif any(kw in phrase for kw in ["坚", "温柔", "冷静", "热", "沉稳", "活泼"]):
                    atom_type = "creative"
                else:
                    atom_type = "subject"

                h = hashlib.md5(f"{phrase}|image".encode()).hexdigest()

                existing = db.execute(
                    "SELECT id FROM atom_asset_library WHERE atom_hash=?", [h]
                ).fetchone()
                if existing:
                    db.execute(
                        "UPDATE atom_asset_library SET usage_count=usage_count+1 WHERE atom_hash=?", [h]
                    )
                else:
                    db.execute("""
                        INSERT INTO atom_asset_library
                            (atom_hash, atom_text, atom_type, media_category,
                             linked_type, linked_id, source, usage_count)
                        VALUES (?,?,?,?,?,?,?,?)
                    """, [
                        h, phrase, atom_type, "image",
                        "character", ch["id"], "character_extract",
                        ch["usage_count"] or 0
                    ])
                    migrated_char += 1

    safe_commit()
    print(f"  ✓ character_profiles 提取: {migrated_char} 条角色域原子")

    # =============================================
    # ⑤ 从 scene_profiles 提取场景域原子
    # =============================================
    print("\n[Step 5/7] 提取场景模板维度 → 场景域原子...")

    migrated_scene = 0
    sp_rows = db.execute("""
        SELECT id, name, settings_json FROM scene_profiles
    """).fetchall()

    for sp in sp_rows:
        try:
            settings = json.loads(sp["settings_json"] or "{}")
        except:
            settings = {}

        if not settings:
            continue

        # 将每个维度值作为原子入库
        for dim_key, dim_val in settings.items():
            if not dim_val or not str(dim_val).strip():
                continue
            atom_text = str(dim_val).strip()[:80]
            if len(atom_text) < 2:
                continue

            # 推断 atom_type
            type_map = {
                "location": "atmosphere", "architecture": "composition",
                "time": "tone", "season": "atmosphere", "weather": "atmosphere",
                "atmosphere": "atmosphere", "lighting": "lighting",
                "color_scheme": "color", "perspective": "camera",
                "composition": "composition", "style": "style",
                "quality": "quality", "negative": "negative"
            }
            atom_type = type_map.get(dim_key, "general")

            h = hashlib.md5(f"{atom_text}|image".encode()).hexdigest()

            existing = db.execute(
                "SELECT id FROM atom_asset_library WHERE atom_hash=?", [h]
            ).fetchone()
            if existing:
                db.execute(
                    "UPDATE atom_asset_library SET usage_count=usage_count+1 WHERE atom_hash=?", [h]
                )
            else:
                db.execute("""
                    INSERT INTO atom_asset_library
                        (atom_hash, atom_text, atom_type, media_category,
                         linked_type, linked_id, source)
                    VALUES (?,?,?,?,?,?,?)
                """, [
                    h, atom_text, atom_type, "image",
                    "scene", sp["id"], "scene_extract"
                ])
                migrated_scene += 1

    safe_commit()
    print(f"  ✓ scene_profiles 提取: {migrated_scene} 条场景域原子")

    # =============================================
    # ⑥ 从 user_project_scene 提取镜头域原子（camera维度）
    # =============================================
    print("\n[Step 6/7] 提取镜头模板 → 镜头域原子...")

    migrated_camera = 0
    camera_fields = [
        "camera_move", "subject", "action", "composition", "lighting",
        "focal_length", "texture", "speed", "emotion", "color_grade",
        "weather", "particles", "perspective", "depth_of_field"
    ]

    ups_rows = db.execute("SELECT id, " + ",".join(camera_fields) + " FROM user_project_scene").fetchall()

    for ups in ups_rows:
        for fname in camera_fields:
            val = (ups[fname] or "").strip() if ups[fname] else ""
            if not val or len(val) < 2:
                continue
            atom_text = val[:80]
            type_map2 = {
                "camera_move": "camera", "subject": "subject",
                "action": "action", "composition": "composition",
                "lighting": "lighting", "focal_length": "camera",
                "texture": "quality", "speed": "action",
                "emotion": "creative", "color_grade": "color",
                "weather": "atmosphere", "particles": "creative",
                "perspective": "camera", "depth_of_field": "camera"
            }
            atom_type = type_map2.get(fname, "general")

            h = hashlib.md5(f"{atom_text}|video".encode()).hexdigest()

            existing = db.execute(
                "SELECT id FROM atom_asset_library WHERE atom_hash=?", [h]
            ).fetchone()
            if existing:
                db.execute(
                    "UPDATE atom_asset_library SET usage_count=usage_count+1, combo_count=combo_count+1 WHERE atom_hash=?", [h]
                )
            else:
                db.execute("""
                    INSERT INTO atom_asset_library
                        (atom_hash, atom_text, atom_type, media_category,
                         linked_type, source, combo_count)
                    VALUES (?,?,?,?,?,?,1)
                """, [
                    h, atom_text, atom_type, "video",
                    "camera", "camera_extract"
                ])
                migrated_camera += 1

    safe_commit()
    print(f"  ✓ user_project_scene 提取: {migrated_camera} 条镜头域原子")

    # =============================================
    # ⑦ 统计报告
    # =============================================
    print("\n[Step 7/7] 生成迁移统计报告...")

    stats = {}
    stats["total"] = db.execute("SELECT COUNT(*) as c FROM atom_asset_library").fetchone()["c"]
    stats["by_media"] = {}
    for cat in ["image", "video", "both"]:
        c = db.execute(
            "SELECT COUNT(*) as c FROM atom_asset_library WHERE media_category=?",
            [cat]
        ).fetchone()["c"]
        stats["by_media"][cat] = c

    stats["by_linked"] = {}
    for lt in ["character", "scene", "camera", "audio", "general"]:
        c = db.execute(
            "SELECT COUNT(*) as c FROM atom_asset_library WHERE linked_type=?",
            [lt]
        ).fetchone()["c"]
        stats["by_linked"][lt] = c

    stats["by_source"] = {}
    for src in ["word_card_migrate", "ai_decompose", "character_extract", "scene_extract", "camera_extract"]:
        c = db.execute(
            "SELECT COUNT(*) as c FROM atom_asset_library WHERE source=?",
            [src]
        ).fetchone()["c"]
        stats["by_source"][src] = c

    stats["top_atom_types"] = []
    type_rows = db.execute("""
        SELECT atom_type, COUNT(*) as c
        FROM atom_asset_library
        GROUP BY atom_type
        ORDER BY c DESC LIMIT 10
    """).fetchall()
    stats["top_atom_types"] = [{"type": r["atom_type"], "count": r["c"]} for r in type_rows]

    elapsed = round(time.time() - start, 2)
    stats["elapsed_seconds"] = elapsed

    print(f"\n  {'='*50}")
    print(f"  📊 迁移统计报告")
    print(f"  {'='*50}")
    print(f"  总原子数:        {stats['total']}")
    print(f"  图片类:          {stats['by_media'].get('image',0)}")
    print(f"  视频类:          {stats['by_media'].get('video',0)}")
    print(f"  通用类:          {stats['by_media'].get('both',0)}")
    print(f"  角色域:          {stats['by_linked'].get('character',0)}")
    print(f"  场景域:          {stats['by_linked'].get('scene',0)}")
    print(f"  镜头域:          {stats['by_linked'].get('camera',0)}")
    print(f"  通用域:          {stats['by_linked'].get('general',0)}")
    print(f"  来源-word_card:  {stats['by_source'].get('word_card_migrate',0)}")
    print(f"  来源-AI拆解:     {stats['by_source'].get('ai_decompose',0)}")
    print(f"  来源-角色提取:   {stats['by_source'].get('character_extract',0)}")
    print(f"  来源-场景提取:   {stats['by_source'].get('scene_extract',0)}")
    print(f"  来源-镜头提取:   {stats['by_source'].get('camera_extract',0)}")
    print(f"  耗时:            {elapsed}s")
    print(f"  {'='*50}")

    return stats


if __name__ == "__main__":
    stats = migrate()
    print(f"\n✅ 迁移完成! atom_asset_library 现有 {stats['total']} 条原子资产")
