# -*- coding: utf-8 -*-
"""
词卡采集模块（v5.42.0）— 外部灵感内容 → 本地词卡 全链路
链路：收藏(前置) → 浏览器自动化采集 → 采集结果 → 分组归档(自动+手动) → 建词卡(带来源溯源)

核心思路：
- 复用即梦网页通道的 CDP 方案（独立 Chrome profile + playwright connect_over_cdp），
  不逆向签名，由页面 JS 自行生成请求，读取真实响应做"自主识别"
- 通用启发式识别：DOM 媒体元素 + 网络 JSON 响应（prompt/model/params 键）+ 页面文本
- 合规红线：不登录、不填账号、无验证码绕过、单任务限额、可中断、服务重启不自动续跑

路由：/api/card-collect
"""
import json
import os
import re
import subprocess
import threading
import time
import urllib.error
import urllib.request

from fastapi import APIRouter, Body, File, HTTPException, Query, UploadFile

from database import get_db, safe_commit

router = APIRouter(prefix="/api/card-collect", tags=["card-collect"])

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(_PROJECT_ROOT, "data", "card_collect")
IMG_DIR = os.path.join(DATA_DIR, "images")
VID_DIR = os.path.join(DATA_DIR, "videos")
LOGO_DIR = os.path.join(DATA_DIR, "logos")
THUMB_DIR = os.path.join(DATA_DIR, "thumbs")  # v5.43.1 fetch-meta 首图缩略图
PROFILE_DIR = os.path.join(DATA_DIR, "chrome_profile")
os.makedirs(IMG_DIR, exist_ok=True)
os.makedirs(VID_DIR, exist_ok=True)
os.makedirs(LOGO_DIR, exist_ok=True)
os.makedirs(THUMB_DIR, exist_ok=True)

# Chrome 可执行文件探测（与 dreamina_web 相同策略）
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

# 合规限额
MAX_ITEMS_PER_TASK = 20      # 单任务最多采集项
MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024  # 单媒体 60MB 上限（防超大视频拖垮）
SKIP_MEDIA_KEYWORDS = ("logo", "icon", "avatar", "favicon", "sprite", "emoji", "placeholder",
                       "blank.gif", "1x1", "pixel", "advertisement", "banner", "vipModel", "badge", "qr")
PROMPT_KEYS = ("prompt", "prompt_text", "prompt_content", "prompt_cn", "prompt_zh", "positive_prompt",
               "prompt_en", "prompt_raw")
MODEL_KEYS = ("model", "model_name", "modelName", "model_version", "engine", "generate_model", "model_label")
PARAM_KEYS = ("params", "parameters", "extra", "config", "setting", "settings", "generate_params")
MODEL_PATTERN = re.compile(
    r"(seedance[^\s,;\"']*|jimeng[^\s,;\"']*|midjourney|mj v\d|niji|stable[ -]?diffusion|sd\d|sdxl|"
    r"flux[^\s,;\"']*|f\.?1[^\s,;\"']*|illustrious|noobai|pony[^\s,;\"']*|qwen[^\s,;\"']*|通义|"
    r"kling|k[-\s]?ling|可灵|即梦|dall[ -]?e\s*\d*|gpt[ -]?image|"
    r"comfyui|fooocus|wan[^\s,;\"']*|hunyuan|混元|hailuo|海螺|pika|luma|runway|veo[^\s,;\"']*|sora|"
    r"chilloutmix|anything[ -]?v?\d*|counterfeit|majicmix|dreamshaper)",
    re.IGNORECASE)
PARAM_PATTERN = re.compile(
    r"(\d{2,4}\s*[xX×]\s*\d{2,4}|1:1|16:9|9:16|4:3|3:4|2:3|3:2|21:9|seed\s*[:=]?\s*\d+|"
    r"steps?\s*[:=]?\s*\d+|cfg\s*[:=]?\s*[\d.]+|时长\s*[:：]?\s*\d+[s秒]?|duration\s*[:=]?\s*\d+[s]?|"
    r"分辨率\s*[:：]?\s*[\d\sxX×]+|negative\s*prompt[^\n。;；]*|负面提示词[^\n。;；]*)",
    re.IGNORECASE)

# 平台域名 → 建议分组名（自主识别分组）
PLATFORM_GROUPS = {
    "jimeng": "即梦灵感", "jianying.com": "即梦灵感",
    "xiaohongshu": "小红书灵感", "xhslink": "小红书灵感",
    "liblib.art": "LibLib 灵感", "liblibai": "LibLib 灵感",
    "miaohua": "秒画灵感", "sensetime": "秒画灵感",
    "midjourney": "Midjourney 灵感",
    "bilibili": "B站灵感",
    "douyin": "抖音灵感",
    "klingai": "可灵灵感",
    "hailuoai": "海螺灵感",
    "pinterest": "Pinterest 灵感",
    "artstation": "ArtStation 灵感",
}

# ==================== 基础工具 ====================

_chrome_proc = None
_chrome_port = None
_chrome_lock = threading.Lock()
_task_lock = threading.Lock()   # 采集任务全局串行锁
_stop_flags = {}                # task_id -> bool（请求中断）


def _now_str():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _db():
    c = __import__("sqlite3").connect(os.path.join(_PROJECT_ROOT, "data", "prompts.db"), timeout=5)
    c.row_factory = __import__("sqlite3").Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=4000")
    return c


def _auth(request, require=True):
    try:
        from auth import get_current_user
        u = get_current_user(request)
        if require and not (u and u.get("authenticated")):
            raise HTTPException(401, "请先登录")
        return u
    except HTTPException:
        raise
    except Exception:
        if require:
            raise HTTPException(401, "请先登录")
        return None


# ==================== 表结构（幂等迁移） ====================

