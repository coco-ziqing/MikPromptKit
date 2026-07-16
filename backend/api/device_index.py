# -*- coding: utf-8 -*-
"""
Phase35.3 — 设备盘索引 API（Agent通道 + 管理通道）

Agent 通道：/api/device/* （X-Device-Token 鉴权，独立于 JWT）
  设备端调用：注册配对码 → 拿 token → 心跳/上报索引/分块上传备份

管理通道：/api/devices/* （JWT，owner 管自己 / admin 管全部）
  WebUI 管理面板：设备列表/配对码/监控路径/文件索引/归档/告警
"""
import os, sys, sqlite3, json, time, threading, hashlib, random, string, shutil, socket
from datetime import datetime
from fastapi import APIRouter, Request, HTTPException, Query, Body, Header
from fastapi.responses import JSONResponse
from typing import Optional
from jwt_auth import require_role

# ── 路径 ──
HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "..", "data", "prompts.db")
BACKUP_ROOT = os.path.join(HERE, "..", "..", "data", "backup_store")
os.makedirs(BACKUP_ROOT, exist_ok=True)

# ── 双路由 ──
agent_router = APIRouter(prefix="/api/device", tags=["设备Agent"])
from fastapi import Depends
mgmt_router  = APIRouter(prefix="/api/devices", tags=["设备管理面板"], dependencies=[Depends(require_role("admin"))])

