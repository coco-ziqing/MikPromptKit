# -*- coding: utf-8 -*-
"""
v5.38.0: 光厂（vjshi.com）AI 视频素材批量上传
- 来源：词卡生成视频产物（data/card_gen/videos/）
- 自动化：Playwright 持久化 profile（手机验证码人工登录一次）→ 串行上传 → 完善信息填表 → 提交
- 防风控：45s/条间隔 · 单日限额 · 连续失败暂停 · 提交后停留 · 固定指纹
- 字段配置：data/vjshi_form_config.json（_vjshi_inspect.py 实测抓取，可更新）
"""
import json
import os
import re
import threading
import time

from fastapi import APIRouter, Body, HTTPException, Query, Request
from pydantic import BaseModel

from jwt_auth import get_current_user

router = APIRouter(tags=["vjshi"])

HERE = os.path.dirname(os.path.abspath(__file__))
try:
    from paths import get_data_dir
    DATA_DIR = get_data_dir()
except Exception:
    DATA_DIR = os.path.abspath(os.path.join(HERE, "..", "..", "data"))
DB = os.path.join(DATA_DIR, "prompts.db")
VJSHI_DIR = os.path.join(DATA_DIR, "vjshi")
PROFILE_DIR = os.path.join(VJSHI_DIR, "profile")
FORM_CONFIG_PATH = os.path.join(VJSHI_DIR, "vjshi_form_config.json")
CARD_GEN_VIDEO_DIR = os.path.join(DATA_DIR, "card_gen", "videos")
os.makedirs(VJSHI_DIR, exist_ok=True)
os.makedirs(PROFILE_DIR, exist_ok=True)

UPLOAD_URL = "https://www.vjshi.com/upload-nav"

# 防风控参数（可调）
UPLOAD_INTERVAL_SEC = 45      # 单条间隔（默认 45s）
DAILY_LIMIT = 30              # 单日上限
CONSECUTIVE_FAIL_LIMIT = 3    # 连续失败即停
DEFAULT_PRICE = 10            # 默认售价（元）
DEFAULT_IS_AI = True          # AI 标注默认勾选

_QUEUE_LOCK = threading.Lock()
_RESUME_STARTED = False
_STATE = {"last_upload_ts": 0, "today_count": 0, "today_date": "", "consec_fail": 0, "paused_reason": ""}


