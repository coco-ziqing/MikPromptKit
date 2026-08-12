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
_pending_max_items = 0  # 单次拉取限流（测试用，0=不限）

# 缩略图生成任务状态
_thumb_state = {"running": False, "total": 0, "done": 0, "failed": 0, "message": ""}
_thumb_thread = None

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

def _read_devtools_port():
    """从 DevToolsActivePort 读取当前实例端口（无论实例由谁启动）"""
    pf = os.path.join(WEB_PROFILE_DIR, "DevToolsActivePort")
    if not os.path.exists(pf):
        return None
    try:
        with open(pf) as f:
            lines = f.read().strip().splitlines()
        return lines[0].strip() if lines else None
    except Exception:
        return None


def _port_alive(port) -> bool:
    if not port:
        return False
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2)
        return True
    except Exception:
        return False


def _chrome_is_alive() -> bool:
    """探测实例可用性：读 DevToolsActivePort + HTTP 端点（不依赖 Popen 句柄，
    兼容同 profile 复用场景——新 Popen 可能立即退出并转发给已有实例）"""
    return _port_alive(_read_devtools_port())


def ensure_chrome_started() -> dict:
    """确保独立 Chrome 调试实例在运行，返回 {connected, cdp_url, error}"""
    global _chrome_proc, _chrome_port
    if CHROME_BIN is None:
        return {"connected": False, "error": "未找到 Chrome/Edge"}
    with _chrome_lock:
        # 1) 已有实例（profile 内 DevToolsActivePort 可连）→ 直接复用
        exist_port = _read_devtools_port()
        if _port_alive(exist_port):
            _chrome_port = exist_port
            return {"connected": True, "cdp_url": f"http://127.0.0.1:{exist_port}"}
        os.makedirs(WEB_PROFILE_DIR, exist_ok=True)
        try:
            _chrome_proc = subprocess.Popen(
                [CHROME_BIN, f"--user-data-dir={WEB_PROFILE_DIR}", "--remote-debugging-port=0",
                 "--no-first-run", "--disable-default-apps", "--no-default-browser-check",
                 "--window-size=1280,900", "about:blank"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            return {"connected": False, "error": f"Chrome 启动失败: {e}"}
        # 轮询 DevToolsActivePort
        port = None
        for _ in range(60):
            port = _read_devtools_port()
            if _port_alive(port):
                break
            time.sleep(0.3)
        if not port or not _port_alive(port):
            return {"connected": False, "error": "调试端口未就绪"}
        _chrome_port = port
        time.sleep(0.8)
        return {"connected": True, "cdp_url": f"http://127.0.0.1:{port}"}


def stop_chrome() -> None:
    """停止采集 + 关闭实例（按端口找 PID，taskkill）"""
    global _chrome_proc, _chrome_port
    port = _read_devtools_port()
    with _chrome_lock:
        if port:
            try:
                out = subprocess.run(["netstat", "-ano", "-p", "tcp"], capture_output=True, text=True, timeout=15).stdout
                pid = None
                for line in out.splitlines():
                    if f"127.0.0.1:{port}" in line and "LISTENING" in line:
                        parts = line.split()
                        if parts:
                            pid = parts[-1]
                            break
                if pid:
                    subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True, text=True, timeout=15)
            except Exception as e:
                print(f"[Web Assets] 关闭实例失败: {e}")
        if _chrome_proc is not None and _chrome_proc.poll() is None:
            try:
                _chrome_proc.terminate()
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


def _deep_find(obj, key, path=""):
    """递归查找第一个匹配 key 的值"""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == key:
                return v
            r = _deep_find(v, key, path + "/" + k)
            if r is not None:
                return r
    elif isinstance(obj, list):
        for it in obj:
            r = _deep_find(it, key, path)
            if r is not None:
                return r
    return None


def _parse_asset_items(data):
    """结构化解析 get_asset_list 的 asset_list 条目（即梦资产页真实结构 v2026-08）：
    type=1 图片 / type=2 视频；prompt 在 item_list[].common_attr.prompt；媒体 URL 在 cover_url_map"""
    items = []
    alist = _deep_find(data, "asset_list") or []
    if not isinstance(alist, list):
        return items
    for a in alist:
        if not isinstance(a, dict):
            continue
        aid = str(a.get("id") or a.get("history_record_id") or "")
        if not aid:
            continue
        is_video = (str(a.get("type")) == "2") or ("video" in a and isinstance(a.get("video"), dict))
        sub = a.get("video") if is_video else a.get("image")
        sub = sub or {}
        item_list = sub.get("item_list") or []
        prompt = ""
        media_urls = []
        cover = ""
        created = a.get("created_time") or sub.get("created_time")
        for it in item_list:
            if not isinstance(it, dict):
                continue
            ca = it.get("common_attr") or {}
            if not isinstance(ca, dict):
                continue
            if not prompt:
                prompt = str(ca.get("prompt") or ca.get("description") or "").strip()
            urls = []
            cm = ca.get("cover_url_map") or {}
            if isinstance(cm, dict):
                # 每个子项只取最大分辨率（4096→360 降序）
                for k in ("4096", "2400", "1080", "720", "480", "360"):
                    v = cm.get(k)
                    if v:
                        urls.append(v)
                        break
            if not urls and ca.get("cover_url"):
                urls.append(ca["cover_url"])
            iu = ca.get("item_urls") or []
            if isinstance(iu, list):
                for u in iu:
                    if u and u not in urls:
                        urls.append(u)
            media_urls.extend([u for u in urls if u not in media_urls])
            if not cover and urls:
                cover = urls[-1] if is_video else urls[0]
        if not created:
            created = sub.get("created_time")
        items.append({
            "id": aid,
            "is_video": is_video,
            "prompt": prompt,
            "media_urls": media_urls,   # 图片=各分辨率URL；视频=封面URL（视频流需取流补充）
            "cover": cover,
            "time": created,
            "cli_submit_id": str(sub.get("submit_id") or ""),   # v5.36.21: 关联 CLI 提交 ID（跨通道去重）
        })
    return items


def _is_media_url(u: str) -> bool:
    """资产媒体 URL 判定：http 直链即可。即梦 CDN path 常以 .webp/.jpeg 结尾（aigc_resize:4096:4096.webp），不能用扩展名排除"""
    return bool(u) and u.startswith("http")


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
    """入库：去重 + 下载（多文件）+ 建词卡。返回 imported|skipped|failed"""
    _ensure_asset_table()
    db = get_db()
    if not item.get("id"):
        return "failed(无作品ID)"
    existing = db.execute(
        "SELECT id, is_deleted, word_card_id FROM dreamina_assets WHERE source='web' AND web_asset_id=?",
        [item["id"]]).fetchone()
    if existing:
        if not existing["is_deleted"]:
            return "skipped"
        # 软删记录：物理删除后允许重新导入（submit_id 有 UNIQUE 约束）
        db.execute("DELETE FROM dreamina_assets WHERE id=?", [existing["id"]])
        if existing["word_card_id"]:
            try:
                db.execute("DELETE FROM word_card WHERE id=?", [existing["word_card_id"]])
            except Exception:
                pass
    is_video = bool(item.get("is_video"))
    # 媒体 URL：视频优先 video_urls（取流），否则封面；图片取 media_urls（多分辨率，取最大即首个）
    urls = [u for u in (item.get("video_urls") or []) if _is_media_url(u)]
    if not urls:
        urls = [u for u in (item.get("media_urls") or []) if _is_media_url(u)]
    if not urls:
        c = item.get("cover") or ""
        if _is_media_url(c):
            urls = [c]
    if not urls:
        return "failed(无媒体URL)"
    # 图片：取最大分辨率（media_urls 首位）；多图作品（item_list 多张）下载全部（去掉封面小图干扰）
    download_urls = []
    if is_video:
        download_urls = urls[:1]  # 视频：取视频流
    else:
        download_urls = urls  # 图片：各 item 的最大分辨率 URL
    dest_dir = VID_DIR if is_video else IMG_DIR
    os.makedirs(dest_dir, exist_ok=True)
    safe_id = re.sub(r"[^0-9a-zA-Z_-]", "", item["id"]) or str(int(time.time() * 1000))
    file_names = []
    total_size = 0
    for idx, u in enumerate(download_urls):
        ext = os.path.splitext(urllib.parse.urlsplit(u).path)[1].lower()
        if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".mp4", ".mov", ".webm"):
            ext = ".mp4" if is_video else ".webp"
        fname = f"web_{safe_id}" + (f"_{idx+1}" if len(download_urls) > 1 else "") + ext
        dest = os.path.join(dest_dir, fname)
        if not _download_media(u, dest):
            continue
        file_names.append(fname)
        try:
            total_size += os.path.getsize(dest)
        except Exception:
            pass
    if not file_names:
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
        [gid, name, item.get("prompt") or "", meaning, media_type, file_names[0]])
    card_id = cur.lastrowid
    cur2 = db.execute(
        "INSERT INTO dreamina_assets (submit_id, source, web_asset_id, web_url, asset_type, gen_task_type, prompt, task_time, file_paths, file_size, gen_status, imported_at, word_card_id, cli_submit_id) "
        "VALUES (?, 'web', ?, ?, ?, ?, ?, ?, ?, ?, 'success', datetime('now','localtime'), ?, ?)",
        ["web_" + safe_id, item["id"], ASSET_PAGE_URL, media_type,
         "web_asset", item.get("prompt") or "", str(t), json.dumps(file_names, ensure_ascii=False),
         total_size, card_id, item.get("cli_submit_id") or ""])
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
                # 定位虚拟列表滚动容器（资产页是 vList 容器，滚 body 无效）
                page.evaluate("""() => {
                    let target = null, maxH = 0;
                    document.querySelectorAll('*').forEach(el => {
                        try {
                            const cs = getComputedStyle(el);
                            if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > maxH) { maxH = el.scrollHeight; target = el; }
                        } catch(e){}
                    });
                    if (!target) target = document.scrollingElement || document.body;
                    window.__sc = target;
                }""")
                # 滚动加载：以列表接口响应数判定稳定
                last_resp = -1
                stable_rounds = 0
                for _r in range(prof.get("max_scroll_rounds", 100)):
                    if _pull_state.get("stop_requested"):
                        break
                    page.evaluate("window.__sc.scrollTop = window.__sc.scrollHeight")
                    time.sleep(max(prof.get("scroll_idle_ms", 600) / 1000, 1.0))
                    if len(captured) == last_resp:
                        stable_rounds += 1
                        if stable_rounds >= 3:
                            break
                    else:
                        stable_rounds = 0
                        last_resp = len(captured)
                time.sleep(1.5)
                # 从网络响应提取列表（结构化解析 asset_list）
                items = []
                seen = set()
                diagnose = []
                for cap in captured:
                    parsed = _parse_asset_items(cap["data"])
                    if parsed:
                        diagnose.append({"url": cap["url"][:160], "key": "asset_list", "count": len(parsed),
                                         "sample_fields": ["id", "prompt", "media_urls"]})
                    for m in parsed:
                        if m["id"] not in seen:
                            seen.add(m["id"])
                            items.append(m)
                # 测试/限流：max_items（生产为 0=不限）
                global _pending_max_items
                max_items = int(_pending_max_items or 0)
                _pending_max_items = 0
                if max_items and len(items) > max_items:
                    items = items[:max_items]
                with _pull_lock:
                    _pull_state["diagnose"] = diagnose
                    _pull_state["found"] = len(items)
                if not items:
                    with _pull_lock:
                        _pull_state.update(stage="error", running=False, message="未识别到作品列表接口（页面结构可能已变化），请使用「采集诊断」查看")
                    page.close()
                    return
                # 视频取流：资产页虚拟列表渲染 video 预览（vlabvod 直链）→ 双向大步滚动收集 src，按 DOM 顺序关联
                video_items = [it for it in items if it.get("is_video")]
                if video_items:
                    with _pull_lock:
                        _pull_state["stage"] = "fetching_detail"
                    try:
                        video_srcs = []
                        scroll_step = 1500
                        try:
                            max_h = page.evaluate("window.__sc ? window.__sc.scrollHeight : document.body.scrollHeight") or 4000
                        except Exception:
                            max_h = 4000
                        # 向下 1 轮 + 向上 1 轮（虚拟列表双向渲染补充）
                        for direction in (1, -1):
                            if _pull_state.get("stop_requested"):
                                break
                            pos = 0 if direction > 0 else max_h
                            steps = 0
                            while steps < 400:
                                if _pull_state.get("stop_requested"):
                                    break
                                if "/ai-tool/asset" not in page.url:
                                    try:
                                        page.go_back(timeout=8000)
                                        time.sleep(1.5)
                                    except Exception:
                                        pass
                                try:
                                    page.evaluate(f"window.__sc.scrollTop = {pos}")
                                except Exception:
                                    pass
                                time.sleep(0.9)
                                try:
                                    srcs = page.evaluate("""() => {
                                        const out = [];
                                        document.querySelectorAll('video').forEach((v) => {
                                            const s = v.getAttribute('src') || '';
                                            if (s.indexOf('http') === 0 && s.indexOf('blob:') !== 0 && out.indexOf(s) < 0) out.push(s);
                                        });
                                        return out;
                                    }""") or []
                                    for s in srcs:
                                        if s not in video_srcs:
                                            video_srcs.append(s)
                                except Exception:
                                    pass
                                pos += direction * scroll_step
                                if pos < 0 or pos > max_h + 2000:
                                    break
                                steps += 1
                        # 顺序关联：视频资产 i ← video_srcs[i]
                        for i, it in enumerate(video_items):
                            if i < len(video_srcs):
                                it["video_urls"] = [video_srcs[i]]
                            else:
                                it["video_urls"] = []
                        print(f"[Web Assets] 视频取流: {len(video_srcs)} srcs / {len(video_items)} 视频资产")
                    except Exception as e:
                        print(f"[Web Assets] 视频取流异常: {e}")
                # 下载 + 入库（并发 4 线程，get_db 线程本地连接安全）
                with _pull_lock:
                    _pull_state["stage"] = "importing"
                try:
                    from concurrent.futures import ThreadPoolExecutor

                    def _import_one_wrapper(it):
                        try:
                            return it.get("id"), _import_web_asset(it, prof)
                        except Exception as e:
                            return it.get("id"), f"failed({e})"

                    with ThreadPoolExecutor(max_workers=int(prof.get("import_workers") or 4)) as _ex:
                        for _wid, _r in _ex.map(_import_one_wrapper, items):
                            if _pull_state.get("stop_requested"):
                                # 停止请求：不再启动新批次（已在跑的任务自然结束）
                                pass
                            with _pull_lock:
                                if _r == "imported":
                                    _pull_state["imported"] += 1
                                elif _r == "skipped":
                                    _pull_state["skipped"] += 1
                                else:
                                    _pull_state["failed"] += 1
                                    _pull_state["fail_list"].append({"id": _wid, "reason": _r})
                except Exception as e:
                    print(f"[Web Assets] 导入阶段异常: {e}")
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
                # 只关 page，保持 Chrome 实例运行（登录态/下次秒连）
                try:
                    page.close()
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
def web_assets_pull(data: dict = Body(default={})):
    """启动拉取（后台线程，幂等）。body: {max_items: 可选限流（测试用）}"""
    global _pull_thread, _pending_max_items
    with _pull_lock:
        if _pull_state["running"]:
            return {"ok": True, "running": True, "message": "采集已在进行中"}
    if _pull_thread is not None and _pull_thread.is_alive():
        return {"ok": True, "running": True, "message": "采集已在进行中"}
    try:
        _pending_max_items = int(data.get("max_items") or 0)
    except Exception:
        _pending_max_items = 0
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


