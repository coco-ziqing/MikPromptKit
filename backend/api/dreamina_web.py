# -*- coding: utf-8 -*-
"""
即梦网页端历史资产导入模块（v5.36.14）— 方案 B：浏览器自动化
从即梦官网「资产」页拉取本人全部历史作品（含 App/官网直接生成、未走 CLI 的），
媒体下载到本地 + 词卡归档，与 CLI 通道合流（dreamina_assets.source='web'）。

核心思路：不逆向签名 —— 由页面 JS 自行生成，通过 CDP Network 域读取真实响应，
提取器配置化（capture_profile.json），改版可适配。
路由挂载: seedance_v2.py include_router，prefix 同为 /api/seedance/v2
"""
import json
import os
import re
import subprocess
import threading
import time
import urllib.parse
import urllib.request

from fastapi import APIRouter, Body, HTTPException, Query

from database import get_db, safe_commit
from api.dreamina_assets import _ensure_asset_table, _ensure_asset_group, IMG_DIR, VID_DIR

router = APIRouter(tags=["seedance-v2-web-assets"])

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB_PROFILE_DIR = os.path.join(_PROJECT_ROOT, "data", "dreamina_web_profile")
CAPTURE_PROFILE_PATH = os.path.join(_PROJECT_ROOT, "data", "capture_profile.json")
ASSET_PAGE_URL = "https://jimeng.jianying.com/ai-tool/asset"
CHROME_BIN = None
for _p in (
    os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "Google", "Chrome", "Application", "chrome.exe"),
    os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), "Google", "Chrome", "Application", "chrome.exe"),
    os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "Microsoft", "Edge", "Application", "msedge.exe"),
    os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), "Microsoft", "Edge", "Application", "msedge.exe"),
):
    if os.path.exists(_p):
        CHROME_BIN = _p
        break

