# -*- coding: utf-8 -*-
"""
角色组装产出归档 API — v5.49.0 资产互通与存档
能力：
  1. rolecard 工程存档：批次产物 → project_role + project_role_asset 归档（复用角色档案体系）
  2. 整合人设拼贴图 + 角色色卡合成（Pillow）
  3. 全套资产压缩包导出（zip）
"""
import io as _io
import json
import os
import re
import sqlite3
import time
import zipfile

from fastapi import APIRouter, Body, HTTPException, Query, Request
from fastapi.responses import FileResponse

try:
    from paths import get_data_dir
    DATA_DIR = get_data_dir()
except Exception:
    DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data"))

from jwt_auth import get_current_user

from .style_suits import _db as _suit_db
from .assemble import OUTPUT_PARTS

router = APIRouter(tags=["角色组装产出归档"])

DB = os.path.join(DATA_DIR, "prompts.db")
ROLE_ASSET_DIR = os.path.join(DATA_DIR, "role_assets")
ROLE_THUMB_DIR = os.path.join(DATA_DIR, "role_thumbs")
THUMB_DIR = os.path.join(DATA_DIR, "thumbnails")
ORIGINALS_DIR = os.path.join(DATA_DIR, "originals")
CARD_GEN_DIR = os.path.join(DATA_DIR, "card_gen")
ARCHIVE_DIR = os.path.join(DATA_DIR, "rolecard_archives")
os.makedirs(ROLE_ASSET_DIR, exist_ok=True)
os.makedirs(ROLE_THUMB_DIR, exist_ok=True)
os.makedirs(ARCHIVE_DIR, exist_ok=True)


def _db():
    return _suit_db()


def _now():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _auth(request, require=True):
    u = get_current_user(request)
    if require and not (u and u.get("authenticated")):
        raise HTTPException(401, "请先登录")
    return u


def _safe(name):
    name = os.path.basename(name or "file")
    return (re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip() or "file")[:180]


def _resolve_task_file(task) -> str | None:
    """解析任务产物本地文件路径（图片原图 / 视频文件）"""
    fname = task.get("result_original") or task.get("result_filename") or ""
    if not fname:
        return None
    # 遍历候选目录
    for base in (ORIGINALS_DIR, THUMB_DIR, CARD_GEN_DIR,
                 os.path.join(CARD_GEN_DIR, "videos"), DATA_DIR):
        p = os.path.join(base, fname)
        if os.path.isfile(p):
            return p
    return None


def _batch_with_tasks(batch_id: int):
    c = _db()
    try:
        r = c.execute("SELECT * FROM render_batch WHERE id=?", [batch_id]).fetchone()
        if not r:
            raise HTTPException(404, "批次不存在")
        task_ids = json.loads(r["task_ids"] or "[]")
        tasks = []
        # v5.49.0: task_ids 支持 [{task_id, part}]（新）或 [int]（旧）
        id_list = []
        part_map = {}
        for x in task_ids:
            if isinstance(x, dict):
                tid = int(x.get("task_id") or 0)
                id_list.append(tid)
                part_map[tid] = x.get("part") or ""
            else:
                id_list.append(int(x))
        if id_list:
            q = ",".join("?" * len(id_list))
            for row in c.execute(
                f"SELECT id, task_type, status, result_filename, result_original, fail_category FROM card_gen_tasks WHERE id IN ({q})",
                id_list).fetchall():
                t = dict(row)
                t["part"] = part_map.get(t["id"], "")
                tasks.append(t)
        return dict(r), tasks
    finally:
        c.close()


def _task_label(task) -> str:
    """优先用 part（配件名），回退 task_type 映射"""
    part = task.get("part") or ""
    if part and part in OUTPUT_PARTS:
        return OUTPUT_PARTS[part].get("label") or part
    ttype = task.get("task_type") or ""
    for k, v in OUTPUT_PARTS.items():
        if v.get("task_type") == ttype:
            return v.get("label") or k
    return ttype or "未知"