# ── DB 辅助 ──
def _rw():
    c = sqlite3.connect(DB, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=3000")
    return c

def _ro():
    # 独立只读连接（避免跨模块共享连接关闭问题）
    c = sqlite3.connect(DB, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=3000")
    c.execute("PRAGMA query_only=ON")
    return c

def _safe_commit(c):
    for i in range(5):
        try:
            c.commit(); return
        except sqlite3.OperationalError:
            if i == 4: raise
            time.sleep(0.05*(i+1))

# ── 配对码（config 表，5分钟有效） ──
def _gen_pair_code():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

def _store_pair_code(code):
    expires = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time()+300))
    c = _rw()
    try:
        c.execute("INSERT INTO config(key,value) VALUES('device_pair_code',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                  [json.dumps({"code":code,"expires":expires}, ensure_ascii=False)])
        _safe_commit(c)
    finally: c.close()

def _consume_pair_code(code) -> bool:
    c = _rw()
    try:
        row = c.execute("SELECT value FROM config WHERE key='device_pair_code'").fetchone()
        if not row: return False
        d = json.loads(row["value"])
        ok = (d.get("code") == code and d.get("expires","") >= time.strftime("%Y-%m-%d %H:%M:%S"))
        if ok:
            c.execute("DELETE FROM config WHERE key='device_pair_code'"); _safe_commit(c)
        return ok
    finally: c.close()

# ── Agent 鉴权 ──
def _device_auth(device_token: Optional[str] = Header(None)):
    if not device_token: raise HTTPException(401, "缺少 X-Device-Token")
    c = _ro()
    try:
        h = hashlib.sha256(device_token.encode()).hexdigest()
        d = c.execute("SELECT id, name, status FROM device WHERE token_hash=? AND status='active'", [h]).fetchone()
        if not d: raise HTTPException(401, "无效或已吊销的设备令牌")
        return dict(d)
    finally:
        # _ro() 可能是独立连接也可能共享，保险关闭独立连接
        if hasattr(c, 'close'): c.close()

# ── 用户鉴权辅助 ──
def _get_user(request: Request):
    try:
        from jwt_auth import get_current_user
        u = get_current_user(request)
        if u and u.get("authenticated"): return u
    except Exception: pass
    return None

# ════════════════════════════════════════════
# Agent 通道
# ════════════════════════════════════════════

@agent_router.post("/register")
def agent_register(data: dict = Body(...)):
    """配对码注册 → 颁发设备 token。body: {code, name, platform, owner_username?}"""
    code = (data.get("code") or "").strip().upper()
    if not code: raise HTTPException(400, "配对码必填")
    if not _consume_pair_code(code): raise HTTPException(400, "配对码无效或已过期")

    name = (data.get("name") or socket.gethostname() or "未命名设备").strip()
    platform = (data.get("platform") or "win").strip().lower()
    if platform not in ("win","mac","linux"): platform = "win"

    # 尝试解析 owner（如果管理面板同时传了用户名）
    owner_uid = None
    uname = (data.get("owner_username") or "").strip()
    if uname:
        c2 = _ro()
        try:
            r = c2.execute("SELECT id FROM users WHERE username=?", [uname]).fetchone()
            if r: owner_uid = r["id"]
        finally:
            c2.close()

    raw_token = ''.join(random.choices(string.ascii_letters+string.digits, k=32))
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

    db = _rw()
    try:
        db.execute("INSERT INTO device(name,platform,token_hash,owner_user_id,status,agent_version) VALUES(?,?,?,?,'active',?)",
                   [name, platform, token_hash, owner_uid, data.get("agent_version","")])
        _safe_commit(db)
        did = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        # 审计
        try:
            from audit import record_audit
            record_audit("device_register", user_id=owner_uid, detail=f"设备「{name}」注册配对", target_type="device", target_id=did)
        except Exception: pass
        return {"ok":True, "id":did, "token":raw_token, "name":name}
    finally: db.close()


@agent_router.post("/heartbeat")
def agent_heartbeat(device_token: str = Header(..., alias="X-Device-Token")):
    """心跳：更新 last_seen + 返回待办任务。返回 tasks: [{type, id, data}]"""
    dev = _device_auth(device_token)
    db = _rw()
    try:
        db.execute("UPDATE device SET last_seen_at=datetime('now','localtime') WHERE id=?", [dev["id"]])
        # 领任务：仅 pending 的备份任务
        tasks = []
        bt = db.execute("SELECT id,catalog_id,fingerprint,size FROM backup_task WHERE device_id=? AND state='pending' ORDER BY id LIMIT 10",
                        [dev["id"]]).fetchall()
        for b in bt:
            tasks.append({"type":"upload","id":b["id"],"catalog_id":b["catalog_id"],"fingerprint":b["fingerprint"],"size":b["size"]})
        _safe_commit(db)
        return {"ok":True, "tasks":tasks}
    finally: db.close()


@agent_router.post("/index-batch")
def agent_index_batch(device_token: str = Header(..., alias="X-Device-Token"),
                      data: dict = Body(...)):
    """
    批量上报文件索引。
    body: {items:[{rel_path, filename, ext, size, mtime, fingerprint, watch_path_id?}], removed:[rel_path...]}

    返回: {ok, new, updated, missing: [rel_path...], tasks: [...]}
    """
    dev = _device_auth(device_token)
    items = data.get("items") or []
    removed = data.get("removed") or []

    db = _rw()
    try:
        new_cnt, upd_cnt = 0, 0
        for it in items:
            rp = it.get("rel_path","")
            if not rp: continue
            fp = it.get("fingerprint","")
            old = db.execute("SELECT id, fingerprint, state FROM device_file_index WHERE device_id=? AND rel_path=?",
                             [dev["id"], rp]).fetchone()
            if old:
                # 指纹变化 → changed（从任意非missing状态），new二次确认 → indexed
                if old["fingerprint"] and old["fingerprint"] != fp and old["state"] != "missing":
                    db.execute("UPDATE device_file_index SET fingerprint=?,size=?,mtime=?,state='changed',last_seen_at=datetime('now','localtime') WHERE id=?",
                               [fp, it.get("size",0), it.get("mtime",0), old["id"]])
                    upd_cnt += 1
                elif old["state"] == "new":
                    db.execute("UPDATE device_file_index SET state='indexed',size=?,mtime=?,last_seen_at=datetime('now','localtime') WHERE id=?",
                               [it.get("size",0), it.get("mtime",0), old["id"]])
                    upd_cnt += 1
                else:
                    db.execute("UPDATE device_file_index SET size=?,mtime=?,last_seen_at=datetime('now','localtime') WHERE id=?",
                               [it.get("size",0), it.get("mtime",0), old["id"]])
            else:
                db.execute("""INSERT INTO device_file_index (device_id,watch_path_id,rel_path,filename,ext,size,mtime,fingerprint,state,last_seen_at)
                              VALUES (?,?,?,?,?,?,?,?,'new',datetime('now','localtime'))""",
                           [dev["id"], it.get("watch_path_id"), rp, it.get("filename",""),
                            it.get("ext",""), it.get("size",0), it.get("mtime",0), fp])
                new_cnt += 1

        # 标记 removed
        miss = []
        for rp in removed:
            fid = db.execute("SELECT id FROM device_file_index WHERE device_id=? AND rel_path=?",
                             [dev["id"], rp]).fetchone()
            if fid:
                db.execute("UPDATE device_file_index SET state='missing',last_seen_at=datetime('now','localtime') WHERE id=?", [fid["id"]])
                miss.append(rp)

        _safe_commit(db)

        # 返回
        tasks = []
        bt = db.execute("SELECT id FROM backup_task WHERE device_id=? AND state='pending' LIMIT 5", [dev["id"]]).fetchall()
        tasks = [{"type":"upload","id":r["id"]} for r in bt]
        return {"ok":True, "new":new_cnt, "updated":upd_cnt, "missing":miss, "tasks":tasks}
    finally: db.close()


@agent_router.post("/upload/{task_id}")
async def agent_upload(task_id: int, request: Request, device_token: str = Header(..., alias="X-Device-Token"),
                       chunk_index: int = Header(0, alias="X-Chunk-Index"),
                       chunk_total: int = Header(1, alias="X-Chunk-Total"),
                       fingerprint: str = Header("", alias="X-Fingerprint")):
    """分块上传备份字节。Content-Type: application/octet-stream"""
    dev = _device_auth(device_token)

    # 验证任务
    c = _rw()
    try:
        bt = c.execute("SELECT id, catalog_id, fingerprint, device_id, state FROM backup_task WHERE id=? AND device_id=?",
                       [task_id, dev["id"]]).fetchone()
        if not bt: raise HTTPException(404, "备份任务不存在")
        if bt["state"] not in ("pending","uploading"): raise HTTPException(400, "任务已完成或失败")

        if bt["state"] == "pending":
            c.execute("UPDATE backup_task SET state='uploading' WHERE id=?", [task_id])

        actual_fp = fingerprint or bt["fingerprint"]

        # 内容寻址存储路径
        store_dir = os.path.join(BACKUP_ROOT, actual_fp[:2])
        store_path = os.path.join(store_dir, actual_fp)
        chunk_path = store_path + f".part{chunk_index}"

        # 读 body
        body_bytes = await request.body()
        os.makedirs(store_dir, exist_ok=True)
        with open(chunk_path, "wb") as f:
            f.write(body_bytes)

        c.commit()
    finally: c.close()

    # 最后一块 → 合并 + 校验
    if chunk_index == chunk_total - 1:
        c2 = _rw()
        try:
            total_size = 0
            with open(store_path, "wb") as out:
                for i in range(chunk_total):
                    p = store_path + f".part{i}"
                    if not os.path.exists(p):
                        # 部分块丢失，标记失败
                        c2.execute("UPDATE backup_task SET state='failed', error_msg=?, done_at=datetime('now','localtime') WHERE id=?",
                                   [f"missing part {i}", task_id])
                        _safe_commit(c2)
                        raise HTTPException(400, f"分块 {i} 丢失，请重传全部")
                    with open(p, "rb") as fin:
                        data_chunk = fin.read()
                        out.write(data_chunk)
                        total_size += len(data_chunk)
                    os.remove(p)

            # 校验指纹
            real_fp = hashlib.sha256()
            with open(store_path, "rb") as f:
                while True:
                    buf = f.read(8*1024*1024)  # 8MB buffer
                    if not buf: break
                    real_fp.update(buf)
            real = real_fp.hexdigest()
            if real != actual_fp and fingerprint:
                os.remove(store_path)
                c2.execute("UPDATE backup_task SET state='failed', error_msg=?, done_at=datetime('now','localtime') WHERE id=?",
                           [f"校验失败: exp={actual_fp[:16]}... got={real[:16]}...", task_id])
                _safe_commit(c2)
                raise HTTPException(400, "指纹校验失败，请重传")

            # 成功：更新资产 & 任务状态
            cat_id = bt["catalog_id"]
            if cat_id:
                c2.execute("UPDATE asset_catalog SET backup_status='backed_up', backup_path=? WHERE id=?",
                           [store_path, cat_id])
            c2.execute("UPDATE backup_task SET state='done', done_at=datetime('now','localtime') WHERE id=?", [task_id])
            _safe_commit(c2)
            # 审计
            try:
                from audit import record_audit
                record_audit("device_backup_done", detail=f"备份完成: {actual_fp[:16]}... size={total_size}", target_type="backup_task", target_id=task_id)
            except Exception: pass
        finally: c2.close()
        return {"ok":True, "merged":True, "size":total_size}

    return {"ok":True, "chunk":chunk_index}


# ════════════════════════════════════════════
# 管理通道
# ════════════════════════════════════════════

@mgmt_router.get("")
def list_devices(request: Request):
    """设备列表。admin 看全部，owner 看自己。"""
    user = _get_user(request)
    if not user: raise HTTPException(403, "请先登录")
    is_admin = user.get("role") == "admin"
    uid = user.get("id")

    c = _ro()
    try:
        if is_admin:
            rows = c.execute("SELECT * FROM device ORDER BY last_seen_at DESC").fetchall()
        else:
            rows = c.execute("SELECT * FROM device WHERE owner_user_id=? ORDER BY last_seen_at DESC", [uid]).fetchall()
        now = time.time()
        out = []
        for r in rows:
            d = dict(r)
            # 在线判定：last_seen_at < 90s
            try:
                ts = time.mktime(time.strptime(d["last_seen_at"] or "", "%Y-%m-%d %H:%M:%S"))
                d["online"] = (now - ts) < 90
            except Exception:
                d["online"] = False
            # 统计
            did = d["id"]
            d["file_count"] = c.execute("SELECT COUNT(1) FROM device_file_index WHERE device_id=?", [did]).fetchone()[0]
            d["new_count"] = c.execute("SELECT COUNT(1) FROM device_file_index WHERE device_id=? AND state='new'", [did]).fetchone()[0]
            d["missing_count"] = c.execute("SELECT COUNT(1) FROM device_file_index WHERE device_id=? AND state='missing'", [did]).fetchone()[0]
            d["path_count"] = c.execute("SELECT COUNT(1) FROM device_watch_path WHERE device_id=?", [did]).fetchone()[0]
            # 备份覆盖率（已归档且 backup_status=backed_up）
            archived = c.execute("SELECT COUNT(1) FROM device_file_index WHERE device_id=? AND catalog_id IS NOT NULL", [did]).fetchone()[0]
            backed = 0
            if archived:
                b = c.execute("SELECT COUNT(1) n FROM device_file_index dfi JOIN asset_catalog ac ON dfi.catalog_id=ac.id WHERE dfi.device_id=? AND dfi.catalog_id IS NOT NULL AND ac.backup_status='backed_up'", [did]).fetchone()
                backed = b["n"]
            d["backup_ratio"] = round(backed / archived, 3) if archived > 0 else 1.0
            d["archived_count"] = archived
            d["backed_up_count"] = backed
            # token_hash 不暴露
            d.pop("token_hash", None)
            out.append(d)
        return {"ok":True, "devices":out}
    finally:
        c.close()


@mgmt_router.post("/pair-code")
def gen_pair_code(request: Request):
    """生成 6 位配对码（5 分钟有效）"""
    user = _get_user(request)
    if not user: raise HTTPException(403, "请先登录")
    code = _gen_pair_code()
    _store_pair_code(code)
    return {"ok":True, "code":code, "expires_in":300}


@mgmt_router.put("/{device_id}")
def update_device(device_id: int, request: Request, data: dict = Body(...)):
    """改名"""
    user = _get_user(request)
    if not user: raise HTTPException(403)
    c = _rw()
    try:
        dev = c.execute("SELECT id, owner_user_id FROM device WHERE id=?", [device_id]).fetchone()
        if not dev: raise HTTPException(404, "设备不存在")
        if user["role"] != "admin" and dev["owner_user_id"] != user["id"]:
            raise HTTPException(403, "无权修改")
        if "name" in data:
            c.execute("UPDATE device SET name=? WHERE id=?", [data["name"], device_id])
        _safe_commit(c)
        return {"ok":True}
    finally: c.close()


@mgmt_router.delete("/{device_id}")
def revoke_device(device_id: int, request: Request):
    """吊销设备（token 失效）"""
    user = _get_user(request)
    if not user: raise HTTPException(403)
    c = _rw()
    try:
        dev = c.execute("SELECT id, name, owner_user_id FROM device WHERE id=?", [device_id]).fetchone()
        if not dev: raise HTTPException(404)
        if user["role"] != "admin" and dev["owner_user_id"] != user["id"]:
            raise HTTPException(403)
        c.execute("UPDATE device SET status='revoked' WHERE id=?", [device_id])
        _safe_commit(c)
        try:
            from audit import record_audit
            record_audit("device_revoke", detail=f"吊销设备「{dev['name']}」", target_type="device", target_id=device_id)
        except Exception: pass
        return {"ok":True}
    finally: c.close()


@mgmt_router.get("/{device_id}/paths")
def get_device_paths(device_id: int, request: Request):
    user = _get_user(request)
    if not user: raise HTTPException(403)
    c = _ro()
    try:
        rows = c.execute("SELECT * FROM device_watch_path WHERE device_id=? ORDER BY id", [device_id]).fetchall()
        return {"ok":True, "paths":[dict(r) for r in rows]}
    finally:
        c.close()


@mgmt_router.post("/{device_id}/paths")
def add_device_path(device_id: int, request: Request, data: dict = Body(...)):
    """添加监控路径"""
    user = _get_user(request)
    if not user: raise HTTPException(403)
    ap = (data.get("abs_path") or "").strip()
    if not ap: raise HTTPException(400, "abs_path 必填")
    c = _rw()
    try:
        dev = c.execute("SELECT id FROM device WHERE id=?", [device_id]).fetchone()
        if not dev: raise HTTPException(404)
        c.execute("INSERT INTO device_watch_path(device_id,abs_path,module_hint,project_space_id) VALUES(?,?,?,?)",
                  [device_id, ap, data.get("module_hint",""), data.get("project_space_id")])
        _safe_commit(c)
        pid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
        return {"ok":True, "id":pid}
    finally: c.close()


@mgmt_router.delete("/{device_id}/paths/{path_id}")
def del_device_path(device_id: int, path_id: int, request: Request):
    user = _get_user(request)
    if not user: raise HTTPException(403)
    c = _rw()
    try:
        c.execute("DELETE FROM device_watch_path WHERE id=? AND device_id=?", [path_id, device_id])
        _safe_commit(c)
        return {"ok":True}
    finally: c.close()


@mgmt_router.get("/{device_id}/files")
def get_device_files(device_id: int, request: Request,
                     state: str = Query(None), search: str = Query(None),
                     limit: int = Query(100, ge=1, le=1000), offset: int = Query(0, ge=0)):
    """设备文件索引浏览"""
    user = _get_user(request)
    if not user: raise HTTPException(403)
    c = _ro()
    try:
        where, params = ["device_id=?"], [device_id]
        if state:
            where.append("state=?"); params.append(state)
        if search:
            where.append("(filename LIKE ? OR rel_path LIKE ?)"); params += [f"%{search}%", f"%{search}%"]
        w = "WHERE " + " AND ".join(where)
        total = c.execute(f"SELECT COUNT(1) n FROM device_file_index {w}", params).fetchone()["n"]
        rows = c.execute(f"SELECT * FROM device_file_index {w} ORDER BY last_seen_at DESC LIMIT ? OFFSET ?",
                         params + [limit, offset]).fetchall()
        return {"ok":True, "items":[dict(r) for r in rows], "total":total, "limit":limit, "offset":offset}
    finally:
        c.close()


@mgmt_router.post("/files/{fid}/archive")
def archive_file(fid: int, request: Request, data: dict = Body(...)):
    """
    将索引条目归档为项目资产。
    body: {project_space_id, module_key, is_critical?}
    """
    user = _get_user(request)
    if not user: raise HTTPException(403)
    psid = data.get("project_space_id")
    mod_key = data.get("module_key")
    if not psid: raise HTTPException(400, "project_space_id 必填")
    if not mod_key: raise HTTPException(400, "module_key 必填")

    c = _rw()
    try:
        fi = c.execute("SELECT * FROM device_file_index WHERE id=?", [fid]).fetchone()
        if not fi: raise HTTPException(404, "文件索引不存在")
        is_critical = int(data.get("is_critical", 0))

        # 建 asset_catalog（指纹/元数据入 L0，字节仍在设备盘）
        c.execute("""INSERT INTO asset_catalog (project_space_id, module_key, filename, fingerprint, local_rel_path, size, status, is_critical, backup_status)
                     VALUES (?,?,?,?,?,?, 'active', ?, 'not_backed_up')""",
                  [psid, mod_key, fi["filename"], fi["fingerprint"], fi["rel_path"], fi["size"], is_critical])
        cat_id = c.execute("SELECT last_insert_rowid()").fetchone()[0]

        # 关联
        c.execute("UPDATE device_file_index SET state='archived', catalog_id=? WHERE id=?", [cat_id, fid])

        # 若 is_critical → 创建备份任务
        if is_critical:
            c.execute("INSERT INTO backup_task(catalog_id,device_id,file_index_id,fingerprint,size,state) VALUES(?,?,?,?,?,'pending')",
                      [cat_id, fi["device_id"], fid, fi["fingerprint"], fi["size"] or 0])

        _safe_commit(c)
        return {"ok":True, "catalog_id":cat_id}
    finally: c.close()


@mgmt_router.get("/alerts")
def get_alerts(request: Request):
    """全局告警：missing 文件 + changed 文件 + 备份失败的任务"""
    user = _get_user(request)
    if not user: raise HTTPException(403)
    c = _ro()
    try:
        missing = c.execute("SELECT COUNT(1) n FROM device_file_index WHERE state='missing'").fetchone()["n"]
        changed = c.execute("SELECT COUNT(1) n FROM device_file_index WHERE state='changed'").fetchone()["n"]
        new = c.execute("SELECT COUNT(1) n FROM device_file_index WHERE state='new'").fetchone()["n"]
        failed_backups = c.execute("SELECT COUNT(1) n FROM backup_task WHERE state='failed'").fetchone()["n"]
        # 高危：missing 且已归档但无 L1 备份
        high = c.execute("""
            SELECT COUNT(1) n FROM device_file_index dfi
            JOIN asset_catalog ac ON dfi.catalog_id=ac.id
            WHERE dfi.state='missing' AND ac.is_critical=1 AND ac.backup_status != 'backed_up'
        """).fetchone()["n"]
        items = []
        for r in c.execute("SELECT dfi.*, d.name dev_name FROM device_file_index dfi JOIN device d ON d.id=dfi.device_id WHERE dfi.state IN ('missing','changed') ORDER BY dfi.last_seen_at DESC LIMIT 30").fetchall():
            items.append(dict(r))
        return {"ok":True,
                "summary":{"missing":missing,"changed":changed,"new":new,"failed_backups":failed_backups,"high_risk":high},
                "recent":items}
    finally:
        c.close()