LIST_KEYWORDS = ["asset", "list", "history", "my_work", "record", "works"]
DETAIL_KEYWORDS = ["detail", "info", "get"]
SKIP_EXT = (".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".mp4", ".mov", ".webm", ".woff", ".woff2")

# 采集任务全局状态
_pull_state = {
    "running": False,
    "stop_requested": False,
    "stage": "",            # idle|connecting|navigating|collecting|fetching_detail|downloading|importing|done|error
    "found": 0,
    "downloaded": 0,
    "imported": 0,
    "skipped": 0,
    "failed": 0,
    "fail_list": [],
    "message": "",
    "started_at": "",
    "finished_at": "",
    "diagnose": [],          # 接口命中记录 [{url, fields}]
}
_pull_thread = None
_pull_lock = threading.Lock()

# Chrome 实例管理
_chrome_proc = None
_chrome_port = None
_chrome_lock = threading.Lock()


def _now_str():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _load_capture_profile():
    """读取提取器配置（默认 + 上次学习结果合并）"""
    default = {
        "asset_page_url": ASSET_PAGE_URL,
        "list_api_keywords": LIST_KEYWORDS,
        "detail_api_keywords": DETAIL_KEYWORDS,
        "field_map": {
            "id": ["id", "asset_id", "work_id", "works_id", "resource_id"],
            "prompt": ["prompt", "prompt_text", "prompt_content", "text", "describe"],
            "cover": ["cover", "cover_url", "thumbnail", "thumb", "url", "image_url", "video_url"],
            "media": ["url", "image_url", "video_url", "play_url", "download_url", "media_url"],
            "time": ["create_time", "created_at", "timestamp", "ctime"],
            "type": ["asset_type", "media_type", "type", "resource_type"],
        },
        "max_scroll_rounds": 80,
        "scroll_idle_ms": 600,
        "max_detail_items": 200,
    }
    if os.path.exists(CAPTURE_PROFILE_PATH):
        try:
            with open(CAPTURE_PROFILE_PATH, encoding="utf-8") as f:
                saved = json.load(f)
            if isinstance(saved, dict):
                for k, v in saved.items():
                    default[k] = v
        except Exception:
            pass
    return default


def _save_capture_profile(prof):
    try:
        with open(CAPTURE_PROFILE_PATH, "w", encoding="utf-8") as f:
            json.dump(prof, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Web Assets] 保存采集配置失败: {e}")


# ==================== Chrome 实例管理 ====================

def _chrome_is_alive() -> bool:
    if _chrome_proc is None or _chrome_proc.poll() is not None:
        return False
    if _chrome_port:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{_chrome_port}/json/version", timeout=3)
            return True
        except Exception:
            return False
    return False


def ensure_chrome_started() -> dict:
    """确保独立 Chrome 调试实例在运行，返回 {connected, cdp_url, error}"""
    global _chrome_proc, _chrome_port
    if CHROME_BIN is None:
        return {"connected": False, "error": "未找到 Chrome/Edge"}
    with _chrome_lock:
        if _chrome_is_alive():
            return {"connected": True, "cdp_url": f"http://127.0.0.1:{_chrome_port}"}
        os.makedirs(WEB_PROFILE_DIR, exist_ok=True)
        try:
            _chrome_proc = subprocess.Popen(
                [CHROME_BIN, f"--user-data-dir={WEB_PROFILE_DIR}", "--remote-debugging-port=0",
                 "--no-first-run", "--disable-default-apps", "--no-default-browser-check",
                 "--window-size=1280,900", "about:blank"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            return {"connected": False, "error": f"Chrome 启动失败: {e}"}
        # 读取 DevToolsActivePort
        port = None
        for _ in range(60):
            pf = os.path.join(WEB_PROFILE_DIR, "DevToolsActivePort")
            if os.path.exists(pf):
                try:
                    with open(pf) as f:
                        lines = f.read().strip().splitlines()
                    if lines:
                        port = lines[0].strip()
                        break
                except Exception:
                    pass
            time.sleep(0.3)
        if not port:
            return {"connected": False, "error": "调试端口未就绪"}
        _chrome_port = port
        time.sleep(1.0)
        return {"connected": True, "cdp_url": f"http://127.0.0.1:{port}"}


def stop_chrome() -> None:
    global _chrome_proc, _chrome_port
    with _chrome_lock:
        if _chrome_proc is not None and _chrome_proc.poll() is None:
            try:
                _chrome_proc.terminate()
            except Exception:
                pass
            try:
                _chrome_proc.wait(timeout=5)
            except Exception:
                try:
                    _chrome_proc.kill()
                except Exception:
                    pass
        _chrome_proc = None
        _chrome_port = None


# ==================== 采集引擎 ====================

def _find_json_arrays(obj, depth=0):
    """递归找列表数组（疑似作品列表）"""
    if depth > 5:
        return []
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                out.append((k, v))
            out.extend(_find_json_arrays(v, depth + 1))
    elif isinstance(obj, list):
        for it in obj:
            out.extend(_find_json_arrays(it, depth + 1))
    return out


def _pick_field(item, keys):
    for k in keys:
        if k in item and item[k] is not None:
            return item[k]
    return None


def _normalize_item(raw, field_map) -> dict:
    """把列表接口的原始条目映射为统一结构"""
    def g(keys):
        return _pick_field(raw, keys)
    media = g(field_map.get("media", ["url"]))
    cover = g(field_map.get("cover", ["cover", "url"])) or media
    return {
        "id": str(g(field_map.get("id", ["id"])) or ""),
        "prompt": str(g(field_map.get("prompt", ["prompt"])) or ""),
        "cover": str(cover or ""),
        "media": str(media or ""),
        "time": g(field_map.get("time", ["create_time"])) or "",
        "raw_type": str(g(field_map.get("type", ["type"])) or ""),
    }


def _is_media_url(u: str) -> bool:
    return bool(u) and u.startswith("http") and not any(u.lower().endswith(e) for e in SKIP_EXT)


def _download_media(url: str, dest: str, referer: str = ASSET_PAGE_URL) -> bool:
    """下载媒体（CDN 需 Referer），断点：已存在且>0 跳过"""
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return True
    tmp = dest + ".tmp"
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
                "Referer": referer,
            })
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                while True:
                    chunk = r.read(65536)
                    if not chunk:
                        break
                    f.write(chunk)
            if os.path.getsize(tmp) > 0:
                os.replace(tmp, dest)
                return True
        except Exception as e:
            print(f"[Web Assets] 下载失败({attempt+1}) {url[:80]}: {e}")
            time.sleep(2 * (attempt + 1))
    try:
        if os.path.exists(tmp):
            os.remove(tmp)
    except Exception:
        pass
    return False


def _login_detected(page) -> bool:
    """登录检测：cookie 有 sessionid 或仍在资产页"""
    try:
        cookies = page.context.cookies()
        for c in cookies:
            if "sessionid" in (c.get("name") or "").lower():
                return True
    except Exception:
        pass
    try:
        url = page.url
        return "/ai-tool/asset" in url
    except Exception:
        return False


def _import_web_asset(item: dict, prof: dict) -> str:
    """入库：去重 + 下载 + 建词卡。返回 imported|skipped|failed"""
    _ensure_asset_table()
    db = get_db()
    if not item.get("id"):
        return "failed(无作品ID)"
    existing = db.execute(
        "SELECT id FROM dreamina_assets WHERE source='web' AND web_asset_id=? AND is_deleted=0",
        [item["id"]]).fetchone()
    if existing:
        return "skipped"
    # 下载
    media_url = item.get("media") or item.get("cover") or ""
    if not _is_media_url(media_url):
        return "failed(无媒体URL)"
    is_video = "video" in (item.get("raw_type") or "").lower() or any(
        media_url.lower().endswith(e) for e in (".mp4", ".mov", ".webm"))
    dest_dir = VID_DIR if is_video else IMG_DIR
    os.makedirs(dest_dir, exist_ok=True)
    ext = os.path.splitext(urllib.parse.urlsplit(media_url).path)[1].lower() or (".mp4" if is_video else ".jpg")
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".mp4", ".mov", ".webm"):
        ext = ".mp4" if is_video else ".jpg"
    safe_id = re.sub(r"[^0-9a-zA-Z_-]", "", item["id"]) or str(int(time.time() * 1000))
    fname = f"web_{safe_id}{ext}"
    dest = os.path.join(dest_dir, fname)
    if not _download_media(media_url, dest):
        return "failed(下载失败)"
    with _pull_lock:
        _pull_state["downloaded"] += 1
    # 词卡
    gid = _ensure_asset_group()
    media_type = "video" if is_video else "image"
    t = item.get("time") or ""
    if isinstance(t, (int, float)):
        try:
            t = time.strftime("%Y-%m-%d %H:%M", time.localtime(int(t) / 1000 if t > 10**12 else int(t)))
        except Exception:
            t = ""
    name = f"web-{safe_id[:12]}"
    meaning = " · ".join(x for x in ["即梦历史资产 · 🌐 网页来源", ("视频" if is_video else "图片"),
                                     str(t)] if x)
    cur = db.execute(
        "INSERT INTO word_card (group_id, name, content, meaning, media_type, preview_media, is_builtin, heat_weight, module, category, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, 0, 0.5, 'dreamina_asset', 'history_asset_web', datetime('now','localtime'), datetime('now','localtime'))",
        [gid, name, item.get("prompt") or "", meaning, media_type, fname])
    card_id = cur.lastrowid
    cur2 = db.execute(
        "INSERT INTO dreamina_assets (submit_id, source, web_asset_id, web_url, asset_type, gen_task_type, prompt, task_time, file_paths, file_size, gen_status, imported_at, word_card_id) "
        "VALUES (?, 'web', ?, ?, ?, ?, ?, ?, ?, ?, 'success', datetime('now','localtime'), ?)",
        ["web_" + safe_id, item["id"], ASSET_PAGE_URL, "video" if is_video else "image",
         "web_asset", item.get("prompt") or "", str(t), json.dumps([fname], ensure_ascii=False),
         os.path.getsize(dest) if os.path.exists(dest) else 0, card_id])
    safe_commit()
    return "imported"


