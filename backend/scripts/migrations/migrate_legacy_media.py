# -*- coding: utf-8 -*-
"""
历史媒体数据迁移 — 将旧 media_assets(473) 在位索引进「媒体资产库」(Phase35)

原则：不搬动/不复制原文件；复用已有缩略图；视频用 ffmpeg 生成缩略图。
目标：默认公共工作空间(id=1) 下的共享项目「历史媒体归档」。
幂等：按 (project_space_id, local_rel_path) 去重，可重复执行。
执行前 VACUUM INTO 快照备份。
"""
import os, sys, sqlite3, hashlib, subprocess, time, json

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.abspath(os.path.join(HERE, "..", "data"))
DB = os.path.join(DATA, "prompts.db")
THUMB = os.path.join(DATA, "thumbnails")
ORIG = os.path.join(DATA, "originals")
VID = os.path.join(DATA, "videos")
WCT = os.path.join(DATA, "wordcard_thumbs")
WCV = os.path.join(DATA, "wordcard_videos")
WCM = os.path.join(DATA, "wc_media")
CAT_THUMB = os.path.join(DATA, "catalog_thumbs")
BACKUP_DIR = os.path.join(DATA, "backups")
ARCHIVE_NAME = "历史媒体归档"
HASH_CAP = 80 * 1024 * 1024  # >80MB 不做全量哈希

os.makedirs(CAT_THUMB, exist_ok=True)


def _fp(path, size):
    try:
        if size and size > HASH_CAP:
            return "sz:%d:%s" % (size, os.path.basename(path))
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for c in iter(lambda: f.read(1 << 20), b""):
                h.update(c)
        return h.hexdigest()
    except Exception:
        return ""


def _vthumb(cid, src):
    out = os.path.join(CAT_THUMB, "%d.jpg" % cid)
    try:
        subprocess.run(["ffmpeg", "-y", "-ss", "1", "-i", src, "-frames:v", "1", "-vf", "scale=400:-1", out],
                       capture_output=True, timeout=25,
                       creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0)
        return out if os.path.isfile(out) else ""
    except Exception:
        return ""


