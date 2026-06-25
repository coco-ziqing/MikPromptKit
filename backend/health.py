"""
v4.0.0-phase11: Startup Health Check Engine
服务启动自检 — 9项外部依赖检测 + 用户可配置跳过项
"""
import json, os, sys, subprocess, asyncio, shutil, socket
from typing import Optional
from fastapi import APIRouter, Query

router = APIRouter(prefix="/api/health", tags=["health"])

# ========== v4.0.0-phase11.1: 后台持续监听 ==========
_watch_status = {
    "ollama": {"ok": None, "url": "", "error": "未检测", "latency_ms": 0, "updated_at": ""},
    "comfyui": {"ok": None, "url": "", "error": "未检测", "latency_ms": 0, "updated_at": ""},
    "running": False,
    "interval_sec": 30,
}
_watch_task = None

# ---------- 常量 ----------
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_COMFY_URL = "http://127.0.0.1:8188"
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")


def _get_config(key: str) -> Optional[str]:
    """读取 config 表配置值"""
    try:
        from database import get_db
        db = get_db()
        row = db.execute("SELECT value FROM config WHERE key=?", [key]).fetchone()
        return row["value"] if row else None
    except Exception:
        return None


def _get_ollama_cfg():
    """解析 ollama 配置"""
    raw = _get_config("ollama_config")
    cfg = {"server_url": DEFAULT_OLLAMA_URL, "model": ""}
    if raw:
        try:
            parsed = json.loads(raw)
            cfg.update(parsed)
        except Exception:
            pass
    return cfg


def _get_comfy_cfg():
    """解析 comfyui 配置"""
    raw = _get_config("comfyui_config")
    cfg = {"server_url": DEFAULT_COMFY_URL, "enabled": True}
    if raw:
        try:
            parsed = json.loads(raw)
            cfg.update(parsed)
        except Exception:
            pass
    return cfg


def _save_comfy_url(url: str):
    """自动发现后同步配置，使 ComfyUI 集成设置页无需手动填写"""
    try:
        from database import get_db, safe_commit
        raw = _get_config("comfyui_config")
        cfg = {"server_url": DEFAULT_COMFY_URL, "enabled": True}
        if raw:
            try:
                cfg.update(json.loads(raw))
            except Exception:
                pass
        # 只在地址变化时写入
        if cfg.get("server_url") != url:
            cfg["server_url"] = url
            cfg["enabled"] = True
            db = get_db()
            db.execute(
                "INSERT OR REPLACE INTO config (key, value) VALUES ('comfyui_config', ?)",
                [json.dumps(cfg, ensure_ascii=False)]
            )
            safe_commit()
            print(f"[ComfyUI] 自动发现地址已同步: {url}")
            return True
    except Exception as e:
        print(f"[ComfyUI] 配置同步失败: {e}")
    return False


# ====================== 单项检测函数 ======================

async def _check_ollama(timeout: float = 5.0) -> dict:
    """检测 Ollama 服务 + 已安装模型列表"""
    cfg = _get_ollama_cfg()
    url = (cfg.get("server_url") or DEFAULT_OLLAMA_URL).rstrip("/")

    try:
        import httpx
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(f"{url}/api/tags")
            if resp.status_code == 200:
                models = resp.json().get("models", [])
                names = [m.get("name", "") for m in models[:8]]
                return {
                    "ok": True,
                    "url": url,
                    "models": names,
                    "model_count": len(models),
                    "latency_ms": round(resp.elapsed.total_seconds() * 1000)
                }
            return {"ok": False, "url": url, "error": f"HTTP {resp.status_code}", "hint": "Ollama 服务异常"}
    except Exception as e:
        msg = str(e)
        if "Connection refused" in msg or "ConnectError" in msg:
            return {"ok": False, "url": url, "error": "连接被拒绝", "hint": "Ollama 服务未启动或端口不对"}
        if "timeout" in msg.lower():
            return {"ok": False, "url": url, "error": "连接超时", "hint": f"{timeout}s 内无响应"}
        return {"ok": False, "url": url, "error": msg[:100], "hint": "未知错误"}


