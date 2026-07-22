# -*- coding: utf-8 -*-
"""
com.promptkit.asset API路由 v1.0.0
挂载前缀: /api/plugins/com.promptkit.asset/

端点总览:
  资产:   GET /assets | GET /assets/{id} | POST /assets/upload | POST /assets
          PUT /assets/{id} | DELETE /assets/{id} | POST /assets/{id}/restore
  文件:   GET /assets/{id}/file | GET /assets/{id}/download
  标签:   POST /assets/{id}/tags | DELETE /assets/{id}/tags/{tag} | GET /tags
  评分:   POST /assets/{id}/rate
  版本:   GET /assets/{id}/versions | POST /assets/{id}/versions
  溯源:   POST /assets/{id}/link | DELETE /assets/{id}/link/{ref_type}/{ref_id} | GET /assets/{id}/refs
  去重:   POST /scan-duplicates | GET /duplicates
  统计:   GET /stats
"""
import json, os, sqlite3, time, hashlib, shutil, mimetypes, subprocess, sys
from pathlib import Path
from fastapi import APIRouter, HTTPException, Query, Body, UploadFile, File, Form
from fastapi.responses import FileResponse
from typing import Optional

router = APIRouter(tags=["资产管理插件"])

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB = os.path.join(_ROOT, "data", "prompts.db")
STORAGE = os.path.join(_ROOT, "data", "project_assets")

VIDEO_EXT = {".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v", ".flv", ".wmv"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".avif"}


# ============================================================
# DB 辅助
# ============================================================

def _rw():
    conn = sqlite3.connect(DB, timeout=3)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=3000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _rows(rows):
    return [dict(r) for r in rows]


def _safe_commit(db, max_retries=15):
    for i in range(max_retries):
        try:
            db.commit()
            return
        except sqlite3.OperationalError:
            if i == max_retries - 1:
                raise
            time.sleep(0.05 * (i + 1))


# ============================================================
# 媒体探测
# ============================================================

def _media_type(ext: str, mime: str = "") -> str:
    ext = ext.lower()
    if ext in VIDEO_EXT:
        return "video"
    if ext in IMAGE_EXT:
        return "image"
    if mime.startswith("video"):
        return "video"
    if mime.startswith("image"):
        return "image"
    return "other"


def _probe_image(path: str):
    """返回 (w, h)，失败返回 (0,0)"""
    try:
        from PIL import Image
        with Image.open(path) as im:
            return im.width, im.height
    except Exception:
        return 0, 0


def _probe_video(path: str):
    """用 ffprobe 探测 (w, h, duration)，失败返回 (0,0,0)"""
    try:
        cf = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" and hasattr(subprocess, "CREATE_NO_WINDOW") else 0
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height:format=duration",
             "-of", "json", path],
            capture_output=True, encoding="utf-8", errors="replace", timeout=8, creationflags=cf
        )
        if r.returncode == 0:
            data = json.loads(r.stdout or "{}")
            st = (data.get("streams") or [{}])[0]
            w = int(st.get("width", 0) or 0)
            h = int(st.get("height", 0) or 0)
            dur = float((data.get("format") or {}).get("duration", 0) or 0)
            return w, h, dur
    except Exception:
        pass
    return 0, 0, 0


def _hash_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _recalc_rating(db, asset_id: int):
    """根据 asset_ratings 重算 project_assets.rating 平均分"""
    row = db.execute(
        "SELECT AVG(rating) as avg_r FROM asset_ratings WHERE asset_id=? AND rating>0", [asset_id]
    ).fetchone()
    avg_r = round(row["avg_r"], 2) if row and row["avg_r"] is not None else 0
    db.execute("UPDATE project_assets SET rating=?, updated_at=datetime('now','localtime') WHERE id=?",
               [avg_r, asset_id])
    return avg_r


def _enrich(db, asset: dict) -> dict:
    """给资产附加 tags/refs/version_count"""
    aid = asset["id"]
    asset["tags"] = [r["tag"] for r in db.execute(
        "SELECT tag FROM asset_tags WHERE asset_id=? ORDER BY tag", [aid]).fetchall()]
    asset["version_count"] = db.execute(
        "SELECT COUNT(*) c FROM asset_versions WHERE asset_id=?", [aid]).fetchone()["c"]
    asset["ref_count"] = db.execute(
        "SELECT COUNT(*) c FROM asset_prompt_ref WHERE asset_id=?", [aid]).fetchone()["c"]
    try:
        asset["gen_params"] = json.loads(asset.get("gen_params_json") or "{}")
    except Exception:
        asset["gen_params"] = {}
    asset["file_url"] = f"/api/plugins/com.promptkit.asset/assets/{aid}/file"
    return asset


