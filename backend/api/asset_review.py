"""
Phase35.2 版本管理 + 验证审核 + 团队协作成员 API

复用 api/asset_library.py 的存储/鉴权辅助。
角色（项目内）：owner > reviewer > editor > viewer
  - can_view   : 任意成员 / 共享项目任意登录者 / admin
  - can_edit   : owner|editor（上传新版本/回滚）；共享项目默认 editor
  - can_review : owner|reviewer|admin（批准/驳回）
  - can_manage : owner|admin（成员增删）
审核状态流：draft → in_review →(approve) approved / (reject) rejected
"""
import json
import os
import subprocess

from fastapi import APIRouter, Body, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from api.asset_library import (
    THUMB_DIR,
    _auth,
    _db,
    _fingerprint,
    _modules_map,
    _project_abs,
    _safe_name,
)

try:
    from audit import record_audit
except Exception:
    def record_audit(*a, **k): pass

router = APIRouter(tags=["资产版本审核"])


# ============================================================
# 权限
# ============================================================
def _proj_role(c, u, proj):
    """返回当前用户在项目内的角色，或 None（无访问权）。"""
    if not proj:
        return None
    uid = u.get("id")
    if u.get("role") == "admin":
        return "owner"
    if proj["owner_user_id"] == uid:
        return "owner"
    m = c.execute("SELECT role FROM project_space_member WHERE project_space_id=? AND user_id=?",
                  [proj["id"], uid]).fetchone()
    if m:
        return m["role"]
    if proj["visibility"] in ("shared", "public"):
        return "editor"
    return None


def _can(role, *allowed):
    return role in allowed


def _proj_of_catalog(c, cid):
    a = c.execute("SELECT * FROM asset_catalog WHERE id=?", [cid]).fetchone()
    if not a:
        return None, None
    p = c.execute("SELECT * FROM project_space WHERE id=?", [a["project_space_id"]]).fetchone()
    return a, p


def _make_thumb_to(out_path, src, kind):
    try:
        if kind == "image":
            from PIL import Image
            im = Image.open(src); im.thumbnail((400, 400))
            if im.mode not in ("RGB", "L"):
                im = im.convert("RGB")
            im.save(out_path, "JPEG", quality=82)
            return out_path
        if kind == "video":
            subprocess.run(["ffmpeg", "-y", "-ss", "1", "-i", src, "-frames:v", "1", "-vf", "scale=400:-1", out_path],
                           capture_output=True, timeout=20,
                           creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0)
            return out_path if os.path.isfile(out_path) else ""
    except Exception:
        return ""
    return ""


# ============================================================
# 资产详情
# ============================================================
@router.get("/api/assets/{cid}")
def asset_detail(cid: int, request: Request):
    u = _auth(request)
    c = _db()
    try:
        a, p = _proj_of_catalog(c, cid)
        if not a or _proj_role(c, u, p) is None:
            raise HTTPException(404, "资产不存在或无权访问")
        d = dict(a)
        d["thumb_url"] = f"/api/assets/{cid}/thumb" if a["thumb_path"] else ""
        d["file_url"] = f"/api/assets/{cid}/file"
        d.pop("thumb_path", None)
        d["role"] = _proj_role(c, u, p)
        try:
            d["gen_params"] = json.loads(a["gen_params_json"] or "{}")
        except Exception:
            d["gen_params"] = {}
        d["refs"] = _resolve_refs(c, cid)
        return {"ok": True, "asset": d}
    finally:
        c.close()


# ============================================================
# 版本管理
# ============================================================
@router.get("/api/assets/{cid}/versions")
def list_versions(cid: int, request: Request):
    u = _auth(request)
    c = _db()
    try:
        a, p = _proj_of_catalog(c, cid)
        if not a or _proj_role(c, u, p) is None:
            raise HTTPException(404, "资产不存在或无权访问")
        rows = c.execute("SELECT * FROM asset_version WHERE catalog_id=? ORDER BY version_no DESC", [cid]).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["is_current"] = (r["id"] == a["current_version_id"])
            d["thumb_url"] = f"/api/versions/{r['id']}/thumb" if r["thumb_path"] else ""
            d.pop("thumb_path", None)
            out.append(d)
        return {"ok": True, "versions": out, "current_version_id": a["current_version_id"], "review_status": a["review_status"]}
    finally:
        c.close()


