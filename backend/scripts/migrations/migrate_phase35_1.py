# -*- coding: utf-8 -*-
"""
Phase35.1 迁移 — 项目内嵌模块化资产库

新增：
- asset_module 系统资产模块字典（图片/视频/音频/PS/AI/AE/C4D/PR/Blender/AU/3D/文档/字幕/其他）
- project_space 追加 modules_json / backup_policy
- asset_catalog 追加 module_key / is_critical / backup_status / backup_path

安全：纯增量、幂等、执行前 VACUUM INTO 快照备份。
"""
import os, sys, sqlite3, json, time

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "data", "prompts.db")
DATA_DIR = os.path.join(HERE, "..", "data")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")

# (key, name, icon, default_folder, media_kind, accept_ext, sort)
MODULES = [
    ("image",          "图片素材",   "🖼️", "图片素材",     "image",        "jpg,jpeg,png,webp,gif,bmp,tiff,svg", 10),
    ("video",          "视频素材",   "🎬", "视频素材",     "video",        "mp4,mov,avi,mkv,webm,m4v",           20),
    ("audio",          "音频素材",   "🎵", "音频素材",     "audio",        "mp3,wav,flac,aac,ogg,m4a",           30),
    ("project_ps",     "PS工程",     "🅿️", "工程文件/PS",  "project_file", "psd,psb",                            40),
    ("project_ai",     "AI工程",     "🅰️", "工程文件/AI",  "project_file", "ai,eps",                             50),
    ("project_ae",     "AE工程",     "🎞️", "工程文件/AE",  "project_file", "aep,aepx",                           60),
    ("project_c4d",    "C4D工程",    "🧊", "工程文件/C4D", "project_file", "c4d",                                70),
    ("project_pr",     "PR工程",     "🎥", "工程文件/PR",  "project_file", "prproj",                             80),
    ("project_blender","Blender工程","🟠", "工程文件/Blender","project_file","blend",                            90),
    ("project_au",     "AU音频工程", "🎚️", "工程文件/AU",  "project_file", "sesx",                               100),
    ("model_3d",       "3D模型",     "📦", "3D模型",       "model",        "fbx,obj,glb,gltf,usd,usdz,stl,dae",  110),
    ("doc",            "脚本文档",   "📄", "脚本文档",     "doc",          "txt,md,doc,docx,xls,xlsx,pdf,csv",   120),
    ("subtitle",       "字幕",       "💬", "字幕",         "doc",          "srt,ass,vtt",                        130),
    ("other",          "其他",       "📁", "其他",         "other",        "",                                   200),
]


def _has_col(c, table, col):
    try:
        return any(r[1] == col for r in c.execute(f"PRAGMA table_info({table})"))
    except Exception:
        return False


def main():
    if not os.path.exists(DB):
        print("[ERR] DB missing"); sys.exit(1)
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    bak = os.path.join(BACKUP_DIR, f"phase35_1_pre_{stamp}.db")
    s = sqlite3.connect(DB, timeout=10)
    try:
        s.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        s.execute("VACUUM INTO ?", [bak]); print(f"[OK] 备份 -> {bak}")
    except Exception as e:
        import shutil; shutil.copy2(DB, bak); print(f"[WARN] VACUUM 失败({e})，已复制备份")
    finally:
        s.close()

    c = sqlite3.connect(DB, timeout=10); c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    try:
        c.execute("""
            CREATE TABLE IF NOT EXISTS asset_module (
                key TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                icon TEXT DEFAULT '',
                default_folder TEXT NOT NULL,
                media_kind TEXT NOT NULL DEFAULT 'other',
                accept_ext TEXT DEFAULT '',
                sort INTEGER DEFAULT 100
            )
        """)
        for k, name, icon, folder, kind, ext, sort in MODULES:
            c.execute("""INSERT INTO asset_module (key,name,icon,default_folder,media_kind,accept_ext,sort)
                         VALUES (?,?,?,?,?,?,?)
                         ON CONFLICT(key) DO UPDATE SET
                           name=excluded.name, icon=excluded.icon, default_folder=excluded.default_folder,
                           media_kind=excluded.media_kind, accept_ext=excluded.accept_ext, sort=excluded.sort""",
                      [k, name, icon, folder, kind, ext, sort])
        print(f"[OK] asset_module 就绪 ({len(MODULES)} 模块)")

        # project_space 扩列
        if not _has_col(c, "project_space", "modules_json"):
            c.execute("ALTER TABLE project_space ADD COLUMN modules_json TEXT DEFAULT '[]'"); print("[OK] project_space += modules_json")
        if not _has_col(c, "project_space", "backup_policy"):
            c.execute("ALTER TABLE project_space ADD COLUMN backup_policy TEXT DEFAULT 'critical'"); print("[OK] project_space += backup_policy")

        # asset_catalog 扩列
        for col, ddl in [
            ("module_key",   "ALTER TABLE asset_catalog ADD COLUMN module_key TEXT DEFAULT ''"),
            ("is_critical",  "ALTER TABLE asset_catalog ADD COLUMN is_critical INTEGER DEFAULT 0"),
            ("backup_status","ALTER TABLE asset_catalog ADD COLUMN backup_status TEXT DEFAULT 'none'"),
            ("backup_path",  "ALTER TABLE asset_catalog ADD COLUMN backup_path TEXT DEFAULT ''"),
        ]:
            if not _has_col(c, "asset_catalog", col):
                c.execute(ddl); print(f"[OK] asset_catalog += {col}")

        c.commit()
        print("\n==== 摘要 ====")
        print("  asset_module:", c.execute("SELECT COUNT(1) FROM asset_module").fetchone()[0])
        print("  project_space cols:", [r[1] for r in c.execute("PRAGMA table_info(project_space)")])
        print("  fk_check:", len(c.execute("PRAGMA foreign_key_check").fetchall()))
        print("[DONE] Phase35.1 迁移完成")
    finally:
        c.close()


if __name__ == "__main__":
    main()