# ============================================================
# 资产列表 / 详情
# ============================================================

@router.get("/assets")
def list_assets(
    project_id: Optional[int] = Query(None),
    media_type: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    min_rating: float = Query(0),
    q: Optional[str] = Query(None),
    sort: str = Query("recent"),
    limit: int = Query(100),
    offset: int = Query(0),
):
    db = _rw()
    try:
        where = ["pa.is_deleted=0"]
        params = []
        if project_id is not None:
            where.append("pa.project_id=?"); params.append(project_id)
        if media_type:
            where.append("pa.media_type=?"); params.append(media_type)
        if min_rating > 0:
            where.append("pa.rating>=?"); params.append(min_rating)
        if q:
            where.append("(pa.original_filename LIKE ? OR pa.notes LIKE ? OR pa.gen_prompt LIKE ?)")
            like = f"%{q}%"; params += [like, like, like]
        if tag:
            where.append("pa.id IN (SELECT asset_id FROM asset_tags WHERE tag=?)")
            params.append(tag)

        order = {
            "recent": "pa.created_at DESC",
            "oldest": "pa.created_at ASC",
            "rating": "pa.rating DESC, pa.created_at DESC",
            "size": "pa.file_size DESC",
            "name": "pa.original_filename ASC",
        }.get(sort, "pa.created_at DESC")

        sql = f"SELECT pa.* FROM project_assets pa WHERE {' AND '.join(where)} ORDER BY {order} LIMIT ? OFFSET ?"
        rows = _rows(db.execute(sql, params + [limit, offset]).fetchall())
        for a in rows:
            _enrich(db, a)

        total = db.execute(
            f"SELECT COUNT(*) c FROM project_assets pa WHERE {' AND '.join(where)}", params
        ).fetchone()["c"]
        return {"ok": True, "assets": rows, "total": total, "limit": limit, "offset": offset}
    finally:
        db.close()


@router.get("/assets/{asset_id}")
def get_asset(asset_id: int):
    db = _rw()
    try:
        row = db.execute("SELECT * FROM project_assets WHERE id=?", [asset_id]).fetchone()
        if not row:
            raise HTTPException(404, "资产不存在")
        asset = _enrich(db, dict(row))
        asset["versions"] = _rows(db.execute(
            "SELECT * FROM asset_versions WHERE asset_id=? ORDER BY version DESC", [asset_id]).fetchall())
        asset["refs"] = _rows(db.execute(
            "SELECT * FROM asset_prompt_ref WHERE asset_id=? ORDER BY created_at DESC", [asset_id]).fetchall())
        asset["ratings"] = _rows(db.execute(
            "SELECT * FROM asset_ratings WHERE asset_id=?", [asset_id]).fetchall())
        asset["duplicates"] = _rows(db.execute(
            "SELECT * FROM asset_duplicates WHERE duplicate_of=? OR asset_id=?", [asset_id, asset_id]).fetchall())
        return {"ok": True, "asset": asset}
    finally:
        db.close()


# ============================================================
# 上传入库
# ============================================================

