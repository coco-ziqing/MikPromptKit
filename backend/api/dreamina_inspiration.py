# -*- coding: utf-8 -*-
"""即梦灵感导入：搜索 → 预览 → 下载归档 → 词卡化
v5.38.32
- 复用 dreamina_assets 表（source='inspiration'）
- 浏览器自动化：灵感页搜索框输入关键词 → 页面自带签名调 get_explore → 拦截响应（零逆向）
"""
import io
import json
import os
import re
import threading
import time
import urllib.request

from fastapi import APIRouter, Request, Query, Body, HTTPException

HERE = os.path.dirname(os.path.abspath(__file__))
try:
    from paths import get_data_dir
    DATA_DIR = get_data_dir()
except Exception:
    DATA_DIR = os.path.abspath(os.path.join(HERE, "..", "..", "data"))

DB = os.path.join(DATA_DIR, "prompts.db")
PROFILE_DIR = os.path.join(DATA_DIR, "dreamina_web_profile")
INSP_DIR = os.path.join(DATA_DIR, "dreamina_inspiration")
DISCOVER_URL = "https://jimeng.jianying.com/ai-tool/home/discover"

router = APIRouter(prefix="/api/dreamina/inspiration", tags=["dreamina-inspiration"])

_IMPORT_LOCK = threading.Lock()  # 防并发启动浏览器


def _db():
    import sqlite3
    c = sqlite3.connect(DB, timeout=30)
    c.row_factory = sqlite3.Row
    return c


def _ensure_table():
    c = _db()
    try:
        cols = [r[1] for r in c.execute("PRAGMA table_info(dreamina_assets)").fetchall()]
        if "source" not in cols:
            c.execute("ALTER TABLE dreamina_assets ADD COLUMN source TEXT DEFAULT 'cli'")
        if "web_asset_id" not in cols:
            c.execute("ALTER TABLE dreamina_assets ADD COLUMN web_asset_id TEXT DEFAULT ''")
        if "inspiration_keyword" not in cols:
            c.execute("ALTER TABLE dreamina_assets ADD COLUMN inspiration_keyword TEXT DEFAULT ''")
        c.commit()
    finally:
        c.close()


def _now_str():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _parse_item(it: dict) -> dict:
    """解析 get_explore item → 结构化灵感数据（v5.38.37: 支持视频）"""
    ca = it.get("common_attr") or {}
    ap = it.get("aigc_image_params") or {}
    tip = ap.get("text2image_params") or {}
    vid = it.get("video") or {}
    media_type = "video" if vid else ("image" if tip else "unknown")
    if media_type == "video":
        # 视频：无提示词（即梦视频灵感不公开 prompt），存视频直链 + 标题
        prompt = (ca.get("title") or "").strip()
        ref_prompt = ""
        # v5.38.38: video_model 是流配置 JSON 串（非模型名），视频灵感不公开模型 → 置空
        model = ""
        ratio_txt = ""
        ov = vid.get("origin_video") or {}
        vid_url = ov.get("video_url") or ""
        vw = ov.get("width", 0)
        vh = ov.get("height", 0)
        if vw and vh:
            g = _gcd(vw, vh)
            ratio_txt = f"{vw // g}:{vh // g}"
        else:
            # 兜底：common_attr.aspect_ratio 浮点（如 0.75 → 3:4）
            ar = ca.get("aspect_ratio")
            if isinstance(ar, (int, float)) and ar > 0:
                from fractions import Fraction
                f = Fraction(ar).limit_denominator(20)
                ratio_txt = f"{f.numerator}:{f.denominator}"
        return {
            "web_asset_id": str(ca.get("id") or it.get("id") or ""),
            "media_type": "video",
            "prompt": prompt,
            "reference_prompt": "",
            "model_version": model,
            "ratio": ratio_txt,
            "image_url": vid_url,          # 视频直链
            "cover_url": vid.get("cover_url") or ca.get("cover_url") or "",
            "width": vw,
            "height": vh,
            "title": (ca.get("title") or "").strip(),
            "duration": vid.get("duration") or 0,
            "create_time": ca.get("create_time", 0),
        }
    prompt = (tip.get("prompt") or "").strip()
    ref_prompt = (ap.get("reference_prompt") or "").strip()
    model = ((tip.get("model_config") or {}).get("model_req_key") or "").strip()
    ratio = tip.get("image_ratio", 0)
    ratio_map = {1: "1:1", 2: "3:4", 3: "16:9", 4: "9:16", 5: "4:3", 6: "3:2", 7: "2:3", 8: "4:5"}
    ratio_txt = ratio_map.get(ratio, f"{ratio}")
    imgs = (it.get("image") or {}).get("large_images") or []
    img_url = imgs[0].get("image_url", "") if imgs else ""
    img_w = imgs[0].get("width", 0) if imgs else 0
    img_h = imgs[0].get("height", 0) if imgs else 0
    cover = ca.get("cover_url") or ""
    return {
        "web_asset_id": str(ca.get("id") or it.get("id") or ""),
        "media_type": media_type,
        "prompt": prompt,
        "reference_prompt": ref_prompt,
        "model_version": model,
        "ratio": ratio_txt,
        "image_url": img_url,
        "cover_url": cover,
        "width": img_w,
        "height": img_h,
        "title": (ca.get("title") or "").strip(),
        "duration": 0,
        "create_time": ca.get("create_time", 0),
    }