def main():
    if not os.path.exists(DB):
        print("[ERR] DB missing"); sys.exit(1)
    os.makedirs(BACKUP_DIR, exist_ok=True)
    bak = os.path.join(BACKUP_DIR, "legacy_media_pre_%s.db" % time.strftime("%Y%m%d_%H%M%S"))
    s = sqlite3.connect(DB, timeout=10)
    try:
        s.execute("PRAGMA wal_checkpoint(TRUNCATE)"); s.execute("VACUUM INTO ?", [bak]); print("[OK] 备份 ->", bak)
    except Exception as e:
        import shutil; shutil.copy2(DB, bak); print("[WARN] VACUUM 失败(%s)，已复制" % e)
    finally:
        s.close()

    c = sqlite3.connect(DB, timeout=30); c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL"); c.execute("PRAGMA busy_timeout=8000")
    try:
        # 默认公共工作空间
        ws = c.execute("SELECT * FROM user_workspace WHERE is_default=1").fetchone()
        if not ws:
            print("[ERR] 缺少默认公共工作空间，请先跑 migrate_phase35.py"); sys.exit(1)
        wsid = ws["id"]
        ws_root = os.path.abspath(ws["storage_root"] or DATA)

        # 归档项目（幂等）
        proj = c.execute("SELECT * FROM project_space WHERE name=? AND workspace_id=?", [ARCHIVE_NAME, wsid]).fetchone()
        if not proj:
            c.execute("""INSERT INTO project_space (workspace_id,owner_user_id,name,description,status,visibility,modules_json,backup_policy,project_root)
                         VALUES (?,?,?,?, 'active','shared',?, 'none','')""",
                      [wsid, 1, ARCHIVE_NAME, "旧全局媒体(media_assets)在位索引归档，原文件未移动", json.dumps(["image", "video", "audio"], ensure_ascii=False)])
            pid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
            c.execute("UPDATE project_space SET project_root=? WHERE id=?", ["projects/proj%d" % pid, pid])
            try:
                c.execute("INSERT OR IGNORE INTO project_space_member (project_space_id,user_id,role,added_by) VALUES (?,?, 'owner', ?)", [pid, 1, 1])
            except Exception:
                pass
            c.commit()
            print("[OK] 创建归档项目 pid=%d" % pid)
        else:
            pid = proj["id"]
            print("[SKIP] 归档项目已存在 pid=%d" % pid)

        pabs = os.path.join(ws_root, "projects", "proj%d" % pid)
        os.makedirs(pabs, exist_ok=True)

        rows = c.execute("SELECT * FROM media_assets ORDER BY id").fetchall()
        migrated = skipped = missing = 0
        for r in rows:
            mt = r["media_type"] or "image"
            fn = r["filename"]; ofn = r["original_filename"] or fn
            module = "image" if mt == "image" else ("video" if mt == "video" else ("audio" if mt == "audio" else "other"))
            # 定位真实原文件（多目录回退）
            def _first(paths):
                for p in paths:
                    if p and os.path.isfile(p):
                        return p
                return ""
            if mt == "video":
                real = _first([os.path.join(VID, fn), os.path.join(WCV, fn), os.path.join(WCM, fn)])
            else:
                real = _first([os.path.join(ORIG, ofn), os.path.join(THUMB, fn), os.path.join(WCT, fn), os.path.join(WCT, ofn), os.path.join(WCM, fn)])
            if not real or not os.path.isfile(real):
                missing += 1; continue
            rel = os.path.relpath(real, pabs).replace("\\", "/")
            # 幂等
            if c.execute("SELECT 1 FROM asset_catalog WHERE project_space_id=? AND local_rel_path=?", [pid, rel]).fetchone():
                skipped += 1; continue
            size = r["file_size"] or (os.path.getsize(real) if os.path.isfile(real) else 0)
            ext = fn.rsplit(".", 1)[-1].lower() if "." in fn else ""
            fp = _fp(real, size)
            # 缩略图
            tp = ""
            if mt == "image":
                t = _first([os.path.join(THUMB, fn), os.path.join(WCT, fn), os.path.join(WCT, ofn)])
                tp = t if t else ""
            c.execute("""INSERT INTO asset_catalog
                (project_space_id,workspace_id,owner_user_id,fingerprint,filename,ext,size,media_type,module_key,
                 origin_device,local_rel_path,thumb_path,status,is_critical,backup_status,review_status,version_count,created_at)
                VALUES (?,?,?,?,?,?,?,?,?, 'server', ?,?, 'present', 0, 'backed_up', 'approved', 1, ?)""",
                [pid, wsid, r["owner_user_id"] or 1, fp, fn, ext, size, mt, module, rel, tp,
                 r["created_at"] or time.strftime("%Y-%m-%d %H:%M:%S")])
            cid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
            if mt == "video":
                tp = _vthumb(cid, real)
                if tp:
                    c.execute("UPDATE asset_catalog SET thumb_path=? WHERE id=?", [tp, cid])
            c.execute("""INSERT INTO asset_version
                (catalog_id,version_no,fingerprint,filename,size,local_rel_path,thumb_path,origin_device,author_user_id,author_name,note,status)
                VALUES (?,1,?,?,?,?,?, 'server', 1, 'system', '历史迁移', 'approved')""",
                [cid, fp, fn, size, rel, tp])
            vid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
            c.execute("UPDATE asset_catalog SET current_version_id=? WHERE id=?", [vid, cid])
            migrated += 1
            if migrated % 50 == 0:
                c.commit(); print("  ... 已迁移 %d" % migrated)
        c.commit()
        total = c.execute("SELECT COUNT(1) FROM asset_catalog WHERE project_space_id=?", [pid]).fetchone()[0]
        print("\n==== 迁移完成 ====")
        print("  新迁移: %d  跳过(已存在): %d  缺失文件: %d" % (migrated, skipped, missing))
        print("  归档项目当前资产总数: %d" % total)
        print("  fk_check:", len(c.execute("PRAGMA foreign_key_check").fetchall()))
    finally:
        c.close()


if __name__ == "__main__":
    main()
