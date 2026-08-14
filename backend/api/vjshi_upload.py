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

def _rand(min_v: float, max_v: float) -> float:
    """随机延迟区间（真人模拟节奏）"""
    import random
    return random.uniform(min_v, max_v)


def _human_pause(min_v: float = 0.4, max_v: float = 1.6):
    """随机停顿（模拟思考/操作间隙）"""
    time.sleep(_rand(min_v, max_v))


def _human_scroll(page):
    """随机滚动页面（模拟浏览行为）"""
    try:
        import random
        h = page.evaluate("() => document.body.scrollHeight || 0")
        if h > 600:
            for _ in range(random.randint(1, 3)):
                page.mouse.wheel(0, random.randint(150, 500))
                time.sleep(_rand(0.3, 0.9))
            page.mouse.wheel(0, -random.randint(100, 400))
            time.sleep(_rand(0.3, 0.8))
    except Exception:
        pass


def _human_mouse(page):
    """随机鼠标移动（模拟光标轨迹）"""
    try:
        import random
        for _ in range(random.randint(2, 4)):
            page.mouse.move(random.randint(200, 1200), random.randint(150, 700),
                            steps=random.randint(8, 20))
            time.sleep(_rand(0.1, 0.4))
    except Exception:
        pass



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
            finished_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )""")
        # 幂等补列（旧表无 updated_at → v5.38.6 修复；SQLite 不允许非常量默认）
        cols = [r[1] for r in c.execute("PRAGMA table_info(vjshi_upload_tasks)").fetchall()]
        if "updated_at" not in cols:
            c.execute("ALTER TABLE vjshi_upload_tasks ADD COLUMN updated_at TEXT DEFAULT ''")
        if "progress_note" not in cols:
            c.execute("ALTER TABLE vjshi_upload_tasks ADD COLUMN progress_note TEXT DEFAULT ''")
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


# ==================== 浏览器模式设置（v5.38.6：有头/无头可选） ====================

def _ensure_settings_table():
    c = _db()
    try:
        c.execute("""CREATE TABLE IF NOT EXISTS vjshi_settings (
            key TEXT PRIMARY KEY,
            value TEXT DEFAULT ''
        )""")
        c.commit()
    finally:
        c.close()


def _get_setting(key: str, default: str = "") -> str:
    try:
        c = _db()
        try:
            r = c.execute("SELECT value FROM vjshi_settings WHERE key=?", [key]).fetchone()
            return r["value"] if r else default
        finally:
            c.close()
    except Exception:
        return default


def _set_setting(key: str, value: str):
    c = _db()
    try:
        c.execute("INSERT INTO vjshi_settings (key, value) VALUES (?,?) "
                  "ON CONFLICT(key) DO UPDATE SET value=?", [key, value, value])
        c.commit()
    finally:
        c.close()


def _headless_mode() -> bool:
    return _get_setting("headless", "0") == "1"


@router.get("/api/vjshi/settings")
def vjshi_settings_get(request: Request):
    """光厂上传设置（浏览器模式等）"""
    _team_guard(request)
    _ensure_settings_table()
    return {"ok": True, "headless": _headless_mode()}


@router.put("/api/vjshi/settings")
def vjshi_settings_put(request: Request, data: dict = Body(...)):
    """保存上传设置（headless: bool 有头/无头）"""
    _team_guard(request)
    _ensure_settings_table()
    if "headless" in data:
        _set_setting("headless", "1" if data.get("headless") else "0")
    return {"ok": True, "headless": _headless_mode()}


_CTX_START_LOCK = threading.Lock()   # v5.38.14: 同 profile 并发启动互斥
_VJSHI_BUSY = threading.Event()      # 上传任务进行中（check_login 忙时跳过）


def _kill_profile_chrome():
    """杀掉占用 vjshi_profile 的 Chrome 进程（启动失败自愈）"""
    import subprocess
    try:
        ps = ("Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" "
              "| Where-Object { $_.CommandLine -like '*vjshi_profile*' } "
              "| ForEach-Object { $_.ProcessId }")
        out = subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                             capture_output=True, text=True, timeout=15).stdout
        for line in out.splitlines():
            pid = line.strip()
            if pid.isdigit():
                try:
                    subprocess.run(["taskkill", "/PID", pid, "/F", "/T"],
                                   capture_output=True, timeout=10)
                    print(f"[VJSHI] 已清理占用 profile 的 Chrome 进程 {pid}")
                except Exception:
                    pass
    except Exception as e:
        print(f"[VJSHI] 杀进程失败: {e}")


def _clean_singleton_locks():
    """删除 profile 残留 Singleton 锁文件（Chrome 崩溃后遗留）"""
    import glob
    for pat in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        for f in glob.glob(os.path.join(PROFILE_DIR, pat)):
            try:
                os.remove(f)
                print(f"[VJSHI] 已清理 {f}")
            except Exception:
                pass


def _new_context():
    """独立启动持久化浏览器 context（v5.38.9：每次新建，Playwright sync API 线程绑定，
    跨线程复用会报 Cannot switch to a different thread）返回 (pw, ctx)
    v5.38.14: 启动互斥锁 + 失败杀占用进程/清锁重试 3 次"""
    from playwright.sync_api import sync_playwright
    with _CTX_START_LOCK:
        for attempt in range(3):
            try:
                pw = sync_playwright().start()
                ctx = pw.chromium.launch_persistent_context(
                    PROFILE_DIR, channel="chrome", headless=_headless_mode(),
                    viewport={"width": 1440, "height": 900}, locale="zh-CN")
                return pw, ctx
            except Exception as e:
                print(f"[VJSHI] 浏览器启动失败(第{attempt+1}次): {e}")
                _kill_profile_chrome()
                _clean_singleton_locks()
                time.sleep(2 + attempt)
    raise RuntimeError("浏览器启动失败（可能 Chrome 配置被占用，请稍后重试）")


def check_login() -> dict:
    """检测光厂登录态（只读；独立 context，用完关闭）"""
    if _VJSHI_BUSY.is_set():
        return {"ok": False, "busy": True, "error": "上传任务进行中，暂无法检测登录"}
    pw = ctx = None
    try:
        pw, ctx = _new_context()
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(UPLOAD_URL, wait_until="domcontentloaded", timeout=30000)
        time.sleep(2)
        if "login" in page.url.lower():
            return {"ok": True, "logged_in": False, "url": page.url}
        has_file = page.query_selector("input[type=file]") is not None
        return {"ok": True, "logged_in": True, "has_upload_ui": has_file, "url": page.url}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        try:
            if ctx is not None:
                ctx.close()
            if pw is not None:
                pw.stop()
        except Exception:
            pass


# ==================== 上传 worker ====================

def _resolve_video_path(video_file: str):
    """多候选解析视频文件真实路径（v5.38.16：文件在 card_gen/videos/，兼容历史相对路径）"""
    rel = (video_file or "").replace("/", os.sep)
    if not rel:
        return None
    if os.path.isabs(rel):
        return rel if os.path.isfile(rel) else None
    cands = [
        os.path.join(CARD_GEN_VIDEO_DIR, rel),                     # 常规：data/card_gen/videos/xxx.mp4
        os.path.join(DATA_DIR, rel),                               # 历史：data/xxx.mp4
        os.path.join(DATA_DIR, "card_gen", "videos", os.path.basename(rel)),  # 带目录前缀：card_gen/videos/xxx
        os.path.join(DATA_DIR, "card_gen", os.path.basename(rel)), # 兼容：data/card_gen/xxx.mp4
    ]
    for c in cands:
        if os.path.isfile(c):
            return c
    return None


def _vjshi_log(msg: str):
    """写 vjshi 运行日志（v5.38.22：服务 Hidden 启动 stdout 丢失，日志落文件便于排查）"""
    try:
        import datetime
        with open(os.path.join(DATA_DIR, "vjshi_upload.log"), "a", encoding="utf-8") as f:
            f.write(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] {msg}\n")
    except Exception:
        pass


def _llm_description_sync(prompt: str, title: str) -> str:
    """同步版 AI 简介生成（v5.38.18 worker 自动运行）
    v5.38.23: asyncio.run 移入独立线程——worker 线程有 playwright sync 常驻 event loop，
    asyncio.run 会报 cannot be called from a running event loop"""
    import asyncio
    from ollama_client import ollama_chat
    prompt = (prompt or "").strip()[:800]
    title = (title or "").strip()[:60]
    if not prompt and not title:
        return ""
    sys_prompt = (
        "你是视频素材平台的文案优化师。根据视频主题与提示词，写一段 300 字以内的素材简介（中文），"
        "要求：1) 自然融入核心关键词，便于搜索引擎/平台检索；2) 描述画面内容、风格、适用场景；"
        "3) 不要写广告词/联系方式；4) 不要提及 AI 生成以外的生成细节；5) 控制在 150-300 字。"
        "只输出简介正文，不要标题和多余文字。"
    )
    box = {}
    def _run():
        try:
            box["r"] = asyncio.run(ollama_chat([
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": f"标题：{title}\n主题/提示词：{prompt}"}
            ], function="vjshi_desc", temperature=0.6, timeout_s=60, think=False))
        except Exception as e:
            box["e"] = e
    _t = threading.Thread(target=_run, daemon=True)
    _t.start()
    _t.join(timeout=75)
    if "e" in box:
        _vjshi_log(f"自动简介生成失败: {type(box['e']).__name__}: {str(box['e'])[:200]}")
        return ""
    if "r" not in box:
        _vjshi_log("自动简介生成超时(75s)")
        return ""
    result = box["r"]
    raw = (result or {}).get("content") if isinstance(result, dict) else ""
    desc = (raw or "").strip()
    if desc.startswith('"') and desc.endswith('"'):
        desc = desc[1:-1]
    return desc[:300]


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
    _VJSHI_BUSY.set()
    pw = ctx = None
    _submitted = False
    try:
        # v5.38.30: 启动前主动清理上一个保留窗口/锁（不等失败自愈）
        _kill_profile_chrome()
        _clean_singleton_locks()
        pw, ctx = _new_context()
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        # 1. 先访问首页（模拟人工导航），再进上传页（v5.38.7 反检测）
        try:
            page.goto("https://www.vjshi.com/", wait_until="domcontentloaded", timeout=30000)
            _human_pause(1.0, 2.5)
            _human_scroll(page)
        except Exception:
            pass
        # v5.38.11: 用配置的上传页（/user/upload/video，含文件控件），入口页 upload-nav 无 file input
        upload_url = cfg.get("upload_url", UPLOAD_URL)
        page.goto(upload_url, wait_until="domcontentloaded", timeout=30000)
        _human_pause(1.0, 2.5)
        _human_mouse(page)
        if "login" in page.url.lower():
            _task_update(task_id, status="fail", error="登录已失效，请重新登录光厂", fail_category="login")
            return
        # 2. 选择文件（v5.38.16: 多候选路径解析）
        video_path = _resolve_video_path(t["video_file"])
        if not video_path:
            _task_update(task_id, status="fail", error=f"视频文件不存在: {t['video_file']}", fail_category="file_missing")
            return
        file_input = page.query_selector(cfg.get("upload_file_selector", "input[type=file]"))
        if not file_input:
            _task_update(task_id, status="fail", error="未找到文件上传控件（页面结构可能变化）", fail_category="form_changed")
            return
        _human_pause(0.8, 2.0)
        file_input.set_input_files(video_path)
        _task_update(task_id, status="uploading", error="", progress_note="已选择文件")
        _human_pause(1.0, 2.5)
        # 3. 等待上传完成（轮询进度/上传完成标志，最多 10 分钟）
        uploaded = _wait_upload_done(page, cfg)
        if not uploaded:
            _task_update(task_id, status="fail", error="上传超时或未检测到完成", fail_category="upload")
            return
        _task_update(task_id, status="filling")
        # v5.38.18/20: 简介默认自动 AI 优化（占位/纯英文/过短 → 自动生成，LLM 失败保留原文案）
        t_fill = dict(t)
        cur_desc = (t_fill.get("description") or "").strip()
        _is_placeholder = cur_desc.startswith("AI生成视频素材") or not re.search(r"[\u4e00-\u9fff]", cur_desc)
        if len(cur_desc) < 80 or _is_placeholder:
            # v5.38.22: 失败重试 1 次（Ollama 偶发忙）
            gen_desc = _llm_description_sync(t_fill.get("title") or "", t_fill.get("title") or "")
            if not gen_desc:
                _vjshi_log(f"任务{task_id} 自动简介首次失败，重试中...")
                time.sleep(3)
                gen_desc = _llm_description_sync(t_fill.get("title") or "", t_fill.get("title") or "")
            if gen_desc:
                t_fill["description"] = gen_desc
                try:
                    _dc = _db()
                    try:
                        _dc.execute("UPDATE vjshi_upload_tasks SET description=? WHERE id=?", [gen_desc, task_id])
                        _dc.commit()
                    finally:
                        _dc.close()
                except Exception:
                    pass
                _vjshi_log(f"任务{task_id} 自动 AI 简介已生成({len(gen_desc)}字)")
        # 4. 点「上架销售」打开表单弹窗（v5.38.13：此前未打开弹窗直接填表 → 字段未找到）
        trigger = cfg.get("listing_trigger", "")
        if trigger:
            tbtn = page.query_selector(trigger)
            if tbtn:
                _human_pause(0.8, 2.0)
                try:
                    tbtn.click(timeout=8000)
                except Exception:
                    pass
                _human_pause(1.5, 3.0)  # 等弹窗动画
        # 等表单字段就绪（dioa 组件异步渲染，最多 15s）
        for _ in range(15):
            if (cfg.get("title") and page.query_selector(cfg["title"])) or                (cfg.get("price") and page.query_selector(cfg["price"])):
                break
            time.sleep(1)
        # 5. 完善信息填表
        fill_ok, fill_err = _fill_form(page, t_fill, cfg)
        if not fill_ok:
            _task_update(task_id, status="fail", error=fill_err, fail_category="form_changed")
            return
        # 5. 提交（v5.38.16: 提交后确认成功/失败，防误报）
        submit_sel = cfg.get("submit", "")
        submitted_url = page.url[:200]
        if submit_sel:
            btn = page.query_selector(submit_sel)
            if btn:
                _human_pause(0.8, 2.0)
                btn.click(timeout=8000)
                _human_pause(2.0, 4.0)  # 提交后停留（模拟人工确认结果）
                # 检测失败提示（10s 内）
                fail_detected = None
                for _ in range(10):
                    try:
                        body = page.inner_text("body")[:800]
                        for kw in ("提交失败", "保存失败", "发布失败", "网络异常", "请重试"):
                            if kw in body:
                                fail_detected = kw
                                break
                    except Exception:
                        pass
                    if fail_detected:
                        break
                    time.sleep(1)
                if fail_detected:
                    _task_update(task_id, status="fail", error=f"提交被拒: {fail_detected}", fail_category="submit_rejected")
                    return
                _human_pause(1.0, 2.0)
                submitted_url = page.url[:200]
        _task_update(task_id, status="submitted", finished_at=_now_str(),
                     submit_ref=submitted_url)
        _submitted = True
    except Exception as e:
        _task_update(task_id, status="fail", error=f"上传异常: {e}", fail_category="other")
    finally:
        # v5.38.24: 提交成功保留浏览器窗口（查看提交结果）；失败/异常才关闭
        if _submitted:
            _vjshi_log(f"任务{task_id} 提交成功，保留浏览器窗口（下次任务自动清理）")
        else:
            try:
                if ctx is not None:
                    ctx.close()
                if pw is not None:
                    pw.stop()
            except Exception:
                pass
        _VJSHI_BUSY.clear()


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


def _fill_keywords_ai(page, cfg):
    """v5.38.17: 关键词直接用光厂「AI推荐关键词」（弹窗自动生成的最优词，全部点击）
    返回 True 表示已填入；False 表示无推荐/失败需回退
    """
    kw_sel = cfg.get("keywords", "")
    if not kw_sel:
        return False
    try:
        # v5.38.28: 等待「AI推荐关键词」区块加载（弹窗异步渲染，最多 10s）
        for _w in range(10):
            has_block = page.evaluate("""() => !!Array.from(document.querySelectorAll('p')).find(p => (p.textContent || '').trim() === 'AI推荐关键词')""")
            if has_block:
                break
            time.sleep(1)
        if not has_block:
            _vjshi_log("未找到「AI推荐关键词」区块（页面结构变化？）")
            return False
        # v5.38.21/25: 点选 AI 推荐关键词——展开更多 + 多轮点击（React 事件同步连点会丢）
        # v5.38.25: 上限约束：≤120 字、≤30 个词组（点选填入即可，不手动补足）
        page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const more = btns.find(b => {
                const t = (b.textContent || '').trim();
                return (t.includes('更多') || t.includes('展开') || t.includes('查看全部')) && t.length < 10;
            });
            if (more) more.click();
        }""")
        _human_pause(0.5, 1.0)
        # v5.38.27: 逐个点击——每轮只点第一个可用词，等 React 更新后重新查询按钮列表
        # （同步 for 连点会被 React 重渲染丢弃，只第一个生效）
        for _round in range(60):
            res = page.evaluate("""() => {
                const p = Array.from(document.querySelectorAll('p')).find(p => (p.textContent || '').trim() === 'AI推荐关键词');
                if (!p) return {done: true};
                const ta = document.querySelector('textarea[name=keywords]');
                const cur = ta ? (ta.value || '').trim() : '';
                const words = cur ? cur.split(/\\s+/) : [];
                let totalChars = cur.length;
                const btns = Array.from(p.parentElement.querySelectorAll('button')).filter(b => !b.disabled && !b.dataset.vjshiDone);
                if (!btns.length) return {done: true};
                const w = (btns[0].textContent || '').trim();
                if (!w) { btns[0].dataset.vjshiDone = '1'; return {done: false}; }
                if (words.length >= 30) return {done: true};           // ≤30 词组
                if (totalChars + w.length + 1 > 120) return {done: true};  // ≤120 字
                if (words.includes(w)) { btns[0].dataset.vjshiDone = '1'; return {done: false}; }
                btns[0].click();
                btns[0].dataset.vjshiDone = '1';
                return {done: false, clicked: 1, count: words.length + 1, chars: totalChars + w.length + 1};
            }""")
            time.sleep(_rand(0.15, 0.35))  # 人点击节奏（同时等 React 更新）
            if not res:
                break
            if res.get("done"):
                break
            if res.get("count", 0) >= 30 or res.get("chars", 0) >= 120:
                break
        ta = page.query_selector(kw_sel)
        if not ta:
            _vjshi_log("关键词 textarea 未找到")
            return False
        cur = (ta.input_value() or "").strip()
        words = [w for w in cur.split() if w]
        _vjshi_log(f"AI 推荐关键词点选完成: {len(words)} 词")
        return len(words) >= 5
    except Exception as e:
        _vjshi_log(f"AI 推荐关键词异常: {type(e).__name__}: {str(e)[:150]}")
        return False


