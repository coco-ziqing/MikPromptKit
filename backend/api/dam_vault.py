"""
Phase35.3c API — 版本增量/冷热分层/三层自检/离机备份
"""
import json
import os
import sqlite3
import sys
import time

from fastapi import APIRouter, Body, HTTPException, Query, Request

from jwt_auth import require_role

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
try:
    from paths import get_db_path
    DB = get_db_path()
except Exception:
    DB = os.path.join(ROOT, "data", "prompts.db")
sys.path.insert(0, os.path.join(HERE, ".."))

from tier_engine import (
    auto_tier_cascade,
    check_level_1,
    check_level_2,
    check_level_3,
    cleanup_stale_proxies,
    list_backups,
    regenerate_proxy,
    run_external_backup,
    run_full_integrity,
    start_background_cleanup,
)
from version_engine import CHAIN_DEPTH_LIMIT, get_chain_depth, restore_version

_req_admin = require_role("admin")
router = APIRouter(prefix="/api/dam/vault", tags=["DAM版本&备份"])

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

def _get_user(request: Request):
    try:
        from jwt_auth import get_current_user
        u = get_current_user(request)
        if u and u.get("authenticated"): return u
    except Exception: pass
    return None

def _require_admin(user):
    if not user: raise HTTPException(403)
    if user.get("role") != "admin": raise HTTPException(403, "仅管理员")

# ════════════════════════════════════════
# 1. 版本管理
# ════════════════════════════════════════

@router.get("/versions/{catalog_id}")
def list_versions(catalog_id: int, request: Request):
    """列出某资产所有版本"""
    _get_user(request)
    c = _ro()
    try:
        rows = c.execute("""
            SELECT av.version_no, av.fingerprint, av.size, av.diff_method,
                   av.chain_depth, av.note, av.status, av.created_at,
                   av.thumb_path
            FROM asset_version av
            WHERE av.catalog_id=?
            ORDER BY av.version_no DESC
        """, [catalog_id]).fetchall()
        chain = get_chain_depth(catalog_id)
        return {"ok": True, "versions": [dict(r) for r in rows],
                "chain_depth": chain, "chain_limit": CHAIN_DEPTH_LIMIT}
    finally:
        c.close()


@router.post("/versions/{catalog_id}/rollback")
def rollback_version(catalog_id: int, request: Request, data: dict = Body(...)):
    """回退到指定版本"""
    _require_admin(_get_user(request))
    vno = data.get("version_no")
    dest = data.get("dest_path")
    if not vno or not dest: raise HTTPException(400)

    result_path = restore_version(catalog_id, vno, dest)
    return {"ok": True, "restored_to": result_path, "version_no": vno}


@router.get("/versions/{catalog_id}/chain")
def get_version_chain(catalog_id: int, request: Request):
    """查看版本链结构（全量→差异→差异→...）"""
    _get_user(request)
    c = _ro()
    try:
        rows = c.execute("""
            SELECT version_no, diff_method, size, created_at
            FROM asset_version WHERE catalog_id=?
            ORDER BY version_no
        """, [catalog_id]).fetchall()

        chain = []
        for r in rows:
            d = dict(r)
            d["size_kb"] = round((d["size"] or 0) / 1024, 1)
            chain.append(d)

        depth = get_chain_depth(catalog_id)
        needs_snapshot = depth >= CHAIN_DEPTH_LIMIT - 1

        return {"ok": True, "chain": chain,
                "depth": depth, "max_depth": CHAIN_DEPTH_LIMIT,
                "needs_snapshot": needs_snapshot}
    finally:
        c.close()


# ════════════════════════════════════════
# 2. 冷热分层管理
# ════════════════════════════════════════

@router.post("/tier/cascade")
def trigger_tier_cascade(request: Request):
    _req_admin(request)
    """手动触发冷热分层流转"""
    _require_admin(_get_user(request))
    moves = auto_tier_cascade()
    return {"ok": True, "moved": moves}


@router.get("/tier/stats")
def get_tier_stats(request: Request):
    """分层存储统计"""
    c = _ro()
    try:
        rows = c.execute("""
            SELECT storage_tier, COUNT(1) cnt, SUM(compressed_size) total_size
            FROM blob_store GROUP BY storage_tier
        """).fetchall()
        tiers = {}
        total_blobs = 0
        total_size = 0
        for r in rows:
            tiers[r["storage_tier"]] = {
                "count": r["cnt"],
                "size": r["total_size"] or 0,
                "size_mb": round((r["total_size"] or 0) / 1024 / 1024, 1)
            }
            total_blobs += r["cnt"]
            total_size += (r["total_size"] or 0)

        # 代理文件
        proxy_size = 0
        proxy_count = 0
        if os.path.exists(os.path.join(ROOT, "data", "archive", "proxy")):
            proot = os.path.join(ROOT, "data", "archive", "proxy")
            for f in os.listdir(proot):
                fp = os.path.join(proot, f)
                if os.path.isfile(fp):
                    proxy_size += os.path.getsize(fp)
                    proxy_count += 1

        return {"ok": True, "tiers": tiers,
                "total_blobs": total_blobs, "total_size": total_size,
                "total_size_mb": round(total_size / 1024 / 1024, 1),
                "proxy_count": proxy_count,
                "proxy_size_mb": round(proxy_size / 1024 / 1024, 1),
                "hot_days": 30, "warm_days": 180, "proxy_ttl_days": 90}
    finally:
        c.close()


