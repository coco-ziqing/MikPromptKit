# -*- coding: utf-8 -*-
"""
Phase35.1 项目内嵌模块化资产库 API（服务器托管上传模式）

能力：
- 资产模块字典（图片/视频/音频/PS/AI/AE/C4D/...）
- 项目空间 CRUD：新建时选模块 → 生成独立隔离目录树
- 资产上传：sha256 指纹查重(dedup) + 缩略图 + 入 catalog；工程文件默认标记关键(备份)
- 列表/服务(缩略图·原文件)/删除；重复报告
- 私有隔离：owner 仅见自己私有项目 + 共享项目
- 审计埋点：project_create/delete、asset_upload/delete
"""
import os, sqlite3, hashlib, json, time, shutil, subprocess, re
from typing import Optional
from fastapi import APIRouter, Request, HTTPException, UploadFile, File, Form, Query, Body
from fastapi.responses import FileResponse
from jwt_auth import get_current_user
try:
    from audit import record_audit
except Exception:
    def record_audit(*a, **k): pass

router = APIRouter(tags=["资产库"])

HERE = os.path.dirname(os.path.abspath(__file__))
try:
    from paths import get_data_dir
    DATA_DIR = get_data_dir()
except Exception:
    DATA_DIR = os.path.abspath(os.path.join(HERE, "..", "..", "data"))
DB = os.path.join(DATA_DIR, "prompts.db")
WS_ROOT = os.path.join(DATA_DIR, "workspaces")
THUMB_DIR = os.path.join(DATA_DIR, "catalog_thumbs")
os.makedirs(WS_ROOT, exist_ok=True)
os.makedirs(THUMB_DIR, exist_ok=True)


def _db():
    from database import get_db
    raw = get_db()
    raw.row_factory = sqlite3.Row
    # T3: shared conn wrapper — close() becomes no-op (sqlite3 close is C property, can't assign)
    class _NC:
        def __init__(self, conn):
            object.__setattr__(self, '_conn', conn)
        def __getattribute__(self, name):
            if name == 'close':
                return lambda: None
            return getattr(object.__getattribute__(self, '_conn'), name)
    return _NC(raw)


def _auth(request: Request, require=True):
    u = get_current_user(request)
    if require and not (u and u.get("authenticated")):
        raise HTTPException(401, "请先登录")
    return u


def _safe_name(name: str) -> str:
    name = os.path.basename(name or "file")
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip() or "file"
    return name[:180]