def _fill_keywords_optimized(page, cfg, keywords_str):
    """v5.38.26: 关键词只用光厂 AI 推荐点选填入（≤120字/≤30词），绝不填入生成视频的提示词
    无 AI 推荐/不足 5 词 → 返回 False（任务失败提示，用户人工处理）"""
    if _fill_keywords_ai(page, cfg):
        return True
    return False


def _detect_ai_style(text: str):
    """v5.38.29: 根据提示词自动识别视频风格（光厂 ai-styles API：11实拍写实/12立体三维/13平面二维/14抽象光影）
    返回风格 id 或 None（不匹配时保持默认）"""
    t = (text or "").lower()
    rules = {
        11: ["写实", "真实", "实拍", "自然", "现实", "纪实", "生活", "风光", "风景", "人物", "摄影", "纪录片", "真实感", "photo", "realistic"],
        12: ["3d", "三维", "立体", "cg", "渲染", "模型", "blender", "c4d", "次世代", "建模", "立体三维", "引擎"],
        13: ["2d", "二维", "平面", "扁平", "插画", "动漫", "动画", "卡通", "漫画", "手绘", "矢量", "flat", "ui", "漫画风"],
        14: ["抽象", "光影", "光效", "粒子", "流光", "霓虹", "光带", "极光", "光斑", "梦幻", "唯美", "流光溢彩", "特效", "光晕", "辉光", "abstract", "glow"],
    }
    scores = {k: 0 for k in rules}
    for sid, kws in rules.items():
        for kw in kws:
            if kw in t:
                scores[sid] += 1
    best = max(scores, key=lambda k: scores[k])
    return best if scores[best] > 0 else None