@router.post("/assets/upload")
async def upload_asset(
    file: UploadFile = File(...),
    project_id: Optional[int] = Form(None),
    notes: str = Form(""),
    gen_prompt: str = Form(""),
    gen_model: str = Form(""),
    gen_params_json: str = Form("{}"),
    tags: str = Form(""),
    owner_user_id: Optional[int] = Form(None),
    dedup: bool = Form(True),
):
    """多媒体文件上传：SHA256 去重 → 存盘 → 探测尺寸/时长 → 入库"""
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "空文件")
    file_hash = _hash_bytes(raw)
    orig_name = file.filename or "unnamed"
    ext = os.path.splitext(orig_name)[1].lower() or ""
    mime = file.content_type or mimetypes.guess_type(orig_name)[0] or ""
    mtype = _media_type(ext, mime)

    db = _rw()
    try:
        # 去重
        dup_of = None
        if dedup:
            ex = db.execute(
                "SELECT id FROM project_assets WHERE file_hash=? AND is_deleted=0 LIMIT 1", [file_hash]
            ).fetchone()
            if ex:
                dup_of = ex["id"]

        # 存盘：data/project_assets/{hash[:2]}/{hash}{ext}
        sub = os.path.join(STORAGE, file_hash[:2])
        os.makedirs(sub, exist_ok=True)
        stored_name = f"{file_hash}{ext}"
        abs_path = os.path.join(sub, stored_name)
        rel_path = os.path.relpath(abs_path, _ROOT).replace("\\", "/")
        if not os.path.exists(abs_path):
            with open(abs_path, "wb") as f:
                f.write(raw)

        # 探测
        w = h = 0
        dur = 0.0
        if mtype == "image":
            w, h = _probe_image(abs_path)
        elif mtype == "video":
            w, h, dur = _probe_video(abs_path)

        cur = db.execute(
            """INSERT INTO project_assets
               (filename, original_filename, file_path, file_size, media_type, mime_type,
                width, height, duration, file_hash, project_id, owner_user_id,
                notes, gen_prompt, gen_model, gen_params_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            [stored_name, orig_name, rel_path, len(raw), mtype, mime,
             w, h, dur, file_hash, project_id, owner_user_id,
             notes, gen_prompt, gen_model, gen_params_json or "{}"]
        )
        asset_id = cur.lastrowid

        # 标签
        added_tags = []
        for t in [x.strip() for x in tags.split(",") if x.strip()]:
            try:
                db.execute("INSERT OR IGNORE INTO asset_tags (asset_id, tag) VALUES (?,?)", [asset_id, t])
                added_tags.append(t)
            except Exception:
                pass

        # 记录重复
        if dup_of:
            db.execute("INSERT INTO asset_duplicates (asset_id, duplicate_of) VALUES (?,?)", [asset_id, dup_of])

        _safe_commit(db)
        row = dict(db.execute("SELECT * FROM project_assets WHERE id=?", [asset_id]).fetchone())
        _enrich(db, row)
        return {"ok": True, "asset": row, "is_duplicate": bool(dup_of), "duplicate_of": dup_of}
    finally:
        db.close()


@router.post("/assets")
def register_asset(payload: dict = Body(...)):
    """仅登记元数据（引用已存在磁盘文件，不复制）"""
    file_path = (payload.get("file_path") or "").strip()
    if not file_path:
        raise HTTPException(400, "file_path 必填")
    abs_path = file_path if os.path.isabs(file_path) else os.path.join(_ROOT, file_path)
    orig_name = payload.get("original_filename") or os.path.basename(file_path)
    ext = os.path.splitext(orig_name)[1].lower()
    mime = mimetypes.guess_type(orig_name)[0] or ""
    mtype = payload.get("media_type") or _media_type(ext, mime)
    size = os.path.getsize(abs_path) if os.path.exists(abs_path) else 0
    fhash = _hash_file(abs_path) if os.path.exists(abs_path) else ""

    db = _rw()
    try:
        w = h = 0; dur = 0.0
        if os.path.exists(abs_path):
            if mtype == "image":
                w, h = _probe_image(abs_path)
            elif mtype == "video":
                w, h, dur = _probe_video(abs_path)
        cur = db.execute(
            """INSERT INTO project_assets
               (filename, original_filename, file_path, file_size, media_type, mime_type,
                width, height, duration, file_hash, project_id, owner_user_id,
                notes, gen_prompt, gen_model, gen_params_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            [os.path.basename(file_path), orig_name, file_path.replace("\\", "/"), size, mtype, mime,
             w, h, dur, fhash, payload.get("project_id"), payload.get("owner_user_id"),
             payload.get("notes", ""), payload.get("gen_prompt", ""),
             payload.get("gen_model", ""), json.dumps(payload.get("gen_params", {}), ensure_ascii=False)]
        )
        _safe_commit(db)
        row = dict(db.execute("SELECT * FROM project_assets WHERE id=?", [cur.lastrowid]).fetchone())
        _enrich(db, row)
        return {"ok": True, "asset": row}
    finally:
        db.close()


@router.put("/assets/{asset_id}")
def update_asset(asset_id: int, payload: dict = Body(...)):
    db = _rw()
    try:
        row = db.execute("SELECT id FROM project_assets WHERE id=?", [asset_id]).fetchone()
        if not row:
            raise HTTPException(404, "资产不存在")
        fields, params = [], []
        for k in ("original_filename", "notes", "gen_prompt", "gen_model", "project_id", "media_type"):
            if k in payload:
                fields.append(f"{k}=?"); params.append(payload[k])
        if "gen_params" in payload:
            fields.append("gen_params_json=?"); params.append(json.dumps(payload["gen_params"], ensure_ascii=False))
        if not fields:
            raise HTTPException(400, "无更新字段")
        fields.append("updated_at=datetime('now','localtime')")
        db.execute(f"UPDATE project_assets SET {','.join(fields)} WHERE id=?", params + [asset_id])
        _safe_commit(db)
        out = dict(db.execute("SELECT * FROM project_assets WHERE id=?", [asset_id]).fetchone())
        _enrich(db, out)
        return {"ok": True, "asset": out}
    finally:
        db.close()


@router.delete("/assets/{asset_id}")
def delete_asset(asset_id: int, hard: bool = Query(False)):
    db = _rw()
    try:
        row = db.execute("SELECT file_path FROM project_assets WHERE id=?", [asset_id]).fetchone()
        if not row:
            raise HTTPException(404, "资产不存在")
        if hard:
            db.execute("DELETE FROM project_assets WHERE id=?", [asset_id])
            _safe_commit(db)
            return {"ok": True, "hard_deleted": True}
        db.execute("UPDATE project_assets SET is_deleted=1, updated_at=datetime('now','localtime') WHERE id=?", [asset_id])
        _safe_commit(db)
        return {"ok": True, "soft_deleted": True}
    finally:
        db.close()


@router.post("/assets/{asset_id}/restore")
def restore_asset(asset_id: int):
    db = _rw()
    try:
        db.execute("UPDATE project_assets SET is_deleted=0, updated_at=datetime('now','localtime') WHERE id=?", [asset_id])
        _safe_commit(db)
        return {"ok": True}
    finally:
        db.close()


# ============================================================
# 文件服务
# ============================================================

def _abs_file(db, asset_id: int):
    row = db.execute("SELECT file_path, original_filename, mime_type FROM project_assets WHERE id=?", [asset_id]).fetchone()
    if not row:
        raise HTTPException(404, "资产不存在")
    fp = row["file_path"]
    abs_path = fp if os.path.isabs(fp) else os.path.join(_ROOT, fp)
    if not os.path.exists(abs_path):
        raise HTTPException(404, "文件丢失")
    return abs_path, row["original_filename"], row["mime_type"]


@router.get("/assets/{asset_id}/file")
def serve_file(asset_id: int):
    db = _rw()
    try:
        abs_path, name, mime = _abs_file(db, asset_id)
    finally:
        db.close()
    return FileResponse(abs_path, media_type=mime or None)


@router.get("/assets/{asset_id}/download")
def download_file(asset_id: int):
    db = _rw()
    try:
        abs_path, name, mime = _abs_file(db, asset_id)
    finally:
        db.close()
    return FileResponse(abs_path, media_type=mime or "application/octet-stream", filename=name or None)


# ============================================================
# 标签
# ============================================================

@router.post("/assets/{asset_id}/tags")
def add_tags(asset_id: int, payload: dict = Body(...)):
    tags = payload.get("tags") or ([payload["tag"]] if payload.get("tag") else [])
    db = _rw()
    try:
        added = []
        for t in [str(x).strip() for x in tags if str(x).strip()]:
            db.execute("INSERT OR IGNORE INTO asset_tags (asset_id, tag) VALUES (?,?)", [asset_id, t])
            added.append(t)
        _safe_commit(db)
        cur = [r["tag"] for r in db.execute("SELECT tag FROM asset_tags WHERE asset_id=? ORDER BY tag", [asset_id]).fetchall()]
        return {"ok": True, "added": added, "tags": cur}
    finally:
        db.close()


@router.delete("/assets/{asset_id}/tags/{tag}")
def remove_tag(asset_id: int, tag: str):
    db = _rw()
    try:
        db.execute("DELETE FROM asset_tags WHERE asset_id=? AND tag=?", [asset_id, tag])
        _safe_commit(db)
        return {"ok": True}
    finally:
        db.close()


@router.get("/tags")
def all_tags():
    db = _rw()
    try:
        rows = _rows(db.execute(
            "SELECT tag, COUNT(*) c FROM asset_tags GROUP BY tag ORDER BY c DESC, tag").fetchall())
        return {"ok": True, "tags": rows}
    finally:
        db.close()


# ============================================================
# 评分
# ============================================================

@router.post("/assets/{asset_id}/rate")
def rate_asset(asset_id: int, payload: dict = Body(...)):
    rating = int(payload.get("rating", 0))
    user_id = int(payload.get("user_id", 0))
    if rating < 0 or rating > 5:
        raise HTTPException(400, "评分需 0-5")
    db = _rw()
    try:
        db.execute(
            """INSERT INTO asset_ratings (asset_id, user_id, rating) VALUES (?,?,?)
               ON CONFLICT(asset_id, user_id) DO UPDATE SET rating=excluded.rating, created_at=datetime('now','localtime')""",
            [asset_id, user_id, rating])
        avg_r = _recalc_rating(db, asset_id)
        _safe_commit(db)
        return {"ok": True, "avg_rating": avg_r}
    finally:
        db.close()


# ============================================================
# 版本链
# ============================================================

@router.get("/assets/{asset_id}/versions")
def list_versions(asset_id: int):
    db = _rw()
    try:
        rows = _rows(db.execute(
            "SELECT * FROM asset_versions WHERE asset_id=? ORDER BY version DESC", [asset_id]).fetchall())
        return {"ok": True, "versions": rows}
    finally:
        db.close()


@router.post("/assets/{asset_id}/versions")
async def add_version(asset_id: int, file: UploadFile = File(...), notes: str = Form("")):
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "空文件")
    fhash = _hash_bytes(raw)
    ext = os.path.splitext(file.filename or "")[1].lower()
    db = _rw()
    try:
        base = db.execute("SELECT id FROM project_assets WHERE id=?", [asset_id]).fetchone()
        if not base:
            raise HTTPException(404, "资产不存在")
        nextv = (db.execute("SELECT MAX(version) m FROM asset_versions WHERE asset_id=?", [asset_id]).fetchone()["m"] or 0) + 1
        sub = os.path.join(STORAGE, "versions", str(asset_id))
        os.makedirs(sub, exist_ok=True)
        stored = f"v{nextv}_{fhash[:12]}{ext}"
        abs_path = os.path.join(sub, stored)
        rel_path = os.path.relpath(abs_path, _ROOT).replace("\\", "/")
        with open(abs_path, "wb") as f:
            f.write(raw)
        db.execute("INSERT INTO asset_versions (asset_id, version, file_path, file_hash, notes) VALUES (?,?,?,?,?)",
                   [asset_id, nextv, rel_path, fhash, notes])
        # 更新主资产 version_chain 计数标记
        db.execute("UPDATE project_assets SET version_chain=?, updated_at=datetime('now','localtime') WHERE id=?",
                   [f"v{nextv}", asset_id])
        _safe_commit(db)
        return {"ok": True, "version": nextv, "file_path": rel_path}
    finally:
        db.close()