def _fingerprint(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _modules_map(c):
    return {r["key"]: dict(r) for r in c.execute("SELECT * FROM asset_module")}


def _workspace_abs(ws_row) -> str:
    root = ws_row["storage_root"] or DATA_DIR
    return os.path.abspath(root)


def _project_abs(c, proj_row) -> str:
    ws = c.execute("SELECT * FROM user_workspace WHERE id=?", [proj_row["workspace_id"]]).fetchone()
    base = _workspace_abs(ws) if ws else DATA_DIR
    return os.path.join(base, "projects", f"proj{proj_row['id']}")


def _ensure_private_ws(c, uid):
    row = c.execute(
        "SELECT * FROM user_workspace WHERE owner_user_id=? AND visibility='private' ORDER BY id LIMIT 1", [uid]).fetchone()
    if row:
        return row
    root = os.path.join(WS_ROOT, f"user{uid}")
    os.makedirs(root, exist_ok=True)
    c.execute("""INSERT INTO user_workspace (owner_user_id,name,description,location,storage_root,visibility,is_default)
                 VALUES (?,?,?,'server',?, 'private',0)""",
              [uid, "我的工作空间", "个人私有工作空间", root])
    c.commit()
    return c.execute("SELECT * FROM user_workspace WHERE id=last_insert_rowid()").fetchone()


def _can_access(u, proj):
    if not proj:
        return False
    if u.get("role") == "admin":
        return True
    if proj["visibility"] in ("shared", "public"):
        return True
    if proj["owner_user_id"] == u.get("id"):
        return True
    # Phase35.2: 项目成员可访问被共享的私有项目
    try:
        cc = _db()
        try:
            m = cc.execute("SELECT 1 FROM project_space_member WHERE project_space_id=? AND user_id=?",
                           [proj["id"], u.get("id")]).fetchone()
            return bool(m)
        finally:
            cc.close()
    except Exception:
        return False


# ============================================================
# 模块字典
# ============================================================
@router.get("/api/asset-modules")
def list_modules():
    c = _db()
    try:
        return {"ok": True, "modules": [dict(r) for r in c.execute("SELECT * FROM asset_module ORDER BY sort")]}
    finally:
        c.close()


# ============================================================
# 项目空间 CRUD
# ============================================================
@router.post("/api/projects")
def create_project(data: dict = Body(...), request: Request = None):
    u = _auth(request)
    uid = u.get("id")
    name = (data.get("name") or "").strip() or "未命名项目"
    desc = (data.get("description") or "").strip()
    modules = data.get("modules") or ["image", "video", "audio"]
    visibility = data.get("visibility") if data.get("visibility") in ("private", "shared") else "private"
    backup_policy = data.get("backup_policy") if data.get("backup_policy") in ("none", "critical", "all") else "critical"

    c = _db()
    try:
        mm = _modules_map(c)
        modules = [m for m in modules if m in mm] or ["image"]
        # 目标工作空间：私有→个人ws；共享→默认公共ws(id=1)
        if visibility == "shared":
            ws = c.execute("SELECT * FROM user_workspace WHERE is_default=1").fetchone() or _ensure_private_ws(c, uid)
        else:
            ws = _ensure_private_ws(c, uid)
        c.execute("""INSERT INTO project_space (workspace_id,owner_user_id,name,description,preset_id,status,visibility,modules_json,backup_policy)
                     VALUES (?,?,?,?,NULL,'active',?,?,?)""",
                  [ws["id"], uid, name, desc, visibility, json.dumps(modules, ensure_ascii=False), backup_policy])
        pid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
        proj = c.execute("SELECT * FROM project_space WHERE id=?", [pid]).fetchone()
        # 生成隔离目录树
        pabs = _project_abs(c, proj)
        os.makedirs(pabs, exist_ok=True)
        for mk in modules:
            os.makedirs(os.path.join(pabs, mm[mk]["default_folder"]), exist_ok=True)
        c.execute("UPDATE project_space SET project_root=? WHERE id=?", [f"projects/proj{pid}", pid])
        # Phase35.2: owner 加为项目成员
        try:
            c.execute("INSERT OR IGNORE INTO project_space_member (project_space_id,user_id,role,added_by) VALUES (?,?, 'owner', ?)", [pid, uid, uid])
        except Exception:
            pass
        c.commit()
        record_audit("project_create", request=request, detail=f"新建项目「{name}」({visibility}) 模块:{','.join(modules)}",
                     target_type="project", target_id=pid, category="project")
        return {"ok": True, "project": _proj_dict(c, proj, mm)}
    finally:
        c.close()


def _proj_dict(c, proj, mm=None):
    d = dict(proj)
    try:
        d["modules"] = json.loads(d.get("modules_json") or "[]")
    except Exception:
        d["modules"] = []
    if mm is None:
        mm = _modules_map(c)
    d["module_info"] = [{"key": k, **{kk: mm[k][kk] for kk in ("name", "icon", "media_kind")}} for k in d["modules"] if k in mm]
    d["asset_count"] = c.execute("SELECT COUNT(1) FROM asset_catalog WHERE project_space_id=?", [proj["id"]]).fetchone()[0]
    return d


@router.get("/api/projects")
def list_projects(request: Request, scope: str = Query("all")):
    u = _auth(request)
    uid = u.get("id")
    c = _db()
    try:
        if scope == "mine":
            rows = c.execute("SELECT * FROM project_space WHERE owner_user_id=? ORDER BY id DESC", [uid]).fetchall()
        elif scope == "shared":
            rows = c.execute("SELECT * FROM project_space WHERE visibility IN ('shared','public') ORDER BY id DESC").fetchall()
        else:
            rows = c.execute(
                """SELECT * FROM project_space WHERE owner_user_id=? OR visibility IN ('shared','public')
                   OR id IN (SELECT project_space_id FROM project_space_member WHERE user_id=?)
                   ORDER BY id DESC""",
                [uid, uid]).fetchall()
        mm = _modules_map(c)
        return {"ok": True, "projects": [_proj_dict(c, r, mm) for r in rows]}
    finally:
        c.close()


@router.get("/api/projects/{pid}")
def get_project(pid: int, request: Request):
    u = _auth(request)
    c = _db()
    try:
        proj = c.execute("SELECT * FROM project_space WHERE id=?", [pid]).fetchone()
        if not proj or not _can_access(u, proj):
            raise HTTPException(404, "项目不存在或无权访问")
        return {"ok": True, "project": _proj_dict(c, proj)}
    finally:
        c.close()


@router.put("/api/projects/{pid}")
def update_project(pid: int, data: dict = Body(...), request: Request = None):
    u = _auth(request)
    c = _db()
    try:
        proj = c.execute("SELECT * FROM project_space WHERE id=?", [pid]).fetchone()
        if not proj:
            raise HTTPException(404, "项目不存在")
        if proj["owner_user_id"] != u.get("id") and u.get("role") != "admin":
            raise HTTPException(403, "仅项目所有者或管理员可修改")
        mm = _modules_map(c)
        if "name" in data:
            c.execute("UPDATE project_space SET name=? WHERE id=?", [(data["name"] or "").strip() or proj["name"], pid])
        if "description" in data:
            c.execute("UPDATE project_space SET description=? WHERE id=?", [data["description"], pid])
        if "status" in data and data["status"] in ("active", "archived"):
            c.execute("UPDATE project_space SET status=? WHERE id=?", [data["status"], pid])
        if "backup_policy" in data and data["backup_policy"] in ("none", "critical", "all"):
            c.execute("UPDATE project_space SET backup_policy=? WHERE id=?", [data["backup_policy"], pid])
        if "modules" in data and isinstance(data["modules"], list):
            mods = [m for m in data["modules"] if m in mm] or ["image"]
            c.execute("UPDATE project_space SET modules_json=? WHERE id=?", [json.dumps(mods, ensure_ascii=False), pid])
            pabs = _project_abs(c, proj)
            for mk in mods:
                os.makedirs(os.path.join(pabs, mm[mk]["default_folder"]), exist_ok=True)
        c.execute("UPDATE project_space SET updated_at=datetime('now','localtime') WHERE id=?", [pid])
        c.commit()
        return {"ok": True, "project": _proj_dict(c, c.execute("SELECT * FROM project_space WHERE id=?", [pid]).fetchone(), mm)}
    finally:
        c.close()


@router.delete("/api/projects/{pid}")
def delete_project(pid: int, request: Request):
    u = _auth(request)
    c = _db()
    try:
        proj = c.execute("SELECT * FROM project_space WHERE id=?", [pid]).fetchone()
        if not proj:
            raise HTTPException(404, "项目不存在")
        if proj["owner_user_id"] != u.get("id") and u.get("role") != "admin":
            raise HTTPException(403, "仅项目所有者或管理员可删除")
        # 删缩略图
        for r in c.execute("SELECT thumb_path FROM asset_catalog WHERE project_space_id=?", [pid]):
            tp = r["thumb_path"]
            if tp and os.path.isfile(tp):
                try: os.remove(tp)
                except Exception: pass
        c.execute("DELETE FROM asset_catalog WHERE project_space_id=?", [pid])
        c.execute("DELETE FROM project_space WHERE id=?", [pid])
        c.commit()
        # 删项目目录（限定在 data/ 内，防误删）
        pabs = _project_abs(c, proj)
        if os.path.isdir(pabs) and os.path.abspath(pabs).startswith(DATA_DIR):
            try: shutil.rmtree(pabs, ignore_errors=True)
            except Exception: pass
        record_audit("project_delete", request=request, detail=f"删除项目「{proj['name']}」",
                     target_type="project", target_id=pid, category="project")
        return {"ok": True, "message": "项目已删除"}
    finally:
        c.close()


# ============================================================
# 资产上传 / 列表 / 服务 / 删除
# ============================================================
def _make_thumb(cid: int, src: str, kind: str) -> str:
    """生成缩略图，返回 thumb 绝对路径或 ''。"""
    out = os.path.join(THUMB_DIR, f"{cid}.jpg")
    try:
        if kind == "image":
            from PIL import Image
            im = Image.open(src)
            im.thumbnail((400, 400))
            if im.mode not in ("RGB", "L"):
                im = im.convert("RGB")
            im.save(out, "JPEG", quality=82)
            return out
        if kind == "video":
            subprocess.run(
                ["ffmpeg", "-y", "-ss", "1", "-i", src, "-frames:v", "1", "-vf", "scale=400:-1", out],
                capture_output=True, timeout=20,
                creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0)
            return out if os.path.isfile(out) else ""
    except Exception:
        return ""
    return ""


@router.post("/api/projects/{pid}/assets")
async def upload_asset(pid: int, request: Request, file: UploadFile = File(...),
                       module: str = Form(...), note: str = Form("")):
    u = _auth(request)
    c = _db()
    try:
        proj = c.execute("SELECT * FROM project_space WHERE id=?", [pid]).fetchone()
        if not proj:
            raise HTTPException(404, "项目不存在")
        if proj["owner_user_id"] != u.get("id") and u.get("role") != "admin" and proj["visibility"] not in ("shared", "public"):
            raise HTTPException(403, "无权上传到该项目")
        mm = _modules_map(c)
        if module not in mm:
            raise HTTPException(400, "无效模块")
        enabled = json.loads(proj["modules_json"] or "[]")
        if module not in enabled:
            raise HTTPException(400, "该项目未启用此模块")

        mod = mm[module]
        fname = _safe_name(file.filename)
        ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
        accept = [e for e in (mod["accept_ext"] or "").split(",") if e]
        if accept and ext not in accept:
            raise HTTPException(400, f"「{mod['name']}」不接受 .{ext} 文件（允许: {mod['accept_ext']}）")

        pabs = _project_abs(c, proj)
        mdir = os.path.join(pabs, mod["default_folder"])
        os.makedirs(mdir, exist_ok=True)
        # 防重名
        dest = os.path.join(mdir, fname)
        base, dot, e = fname.rpartition(".")
        i = 1
        while os.path.exists(dest):
            nn = f"{base}_{i}.{e}" if dot else f"{fname}_{i}"
            dest = os.path.join(mdir, nn); i += 1
        fname = os.path.basename(dest)

        # 落盘（路径穿越防护：os.path.basename 已在 _safe_name 中，再确保在项目目录内）
        dest_abs = os.path.abspath(dest)
        if not dest_abs.startswith(os.path.abspath(pabs) + os.sep):
            raise HTTPException(400, "非法的文件路径")
        dest = dest_abs  # 后续统一用安全路径
        size = 0
        with open(dest, "wb") as out:
            while True:
                chunk = await file.read(1 << 20)
                if not chunk:
                    break
                out.write(chunk); size += len(chunk)

        fp = _fingerprint(dest)
        # 查重（同项目内相同指纹）
        dup = c.execute(
            "SELECT id, filename FROM asset_catalog WHERE project_space_id=? AND fingerprint=? LIMIT 1", [pid, fp]).fetchone()
        rel = os.path.relpath(dest, pabs).replace("\\", "/")
        kind = mod["media_kind"]
        policy = proj["backup_policy"] or "critical"
        is_critical = 1 if policy == "all" else (1 if (policy == "critical" and kind in ("project_file", "model")) else 0)

        c.execute("""INSERT INTO asset_catalog
            (project_space_id,workspace_id,owner_user_id,fingerprint,filename,ext,size,media_type,
             module_key,origin_device,local_rel_path,status,is_critical,backup_status)
            VALUES (?,?,?,?,?,?,?,?,?, 'server', ?, 'present', ?, 'backed_up')""",
            [pid, proj["workspace_id"], u.get("id"), fp, fname, ext, size, kind, module, rel, is_critical])
        cid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
        thumb = _make_thumb(cid, dest, kind)
        if thumb:
            c.execute("UPDATE asset_catalog SET thumb_path=? WHERE id=?", [thumb, cid])
        # Phase35.2: 创建 v1 版本快照
        try:
            c.execute("""INSERT INTO asset_version
                (catalog_id,version_no,fingerprint,filename,size,local_rel_path,thumb_path,origin_device,author_user_id,author_name,note,status)
                VALUES (?,1,?,?,?,?,?, 'server', ?,?, '', 'draft')""",
                [cid, fp, fname, size, rel, thumb or "", u.get("id"), u.get("username", "")])
            vid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
            c.execute("UPDATE asset_catalog SET current_version_id=?, version_count=1, review_status='draft' WHERE id=?", [vid, cid])
        except Exception:
            pass
        c.commit()
        record_audit("asset_upload", request=request,
                     detail=f"上传 {mod['name']} 「{fname}」({size//1024}KB){' [关键·备份]' if is_critical else ''}"
                            + (f" ⚠重复(已存在#{dup['id']})" if dup else ""),
                     target_type="asset", target_id=cid, category="asset")
        row = c.execute("SELECT * FROM asset_catalog WHERE id=?", [cid]).fetchone()
        return {"ok": True, "asset": _asset_dict(row), "duplicate": ({"id": dup["id"], "filename": dup["filename"]} if dup else None)}
    finally:
        c.close()


def _asset_dict(r):
    d = dict(r)
    d["has_thumb"] = bool(d.get("thumb_path"))
    d["thumb_url"] = f"/api/assets/{d['id']}/thumb" if d.get("thumb_path") else ""
    d["file_url"] = f"/api/assets/{d['id']}/file"
    d.pop("thumb_path", None)
    return d


@router.get("/api/projects/{pid}/assets")
def list_assets(pid: int, request: Request, module: str = Query(None), search: str = Query(None)):
    u = _auth(request)
    c = _db()
    try:
        proj = c.execute("SELECT * FROM project_space WHERE id=?", [pid]).fetchone()
        if not proj or not _can_access(u, proj):
            raise HTTPException(404, "项目不存在或无权访问")
        where, params = ["project_space_id=?"], [pid]
        if module:
            where.append("module_key=?"); params.append(module)
        if search:
            where.append("filename LIKE ?"); params.append(f"%{search}%")
        rows = c.execute(f"SELECT * FROM asset_catalog WHERE {' AND '.join(where)} ORDER BY id DESC", params).fetchall()
        # 按模块分组计数
        counts = {}
        for r in c.execute("SELECT module_key, COUNT(1) n FROM asset_catalog WHERE project_space_id=? GROUP BY module_key", [pid]):
            counts[r["module_key"]] = r["n"]
        return {"ok": True, "assets": [_asset_dict(r) for r in rows], "counts": counts, "total": len(rows)}
    finally:
        c.close()


@router.patch("/api/assets/{cid}")
def update_asset(cid: int, data: dict = Body(...), request: Request = None):
    u = _auth(request)
    c = _db()
    try:
        r = c.execute("SELECT * FROM asset_catalog WHERE id=?", [cid]).fetchone()
        if not r:
            raise HTTPException(404, "资产不存在")
        proj = c.execute("SELECT * FROM project_space WHERE id=?", [r["project_space_id"]]).fetchone()
        if not _can_access(u, proj):
            raise HTTPException(403, "无权操作")
        if "is_critical" in data:
            c.execute("UPDATE asset_catalog SET is_critical=? WHERE id=?", [1 if data["is_critical"] else 0, cid])
        if "gen_prompt" in data:
            c.execute("UPDATE asset_catalog SET gen_prompt=? WHERE id=?", [str(data.get("gen_prompt") or "")[:4000], cid])
        if "gen_model" in data:
            c.execute("UPDATE asset_catalog SET gen_model=? WHERE id=?", [str(data.get("gen_model") or "")[:200], cid])
        if "gen_params" in data:
            try:
                gp = json.dumps(data.get("gen_params") or {}, ensure_ascii=False)
            except Exception:
                gp = "{}"
            c.execute("UPDATE asset_catalog SET gen_params_json=? WHERE id=?", [gp, cid])
        if "rating" in data:
            try:
                rv = max(0, min(5, int(data.get("rating") or 0)))
            except Exception:
                rv = 0
            c.execute("UPDATE asset_catalog SET rating=? WHERE id=?", [rv, cid])
        c.execute("UPDATE asset_catalog SET updated_at=datetime('now','localtime') WHERE id=?", [cid])
        c.commit()
        return {"ok": True}
    finally:
        c.close()


@router.delete("/api/assets/{cid}")
def delete_asset(cid: int, request: Request):
    u = _auth(request)
    c = _db()
    try:
        r = c.execute("SELECT * FROM asset_catalog WHERE id=?", [cid]).fetchone()
        if not r:
            raise HTTPException(404, "资产不存在")
        proj = c.execute("SELECT * FROM project_space WHERE id=?", [r["project_space_id"]]).fetchone()
        if not proj or (proj["owner_user_id"] != u.get("id") and u.get("role") != "admin" and proj["visibility"] not in ("shared", "public")):
            raise HTTPException(403, "无权删除")
        pabs = _project_abs(c, proj)
        fpath = os.path.join(pabs, (r["local_rel_path"] or "").replace("/", os.sep))
        if os.path.isfile(fpath) and os.path.abspath(fpath).startswith(DATA_DIR):
            try: os.remove(fpath)
            except Exception: pass
        if r["thumb_path"] and os.path.isfile(r["thumb_path"]):
            try: os.remove(r["thumb_path"])
            except Exception: pass
        c.execute("DELETE FROM asset_catalog WHERE id=?", [cid])
        c.commit()
        record_audit("asset_delete", request=request, detail=f"删除资产「{r['filename']}」",
                     target_type="asset", target_id=cid, category="asset")
        return {"ok": True}
    finally:
        c.close()


@router.get("/api/assets/{cid}/thumb")
def asset_thumb(cid: int):
    c = _db()
    try:
        r = c.execute("SELECT thumb_path FROM asset_catalog WHERE id=?", [cid]).fetchone()
        if not r or not r["thumb_path"] or not os.path.isfile(r["thumb_path"]):
            raise HTTPException(404, "无缩略图")
        return FileResponse(r["thumb_path"], media_type="image/jpeg")
    finally:
        c.close()


@router.get("/api/assets/{cid}/file")
def asset_file(cid: int, request: Request):
    u = _auth(request)
    c = _db()
    try:
        r = c.execute("SELECT * FROM asset_catalog WHERE id=?", [cid]).fetchone()
        if not r:
            raise HTTPException(404, "资产不存在")
        proj = c.execute("SELECT * FROM project_space WHERE id=?", [r["project_space_id"]]).fetchone()
        if not _can_access(u, proj):
            raise HTTPException(403, "无权访问")
        pabs = _project_abs(c, proj)
        fpath = os.path.join(pabs, (r["local_rel_path"] or "").replace("/", os.sep))
        # 防穿越校验：必须在 project_abs 内 || DATA_DIR/workspaces 内
        safe_roots = (os.path.abspath(pabs), os.path.abspath(os.path.join(DATA_DIR, 'workspaces')))
        if not (os.path.isfile(fpath) and any(os.path.abspath(fpath).startswith(sr) for sr in safe_roots)):
            raise HTTPException(404, "文件不在服务器（可能仅存于本地设备盘）")
        return FileResponse(fpath, filename=r["filename"])
    finally:
        c.close()


@router.get("/api/projects/{pid}/dedup")
def dedup_report(pid: int, request: Request):
    u = _auth(request)
    c = _db()
    try:
        proj = c.execute("SELECT * FROM project_space WHERE id=?", [pid]).fetchone()
        if not proj or not _can_access(u, proj):
            raise HTTPException(404, "项目不存在或无权访问")
        groups = []
        for r in c.execute("""SELECT fingerprint, COUNT(1) n FROM asset_catalog
                              WHERE project_space_id=? AND fingerprint!='' GROUP BY fingerprint HAVING n>1""", [pid]):
            items = c.execute("SELECT id,filename,module_key,size FROM asset_catalog WHERE project_space_id=? AND fingerprint=?",
                              [pid, r["fingerprint"]]).fetchall()
            groups.append({"fingerprint": r["fingerprint"][:12], "count": r["n"], "items": [dict(x) for x in items]})
        return {"ok": True, "duplicate_groups": groups, "total_groups": len(groups)}
    finally:
        c.close()