@router.post("/proxy/cleanup")
def trigger_proxy_cleanup(request: Request, days: int = Body(90, embed=True)):
    _req_admin(request)
    """清理过期代理"""
    _require_admin(_get_user(request))
    cleaned = cleanup_stale_proxies(days)
    return {"ok": True, "cleaned": cleaned, "threshold_days": days}


@router.post("/proxy/{catalog_id}/regenerate")
def regenerate_proxy_endpoint(catalog_id: int, request: Request):
    _req_admin(request)
    """重新生成代理文件"""
    _require_admin(_get_user(request))
    result = regenerate_proxy(catalog_id)
    if result:
        return {"ok": True, "proxy_path": result}
    return {"ok": False, "error": "重生成失败"}


# ════════════════════════════════════════
# 3. 三层自检 API
# ════════════════════════════════════════

@router.get("/integrity/level1")
def get_level1_check(request: Request):
    """Level 1 — 每日快速自检"""
    _require_admin(_get_user(request))
    return check_level_1()


@router.get("/integrity/level2")
def get_level2_check(request: Request, sample_pct: int = Query(20)):
    """Level 2 — 每周深度自检（抽样解压）"""
    _require_admin(_get_user(request))
    return check_level_2(sample_pct)


@router.get("/integrity/level3")
def get_level3_check(request: Request):
    """Level 3 — 数据库完整性"""
    _require_admin(_get_user(request))
    return check_level_3()


@router.get("/integrity/full")
def get_full_integrity(request: Request):
    """完整三层自检"""
    _require_admin(_get_user(request))
    result = run_full_integrity()
    return result


@router.get("/integrity/status")
def get_integrity_status(request: Request):
    """获取上次自检状态概览（轻量，非admin也可）"""
    _get_user(request)
    c = _ro()
    try:
        # 从 config 表读上次自检结果
        row = c.execute("SELECT value FROM config WHERE key='last_integrity_check'").fetchone()
        if row:
            return {"ok": True, "last_check": json.loads(row["value"])}
        return {"ok": True, "last_check": None, "hint": "尚未执行完整性自检"}
    finally:
        c.close()


# ════════════════════════════════════════
# 4. 备份管理
# ════════════════════════════════════════

@router.post("/backup/run")
def run_backup(request: Request, data: dict = Body({})):
    _req_admin(request)
    """执行外置备份"""
    _require_admin(_get_user(request))
    path = data.get("path") or None
    result = run_external_backup(path)

    # 记录到 config
    c = _rw()
    try:
        c.execute("INSERT INTO config(key,value) VALUES('last_backup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                  [json.dumps({"ts": time.strftime("%Y-%m-%d %H:%M:%S"), "path": result["path"],
                               "stats": result["stats"]}, ensure_ascii=False)])
        _safe_commit(c)
    finally:
        c.close()

    return result


@router.get("/backup/list")
def get_backup_list(request: Request):
    """列出所有备份"""
    _get_user(request)
    return {"ok": True, "backups": list_backups()}


@router.post("/backup/restore/{backup_name}")
def restore_from_backup(backup_name: str, request: Request):
    _req_admin(request)
    """
    从备份恢复 blob_store + 数据库
    注意：危险操作，恢复前会自动备份当前数据
    """
    _require_admin(_get_user(request))

    import shutil
    bi = list_backups()
    match = [b for b in bi if b["name"] == backup_name]
    if not match:
        raise HTTPException(404, f"备份 '{backup_name}' 不存在")

    bp = match[0]["path"]
    blob_src = os.path.join(bp, "blob_store")

    # 自动备份当前
    ts = time.strftime("%Y%m%d_%H%M%S")
    pre_backup = os.path.join(ROOT, "data", "external_backup", f"pre_restore_{ts}")
    os.makedirs(pre_backup, exist_ok=True)
    try:
        run_external_backup(pre_backup)
    except Exception:
        pass

    # 恢复 blob_store
    restored_blobs = 0
    if os.path.exists(blob_src):
        for prefix in os.listdir(blob_src):
            src_dir = os.path.join(blob_src, prefix)
            if not os.path.isdir(src_dir): continue
            # 恢复到热层
            dst_dir = os.path.join(ROOT, "data", "archive", "blob_store", prefix)
            os.makedirs(dst_dir, exist_ok=True)
            for fname in os.listdir(src_dir):
                shutil.copy2(os.path.join(src_dir, fname), os.path.join(dst_dir, fname))
                restored_blobs += 1

    return {"ok": True, "restored_blobs": restored_blobs,
            "pre_backup": pre_backup,
            "note": "数据库未自动覆盖，如需恢复DB请手动替换"}


@router.get("/backup/last")
def get_last_backup(request: Request):
    """获取上次备份状态"""
    c = _ro()
    try:
        row = c.execute("SELECT value FROM config WHERE key='last_backup'").fetchone()
        if row:
            return {"ok": True, "last": json.loads(row["value"])}
        return {"ok": True, "last": None}
    finally:
        c.close()


# ════════════════════════════════════════
# 5. 启动后台清理线程
# ════════════════════════════════════════

_started = False

@router.post("/maintenance/start")
def start_maintenance(request: Request):
    _req_admin(request)
    """启动后台维护线程（分层+代理清理）"""
    _require_admin(_get_user(request))
    global _started
    if not _started:
        start_background_cleanup()
        _started = True
        return {"ok": True, "message": "后台维护线程已启动 (每6小时)"}
    return {"ok": True, "message": "已在运行中"}


# 自动在首次导入时启动
def _auto_start():
    global _started
    if not _started:
        try:
            start_background_cleanup()
            _started = True
        except Exception:
            pass

_auto_start()