async def _probe_comfy_url(url: str, timeout: float = 2.0):
    """探测某个 URL 是否运行 ComfyUI"""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            # 优先用 /system_stats（新版 ComfyUI）
            resp = await client.get(f"{url}/system_stats")
            if resp.status_code == 200 and 'application/json' in (resp.headers.get('content-type') or ''):
                data = resp.json()
                return {
                    "ok": True, "url": url,
                    "system": data.get("system", {}),
                    "latency_ms": round(resp.elapsed.total_seconds() * 1000)
                }
    except Exception:
        pass
    
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(f"{url}/")
            if resp.status_code == 200:
                text = resp.text[:500].lower()
                # ComfyUI 页面特征
                if 'comfyui' in text or 'comfy' in text or 'graph-canvas' in text:
                    return {"ok": True, "url": url, "system": "ComfyUI",
                            "latency_ms": round(resp.elapsed.total_seconds() * 1000)}
    except Exception:
        pass
    
    # 旧版兼容: /api/queue
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(f"{url}/api/queue")
            if resp.status_code in (200, 404) and 'json' in str(resp.headers.get('content-type', '')).lower():
                return {"ok": True, "url": url, "system": "ComfyUI (API)",
                        "latency_ms": round(resp.elapsed.total_seconds() * 1000)}
    except Exception:
        pass
    
    return None


async def _autodetect_comfyui(timeout: float = 2.0):
    """自动发现 ComfyUI 服务 — 支持桌面版（端口不固定）"""
    import subprocess
    
    # ===== 方法1: netstat 扫描所有 127.0.0.1 监听端口 =====
    local_ports = []
    try:
        result = subprocess.run(
            ['netstat', '-ano', '-p', 'TCP'],
            capture_output=True, text=True, timeout=3,
            creationflags=subprocess.CREATE_NO_WINDOW
        )
        for line in result.stdout.split('\n'):
            if 'LISTENING' in line and '127.0.0.1' in line:
                parts = line.split()
                if len(parts) >= 2:
                    addr = parts[1]
                    port = addr.split(':')[-1]
                    if port.isdigit() and port not in ('8080', '9200', '11434', '135', '445'):
                        local_ports.append(port)
    except Exception:
        pass
    
    # ===== 方法2: 补充已知 ComfyUI 端口 =====
    EXTRA = ['8188', '8189', '8190', '8191', '8000', '8001', '7860', '5000', '3000', '8088']
    for p in EXTRA:
        if p not in local_ports:
            local_ports.append(p)
    
    # 逐个探测
    for port in local_ports:
        url = f"http://127.0.0.1:{port}"
        result = await _probe_comfy_url(url, timeout=min(timeout, 1.2))
        if result:
            result["autodetected"] = True
            return result
    return None