def _select_ai_style(page, cfg, text):
    """v5.38.29/31: 识别风格并真实 UI 点击选择（dioa-select trigger 展开 → 点 .dioa-select__option）
    v5.38.31: 弃用 select.value setter（React 自定义组件 state 不同步），改真实点击"""
    try:
        sid = _detect_ai_style(text)
        if not sid:
            return False
        name = {11: "实拍写实", 12: "立体三维", 13: "平面二维", 14: "抽象光影"}.get(sid, "")
        if not name:
            return False
        # 1. 展开视频风格下拉（「视频风格」标题 → 容器内 trigger）
        opened = page.evaluate("""() => {
            const span = Array.from(document.querySelectorAll('span')).find(s => (s.textContent || '').trim() === '视频风格');
            if (!span) return false;
            let el = span.parentElement;
            for (let i = 0; i < 6 && el; i++) {
                const tr = el.querySelector('.dioa-select__trigger');
                if (tr) { tr.click(); return true; }
                el = el.parentElement;
            }
            return false;
        }""")
        if not opened:
            _vjshi_log("视频风格下拉未找到/无法展开")
            return False
        time.sleep(1.0)  # 等选项渲染
        # 2. 点击目标风格选项
        clicked = page.evaluate("""(nm) => {
            const opts = Array.from(document.querySelectorAll('.dioa-select__option'));
            const o = opts.find(x => (x.textContent || '').trim() === nm);
            if (o) { o.click(); return true; }
            return false;
        }""", name)
        time.sleep(0.5)
        _vjshi_log(f"视频风格自动识别: {name}({sid}) 设置{'成功' if clicked else '失败'}")
        return clicked
    except Exception as e:
        _vjshi_log(f"视频风格设置异常: {type(e).__name__}: {str(e)[:120]}")
        return False