def _gcd(a, b):
    while b:
        a, b = b, a % b
    return a or 1


def _browser():
    """独立启动持久化浏览器（复用 dreamina_web_profile 登录态）"""
    from playwright.sync_api import sync_playwright
    pw = sync_playwright().start()
    ctx = pw.chromium.launch_persistent_context(
        PROFILE_DIR, channel="chrome", headless=True,
        viewport={"width": 1440, "height": 900}, locale="zh-CN")
    return pw, ctx


def _fetch_items(keyword: str, media_type: str, count: int) -> list:
    """打开灵感页 → 搜索 → 拦截 get_explore → 滚动加载（按 web_asset_id 去重）
    返回 (items, reason)：reason ∈ ok|not_login|no_result（空结果归因，v5.38.45）"""
    pw = ctx = None
    collected = []
    seen_ids = set()
    reason = "ok"
    try:
        pw, ctx = _browser()
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        def on_resp(r):
            try:
                if "get_explore" in r.url:
                    j = r.json()
                    for it in (j.get("data") or {}).get("item_list") or []:
                        parsed = _parse_item(it)
                        # v5.38.38: 类型过滤前置（count 按目标类型计）
                        if media_type in ("image", "video") and parsed["media_type"] != media_type:
                            continue
                        if parsed["prompt"] or parsed["image_url"]:
                            aid = parsed["web_asset_id"]
                            if aid and aid not in seen_ids:
                                seen_ids.add(aid)
                                collected.append(parsed)
            except Exception:
                pass

        page.on("response", on_resp)
        # v5.38.37/38: 视频灵感在「短片」tab（路径必须是 /ai-tool/home，discover 路径不触发）
        if media_type == "video":
            url = "https://jimeng.jianying.com/ai-tool/home?activeTab=short_video"
        else:
            url = DISCOVER_URL
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
        time.sleep(5)
        # 搜索
        if keyword:
            try:
                box = page.query_selector("input.lv-input")
                if box:
                    box.click()
                    time.sleep(0.5)
                    box.fill(keyword)
                    time.sleep(0.5)
                    page.keyboard.press("Enter")
                    time.sleep(5)
            except Exception:
                pass
        # 滚动加载（collected 已去重，len 即唯一数）
        idle = 0
        while len(collected) < count:
            before = len(collected)
            page.mouse.wheel(0, 1600)
            time.sleep(2)
            if len(collected) == before:
                idle += 1
                if idle >= 6:
                    break
            else:
                idle = 0
        # v5.38.45: 空结果归因 —— 未登录 vs 关键词无结果
        if not collected:
            logged = True
            try:
                cookies = page.context.cookies()
                logged = any("sessionid" in (c.get("name") or "").lower() for c in cookies)
            except Exception:
                pass
            try:
                if "login" in (page.url or "").lower():
                    logged = False
            except Exception:
                pass
            reason = "ok" if logged else "not_login"
        return collected[:count], reason
    finally:
        try:
            if ctx is not None:
                ctx.close()
            if pw is not None:
                pw.stop()
        except Exception:
            pass


def _download(url: str, dest: str) -> bool:
    """下载图片（带浏览器 UA）"""
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
            "Referer": "https://jimeng.jianying.com/",
        })
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
        if len(data) < 500:
            return False
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(data)
        return True
    except Exception:
        return False


def _make_thumbnail(src: str, thumb_dir: str, asset_id: int):
    """Pillow 生成缩略图"""
    try:
        from PIL import Image
        im = Image.open(src)
        im.thumbnail((360, 360))
        os.makedirs(thumb_dir, exist_ok=True)
        im.convert("RGB").save(os.path.join(thumb_dir, f"{asset_id}.jpg"), "JPEG", quality=82)
    except Exception:
        pass