# ============================================================
# 溯源关联（ref_type: prompt | word_card | scene | atom）
# ============================================================

@router.post("/assets/{asset_id}/link")
def link_ref(asset_id: int, payload: dict = Body(...)):
    ref_type = (payload.get("ref_type") or "").strip()
    ref_id = payload.get("ref_id")
    if not ref_type or ref_id is None:
        raise HTTPException(400, "ref_type 与 ref_id 必填")
    db = _rw()
    try:
        db.execute("INSERT OR IGNORE INTO asset_prompt_ref (asset_id, ref_type, ref_id, created_at) VALUES (?,?,?,datetime('now','localtime'))",
                   [asset_id, ref_type, int(ref_id)])
        _safe_commit(db)
        refs = _rows(db.execute("SELECT * FROM asset_prompt_ref WHERE asset_id=?", [asset_id]).fetchall())
        return {"ok": True, "refs": refs}
    finally:
        db.close()


@router.delete("/assets/{asset_id}/link/{ref_type}/{ref_id}")
def unlink_ref(asset_id: int, ref_type: str, ref_id: int):
    db = _rw()
    try:
        db.execute("DELETE FROM asset_prompt_ref WHERE asset_id=? AND ref_type=? AND ref_id=?",
                   [asset_id, ref_type, ref_id])
        _safe_commit(db)
        return {"ok": True}
    finally:
        db.close()