def _fill_form(page, t, cfg):
    """按配置填表（真实表单：弹窗内标题/关键词/描述/价格/AI标注/提交；人类节奏）"""
    # v5.38.15: 标题优先用光厂 AI 推荐（弹窗自动生成的「AI推荐标题」按钮，点第一个）
    skip_title = False
    if cfg.get("ai_title", True):
        try:
            used_ai = page.evaluate("""() => {
                const p = Array.from(document.querySelectorAll('p')).find(p => (p.textContent || '').trim() === 'AI推荐标题');
                if (!p) return false;
                const btns = Array.from(p.parentElement.querySelectorAll('button'));
                if (!btns.length) return false;
                btns[0].click();
                return true;
            }""")
            if used_ai:
                _human_pause(0.6, 1.5)
                tel = page.query_selector(cfg.get("title", ""))
                if tel and tel.input_value().strip():
                    skip_title = True
                    print(f"[VJSHI] 已用光厂 AI 推荐标题: {tel.input_value().strip()[:30]}")
        except Exception as e:
            print(f"[VJSHI] AI 推荐标题失败，回退自拟: {e}")
    # 标题/描述/价格（直接填写）
    for key, fname, value in [("title", "title", t["title"]),
                              ("description", "description", t["description"]),
                              ("price", "price", str(t["price"]))]:
        sel = cfg.get(key, "")
        if not sel or not value:
            continue
        if skip_title and key == "title":
            continue
        el = None
        for _ in range(6):  # 短等待兜底
            el = page.query_selector(sel)
            if el:
                break
            time.sleep(1)
        if not el:
            return False, f"未找到字段 {key}（页面结构变化）"
        try:
            el.click(timeout=3000)
            el.fill("")
            for ch in value[:300]:
                el.type(ch, delay=_rand(12, 35))
                if id(ch) % 17 == 0:
                    _human_pause(0.1, 0.4)  # 偶发停顿模拟思考
            _human_pause(0.3, 1.0)
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

    # v5.38.29: 视频风格按提示词自动识别（实拍写实/立体三维/平面二维/抽象光影）
    _select_ai_style(page, cfg, (t.get("title") or "") + " " + (t.get("description") or ""))
    time.sleep(0.3)
    # v5.38.19: 只勾「含AI内容」标注；「无缝循环」明确不勾选
    if cfg.get("hasAIGC"):
        _check_box(page, cfg["hasAIGC"])
        time.sleep(0.3)
    if cfg.get("isLoop"):
        try:
            page.evaluate("""(sel) => {
                const el = document.querySelector(sel);
                if (el && el.checked) {
                    const lab = el.closest('label');
                    if (lab) { lab.click(); } else { el.click(); }
                }
            }""", cfg["isLoop"])
            time.sleep(0.3)
        except Exception:
            pass
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
        # v5.38.16: 状态 re-check（retry 重复点击/多线程时只有 queued 才执行）
        _rc = _db()
        try:
            _row = _rc.execute("SELECT status FROM vjshi_upload_tasks WHERE id=?", [task_id]).fetchone()
        finally:
            _rc.close()
        if not _row or _row["status"] != "queued":
            return
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
        # 间隔（v5.38.7：45s ± 随机 15s，避免固定节奏）
        wait = (UPLOAD_INTERVAL_SEC + _rand(-15, 15)) - (time.time() - _STATE["last_upload_ts"])
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
                # v5.38.16: 配置/数据类错误（文件缺失/表单配置缺失）重试无意义，不累计暂停
                if t["fail_category"] not in ("file_missing", "form_config_missing"):
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
        pw, ctx = _new_context()
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.vjshi.com/", wait_until="domcontentloaded", timeout=30000)
        # 保持窗口打开（用户登录），context 不关闭
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
    if not _resolve_video_path(data.video_file):
        raise HTTPException(400, f"视频文件不存在: {data.video_file}")
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
            if not _resolve_video_path(vf):
                raise HTTPException(400, f"视频文件不存在: {vf}")
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
        if t["status"] in ("queued", "uploading", "filling"):
            raise HTTPException(400, "任务正在处理中，请勿重复重试")
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