def _pull_worker():
    """采集主流程（后台线程）"""
    import urllib.parse as _up
    from playwright.sync_api import sync_playwright
    prof = _load_capture_profile()
    with _pull_lock:
        _pull_state.update(running=True, stop_requested=False, stage="connecting", found=0, downloaded=0,
                           imported=0, skipped=0, failed=0, fail_list=[], message="",
                           started_at=_now_str(), finished_at="", diagnose=[])
    try:
        res = ensure_chrome_started()
        if not res.get("connected"):
            raise RuntimeError(res.get("error", "Chrome 未连接"))
        with _pull_lock:
            _pull_state["stage"] = "navigating"
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(res["cdp_url"])
            try:
                ctx = browser.contexts[0] if browser.contexts else browser.new_context()
                page = ctx.new_page()
                # 网络监听
                captured = []

                def _on_response(resp):
                    try:
                        u = resp.url
                        if any(u.lower().endswith(e) for e in SKIP_EXT):
                            return
                        if not any(k in u.lower() for k in prof.get("list_api_keywords", LIST_KEYWORDS)):
                            return
                        if "api" not in u.lower() and "json" not in (resp.headers.get("content-type") or "").lower():
                            return
                        body = resp.body()
                        data = json.loads(body.decode("utf-8", "ignore"))
                        captured.append({"url": u, "data": data})
                    except Exception:
                        pass

                page.on("response", _on_response)
                page.goto(prof.get("asset_page_url", ASSET_PAGE_URL), timeout=45000,
                          wait_until="domcontentloaded")
                time.sleep(2.5)
                if not _login_detected(page):
                    with _pull_lock:
                        _pull_state.update(stage="error", running=False, message="未登录：请在独立浏览器窗口完成即梦扫码登录后重试")
                    page.close()
                    return
                with _pull_lock:
                    _pull_state["stage"] = "collecting"
                # 滚动加载
                last_count = -1
                stable_rounds = 0
                for _r in range(prof.get("max_scroll_rounds", 80)):
                    if _pull_state.get("stop_requested"):
                        break
                    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    time.sleep(prof.get("scroll_idle_ms", 600) / 1000)
                    img_count = page.evaluate("document.querySelectorAll('img').length")
                    if img_count == last_count:
                        stable_rounds += 1
                        if stable_rounds >= 3:
                            break
                    else:
                        stable_rounds = 0
                        last_count = img_count
                time.sleep(1.0)
                # 从网络响应提取列表
                items = []
                seen = set()
                diagnose = []
                for cap in captured:
                    arrays = _find_json_arrays(cap["data"])
                    for key, arr in arrays:
                        if len(arr) < 2:
                            continue
                        mapped = [_normalize_item(x, prof.get("field_map", {})) for x in arr[:300]]
                        mapped = [m for m in mapped if m["id"]]
                        if not mapped:
                            continue
                        diagnose.append({"url": cap["url"][:160], "key": key, "count": len(mapped),
                                         "sample_fields": sorted({k for m in mapped for k in m if m[k]})[:20]})
                        for m in mapped:
                            if m["id"] not in seen:
                                seen.add(m["id"])
                                items.append(m)
                with _pull_lock:
                    _pull_state["diagnose"] = diagnose
                    _pull_state["found"] = len(items)
                if not items:
                    # DOM 兜底：从 img 收集（仅记录诊断，不强行入库）
                    with _pull_lock:
                        _pull_state.update(stage="error", running=False, message="未识别到作品列表接口（页面结构可能已变化），请使用「采集诊断」查看")
                    page.close()
                    return
                # 详情补全 prompt（列表里缺 prompt 的条目，尝试点击作品卡片监听详情）
                missing_prompt = [it for it in items if not it.get("prompt")]
                with _pull_lock:
                    _pull_state["stage"] = "fetching_detail"
                if missing_prompt and len(missing_prompt) <= prof.get("max_detail_items", 200):
                    detail_captured = []

                    def _on_detail(resp):
                        try:
                            u = resp.url
                            if any(u.lower().endswith(e) for e in SKIP_EXT):
                                return
                            if not any(k in u.lower() for k in prof.get("detail_api_keywords", DETAIL_KEYWORDS)):
                                return
                            body = resp.body()
                            data = json.loads(body.decode("utf-8", "ignore"))
                            detail_captured.append({"url": u, "data": data})
                        except Exception:
                            pass

                    page.on("response", _on_detail)
                    cards = page.query_selector_all("img")
                    clicked = 0
                    for it in missing_prompt:
                        if _pull_state.get("stop_requested"):
                            break
                        for c in cards:
                            try:
                                c.click(timeout=1500)
                                clicked += 1
                                break
                            except Exception:
                                continue
                        if clicked >= min(15, len(missing_prompt)):
                            break
                    time.sleep(1.5)
                    # 从详情响应提取 prompt
                    for cap in detail_captured:
                        arrays = _find_json_arrays(cap["data"])
                        for key, arr in arrays:
                            for x in arr[:200]:
                                pid = str(_pick_field(x, prof.get("field_map", {}).get("id", ["id"])) or "")
                                if pid in seen:
                                    pr = _pick_field(x, prof.get("field_map", {}).get("prompt", ["prompt"]))
                                    if pr:
                                        for it in items:
                                            if it["id"] == pid and not it["prompt"]:
                                                it["prompt"] = str(pr)
                # 下载 + 入库
                with _pull_lock:
                    _pull_state["stage"] = "importing"
                for it in items:
                    if _pull_state.get("stop_requested"):
                        break
                    try:
                        r = _import_web_asset(it, prof)
                    except Exception as e:
                        r = f"failed({e})"
                    with _pull_lock:
                        if r == "imported":
                            _pull_state["imported"] += 1
                        elif r == "skipped":
                            _pull_state["skipped"] += 1
                        else:
                            _pull_state["failed"] += 1
                            _pull_state["fail_list"].append({"id": it.get("id"), "reason": r,
                                                              "prompt": (it.get("prompt") or "")[:50]})
                # 保存学习到的接口模式
                if diagnose:
                    learned = {"list_api_keywords": list(set(prof.get("list_api_keywords", LIST_KEYWORDS))),
                               "last_list_urls": [d["url"] for d in diagnose[:5]],
                               "last_run_at": _now_str()}
                    prof.update(learned)
                    _save_capture_profile(prof)
                with _pull_lock:
                    _pull_state.update(stage="done", running=False, message="采集完成", finished_at=_now_str())
                page.close()
            finally:
                try:
                    browser.close()
                except Exception:
                    pass
    except Exception as e:
        with _pull_lock:
            _pull_state.update(stage="error", running=False, message=f"采集异常: {e}", finished_at=_now_str())