def _ensure_tables():
    c = _db()
    try:
        c.execute("""CREATE TABLE IF NOT EXISTS card_collect_favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            title TEXT DEFAULT '',
            note TEXT DEFAULT '',
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            collected_at TEXT DEFAULT ''
        )""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_ccf_status ON card_collect_favorites(status)")
        # v5.43.0: 网页收藏库扩展列（四池状态 + 元数据 + 清洗字段，幂等 ALTER）
        fav_cols = [r["name"] for r in c.execute("PRAGMA table_info(card_collect_favorites)").fetchall()]
        for _col, _ddl in {
            "fetch_status": "TEXT DEFAULT 'pending'",
            "fetch_title": "TEXT DEFAULT ''",
            "fetch_desc": "TEXT DEFAULT ''",
            "fetch_text": "TEXT DEFAULT ''",
            "thumb": "TEXT DEFAULT ''",
            "domain": "TEXT DEFAULT ''",
            "site_name": "TEXT DEFAULT ''",
            "clean_url": "TEXT DEFAULT ''",
            "updated_at": "TEXT DEFAULT ''",
        }.items():
            if _col not in fav_cols:
                c.execute(f"ALTER TABLE card_collect_favorites ADD COLUMN {_col} {_ddl}")
                print(f"[CardCollect] card_collect_favorites 增加列 {_col}")
        c.execute("""CREATE TABLE IF NOT EXISTS card_collect_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fav_id INTEGER DEFAULT 0,
            url TEXT NOT NULL,
            status TEXT DEFAULT 'queued',
            progress INTEGER DEFAULT 0,
            message TEXT DEFAULT '',
            found_count INTEGER DEFAULT 0,
            page_title TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            started_at TEXT DEFAULT '',
            finished_at TEXT DEFAULT ''
        )""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_cct_status ON card_collect_tasks(status)")
        # v5.46.21: 任务开始时间标记（幂等 ALTER，兼容旧表）
        task_cols = [r["name"] for r in c.execute("PRAGMA table_info(card_collect_tasks)").fetchall()]
        if "started_at" not in task_cols:
            c.execute("ALTER TABLE card_collect_tasks ADD COLUMN started_at TEXT DEFAULT ''")
            print("[CardCollect] card_collect_tasks 增加列 started_at")
        c.execute("""CREATE TABLE IF NOT EXISTS card_collect_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER DEFAULT 0,
            fav_id INTEGER DEFAULT 0,
            source_url TEXT DEFAULT '',
            page_title TEXT DEFAULT '',
            media_type TEXT DEFAULT 'image',
            media_url TEXT DEFAULT '',
            media_original_url TEXT DEFAULT '',
            prompt TEXT DEFAULT '',
            model TEXT DEFAULT '',
            params TEXT DEFAULT '',
            raw_data TEXT DEFAULT '{}',
            suggest_group TEXT DEFAULT '',
            status TEXT DEFAULT 'pending',
            word_card_id INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            archived_at TEXT DEFAULT ''
        )""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_cci_status ON card_collect_items(status)")
        c.execute("""CREATE TABLE IF NOT EXISTS card_collect_sites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL DEFAULT '',
            url TEXT NOT NULL DEFAULT '',
            description TEXT DEFAULT '',
            logo TEXT DEFAULT '',
            icon_emoji TEXT DEFAULT '🌐',
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_ccs_sort ON card_collect_sites(sort_order)")
        # v5.42.4: 需登录标注列（幂等 ALTER）
        site_cols = [r["name"] for r in c.execute("PRAGMA table_info(card_collect_sites)").fetchall()]
        if "login_required" not in site_cols:
            c.execute("ALTER TABLE card_collect_sites ADD COLUMN login_required INTEGER DEFAULT 0")
            print("[CardCollect] card_collect_sites 增加列 login_required")
        # v5.43.1: 站点分组 + 预制标记（幂等 ALTER）
        if "group_name" not in site_cols:
            c.execute("ALTER TABLE card_collect_sites ADD COLUMN group_name TEXT DEFAULT '灵感图库'")
            print("[CardCollect] card_collect_sites 增加列 group_name")
        if "is_builtin" not in site_cols:
            c.execute("ALTER TABLE card_collect_sites ADD COLUMN is_builtin INTEGER DEFAULT 0")
            print("[CardCollect] card_collect_sites 增加列 is_builtin")
        c.commit()
        # 预置种子标注：需登录的平台（实测/常识确认）
        login_sites = {"Midjourney 画廊": 1, "即梦 AI": 1, "小红书": 1, "可灵 AI": 1, "海螺 AI": 1}
        for nm, lr in login_sites.items():
            c.execute("UPDATE card_collect_sites SET login_required=? WHERE name=?", [lr, nm])
        c.commit()
        # v5.43.1: 预置种子分组标注 + 内置不可删标记（幂等 UPDATE）
        builtin_groups = {
            "LibLib 哩布哩布": ("提示词站点", 1), "Civitai": ("提示词站点", 1),
            "即梦 AI": ("灵感图库", 1), "Midjourney 画廊": ("灵感图库", 1),
            "小红书": ("灵感图库", 1), "Pinterest": ("灵感图库", 1),
            "ArtStation": ("设计参考", 1),
            "可灵 AI": ("素材榜单", 1), "海螺 AI": ("素材榜单", 1), "B 站灵感区": ("素材榜单", 1),
        }
        for nm, (grp, bi) in builtin_groups.items():
            c.execute("UPDATE card_collect_sites SET group_name=?, is_builtin=? WHERE name=?", [grp, bi, nm])
        c.commit()
        # 种子数据：常用灵感图库（幂等，仅首次插入）
        cnt = c.execute("SELECT COUNT(*) FROM card_collect_sites").fetchone()[0]
        if cnt == 0:
            seeds = [
                ("LibLib 哩布哩布", "https://www.liblib.art", "国内 AI 绘画模型库，海量模型/作品/提示词", "🖼"),
                ("即梦 AI", "https://jimeng.jianying.com", "字节旗下 AI 创作平台，图/视频生成灵感", "✨"),
                ("Midjourney 画廊", "https://www.midjourney.com/explore", "MJ 官方作品探索，高质量 AI 艺术灵感", "🎨"),
                ("小红书", "https://www.xiaohongshu.com", "生活方式社区，AI 绘画/灵感笔记聚集地", "📕"),
                ("Pinterest", "https://www.pinterest.com", "全球视觉灵感库，图板检索神器", "📌"),
                ("ArtStation", "https://www.artstation.com", "专业艺术家作品平台，CG/概念设计灵感", "🎭"),
                ("可灵 AI", "https://klingai.com", "快手旗下 AI 视频/图像生成平台", "🎬"),
                ("海螺 AI", "https://hailuoai.com", "MiniMax 旗下 AI 创作平台", "🐚"),
                ("Civitai", "https://civitai.com", "国际 SD 模型/作品社区（内容分级，注意合规）", "🌍"),
                ("B 站灵感区", "https://www.bilibili.com", "视频灵感与 AI 创作教程社区", "📺"),
            ]
            for i, (nm, u, ds, em) in enumerate(seeds):
                c.execute(
                    "INSERT INTO card_collect_sites (name, url, description, logo, icon_emoji, sort_order, created_at) "
                    "VALUES (?,?,?,'',?,?,datetime('now','localtime'))",
                    [nm, u, ds, em, i])
            c.commit()
            print(f"[CardCollect] 已预置灵感图库 {len(seeds)} 条")
    finally:
        c.close()


_ensure_tables()


def _mark_interrupted_on_boot():
    """合规：服务重启后遗留的 queued/running 任务不自动续跑，标记为中断"""
    c = _db()
    try:
        c.execute("UPDATE card_collect_tasks SET status='fail', message='服务重启，采集已中断（合规：不自动续跑）', "
                  "finished_at=datetime('now','localtime') WHERE status IN ('queued','running')")
        c.commit()
    except Exception:
        pass
    finally:
        c.close()


_mark_interrupted_on_boot()


# ==================== Chrome 实例管理（独立 profile，复用即梦 CDP 方案） ====================

def _read_devtools_port():
    pf = os.path.join(PROFILE_DIR, "DevToolsActivePort")
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


def ensure_chrome_started() -> dict:
    global _chrome_proc, _chrome_port
    if CHROME_BIN is None:
        return {"connected": False, "error": "未找到 Chrome/Edge 浏览器"}
    with _chrome_lock:
        exist_port = _read_devtools_port()
        if _port_alive(exist_port):
            _chrome_port = exist_port
            return {"connected": True, "cdp_url": f"http://127.0.0.1:{exist_port}"}
        os.makedirs(PROFILE_DIR, exist_ok=True)
        try:
            _chrome_proc = subprocess.Popen(
                [CHROME_BIN, f"--user-data-dir={PROFILE_DIR}", "--remote-debugging-port=0",
                 "--no-first-run", "--disable-default-apps", "--no-default-browser-check",
                 # v5.42.17: 窗口固定屏幕外（不可见零打扰，防任务中忽大忽小）+ 禁用崩溃恢复气泡
                 "--window-size=1280,900", "--window-position=-32000,-32000",
                 "--disable-session-crashed-bubble", "--no-restore-session-state", "about:blank"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            return {"connected": False, "error": f"Chrome 启动失败: {e}"}
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
            except Exception:
                pass
        if _chrome_proc is not None and _chrome_proc.poll() is None:
            try:
                _chrome_proc.terminate()
            except Exception:
                pass
        _chrome_proc = None
        _chrome_port = None


# ==================== 自主识别（通用启发式） ====================

def _deep_find(obj, key, depth=0):
    """递归查找第一个匹配 key 的值"""
    if depth > 6 or obj is None:
        return None
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == key:
                return v
            r = _deep_find(v, key, depth + 1)
            if r is not None:
                return r
    elif isinstance(obj, list):
        for it in obj:
            r = _deep_find(it, key, depth)
            if r is not None:
                return r
    return None


def _pick_field(item, keys):
    for k in keys:
        if isinstance(item, dict) and k in item and item[k] is not None:
            return item[k]
    return None


def _looks_media_url(u: str) -> bool:
    if not u or not u.startswith("http"):
        return False
    low = u.lower()
    if any(s in low for s in SKIP_MEDIA_KEYWORDS):
        return False
    # 静态资源目录（站点自用图，非作品内容）
    if "/static/" in low and "liblib" in low:
        return False
    # 排除明显静态资源
    if low.endswith((".js", ".css", ".json", ".woff", ".woff2", ".html", ".svg")):
        return False
    # CDN 图片直链（webp/jpeg/png 等结尾）或视频直链
    return True


def _extract_prompt_from_json(data) -> str:
    """从 JSON 递归提取提示词：仅认明确 prompt 键（v5.42.6：describe/text 歧义太大——
    LibLib modelCard 模型介绍、导航菜单 text 均被误抓，已完全移除 fallback，抓不到即空）"""
    best = ""
    stack = [data]
    while stack and len(best) < 500:
        node = stack.pop()
        if isinstance(node, dict):
            for k, v in node.items():
                if k in PROMPT_KEYS and isinstance(v, str) and len(v.strip()) > len(best) and len(v.strip()) >= 8:
                    best = v.strip()
                elif isinstance(v, (dict, list)):
                    stack.append(v)
        elif isinstance(node, list):
            stack.extend(node)
    return best[:4000]


def _extract_model_from_json(data) -> str:
    stack = [data]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            m = _pick_field(node, MODEL_KEYS)
            if isinstance(m, str) and m.strip():
                return m.strip()[:200]
            for v in node.values():
                stack.append(v)
        elif isinstance(node, list):
            stack.extend(node)
    return ""


def _extract_media_from_json(data):
    """从 JSON 递归提取媒体 URL（图片/视频直链，最多 8 个）"""
    out = []
    stack = [data]
    while stack and len(out) < 8:
        node = stack.pop()
        if isinstance(node, dict):
            for k, v in node.items():
                if isinstance(v, str) and _looks_media_url(v):
                    kl = k.lower()
                    if any(x in kl for x in ("avatar", "icon", "logo", "emoji")):
                        continue
                    if any(x in kl for x in ("url", "media", "image", "video", "cover", "thumb", "play", "download")):
                        out.append(v)
                elif isinstance(v, (dict, list)):
                    stack.append(v)
        elif isinstance(node, list):
            stack.extend(node)
    # 去重保序
    seen = set()
    uniq = []
    for u in out:
        if u not in seen:
            seen.add(u)
            uniq.append(u)
    return uniq


def _extract_ssr_work(page, url):
    """v5.46.24: 从页面内嵌 SSR 数据（React Router _ROUTER_DATA / _SSR_DATA）提取作品详情对象。
    即梦等详情页的作品数据由 SSR 内嵌在 script 中（非网络 JSON 响应），
    且页面会加载大量配置/文案/推荐接口——直接遍历响应极易串味误抓。
    优先定位含 URL 作品 ID 且路径命中 workDetail/detail 的对象，prompt/model/media 同源提取。"""
    try:
        html = page.content()
    except Exception:
        return None
    target_id = ""
    m = re.search(r"/(?:work-detail|work|detail|item|post|imageinfo|model|pin)/([A-Za-z0-9_\-]+)", url)
    if m:
        target_id = m.group(1)
    for var in ("_ROUTER_DATA", "_SSR_DATA"):
        mm = re.search(r"window\.%s\s*=\s*(\{.*?\})\s*</script>" % var, html, re.S)
        if not mm:
            continue
        try:
            data = json.loads(mm.group(1))
        except Exception:
            continue
        best = None
        stack = [(data, "")]
        while stack:
            node, path = stack.pop()
            if isinstance(node, dict):
                txt = ""
                try:
                    txt = json.dumps(node, ensure_ascii=False)
                except Exception:
                    pass
                score = 0
                if target_id and target_id in txt:
                    score += 10
                if any(k in path.lower() for k in ("workdetail", "detail", "info", "data")):
                    score += 5
                if score > 0 and (best is None or score > best[0]):
                    if any(k in txt for k in ("prompt", "model", "coverUrl", "itemUrls", "image")):
                        best = (score, node)
                for k, v in node.items():
                    if isinstance(v, (dict, list)):
                        stack.append((v, path + "/" + k))
            elif isinstance(node, list):
                for v in node:
                    if isinstance(v, (dict, list)):
                        stack.append((v, path))
        if best:
            return best[1]
    return None


def _extract_prompt_from_dom(page):
    """DOM 文本提取：定位「提示词/负向提示词」标签 → 取最长内容容器（≤2500）
    → 正则边界切分正向/负向提示词。
    适配 LibLib（mantine-Spoiler 折叠容器 + 标签独立文本节点，无冒号）。
    返回 (prompt, negative)。"""
    try:
        return page.evaluate("""() => {
            const findLabel = (el, names) => {
                if (el.nodeType !== 1) return null;
                const t = (el.textContent || '').trim();
                if (t.length <= 20 && names.some(n => t === n) && el.children.length === 0) return el;
                for (const c of el.children) { const r = findLabel(c, names); if (r) return r; }
                return null;
            };
            const pickLong = (label) => {
                let cur = label.parentElement, best = '';
                for (let i = 0; i < 8 && cur; i++) {
                    const t = (cur.textContent || '').trim();
                    if (t.length > best.length && t.length <= 2500) best = t;
                    cur = cur.parentElement;
                }
                return best;
            };
            const clean = (seg) => seg
                .replace(/^(提示词|负向提示词|生成提示词|Prompt|Negative prompt)\\s*[:：]?/i, '')
                .replace(/生成参数|复制参数|展开|收起/g, '')
                .trim();
            const labP = findLabel(document.body, ['提示词', 'prompt', 'Prompt', '生成提示词']);
            const labN = findLabel(document.body, ['负向提示词', 'Negative prompt', 'negative prompt']);
            let prompt = '', negative = '';
            if (labP) {
                const full = pickLong(labP);
                if (full) {
                    // 正向：第一个「提示词(排除提示词引导)」后 到 负向/采样/参数 前
                    const m = full.match(/提示词(?!引导)[\\s\\S]*?(?=负向提示词|采样方法|Sampler|迭代步数|Steps|生成参数复制参数|$)/);
                    if (m) prompt = clean(m[0]);
                }
            }
            if (labN) {
                const fullN = pickLong(labN);
                if (fullN) {
                    const m = fullN.match(/负向提示词[\\s\\S]*?(?=采样方法|Sampler|迭代步数|Steps|提示词引导系数|CFG|生成参数|复制参数|$)/);
                    if (m) negative = clean(m[0]);
                }
            }
            // UI 框架文本过滤（命中导航词≥3 判无效）
            const ui_noise = ['首页','创作','登录','注册','教程','会员','积分','搜索','设置','分享','收藏','点赞','评论','关注','WebUI','ComfyUI','模型库','训练','发布','资产','个人中心'];
            const isUi = (t) => t && ui_noise.filter(w => t.includes(w)).length >= 3;
            if (isUi(prompt)) prompt = '';
            if (isUi(negative)) negative = '';
            return [prompt, negative];
        }""")
    except Exception:
        return "", ""


def _extract_media_from_dom(page):
    """DOM 媒体元素收集：img[src/srcset]、video[src]。
    v5.42.11：优先收集显示面积 ≥8000px² 的主图（过滤图标/小封面）；
    若无大图（懒加载未渲染）则降级收集全部 http 图，防 0 项失败。"""
    try:
        urls = page.evaluate("""() => {
            const MIN_AREA = 8000;  // ~90x90
            const big = [], small = [];
            const push = (arr, u) => { if (u && u.startsWith('http') && arr.indexOf(u) < 0) arr.push(u); };
            const collect = (im, arr) => {
                push(arr, im.currentSrc || im.src);
                const srcset = (im.getAttribute('srcset') || '');
                srcset.split(',').forEach(s => { const p = s.trim().split(/\\s+/)[0]; if (p) push(arr, p); });
            };
            document.querySelectorAll('img').forEach(im => {
                const r = im.getBoundingClientRect();
                collect(im, (r.width * r.height >= MIN_AREA) ? big : small);
            });
            document.querySelectorAll('video').forEach(v => {
                const r = v.getBoundingClientRect();
                const arr = (r.width * r.height >= MIN_AREA) ? big : small;
                push(arr, v.currentSrc || v.src);
                v.querySelectorAll('source').forEach(s => push(arr, s.src));
            });
            document.querySelectorAll('source[type^="video"]').forEach(s => push(small, s.src));
            // 大图优先；无大图（懒加载未渲染）降级全部
            return big.length ? big : small;
        }""")
        # 过滤：跳过 base64、静态资源；保留 max 20
        filtered = []
        for u in urls:
            if not _looks_media_url(u):
                continue
            if u not in filtered:
                filtered.append(u)
        return filtered[:MAX_ITEMS_PER_TASK]
    except Exception:
        return []


def _clean_model(m: str) -> str:
    """清理模型名：截断站点标题后缀（AI绘图/哩布在线/LiblibAI 等，取最早出现位置截断）"""
    m = (m or "").strip()
    best = -1
    for tail in ("-AI绘图", "-AI绘画", "-LiblibAI", "-Liblib", "-哩布", "哩布在线", "在线可运行",
                 "AI绘图", "AI绘画", "模型库", "在线生成", "基础模型", "-水月"):
        idx = m.lower().find(tail.lower())
        if idx > 0 and (best < 0 or idx < best):
            best = idx
    if best > 0:
        m = m[:best].strip()
    return m[:120]


def _extract_model_params_from_text(page, page_title=""):
    """页面文本中提取模型名与参数（正则启发式）：innerText + title + og meta（title 双保险，evaluate 失败也有兜底）"""
    text = ""
    try:
        text = page.evaluate("""() => {
            const parts = [document.body ? document.body.textContent : '', document.title || ''];
            const og = document.querySelector('meta[property="og:title"]');
            if (og && og.content) parts.push(og.content);
            const kw = document.querySelector('meta[name="keywords"]');
            if (kw && kw.content) parts.push(kw.content);
            return parts.join('\n').slice(0, 80000);
        }""")
    except Exception:
        pass
    text = (text or "") + "\n" + (page_title or "")
    models = set(MODEL_PATTERN.findall(text))
    # v5.42.14: 排除站点名（LiblibAI/哩布/即梦 等平台名非模型名）
    site_names = ("liblib", "哩布", "jimeng", "即梦", "midjourney官网")
    # 前缀匹配：仅删除「以站点名开头」的模型串（LiblibAI/jimeng官网），
    # 不误杀 "F.1基础算法模型-...-LiblibAI" 这类模型名+站点后缀的整串（_clean_model 会截断后缀）
    models = {m for m in models if not any(m.lower().startswith(s) for s in site_names)}
    model = ""
    for m in ("seedance", "midjourney", "stable diffusion", "flux", "f.1", "f1", "qwen", "通义", "kling", "可灵", "即梦",
              "dall-e", "hailuo", "海螺", "wan", "混元", "veo", "sora", "sd", "sdxl", "illustrious", "noobai", "pony"):
        for mm in list(models):
            if mm and mm.lower().startswith(m):
                model = _clean_model(mm)
                break
        if model:
            break
    params = []
    for p in PARAM_PATTERN.findall(text):
        if p not in params and len(params) < 6:
            params.append(p.strip())
    return model, params


def _suggest_group(url: str, media_type: str, prompt: str) -> str:
    """自主识别分组：优先平台域名 → 内容类型兜底"""
    low = (url or "").lower()
    for key, gname in PLATFORM_GROUPS.items():
        if key in low:
            return gname
    if prompt and any(k in prompt.lower() for k in ("人物", "角色", "portrait", "character", "人像")):
        return "人物灵感"
    return "视频灵感" if media_type == "video" else "图片灵感"


def _is_media_url(u: str) -> bool:
    return bool(u) and u.startswith("http")


def _download_media(url: str, dest: str, referer: str = "", budget_sec: int = 60) -> bool:
    """下载媒体（带 UA/Referer，断点：已存在且非空跳过，2 次重试 + 体积/时长双上限）"""
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return True
    tmp = dest + ".tmp"
    deadline = time.time() + budget_sec
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
                "Referer": referer or "https://www.google.com/",
            })
            with urllib.request.urlopen(req, timeout=30) as r, open(tmp, "wb") as f:
                total = 0
                while True:
                    if time.time() > deadline:
                        raise RuntimeError("下载超时")
                    chunk = r.read(65536)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_DOWNLOAD_BYTES:
                        raise RuntimeError("媒体超过 60MB 上限，已跳过")
                    f.write(chunk)
            if os.path.getsize(tmp) > 0:
                os.replace(tmp, dest)
                return True
        except Exception as e:
            print(f"[CardCollect] 下载失败({attempt+1}) {url[:80]}: {e}")
            time.sleep(1)
    try:
        if os.path.exists(tmp):
            os.remove(tmp)
    except Exception:
        pass
    return False


def _ext_url(url: str) -> str:
    """从 URL 推断扩展名（兜底 jpg）"""
    path = url.split("?", 1)[0].split("#", 1)[0].lower()
    m = re.search(r"\.(jpg|jpeg|png|webp|gif|bmp|avif|mp4|webm|mov|m4v)$", path)
    if m:
        return m.group(1)
    return "jpg"


# ==================== 截图 OCR 提示词提取（v5.42.7） ====================

def _ocr_page_prompt(page) -> str:
    """页面截图 + Ollama 视觉模型 OCR 提取提示词。
    优先截取「提示词」标签区域，找不到则全页截图；截图先缩小到 ≤640px 宽（大图会触发 vision encoder 崩溃，实测 1264px 500 / 640px 正常）。
    本地推理，无外部依赖；模型不可用或识别到页面框架文本时静默返回空。"""
    try:
        import base64 as _b64
        import io as _io
        from PIL import Image as _PILImage
        from api.ocr import _get_ollama_cfg, _call_model_sync
    except Exception as e:
        print(f"[CardCollect] OCR 导入失败: {e}")
        return ""
    try:
        # 1. 定位「提示词」标签区域（内容容器优先）
        clip = None
        try:
            clip = page.evaluate("""() => {
                const findLabel = (el) => {
                    if (el.nodeType !== 1) return null;
                    const t = (el.textContent || '').trim();
                    if (/^(提示词|prompt|Prompt|生成提示词|描述词)$/.test(t) && el.children.length === 0) return el;
                    for (const c of el.children) { const r = findLabel(c); if (r) return r; }
                    return null;
                };
                const label = findLabel(document.body);
                if (!label) return null;
                const container = label.closest('[class*="prompt"],[class*="Prompt"],[class*="info"],[class*="detail"],[class*="content"]') || label.parentElement.parentElement || label.parentElement;
                const r = container.getBoundingClientRect();
                if (!r || r.width < 20 || r.height < 20) return null;
                return {x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 10),
                        width: Math.min(r.width + 20, 1400), height: Math.min(r.height + 20, 900)};
            }""")
        except Exception:
            clip = None
        shot = page.screenshot(clip=clip) if clip else page.screenshot()
        if not shot:
            return ""
        # 2. 缩小截图（≤640px 宽），防 vision encoder 崩溃 + 提速
        img = _PILImage.open(_io.BytesIO(shot))
        if img.mode != "RGB":
            img = img.convert("RGB")
        if img.width > 640:
            ratio = 640 / img.width
            img = img.resize((640, max(1, int(img.height * ratio))), _PILImage.LANCZOS)
        buf = _io.BytesIO()
        img.save(buf, "PNG")
        img_b64 = _b64.b64encode(buf.getvalue()).decode("utf-8")
        cfg = _get_ollama_cfg()
        server_url = cfg.get("server_url", "http://127.0.0.1:11434").rstrip("/")
        model = cfg.get("vision_model") or "qwen2.5vl:3b"
        sys_prompt = (
            "这是AI绘画/生成平台的作品详情页截图。请提取其中【提示词/Prompt】区域的完整内容。"
            "注意：图片上的水印、作者署名、标语、活动标签（如#话题）、按钮文字、导航文字都不是提示词，不要提取。"
            "如果页面显示『登录后查看』『需登录』或没有提示词区域，返回空字符串。"
            "只返回提示词文本本身，不要输出任何解释或其他文字。")
        result = _call_model_sync(server_url, model, img_b64, sys_prompt, timeout_s=120)
        content = (result.get("content") or "").strip()
        # 水印/短标语过滤：真实提示词一般较长；短文本多为水印/标签
        if len(content) < 15:
            return ""
        # 3. 登录墙/页面框架文本过滤（导航/标签词命中 ≥3 判为 UI 文本）
        if any(k in content for k in ("登录后查看", "登录查看", "请登录", "需登录", "登录/注册")) and len(content) < 40:
            return ""
        ui_noise = ("首页", "创作", "登录", "注册", "教程", "会员", "积分", "搜索", "设置",
                    "分享", "收藏", "点赞", "评论", "关注", "WebUI", "ComfyUI", "模型库", "训练",
                    "发布", "资产", "个人中心", "限时", "特惠", "活动")
        if sum(1 for w in ui_noise if w in content) >= 3:
            print(f"[CardCollect] OCR 结果命中页面框架文本，不采信: {content[:60]}")
            return ""
        print(f"[CardCollect] OCR 提取提示词 {len(content)} 字 (model={model})")
        return content[:2000]
    except Exception as e:
        print(f"[CardCollect] OCR 提取失败: {e}")
        return ""


# ==================== 采集主流程（后台线程） ====================

def _task_update(tid: int, **kw):
    c = _db()
    try:
        sets = ", ".join(f"{k}=?" for k in kw)
        c.execute(f"UPDATE card_collect_tasks SET {sets} WHERE id=?", list(kw.values()) + [tid])
        c.commit()
    except Exception:
        pass
    finally:
        c.close()


def _collect_worker(tid: int):
    """采集任务执行体：CDP 打开页面 → 捕获响应 + DOM 识别 → 下载媒体 → 写入采集结果"""
    _stop_flags[tid] = False
    _task_update(tid, status="running", progress=5, message="连接浏览器…", started_at=_now_str())
    try:
        res = ensure_chrome_started()
        if not res.get("connected"):
            _task_update(tid, status="fail", progress=100, message=res.get("error", "Chrome 未连接"), finished_at=_now_str())
            return
        try:
            from playwright.sync_api import sync_playwright
        except Exception:
            _task_update(tid, status="fail", progress=100, message="未安装 playwright，请先 pip install playwright", finished_at=_now_str())
            return

        # 读取任务信息
        c = _db()
        task = c.execute("SELECT * FROM card_collect_tasks WHERE id=?", [tid]).fetchone()
        c.close()
        if not task:
            return
        url = task["url"]
        fav_id = task["fav_id"] or 0
        _task_update(tid, progress=15, message="打开页面…")

        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(res["cdp_url"])
            try:
                ctx = browser.contexts[0] if browser.contexts else browser.new_context()
                page = ctx.new_page()
                captured_json = []

                def _on_response(resp):
                    try:
                        ct = resp.headers.get("content-type") or ""
                        if "json" not in ct.lower() and "text" not in ct.lower():
                            return
                        u = resp.url.lower()
                        if u.endswith((".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".woff", ".woff2")):
                            return
                        body = resp.body()
                        if len(body) > 2 * 1024 * 1024:
                            return
                        data = json.loads(body.decode("utf-8", "ignore"))
                        captured_json.append({"url": resp.url, "data": data})
                    except Exception:
                        pass

                page.on("response", _on_response)
                page.goto(url, timeout=45000, wait_until="domcontentloaded")
                time.sleep(4.0)
                # SPA 渲染补偿：参数/提示词区未渲染完时再等一轮
                try:
                    body_txt = page.evaluate("() => (document.body.innerText || '').length")
                    if body_txt < 200:
                        time.sleep(3.0)
                except Exception:
                    pass

                if _stop_flags.get(tid):
                    page.close()
                    _task_update(tid, status="fail", progress=100, message="已手动停止", finished_at=_now_str())
                    return

                page_title = ""
                try:
                    page_title = (page.title() or "")[:200]
                except Exception:
                    pass
                _task_update(tid, progress=40, message="自主识别页面内容…")

                # ---- 识别汇总 ----
                dom_media = _extract_media_from_dom(page)
                dom_prompt, dom_negative = _extract_prompt_from_dom(page)
                dom_model, dom_params = _extract_model_params_from_text(page, page_title)

                json_prompt = ""
                json_model = ""
                json_media = []
                # v5.46.24: SSR 内嵌作品数据优先（同源提取 prompt/model/media，防跨响应串味）
                ssr_work = _extract_ssr_work(page, url)
                if ssr_work:
                    json_prompt = _extract_prompt_from_json(ssr_work)
                    json_model = _extract_model_from_json(ssr_work)
                    json_media = _extract_media_from_json(ssr_work)
                # 兜底：网络 JSON 响应（排除静态文案包/配置类，防 bee 文案串味）
                for cap in captured_json:
                    low_url = cap["url"].lower()
                    if any(x in low_url for x in ("beecdn", "/bee_prod/", "ies-fe-bee", "lf3-beecdn", "lf-beecdn")):
                        continue
                    if not json_prompt:
                        json_prompt = _extract_prompt_from_json(cap["data"])
                    if not json_model:
                        json_model = _extract_model_from_json(cap["data"])
                    if not json_media:
                        json_media = _extract_media_from_json(cap["data"])

                prompt = (json_prompt or dom_prompt or "").strip()
                # v5.42.7: DOM/JSON 均未提取到提示词时，截图 OCR 兜底（本地 Ollama 视觉模型）
                if not prompt:
                    _task_update(tid, progress=45, message="尝试截图 OCR 识别提示词…")
                    ocr_prompt = _ocr_page_prompt(page)
                    if ocr_prompt:
                        prompt = ocr_prompt
                model = (json_model or dom_model or "").strip()
                params = "；".join(dict.fromkeys(dom_params))[:500]
                # v5.42.8: 负向提示词并入参数（LibLib 等平台 DOM 可见）
                if dom_negative and "负向提示词" not in params:
                    params = ("负向提示词：" + dom_negative[:400] + ("；" + params if params else "")).strip("；")[:800]

                # 媒体清单：JSON 直链优先（更可能是原图/取流），DOM 兜底；去重
                media_urls = []
                for u in json_media + dom_media:
                    if u not in media_urls:
                        media_urls.append(u)
                media_urls = media_urls[:MAX_ITEMS_PER_TASK]
                # v5.42.13/15: LibLib web 预览版过滤——已采到任何非 web 作品图
                # （/img/ 原图或 /community-img/ 社区图）时跳过 /web/ 预览版
                if any(("/img/" in u or "/community-img/" in u) for u in media_urls):
                    media_urls = [u for u in media_urls if "/web/" not in u]

                page.close()

                # ---- 下载 + 入库 ----
                if not media_urls:
                    _task_update(tid, status="fail", progress=100,
                                 message="未识别到媒体内容（页面可能需登录或结构特殊），请更换 URL", finished_at=_now_str())
                    return

                _task_update(tid, progress=60, message=f"下载媒体（{len(media_urls)} 项）…")
                c = _db()
                try:
                    inserted = 0
                    dl_deadline = time.time() + 240   # 单任务总下载预算 4 分钟（防卡死）
                    for i, mu in enumerate(media_urls):
                        if _stop_flags.get(tid) or time.time() > dl_deadline:
                            break
                        is_video = any(x in mu.lower() for x in (".mp4", ".webm", ".mov", ".m4v", "video"))
                        sub = VID_DIR if is_video else IMG_DIR
                        fname = f"cc_{tid}_{int(time.time())}_{i}.{_ext_url(mu)}"
                        dest = os.path.join(sub, fname)
                        ok = _download_media(mu, dest, referer=url, budget_sec=min(60, max(10, int(dl_deadline - time.time()))))
                        if not ok:
                            continue
                        # 小文件过滤：<2KB 视为占位/徽章图，跳过并清理
                        if not is_video:
                            fsize = os.path.getsize(dest)
                            if fsize < 2048:
                                try:
                                    os.remove(dest)
                                except Exception:
                                    pass
                                print(f"[CardCollect] 跳过小占位图 {mu[:80]} ({fsize}B)")
                                continue
                        # v5.46.25: 一个网页 = 一条采集结果 —— 同任务已有采集项则跳过冗余媒体
                        # （同一作品多尺寸图/封面/原图只保留第一条，prompt/model 页面级一致，多余词条无价值）
                        exist = c.execute("SELECT id FROM card_collect_items WHERE task_id=? LIMIT 1", [tid]).fetchone()
                        if exist:
                            try:
                                os.remove(dest)
                            except Exception:
                                pass
                            print(f"[CardCollect] 任务 {tid} 已入库(#{exist['id']})，跳过冗余媒体 {mu[:70]}")
                            continue
                        c.execute(
                            "INSERT INTO card_collect_items "
                            "(task_id, fav_id, source_url, page_title, media_type, media_url, media_original_url, "
                            "prompt, model, params, raw_data, suggest_group, status, created_at) "
                            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'pending', datetime('now','localtime'))",
                            [tid, fav_id, url, page_title, "video" if is_video else "image",
                             fname, mu, prompt, model, params,
                             json.dumps({"captured_json_count": len(captured_json), "dom_media_count": len(dom_media)},
                                        ensure_ascii=False),
                             _suggest_group(url, "video" if is_video else "image", prompt)])
                        inserted += 1
                    c.commit()
                finally:
                    c.close()

                # 更新收藏状态
                if fav_id:
                    fc = _db()
                    try:
                        fc.execute("UPDATE card_collect_favorites SET status='collected', collected_at=datetime('now','localtime') WHERE id=?", [fav_id])
                        fc.commit()
                    finally:
                        fc.close()

                _task_update(tid, status="success", progress=100, found_count=inserted,
                             message=f"采集完成，入库 {inserted} 项", page_title=page_title, finished_at=_now_str())
                print(f"[CardCollect] 任务 {tid} 完成：{url} → {inserted} 项")
                # v5.42.10: 采集完成后用 Chrome 原生方式在同 profile 打开新标签保留页面
                # （playwright 页面在连接退出时会关闭，原生标签不受影响，避免用户看到"跳转空白页"）
                try:
                    subprocess.Popen(
                        [CHROME_BIN, f"--user-data-dir={PROFILE_DIR}", url,
                         "--window-size=1280,900", "--window-position=-32000,-32000"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                except Exception as e:
                    print(f"[CardCollect] 保留页面失败: {e}")
            finally:
                # v5.42.10: 不关闭浏览器与页面（with sync_playwright 退出自动断开 CDP，
                # 保留 Chrome 实例与用户可见页面）
                pass
    except Exception as e:
        print(f"[CardCollect] 任务 {tid} 异常: {e}")
        _task_update(tid, status="fail", progress=100, message=f"采集失败: {str(e)[:200]}", finished_at=_now_str())
    finally:
        _stop_flags.pop(tid, None)
        # v5.43.0: 批量入队串行续跑——本任务终态后自动启动下一个 queued
        _spawn_next_queued()


def _spawn_next_queued():
    """合规续跑：仅启动队首 queued（服务重启遗留已由 _mark_interrupted_on_boot 标记 fail，不会续跑）"""
    c = _db()
    try:
        nxt = c.execute("SELECT id FROM card_collect_tasks WHERE status='queued' ORDER BY id ASC LIMIT 1").fetchone()
    finally:
        c.close()
    if nxt:
        try:
            _spawn_worker(nxt["id"])
        except Exception:
            pass


def _spawn_worker(tid: int):
    t = threading.Thread(target=_collect_worker, args=(tid,), daemon=True)
    t.start()
    return t


# ==================== API：收藏（采集前置） ====================

@router.get("/favorites")
def list_favorites(q: str = Query("", description="搜索过滤"), status: str = Query("", description="状态过滤")):
    _ensure_tables()
    c = _db()
    try:
        sql = "SELECT * FROM card_collect_favorites WHERE 1=1"
        args = []
        if q:
            sql += " AND (url LIKE ? OR note LIKE ? OR title LIKE ?)"
            args += [f"%{q}%"] * 3
        if status:
            sql += " AND status=?"
            args.append(status)
        sql += " ORDER BY id DESC"
        rows = c.execute(sql, args).fetchall()
        return {"ok": True, "items": [dict(r) for r in rows]}
    finally:
        c.close()


@router.post("/favorites")
def add_favorite(payload: dict = Body(...)):
    url = str(payload.get("url") or "").strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        raise HTTPException(400, "请输入合法的 http/https 地址")
    note = str(payload.get("note") or "").strip()[:500]
    title = str(payload.get("title") or "").strip()[:200]
    c = _db()
    try:
        # 同 URL 去重：已存在则更新备注返回原记录
        exist = c.execute("SELECT id FROM card_collect_favorites WHERE url=?", [url]).fetchone()
        if exist:
            c.execute("UPDATE card_collect_favorites SET note=?, title=? WHERE id=?", [note, title, exist["id"]])
            c.commit()
            row = c.execute("SELECT * FROM card_collect_favorites WHERE id=?", [exist["id"]]).fetchone()
            return {"ok": True, "item": dict(row), "duplicated": True}
        cur = c.execute(
            "INSERT INTO card_collect_favorites (url, title, note, status, created_at) VALUES (?,?,?, 'pending', datetime('now','localtime'))",
            [url, title, note])
        c.commit()
        row = c.execute("SELECT * FROM card_collect_favorites WHERE id=?", [cur.lastrowid]).fetchone()
        return {"ok": True, "item": dict(row)}
    finally:
        c.close()


@router.delete("/favorites/{fid}")
def delete_favorite(fid: int):
    c = _db()
    try:
        c.execute("DELETE FROM card_collect_favorites WHERE id=?", [fid])
        c.commit()
        return {"ok": True}
    finally:
        c.close()


@router.post("/favorites/{fid}/collect")
def collect_from_favorite(fid: int):
    """从收藏发起采集（收藏状态自动流转 pending→collected）"""
    c = _db()
    row = c.execute("SELECT * FROM card_collect_favorites WHERE id=?", [fid]).fetchone()
    c.close()
    if not row:
        raise HTTPException(404, "收藏不存在")
    return _start_collect(row["url"], fav_id=fid)


# ==================== API：网页收藏库（v5.43.0 统一入口/批量操作） ====================

_VALID_FAV_STATUS = {"pending", "ready", "hold", "discard"}


# ==================== v5.43.1: URL 元数据轻量抓取（fetch-meta） ====================

_fetch_lock = threading.Lock()
FETCH_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")


def _http_get(url: str, timeout: int = 15, max_bytes: int = 2 * 1024 * 1024):
    """轻量 GET：返回 (status, headers, body_bytes)；超时/异常返回 (0, {}, b'')，绝不抛"""
    req = urllib.request.Request(url, headers={"User-Agent": FETCH_UA,
                                               "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read(max_bytes + 1)
    except urllib.error.HTTPError as e:
        try:
            return e.code, dict(e.headers), e.read(max_bytes + 1)
        except Exception:
            return e.code, {}, b""
    except Exception:
        return 0, {}, b""


def _parse_meta(html: str, base_url: str):
    """HTML → (title, desc, 正文核心文本, og_image)；标准库解析，不依赖 bs4"""
    from html.parser import HTMLParser
    title, desc, og_image = "", "", ""
    og_title = ""

    class _P(HTMLParser):
        def __init__(self):
            super().__init__()
            self.in_title = False
            self.title_buf = []
            self.skip = 0
            self.text_parts = []
            self.meta_desc = ""
            self.meta_og_title = ""
            self.meta_og_image = ""

        def handle_starttag(self, tag, attrs):
            a = dict(attrs)
            if tag == "title":
                self.in_title = True
                self.title_buf = []
            if tag in ("script", "style", "noscript", "svg", "head"):
                self.skip += 1
            if tag == "meta":
                k = (a.get("property") or a.get("name") or "").lower()
                v = a.get("content") or ""
                if k in ("description", "og:description", "twitter:description") and not self.meta_desc:
                    self.meta_desc = v
                elif k in ("og:title", "twitter:title") and not self.meta_og_title:
                    self.meta_og_title = v
                elif k in ("og:image", "og:image:url", "twitter:image") and not self.meta_og_image:
                    self.meta_og_image = v

        def handle_endtag(self, tag):
            if tag == "title":
                self.in_title = False
            if tag in ("script", "style", "noscript", "svg", "head"):
                self.skip = max(0, self.skip - 1)

        def handle_data(self, data):
            if self.in_title:
                self.title_buf.append(data)
            elif self.skip == 0:
                t = data.strip()
                if t:
                    self.text_parts.append(t)

    p = _P()
    try:
        p.feed(html[:2_000_000])
    except Exception:
        pass
    title = "".join(p.title_buf).strip()[:200] or (p.meta_og_title or "")[:200]
    desc = (p.meta_desc or "")[:300]
    og_image = p.meta_og_image or ""
    text = re.sub(r"\s+", " ", " ".join(p.text_parts)).strip()[:1200]
    if og_image and og_image.startswith("/"):
        from urllib.parse import urlparse
        pr = urlparse(base_url)
        og_image = f"{pr.scheme}://{pr.netloc}{og_image}"
    return title, desc, text, og_image


def _fetch_thumb(fid: int, img_url: str) -> str:
    """首图缩略图下载（单图 ≤300KB、10s 超时，防卡死）"""
    try:
        req = urllib.request.Request(img_url, headers={"User-Agent": FETCH_UA})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = r.read(300 * 1024 + 1)
        if len(data) > 300 * 1024:
            return ""
        ext = os.path.splitext(img_url.split("?")[0])[1].lower()
        if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
            ext = ".jpg"
        os.makedirs(THUMB_DIR, exist_ok=True)
        fname = f"ccf_{fid}{ext}"
        with open(os.path.join(THUMB_DIR, fname), "wb") as f:
            f.write(data)
        return fname
    except Exception:
        return ""


def _fetch_meta_one(fid: int):
    c = _db()
    try:
        row = c.execute("SELECT * FROM card_collect_favorites WHERE id=?", [fid]).fetchone()
    finally:
        c.close()
    if not row:
        return
    url = row["url"]
    c = _db()
    try:
        c.execute("UPDATE card_collect_favorites SET fetch_status='running', updated_at=datetime('now','localtime') WHERE id=?", [fid])
        c.commit()
    finally:
        c.close()
    try:
        st, _h, body = _http_get(url, timeout=15)
        if st <= 0:
            raise RuntimeError("网络不可达/超时")
        if st >= 400:
            raise RuntimeError(f"HTTP {st}")
        html = body.decode("utf-8", "ignore")
        title, desc, text, og_image = _parse_meta(html, url)
        thumb = _fetch_thumb(fid, og_image) if og_image.startswith("http") else ""
        dom = _domain_of(url)
        c = _db()
        try:
            c.execute(
                "UPDATE card_collect_favorites SET fetch_status='success', fetch_title=?, fetch_desc=?, "
                "fetch_text=?, thumb=?, domain=?, site_name=?, updated_at=datetime('now','localtime') WHERE id=?",
                [title, desc, text, thumb, dom, _site_name_of(dom), fid])
            c.commit()
        finally:
            c.close()
        print(f"[CardCollect] fetch-meta {fid} OK: {title[:40]}")
    except Exception as e:
        c = _db()
        try:
            c.execute("UPDATE card_collect_favorites SET fetch_status='fail', updated_at=datetime('now','localtime') WHERE id=?", [fid])
            c.commit()
        finally:
            c.close()
        print(f"[CardCollect] fetch-meta {fid} FAIL: {str(e)[:80]}")


def _fetch_meta_many(fids):
    """串行抓取（全局锁，避免并发打爆目标站）"""
    for fid in fids:
        with _fetch_lock:
            _fetch_meta_one(fid)


# ==================== v5.43.1: URL 清洗 ====================

_TRACK_PARAMS = {"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
                 "spm", "from", "source", "ref", "refer", "referer", "share_token",
                 "xcode", "clicktime", "clickid", "scene", "ivk_sa", "vd_source", "app"}


def _clean_url_params(url: str) -> str:
    """清理追踪参数（保留必要 query）"""
    try:
        from urllib.parse import parse_qsl, urlencode, urlparse
        p = urlparse(url)
        if not p.query:
            return url
        keep = [(k, v) for k, v in parse_qsl(p.query) if k.lower() not in _TRACK_PARAMS]
        if not keep:
            return p._replace(query="").geturl()
        return p._replace(query=urlencode(keep)).geturl()
    except Exception:
        return url


def _url_fingerprint(url: str) -> str:
    """域名+路径指纹（忽略 query，用于去重）"""
    try:
        from urllib.parse import urlparse
        p = urlparse(url)
        return (p.netloc.lower() + p.path).rstrip("/") or p.netloc.lower()
    except Exception:
        return url


def _unshorten(url: str, timeout: int = 10) -> str:
    """短链还原：跟随 redirect 最多 3 跳；HEAD 不支持回退 GET"""
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": FETCH_UA})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.geturl()
        except Exception:
            req2 = urllib.request.Request(url, method="GET", headers={"User-Agent": FETCH_UA})
            with urllib.request.urlopen(req2, timeout=timeout) as r2:
                return r2.geturl()
    except Exception:
        return url


def _probe_alive(url: str, timeout: int = 8) -> bool:
    """存活探测：HEAD/GET 最终状态 <400 判定存活"""
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": FETCH_UA})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return True
        except urllib.error.HTTPError as e:
            return e.code < 400
        except Exception:
            pass
        req2 = urllib.request.Request(url, method="GET", headers={"User-Agent": FETCH_UA, "Range": "bytes=0-0"})
        with urllib.request.urlopen(req2, timeout=timeout) as r2:
            return True
    except urllib.error.HTTPError as e:
        return e.code < 400
    except Exception:
        return False


@router.post("/urls/clean")
def clean_urls(payload: dict = Body(...)):
    """批量 URL 清洗：清追踪参数 → 短链还原 → 存活探测 → 页面指纹去重
    清洗结果写 clean_url（原始 url 不动）；dead/duplicate 仅标记不自动处理（用户自行决策）
    """
    ids = _ids_of(payload)
    if not ids:
        raise HTTPException(400, "请选择条目")
    if len(ids) > 50:
        raise HTTPException(400, "单次最多 50 条")
    c = _db()
    try:
        ph = ",".join("?" * len(ids))
        rows = c.execute(f"SELECT * FROM card_collect_favorites WHERE id IN ({ph})", ids).fetchall()
    finally:
        c.close()
    if not rows:
        raise HTTPException(404, "条目不存在")
    results = []
    fingerprints = {}
    deadline = time.time() + 240  # 总预算 4 分钟（防卡死）
    for r in rows:
        if time.time() > deadline:
            break
        url = r["url"]
        cleaned = _clean_url_params(url)
        cleaned = _unshorten(cleaned, timeout=10)
        alive = _probe_alive(cleaned, timeout=8)
        fp = _url_fingerprint(cleaned)
        dup_of = None
        if fp in fingerprints:
            dup_of = fingerprints[fp]
        else:
            fingerprints[fp] = r["id"]
        c = _db()
        try:
            c.execute(
                "UPDATE card_collect_favorites SET clean_url=?, fetch_status=?, updated_at=datetime('now','localtime') WHERE id=?",
                [cleaned if cleaned != url else "", "fail" if not alive else r["fetch_status"], r["id"]])
            c.commit()
        finally:
            c.close()
        results.append({
            "id": r["id"], "url": url,
            "clean_url": cleaned if cleaned != url else "",
            "changed": cleaned != url,
            "dead": not alive,
            "duplicate": dup_of is not None,
            "duplicate_of": dup_of,
        })
    return {"ok": True, "processed": len(results), "results": results}


@router.post("/urls/batch/preview")
def preview_urls(payload: dict = Body(...)):
    """多标签回传预展示（不落库）：校验合法性 + 提取域名/站点名 + 标记已在库
    配合浏览器扩展「批量抓取全部标签」：先预览勾选，用户确认后再走 /urls 入库（合规人工确认制）
    """
    raw = payload.get("urls") or []
    if isinstance(raw, str):
        raw = [u.strip() for u in raw.splitlines() if u.strip()]
    urls = [str(u).strip() for u in raw if str(u).strip()]
    if not urls:
        raise HTTPException(400, "无有效标签地址")
    if len(urls) > 100:
        raise HTTPException(400, "单次最多 100 条")
    c = _db()
    try:
        existing = {r["url"] for r in c.execute(
            "SELECT url FROM card_collect_favorites WHERE status != 'discard'").fetchall()}
    finally:
        c.close()
    results = []
    for u in urls:
        valid = u.startswith("http://") or u.startswith("https://")
        dom = _domain_of(u) if valid else ""
        results.append({
            "url": u, "valid": valid,
            "domain": dom, "site_name": _site_name_of(dom) if valid else "",
            "in_lib": u in existing,
        })
    return {"ok": True, "count": len(results), "items": results}


@router.post("/urls/{fid}/refetch")
def refetch_meta(fid: int):
    """手动重抓元数据（抓取失败后可重试）"""
    c = _db()
    try:
        row = c.execute("SELECT id FROM card_collect_favorites WHERE id=?", [fid]).fetchone()
    finally:
        c.close()
    if not row:
        raise HTTPException(404, "收藏不存在")
    threading.Thread(target=_fetch_meta_many, args=([fid],), daemon=True).start()
    return {"ok": True}


@router.get("/urls/thumb/{fname}")
def serve_thumb(fname: str):
    """fetch-meta 首图缩略图访问（防路径穿越）"""
    if not re.match(r"^[\w.\-]+$", fname):
        raise HTTPException(400, "非法文件名")
    p = os.path.join(THUMB_DIR, fname)
    if os.path.exists(p):
        from fastapi.responses import FileResponse
        return FileResponse(p)
    raise HTTPException(404, "缩略图不存在")


def _ids_of(payload: dict) -> list:
    ids = [int(x) for x in (payload.get("ids") or [])]
    return ids


@router.post("/urls")
def add_urls(payload: dict = Body(...)):
    """统一入库入口（手动粘贴/扩展回传共用）：
    - 支持 {url} 单条 / {urls:[...]} 数组 / {url:"多行\n粘贴"}
    - 原始 URL 原样保留，不做去重（PRD 6.3：去重后置到收藏库清洗环节）
    - 本地提取 domain/site_name 供列表展示；fetch_status=pending 待 v5.43.1 异步抓取
    """
    raw = payload.get("url") if payload.get("url") is not None else payload.get("urls")
    urls = []
    if isinstance(raw, str):
        urls = [u.strip() for u in raw.splitlines() if u.strip()]
    elif isinstance(raw, list):
        urls = [str(u).strip() for u in raw if str(u).strip()]
    if not urls:
        raise HTTPException(400, "请提供 url 或 urls")
    invalid = [u for u in urls if not (u.startswith("http://") or u.startswith("https://"))]
    if invalid:
        raise HTTPException(400, f"含非法地址（仅 http/https）：{invalid[0][:80]}")
    if len(urls) > 50:
        raise HTTPException(400, "单次最多 50 条")
    c = _db()
    try:
        items = []
        new_ids = []
        for u in urls:
            dom = _domain_of(u)
            cur = c.execute(
                "INSERT INTO card_collect_favorites (url, title, note, status, fetch_status, domain, site_name, created_at) "
                "VALUES (?,?,?, 'pending', 'pending', ?, ?, datetime('now','localtime'))",
                [u, "", "", dom, _site_name_of(dom)])
            new_ids.append(cur.lastrowid)
            items.append(dict(c.execute("SELECT * FROM card_collect_favorites WHERE id=?", [cur.lastrowid]).fetchone()))
        c.commit()
    finally:
        c.close()
    # v5.43.1: 入库后自动异步抓取页面元数据（串行、预算内）
    if new_ids:
        threading.Thread(target=_fetch_meta_many, args=(new_ids,), daemon=True).start()
    return {"ok": True, "count": len(items), "items": items}


@router.post("/urls/status")
def set_urls_status(payload: dict = Body(...)):
    """批量状态变更（四池：pending 待处理 / ready 待采集 / hold 备用 / discard 废弃）"""
    ids = _ids_of(payload)
    status = str(payload.get("status") or "").strip()
    if not ids:
        raise HTTPException(400, "请选择条目")
    if status not in _VALID_FAV_STATUS:
        raise HTTPException(400, "状态须为 pending/ready/hold/discard")
    c = _db()
    try:
        ph = ",".join("?" * len(ids))
        cur = c.execute(
            f"UPDATE card_collect_favorites SET status=?, updated_at=datetime('now','localtime') "
            f"WHERE id IN ({ph})", [status] + ids)
        c.commit()
        return {"ok": True, "updated": cur.rowcount}
    finally:
        c.close()


@router.post("/urls/delete")
def delete_urls(payload: dict = Body(...)):
    """批量物理删除（废弃池为软删 status=discard，本接口用于用户显式清理）"""
    ids = _ids_of(payload)
    if not ids:
        raise HTTPException(400, "请选择条目")
    c = _db()
    try:
        ph = ",".join("?" * len(ids))
        cur = c.execute(f"DELETE FROM card_collect_favorites WHERE id IN ({ph})", ids)
        c.commit()
        return {"ok": True, "deleted": cur.rowcount}
    finally:
        c.close()


@router.post("/urls/clear")
def clear_urls(payload: dict = Body(...)):
    """清空网页收藏（默认全部池；pool 参数可只清空指定池）"""
    pool = str(payload.get("pool") or "").strip()
    c = _db()
    try:
        if pool:
            if pool not in _VALID_FAV_STATUS:
                raise HTTPException(400, "无效的状态池")
            cur = c.execute("DELETE FROM card_collect_favorites WHERE status=?", [pool])
        else:
            cur = c.execute("DELETE FROM card_collect_favorites")
        c.commit()
        return {"ok": True, "deleted": cur.rowcount}
    finally:
        c.close()


@router.post("/urls/collect")
def collect_urls(payload: dict = Body(...)):
    """勾选待采集 → 批量入队采集任务（串行执行，单批 ≤20 合规限额）
    批量入队后仅启动队首任务，worker 终态自动续跑下一个（_spawn_next_queued）
    """
    ids = _ids_of(payload)
    if not ids:
        raise HTTPException(400, "请选择条目")
    if len(ids) > 20:
        raise HTTPException(400, "单批最多 20 条（合规限额）")
    c = _db()
    try:
        ph = ",".join("?" * len(ids))
        rows = c.execute(f"SELECT * FROM card_collect_favorites WHERE id IN ({ph})", ids).fetchall()
        running = c.execute("SELECT id FROM card_collect_tasks WHERE status IN ('queued','running') LIMIT 1").fetchone()
    finally:
        c.close()
    if not rows:
        raise HTTPException(404, "条目不存在")
    if running:
        raise HTTPException(409, f"已有采集任务进行中（#{running['id']}），请等待完成或先停止")
    with _task_lock:
        tids = [_insert_task(r["url"], fav_id=r["id"]) for r in rows]
    if tids:
        _spawn_worker(tids[0])
    return {"ok": True, "count": len(tids), "task_ids": tids}


# ==================== API：采集任务 ====================

def _domain_of(url: str) -> str:
    """本地提取域名（纯解析，零网络开销）"""
    try:
        from urllib.parse import urlparse
        return (urlparse(url).netloc or "").lower()
    except Exception:
        return ""


def _site_name_of(domain: str) -> str:
    """按域名匹配存量灵感图库站点名，未匹配则回退域名本身"""
    if not domain:
        return ""
    c = _db()
    try:
        row = c.execute(
            "SELECT name FROM card_collect_sites WHERE url LIKE ? ORDER BY sort_order LIMIT 1",
            [f"%{domain}%"]).fetchone()
        return row["name"] if row else domain
    except Exception:
        return domain
    finally:
        c.close()


def _insert_task(url: str, fav_id: int = 0) -> int:
    """插入 queued 任务（调用方须持有 _task_lock 或保证无并发冲突）"""
    c = _db()
    try:
        cur = c.execute(
            "INSERT INTO card_collect_tasks (fav_id, url, status, progress, message, created_at) "
            "VALUES (?,?, 'queued', 0, '排队中…', datetime('now','localtime'))",
            [fav_id, url])
        c.commit()
        return cur.lastrowid
    finally:
        c.close()


def _start_collect(url: str, fav_id: int = 0):
    if not url.startswith("http://") and not url.startswith("https://"):
        raise HTTPException(400, "请输入合法的 http/https 地址")
    with _task_lock:
        # 合规：同一时刻仅允许 1 个采集任务
        c = _db()
        try:
            running = c.execute("SELECT id FROM card_collect_tasks WHERE status IN ('queued','running') LIMIT 1").fetchone()
            if running:
                raise HTTPException(409, f"已有采集任务进行中（#{running['id']}），请等待完成或先停止")
        finally:
            c.close()
        tid = _insert_task(url, fav_id=fav_id)
    _spawn_worker(tid)
    return {"ok": True, "task_id": tid}


@router.post("/collect")
def start_collect(payload: dict = Body(...)):
    url = str(payload.get("url") or "").strip()
    return _start_collect(url)


@router.get("/tasks")
def list_tasks(limit: int = Query(30)):
    c = _db()
    try:
        rows = c.execute("SELECT * FROM card_collect_tasks ORDER BY id DESC LIMIT ?", [limit]).fetchall()
        return {"ok": True, "items": [dict(r) for r in rows]}
    finally:
        c.close()


@router.post("/tasks/{tid}/stop")
def stop_task(tid: int):
    """合规：允许用户随时中断采集"""
    _stop_flags[tid] = True
    return {"ok": True, "message": "停止请求已发出"}


@router.post("/stop")
def stop_all():
    """停止全部进行中采集（合规：人工可中断）"""
    c = _db()
    try:
        rows = c.execute("SELECT id FROM card_collect_tasks WHERE status IN ('queued','running')").fetchall()
        for r in rows:
            _stop_flags[r["id"]] = True
            c.execute("UPDATE card_collect_tasks SET status='fail', message='已手动停止', finished_at=datetime('now','localtime') WHERE id=?", [r["id"]])
        c.commit()
        return {"ok": True, "stopped": len(rows)}
    finally:
        c.close()


@router.post("/tasks/delete")
def delete_tasks(payload: dict = Body(...)):
    """批量删除任务记录（进行中/排队中先停止再删除）"""
    ids = _ids_of(payload)
    if not ids:
        raise HTTPException(400, "请选择任务")
    c = _db()
    try:
        ph = ",".join("?" * len(ids))
        rows = c.execute(f"SELECT id, status FROM card_collect_tasks WHERE id IN ({ph})", ids).fetchall()
        for r in rows:
            if r["status"] in ("queued", "running"):
                _stop_flags[r["id"]] = True
        cur = c.execute(f"DELETE FROM card_collect_tasks WHERE id IN ({ph})", ids)
        c.commit()
    finally:
        c.close()
    _spawn_next_queued()  # 删除后恢复队列续跑
    return {"ok": True, "deleted": cur.rowcount}


@router.post("/tasks/clear")
def clear_tasks(payload: dict = Body(default={})):
    """清空全部任务记录（进行中/排队中先停止）"""
    c = _db()
    try:
        rows = c.execute("SELECT id, status FROM card_collect_tasks").fetchall()
        for r in rows:
            if r["status"] in ("queued", "running"):
                _stop_flags[r["id"]] = True
        cur = c.execute("DELETE FROM card_collect_tasks")
        c.commit()
    finally:
        c.close()
    return {"ok": True, "deleted": cur.rowcount}


# ==================== API：采集结果 ====================

@router.get("/items")
def list_items(q: str = Query(""), status: str = Query(""), media_type: str = Query("")):
    c = _db()
    try:
        sql = "SELECT * FROM card_collect_items WHERE 1=1"
        args = []
        if q:
            sql += " AND (prompt LIKE ? OR model LIKE ? OR source_url LIKE ?)"
            args += [f"%{q}%"] * 3
        if status:
            sql += " AND status=?"
            args.append(status)
        if media_type:
            sql += " AND media_type=?"
            args.append(media_type)
        sql += " ORDER BY id DESC"
        rows = c.execute(sql, args).fetchall()
        return {"ok": True, "items": [dict(r) for r in rows]}
    finally:
        c.close()


@router.put("/items/{iid}")
def update_item(iid: int, payload: dict = Body(...)):
    """人工修正识别结果（提示词/模型/参数/分组建议）"""
    c = _db()
    try:
        row = c.execute("SELECT * FROM card_collect_items WHERE id=?", [iid]).fetchone()
        if not row:
            raise HTTPException(404, "采集项不存在")
        if row["status"] == "archived":
            raise HTTPException(400, "已归档项不可编辑")
        upd = {}
        for k in ("prompt", "model", "params", "suggest_group", "media_type"):
            if k in payload:
                upd[k] = str(payload[k] or "").strip()
        if not upd:
            return {"ok": True, "item": dict(row)}
        sets = ", ".join(f"{k}=?" for k in upd)
        c.execute(f"UPDATE card_collect_items SET {sets} WHERE id=?", list(upd.values()) + [iid])
        c.commit()
        row = c.execute("SELECT * FROM card_collect_items WHERE id=?", [iid]).fetchone()
        return {"ok": True, "item": dict(row)}
    finally:
        c.close()


@router.delete("/items/{iid}")
def delete_item(iid: int):
    c = _db()
    try:
        row = c.execute("SELECT * FROM card_collect_items WHERE id=?", [iid]).fetchone()
        if not row:
            raise HTTPException(404, "采集项不存在")
        # 清理本地媒体文件
        if row["media_url"]:
            for d in (IMG_DIR, VID_DIR):
                p = os.path.join(d, row["media_url"])
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except Exception:
                        pass
        c.execute("DELETE FROM card_collect_items WHERE id=?", [iid])
        c.commit()
        return {"ok": True}
    finally:
        c.close()


@router.post("/items/delete")
def delete_items(payload: dict = Body(...)):
    """批量删除采集项（含本地媒体文件）"""
    ids = _ids_of(payload)
    if not ids:
        raise HTTPException(400, "请选择采集项")
    c = _db()
    try:
        ph = ",".join("?" * len(ids))
        rows = c.execute(f"SELECT id, media_url FROM card_collect_items WHERE id IN ({ph})", ids).fetchall()
        for r in rows:
            if r["media_url"]:
                for d in (IMG_DIR, VID_DIR):
                    p = os.path.join(d, r["media_url"])
                    if os.path.exists(p):
                        try:
                            os.remove(p)
                        except Exception:
                            pass
        cur = c.execute(f"DELETE FROM card_collect_items WHERE id IN ({ph})", ids)
        c.commit()
        return {"ok": True, "deleted": cur.rowcount}
    finally:
        c.close()


@router.post("/items/clear")
def clear_items(payload: dict = Body(...)):
    """清空采集项（status: pending 未归档默认 / archived 已归档；含本地媒体文件）"""
    status = str(payload.get("status") or "pending").strip()
    if status not in ("pending", "archived"):
        raise HTTPException(400, "status 须为 pending/archived")
    c = _db()
    try:
        rows = c.execute("SELECT id, media_url FROM card_collect_items WHERE status=?", [status]).fetchall()
        for r in rows:
            if r["media_url"]:
                for d in (IMG_DIR, VID_DIR):
                    p = os.path.join(d, r["media_url"])
                    if os.path.exists(p):
                        try:
                            os.remove(p)
                        except Exception:
                            pass
        cur = c.execute("DELETE FROM card_collect_items WHERE status=?", [status])
        c.commit()
        return {"ok": True, "deleted": cur.rowcount}
    finally:
        c.close()


# ==================== API：分组（归档用） ====================

@router.get("/groups")
def list_groups():
    """词卡分组列表（供归档选择，含采集建议分组）"""
    c = _db()
    try:
        rows = c.execute(
            "SELECT id, name FROM word_card_group WHERE is_active=1 ORDER BY sort_order, id").fetchall()
        groups = [{"id": r["id"], "name": r["name"]} for r in rows]
        # 采集建议分组（不存在则标记可创建）
        suggests = set()
        for it in c.execute("SELECT DISTINCT suggest_group FROM card_collect_items WHERE suggest_group!=''").fetchall():
            if it["suggest_group"]:
                suggests.add(it["suggest_group"])
        return {"ok": True, "groups": groups, "suggest_groups": sorted(suggests)}
    finally:
        c.close()


def _ensure_group(name: str) -> int:
    """按名查找或创建词卡分组，返回 group_id。
    v5.42.9：同名软删除分组（is_active=0）自动重新激活复用，防止重复建组堆积"""
    c = _db()
    try:
        row = c.execute("SELECT id, is_active FROM word_card_group WHERE name=?", [name]).fetchone()
        if row:
            if row["is_active"]:
                return row["id"]
            # 存在软删除同名分组 → 重新激活复用
            c.execute("UPDATE word_card_group SET is_active=1, updated_at=datetime('now','localtime') WHERE id=?", [row["id"]])
            c.commit()
            return row["id"]
        cur = c.execute("INSERT INTO word_card_group (name, group_key, icon, group_type, sort_order, created_at) VALUES (?, ?, '📥', 'custom', 999, datetime('now','localtime'))", [name, "cc_" + str(int(time.time()))])
        c.commit()
        return cur.lastrowid
    finally:
        c.close()


def _gen_card_thumbnail(card_id: int, src_path: str) -> str:
    """生成词卡网格缩略图（240x160 → data/thumbnails/{card_id}.png），返回文件名；失败返回空"""
    try:
        from PIL import Image
        img = Image.open(src_path)
        img = img.convert("RGB")
        tw, th = 240, 160
        w, h = img.size
        if w <= 0 or h <= 0:
            return ""
        # 3:2 中心裁剪
        target_ratio = tw / th
        cur_ratio = w / h
        if cur_ratio > target_ratio:
            nw = int(h * target_ratio)
            x = max(0, (w - nw) // 2)
            img = img.crop((x, 0, x + nw, h))
        elif cur_ratio < target_ratio:
            nh = int(w / target_ratio)
            y = max(0, (h - nh) // 2)
            img = img.crop((0, y, w, y + nh))
        img = img.resize((tw, th), Image.LANCZOS)
        dest = os.path.join(_PROJECT_ROOT, "data", "thumbnails", f"{card_id}.png")
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        img.save(dest, "PNG")
        return f"{card_id}.png"
    except Exception as e:
        print(f"[CardCollect] 缩略图生成失败: {e}")
        return ""


def _gen_video_poster(card_id: int, src_path: str) -> str:
    """生成视频卡网格海报（ffmpeg 提取首帧 → data/thumbnails/{card_id}.jpg），返回文件名；失败返回空"""
    try:
        import subprocess
        dest = os.path.join(_PROJECT_ROOT, "data", "thumbnails", f"{card_id}.jpg")
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        r = subprocess.run(
            ["ffmpeg", "-ss", "0.1", "-i", src_path, "-vframes", "1", "-y", dest],
            capture_output=True, timeout=30)
        if r.returncode == 0 and os.path.exists(dest) and os.path.getsize(dest) > 0:
            return f"{card_id}.jpg"
    except Exception as e:
        print(f"[CardCollect] 视频海报生成失败: {e}")
    return ""


# ==================== API：归档建词卡（带来源溯源） ====================

@router.post("/items/{iid}/refresh-archive")
def refresh_archive_item(iid: int):
    """v5.46.34: 刷新归档——用重新采集的结果替换同源已归档词卡（词卡损坏/内容丢失时修复）
    按 source_url 找到已归档采集项及其词卡，用新采集项内容更新该词卡（不新建），新项转 archived"""
    c = _db()
    try:
        item = c.execute("SELECT * FROM card_collect_items WHERE id=?", [iid]).fetchone()
        if not item:
            raise HTTPException(404, "采集项不存在")
        if item["status"] != "pending":
            raise HTTPException(400, "仅未归档的采集结果可刷新归档")
        # 找同源已归档词卡（同 source_url 最近归档）
        old = c.execute(
            "SELECT * FROM card_collect_items WHERE source_url=? AND status='archived' AND word_card_id IS NOT NULL "
            "ORDER BY id DESC LIMIT 1", [item["source_url"]]).fetchone()
        if not old:
            raise HTTPException(404, "未找到同源的已归档词卡（请确认该地址之前已归档过）")
        card_id = old["word_card_id"]
        card = c.execute("SELECT * FROM word_card WHERE id=? AND is_deleted=0", [card_id]).fetchone()
        if not card:
            raise HTTPException(404, f"原词卡 #{card_id} 不存在或已删除")
        # ---- 媒体处理（复用归档逻辑） ----
        media_filename = item["media_url"] or ""
        src = ""
        if media_filename:
            src = os.path.join(VID_DIR if item["media_type"] == "video" else IMG_DIR, media_filename)
            if not os.path.exists(src):
                media_filename = ""
                src = ""
        if not src:
            raise HTTPException(400, "新采集结果的媒体文件缺失，无法刷新归档")
        # 清理旧词卡媒体文件（缩略图/原图，删除失败仅记录）
        for _f in (card["thumbnail"] or "", card["original_ref"] or ""):
            if not _f:
                continue
            for _d in (os.path.join(_PROJECT_ROOT, "data", "thumbnails"),
                       os.path.join(_PROJECT_ROOT, "data", "wc_media", "thumbs"),
                       os.path.join(_PROJECT_ROOT, "data", "wc_media", "originals")):
                try:
                    _p = os.path.join(_d, os.path.basename(_f))
                    if os.path.exists(_p):
                        os.remove(_p)
                except Exception:
                    pass
        # 复制原图 → wc_media/originals/（图片卡）
        orig_name = ""
        if item["media_type"] != "video":
            try:
                import shutil as _shutil
                import uuid as _uuid
                orig_ext = os.path.splitext(src)[1] or ".jpg"
                orig_name = _uuid.uuid4().hex + orig_ext
                wc_orig_dir = os.path.join(_PROJECT_ROOT, "data", "wc_media", "originals")
                os.makedirs(wc_orig_dir, exist_ok=True)
                _shutil.copy2(src, os.path.join(wc_orig_dir, orig_name))
            except Exception as e:
                print(f"[CardCollect] 刷新归档原图失败: {e}")
                orig_name = ""
        # 缩略图 / 视频海报
        thumb_name = ""
        if item["media_type"] != "video":
            thumb_name = _gen_card_thumbnail(card_id, src)
        else:
            thumb_name = _gen_video_poster(card_id, src)
        preview_field = media_filename if item["media_type"] == "video" else ""
        meaning = " · ".join(x for x in [
            "📥 外部采集",
            ("视频" if item["media_type"] == "video" else "图片"),
            item["page_title"][:40] if item["page_title"] else "",
        ] if x)
        # ---- 更新词卡（内容/媒体/来源，保留词卡 id 与关联） ----
        c.execute(
            "UPDATE word_card SET content=?, meaning=?, media_type=?, thumbnail=?, preview_media=?, "
            "original_ref=?, source=?, source_id=?, updated_at=datetime('now','localtime') WHERE id=?",
            [item["prompt"] or "", meaning, item["media_type"] or "image", thumb_name,
             preview_field, orig_name, item["source_url"] or "", iid, card_id])
        # 新采集项转已归档，关联词卡
        c.execute(
            "UPDATE card_collect_items SET status='archived', word_card_id=?, archived_at=datetime('now','localtime') "
            "WHERE id=?", [card_id, iid])
        c.commit()
        return {"ok": True, "card_id": card_id, "thumbnail": thumb_name, "message": f"已刷新词卡 #{card_id}"}
    finally:
        c.close()


@router.post("/archive")
def archive_items(payload: dict = Body(...)):
    """采集项 → 词卡。ids 必填；group_id 指定分组，否则用 suggest_group（自动建组）"""
    ids = payload.get("ids") or []
    if not isinstance(ids, list) or not ids:
        raise HTTPException(400, "请选择要归档的采集项")
    group_id = payload.get("group_id")
    group_name = str(payload.get("group_name") or "").strip()
    if len(ids) > MAX_ITEMS_PER_TASK * 2:
        raise HTTPException(400, f"单次归档最多 {MAX_ITEMS_PER_TASK * 2} 条")
    c = _db()
    try:
        archived, skipped, errors = [], [], []
        for iid in ids:
            try:
                row = c.execute("SELECT * FROM card_collect_items WHERE id=?", [iid]).fetchone()
                if not row:
                    skipped.append({"id": iid, "reason": "不存在"})
                    continue
                if row["status"] == "archived":
                    skipped.append({"id": iid, "reason": "已归档"})
                    continue
                # v5.42.12: 同源同图去重（同 media_original_url 已有活跃词卡则跳过）
                if row["media_original_url"]:
                    dup = c.execute(
                        "SELECT wc.id FROM word_card wc JOIN card_collect_items ci ON ci.id=wc.source_id "
                        "WHERE ci.media_original_url=? AND wc.is_deleted=0 AND wc.module='card_collect' LIMIT 1",
                        [row["media_original_url"]]).fetchone()
                    if dup:
                        skipped.append({"id": iid, "reason": f"同图已归档(词卡#{dup['id']})"})
                        continue
                gid = group_id
                if not gid:
                    gname = group_name or row["suggest_group"] or "外部采集"
                    gid = _ensure_group(gname)
                # 媒体文件复制到词卡媒体目录（复用 wc_media 机制）
                media_filename = row["media_url"] or ""
                src = ""
                if media_filename:
                    src = os.path.join(VID_DIR if row["media_type"] == "video" else IMG_DIR, media_filename)
                    if not os.path.exists(src):
                        media_filename = ""
                        src = ""
                name = f"采集-{row['id']}"
                meaning = " · ".join(x for x in [
                    "📥 外部采集",
                    ("视频" if row["media_type"] == "video" else "图片"),
                    row["page_title"][:40] if row["page_title"] else "",
                ] if x)
                # v5.42.16: 复制原图到词卡原图目录（wc_media/originals/），词库「查看原图」用 original_ref 读取
                orig_name = ""
                if row["media_type"] != "video" and src and os.path.exists(src):
                    try:
                        import shutil as _shutil
                        import uuid as _uuid
                        orig_ext = os.path.splitext(src)[1] or ".jpg"
                        orig_name = _uuid.uuid4().hex + orig_ext
                        wc_orig_dir = os.path.join(_PROJECT_ROOT, "data", "wc_media", "originals")
                        os.makedirs(wc_orig_dir, exist_ok=True)
                        _shutil.copy2(src, os.path.join(wc_orig_dir, orig_name))
                    except Exception as e:
                        print(f"[CardCollect] 原图归档失败: {e}")
                        orig_name = ""
                # v5.46.11: 视频卡归档补预览与海报（否则网格无图且无法预览）
                preview_field = ""
                if row["media_type"] == "video" and src:
                    preview_field = media_filename
                cur = c.execute(
                    "INSERT INTO word_card (group_id, name, content, meaning, media_type, preview_media, "
                    "is_builtin, heat_weight, module, category, source, source_id, original_ref, created_at, updated_at) "
                    "VALUES (?,?,?,?,?,?,0,0.5,'card_collect','external_collect',?,?,?,datetime('now','localtime'),datetime('now','localtime'))",
                    [gid, name, row["prompt"] or "", meaning, row["media_type"] or "image",
                     preview_field, row["source_url"] or "", row["id"], orig_name])
                card_id = cur.lastrowid
                # v5.42.5: 图片词卡生成网格缩略图（240x160 → data/thumbnails/{card_id}.png）；
                # v5.46.11: 视频词卡生成海报（ffmpeg 首帧 → data/thumbnails/{card_id}.jpg）
                thumb_name = ""
                if src and os.path.exists(src):
                    if row["media_type"] != "video":
                        thumb_name = _gen_card_thumbnail(card_id, src)
                    else:
                        thumb_name = _gen_video_poster(card_id, src)
                if thumb_name:
                    c.execute("UPDATE word_card SET thumbnail=? WHERE id=?", [thumb_name, card_id])
                c.execute("UPDATE card_collect_items SET status='archived', word_card_id=?, archived_at=datetime('now','localtime') WHERE id=?",
                          [card_id, iid])
                archived.append({"id": iid, "card_id": card_id, "group_id": gid})
            except Exception as e:
                errors.append({"id": iid, "reason": str(e)[:120]})
        c.commit()
        # 收藏状态流转 archived
        fav_ids = [r["fav_id"] for r in c.execute(
            "SELECT DISTINCT fav_id FROM card_collect_items WHERE status='archived' AND fav_id!=0").fetchall()]
        for fid in fav_ids:
            c.execute("UPDATE card_collect_favorites SET status='archived' WHERE id=?", [fid])
        c.commit()
        return {"ok": True, "archived": archived, "skipped": skipped, "errors": errors}
    finally:
        c.close()


# ==================== API：来源溯源回溯 ====================

@router.get("/trace/{card_id}")
def trace_card(card_id: int):
    """词卡 → 采集项 → 收藏 → 原始 URL 完整回溯链"""
    c = _db()
    try:
        card = c.execute("SELECT id, name, source, source_id, original_ref, group_id FROM word_card WHERE id=?", [card_id]).fetchone()
        if not card:
            raise HTTPException(404, "词卡不存在")
        chain = {"card": dict(card), "item": None, "favorite": None}
        if card["source_id"]:
            item = c.execute("SELECT * FROM card_collect_items WHERE id=?", [card["source_id"]]).fetchone()
            if item:
                chain["item"] = dict(item)
                if item["fav_id"]:
                    fav = c.execute("SELECT * FROM card_collect_favorites WHERE id=?", [item["fav_id"]]).fetchone()
                    if fav:
                        chain["favorite"] = dict(fav)
        return {"ok": True, "chain": chain}
    finally:
        c.close()


# ==================== API：媒体访问 ====================

@router.get("/file/{fname}")
def serve_file(fname: str):
    """采集结果媒体访问（仅限 card_collect 目录内，防路径穿越）"""
    if not re.match(r"^[\w.\-]+$", fname):
        raise HTTPException(400, "非法文件名")
    for d in (IMG_DIR, VID_DIR):
        p = os.path.join(d, fname)
        if os.path.exists(p):
            from fastapi.responses import FileResponse
            return FileResponse(p)
    raise HTTPException(404, "文件不存在")


# ==================== API：灵感图库（常用站点快捷入口） ====================

@router.get("/{card_id}/images")
def card_images(card_id: int):
    """词卡图片池：当前原图 + 生成历史图（文生图/图生图/高清等）+ 采集原图，
    供查看原图弹窗自由切换。"""
    c = _db()
    try:
        card = c.execute("SELECT id, original_ref, source_id, module FROM word_card WHERE id=?", [card_id]).fetchone()
        if not card:
            raise HTTPException(404, "词卡不存在")
        items = []
        seen = set()
        # 1) 当前 original_ref（词卡主原图）
        if card["original_ref"] and not card["original_ref"].startswith("http") and card["original_ref"]:
            items.append({"url": "/api/media/original/" + card["original_ref"],
                          "label": "当前原图", "kind": "current", "time": ""})
            seen.add(card["original_ref"])
        # 2) 生成历史图（card_gen_tasks success/done 图片产物）
        tlabel = {"text2image": "文生图", "image2image": "图生图", "upscale": "高清",
                  "text2video": "文生视频", "image2video": "图生视频", "original": "采集原图"}
        for t in c.execute(
                "SELECT task_type, result_original, result_filename, media_type, created_at, status "
                "FROM card_gen_tasks WHERE card_id=? AND media_type='image' "
                "AND status IN ('success','done') ORDER BY id", [card_id]).fetchall():
            fn = t["result_original"] or t["result_filename"]
            if not fn or fn in seen:
                continue
            items.append({
                "url": "/api/media/original/" + fn,
                "label": tlabel.get(t["task_type"], t["task_type"] or "生成图") + " · " + (t["created_at"] or "")[5:16],
                "kind": "gen", "time": t["created_at"] or ""
            })
            seen.add(fn)
        # 3) 采集原图兜底（word_card.original_ref 被生成覆盖时，从 source_id 关联 item 找回 wc_media/originals 文件）
        if card["source_id"]:
            it = c.execute("SELECT media_url, media_type FROM card_collect_items WHERE id=?", [card["source_id"]]).fetchone()
            if it and it["media_type"] != "video" and it["media_url"]:
                # 采集项原图可能已复制到 originals（original_ref 未覆盖时就是它；覆盖时尝试从收藏介质反查）
                import os as _os
                import glob as _glob
                # 通过 item 的 media_url 无法直接反查 originals uuid 文件名，改为检查是否有该 item 相关的
                # 已知采集卡 original_ref（当前池已含）；此处省略深链（生成历史已覆盖主要场景）
                pass
        return {"ok": True, "items": items}
    finally:
        c.close()


@router.get("/sites")
def list_sites(group: str = Query("", description="按分组过滤")):
    """灵感图库列表（预置 + 手动添加；支持分组过滤）"""
    c = _db()
    try:
        if group:
            rows = c.execute("SELECT * FROM card_collect_sites WHERE group_name=? ORDER BY sort_order, id", [group]).fetchall()
        else:
            rows = c.execute("SELECT * FROM card_collect_sites ORDER BY sort_order, id").fetchall()
        groups = [r["group_name"] for r in c.execute(
            "SELECT DISTINCT group_name FROM card_collect_sites WHERE group_name!='' ORDER BY group_name").fetchall()]
        return {"ok": True, "items": [dict(r) for r in rows], "groups": groups}
    finally:
        c.close()


@router.post("/sites")
def add_site(payload: dict = Body(...)):
    """手动添加灵感图库：name/url 必填，description/icon_emoji 可选"""
    name = str(payload.get("name") or "").strip()[:100]
    url = str(payload.get("url") or "").strip()
    desc = str(payload.get("description") or "").strip()[:300]
    emoji = str(payload.get("icon_emoji") or "🌐").strip()[:8]
    login_req = 1 if payload.get("login_required") else 0
    group_name = str(payload.get("group_name") or "灵感图库").strip()[:50]
    if not name:
        raise HTTPException(400, "请输入图库名称")
    if not url.startswith("http://") and not url.startswith("https://"):
        raise HTTPException(400, "请输入合法的 http/https 地址")
    c = _db()
    try:
        # 同名去重
        exist = c.execute("SELECT id FROM card_collect_sites WHERE name=?", [name]).fetchone()
        if exist:
            raise HTTPException(400, "已存在同名图库")
        mx = c.execute("SELECT COALESCE(MAX(sort_order),0) FROM card_collect_sites").fetchone()[0]
        cur = c.execute(
            "INSERT INTO card_collect_sites (name, url, description, logo, icon_emoji, login_required, group_name, sort_order, created_at) "
            "VALUES (?,?,?,'',?,?,?,?,datetime('now','localtime'))",
            [name, url, desc, emoji, login_req, group_name, int(mx) + 1])
        c.commit()
        row = c.execute("SELECT * FROM card_collect_sites WHERE id=?", [cur.lastrowid]).fetchone()
        return {"ok": True, "item": dict(row)}
    finally:
        c.close()


@router.put("/sites/{sid}")
def update_site(sid: int, payload: dict = Body(...)):
    """修改图库信息（名称/地址/简介/emoji）"""
    c = _db()
    try:
        row = c.execute("SELECT * FROM card_collect_sites WHERE id=?", [sid]).fetchone()
        if not row:
            raise HTTPException(404, "图库不存在")
        upd = {}
        if "name" in payload:
            upd["name"] = str(payload["name"] or "").strip()[:100]
        if "url" in payload:
            u = str(payload["url"] or "").strip()
            if not u.startswith("http://") and not u.startswith("https://"):
                raise HTTPException(400, "请输入合法的 http/https 地址")
            upd["url"] = u
        if "description" in payload:
            upd["description"] = str(payload["description"] or "").strip()[:300]
        if "icon_emoji" in payload:
            upd["icon_emoji"] = str(payload["icon_emoji"] or "🌐").strip()[:8]
        if "login_required" in payload:
            upd["login_required"] = 1 if payload["login_required"] else 0
        if "group_name" in payload:
            upd["group_name"] = str(payload["group_name"] or "灵感图库").strip()[:50]
        if not upd:
            return {"ok": True, "item": dict(row)}
        upd["updated_at"] = "datetime('now','localtime')"
        sets = ", ".join(f"{k}=?" if k != "updated_at" else "updated_at=datetime('now','localtime')" for k in upd)
        vals = [v for k, v in upd.items() if k != "updated_at"]
        c.execute(f"UPDATE card_collect_sites SET {sets} WHERE id=?", vals + [sid])
        c.commit()
        row = c.execute("SELECT * FROM card_collect_sites WHERE id=?", [sid]).fetchone()
        return {"ok": True, "item": dict(row)}
    finally:
        c.close()


@router.delete("/sites/{sid}")
def delete_site(sid: int):
    """删除图库（含 logo 文件）；预制站点（is_builtin=1）不可删"""
    c = _db()
    try:
        row = c.execute("SELECT * FROM card_collect_sites WHERE id=?", [sid]).fetchone()
        if not row:
            raise HTTPException(404, "图库不存在")
        if row["is_builtin"]:
            raise HTTPException(400, "系统预制站点不可删除，可编辑调整")
        if row["logo"]:
            for ext in ("png", "jpg", "jpeg", "webp", "gif"):
                p = os.path.join(LOGO_DIR, f"cc_site_{sid}.{ext}")
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except Exception:
                        pass
        c.execute("DELETE FROM card_collect_sites WHERE id=?", [sid])
        c.commit()
        return {"ok": True}
    finally:
        c.close()


@router.post("/sites/{sid}/logo")
async def upload_site_logo(sid: int, file: UploadFile = File(...)):
    """手动替换品牌 logo（图片 ≤2MB，png/jpg/jpeg/webp/gif）"""
    c = _db()
    try:
        row = c.execute("SELECT * FROM card_collect_sites WHERE id=?", [sid]).fetchone()
        if not row:
            raise HTTPException(404, "图库不存在")
        fname = file.filename or ""
        ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else "png"
        if ext not in ("png", "jpg", "jpeg", "webp", "gif"):
            raise HTTPException(400, "仅支持 png/jpg/jpeg/webp/gif 图片")
        data = await file.read()
        if len(data) > 2 * 1024 * 1024:
            raise HTTPException(400, "图片不能超过 2MB")
        # 清理旧 logo（不同扩展名）
        for old_ext in ("png", "jpg", "jpeg", "webp", "gif"):
            old = os.path.join(LOGO_DIR, f"cc_site_{sid}.{old_ext}")
            if os.path.exists(old) and old != os.path.join(LOGO_DIR, f"cc_site_{sid}.{ext}"):
                try:
                    os.remove(old)
                except Exception:
                    pass
        dest = os.path.join(LOGO_DIR, f"cc_site_{sid}.{ext}")
        with open(dest, "wb") as f:
            f.write(data)
        c.execute("UPDATE card_collect_sites SET logo=?, updated_at=datetime('now','localtime') WHERE id=?",
                  [f"cc_site_{sid}.{ext}", sid])
        c.commit()
        row = c.execute("SELECT * FROM card_collect_sites WHERE id=?", [sid]).fetchone()
        return {"ok": True, "item": dict(row)}
    finally:
        c.close()


@router.get("/sites/logo/{fname}")
def serve_site_logo(fname: str):
    """图库 logo 访问（仅限 logos 目录，防路径穿越）"""
    if not re.match(r"^cc_site_\d+\.(png|jpg|jpeg|webp|gif)$", fname):
        raise HTTPException(400, "非法文件名")
    p = os.path.join(LOGO_DIR, fname)
    if os.path.exists(p):
        from fastapi.responses import FileResponse
        return FileResponse(p)
    raise HTTPException(404, "文件不存在")