def _db():
    import sqlite3
    c = sqlite3.connect(DB, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=4000")
    return c


def _auth(request, require=True):
    u = get_current_user(request)
    if require and not (u and u.get("authenticated")):
        raise HTTPException(401, "请先登录")
    return u


def _team_guard(request):
    _auth(request)
    try:
        from api.license import license_info
        if not license_info().get("tiers", {}).get("team", {}).get("active"):
            raise HTTPException(403, "光厂投稿为团队版专属功能，请先激活团队版")
    except HTTPException:
        raise
    except Exception:
        pass


def _now_str():
    import datetime
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _today():
    import datetime
    return datetime.datetime.now().strftime("%Y-%m-%d")


# ==================== 表 ====================

def _ensure_table():
    c = _db()
    try:
        c.execute("""CREATE TABLE IF NOT EXISTS vjshi_upload_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            card_id INTEGER,
            gen_task_id INTEGER,
            video_file TEXT NOT NULL,
            title TEXT DEFAULT '',
            keywords TEXT DEFAULT '',
            description TEXT DEFAULT '',
            category TEXT DEFAULT '',
            price INTEGER DEFAULT 10,
            is_ai INTEGER DEFAULT 1,
            status TEXT DEFAULT 'queued',
            submit_ref TEXT DEFAULT '',
            error TEXT DEFAULT '',
            fail_category TEXT DEFAULT '',
            creator_id INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            finished_at TEXT DEFAULT ''
        )""")
        c.commit()
    finally:
        c.close()


def _task_update(tid, **kw):
    c = _db()
    try:
        if kw:
            sets = ["%s=?" % k for k in kw]
            vals = list(kw.values()) + [tid]
            c.execute("UPDATE vjshi_upload_tasks SET %s, updated_at=datetime('now','localtime') WHERE id=?" % ", ".join(sets), vals)
            c.commit()
    finally:
        c.close()


# ==================== 字段自动生成（规则版） ====================

def _build_meta(card_id, gen_task_id, video_file):
    """从词卡 + 生成任务生成标题/关键词/简介/分类"""
    c = _db()
    try:
        card = c.execute("SELECT name, content, category, module FROM word_card WHERE id=?", [card_id]).fetchone() if card_id else None
        gen = c.execute("SELECT task_type, prompt, model_version, duration, video_resolution, media_type FROM card_gen_tasks WHERE id=?", [gen_task_id]).fetchone() if gen_task_id else None
    finally:
        c.close()

    prompt = (gen["prompt"] if gen else "") or (card["content"] if card else "") or ""
    card_name = (card["name"] if card else "") or prompt[:20]
    # 标题：主体+内容，去广告词，10-30 字
    title = card_name.strip()[:24]
    if len(title) < 4 and prompt:
        title = prompt[:24]
    # 关键词：prompt 名词/场景词提取（光厂要求空格分隔 ≥5 个）
    keywords = _extract_keywords(prompt)
    if not keywords:
        keywords = [card_name[:6]]
    kws = keywords[:8]
    while len(kws) < 5:
        kws.append(f"AI{kws[0][:2]}" if kws else "AI视频")
    # 简介
    parts = ["AI生成视频素材"]
    if prompt:
        parts.append(prompt[:80])
    model = (gen["model_version"] if gen else "") or ""
    dur = (gen["duration"] if gen else 0) or 0
    res = (gen["video_resolution"] if gen else "") or ""
    if model or dur or res:
        parts.append(f"（{' '.join([x for x in [model, f'{dur}s' if dur else '', res] if x])}）")
    description = "，".join(parts)[:200]
    # 分类：词卡 category 映射（首期常见类目，实测表单后校准）
    category = _map_category((card["category"] if card else "") or (card["module"] if card else "") or "")
    return {"title": title, "keywords": " ".join(kws), "description": description, "category": category}


def _extract_keywords(text):
    """规则提取关键词：场景/主体/风格词"""
    if not text:
        return []
    # 中文场景/主体词（2-6 字）
    words = re.findall(r"[\u4e00-\u9fa5]{2,6}", text)
    stop = {"一个", "这个", "那个", "画面", "风格", "高清", "细节", "镜头", "场景", "展示", "背景", "整体"}
    seen, out = set(), []
    for w in words:
        if w in stop or w in seen:
            continue
        seen.add(w)
        out.append(w)
        if len(out) >= 6:
            break
    # 英文词补充
    for w in re.findall(r"[A-Za-z]{3,}", text):
        if w.lower() not in seen and len(out) < 8:
            seen.add(w.lower())
            out.append(w)
    return out[:8]


_CATEGORY_MAP = {
    "emotion": "人物", "color": "自然风光", "tone": "自然风光", "composition": "商务",
    "seedance": "创意", "custom": "创意", "video": "创意",
}
def _map_category(src):
    for k, v in _CATEGORY_MAP.items():
        if k in (src or "").lower():
            return v
    return "创意"


# ==================== Playwright 管理 ====================

def _load_form_config():
    try:
        with open(FORM_CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _get_context():
    """启动/复用持久化浏览器 context（全局单例，有头模式防风控）"""
    from playwright.sync_api import sync_playwright
    if not hasattr(_get_context, "ctx") or _get_context.ctx is None or not _get_context.ctx.browser.is_connected():
        _pw = sync_playwright().start()
        _get_context.pw = _pw
        _get_context.ctx = _pw.chromium.launch_persistent_context(
            PROFILE_DIR, channel="chrome", headless=False,
            viewport={"width": 1440, "height": 900}, locale="zh-CN")
    return _get_context.ctx


def _close_context():
    try:
        if hasattr(_get_context, "ctx") and _get_context.ctx:
            _get_context.ctx.close()
    except Exception:
        pass
    _get_context.ctx = None


def check_login() -> dict:
    """检测光厂登录态（只读，不改变状态）"""
    try:
        ctx = _get_context()
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(UPLOAD_URL, wait_until="domcontentloaded", timeout=30000)
        time.sleep(2)
        if "login" in page.url.lower():
            return {"ok": True, "logged_in": False, "url": page.url}
        has_file = page.query_selector("input[type=file]") is not None
        return {"ok": True, "logged_in": True, "has_upload_ui": has_file, "url": page.url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ==================== 上传 worker ====================

def _upload_one(task_id: int):
    """单条上传：上传文件 → 完善信息填表 → 提交"""
    cfg = _load_form_config()
    if not cfg:
        _task_update(task_id, status="fail", error="表单配置缺失（请先运行 _vjshi_inspect.py 实测）", fail_category="form_config_missing")
        return
    c = _db()
    try:
        t = c.execute("SELECT * FROM vjshi_upload_tasks WHERE id=?", [task_id]).fetchone()
    finally:
        c.close()
    if not t or t["status"] in ("submitted", "fail"):
        return

    _task_update(task_id, status="uploading")
    try:
        ctx = _get_context()
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        # 1. 打开上传页
        page.goto(UPLOAD_URL, wait_until="domcontentloaded", timeout=30000)
        time.sleep(1.5)
        if "login" in page.url.lower():
            _task_update(task_id, status="fail", error="登录已失效，请重新登录光厂", fail_category="login")
            return
        # 2. 选择文件
        video_path = os.path.join(DATA_DIR, t["video_file"].replace("/", os.sep))
        if not os.path.isfile(video_path):
            _task_update(task_id, status="fail", error=f"视频文件不存在: {t['video_file']}", fail_category="file_missing")
            return
        file_input = page.query_selector(cfg.get("upload_file_selector", "input[type=file]"))
        if not file_input:
            _task_update(task_id, status="fail", error="未找到文件上传控件（页面结构可能变化）", fail_category="form_changed")
            return
        file_input.set_input_files(video_path)
        _task_update(task_id, status="uploading", error="", progress_note="已选择文件")
        # 3. 等待上传完成（轮询进度/上传完成标志，最多 10 分钟）
        uploaded = _wait_upload_done(page, cfg)
        if not uploaded:
            _task_update(task_id, status="fail", error="上传超时或未检测到完成", fail_category="upload")
            return
        _task_update(task_id, status="filling")
        # 4. 完善信息填表
        fill_ok, fill_err = _fill_form(page, t, cfg)
        if not fill_ok:
            _task_update(task_id, status="fail", error=fill_err, fail_category="form_changed")
            return
        # 5. 提交
        submit_sel = cfg.get("submit", "")
        if submit_sel:
            btn = page.query_selector(submit_sel)
            if btn:
                btn.click(timeout=8000)
                time.sleep(3)
        _task_update(task_id, status="submitted", finished_at=_now_str(),
                     submit_ref=page.url[:200])
    except Exception as e:
        _task_update(task_id, status="fail", error=f"上传异常: {e}", fail_category="other")


def _wait_upload_done(page, cfg, timeout_sec=600):
    """等待上传完成：优先用配置的完成标志，回退检测页面元素变化"""
    done_sel = cfg.get("upload_done_selector", "")
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            if done_sel and page.query_selector(done_sel):
                return True
            # 回退：出现「完善信息」表单字段（标题输入框）
            title_sel = cfg.get("title", "")
            if title_sel and page.query_selector(title_sel):
                return True
            # 上传进度文本消失
            txt = page.inner_text("body")[:500]
            if ("上传完成" in txt or "上传成功" in txt or "完善" in txt):
                return True
        except Exception:
            pass
        time.sleep(3)
    return False


def _fill_keywords_optimized(page, cfg, keywords_str):
    """v5.38.2: 关键词最优填写——优先点击光厂 AI 推荐备选词，不足再手动补足
    返回 True/False
    """
    kw_sel = cfg.get("keywords", "")
    if not kw_sel:
        return False
    ta = page.query_selector(kw_sel)
    if not ta:
        return False
    my_kws = [k.strip() for k in (keywords_str or "").split() if k.strip()]
    # 1. 找推荐关键词按钮（keywords 输入框附近的可见小按钮）
    try:
        rec_btns = page.eval_on_selector_all(
            "button",
            """els => els.map(el => {
                const r = el.getBoundingClientRect();
                const t = (el.textContent || '').trim();
                return {t: t, visible: r.width > 0 && r.height > 0, cls: (el.className || '').toString().slice(0, 40)};
            }).filter(x => x.visible && x.t && x.t.length >= 2 && x.t.length <= 6)""")
    except Exception:
        rec_btns = []
    # 2. 点击与我的关键词相关的推荐词（优先），最多点 6 个
    clicked = []
    for rb in rec_btns:
        if len(clicked) >= 6:
            break
        word = rb["t"]
        if any(word in mk or mk in word for mk in my_kws) and word not in clicked:
            try:
                page.evaluate(
                    "(t) => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === t); if (b) b.click(); }",
                    word)
                clicked.append(word)
                time.sleep(0.25)
            except Exception:
                pass
    # 3. 读取当前 textarea 值，不足 5 个或缺核心词时手动补足
    try:
        cur = ta.input_value().strip()
    except Exception:
        cur = ""
    cur_kws = [w for w in cur.split() if w]
    if len(cur_kws) < 5 or any(mk not in cur_kws for mk in my_kws):
        need = [k for k in my_kws if k not in cur_kws]
        add = " ".join(need[: max(0, 10 - len(cur_kws))])
        if add:
            try:
                ta.click(timeout=3000)
                if cur:
                    ta.fill(cur + " " + add)
                else:
                    ta.fill(add)
                time.sleep(0.3)
            except Exception:
                pass
    return True


def _fill_form(page, t, cfg):
    """按配置填表（真实表单：弹窗内标题/关键词/描述/价格/AI标注/提交；人类节奏）"""
    # 标题/描述/价格（直接填写）
    for key, fname, value in [("title", "title", t["title"]),
                              ("description", "description", t["description"]),
                              ("price", "price", str(t["price"]))]:
        sel = cfg.get(key, "")
        if not sel or not value:
            continue
        el = page.query_selector(sel)
        if not el:
            return False, f"未找到字段 {key}（页面结构变化）"
        try:
            el.click(timeout=3000)
            el.fill("")
            for ch in value[:300]:
                el.type(ch, delay=15)
            time.sleep(0.3 + (id(value) % 4) / 10)
        except Exception as e:
            return False, f"填写 {key} 失败: {e}"
    # 关键词（v5.38.2）：优先点击光厂 AI 推荐备选词，不足手动补足
    kw_ok = _fill_keywords_optimized(page, cfg, t["keywords"])
    if not kw_ok:
        return False, "关键词填写失败（推荐词/输入框未找到）"
    # AI 生成标注（hasAIGC）/ 循环（isLoop）——光厂 dioa-checkbox 自定义组件，用 JS 点关联 label
    def _check_box(page, sel):
        if not sel:
            return False
        try:
            return page.evaluate(
                """(sel) => {
                    const el = document.querySelector(sel);
                    if (!el) return false;
                    if (el.checked) return true;
                    const lab = el.closest('label');
                    if (lab) { lab.click(); return true; }
                    el.click();
                    return true;
                }""", sel)
        except Exception:
            return False

    for key in ("hasAIGC", "isLoop"):
        if cfg.get(key):
            _check_box(page, cfg[key])
            time.sleep(0.3)
    # 创作时间（当前日期）
    ct_sel = cfg.get("creationTime", "")
    if ct_sel:
        try:
            import datetime
            el = page.query_selector(ct_sel)
            if el:
                el.click(timeout=3000)
                el.fill(datetime.date.today().strftime("%Y-%m-%d"))
                time.sleep(0.3)
        except Exception:
            pass
    return True, ""


def _upload_worker(task_id: int):
    """带防风控的任务执行体（全局锁串行）"""
    global _STATE
    with _QUEUE_LOCK:
        # 单日限额
        if _STATE["today_date"] != _today():
            _STATE["today_date"] = _today()
            _STATE["today_count"] = 0
            _STATE["consec_fail"] = 0
        if _STATE["paused_reason"]:
            _task_update(task_id, status="fail", error=f"队列已暂停: {_STATE['paused_reason']}", fail_category="paused")
            return
        if _STATE["today_count"] >= DAILY_LIMIT:
            _task_update(task_id, status="fail", error=f"已达单日上传上限 {DAILY_LIMIT} 条", fail_category="daily_limit")
            return
        # 间隔
        wait = UPLOAD_INTERVAL_SEC - (time.time() - _STATE["last_upload_ts"])
        if wait > 0 and _STATE["last_upload_ts"]:
            time.sleep(wait)
        _upload_one(task_id)
        _STATE["last_upload_ts"] = time.time()
        # 统计
        c = _db()
        try:
            t = c.execute("SELECT status, fail_category FROM vjshi_upload_tasks WHERE id=?", [task_id]).fetchone()
        finally:
            c.close()
        if t:
            if t["status"] == "submitted":
                _STATE["today_count"] += 1
                _STATE["consec_fail"] = 0
            elif t["status"] == "fail":
                _STATE["consec_fail"] += 1
                if _STATE["consec_fail"] >= CONSECUTIVE_FAIL_LIMIT:
                    _STATE["paused_reason"] = f"连续失败 {CONSECUTIVE_FAIL_LIMIT} 次，已暂停（可手动恢复）"


def _resume_orphaned():
    global _RESUME_STARTED
    if _RESUME_STARTED:
        return
    _RESUME_STARTED = True
    try:
        _ensure_table()
        c = _db()
        try:
            rows = c.execute("SELECT id FROM vjshi_upload_tasks WHERE status IN ('queued','uploading','filling')").fetchall()
        finally:
            c.close()
        for r in rows:
            threading.Thread(target=_upload_worker, args=(r["id"],), daemon=True).start()
    except Exception as e:
        print(f"[VJSHI] 孤儿任务接管失败: {e}")


# ==================== API ====================

class VjshiUploadRequest(BaseModel):
    card_id: int = 0
    gen_task_id: int = 0
    video_file: str
    title: str = ""
    keywords: str = ""
    description: str = ""
    category: str = ""
    price: int = DEFAULT_PRICE
    is_ai: int = 1


class VjshiBatchRequest(BaseModel):
    items: list  # [{card_id, gen_task_id, video_file, ...}]
    price: int = DEFAULT_PRICE
    is_ai: int = 1


@router.get("/api/vjshi/login-status")
def vjshi_login_status(request: Request):
    _team_guard(request)
    return check_login()


# ==================== 团队上传权限（v5.38.3） ====================

def _ensure_perm_table():
    c = _db()
    try:
        c.execute("""CREATE TABLE IF NOT EXISTS team_permissions (
            user_id INTEGER PRIMARY KEY,
            upload INTEGER DEFAULT 0,   -- 光厂上传权限
            updated_by INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )""")
        c.commit()
    finally:
        c.close()


def _is_admin(request) -> bool:
    u = _auth(request)
    return bool(u and u.get("role") == "admin")


def _user_upload_perm(user_id: int) -> bool:
    """用户是否有光厂上传权限（v5.38.4：一律查表，admin 也需勾选）"""
    try:
        c = _db()
        try:
            r = c.execute("SELECT upload FROM team_permissions WHERE user_id=?", [user_id]).fetchone()
            return bool(r and r["upload"])
        finally:
            c.close()
    except Exception:
        return False


def _has_upload_perm(request) -> bool:
    u = _auth(request)
    return _user_upload_perm(u.get("id") or 0)


@router.get("/api/team/permissions")
def team_permissions_list(request: Request):
    """团队权限列表（成员 + 上传权限状态）；当前用户权限 always 返回"""
    _team_guard(request)
    _ensure_perm_table()
    c = _db()
    try:
        rows = c.execute(
            "SELECT u.id, u.username, u.display_name, u.role, COALESCE(tp.upload, 0) as upload "
            "FROM users u LEFT JOIN team_permissions tp ON tp.user_id = u.id "
            "ORDER BY u.id").fetchall()
        members = [dict(r) for r in rows]
        me = _auth(request)
        return {"ok": True, "members": members,
                "me": {"id": me.get("id"), "role": me.get("role"),
                        "upload": _user_upload_perm(me.get("id") or 0)},
                "is_admin": _is_admin(request)}
    finally:
        c.close()


@router.put("/api/team/permissions/{user_id}")
def team_permissions_set(user_id: int, request: Request, data: dict = Body(...)):
    """设置成员上传权限（仅 admin）"""
    _team_guard(request)
    if not _is_admin(request):
        raise HTTPException(403, "仅主理人可设置权限")
    _ensure_perm_table()
    upload = 1 if data.get("upload") else 0
    c = _db()
    try:
        exists = c.execute("SELECT 1 FROM users WHERE id=?", [user_id]).fetchone()
        if not exists:
            raise HTTPException(404, "用户不存在")
        c.execute(
            "INSERT INTO team_permissions (user_id, upload, updated_by) VALUES (?,?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET upload=?, updated_by=?",
            [user_id, upload, _auth(request).get("id"), upload, _auth(request).get("id")])
        c.commit()
        return {"ok": True, "user_id": user_id, "upload": bool(upload)}
    finally:
        c.close()


def _upload_perm_guard(request):
    """上传权限守卫：团队版 + 用户有上传权限"""
    _team_guard(request)
    if not _has_upload_perm(request):
        raise HTTPException(403, "未开通光厂上传权限，请联系主理人在团队空间权限设置中开启")


@router.post("/api/vjshi/open-login")
def vjshi_open_login(request: Request):
    """打开光厂浏览器窗口（人工手机验证码登录，一次即可）"""
    _team_guard(request)
    try:
        ctx = _get_context()
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.vjshi.com/", wait_until="domcontentloaded", timeout=30000)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.get("/api/vjshi/meta")
def vjshi_meta(request: Request, card_id: int = 0, gen_task_id: int = 0, video_file: str = ""):
    """预览自动生成的素材字段（投稿弹窗编辑用）"""
    _upload_perm_guard(request)
    return {"ok": True, "meta": _build_meta(card_id, gen_task_id, video_file)}


@router.post("/api/vjshi/llm-description")
async def vjshi_llm_description(request: Request, data: dict = Body(...)):
    """Ollama 生成 300 字内 SEO 素材简介（v5.38.2：描述优化）
    body: { prompt, title, model? }
    """
    _team_guard(request)
    prompt = (data.get("prompt") or "").strip()[:800]
    title = (data.get("title") or "").strip()[:60]
    if not prompt and not title:
        raise HTTPException(400, "prompt 或 title 必填")
    try:
        from ollama_client import ollama_chat, extract_json
        sys_prompt = (
            "你是视频素材平台的文案优化师。根据视频主题与提示词，写一段 300 字以内的素材简介（中文），"
            "要求：1) 自然融入核心关键词，便于搜索引擎/平台检索；2) 描述画面内容、风格、适用场景；"
            "3) 不要写广告词/联系方式；4) 不要提及 AI 生成以外的生成细节；5) 控制在 150-300 字。"
            "只输出简介正文，不要标题和多余文字。"
        )
        user_text = f"标题：{title}\n主题/提示词：{prompt}"
        result = await ollama_chat([
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user_text}
        ], function="vjshi_desc", temperature=0.6, timeout_s=60, think=False)
        raw = (result or {}).get("content") if isinstance(result, dict) else ""
        desc = (raw or "").strip()
        # 清理可能的引号包裹
        if desc.startswith('"') and desc.endswith('"'):
            desc = desc[1:-1]
        if not desc:
            return {"ok": True, "description": "", "fallback": True}
        return {"ok": True, "description": desc[:300], "fallback": False}
    except Exception as e:
        print(f"[VJSHI] LLM 简介失败: {e}")
        return {"ok": False, "error": str(e)}


@router.post("/api/vjshi/tasks")
def vjshi_create(data: VjshiUploadRequest, request: Request):
    """单条投稿入队"""
    _upload_perm_guard(request)
    _ensure_table()
    if not data.video_file:
        raise HTTPException(400, "video_file 必填")
    meta = {}
    if not data.title:
        meta = _build_meta(data.card_id, data.gen_task_id, data.video_file)
    c = _db()
    try:
        cur = c.execute(
            """INSERT INTO vjshi_upload_tasks (card_id, gen_task_id, video_file, title, keywords, description, category, price, is_ai, creator_id)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            [data.card_id, data.gen_task_id, data.video_file,
             data.title or meta.get("title", ""), data.keywords or meta.get("keywords", ""),
             data.description or meta.get("description", ""), data.category or meta.get("category", ""),
             data.price, data.is_ai, _auth(request).get("id")])
        tid = cur.lastrowid
        c.commit()
    finally:
        c.close()
    threading.Thread(target=_upload_worker, args=(tid,), daemon=True).start()
    return {"ok": True, "task_id": tid}


@router.post("/api/vjshi/batch")
def vjshi_batch(data: VjshiBatchRequest, request: Request):
    """批量投稿入队（items: [{card_id, gen_task_id, video_file}]）"""
    _upload_perm_guard(request)
    _ensure_table()
    if not data.items:
        raise HTTPException(400, "items 不能为空")
    u = _auth(request)
    created = []
    c = _db()
    try:
        for it in data.items:
            vf = it.get("video_file", "")
            if not vf:
                continue
            meta = _build_meta(it.get("card_id", 0), it.get("gen_task_id", 0), vf)
            cur = c.execute(
                """INSERT INTO vjshi_upload_tasks (card_id, gen_task_id, video_file, title, keywords, description, category, price, is_ai, creator_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                [it.get("card_id", 0), it.get("gen_task_id", 0), vf,
                 meta["title"], meta["keywords"], meta["description"], meta["category"],
                 data.price, data.is_ai, u.get("id")])
            created.append({"task_id": cur.lastrowid, "video_file": vf})
        c.commit()
    finally:
        c.close()
    for item in created:
        threading.Thread(target=_upload_worker, args=(item["task_id"],), daemon=True).start()
    return {"ok": True, "count": len(created), "tasks": created}


@router.get("/api/vjshi/tasks")
def vjshi_list(request: Request, status: str = Query(None), limit: int = Query(50, ge=1, le=200)):
    _team_guard(request)
    _ensure_table()
    sql = "SELECT * FROM vjshi_upload_tasks WHERE 1=1"
    args = []
    if status:
        sql += " AND status=?"
        args.append(status)
    sql += " ORDER BY id DESC LIMIT ?"
    args.append(limit)
    c = _db()
    try:
        rows = c.execute(sql, args).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["video_url"] = f"/api/thumbnails/video/{os.path.basename(d['video_file'])}" if d["video_file"] else ""
            out.append(d)
        return {"ok": True, "tasks": out, "state": {k: v for k, v in _STATE.items() if k != "last_upload_ts"}}
    finally:
        c.close()


@router.post("/api/vjshi/tasks/{tid}/retry")
def vjshi_retry(tid: int, request: Request):
    _team_guard(request)
    c = _db()
    try:
        t = c.execute("SELECT * FROM vjshi_upload_tasks WHERE id=?", [tid]).fetchone()
        if not t:
            raise HTTPException(404, "任务不存在")
        if t["status"] == "submitted":
            raise HTTPException(400, "任务已提交")
        c.execute("UPDATE vjshi_upload_tasks SET status='queued', error='', fail_category='', "
                  "finished_at='' WHERE id=?", [tid])
        c.commit()
    finally:
        c.close()
    threading.Thread(target=_upload_worker, args=(tid,), daemon=True).start()
    return {"ok": True, "task_id": tid}


@router.delete("/api/vjshi/tasks/{tid}")
def vjshi_delete(tid: int, request: Request):
    _team_guard(request)
    c = _db()
    try:
        c.execute("DELETE FROM vjshi_upload_tasks WHERE id=?", [tid])
        c.commit()
        return {"ok": True}
    finally:
        c.close()


@router.post("/api/vjshi/resume")
def vjshi_resume(request: Request):
    """手动恢复暂停的队列"""
    _team_guard(request)
    _STATE["paused_reason"] = ""
    _STATE["consec_fail"] = 0
    return {"ok": True}


# 启动时接管孤儿任务
threading.Thread(target=_resume_orphaned, daemon=True).start()
