"""
Phase35.3-DAM 归档管理 API
- 归档（拷贝+压缩+去重+代理）  - 还原  - 搜索
- 项目快照  - 归档策略  - 存储统计  - 通知
"""
import json
import os
import sqlite3
import sys
import time
from datetime import datetime

from fastapi import APIRouter, Body, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
try:
    from paths import get_db_path
    DB = get_db_path()
except Exception:
    DB = os.path.join(ROOT, "data", "prompts.db")
ARCHIVE_ROOT = os.path.join(ROOT, "data", "archive")
PROXY_ROOT = os.path.join(ARCHIVE_ROOT, "proxy")
os.makedirs(PROXY_ROOT, exist_ok=True)

sys.path.insert(0, os.path.join(HERE, ".."))
from archive_engine import TEMP_ROOT, do_full_archive, remove_from_blob_store, restore_from_blob

router = APIRouter(prefix="/api/dam", tags=["DAM归档管理"])

# ── DB 辅助 ──
def _rw():
    c = sqlite3.connect(DB, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=3000")
    return c

def _ro():
    c = sqlite3.connect(DB, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=3000")
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


def _req_admin(request: Request):
    """管理员权限校验（DAM 归档管理端点）"""
    u = _get_user(request)
    if not u or u.get("role") != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return u

# ════════════════════════════════════════
# 1. 归档上传（浏览器直接上传文件到资料库）
# ════════════════════════════════════════

@router.post("/archive")
async def archive_upload(
    request: Request,
    file: UploadFile = File(...),
    project_id: int = Header(..., alias="X-Project-Id"),
    module_key: str = Header("other", alias="X-Module-Key"),
    is_critical: int = Header(0, alias="X-Is-Critical"),
):
    user = _get_user(request)
    if not user: raise HTTPException(403, "请先登录")

    # 保存上传到临时
    fname = file.filename or "untitled"
    tmp = os.path.join(TEMP_ROOT, f"upload_{int(time.time()*1000)}_{fname}")
    os.makedirs(TEMP_ROOT, exist_ok=True)
    try:
        with open(tmp, "wb") as f:
            while True:
                chunk = await file.read(8 * 1024 * 1024)
                if not chunk: break
                f.write(chunk)
    except Exception as e:
        raise HTTPException(500, f"上传失败: {e}")

    # 完整归档
    result = do_full_archive(
        tmp, project_id, module_key,
        filename=fname, is_critical=is_critical,
        device_id=0, source_path=""
    )

    if not result["ok"]:
        raise HTTPException(500, result.get("error", "归档失败"))

    # 审计
    try:
        from audit import record_audit
        record_audit("asset_archive", detail=f"归档 {fname} -> project {project_id}", target_type="asset_catalog", target_id=result["catalog_id"])
    except Exception: pass

    # 通知
    _notify(user.get("id"), "文件已存入资料库",
            f"{fname} 已存入，压缩后 {result['compressed_size']}B (省{result['saved_pct']}%)",
            "success", "asset", result["catalog_id"])

    return {"ok": True, **result}


# ════════════════════════════════════════
# 2. 从设备索引归档（不在浏览器上传，设备已有）
# ════════════════════════════════════════

@router.post("/archive-from-device")
def archive_from_device(request: Request, data: dict = Body(...)):
    """
    从设备文件索引归档。
    适用场景：Agent 已上报文件索引，服务器请求 Agent 上传文件字节
    这里先创建 catalog + backup_task，等 Agent heartbeat 领任务上传
    body: {file_index_id, project_space_id, module_key, is_critical?}
    """
    user = _get_user(request)
    if not user: raise HTTPException(403)

    fid = data.get("file_index_id")
    psid = data.get("project_space_id")
    mod_key = data.get("module_key", "other")
    if not fid or not psid: raise HTTPException(400, "file_index_id + project_space_id 必填")

    c = _rw()
    try:
        fi = c.execute("SELECT * FROM device_file_index WHERE id=?", [fid]).fetchone()
        if not fi: raise HTTPException(404, "文件索引不存在")
        is_crit = int(data.get("is_critical", 0))

        # 建 catalog（先占位，等备份完成才 fill archive_path）
        c.execute("""INSERT INTO asset_catalog
            (project_space_id, module_key, filename, fingerprint, local_rel_path, size,
             source_device_id, source_path, is_critical, backup_status, status, frozen)
            VALUES (?,?,?,?,?,?, ?,?,?, 'pending', 'active', 0)""",
            [psid, mod_key, fi["filename"], fi["fingerprint"], fi["rel_path"],
             fi["size"], fi["device_id"], fi["rel_path"], is_crit])
        cat_id = c.execute("SELECT last_insert_rowid()").fetchone()[0]

        # 关联
        c.execute("UPDATE device_file_index SET state='archived', catalog_id=? WHERE id=?", [cat_id, fid])

        # 创建备份任务
        c.execute("""INSERT INTO backup_task(catalog_id, device_id, file_index_id, fingerprint, size, state)
                     VALUES (?,?,?,?,?,'pending')""",
                  [cat_id, fi["device_id"], fid, fi["fingerprint"], fi["size"] or 0])

        _safe_commit(c)
    finally: c.close()

    try:
        from audit import record_audit
        record_audit("asset_archive", detail=f"从设备归档 {fi['filename']}", target_type="asset_catalog", target_id=cat_id)
    except Exception: pass

    _notify(user.get("id"), "文件已标记待归档",
            f"{fi['filename']} 已登记，等待设备上传文件字节",
            "info", "backup_task", 0)

    return {"ok": True, "catalog_id": cat_id, "message": "已创建备份任务，等待 Agent 上传"}


# ════════════════════════════════════════
# 3. 还原（从资料库解压放回指定位置）
# ════════════════════════════════════════

@router.post("/assets/{catalog_id}/restore")
def restore_asset(catalog_id: int, request: Request, data: dict = Body(...)):
    """
    还原存档到指定路径。
    body: {dest_path} — 目标路径（可为原始位置或新位置）
    """
    user = _get_user(request)
    if not user: raise HTTPException(403)

    dest = data.get("dest_path", "").strip()
    if not dest: raise HTTPException(400, "dest_path 必填")

    c = _rw()
    try:
        ac = c.execute("SELECT * FROM asset_catalog WHERE id=?", [catalog_id]).fetchone()
        if not ac: raise HTTPException(404, "资产不存在")

        blob_hash = ac["blob_hash"] or ""
        compression = ac["compression"] or ""

        if not blob_hash or not ac["archive_path"]:
            raise HTTPException(400, "该资产尚未完成完整归档（无 blob 实体）")

        # 还原
        size = restore_from_blob(blob_hash, dest, compression)

        # 更新访问时间
        c.execute("UPDATE blob_store SET last_accessed_at=datetime('now','localtime') WHERE blob_hash=?", [blob_hash])
        _safe_commit(c)
    finally: c.close()

    _notify(user.get("id"), "文件已还原",
            f"从资料库还原: {ac['filename']} → {dest}",
            "success", "asset", catalog_id)

    return {"ok": True, "dest_path": dest, "size": size}


# ════════════════════════════════════════
# 4. 代理/预览文件下载
# ════════════════════════════════════════

@router.get("/assets/{catalog_id}/proxy")
def get_asset_proxy(catalog_id: int, request: Request):
    c = _ro()
    try:
        ac = c.execute("SELECT proxy_path, filename FROM asset_catalog WHERE id=?", [catalog_id]).fetchone()
        if not ac: raise HTTPException(404)
        if not ac["proxy_path"]: raise HTTPException(404, "无代理文件")

        full = os.path.join(PROXY_ROOT, os.path.basename(ac["proxy_path"]))
        if not os.path.exists(full): raise HTTPException(404, "代理文件实体不存在")

        return FileResponse(full, filename=ac["proxy_path"].replace("\\", "/").split("/")[-1])
    finally:
        c.close()


@router.get("/assets/{catalog_id}/file")
def get_asset_file(catalog_id: int, request: Request):
    """下载原始文件（从 blob_store 解压后返回，仅限已完整归档的）"""
    user = _get_user(request)
    if not user: raise HTTPException(403)

    c = _rw()
    try:
        ac = c.execute("SELECT * FROM asset_catalog WHERE id=?", [catalog_id]).fetchone()
        if not ac: raise HTTPException(404)
        if not ac["blob_hash"]: raise HTTPException(400, "无完整存档")

        # 还原到临时文件
        tmp_out = os.path.join(TEMP_ROOT, f"download_{int(time.time()*1000)}_{ac['filename']}")
        restore_from_blob(ac["blob_hash"], tmp_out, ac["compression"] or "")

        # 更新访问时间
        c.execute("UPDATE blob_store SET last_accessed_at=datetime('now','localtime') WHERE blob_hash=?", [ac["blob_hash"]])
        _safe_commit(c)

        return FileResponse(tmp_out, filename=ac["filename"],
                            background=lambda: (time.sleep(60), os.path.exists(tmp_out) and os.remove(tmp_out)))
    finally:
        c.close()


# ════════════════════════════════════════
# 5. 资产浏览 / 搜索
# ════════════════════════════════════════

@router.get("/assets")
def browse_assets(request: Request,
                  project_id: int = Query(None),
                  module_key: str = Query(None),
                  state: str = Query(None),
                  search: str = Query(None),
                  file_type: str = Query(None),
                  is_critical: int = Query(None),
                  device_id: int = Query(None),
                  limit: int = Query(50, ge=1, le=500),
                  offset: int = Query(0, ge=0),
                  sort: str = Query("recent")):
    user = _get_user(request)
    if not user: raise HTTPException(403)

    c = _ro()
    try:
        where, params = [], []

        # 权限过滤：admin看全部，其他看自己的
        if user.get("role") != "admin":
            # 共享项目 + 自己的项目
            where.append("""(ac.project_space_id IN (
                SELECT ps.id FROM project_space ps
                LEFT JOIN project_space_member psm ON ps.id=psm.project_space_id AND psm.user_id=?
                WHERE ps.visibility='shared' OR ps.owner_user_id=? OR psm.user_id IS NOT NULL
            ))""")
            params += [user["id"], user["id"]]

        if project_id:
            where.append("ac.project_space_id=?"); params.append(project_id)
        if module_key:
            where.append("ac.module_key=?"); params.append(module_key)
        if state:
            where.append("ac.status=?"); params.append(state)
        if search:
            where.append("(ac.filename LIKE ? OR ac.metadata_json LIKE ?)")
            params += [f"%{search}%", f"%{search}%"]
        if is_critical is not None:
            where.append("ac.is_critical=?"); params.append(is_critical)
        if device_id is not None:
            where.append("ac.source_device_id=?"); params.append(device_id)

        w = ("WHERE " + " AND ".join(where)) if where else ""

        sort_map = {
            "recent": "ac.created_at DESC",
            "oldest": "ac.created_at ASC",
            "name": "ac.filename ASC",
            "size": "ac.compressed_size DESC",
        }
        order = sort_map.get(sort, "ac.created_at DESC")

        total = c.execute(f"SELECT COUNT(1) n FROM asset_catalog ac {w}", params).fetchone()["n"]
        rows = c.execute(f"""
            SELECT ac.*, ps.name project_name
            FROM asset_catalog ac
            LEFT JOIN project_space ps ON ac.project_space_id=ps.id
            {w}
            ORDER BY {order}
            LIMIT ? OFFSET ?
        """, params + [limit, offset]).fetchall()

        items = []
        for r in rows:
            d = dict(r)
            d["saved_pct"] = round((1 - (d.get("compressed_size",0) or 0)/max(d.get("original_size",1) or 1, 1)) * 100, 1)
            items.append(d)

        return {"ok": True, "items": items, "total": total, "limit": limit, "offset": offset}
    finally:
        c.close()


@router.get("/assets/{catalog_id}")
def get_asset_detail(catalog_id: int, request: Request):
    c = _ro()
    try:
        ac = c.execute("SELECT ac.*, ps.name project_name FROM asset_catalog ac LEFT JOIN project_space ps ON ac.project_space_id=ps.id WHERE ac.id=?", [catalog_id]).fetchone()
        if not ac: raise HTTPException(404)

        d = dict(ac)
        d["saved_pct"] = round((1 - (d.get("compressed_size",0) or 0)/max(d.get("original_size",1) or 1, 1)) * 100, 1)

        # 引用追踪
        refs = []
        if d.get("blob_hash"):
            refs = [dict(r) for r in c.execute("""
                SELECT ac2.id, ac2.filename, ac2.project_space_id, ps2.name project_name
                FROM asset_catalog ac2
                LEFT JOIN project_space ps2 ON ac2.project_space_id=ps2.id
                WHERE ac2.blob_hash=? AND ac2.id!=?
            """, [d["blob_hash"], catalog_id]).fetchall()]
        d["referenced_by"] = refs

        return {"ok": True, "item": d}
    finally:
        c.close()


@router.delete("/assets/{catalog_id}")
def delete_asset(catalog_id: int, request: Request):
    _req_admin(request)
    user = _get_user(request)
    if not user: raise HTTPException(403)

    c = _rw()
    try:
        ac = c.execute("SELECT * FROM asset_catalog WHERE id=?", [catalog_id]).fetchone()
        if not ac: raise HTTPException(404)

        # 重要资产需二次确认
        if ac["is_critical"] and not (request.headers.get("X-Confirm-Delete") == "true"):
            raise HTTPException(409, "重要资产，请确认删除（设置 X-Confirm-Delete: true）")

        # 引用检查
        ref_count = c.execute("SELECT COUNT(1) FROM asset_catalog WHERE blob_hash=? AND blob_hash!='' AND id!=?",
                              [ac["blob_hash"] or "", catalog_id]).fetchone()[0]
        if ref_count > 0:
            # 只删引用，不删 blob 实体
            pass
        else:
            remove_from_blob_store(ac["blob_hash"] or "")

        # 清理代理
        if ac["proxy_path"]:
            proxy_full = os.path.join(PROXY_ROOT, os.path.basename(ac["proxy_path"]))
            if os.path.exists(proxy_full):
                os.remove(proxy_full)

        c.execute("DELETE FROM asset_catalog WHERE id=?", [catalog_id])
        _safe_commit(c)
    finally: c.close()

    try:
        from audit import record_audit
        record_audit("asset_delete", detail=f"删除资产 {ac['filename']}", target_type="asset_catalog", target_id=catalog_id)
    except Exception: pass

    return {"ok": True}


# ════════════════════════════════════════
# 6. 项目快照
# ════════════════════════════════════════

@router.post("/projects/{project_id}/snapshot")
def create_snapshot(project_id: int, request: Request, data: dict = Body(...)):
    _req_admin(request)
    """创建项目快照：记录此刻该项目下所有资产版本指针"""
    user = _get_user(request)
    if not user: raise HTTPException(403)

    snap_name = data.get("name", datetime.now().strftime("%Y-%m-%d %H:%M 快照"))

    c = _rw()
    try:
        assets = c.execute("SELECT id, current_version_id FROM asset_catalog WHERE project_space_id=? AND status='active'",
                           [project_id]).fetchall()
        ver_map = {str(r["id"]): r["current_version_id"] for r in assets}

        c.execute("INSERT INTO project_snapshot(project_space_id, name, asset_version_map, created_by) VALUES (?,?,?,?)",
                  [project_id, snap_name, json.dumps(ver_map, ensure_ascii=False), user["id"]])
        sid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
        _safe_commit(c)

        return {"ok": True, "snapshot_id": sid, "name": snap_name, "asset_count": len(assets)}
    finally: c.close()


@router.get("/projects/{project_id}/snapshots")
def list_snapshots(project_id: int, request: Request):
    c = _ro()
    try:
        rows = c.execute("SELECT * FROM project_snapshot WHERE project_space_id=? ORDER BY created_at DESC",
                         [project_id]).fetchall()
        return {"ok": True, "snapshots": [dict(r) for r in rows]}
    finally:
        c.close()


@router.post("/projects/{project_id}/snapshots/{snap_id}/restore")
def restore_snapshot(project_id: int, snap_id: int, request: Request):
    _req_admin(request)
    """恢复快照：回退所有资产到快照记录的版本"""
    user = _get_user(request)
    if not user: raise HTTPException(403)

    c = _rw()
    try:
        snap = c.execute("SELECT * FROM project_snapshot WHERE id=? AND project_space_id=?",
                         [snap_id, project_id]).fetchone()
        if not snap: raise HTTPException(404)
        ver_map = json.loads(snap["asset_version_map"] or "{}")

        restored, skipped = 0, 0
        for cat_id_str, ver_id in ver_map.items():
            if ver_id is None: continue
            cat_id = int(cat_id_str)
            # 验证版本存在
            ver = c.execute("SELECT id FROM asset_version WHERE id=? AND catalog_id=?", [ver_id, cat_id]).fetchone()
            if ver:
                c.execute("UPDATE asset_catalog SET current_version_id=? WHERE id=?", [ver_id, cat_id])
                restored += 1
            else:
                skipped += 1

        _safe_commit(c)
    finally: c.close()

    return {"ok": True, "restored": restored, "skipped": skipped}


# ════════════════════════════════════════
# 7. 归档策略
# ════════════════════════════════════════

@router.get("/policy")
def get_policy(project_id: int = Query(None)):
    """获取归档策略（全局 或 项目级）"""
    c = _ro()
    try:
        row = c.execute("SELECT * FROM archive_policy WHERE project_space_id IS ? ORDER BY id LIMIT 1",
                        [project_id]).fetchone()
        if not row and project_id is not None:
            # fallback to global
            row = c.execute("SELECT * FROM archive_policy WHERE project_space_id IS NULL LIMIT 1").fetchone()
        if not row:
            return {"ok": True, "policy": None}
        return {"ok": True, "policy": dict(row)}
    finally:
        c.close()


@router.put("/policy")
def update_policy(request: Request, data: dict = Body(...)):
    _req_admin(request)
    """更新归档策略"""
    user = _get_user(request)
    if not user: raise HTTPException(403)

    psid = data.get("project_space_id")
    c = _rw()
    try:
        existing = c.execute("SELECT id FROM archive_policy WHERE project_space_id IS ? LIMIT 1",
                             [psid]).fetchone()
        fields = ["compression_level", "generate_proxy", "video_proxy", "image_thumb",
                  "audio_proxy", "version_retention", "version_max_count", "storage_limit_gb",
                  "auto_archive_enabled", "auto_archive_rules_json"]
        if existing:
            sets = [f"{f}=?" for f in fields if f in data]
            vals = [data[f] for f in fields if f in data]
            if sets:
                sets.append("updated_at=datetime('now','localtime')")
                c.execute(f"UPDATE archive_policy SET {','.join(sets)} WHERE id=?",
                          vals + [existing["id"]])
        else:
            insert_cols, insert_vals = [], []
            for f in fields:
                if f in data:
                    insert_cols.append(f); insert_vals.append(data[f])
            if psid is not None:
                insert_cols.append("project_space_id"); insert_vals.append(psid)
            c.execute(f"INSERT INTO archive_policy ({','.join(insert_cols)}) VALUES ({','.join(['?']*len(insert_vals))})",
                      insert_vals)
        _safe_commit(c)
        return {"ok": True}
    finally: c.close()


# ════════════════════════════════════════
# 8. 存储统计
# ════════════════════════════════════════

@router.get("/storage")
def get_storage_stats(request: Request):
    c = _ro()
    try:
        # blob_store 统计
        bs = c.execute("SELECT COUNT(1) cnt, SUM(compressed_size) size, COUNT(DISTINCT blob_hash) uniq FROM blob_store").fetchone()
        # asset_catalog 统计
        ac = c.execute("SELECT COUNT(1) cnt, SUM(compressed_size) csize, SUM(original_size) osize FROM asset_catalog WHERE blob_hash!=''").fetchone()
        # 代理占用
        proxy_size = 0
        proxy_count = 0
        if os.path.exists(PROXY_ROOT):
            for f in os.listdir(PROXY_ROOT):
                fp = os.path.join(PROXY_ROOT, f)
                if os.path.isfile(fp):
                    proxy_size += os.path.getsize(fp)
                    proxy_count += 1

        total_saved = (ac["osize"] or 0) - (ac["csize"] or 0)

        return {"ok": True, "stats": {
            "blob_count": bs["cnt"] or 0,
            "blob_unique": bs["uniq"] or 0,
            "blob_size": bs["size"] or 0,
            "catalog_count": ac["cnt"] or 0,
            "compressed_size": ac["csize"] or 0,
            "original_size": ac["osize"] or 0,
            "space_saved": total_saved,
            "space_saved_pct": round(total_saved / max(ac["osize"] or 1, 1) * 100, 1),
            "proxy_count": proxy_count,
            "proxy_size": proxy_size,
            "total_archive_size": (ac["csize"] or 0) + proxy_size,
        }}
    finally:
        c.close()


# ════════════════════════════════════════
# 9. 完整性自检（简易版）
# ════════════════════════════════════════

@router.get("/integrity-check")
def integrity_check(request: Request):
    user = _get_user(request)
    if not user: raise HTTPException(403)
    if user.get("role") != "admin": raise HTTPException(403, "仅管理员")

    issues = []
    c = _ro()
    try:
        # 检查 blob 实体存在性
        blobs = c.execute("SELECT blob_hash, storage_path, compression FROM blob_store").fetchall()
        missing_blob = []
        for b in blobs:
            if b["storage_path"] and not os.path.exists(b["storage_path"]):
                missing_blob.append(b["blob_hash"][:16] + "...")
        if missing_blob:
            issues.append({"type": "missing_blob", "count": len(missing_blob), "samples": missing_blob[:5]})

        # 检查 catalog 指向的 blob 是否存在
        cats = c.execute("SELECT id, blob_hash, filename FROM asset_catalog WHERE blob_hash!=''").fetchall()
        orphan_cat = []
        for ac_row in cats:
            prefix = ac_row["blob_hash"][:2]
            sp = os.path.join(os.path.join(ROOT, "data", "archive", "blob_store", prefix), ac_row["blob_hash"])
            if not os.path.exists(sp):
                orphan_cat.append(f"#{ac_row['id']} {ac_row['filename']}")
        if orphan_cat:
            issues.append({"type": "orphan_catalog", "count": len(orphan_cat), "samples": orphan_cat[:5]})

        return {"ok": True, "issues": issues, "healthy": len(issues) == 0}
    finally:
        c.close()


# ════════════════════════════════════════
# 10. 通知
# ════════════════════════════════════════

def _notify(user_id, title, message, category="info", target_type="", target_id=0):
    """内部通知写入"""
    try:
        c = _rw()
        try:
            c.execute("""INSERT INTO sys_notifications(user_id, title, message, category, target_type, target_id)
                         VALUES (?,?,?,?,?,?)""",
                      [user_id, title, message, category, target_type, target_id])
            _safe_commit(c)
        finally: c.close()
    except Exception:
        pass


@router.get("/notifications")
def get_notifications(request: Request,
                      is_read: int = Query(None),
                      limit: int = Query(20, ge=1, le=100)):
    user = _get_user(request)
    if not user: raise HTTPException(403)

    c = _ro()
    try:
        where = ["user_id=?"]; params = [user["id"]]
        if is_read is not None:
            where.append("is_read=?"); params.append(is_read)
        w = "WHERE " + " AND ".join(where)
        rows = c.execute(f"SELECT * FROM sys_notifications {w} ORDER BY created_at DESC LIMIT ?",
                         params + [limit]).fetchall()
        unread = c.execute("SELECT COUNT(1) FROM sys_notifications WHERE user_id=? AND is_read=0",
                           [user["id"]]).fetchone()[0]
        return {"ok": True, "items": [dict(r) for r in rows], "unread": unread}
    finally:
        c.close()


@router.put("/notifications/{nid}/read")
def mark_notification_read(nid: int, request: Request):
    user = _get_user(request)
    if not user: raise HTTPException(403)
    c = _rw()
    try:
        c.execute("UPDATE sys_notifications SET is_read=1 WHERE id=? AND user_id=?", [nid, user["id"]])
        _safe_commit(c)
        return {"ok": True}
    finally: c.close()


@router.put("/notifications/read-all")
def mark_all_read(request: Request):
    user = _get_user(request)
    if not user: raise HTTPException(403)
    c = _rw()
    try:
        c.execute("UPDATE sys_notifications SET is_read=1 WHERE user_id=?", [user["id"]])
        _safe_commit(c)
        return {"ok": True}
    finally: c.close()