async def _check_comfyui(timeout: float = 5.0) -> dict:
    """检测 ComfyUI 服务 — 配置地址优先，失败后自动扫描本地端口"""
    try:
        cfg = _get_comfy_cfg()
    except Exception:
        cfg = {}
    if not cfg.get("enabled", True):
        return {"ok": True, "skipped": True, "reason": "ComfyUI 已在设置中禁用"}

    url = (cfg.get("server_url") or DEFAULT_COMFY_URL).rstrip("/")

    # 1) 先用配置地址探测
    try:
        import httpx
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(f"{url}/system_stats")
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "ok": True,
                    "url": url,
                    "system": data.get("system", {}),
                    "latency_ms": round(resp.elapsed.total_seconds() * 1000)
                }
            # 兼容旧版 ComfyUI 没有 /system_stats
            resp2 = await client.get(f"{url}/")
            if resp2.status_code == 200:
                return {"ok": True, "url": url, "system": "ComfyUI (旧版)", "latency_ms": round(resp2.elapsed.total_seconds() * 1000)}
            return {"ok": False, "url": url, "error": f"HTTP {resp.status_code}", "hint": "ComfyUI 服务异常"}
    except Exception as e:
        msg = str(e)
        if "Connection refused" in msg or "ConnectError" in msg or "NameResolutionError" in msg:
            # 2) 配置地址不可达 → 自动扫描本地端口
            auto = await _autodetect_comfyui(timeout=3.0)
            if auto:
                auto["_auto_notice"] = f"配置地址 {url} 不可达，已自动发现 ComfyUI"
                _save_comfy_url(auto["url"])  # 同步到配置
                return auto
            return {"ok": False, "url": url, "error": "连接被拒绝", "hint": "ComfyUI 服务未启动"}
        if "timeout" in msg.lower():
            return {"ok": False, "url": url, "error": "连接超时", "hint": f"{timeout}s 内无响应"}
        return {"ok": False, "url": url, "error": msg[:100], "hint": "未知错误"}


def _check_semantic() -> dict:
    """检测语义搜索依赖"""
    try:
        import numpy as np
        numpy_ok = True
        numpy_ver = np.__version__
    except Exception:
        numpy_ok = False
        numpy_ver = None

    try:
        from sentence_transformers import SentenceTransformer
        st_ok = True
        import importlib.metadata
        st_ver = importlib.metadata.version("sentence-transformers")
    except Exception:
        st_ok = False
        st_ver = None

    ok = numpy_ok and st_ok

    # 检查模型缓存
    model_cached = False
    if ok:
        try:
            cache_dir = os.path.join(os.path.expanduser("~"), ".cache", "torch", "sentence_transformers")
            if os.path.isdir(cache_dir):
                for root, dirs, _ in os.walk(cache_dir):
                    for d in dirs:
                        if "all-MiniLM" in d or "miniLM" in d.lower():
                            model_cached = True
                            break
                    if model_cached:
                        break
        except Exception:
            pass

    return {
        "ok": ok,
        "numpy": {"available": numpy_ok, "version": numpy_ver},
        "sentence_transformers": {"available": st_ok, "version": st_ver},
        "model_cached": model_cached,
        "hint": None if ok else "语义搜索将使用 FTS5 降级模式"
    }


def _check_ffmpeg() -> dict:
    """检测 ffmpeg"""
    try:
        result = subprocess.run(
            ["ffmpeg", "-version"], capture_output=True, text=True, timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        )
        if result.returncode == 0:
            ver_line = result.stdout.split("\n")[0] if result.stdout else ""
            return {"ok": True, "version": ver_line[:80]}
        return {"ok": False, "error": f"exit code {result.returncode}", "hint": "ffmpeg 已安装但版本命令失败"}
    except FileNotFoundError:
        return {"ok": False, "error": "未找到 ffmpeg", "hint": "请安装 ffmpeg 并加入 PATH 或放入 backend/ 目录"}
    except Exception as e:
        return {"ok": False, "error": str(e)[:100], "hint": "视频处理功能不可用"}


def _check_pillow() -> dict:
    """检测 Pillow 图片处理库"""
    try:
        from PIL import Image, __version__ as pil_ver
        # 做一次基本操作验证
        img = Image.new("RGB", (16, 16), color="red")
        buf = img.tobytes()
        return {"ok": True, "version": pil_ver, "formats": ["JPEG", "PNG", "WebP", "GIF"]}
    except ImportError:
        return {"ok": False, "error": "未安装 Pillow", "hint": "pip install Pillow"}
    except Exception as e:
        return {"ok": False, "error": str(e)[:100], "hint": "图片处理异常"}