def _compose_layout(pillow, imgs, template: str, bg_color: str, title_text: str):
    """按布局模板拼贴多张资产图，返回 PIL Image"""
    W, H = 1920, 1080
    try:
        bg = tuple(int(bg_color.lstrip("#")[i:i+2], 16) for i in (0, 2, 4))
    except Exception:
        bg = (26, 26, 46)
    canvas = pillow.new("RGB", (W, H), bg)
    n = len(imgs)
    if n == 0:
        return canvas
    if template == "wide" and n >= 2:
        cols = n
        rows = 1
    elif template == "grid4":
        cols = 4
        rows = (n + 3) // 4
    else:  # default / portrait
        cols = min(n, 3)
        rows = (n + cols - 1) // cols
    pad = 20
    cw = (W - pad * (cols + 1)) // max(cols, 1)
    ch = (H - pad * (rows + 1) - (60 if title_text else 0)) // max(rows, 1)
    for i, img in enumerate(imgs):
        r, c = divmod(i, cols)
        x = pad + c * (cw + pad)
        y = pad + r * (ch + pad)
        try:
            img = img.copy()
            img.thumbnail((cw, ch))
            canvas.paste(img, (x, y))
        except Exception:
            pass
    if title_text:
        try:
            from PIL import ImageDraw
            d = ImageDraw.Draw(canvas)
            d.text((pad, H - 40), title_text, fill=(255, 255, 255))
        except Exception:
            pass
    return canvas


def _extract_color_card(pillow, img, n_colors=6):
    """提取主角色色卡（量化主色）"""
    try:
        small = img.copy().resize((64, 64))
        q = small.quantize(colors=n_colors, method=2)
        pal = q.getpalette() or []
        counts = {}
        for px in q.getdata():
            counts[px] = counts.get(px, 0) + 1
        top = sorted(counts.items(), key=lambda x: -x[1])[:n_colors]
        colors = []
        for idx, cnt in top:
            r, g, b = pal[idx*3:idx*3+3]
            colors.append({"hex": "#%02x%02x%02x" % (r, g, b), "ratio": round(cnt / (64*64), 3)})
        return colors
    except Exception:
        return []


@router.post("/api/assemble/render/{batch_id}/compose")
def compose_role_sheet(batch_id: int, request: Request, data: dict = Body({})):
    """整合人设拼贴大图 + 角色色卡（Pillow 合成）body: {template, title_text, bg_color}"""
    _auth(request)
    template = data.get("template") or "default"
    title_text = data.get("title_text") or ""
    bg_color = data.get("bg_color") or "#1a1a2e"
    batch, tasks = _batch_with_tasks(batch_id)
    try:
        from PIL import Image as PILImage
    except ImportError:
        raise HTTPException(500, "Pillow 未安装")
    imgs = []
    for t in tasks:
        if t["status"] not in ("done", "success"):
            continue
        p = _resolve_task_file(t)
        if p:
            try:
                imgs.append(PILImage.open(p).convert("RGB"))
            except Exception:
                pass
    if not imgs:
        raise HTTPException(400, "批次暂无已完成的图片资产")
    canvas = _compose_layout(PILImage, imgs, template, bg_color, title_text)
    # 主图取第一张提取色卡
    colors = _extract_color_card(PILImage, imgs[0])
    fname = f"rolesheet_{batch_id}_{int(time.time())}.jpg"
    dest = os.path.join(THUMB_DIR, fname)
    canvas.save(dest, "JPEG", quality=88)
    return {"ok": True, "image": f"/api/thumbnails/file/{fname}", "filename": fname,
            "colors": colors, "asset_count": len(imgs)}