@router.post("/api/assets/{cid}/versions")
async def upload_version(cid: int, request: Request, file: UploadFile = File(...), note: str = Form("")):
    u = _auth(request)
    c = _db()
    try:
        a, p = _proj_of_catalog(c, cid)
        if not a:
            raise HTTPException(404, "资产不存在")
        role = _proj_role(c, u, p)
        if not _can(role, "owner", "editor"):
            raise HTTPException(403, "无权上传新版本")
        mm = _modules_map(c)
        mod = mm.get(a["module_key"]) or {"default_folder": "其他", "media_kind": "other", "accept_ext": ""}
        fname = _safe_name(file.filename)
        ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
        accept = [e for e in (mod["accept_ext"] or "").split(",") if e]
        if accept and ext not in accept:
            raise HTTPException(400, f"「{mod.get('name','')}」不接受 .{ext}")
        pabs = _project_abs(c, p)
        mdir = os.path.join(pabs, mod["default_folder"])
        os.makedirs(mdir, exist_ok=True)
        nextno = (c.execute("SELECT COALESCE(MAX(version_no),0)+1 n FROM asset_version WHERE catalog_id=?", [cid]).fetchone()["n"])
        base, dot, e = fname.rpartition(".")
        vfname = f"{base}_v{nextno}.{e}" if dot else f"{fname}_v{nextno}"
        dest = os.path.join(mdir, vfname)
        i = 1
        while os.path.exists(dest):
            vfname = f"{base}_v{nextno}_{i}.{e}" if dot else f"{fname}_v{nextno}_{i}"
            dest = os.path.join(mdir, vfname); i += 1
        size = 0
        with open(dest, "wb") as out:
            while True:
                chunk = await file.read(1 << 20)
                if not chunk:
                    break
                out.write(chunk); size += len(chunk)
        fp = _fingerprint(dest)
        rel = os.path.relpath(dest, pabs).replace("\\", "/")
        thumb = _make_thumb_to(os.path.join(THUMB_DIR, f"{cid}_v{nextno}.jpg"), dest, mod["media_kind"])
        c.execute("""INSERT INTO asset_version
            (catalog_id,version_no,fingerprint,filename,size,local_rel_path,thumb_path,origin_device,author_user_id,author_name,note,status)
            VALUES (?,?,?,?,?,?,?, 'server', ?,?,?, 'draft')""",
            [cid, nextno, fp, os.path.basename(dest), size, rel, thumb or "", u.get("id"), u.get("username", ""), note])
        vid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
        # 当前指向新版本；状态回到 draft
        c.execute("""UPDATE asset_catalog SET current_version_id=?, fingerprint=?, filename=?, size=?, local_rel_path=?,
                     thumb_path=?, version_count=version_count+1, review_status='draft', updated_at=datetime('now','localtime')
                     WHERE id=?""",
                  [vid, fp, os.path.basename(dest), size, rel, thumb or "", cid])
        c.commit()
        record_audit("asset_version", request=request, category="asset",
                     detail=f"上传新版本 v{nextno}「{os.path.basename(dest)}」", target_type="asset", target_id=cid)
        return {"ok": True, "version_no": nextno, "version_id": vid}
    finally:
        c.close()


@router.post("/api/assets/{cid}/rollback/{vid}")
def rollback_version(cid: int, vid: int, request: Request):
    u = _auth(request)
    c = _db()
    try:
        a, p = _proj_of_catalog(c, cid)
        if not a:
            raise HTTPException(404, "资产不存在")
        if not _can(_proj_role(c, u, p), "owner", "editor"):
            raise HTTPException(403, "无权回滚")
        v = c.execute("SELECT * FROM asset_version WHERE id=? AND catalog_id=?", [vid, cid]).fetchone()
        if not v:
            raise HTTPException(404, "版本不存在")
        c.execute("""UPDATE asset_catalog SET current_version_id=?, fingerprint=?, filename=?, size=?, local_rel_path=?,
                     thumb_path=?, review_status=?, updated_at=datetime('now','localtime') WHERE id=?""",
                  [vid, v["fingerprint"], v["filename"], v["size"], v["local_rel_path"], v["thumb_path"] or "", v["status"], cid])
        c.commit()
        record_audit("asset_version", request=request, category="asset",
                     detail=f"回滚到版本 v{v['version_no']}", target_type="asset", target_id=cid)
        return {"ok": True, "current_version_id": vid}
    finally:
        c.close()