@router.put("/web-assets/assets/{asset_id}")
def update_web_asset(asset_id: int, data: dict = Body(...)):
    """补全/编辑网页资产提示词（服务端未保存 prompt 的老资产可手动补充）"""
    _ensure_asset_table()
    db = get_db()
    row = db.execute(
        "SELECT * FROM dreamina_assets WHERE id=? AND source='web' AND is_deleted=0",
        [asset_id]).fetchone()
    if not row:
        raise HTTPException(404, "资产不存在")
    prompt = (data.get("prompt") or "").strip()
    db.execute("UPDATE dreamina_assets SET prompt=? WHERE id=?", [prompt, asset_id])
    if row["word_card_id"] and prompt:
        try:
            db.execute("UPDATE word_card SET content=?, updated_at=datetime('now','localtime') WHERE id=?",
                       [prompt, row["word_card_id"]])
        except Exception:
            pass
    safe_commit()
    return {"ok": True, "prompt": prompt}


# ==================== 缩略图补全 ====================

_THUMB_TARGET = (240, 160)


def _thumb_state_snapshot():
    with _pull_lock:
        return dict(_thumb_state)


def _gen_thumb_worker():
    """后台线程：为缺少缩略图的即梦资产图片词卡生成缩略图（Pillow 本地生成）"""
    from PIL import Image
    _ensure_asset_table()
    db = get_db()
    cards = db.execute(
        "SELECT id, preview_media FROM word_card WHERE module='dreamina_asset' AND media_type='image' "
        "AND (thumbnail IS NULL OR thumbnail='') AND preview_media != '' AND is_deleted=0").fetchall()
    total = len(cards)
    with _pull_lock:
        _thumb_state.update(running=True, total=total, done=0, failed=0, message="开始生成")
    thumb_dir = os.path.join(_PROJECT_ROOT, "data", "thumbnails")
    os.makedirs(thumb_dir, exist_ok=True)
    done = failed = 0
    for r in cards:
        if _thumb_state.get("stop_requested"):
            break
        cid = r["id"]
        fname = r["preview_media"] or ""
        src = os.path.join(IMG_DIR, os.path.basename(fname))
        dest = os.path.join(thumb_dir, f"{cid}.png")
        try:
            if not os.path.exists(src):
                raise FileNotFoundError(src)
            im = Image.open(src)
            if im.mode in ("RGBA", "P", "LA"):
                im = im.convert("RGB")
            tw, th = _THUMB_TARGET
            w, h = im.size
            scale = max(tw / w, th / h)
            nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
            im = im.resize((nw, nh), Image.LANCZOS)
            left, top = (nw - tw) // 2, (nh - th) // 2
            im = im.crop((left, top, left + tw, top + th))
            im.save(dest, "PNG")
            db.execute("UPDATE word_card SET thumbnail=?, thumb_width=?, thumb_height=?, thumb_engine='local_pillow', "
                       "updated_at=datetime('now','localtime') WHERE id=?",
                       [f"{cid}.png", tw, th, cid])
            done += 1
        except Exception as e:
            failed += 1
            if failed <= 5:
                print(f"[Web Assets] 缩略图生成失败 card={cid} {fname}: {e}")
        if (done + failed) % 50 == 0:
            with _pull_lock:
                _thumb_state.update(done=done, failed=failed)
            try:
                safe_commit()
            except Exception:
                pass
    try:
        safe_commit()
    except Exception:
        pass
    with _pull_lock:
        _thumb_state.update(running=False, done=done, failed=failed, message="完成", stop_requested=False)


@router.post("/web-assets/gen-thumbs")
def gen_web_thumbs():
    """为缺少缩略图的即梦资产图片词卡生成缩略图（后台线程）"""
    global _thumb_thread
    st = _thumb_state_snapshot()
    if st.get("running"):
        return {"ok": True, "running": True, "state": st}
    if _thumb_thread is not None and _thumb_thread.is_alive():
        return {"ok": True, "running": True, "state": st}
    _thumb_thread = threading.Thread(target=_gen_thumb_worker, daemon=True)
    _thumb_thread.start()
    return {"ok": True, "running": True}


@router.get("/web-assets/gen-thumbs/status")
def gen_web_thumbs_status():
    """缩略图生成进度"""
    return {"ok": True, "state": _thumb_state_snapshot()}