# ==================== API ====================

@router.get("/web-assets/status")
def web_assets_status():
    """连接与采集状态"""
    _ensure_asset_table()
    db = get_db()
    imported = db.execute(
        "SELECT COUNT(*) c FROM dreamina_assets WHERE source='web' AND is_deleted=0").fetchone()["c"]
    with _pull_lock:
        st = dict(_pull_state)
    return {"ok": True, "connected": _chrome_is_alive(), "logged_in": False,
            "chrome_bin": CHROME_BIN, "profile_dir": WEB_PROFILE_DIR,
            "imported_web_total": imported, "progress": st}


@router.post("/web-assets/connect")
def web_assets_connect():
    """启动独立 Chrome 实例（幂等）"""
    res = ensure_chrome_started()
    return {"ok": res.get("connected"), **res}


@router.post("/web-assets/stop")
def web_assets_stop():
    """停止采集 + 关闭实例"""
    global _pull_thread
    with _pull_lock:
        _pull_state["stop_requested"] = True
    stop_chrome()
    return {"ok": True}


@router.post("/web-assets/check-login")
def web_assets_check_login():
    """轻量登录检测：连接实例并检查 sessionid cookie（≤10s）"""
    res = ensure_chrome_started()
    if not res.get("connected"):
        return {"ok": True, "connected": False, "logged_in": False, "error": res.get("error", "Chrome 未连接")}
    logged_in = False
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(res["cdp_url"])
            try:
                ctx = browser.contexts[0] if browser.contexts else browser.new_context()
                for c in ctx.cookies():
                    if "sessionid" in (c.get("name") or "").lower():
                        logged_in = True
                        break
            finally:
                try:
                    browser.close()
                except Exception:
                    pass
    except Exception as e:
        return {"ok": True, "connected": True, "logged_in": False, "error": f"检测异常: {e}"}
    return {"ok": True, "connected": True, "logged_in": logged_in}