@router.get("/api/versions/{vid}/thumb")
def version_thumb(vid: int):
    c = _db()
    try:
        r = c.execute("SELECT thumb_path FROM asset_version WHERE id=?", [vid]).fetchone()
        if not r or not r["thumb_path"] or not os.path.isfile(r["thumb_path"]):
            raise HTTPException(404, "无缩略图")
        return FileResponse(r["thumb_path"], media_type="image/jpeg")
    finally:
        c.close()


# ============================================================
# 审核 / 评论
# ============================================================
@router.post("/api/assets/{cid}/submit")
def submit_review(cid: int, request: Request, data: dict = Body(default={})):
    u = _auth(request)
    c = _db()
    try:
        a, p = _proj_of_catalog(c, cid)
        if not a:
            raise HTTPException(404, "资产不存在")
        if not _can(_proj_role(c, u, p), "owner", "editor"):
            raise HTTPException(403, "无权提交审核")
        vid = a["current_version_id"]
        c.execute("UPDATE asset_version SET status='in_review' WHERE id=?", [vid])
        c.execute("UPDATE asset_catalog SET review_status='in_review' WHERE id=?", [cid])
        c.execute("""INSERT INTO asset_review (catalog_id,version_id,reviewer_user_id,reviewer_name,action,comment)
                     VALUES (?,?,?,?, 'submit', ?)""",
                  [cid, vid, u.get("id"), u.get("username", ""), (data or {}).get("comment", "")])
        c.commit()
        record_audit("asset_submit", request=request, category="asset",
                     detail=f"提交审核「{a['filename']}」", target_type="asset", target_id=cid)
        return {"ok": True, "review_status": "in_review"}
    finally:
        c.close()


@router.post("/api/assets/{cid}/review")
def do_review(cid: int, data: dict = Body(...), request: Request = None):
    u = _auth(request)
    action = data.get("action")
    if action not in ("approve", "reject"):
        raise HTTPException(400, "action 必须为 approve/reject")
    c = _db()
    try:
        a, p = _proj_of_catalog(c, cid)
        if not a:
            raise HTTPException(404, "资产不存在")
        if not _can(_proj_role(c, u, p), "owner", "reviewer"):
            raise HTTPException(403, "仅项目所有者/审核员可批准或驳回")
        vid = a["current_version_id"]
        new_status = "approved" if action == "approve" else "rejected"
        c.execute("UPDATE asset_version SET status=? WHERE id=?", [new_status, vid])
        fields = "review_status=?"
        params = [new_status]
        if action == "approve" and (p["backup_policy"] or "critical") != "none":
            fields += ", is_critical=1, backup_status='backed_up'"
        c.execute(f"UPDATE asset_catalog SET {fields}, updated_at=datetime('now','localtime') WHERE id=?", params + [cid])
        c.execute("""INSERT INTO asset_review (catalog_id,version_id,reviewer_user_id,reviewer_name,action,comment)
                     VALUES (?,?,?,?,?,?)""",
                  [cid, vid, u.get("id"), u.get("username", ""), action, data.get("comment", "")])
        c.commit()
        record_audit("asset_" + action, request=request, category="asset",
                     detail=f"{'批准' if action=='approve' else '驳回'}「{a['filename']}」" + (f"：{data.get('comment','')}" if data.get("comment") else ""),
                     target_type="asset", target_id=cid)
        # PhaseE: 通知资产上传者（若不同人）
        try:
            from notify import notify_user
            uploader = c.execute("SELECT ac.created_by FROM asset_catalog ac WHERE ac.id=?", [cid]).fetchone()
            if uploader and uploader[0] and uploader[0] != u.get("id"):
                notify_user(uploader[0], event="asset_" + action,
                           title=f"资产{'已通过审核' if action=='approve' else '被驳回'}",
                           body=f"「{a['filename']}」{'已被 ' + u.get('username','') + ' 批准' if action=='approve' else '已被 ' + u.get('username','') + ' 驳回：' + (data.get('comment',''))}",
                           category="asset_" + action)
        except Exception: pass
        return {"ok": True, "review_status": new_status}
    finally:
        c.close()