def _check_database() -> dict:
    """检测数据库读写 — 使用独立连接避免与主服务连接冲突"""
    import sqlite3, time, os
    db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'prompts.db')
    if not os.path.exists(db_path):
        return {"ok": False, "error": "数据库文件不存在", "hint": "数据库不可用，服务无法正常运行"}

    # 独立连接 + 重试机制，避免与主服务 WAL 写锁冲突
    for attempt in range(3):
        conn = None
        try:
            conn = sqlite3.connect(db_path, timeout=15)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA busy_timeout=10000")
            # 读测试
            cnt = conn.execute("SELECT COUNT(*) as c FROM prompts").fetchone()
            # 写测试 — 独立连接避免锁冲突
            conn.execute("CREATE TABLE IF NOT EXISTS _health_check (id INTEGER PRIMARY KEY, ts TEXT)")
            conn.execute("INSERT INTO _health_check (ts) VALUES (datetime('now'))")
            conn.execute("SELECT ts FROM _health_check ORDER BY id DESC LIMIT 1")
            conn.execute("DELETE FROM _health_check")
            conn.commit()
            return {
                "ok": True,
                "path": db_path,
                "wal": True,
                "prompt_count": cnt["c"] if cnt else 0
            }
        except sqlite3.OperationalError as e:
            if 'locked' in str(e).lower() and attempt < 2:
                time.sleep(0.3 * (attempt + 1))
                continue
            return {"ok": False, "error": str(e)[:100], "hint": "数据库不可用，服务无法正常运行"}
        except Exception as e:
            return {"ok": False, "error": str(e)[:100], "hint": "数据库不可用，服务无法正常运行"}
        finally:
            if conn:
                try: conn.close()
                except: pass

    return {"ok": False, "error": "数据库忙（重试3次后仍锁）", "hint": "数据库不可用，服务无法正常运行"}


def _check_disk() -> dict:
    """检测磁盘空间"""
    try:
        usage = shutil.disk_usage(DATA_DIR)
        gb_free = usage.free / (1024 ** 3)
        gb_total = usage.total / (1024 ** 3)
        return {
            "ok": gb_free > 0.1,
            "path": DATA_DIR,
            "free_gb": round(gb_free, 2),
            "total_gb": round(gb_total, 2),
            "percent_free": round(usage.free / usage.total * 100, 1),
            "hint": None if gb_free > 0.1 else "磁盘空间不足 (<100MB)，可能影响数据保存"
        }
    except Exception as e:
        return {"ok": True, "error": str(e)[:80]}


