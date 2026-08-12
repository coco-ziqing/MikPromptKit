# -*- coding: utf-8 -*-
"""
即梦历史资产导入模块（v5.36.13）
从即梦 CLI 本地任务库（~/.dreamina_cli/tasks.db）拉取账号历史生成数据，
下载媒体资产到本地 data/dreamina_assets/，并以词卡模版式归档到词库「即梦历史资产」分组。
路由挂载: seedance_v2.py include_router，prefix 同为 /api/seedance/v2
"""
import json
import os
import time

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import FileResponse

from database import get_db, safe_commit
from api.dreamina import DREAMINA_BIN, _dreamina_run

router = APIRouter(tags=["seedance-v2-assets"])

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSET_DIR = os.path.join(_PROJECT_ROOT, "data", "dreamina_assets")
IMG_DIR = os.path.join(ASSET_DIR, "images")
VID_DIR = os.path.join(ASSET_DIR, "videos")
CLI_TASKS_DB = os.path.expanduser("~/.dreamina_cli/tasks.db")

# 词卡归档分组（group_type=seedance，词库可见）
ASSET_GROUP_NAME = "即梦历史资产"
ASSET_GROUP_SUBTYPE = "dreamina_asset"

_ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".mp4", ".mov", ".webm"}
_IMPORT_BATCH_LIMIT = 50


def _now_str():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _ensure_asset_table():
    db = get_db()
    db.execute("""CREATE TABLE IF NOT EXISTS dreamina_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submit_id TEXT UNIQUE,
        asset_type TEXT DEFAULT 'image',
        gen_task_type TEXT DEFAULT '',
        prompt TEXT DEFAULT '',
        model_version TEXT DEFAULT '',
        ratio TEXT DEFAULT '',
        resolution TEXT DEFAULT '',
        duration REAL DEFAULT 0,
        credit_count INTEGER DEFAULT 0,
        gen_status TEXT DEFAULT 'success',
        width INTEGER DEFAULT 0,
        height INTEGER DEFAULT 0,
        file_paths TEXT DEFAULT '[]',
        file_size INTEGER DEFAULT 0,
        task_time TEXT DEFAULT '',
        imported_at TEXT,
        word_card_id INTEGER DEFAULT 0,
        is_deleted INTEGER DEFAULT 0
    )""")
    # v5.36.14: 网页通道列（幂等 PRAGMA 探测）
    cols = [r["name"] for r in db.execute("PRAGMA table_info(dreamina_assets)").fetchall()]
    if "source" not in cols:
        db.execute("ALTER TABLE dreamina_assets ADD COLUMN source TEXT DEFAULT 'cli'")
        print("[Dreamina Assets] dreamina_assets 增加列 source")
    if "web_asset_id" not in cols:
        db.execute("ALTER TABLE dreamina_assets ADD COLUMN web_asset_id TEXT DEFAULT ''")
        print("[Dreamina Assets] dreamina_assets 增加列 web_asset_id")
    if "web_url" not in cols:
        db.execute("ALTER TABLE dreamina_assets ADD COLUMN web_url TEXT DEFAULT ''")
        print("[Dreamina Assets] dreamina_assets 增加列 web_url")
    safe_commit()


def _ensure_asset_group() -> int:
    """确保「即梦历史资产」seedance 分组存在，返回 group_id（幂等）"""
    db = get_db()
    row = db.execute(
        "SELECT id FROM word_card_group WHERE group_type='seedance' AND seedance_subtype=? AND is_active=1",
        [ASSET_GROUP_SUBTYPE]).fetchone()
    if row:
        return row["id"]
    # 创建分组：挂到「📹 视频模板」(63) 下，找不到则挂 53 视频词库
    parent = db.execute("SELECT id FROM word_card_group WHERE id=63 AND is_active=1").fetchone()
    parent_id = parent["id"] if parent else 53
    key = "dreamina_asset_" + str(int(time.time() * 1000))
    cur = db.execute(
        "INSERT INTO word_card_group (name, group_key, group_type, seedance_subtype, parent_group_id, sort_order) "
        "VALUES (?, ?, 'seedance', ?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM word_card_group))",
        [ASSET_GROUP_NAME, key, ASSET_GROUP_SUBTYPE, parent_id])
    safe_commit()
    print(f"[Dreamina Assets] 创建即梦历史资产分组 id={cur.lastrowid}")
    return cur.lastrowid