@router.post("/api/assets/{cid}/comment")
def add_comment(cid: int, data: dict = Body(...), request: Request = None):
    u = _auth(request)
    text = (data.get("comment") or "").strip()
    if not text:
        raise HTTPException(400, "评论不能为空")
    c = _db()
    try:
        a, p = _proj_of_catalog(c, cid)
        if not a or _proj_role(c, u, p) is None:
            raise HTTPException(404, "资产不存在或无权访问")
        c.execute("""INSERT INTO asset_review (catalog_id,version_id,reviewer_user_id,reviewer_name,action,comment)
                     VALUES (?,?,?,?, 'comment', ?)""",
                  [cid, a["current_version_id"], u.get("id"), u.get("username", ""), text])
        c.commit()
        return {"ok": True}
    finally:
        c.close()


@router.get("/api/assets/{cid}/reviews")
def list_reviews(cid: int, request: Request):
    u = _auth(request)
    c = _db()
    try:
        a, p = _proj_of_catalog(c, cid)
        if not a or _proj_role(c, u, p) is None:
            raise HTTPException(404, "资产不存在或无权访问")
        rows = c.execute("SELECT * FROM asset_review WHERE catalog_id=? ORDER BY id DESC", [cid]).fetchall()
        return {"ok": True, "reviews": [dict(r) for r in rows]}
    finally:
        c.close()


# ============================================================
# 团队成员
# ============================================================
@router.get("/api/projects/{pid}/members")
def list_members(pid: int, request: Request):
    u = _auth(request)
    c = _db()
    try:
        p = c.execute("SELECT * FROM project_space WHERE id=?", [pid]).fetchone()
        if not p or _proj_role(c, u, p) is None:
            raise HTTPException(404, "项目不存在或无权访问")
        rows = c.execute("""SELECT m.user_id, m.role, m.created_at, us.username, us.display_name, us.avatar_color
                            FROM project_space_member m LEFT JOIN users us ON us.id=m.user_id
                            WHERE m.project_space_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'reviewer' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END""",
                         [pid]).fetchall()
        return {"ok": True, "members": [dict(r) for r in rows], "my_role": _proj_role(c, u, p)}
    finally:
        c.close()


@router.post("/api/projects/{pid}/members")
def add_member(pid: int, data: dict = Body(...), request: Request = None):
    u = _auth(request)
    c = _db()
    try:
        p = c.execute("SELECT * FROM project_space WHERE id=?", [pid]).fetchone()
        if not p:
            raise HTTPException(404, "项目不存在")
        if not _can(_proj_role(c, u, p), "owner"):
            raise HTTPException(403, "仅项目所有者/管理员可管理成员")
        role = data.get("role") if data.get("role") in ("reviewer", "editor", "viewer") else "viewer"
        target = None
        if data.get("user_id"):
            target = c.execute("SELECT id FROM users WHERE id=?", [data["user_id"]]).fetchone()
        elif data.get("username"):
            target = c.execute("SELECT id FROM users WHERE username=?", [(data["username"] or "").strip().lower()]).fetchone()
        if not target:
            raise HTTPException(404, "用户不存在")
        tid = target["id"]
        if tid == p["owner_user_id"]:
            raise HTTPException(400, "所有者已在项目中")
        c.execute("""INSERT INTO project_space_member (project_space_id,user_id,role,added_by) VALUES (?,?,?,?)
                     ON CONFLICT(project_space_id,user_id) DO UPDATE SET role=excluded.role""",
                  [pid, tid, role, u.get("id")])
        c.commit()
        record_audit("member_add", request=request, category="project",
                     detail=f"项目「{p['name']}」添加成员 uid={tid} 角色={role}", target_type="project", target_id=pid)
        return {"ok": True}
    finally:
        c.close()