# ==================== API ====================

# ==================== 登录状态（v5.38.46） ====================

def _profile_has_session() -> bool:
    """读 Chrome profile Cookies 库（复制副本防锁），检查即梦 sessionid 类 cookie 存在且未过期
    灵感/网页历史通道共用 dreamina_web_profile；不启动浏览器（轻量实时检测）"""
    import shutil
    import sqlite3 as _sqlite
    # Chrome 85+ cookie 库在 Network/ 子目录（回退旧路径）
    ck = os.path.join(PROFILE_DIR, "Default", "Network", "Cookies")
    if not os.path.isfile(ck):
        ck = os.path.join(PROFILE_DIR, "Default", "Cookies")
    if not os.path.isfile(ck):
        return False
    tmp = ck + ".probe"
    try:
        shutil.copy2(ck, tmp)
        conn = _sqlite.connect(tmp, timeout=5)
        try:
            # Chrome expires_utc 是 WebKit 微秒（1601-01-01 起）；0 = 会话 cookie
            now_us = int((time.time() + 11644473600) * 1000000)
            row = conn.execute(
                "SELECT COUNT(*) FROM cookies WHERE (name LIKE '%sessionid%' OR name LIKE '%session%') "
                "AND (host_key LIKE '%jimeng%' OR host_key LIKE '%jianying%') "
                "AND (expires_utc = 0 OR expires_utc > ?)", [now_us]).fetchone()
            return bool(row and row[0] > 0)
        finally:
            conn.close()
    except Exception:
        return False
    finally:
        try:
            os.remove(tmp)
        except Exception:
            pass


@router.get("/login-status")
def inspiration_login_status():
    """灵感通道登录状态（读 profile cookie，秒回，不启动浏览器）"""
    logged = _profile_has_session()
    return {"ok": True, "logged_in": logged, "checked_at": _now_str(),
            "hint": "灵感/网页历史通道使用独立 Chrome 网页登录态（与 CLI 授权不同），未登录时点徽章打开网页登录窗口"}


@router.post("/preview")
def inspiration_preview(data: dict = Body(...)):
    """搜索灵感（不下载）：keyword + media_type + count → 返回预览列表（空结果带 reason 归因）"""
    keyword = (data.get("keyword") or "").strip()
    media_type = (data.get("media_type") or "").strip()
    count = int(data.get("count") or 20)
    count = max(1, min(count, 100))
    with _IMPORT_LOCK:
        items, reason = _fetch_items(keyword, media_type, count)
    return {"ok": True, "count": len(items), "items": items, "reason": reason}