@router.post("/api/assemble/render/{batch_id}/archive")
def archive_rolecard(batch_id: int, request: Request, data: dict = Body({})):
    """rolecard 工程存档：批次产物 → project_role + project_role_asset 归档
    body: {master_project_id, name, asset_kind_map}
    """
    u = _auth(request)
    master_project_id = int(data.get("master_project_id") or 0)
    name = data.get("name") or ""
    asset_kind_map = data.get("asset_kind_map") or ""
    batch, tasks = _batch_with_tasks(batch_id)
    done_tasks = [t for t in tasks if t["status"] in ("done", "success")]
    if not done_tasks:
        raise HTTPException(400, "批次无已完成的资产可归档")
    if not master_project_id:
        raise HTTPException(400, "请指定 master_project_id（总项目）")
    role_name = (name or batch.get("suit_name") or f"角色资产批次{batch_id}").strip() or f"角色资产批次{batch_id}"
    try:
        kind_map = json.loads(asset_kind_map) if asset_kind_map else {}
    except Exception:
        kind_map = {}
    c = _db()
    try:
        # 1. 创建 project_role（settings_json 记录批次/套装信息）
        settings = {
            "source": "style_suit",
            "batch_id": batch_id,
            "suit_id": batch.get("suit_id"),
            "channel": batch.get("channel"),
            "created_by": "assemble_archive",
        }
        c.execute("""INSERT INTO project_role (master_project_id, role_type, name, settings_json, owner_user_id, created_at, updated_at)
                     VALUES (?,?,?,?,?,?,?)""",
                  [master_project_id, "character", role_name,
                   json.dumps(settings, ensure_ascii=False),
                   u.get("id") if u else None, _now(), _now()])
        rid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
        rdir = os.path.join(ROLE_ASSET_DIR, "role%d" % rid)
        os.makedirs(rdir, exist_ok=True)
        # 2. 归档每个任务产物
        archived = 0
        for t in done_tasks:
            p = _resolve_task_file(t)
            if not p:
                continue
            ext = os.path.splitext(p)[1].lower()
            label = _task_label(t)
            fname = _safe(f"{label}_{t['id']}{ext}")
            dest = os.path.join(rdir, fname)
            import shutil
            shutil.copy2(p, dest)
            rel = os.path.relpath(dest, DATA_DIR).replace("\\", "/")
            kind = kind_map.get(t.get("task_type") or "", "") or (
                "three_view" if t.get("task_type") == "text2image" and "three" in label else "material")
            c.execute("""INSERT INTO project_role_asset (project_role_id, asset_kind, filename, rel_path, caption, size)
                         VALUES (?,?,?,?,?,?)""",
                      [rid, kind, fname, rel, label, os.path.getsize(dest)])
            # 封面
            cover = c.execute("SELECT cover_image FROM project_role WHERE id=?", [rid]).fetchone()["cover_image"]
            if not cover:
                c.execute("UPDATE project_role SET cover_image=? WHERE id=?", [rel, rid])
            archived += 1
        # 版本快照
        try:
            from .project_roles import _snapshot as role_snapshot
            role_snapshot(c, rid, json.dumps(settings, ensure_ascii=False), role_name, u, note="组装归档")
        except Exception:
            pass
        c.execute("UPDATE project_role SET version_count=COALESCE(version_count,0)+1 WHERE id=?", [rid])
        c.commit()
        return {"ok": True, "role_id": rid, "name": role_name, "archived": archived}
    finally:
        c.close()


@router.get("/api/assemble/render/{batch_id}/export")
def export_batch_assets(batch_id: int, request: Request):
    """导出全套资产压缩包（zip：图片原图 + 拼贴图 + 批次信息）"""
    _auth(request)
    batch, tasks = _batch_with_tasks(batch_id)
    done_tasks = [t for t in tasks if t["status"] in ("done", "success")]
    zname = f"rolecard_batch{batch_id}_{int(time.time())}.zip"
    zpath = os.path.join(ARCHIVE_DIR, zname)
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as zf:
        added = 0
        for t in done_tasks:
            p = _resolve_task_file(t)
            if not p:
                continue
            ext = os.path.splitext(p)[1].lower()
            label = _task_label(t)
            arc = f"{added:02d}_{label}{ext}"
            zf.write(p, arcname=arc)
            added += 1
        # 批次信息
        info = {
            "batch_id": batch_id,
            "suit_id": batch.get("suit_id"),
            "channel": batch.get("channel"),
            "created_at": batch.get("created_at"),
            "assets": [{"label": _task_label(t), "status": t["status"],
                        "file": t.get("result_filename") or t.get("result_original")} for t in done_tasks],
        }
        zf.writestr("batch_info.json", json.dumps(info, ensure_ascii=False, indent=2))
    if added == 0:
        raise HTTPException(400, "批次无已完成的资产可导出")
    return FileResponse(zpath, media_type="application/zip",
                        filename=f"rolecard_batch{batch_id}.zip")