@router.delete("/api/projects/{pid}/members/{uid}")
def remove_member(pid: int, uid: int, request: Request):
    u = _auth(request)
    c = _db()
    try:
        p = c.execute("SELECT * FROM project_space WHERE id=?", [pid]).fetchone()
        if not p:
            raise HTTPException(404, "项目不存在")
        if not _can(_proj_role(c, u, p), "owner"):
            raise HTTPException(403, "仅项目所有者/管理员可管理成员")
        if uid == p["owner_user_id"]:
            raise HTTPException(400, "不能移除所有者")
        c.execute("DELETE FROM project_space_member WHERE project_space_id=? AND user_id=?", [pid, uid])
        c.commit()
        record_audit("member_remove", request=request, category="project",
                     detail=f"项目「{p['name']}」移除成员 uid={uid}", target_type="project", target_id=pid)
        return {"ok": True}
    finally:
        c.close()


# ============================================================
# 生成溯源 + 提示词/词卡关联（并入自 资产管理专业版）
# ============================================================
def _resolve_refs(c, cid):
    rows = c.execute("SELECT * FROM asset_catalog_ref WHERE catalog_id=? ORDER BY id DESC", [cid]).fetchall()
    out = []
    for r in rows:
        name = ""
        try:
            wc = c.execute("SELECT name FROM word_card WHERE id=?", [r["ref_id"]]).fetchone()
            if wc:
                name = wc["name"]
        except Exception:
            pass
        out.append({"id": r["id"], "ref_type": r["ref_type"], "ref_id": r["ref_id"], "name": name})
    return out


@router.get("/api/assets/{cid}/refs")
def get_refs(cid: int, request: Request):
    u = _auth(request)
    c = _db()
    try:
        a, p = _proj_of_catalog(c, cid)
        if not a or _proj_role(c, u, p) is None:
            raise HTTPException(404, "资产不存在或无权访问")
        return {"ok": True, "refs": _resolve_refs(c, cid)}
    finally:
        c.close()


@router.post("/api/assets/{cid}/link")
def add_ref(cid: int, data: dict = Body(...), request: Request = None):
    u = _auth(request)
    ref_type = data.get("ref_type") or "word_card"
    if ref_type not in ("word_card", "prompt", "shot"):
        raise HTTPException(400, "无效关联类型")
    try:
        ref_id = int(data.get("ref_id"))
    except Exception:
        raise HTTPException(400, "无效 ref_id")
    c = _db()
    try:
        a, p = _proj_of_catalog(c, cid)
        if not a:
            raise HTTPException(404, "资产不存在")
        if not _can(_proj_role(c, u, p), "owner", "editor"):
            raise HTTPException(403, "无权关联")
        c.execute("INSERT OR IGNORE INTO asset_catalog_ref (catalog_id, ref_type, ref_id) VALUES (?,?,?)", [cid, ref_type, ref_id])
        c.commit()
        record_audit("asset_link", request=request, category="asset",
                     detail=f"关联 {ref_type}#{ref_id} → 资产「{a['filename']}」", target_type="asset", target_id=cid)
        return {"ok": True, "refs": _resolve_refs(c, cid)}
    finally:
        c.close()


@router.delete("/api/assets/{cid}/link/{ref_type}/{ref_id}")
def del_ref(cid: int, ref_type: str, ref_id: int, request: Request):
    u = _auth(request)
    c = _db()
    try:
        a, p = _proj_of_catalog(c, cid)
        if not a:
            raise HTTPException(404, "资产不存在")
        if not _can(_proj_role(c, u, p), "owner", "editor"):
            raise HTTPException(403, "无权操作")
        c.execute("DELETE FROM asset_catalog_ref WHERE catalog_id=? AND ref_type=? AND ref_id=?", [cid, ref_type, ref_id])
        c.commit()
        return {"ok": True, "refs": _resolve_refs(c, cid)}
    finally:
        c.close()