@router.get("/assets/{asset_id}/refs")
def list_refs(asset_id: int):
    db = _rw()
    try:
        refs = _rows(db.execute("SELECT * FROM asset_prompt_ref WHERE asset_id=?", [asset_id]).fetchall())
        # 反查关联对象名称（尽力）
        for r in refs:
            r["ref_name"] = _resolve_ref_name(db, r["ref_type"], r["ref_id"])
        return {"ok": True, "refs": refs}
    finally:
        db.close()


def _resolve_ref_name(db, ref_type: str, ref_id: int) -> str:
    try:
        if ref_type == "word_card":
            row = db.execute("SELECT title FROM word_card WHERE id=?", [ref_id]).fetchone()
            return row["title"] if row else ""
        if ref_type in ("prompt", "prompt_card"):
            for tbl, col in (("prompt_cards", "title"), ("prompts", "content")):
                try:
                    row = db.execute(f"SELECT {col} v FROM {tbl} WHERE id=?", [ref_id]).fetchone()
                    if row:
                        return (row["v"] or "")[:40]
                except Exception:
                    continue
    except Exception:
        pass
    return ""


# ============================================================
# 去重检测
# ============================================================

@router.post("/scan-duplicates")
def scan_duplicates():
    """全库扫描 file_hash 重复，写入 asset_duplicates"""
    db = _rw()
    try:
        db.execute("DELETE FROM asset_duplicates")
        groups = _rows(db.execute(
            """SELECT file_hash, COUNT(*) c, MIN(id) keep_id FROM project_assets
               WHERE is_deleted=0 AND file_hash!='' GROUP BY file_hash HAVING c>1""").fetchall())
        dup_count = 0
        for g in groups:
            dups = db.execute("SELECT id FROM project_assets WHERE file_hash=? AND is_deleted=0 AND id!=?",
                              [g["file_hash"], g["keep_id"]]).fetchall()
            for d in dups:
                db.execute("INSERT INTO asset_duplicates (asset_id, duplicate_of) VALUES (?,?)",
                           [d["id"], g["keep_id"]])
                dup_count += 1
        _safe_commit(db)
        return {"ok": True, "duplicate_groups": len(groups), "duplicate_assets": dup_count}
    finally:
        db.close()