@router.post("/import")
def inspiration_import(data: dict = Body(...)):
    """下载归档选中的灵感（v5.38.33: 直接接收预览 items，避免重新搜索结果不一致）
    body: {items: [{web_asset_id, media_type, prompt, model_version, ratio, image_url, width, height}], keyword?}
    """
    _ensure_table()
    items = data.get("items") or []
    keyword = (data.get("keyword") or "").strip()
    if not items:
        raise HTTPException(400, "items 不能为空")
    os.makedirs(INSP_DIR, exist_ok=True)
    c = _db()
    imported = 0
    skipped = 0
    failed = 0
    try:
        for it in items:
            aid = str(it.get("web_asset_id") or "")
            if not aid:
                continue
            exists = c.execute("SELECT id FROM dreamina_assets WHERE web_asset_id=? AND source='inspiration'",
                               [aid]).fetchone()
            if exists:
                skipped += 1
                continue
            is_video = it.get("media_type") == "video"
            ext = ".mp4" if is_video else ".png"
            fname = f"insp_{aid}{ext}"
            dest = os.path.join(INSP_DIR, fname)
            if not os.path.isfile(dest) or os.path.getsize(dest) < 500:
                ok = _download(it.get("image_url") or "", dest)
                if not ok:
                    failed += 1
                    continue
            # 视频封面 → 缩略图（视频无大图，用封面）
            thumb_src = dest
            if is_video:
                cover_dest = os.path.join(INSP_DIR, f"insp_{aid}_cover.jpg")
                if not os.path.isfile(cover_dest):
                    if _download(it.get("cover_url") or "", cover_dest):
                        thumb_src = cover_dest
            cur = c.execute(
                """INSERT INTO dreamina_assets
                   (asset_type, prompt, model_version, ratio, width, height, duration, file_paths, imported_at, source, web_asset_id, inspiration_keyword)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                [it.get("media_type") or "image", it.get("prompt") or "", it.get("model_version") or "",
                 it.get("ratio") or "", it.get("width") or 0, it.get("height") or 0, it.get("duration") or 0,
                 json.dumps([fname]), _now_str(), "inspiration", aid, keyword])
            aid_row = cur.lastrowid
            _make_thumbnail(thumb_src, os.path.join(DATA_DIR, "thumbnails"), aid_row)
            imported += 1
        c.commit()
    finally:
        c.close()
    return {"ok": True, "imported": imported, "skipped": skipped, "failed": failed}


@router.get("")
def inspiration_list(keyword: str = Query(""), media_type: str = Query(""), page: int = Query(1, ge=1),
                     page_size: int = Query(60, ge=1, le=200)):
    """灵感资产列表（本地筛选：关键词/类型）"""
    _ensure_table()
    sql = "SELECT * FROM dreamina_assets WHERE source='inspiration'"
    args = []
    if keyword:
        sql += " AND (prompt LIKE ? OR inspiration_keyword LIKE ?)"
        args += [f"%{keyword}%", f"%{keyword}%"]
    if media_type:
        sql += " AND asset_type=?"
        args.append(media_type)
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
    args += [page_size, (page - 1) * page_size]
    c = _db()
    try:
        rows = c.execute(sql, args).fetchall()
        total_where = "source='inspiration'"
        total_args = []
        if keyword:
            total_where += " AND (prompt LIKE ? OR inspiration_keyword LIKE ?)"
            total_args += [f"%{keyword}%", f"%{keyword}%"]
        if media_type:
            total_where += " AND asset_type=?"
            total_args.append(media_type)
        total = c.execute(f"SELECT COUNT(*) FROM dreamina_assets WHERE {total_where}", total_args).fetchone()[0]
        out = []
        for r in rows:
            d = dict(r)
            d["thumb_url"] = f"/api/thumbnails/file/{d['id']}.jpg"
            d["file_url"] = f"/api/dreamina/inspiration/file/{os.path.basename((json.loads(d['file_paths'] or '[]') or [''])[0])}"
            out.append(d)
        return {"ok": True, "tasks": out, "total": total, "page": page}
    finally:
        c.close()


@router.delete("/{asset_id}")
def inspiration_delete(asset_id: int):
    """删除灵感资产（记录 + 文件）"""
    c = _db()
    try:
        r = c.execute("SELECT file_paths FROM dreamina_assets WHERE id=? AND source='inspiration'", [asset_id]).fetchone()
        if not r:
            raise HTTPException(404, "记录不存在")
        for fname in json.loads(r["file_paths"] or "[]"):
            try:
                p = os.path.join(INSP_DIR, os.path.basename(fname))
                if os.path.isfile(p):
                    os.remove(p)
            except Exception:
                pass
        c.execute("DELETE FROM dreamina_assets WHERE id=?", [asset_id])
        c.commit()
        return {"ok": True}
    finally:
        c.close()


@router.post("/{asset_id}/to-card")
def inspiration_to_card(asset_id: int, data: dict = Body(default={})):
    """存为词卡：prompt 作内容（直接 INSERT word_card，复用 batch_create 建卡模式）"""
    c = _db()
    try:
        r = c.execute("SELECT * FROM dreamina_assets WHERE id=? AND source='inspiration'", [asset_id]).fetchone()
        if not r:
            raise HTTPException(404, "记录不存在")
        if r["asset_type"] == "video":
            # v5.38.38: 视频灵感无公开提示词（仅标题），存词卡无内容可归档
            raise HTTPException(400, "视频灵感无公开提示词，不支持存词卡")
        prompt = (r["prompt"] or "").strip()
        if not prompt:
            raise HTTPException(400, "该灵感无提示词，无法存词卡")
        group_id = int(data.get("group_id") or 0)
        name = prompt[:30]
        tags = "即梦灵感 " + (r["model_version"] or "") + " " + (r["ratio"] or "")
        cur = c.execute(
            """INSERT INTO word_card (group_id, name, content, meaning, tags, module, is_builtin, sort_order, source)
               VALUES (?,?,?,?,?,?,0,(SELECT COALESCE(MAX(sort_order),0)+1 FROM word_card WHERE group_id=?),'dreamina_inspiration')""",
            [group_id, name, prompt, f"即梦灵感导入（{r['model_version'] or '未知模型'} · {r['ratio'] or ''}）",
             tags, "prompt", group_id])
        card_id = cur.lastrowid
        # v5.38.39: 图片归档 — 原图复制到 data/originals/ + 缩略图 + 词卡字段 + media_assets 溯源
        # （词卡不依赖灵感库存活：灵感记录被删后词卡原图仍可用）
        if r["asset_type"] == "image":
            _archive_image_to_card(c, card_id, r)
        c.execute("UPDATE dreamina_assets SET word_card_id=? WHERE id=?", [card_id, asset_id])
        c.commit()
        return {"ok": True, "card_id": card_id}
    finally:
        c.close()


def _archive_image_to_card(db, card_id: int, row) -> None:
    """灵感原图 → 词卡：缩略图(data/thumbnails/{uuid}.jpg) + 原图(data/originals/{uuid}.png) + 字段 + 媒体溯源
    字段语义对齐 save_generated_image（thumb_gen.py）：thumbnail=缩略图名 / original_ref=原图名 /
    media_type='image' / preview_media=''（preview_media 是视频语义）"""
    try:
        import uuid as _uuid
        from PIL import Image
        import io as _io
        fnames = json.loads(row["file_paths"] or "[]") or []
        if not fnames:
            return
        src = os.path.join(INSP_DIR, os.path.basename(fnames[0]))
        if not os.path.isfile(src):
            return
        with open(src, "rb") as f:
            img_bytes = f.read()
        if len(img_bytes) < 500:
            return
        _base = _uuid.uuid4().hex
        tf = _base + ".jpg"
        of = _base + ".png"   # 原字节是 PNG，扩展名保真保证 MIME 正确
        iw = ih = 0
        im = Image.open(_io.BytesIO(img_bytes))
        iw, ih = im.size
        sw, sh = im.size
        tr = 240.0 / 160.0
        sr = sw / sh
        if sr > tr:
            nw = int(sh * tr)
            ox = (sw - nw) // 2
            im = im.crop((ox, 0, ox + nw, sh))
        else:
            nh = int(sw / tr)
            oy = (sh - nh) // 2
            im = im.crop((0, oy, sw, oy + nh))
        im = im.resize((240, 160), Image.LANCZOS)
        if im.mode in ("RGBA", "P"):
            im = im.convert("RGB")
        os.makedirs(os.path.join(DATA_DIR, "thumbnails"), exist_ok=True)
        os.makedirs(os.path.join(DATA_DIR, "originals"), exist_ok=True)
        im.save(os.path.join(DATA_DIR, "thumbnails", tf), "JPEG", quality=85)
        with open(os.path.join(DATA_DIR, "originals", of), "wb") as f:
            f.write(img_bytes)
        db.execute(
            """UPDATE word_card SET thumbnail=?, preview_media='', media_type='image',
               thumb_width=?, thumb_height=?, original_ref=?, thumb_engine='dreamina_inspiration',
               updated_at=datetime('now','localtime') WHERE id=?""",
            [tf, iw, ih, of, card_id])
        try:
            db.execute(
                """INSERT OR IGNORE INTO media_assets
                   (filename, original_filename, file_size, original_size, media_type, width, height, mime_type, prompt_id, source)
                   VALUES (?,?,?,?,'image',?,?,'image/png',?,'dreamina_inspiration')""",
                [tf, of, len(img_bytes), len(img_bytes), iw, ih, card_id])
        except Exception as e:
            print(f"[inspiration] media_assets 写入失败: {e}")
    except Exception as e:
        print(f"[inspiration] 词卡图片归档失败 (card {card_id}): {e}")


@router.get("/file/{fname}")
def inspiration_file(fname: str):
    """服务灵感媒体文件（防盗链安全：仅限 INSP_DIR 内；按扩展名分派 MIME）"""
    import re
    if not re.match(r"^insp_[A-Za-z0-9_-]+(_cover)?\.(png|jpg|jpeg|webp|mp4)$", fname):
        raise HTTPException(400, "非法文件名")
    p = os.path.join(INSP_DIR, fname)
    if not os.path.isfile(p):
        raise HTTPException(404, "文件不存在")
    from fastapi.responses import FileResponse
    # v5.38.38: mp4 不能回 image/png，否则浏览器无法播放
    ext = os.path.splitext(fname)[1].lower()
    mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".webp": "image/webp", ".mp4": "video/mp4"}.get(ext, "application/octet-stream")
    return FileResponse(p, media_type=mime)