@router.post("/web-assets/pull")
def web_assets_pull():
    """启动拉取（后台线程，幂等）"""
    global _pull_thread
    with _pull_lock:
        if _pull_state["running"]:
            return {"ok": True, "running": True, "message": "采集已在进行中"}
    if _pull_thread is not None and _pull_thread.is_alive():
        return {"ok": True, "running": True, "message": "采集已在进行中"}
    _pull_thread = threading.Thread(target=_pull_worker, daemon=True)
    _pull_thread.start()
    return {"ok": True, "running": True}


@router.post("/web-assets/retry-fail")
def web_assets_retry_fail():
    """重试失败条目（以失败列表中的 id 重新入库）"""
    global _pull_thread
    with _pull_lock:
        fails = list(_pull_state.get("fail_list") or [])
        if not fails:
            return {"ok": True, "message": "没有失败条目"}
        _pull_state["fail_list"] = []
    prof = _load_capture_profile()
    db = get_db()
    done = {"imported": 0, "failed": 0}
    for f in fails:
        row = db.execute("SELECT * FROM dreamina_assets WHERE source='web' AND web_asset_id=? AND is_deleted=1",
                         [f["id"]]).fetchone()
        if row:
            # 软删记录：恢复
            db.execute("UPDATE dreamina_assets SET is_deleted=0 WHERE id=?", [row["id"]])
            if row["word_card_id"]:
                db.execute("UPDATE word_card SET is_deleted=0 WHERE id=?", [row["word_card_id"]])
            safe_commit()
            done["imported"] += 1
            continue
        # 未入库的失败：用存储的 prompt 重建（媒体需重新下载）
        item = {"id": f["id"], "prompt": f.get("prompt") or "", "cover": "", "media": "", "raw_type": ""}
        r = _import_web_asset(item, prof)
        if r == "imported":
            done["imported"] += 1
        else:
            done["failed"] += 1
    return {"ok": True, **done}


@router.get("/web-assets/diagnose")
def web_assets_diagnose():
    """最近一次采集的接口命中诊断"""
    with _pull_lock:
        return {"ok": True, "diagnose": list(_pull_state.get("diagnose") or []),
                "capture_profile": _load_capture_profile()}


@router.get("/web-assets/assets")
def list_web_assets(
    page: int = Query(1, ge=1),
    page_size: int = Query(60, ge=1, le=200),
    asset_type: str = Query("all"),
    time_from: str = Query(""),
    time_to: str = Query(""),
):
    """网页来源已导入资产（类型/时间筛选）"""
    _ensure_asset_table()
    db = get_db()
    where = "source='web' AND is_deleted=0"
    params = []
    if asset_type != "all":
        where += " AND asset_type=?"
        params.append(asset_type)
    if time_from:
        where += " AND task_time>=?"
        params.append(time_from)
    if time_to:
        where += " AND task_time<=?"
        params.append(time_to)
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
        items.append(d)
    return {"ok": True, "total": total, "page": page, "page_size": page_size, "items": items}
