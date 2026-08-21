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

from pydantic import BaseModel

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


# ==================== 基底素材预处理（v5.50.7） ====================

BASE_REF_DIR = os.path.join(DATA_DIR, "base_refs")
os.makedirs(BASE_REF_DIR, exist_ok=True)

# 允许的画幅比例（键 → 裁剪目标宽高比）
BASE_RATIOS = {
    "1:1": (1.0, 1.0),
    "3:4": (0.75, 1.0),
    "4:3": (1.0, 0.75),
    "9:16": (0.5625, 1.0),
    "16:9": (1.0, 0.5625),
}

MAX_BASE_SIZE = 1536  # 预处理后最大边长（对齐生成平台输入限制）


class BaseProcessReq(BaseModel):
    url: str = ""          # 原图 URL（/api/seedance/v2/refs/file/xxx 或 /api/thumbnails/original/xxx）
    file_path: str = ""    # 或本地文件路径
    ratio: str = "1:1"     # 目标比例（1:1/3:4/4:3/9:16/16:9）
    crop: dict = {}        # 手动裁剪 {x, y, w, h}（可选，0-1 相对值）


@router.post("/api/assemble/base-process")
def process_base_image(data: BaseProcessReq, request: Request):
    """基底素材预处理：加载 → 可选手动裁剪 → 按目标比例居中裁剪 → 限制尺寸 → 输出预览
    返回 {url, preview_url, width, height, ratio}，供前端预览与后续生成使用
    """
    _auth(request)
    try:
        from PIL import Image, ImageOps
    except ImportError:
        raise HTTPException(500, "Pillow 未安装")
    # 1. 定位源图
    src = None
    if data.file_path and os.path.isfile(data.file_path):
        src = data.file_path
    elif data.url:
        for prefix, base in [("/api/seedance/v2/refs/file/", os.path.join(DATA_DIR, "video_refs")),
                             ("/api/thumbnails/original/", ORIGINALS_DIR),
                             ("/api/thumbnails/file/", THUMB_DIR)]:
            if prefix in data.url:
                fname = os.path.basename(data.url.split(prefix)[-1])
                cand = os.path.join(base, fname)
                if os.path.isfile(cand):
                    src = cand
                    break
    if not src:
        raise HTTPException(400, "无法定位源图（需 file_path 或本服务 URL）")
    # 2. 打开 + EXIF 方向修正
    try:
        img = Image.open(src)
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGB")
    except Exception as e:
        raise HTTPException(400, f"图片解码失败: {e}")
    # 3. 手动裁剪（相对坐标 0-1）
    crop = data.crop or {}
    if crop.get("w") and crop.get("h"):
        W, H = img.size
        x = max(0.0, min(1.0, float(crop.get("x") or 0)))
        y = max(0.0, min(1.0, float(crop.get("y") or 0)))
        w = max(0.05, min(1.0, float(crop.get("w"))))
        h = max(0.05, min(1.0, float(crop.get("h"))))
        box = (int(x * W), int(y * H), int((x + w) * W), int((y + h) * H))
        img = img.crop(box)
    # 4. 按目标比例居中裁剪
    ratio_key = data.ratio or "1:1"
    target = BASE_RATIOS.get(ratio_key)
    if not target:
        raise HTTPException(400, f"无效比例 {ratio_key}，支持: {', '.join(BASE_RATIOS.keys())}")
    tw, th = target
    img = _center_crop(img, tw, th)
    # 5. 限制尺寸（等比缩放）
    img = _limit_size(img, MAX_BASE_SIZE)
    # 6. 保存处理结果 + 预览
    import uuid as _uuid
    token = _uuid.uuid4().hex[:10]
    out_name = f"base_{token}.jpg"
    prev_name = f"base_{token}_prev.jpg"
    out_path = os.path.join(BASE_REF_DIR, out_name)
    prev_path = os.path.join(BASE_REF_DIR, prev_name)
    img.save(out_path, "JPEG", quality=90)
    prev = _limit_size(img, 640)
    prev.save(prev_path, "JPEG", quality=82)
    w, h = img.size
    return {
        "ok": True,
        "file_path": out_path,
        "url": f"/api/assemble/base-ref/{out_name}",
        "preview_url": f"/api/assemble/base-ref/{prev_name}",
        "width": w, "height": h,
        "ratio": ratio_key,
    }


@router.get("/api/assemble/base-ref/{filename}")
def serve_base_ref(filename: str):
    """提供处理后的基底图预览"""
    safe = os.path.basename(filename)
    p = os.path.join(BASE_REF_DIR, safe)
    if not os.path.isfile(p):
        raise HTTPException(404, "文件不存在")
    return FileResponse(p, media_type="image/jpeg")


def _center_crop(img, target_w_ratio, target_h_ratio):
    """按目标宽高比居中裁剪"""
    w, h = img.size
    target = target_w_ratio / target_h_ratio
    cur = w / h
    if cur > target:  # 太宽 → 裁左右
        new_w = int(h * target)
        x = (w - new_w) // 2
        return img.crop((x, 0, x + new_w, h))
    elif cur < target:  # 太高 → 裁上下
        new_h = int(w / target)
        y = (h - new_h) // 2
        return img.crop((0, y, w, y + new_h))
    return img


def _limit_size(img, max_side):
    """等比缩放到最大边长"""
    w, h = img.size
    if max(w, h) <= max_side:
        return img
    scale = max_side / max(w, h)
    return img.resize((int(w * scale), int(h * scale)), 2)  # LANCZOS


# ==================== 生成平台能力清单（v5.50.7） ====================

GENERATION_PLATFORMS = {
    "dreamina": {
        "label": "即梦 Dreamina",
        "engines": ["text2image", "image2image", "upscale", "text2video", "image2video"],
        "params": {
            "model_version": ["3.0", "3.1", "4.0", "4.1", "4.5", "4.6", "4.7", "5.0", "5.0Pro"],
            "ratio": ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"],
            "resolution_type": ["1k", "2k", "4k"],
        },
    },
    "comfyui": {
        "label": "ComfyUI（本机）",
        "engines": ["text2image", "image2image"],
        "params": {
            "workflow_id": "工作流 ID（留空用默认）",
            "ratio": ["1:1", "3:4", "4:3", "9:16", "16:9"],
            "size": "1024（基础边长，SD1.5 自动降 512）",
        },
    },
}


@router.get("/api/assemble/platforms")
def list_generation_platforms(request: Request):
    """生成平台能力清单（前端渲染平台切换器）"""
    _auth(request)
    return {"ok": True, "platforms": GENERATION_PLATFORMS,
            "active": "dreamina", "default": "dreamina"}
