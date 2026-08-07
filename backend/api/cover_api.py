"""
封面内容管理 API — 首页封面页的标题/描述/图片可编辑存储
表: app_cover_content
"""
import base64
import json
import os
import random
import sqlite3
import time

from fastapi import APIRouter, Body, File, HTTPException, Request, UploadFile

router = APIRouter(tags=["封面管理"], prefix="/api/cover")

try:
    from paths import get_db_path
    DB_PATH = get_db_path()
except Exception:
    DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "prompts.db")

_ensured = False  # 延迟初始化标记（避免模块 import 时 DB 锁冲突）

def _rw():
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def _ro():
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def _ensure_table():
    """幂等建表+种子，带重试防 DB 锁"""
    global _ensured
    if _ensured:
        return
    max_retries = 5
    for attempt in range(max_retries):
        db = None
        try:
            db = sqlite3.connect(DB_PATH, timeout=5)
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""
            CREATE TABLE IF NOT EXISTS app_cover_content (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                config_key   TEXT UNIQUE NOT NULL,
                config_value TEXT DEFAULT '',
                updated_at   TEXT DEFAULT (datetime('now','localtime'))
            )""")
            # 种子默认内容
            defaults = {
                "title": "咪卡Mik词库",
                "subtitle": "AIGC 提示词全流程管理平台",
                "description": "专为 AI 影视创作者打造。从剧本构思到分镜输出，\n一站管理角色、场景、提示词，支持局域网多端协同。\n内置 Ollama 16 模型池 + ComfyUI 无缝集成。",
                "description_full": "AIGC影片制作全流程管理平台。\n\n核心能力：\n\u2022 提示词快捷检索与复用\n\u2022 角色/场景资产管理\n\u2022 分镜段落编排\n\u2022 团队协同与权限控制\n\u2022 局域网多端同步",
                "features": json.dumps([
                    {"icon":"\U0001f50d","title":"智能检索复用","desc":"关键词 + 语义双引擎，FTS5 全文叠加 AI 重排，700+ 词卡秒级精准调用"},
                    {"icon":"\U0001f3ac","title":"图像·视频双词库","desc":"图像描述词与视频运镜词分类管理，自动首帧封面、悬停预览"},
                    {"icon":"\U0001f39e","title":"分镜全流程","desc":"总项目→分段→镜头三层提示词继承，剧本、角色、场景一体编排"},
                    {"icon":"\U0001f4cb","title":"项目 & 团队协同","desc":"7 阶段看板/甘特/里程碑，实时同步、在线状态、评论通知、邀请协作"},
                    {"icon":"\U0001f5bc","title":"资产管理溯源","desc":"产出图片/视频入库，SHA256 去重、版本链、评分与提示词溯源"},
                    {"icon":"\U0001f916","title":"本地 AI 引擎","desc":"Ollama 16 模型池（翻译/优化/自动标签/语义搜索）+ ComfyUI 无缝集成"}
                ], ensure_ascii=False),
                "cover_images": json.dumps([
                    {"src":"/static/img/covers/06825845.png","alt":"工作台总览","label":"全流程工作台"},
                    {"src":"/static/img/covers/0127e752.png","alt":"提示词检索","label":"提示词词库"},
                    {"src":"/static/img/covers/98bec4b8.png","alt":"资产与分镜","label":"资产·分镜"}
                ], ensure_ascii=False),
                "version": "v5.18",
                "login_hint": "登录，开启创作",
            }
            for k, v in defaults.items():
                db.execute(
                    "INSERT OR IGNORE INTO app_cover_content (config_key, config_value) VALUES (?,?)",
                    [k, v])
            db.commit()
            _ensured = True
            return  # 成功，退出
        except sqlite3.OperationalError as e:
            if "locked" in str(e).lower() and attempt < max_retries - 1:
                wait_ms = 100 * (2 ** attempt) + random.randint(0, 100)
                time.sleep(wait_ms / 1000.0)
                continue
            raise  # 非锁错误，或重试耗尽
        finally:
            if db:
                db.close()
    # 重试耗尽
    raise RuntimeError("cover_api: 数据库初始化失败，重试 5 次仍被锁")

# ============================================================
# API — 每个端点首次调用时懒初始化
# ============================================================

@router.get("")
def get_cover():
    """获取封面内容"""
    _ensure_table()
    db = _ro()
    try:
        rows = db.execute("SELECT config_key, config_value FROM app_cover_content").fetchall()
        data = {}
        for r in rows:
            k, v = r["config_key"], r["config_value"]
            if k in ("cover_images", "features"):
                try: data[k] = json.loads(v)
                except Exception: data[k] = []
            else:
                data[k] = v
        return {"ok": True, "cover": data}
    finally: db.close()


def _verify_admin(request: Request):
    """验证管理员权限"""
    token = None
    ah = request.headers.get("Authorization", "")
    if ah.startswith("Bearer "): token = ah[7:]
    if not token:
        raise HTTPException(401, "请先登录，封面内容仅管理员可编辑")
    try:
        parts = token.split(".")
        if len(parts) == 3:
            payload_b64 = parts[1]
            payload_b64 = payload_b64 + "=" * (-len(payload_b64) % 4)
            payload = json.loads(base64.urlsafe_b64decode(payload_b64))
            if payload.get("exp", 0) > time.time():
                role = payload.get("role", "")
                if role == "admin":
                    return payload
    except Exception:
        pass
    raise HTTPException(403, "仅管理员可编辑封面内容")


@router.put("")
def update_cover(data: dict = Body(...), request: Request = None):
    """更新封面内容 — 仅管理员"""
    _ensure_table()
    if request:
        _verify_admin(request)
    db = _rw()
    try:
        for k, v in data.items():
            val = json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else str(v)
            db.execute(
                "INSERT INTO app_cover_content (config_key, config_value) VALUES (?,?) ON CONFLICT(config_key) DO UPDATE SET config_value=?, updated_at=datetime('now','localtime')",
                [k, val, val])
        db.commit()
        return {"ok": True, "message": "封面内容已更新"}
    finally: db.close()


# ============================================================
# 封面图片库 — 聚合 media_assets（与词卡媒体库一致）
# ============================================================

@router.get("/gallery")
def list_cover_gallery(media_type: str = ""):
    """列出可用于封面的媒体 — 直接从磁盘+DB扫描"""
    _ensure_table()
    BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    THUMB_DIR = os.path.join(BASE, "data", "thumbnails")
    VIDEO_DIR = os.path.join(BASE, "data", "videos")
    WC_THUMB_DIR = os.path.join(BASE, "data", "wc_media", "thumbs")
    WC_VIDEO_DIR = os.path.join(BASE, "data", "wc_media", "videos")

    items = []
    seen = set()

    # 用独立的只读连接，避免 WAL 锁
    db = sqlite3.connect(DB_PATH, timeout=2)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA busy_timeout=2000")

    try:
        rows = db.execute("SELECT * FROM media_assets ORDER BY updated_at DESC LIMIT 500").fetchall()
        img_rows = db.execute("SELECT * FROM media_assets WHERE media_type='image' ORDER BY updated_at DESC LIMIT 300").fetchall()
        vid_rows = db.execute("SELECT * FROM media_assets WHERE media_type='video' ORDER BY updated_at DESC LIMIT 100").fetchall()
    except Exception:
        rows = []; img_rows = []; vid_rows = []

    # 合并：先全部图片，再全部视频
    all_rows = list(img_rows) + list(vid_rows)
    db.close()

    for r in all_rows:
        d = dict(r)
        fn = d.get("filename", "")
        mt = d.get("media_type", "image")
        if not fn or fn in seen:
            continue
        seen.add(fn)

        # 确定文件实际存在的目录
        thumb_path = os.path.join(THUMB_DIR, fn)
        video_path = os.path.join(VIDEO_DIR, fn)
        wc_thumb = os.path.join(WC_THUMB_DIR, fn)
        wc_video = os.path.join(WC_VIDEO_DIR, fn)

        url = None
        if mt == "video":
            if os.path.exists(video_path):
                url = f"/api/thumbnails/video/{fn}"
                thumb_url = f"/api/thumbnails/file/{fn}"
            elif os.path.exists(wc_video):
                url = f"/api/thumbnails/file/{fn}"
                thumb_url = url
            else:
                continue  # skip missing video
        else:
            if os.path.exists(thumb_path) or os.path.exists(wc_thumb):
                url = f"/api/thumbnails/file/{fn}"
                thumb_url = url
            else:
                continue  # skip missing image

        items.append({
            "url": url,
            "thumb_url": thumb_url,
            "filename": d.get("original_filename", fn),
            "type": mt,
        })

    print(f"[CoverGallery] scanned {len(rows)} rows from DB, returned {len(items)} items (images={sum(1 for i in items if i['type']=='image')}, videos={sum(1 for i in items if i['type']=='video')})")
    return {"ok": True, "images": items}


@router.post("/upload")
async def upload_cover_image(file: UploadFile = File(None)):
    """上传封面图片 — 复用 thumbnails 模块基础设施"""
    _ensure_table()
    import shutil
    import uuid
    UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "frontend", "static", "img", "covers")
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    if file and file.filename:
        ext = os.path.splitext(file.filename)[1] or ".png"
        if ext.lower() not in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".mp4", ".webm"):
            raise HTTPException(400, "不支持的格式")
        fname = f"{uuid.uuid4().hex[:8]}{ext.lower()}"
        fpath = os.path.join(UPLOAD_DIR, fname)
        with open(fpath, "wb") as f:
            shutil.copyfileobj(file.file, f)
        return {"ok": True, "url": f"/static/img/covers/{fname}", "filename": fname}
    return {"ok": False, "detail": "无文件"}