def _check_self_reachable() -> dict:
    """检测服务端口可达性 + LAN IP + 防火墙规则 + IP变更"""
    default_port = 8080
    try:
        from database import get_db
        db = get_db()
        row = db.execute("SELECT value FROM config WHERE key='port'").fetchone()
        if row:
            default_port = int(row["value"])
    except Exception:
        pass
    # LAN IP
    lan_ip = "127.0.0.1"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        lan_ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass
    # 防火墙规则检查
    fw_ok = False; fw_rule_name = ""
    try:
        fw = subprocess.run(['netsh','advfirewall','firewall','show','rule','name=PromptKit'],
            capture_output=True,text=True,timeout=3,creationflags=subprocess.CREATE_NO_WINDOW)
        fw_ok = f'LocalPort{default_port}' in fw.stdout or f':{default_port}' in fw.stdout
        fw_rule_name = 'PromptKit' if fw_ok else ''
        if not fw_ok:
            fw2 = subprocess.run(['netsh','advfirewall','firewall','show','rule','name=PromptKit 8080'],
                capture_output=True,text=True,timeout=3,creationflags=subprocess.CREATE_NO_WINDOW)
            if 'LocalPort' in fw2.stdout: fw_ok = True; fw_rule_name = 'PromptKit 8080'
    except Exception:
        pass
    # IP变更检测
    ip_changed = False; last_ip = None
    try:
        from database import get_db as _gdb2
        db2 = _gdb2()
        row = db2.execute("SELECT value FROM config WHERE key='last_lan_ip'").fetchone()
        if row:
            last_ip = row["value"]
            ip_changed = last_ip != lan_ip
        db2.execute("INSERT OR REPLACE INTO config (key,value) VALUES ('last_lan_ip',?)",[lan_ip])
        db2.execute("INSERT OR REPLACE INTO config (key,value) VALUES ('last_ip_check_at',?)",
            [__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S')])
        db2.commit()
    except Exception:
        pass
    hint = None
    if not fw_ok:
        hint = f"防火墙规则未配置端口 {default_port}，局域网设备可能无法访问"
    elif ip_changed:
        hint = f"IP 已变更: {last_ip} -> {lan_ip}，请更新书签"
    return {
        "ok": True, "port": default_port, "lan_ip": lan_ip,
        "access_url": f"http://{lan_ip}:{default_port}",
        "local_url": f"http://127.0.0.1:{default_port}",
        "firewall_ok": fw_ok, "firewall_rule": fw_rule_name,
        "ip_changed": ip_changed, "last_ip": last_ip, "hint": hint
    }


def _check_wal_integrity() -> dict:
    """检测 SQLite WAL 完整性 — 独立连接，避免与主服务锁冲突"""
    import sqlite3, os
    db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'prompts.db')
    conn = None
    try:
        conn = sqlite3.connect(db_path, timeout=5)
        conn.execute("PRAGMA busy_timeout=3000")
        # PASSIVE 模式不阻塞读写，仅合并已提交的 WAL 页
        wal = conn.execute("PRAGMA wal_checkpoint(PASSIVE)").fetchall()
        pages = wal[0][2] if len(wal) > 0 and len(wal[0]) > 2 else -1
        return {"ok": True, "wal_pages_remaining": pages,
            "hint": f"WAL {pages} pages pending" if pages > 100 else None}
    except Exception as e:
        return {"ok": True, "skipped": True, "reason": str(e)[:80]}
    finally:
        if conn:
            try: conn.close()
            except: pass


def _check_playground_llm() -> dict:
    """检测 LLM Playground 的 Ollama LLM 模型（独立于视觉/翻译用的 Ollama 配置）"""
    from database import get_db
    db = get_db()
    row = db.execute("SELECT value FROM config WHERE key='playground_config'").fetchone()
    cfg = {}
    if row:
        try:
            cfg = json.loads(row["value"])
        except Exception:
            pass

    provider = cfg.get("provider", "ollama")
    if provider == "ollama":
        server_url = (cfg.get("server_url") or DEFAULT_OLLAMA_URL).rstrip("/")
        model = cfg.get("model", "") or ""
        if not model:
            return {"ok": True, "skipped": True, "reason": "LLM Playground 未配置 Ollama 模型", "provider": "ollama"}
        try:
            import httpx
            import asyncio
            # 用 /api/show 检测特定模型是否存在
            async def _probe():
                async with httpx.AsyncClient(timeout=5) as client:
                    resp = await client.post(f"{server_url}/api/show", json={"name": model})
                    return resp.status_code == 200
            loop = asyncio.new_event_loop()
            exists = loop.run_until_complete(_probe())
            loop.close()
            return {"ok": exists, "provider": "ollama", "server_url": server_url, "model": model,
                    "hint": None if exists else f"模型 {model} 不在 Ollama 中"}
        except Exception as e:
            return {"ok": False, "provider": "ollama", "model": model, "error": str(e)[:100]}
    elif provider == "openai":
        return {"ok": True, "provider": "openai", "model": cfg.get("model", ""), "info": "OpenAI API 模式，需网络连通外网"}
    else:
        return {"ok": True, "provider": provider, "info": "未知 provider"}


# ====================== 综合检测 API ======================

@router.get("/check")
async def health_check(
    skip: str = Query("", description="跳过项: ollama,comfyui,semantic,ffmpeg,pillow,db,disk,port,llm"),
    timeout: float = Query(5.0, ge=1.0, le=15.0, description="单次检测超时秒数")
):
    """
    启动自检：逐项检测外部依赖，返回结构化结果。
    skip 参数可跳过指定项（逗号分隔），例如 skip=comfyui,llm
    """
    skip_set = set(s.strip() for s in (skip or "").split(",") if s.strip())

    results = {}
    all_ok = True
    warning_count = 0
    error_count = 0

    checks = [
        ("ollama", "Ollama 大模型服务", _check_ollama, True),
        ("comfyui", "ComfyUI 图片生成", _check_comfyui, True),
        ("semantic", "语义搜索依赖", _check_semantic, False),
        ("ffmpeg", "ffmpeg 视频处理", _check_ffmpeg, False),
        ("pillow", "Pillow 图片处理", _check_pillow, False),
        ("db", "数据库读写", _check_database, False),
        ("wal", "WAL 完整性", _check_wal_integrity, False),
        ("disk", "磁盘空间", _check_disk, False),
        ("port", "端口+防火墙+IP变更", _check_self_reachable, False),
        ("llm", "LLM Playground 模型", _check_playground_llm, False),
    ]

    for key, label, check_fn, is_async in checks:
        if key in skip_set:
            results[key] = {"ok": True, "skipped": True, "label": label, "reason": "用户跳过"}
            continue
        try:
            if is_async:
                r = await check_fn(timeout)
            else:
                r = check_fn()
        except Exception as e:
            r = {"ok": False, "error": str(e)[:120]}

        r["label"] = label
        results[key] = r

        if not r.get("ok") and not r.get("skipped"):
            all_ok = False
            if key in ("db", "port"):
                error_count += 1  # 致命
            else:
                warning_count += 1  # 降级

    return {
        "ok": all_ok,
        "error_count": error_count,
        "warning_count": warning_count,
        "total_checks": len(checks),
        "checked": sum(1 for r in results.values() if not r.get("skipped")),
        "skipped": sum(1 for r in results.values() if r.get("skipped")),
        "results": results
    }


@router.get("/check/{item}")
async def health_check_single(
    item: str,
    timeout: float = Query(5.0, ge=1.0, le=15.0)
):
    """单项重检"""
    mapping = {
        "ollama": (_check_ollama, True),
        "comfyui": (_check_comfyui, True),
        "semantic": (lambda: _check_semantic(), False),
        "ffmpeg": (lambda: _check_ffmpeg(), False),
        "pillow": (lambda: _check_pillow(), False),
        "db": (lambda: _check_database(), False),
        "disk": (lambda: _check_disk(), False),
        "port": (lambda: _check_port(), False),
        "llm": (lambda: _check_playground_llm(), False),
    }
    if item not in mapping:
        return {"ok": False, "error": f"未知检测项: {item}"}
    fn, is_async = mapping[item]
    if is_async:
        result = await fn(timeout)
    else:
        result = fn()
    return {"item": item, "result": result}


@router.get("/config")
def get_health_config():
    """获取自检配置（哪些项可跳过、默认超时）"""
    return {
        "checks": [
            {"key": "ollama", "label": "Ollama 大模型服务", "critical": False,
             "desc": "翻译 + OCR + LLM Playground"},
            {"key": "comfyui", "label": "ComfyUI 图片生成", "critical": False,
             "desc": "AI 生成缩略图"},
            {"key": "semantic", "label": "语义搜索依赖", "critical": False,
             "desc": "sentence-transformers + numpy"},
            {"key": "ffmpeg", "label": "ffmpeg 视频处理", "critical": False,
             "desc": "视频封面提取 + 裁剪压缩"},
            {"key": "pillow", "label": "Pillow 图片处理", "critical": True,
             "desc": "图片裁剪、缩略图生成"},
            {"key": "db", "label": "数据库读写", "critical": True,
             "desc": "SQLite 数据存储"},
            {"key": "disk", "label": "磁盘空间", "critical": True,
             "desc": "数据存储空间"},
            {"key": "port", "label": "端口绑定 & LAN IP", "critical": True,
             "desc": "Web 服务端口"},
            {"key": "llm", "label": "LLM Playground 模型", "critical": False,
             "desc": "Playground 对话模型"},
        ],
        "default_timeout": 5,
        "auto_check_on_startup": True
    }


# ====================== v4.0.0-phase11.1: 后台持续监听 ======================

async def _ping_ollama() -> dict:
    """轻量 ping Ollama（只测连通性 + 延迟）"""
    cfg = _get_ollama_cfg()
    url = (cfg.get("server_url") or DEFAULT_OLLAMA_URL).rstrip("/")
    import httpx, time as _time
    t0 = _time.time()
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{url}/api/tags")
            ok = resp.status_code == 200
            return {"ok": ok, "url": url, "error": "" if ok else f"HTTP {resp.status_code}",
                    "latency_ms": round((_time.time() - t0) * 1000)}
    except Exception as e:
        return {"ok": False, "url": url, "error": str(e)[:80], "latency_ms": round((_time.time() - t0) * 1000)}


async def _ping_comfyui() -> dict:
    """轻量 ping ComfyUI（配置地址失败时自动扫描）"""
    try:
        cfg = _get_comfy_cfg()
    except Exception:
        cfg = {}
    if not cfg.get("enabled", True):
        return {"ok": True, "skipped": True, "url": "", "error": "已禁用", "latency_ms": 0}
    url = (cfg.get("server_url") or DEFAULT_COMFY_URL).rstrip("/")
    import httpx, time as _time
    t0 = _time.time()
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{url}/")
            ok = resp.status_code == 200
            return {"ok": ok, "url": url, "error": "" if ok else f"HTTP {resp.status_code}",
                    "latency_ms": round((_time.time() - t0) * 1000)}
    except Exception:
        # 配置地址不可达 → 自动扫描
        auto = await _autodetect_comfyui(timeout=2.0)
        if auto:
            _save_comfy_url(auto["url"])  # 同步到配置
            return {"ok": True, "url": auto["url"], "error": "", "latency_ms": auto.get("latency_ms", 0),
                    "autodetected": True}
        return {"ok": False, "url": url, "error": "未响应", "latency_ms": round((_time.time() - t0) * 1000)}


async def _watch_loop():
    """后台循环: 每 interval_sec 秒 ping Ollama + ComfyUI"""
    interval = _watch_status["interval_sec"]
    while _watch_status["running"]:
        try:
            r = await _ping_ollama()
            _watch_status["ollama"] = {**r, "updated_at": _now_iso()}
        except Exception:
            pass
        try:
            r = await _ping_comfyui()
            _watch_status["comfyui"] = {**r, "updated_at": _now_iso()}
        except Exception:
            pass
        for _ in range(interval):
            if not _watch_status["running"]:
                break
            await asyncio.sleep(1)


def _now_iso():
    import datetime
    return datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def start_watcher():
    """启动后台监听器"""
    if _watch_status["running"]:
        return False
    _watch_status["running"] = True
    try:
        loop = asyncio.get_running_loop()
        global _watch_task
        _watch_task = loop.create_task(_watch_loop())
        print(f"[监听] 后台监听已启动（每{_watch_status['interval_sec']}s ping Ollama + ComfyUI）")
        return True
    except RuntimeError:
        print("[监听] 非异步上下文，延后启动")
        return False


def stop_watcher():
    """停止后台监听器"""
    _watch_status["running"] = False
    if _watch_task:
        _watch_task.cancel()


@router.get("/status")
def get_watch_status():
    """获取外部依赖实时状态（信号灯用）"""
    return {
        "ollama": {k: v for k, v in _watch_status["ollama"].items()},
        "comfyui": {k: v for k, v in _watch_status["comfyui"].items()},
        "running": _watch_status["running"],
        "interval_sec": _watch_status["interval_sec"],
    }
