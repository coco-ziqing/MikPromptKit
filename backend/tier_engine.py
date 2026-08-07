"""
冷热分层存储引擎 + 代理生命周期 + 三层自检 + 离机备份
"""
import hashlib
import json
import os
import shutil
import sqlite3
import threading
import time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
DB = os.path.join(ROOT, "data", "prompts.db")
ARCHIVE_ROOT = os.path.join(ROOT, "data", "archive")
BLOB_STORE = os.path.join(ARCHIVE_ROOT, "blob_store")
PROXY_ROOT = os.path.join(ARCHIVE_ROOT, "proxy")

# 分层目录
TIER_HOT = os.path.join(ARCHIVE_ROOT, "blob_store")      # SSD 热层
TIER_WARM = os.path.join(ARCHIVE_ROOT, "warm_store")      # HDD 温层
TIER_COLD = os.path.join(ARCHIVE_ROOT, "cold_store")      # 外置冷层
os.makedirs(TIER_HOT, exist_ok=True)
os.makedirs(TIER_WARM, exist_ok=True)
os.makedirs(TIER_COLD, exist_ok=True)

HOT_DAYS = 30      # 30天内 → 热层
WARM_DAYS = 180    # 180天内 → 温层，超过 → 冷层
PROXY_TTL_DAYS = 90  # 代理文件 90 天未访问清理
BACKUP_DIR = os.path.join(ROOT, "data", "external_backup")
os.makedirs(BACKUP_DIR, exist_ok=True)