@router.get("/duplicates")
def list_duplicates():
    db = _rw()
    try:
        rows = _rows(db.execute(
            """SELECT ad.*, pa.original_filename, pa.file_hash
               FROM asset_duplicates ad JOIN project_assets pa ON pa.id=ad.asset_id
               ORDER BY ad.duplicate_of""").fetchall())
        return {"ok": True, "duplicates": rows}
    finally:
        db.close()


# ============================================================
# 统计
# ============================================================

@router.get("/stats")
def stats(project_id: Optional[int] = Query(None)):
    db = _rw()
    try:
        pf = "AND project_id=?" if project_id is not None else ""
        pp = [project_id] if project_id is not None else []
        total = db.execute(f"SELECT COUNT(*) c FROM project_assets WHERE is_deleted=0 {pf}", pp).fetchone()["c"]
        by_type = _rows(db.execute(
            f"SELECT media_type, COUNT(*) c FROM project_assets WHERE is_deleted=0 {pf} GROUP BY media_type", pp).fetchall())
        size = db.execute(f"SELECT COALESCE(SUM(file_size),0) s FROM project_assets WHERE is_deleted=0 {pf}", pp).fetchone()["s"]
        rated = db.execute(f"SELECT COUNT(*) c FROM project_assets WHERE is_deleted=0 AND rating>0 {pf}", pp).fetchone()["c"]
        trashed = db.execute("SELECT COUNT(*) c FROM project_assets WHERE is_deleted=1").fetchone()["c"]
        tag_count = db.execute("SELECT COUNT(DISTINCT tag) c FROM asset_tags").fetchone()["c"]
        dup = db.execute("SELECT COUNT(*) c FROM asset_duplicates").fetchone()["c"]
        return {
            "ok": True,
            "total": total, "by_type": by_type, "total_size": size,
            "total_size_mb": round(size / 1048576, 2), "rated": rated,
            "trashed": trashed, "tag_count": tag_count, "duplicates": dup,
        }
    finally:
        db.close()