def _cli_db_connect():
    """只读打开 CLI 任务库（不存在时返回 None）"""
    if not os.path.exists(CLI_TASKS_DB):
        return None
    try:
        import sqlite3
        conn = sqlite3.connect(CLI_TASKS_DB, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only=ON")
        return conn
    except Exception as e:
        print(f"[Dreamina Assets] CLI 任务库打开失败: {e}")
        return None


def _parse_cli_task(r):
    """解析 aigc_task 行 → 统一结构（prompt/参数/类型/媒体元数据）"""
    gtype = r["gen_task_type"] or ""
    status = r["gen_status"] or ""
    body = {}
    try:
        req = r["request"]
        if isinstance(req, str):
            req = json.loads(req)
        if isinstance(req, dict):
            b = req.get("body", {})
            if isinstance(b, str):
                b = json.loads(b)
            if isinstance(b, dict):
                body = b
    except Exception:
        pass
    prompt = str(body.get("Prompt") or body.get("prompt") or body.get("text") or "").strip()
    model = str(body.get("ModelVersion") or body.get("model_version") or "").strip()
    ratio = str(body.get("Ratio") or body.get("ratio") or "").strip()
    res = str(body.get("ResolutionType") or body.get("video_resolution") or body.get("resolution") or "").strip()
    try:
        dur = float(body.get("Duration") or body.get("duration") or 0)
    except Exception:
        dur = 0.0
    credit = 0
    try:
        ci = r["commerce_info"]
        if isinstance(ci, str):
            ci = json.loads(ci)
        if isinstance(ci, dict):
            credit = int(ci.get("credit_count") or 0)
    except Exception:
        pass
    width = height = 0
    media_count = 0
    try:
        rj = r["result_json"]
        if isinstance(rj, str):
            rj = json.loads(rj)
        if isinstance(rj, dict):
            imgs = rj.get("images") or []
            vids = rj.get("videos") or []
            media_count = len(imgs) + len(vids)
            if vids:
                width = int(vids[0].get("width") or 0)
                height = int(vids[0].get("height") or 0)
            elif imgs:
                width = int(imgs[0].get("width") or 0)
                height = int(imgs[0].get("height") or 0)
    except Exception:
        pass
    asset_type = "video" if "video" in (gtype or "").lower() else "image"
    ts = r["create_time"]
    task_time = ""
    if ts:
        try:
            task_time = time.strftime("%Y-%m-%d %H:%M", time.localtime(int(ts)))
        except Exception:
            pass
    return {
        "submit_id": r["submit_id"],
        "asset_type": asset_type,
        "gen_task_type": gtype,
        "gen_status": status,
        "prompt": prompt,
        "model_version": model,
        "ratio": ratio,
        "resolution": res,
        "duration": dur,
        "credit_count": credit,
        "width": width,
        "height": height,
        "media_count": media_count or 1,
        "task_time": task_time,
    }


def _all_cli_tasks():
    """读取 CLI 任务库全部任务（解析后）"""
    conn = _cli_db_connect()
    if conn is None:
        return [], False
    try:
        rows = conn.execute(
            "SELECT submit_id, gen_task_type, gen_status, request, result_json, commerce_info, create_time FROM aigc_task"
        ).fetchall()
        tasks = [_parse_cli_task(r) for r in rows]
        return tasks, True
    except Exception as e:
        print(f"[Dreamina Assets] CLI 任务读取失败: {e}")
        return [], False
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _imported_submit_ids():
    db = get_db()
    rows = db.execute("SELECT submit_id FROM dreamina_assets WHERE is_deleted=0").fetchall()
    return {r["submit_id"] for r in rows}


# ==================== API ====================

@router.get("/assets/scan")
def scan_assets(
    page: int = Query(1, ge=1),
    page_size: int = Query(60, ge=1, le=200),
    asset_type: str = Query("all"),          # all | image | video
    gen_status: str = Query("all"),          # all | success | fail | querying
    imported: str = Query("all"),            # all | 1 | 0
):
    """扫描即梦 CLI 任务库：账号历史生成数据（含提示词/参数/状态）"""
    _ensure_asset_table()
    tasks, ok = _all_cli_tasks()
    if not ok:
        raise HTTPException(500, "无法读取即梦 CLI 任务库，请确认已安装并登录即梦 CLI")
    imported_ids = _imported_submit_ids()
    filtered = []
    for t in tasks:
        if asset_type != "all" and t["asset_type"] != asset_type:
            continue
        if gen_status != "all" and t["gen_status"] != gen_status:
            continue
        t["imported"] = t["submit_id"] in imported_ids
        if imported == "1" and not t["imported"]:
            continue
        if imported == "0" and t["imported"]:
            continue
        filtered.append(t)
    total = len(filtered)
    start = (page - 1) * page_size
    items = filtered[start:start + page_size]
    stats = {
        "total": len(tasks),
        "image_total": sum(1 for t in tasks if t["asset_type"] == "image"),
        "video_total": sum(1 for t in tasks if t["asset_type"] == "video"),
        "success_total": sum(1 for t in tasks if t["gen_status"] == "success"),
        "imported_total": len(imported_ids),
    }
    return {"ok": True, "total": total, "page": page, "page_size": page_size, "items": items, "stats": stats,
            "cli_db": CLI_TASKS_DB, "cli_available": os.path.exists(DREAMINA_BIN)}


def _read_cli_task(submit_id: str):
    conn = _cli_db_connect()
    if conn is None:
        return None
    try:
        r = conn.execute(
            "SELECT submit_id, gen_task_type, gen_status, request, result_json, commerce_info, create_time FROM aigc_task WHERE submit_id=?",
            [submit_id]).fetchone()
        return _parse_cli_task(r) if r else None
    except Exception as e:
        print(f"[Dreamina Assets] 读取任务 {submit_id} 失败: {e}")
        return None
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _import_one(submit_id: str):
    """导入单条任务：下载媒体 + 建词卡 + 记录。返回 dict"""
    db = get_db()
    existing = db.execute("SELECT id, is_deleted, word_card_id FROM dreamina_assets WHERE submit_id=?", [submit_id]).fetchone()
    if existing:
        if not existing["is_deleted"]:
            return {"submit_id": submit_id, "status": "skipped", "asset_id": existing["id"]}
        # 软删记录：物理删除后允许重新导入（submit_id 有 UNIQUE 约束）
        db.execute("DELETE FROM dreamina_assets WHERE id=?", [existing["id"]])
        if existing["word_card_id"]:
            try:
                db.execute("DELETE FROM word_card WHERE id=?", [existing["word_card_id"]])
            except Exception:
                pass
    task = _read_cli_task(submit_id)
    if not task:
        return {"submit_id": submit_id, "status": "failed", "error": "任务不存在于即梦 CLI 本地库"}
    if task["gen_status"] != "success":
        return {"submit_id": submit_id, "status": "failed",
                "error": f"任务状态 {task['gen_status']}，仅成功任务可导入"}
    dest_dir = VID_DIR if task["asset_type"] == "video" else IMG_DIR
    os.makedirs(dest_dir, exist_ok=True)
    out, err, code = _dreamina_run(
        ["query_result", "--submit_id=" + submit_id, "--download_dir=" + dest_dir], timeout=300)
    if code != 0 or not out.strip():
        return {"submit_id": submit_id, "status": "failed", "error": err or "CLI 查询无输出"}
    try:
        data = json.loads(out)
    except Exception:
        return {"submit_id": submit_id, "status": "failed", "error": "CLI 输出解析失败"}
    rj = data.get("result_json") or {}
    paths = [i.get("path") for i in (rj.get("images") or []) if i.get("path")]
    paths += [v.get("path") for v in (rj.get("videos") or []) if v.get("path")]
    file_names = []
    total_size = 0
    for p in paths:
        if p and os.path.exists(p):
            file_names.append(os.path.basename(p))
            try:
                total_size += os.path.getsize(p)
            except Exception:
                pass
    if not file_names:
        return {"submit_id": submit_id, "status": "failed", "error": "媒体文件未下载到本地"}

    # 词卡归档（content=提示词，preview_media=首文件，media_type 按实际）
    gid = _ensure_asset_group()
    media_type = "video" if task["asset_type"] == "video" else "image"
    name = f"{task['gen_task_type'] or 'asset'}-{submit_id[:8]}"
    parts = [f"即梦历史资产 · {task['gen_task_type'] or '-'}"]
    if task["model_version"]:
        parts.append(task["model_version"])
    if task["ratio"]:
        parts.append(task["ratio"])
    if task["resolution"]:
        parts.append(task["resolution"])
    if task["duration"]:
        parts.append(f"{task['duration']:g}s")
    if task["task_time"]:
        parts.append(task["task_time"])
    meaning = " · ".join(parts)
    cur = db.execute(
        "INSERT INTO word_card (group_id, name, content, meaning, media_type, preview_media, is_builtin, heat_weight, module, category, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, 0, 0.5, 'dreamina_asset', 'history_asset', datetime('now','localtime'), datetime('now','localtime'))",
        [gid, name, task["prompt"] or "", meaning, media_type, file_names[0]])
    card_id = cur.lastrowid

    cur2 = db.execute(
        "INSERT INTO dreamina_assets (submit_id, asset_type, gen_task_type, prompt, model_version, ratio, resolution, duration, credit_count, gen_status, width, height, file_paths, file_size, task_time, imported_at, word_card_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), ?)",
        [submit_id, task["asset_type"], task["gen_task_type"], task["prompt"] or "", task["model_version"],
         task["ratio"], task["resolution"], task["duration"], task["credit_count"], task["gen_status"],
         task["width"], task["height"], json.dumps(file_names, ensure_ascii=False), total_size,
         task["task_time"], card_id])
    safe_commit()
    return {"submit_id": submit_id, "status": "imported", "asset_id": cur2.lastrowid, "card_id": card_id,
            "files": file_names, "asset_type": task["asset_type"]}


@router.post("/assets/import")
def import_assets(data: dict = Body(...)):
    """批量导入：下载媒体 + 词卡归档（按 submit_id 去重，幂等）"""
    _ensure_asset_table()
    ids = data.get("submit_ids") or []
    if not isinstance(ids, list) or not ids:
        raise HTTPException(400, "submit_ids 必填")
    ids = [str(x).strip() for x in ids if str(x).strip()]
    if len(ids) > _IMPORT_BATCH_LIMIT:
        raise HTTPException(400, f"单次最多导入 {_IMPORT_BATCH_LIMIT} 条")
    results = []
    imported = []
    for sid in ids:
        res = _import_one(sid)
        results.append(res)
        if res["status"] == "imported":
            imported.append(res)
    return {"ok": True, "requested": len(ids), "imported": imported, "results": results}


@router.get("/assets")
def list_imported_assets(page: int = Query(1, ge=1), page_size: int = Query(60, ge=1, le=200),
                         asset_type: str = Query("all")):
    """本地已导入的即梦历史资产"""
    _ensure_asset_table()
    db = get_db()
    where = "is_deleted=0"
    params = []
    if asset_type != "all":
        where += " AND asset_type=?"
        params.append(asset_type)
    total = db.execute(f"SELECT COUNT(*) c FROM dreamina_assets WHERE {where}", params).fetchone()["c"]
    rows = db.execute(
        f"SELECT * FROM dreamina_assets WHERE {where} ORDER BY id DESC LIMIT ? OFFSET ?",
        params + [page_size, (page - 1) * page_size]).fetchall()
    items = []
    for r in rows:
        d = dict(r)
        try:
            d["file_names"] = json.loads(d.get("file_paths") or "[]")
        except Exception:
            d["file_names"] = []
        d["file_url"] = ("/api/seedance/v2/assets/file/" + d["file_names"][0]) if d["file_names"] else ""
        d["preview_url"] = d["file_url"]
        items.append(d)
    return {"ok": True, "total": total, "page": page, "page_size": page_size, "items": items,
            "group_id": _ensure_asset_group(), "group_name": ASSET_GROUP_NAME}


@router.delete("/assets/{asset_id}")
def delete_asset(asset_id: int):
    """删除本地资产（文件 + 词卡软删 + 记录软删）"""
    _ensure_asset_table()
    db = get_db()
    row = db.execute("SELECT * FROM dreamina_assets WHERE id=? AND is_deleted=0", [asset_id]).fetchone()
    if not row:
        raise HTTPException(404, "资产不存在")
    # 删文件
    try:
        names = json.loads(row["file_paths"] or "[]")
        for n in names:
            for base in (IMG_DIR, VID_DIR):
                p = os.path.join(base, os.path.basename(n))
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except Exception as e:
                        print(f"[Dreamina Assets] 文件删除失败 {p}: {e}")
    except Exception:
        pass
    # 词卡软删
    if row["word_card_id"]:
        try:
            db.execute("UPDATE word_card SET is_deleted=1, deleted_at=datetime('now','localtime') WHERE id=?",
                       [row["word_card_id"]])
        except Exception:
            pass
    db.execute("UPDATE dreamina_assets SET is_deleted=1 WHERE id=?", [asset_id])
    safe_commit()
    return {"ok": True}


@router.get("/assets/file/{filename}")
def serve_asset_file(filename: str):
    """提供本地资产文件（图片/视频预览）"""
    safe = os.path.basename(filename)
    ext = os.path.splitext(safe)[1].lower()
    if ext not in _ALLOWED_EXT:
        raise HTTPException(400, "不支持的文件类型")
    for base in (IMG_DIR, VID_DIR):
        p = os.path.join(base, safe)
        if os.path.exists(p):
            return FileResponse(p)
    raise HTTPException(404, "文件不存在")