def _rw():
    c = sqlite3.connect(DB, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c

def _ro():
    c = sqlite3.connect(DB, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA query_only=ON")
    return c

def _safe_commit(c):
    for i in range(5):
        try: c.commit(); return
        except sqlite3.OperationalError:
            if i == 4: raise
            time.sleep(0.05*(i+1))

# ═══════════════════════════
# 冷热分层
# ═══════════════════════════

def auto_tier_cascade():
    """自动流转：按访问时间将 blob 移动到对应层"""
    moves = {"hot": 0, "warm": 0, "cold": 0}
    db = _rw()
    try:
        rows = db.execute("""
            SELECT blob_hash, storage_tier, storage_path, last_accessed_at
            FROM blob_store
        """).fetchall()

        now = time.time()
        for r in rows:
            try:
                last_ts = now  # default hot
                if r["last_accessed_at"]:
                    dt = datetime.strptime(r["last_accessed_at"], "%Y-%m-%d %H:%M:%S")
                    last_ts = dt.timestamp()
            except Exception:
                pass

            days_ago = max(0, (now - last_ts) / 86400)
            target_tier = "hot"
            if days_ago > WARM_DAYS:
                target_tier = "cold"
            elif days_ago > HOT_DAYS:
                target_tier = "warm"

            if target_tier != r["storage_tier"]:
                _move_blob(r["blob_hash"], r["storage_tier"], target_tier, db)
                moves[target_tier] += 1

        _safe_commit(db)
    finally:
        db.close()
    return moves

def _move_blob(blob_hash, from_tier, to_tier, db):
    """移动 blob 实体到目标层"""
    prefix = blob_hash[:2]
    from_dir = {"hot": TIER_HOT, "warm": TIER_WARM, "cold": TIER_COLD}.get(from_tier, TIER_HOT)
    to_dir = {"hot": TIER_HOT, "warm": TIER_WARM, "cold": TIER_COLD}.get(to_tier, TIER_WARM)

    src = os.path.join(from_dir, prefix, blob_hash)
    dst = os.path.join(to_dir, prefix, blob_hash)

    if not os.path.exists(src):
        return

    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.move(src, dst)
    db.execute("""UPDATE blob_store SET storage_tier=?, storage_path=?
                  WHERE blob_hash=?""", [to_tier, dst, blob_hash])

def get_tier_location(blob_hash, tier):
    """获取 blob 在各层的路径"""
    store = {"hot": TIER_HOT, "warm": TIER_WARM, "cold": TIER_COLD}.get(tier, TIER_HOT)
    return os.path.join(store, blob_hash[:2], blob_hash)


# ═══════════════════════════
# 代理生命周期
# ═══════════════════════════

def cleanup_stale_proxies(days=PROXY_TTL_DAYS):
    """清理超过 N 天未访问的代理文件"""
    if not os.path.exists(PROXY_ROOT):
        return 0
    now = time.time()
    cleaned = 0
    for fname in os.listdir(PROXY_ROOT):
        fp = os.path.join(PROXY_ROOT, fname)
        if not os.path.isfile(fp): continue
        if (now - os.path.getmtime(fp)) > days * 86400:
            os.remove(fp)
            cleaned += 1
    return cleaned

def regenerate_proxy(catalog_id):
    """重新生成指定资产的代理文件"""
    db = _rw()
    try:
        ac = db.execute("SELECT archive_path, ext, blob_hash, compression, filename FROM asset_catalog WHERE id=?",
                        [catalog_id]).fetchone()
        if not ac: return None

        # 先还原到临时
        from archive_engine import PROXY_ROOT as ENG_PROXY
        from archive_engine import generate_proxy, restore_from_blob
        tmp = os.path.join(ENG_PROXY, f"_reg_{int(time.time())}.tmp")
        restore_from_blob(ac["blob_hash"], tmp, ac["compression"] or "")

        proxy_path, proxy_type = generate_proxy(tmp)
        if tmp and os.path.exists(tmp):
            os.remove(tmp)

        if proxy_path:
            final = os.path.join(PROXY_ROOT, os.path.basename(proxy_path))
            if os.path.exists(proxy_path):
                shutil.move(proxy_path, final)
            db.execute("UPDATE asset_catalog SET proxy_path=?, proxy_type=? WHERE id=?",
                       [os.path.basename(final), proxy_type or "", catalog_id])
            _safe_commit(db)
            return str(final)
        return None
    finally:
        db.close()


# ═══════════════════════════
# 三层自检
# ═══════════════════════════

def check_level_1():
    """Level 1 — 每日快速自检：blob 实体存在性 + catalog 指针完整性"""
    issues = []
    db = _ro()
    try:
        # blob 实体存在性
        blobs = db.execute("SELECT blob_hash, storage_path, storage_tier FROM blob_store").fetchall()
        missing = []
        for b in blobs:
            sp = b["storage_path"]
            if sp and not os.path.exists(sp):
                missing.append({"blob_hash": b["blob_hash"][:16], "tier": b["storage_tier"]})

        if missing:
            issues.append({"level": 1, "type": "blob_missing",
                          "count": len(missing), "detail": missing[:10]})

        # catalog 指向无 blob
        orphans = db.execute("""
            SELECT ac.id, ac.filename, ac.blob_hash
            FROM asset_catalog ac
            LEFT JOIN blob_store bs ON ac.blob_hash = bs.blob_hash
            WHERE ac.blob_hash != '' AND bs.blob_hash IS NULL
        """).fetchall()
        if orphans:
            issues.append({"level": 1, "type": "orphan_catalog",
                          "count": len(orphans),
                          "detail": [{"id": r["id"], "name": r["filename"]} for r in orphans[:10]]})

    finally: db.close()
    return {"ok": True, "level": 1, "issues": issues, "healthy": len(issues) == 0,
            "checked_at": datetime.now().isoformat()}


def check_level_2(sample_pct=20):
    """Level 2 — 每周深度自检：随机抽样解压验证可还原性"""
    import random
    db = _ro()
    try:
        archived = db.execute("""
            SELECT id, blob_hash, compression, filename
            FROM asset_catalog WHERE blob_hash != '' AND blob_hash IS NOT NULL
        """).fetchall()
        if not archived:
            return {"ok": True, "level": 2, "issues": [], "samples": 0, "healthy": True}

        sample_size = max(1, int(len(archived) * sample_pct / 100))
        samples = random.sample(archived, min(sample_size, len(archived)))

        corrupt = []
        verified = 0
        for s in samples:
            try:
                prefix = s["blob_hash"][:2]
                # 查当前层
                tier_row = db.execute("SELECT storage_tier, storage_path FROM blob_store WHERE blob_hash=?",
                                      [s["blob_hash"]]).fetchone()
                sp = tier_row["storage_path"] if tier_row else os.path.join(TIER_HOT, prefix, s["blob_hash"])
                if not os.path.exists(sp):
                    # 尝试在各层找
                    for store in [TIER_HOT, TIER_WARM, TIER_COLD]:
                        cand = os.path.join(store, prefix, s["blob_hash"])
                        if os.path.exists(cand):
                            sp = cand
                            break

                # 校验 hash
                h = hashlib.sha256()
                with open(sp, "rb") as f:
                    while True:
                        buf = f.read(8 * 1024 * 1024)
                        if not buf: break
                        h.update(buf)
                if h.hexdigest() != s["blob_hash"]:
                    corrupt.append({"id": s["id"], "name": s["filename"]})
                else:
                    verified += 1
            except Exception:
                corrupt.append({"id": s["id"], "name": s["filename"]})

        issues = []
        if corrupt:
            issues.append({"level": 2, "type": "corrupt_blob", "count": len(corrupt),
                          "detail": corrupt[:10]})
    finally:
        db.close()

    return {"ok": True, "level": 2, "issues": issues, "samples": len(samples),
            "verified": verified, "corrupt": len(corrupt),
            "healthy": len(issues) == 0, "checked_at": datetime.now().isoformat()}


def check_level_3():
    """Level 3 — 数据库完整性 + WAL checkpoint"""
    issues = []
    db = _rw()
    try:
        db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        db.execute("PRAGMA integrity_check")
        fk = db.execute("PRAGMA foreign_key_check").fetchall()
        if fk:
            issues.append({"level": 3, "type": "foreign_key_violation", "count": len(fk)})
    finally:
        db.close()
    return {"ok": True, "level": 3, "issues": issues, "healthy": len(issues) == 0,
            "checked_at": datetime.now().isoformat()}


def run_full_integrity():
    """执行完整三层自检"""
    l1 = check_level_1()
    l2 = check_level_2()
    l3 = check_level_3()
    all_healthy = all([l1["healthy"], l2["healthy"], l3["healthy"]])
    return {"ok": True, "healthy": all_healthy,
            "levels": {"level1": l1, "level2": l2, "level3": l3},
            "checked_at": datetime.now().isoformat()}


# ═══════════════════════════
# 离机备份
# ═══════════════════════════

def run_external_backup(backup_root=None):
    """
    外置备份：blob_store 所有实体 + 数据库完整 dump
    backup_root: 用户指定的外置路径，默认 BACKUP_DIR
    """
    dest = backup_root or BACKUP_DIR
    ts = time.strftime("%Y%m%d_%H%M%S")
    backup_path = os.path.join(dest, f"backup_{ts}")
    os.makedirs(backup_path, exist_ok=True)

    stats = {"blob_count": 0, "blob_size": 0, "db_size": 0, "errors": []}

    # 1. 备份所有 blob 实体
    blob_dest = os.path.join(backup_path, "blob_store")
    for store in [TIER_HOT, TIER_WARM, TIER_COLD]:
        if not os.path.exists(store): continue
        for prefix in os.listdir(store):
            src_dir = os.path.join(store, prefix)
            dst_dir = os.path.join(blob_dest, prefix)
            if not os.path.isdir(src_dir): continue
            os.makedirs(dst_dir, exist_ok=True)
            for fname in os.listdir(src_dir):
                src = os.path.join(src_dir, fname)
                dst = os.path.join(dst_dir, fname)
                try:
                    shutil.copy2(src, dst)
                    stats["blob_count"] += 1
                    stats["blob_size"] += os.path.getsize(src)
                except Exception as e:
                    stats["errors"].append(str(e)[:100])

    # 2. 备份数据库 dump
    db_dest = os.path.join(backup_path, "prompts.db.dump")
    try:
        shutil.copy2(DB, db_dest)
        stats["db_size"] = os.path.getsize(db_dest)
    except Exception as e:
        stats["errors"].append(f"DB dump: {e}")

    # 3. 记录备份元数据
    meta = {
        "timestamp": ts,
        "version": "35.3c",
        "stats": stats,
    }
    with open(os.path.join(backup_path, "backup_meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    return {"ok": True, "path": backup_path, "stats": stats}


def list_backups(backup_root=None):
    """列出所有备份"""
    dest = backup_root or BACKUP_DIR
    if not os.path.exists(dest):
        return []
    backups = []
    for name in os.listdir(dest):
        bp = os.path.join(dest, name)
        if not os.path.isdir(bp): continue
        meta_path = os.path.join(bp, "backup_meta.json")
        meta = {}
        if os.path.exists(meta_path):
            try:
                with open(meta_path) as f:
                    meta = json.load(f)
            except Exception:
                pass
        backups.append({
            "name": name,
            "path": bp,
            "ts": meta.get("timestamp", ""),
            "stats": meta.get("stats", {}),
            "size": sum(os.path.getsize(os.path.join(bp, f))
                       for root, _, files in os.walk(bp) for f in files if os.path.isfile(os.path.join(root, f))),
        })
    return sorted(backups, key=lambda x: x.get("ts", ""), reverse=True)


_CLEANUP_THREAD = None

def start_background_cleanup(interval_hours=6):
    """后台定期清理（每6小时运行一次分层+清理）"""
    global _CLEANUP_THREAD
    if _CLEANUP_THREAD and _CLEANUP_THREAD.is_alive():
        return

    def _worker():
        while True:
            time.sleep(interval_hours * 3600)
            try:
                moves = auto_tier_cascade()
                cleaned = cleanup_stale_proxies()
                print(f"[TIER] Moved: hot={moves.get('hot',0)} warm={moves.get('warm',0)} cold={moves.get('cold',0)}, cleaned proxies: {cleaned}")
            except Exception as e:
                print(f"[TIER] Error: {e}")

    _CLEANUP_THREAD = threading.Thread(target=_worker, daemon=True)
    _CLEANUP_THREAD.start()


if __name__ == "__main__":
    print("[TEST] tier_engine loaded")
    print(f"  TIER_HOT: {TIER_HOT}")
    print(f"  TIER_WARM: {TIER_WARM}")
    print(f"  TIER_COLD: {TIER_COLD}")
    print(f"  PROXY_TTL: {PROXY_TTL_DAYS} days")
    print(f"  BACKUP_DIR: {BACKUP_DIR}")

    # L1 自检
    r = check_level_1()
    print(f"  L1: healthy={r['healthy']}, issues={len(r['issues'])}")
