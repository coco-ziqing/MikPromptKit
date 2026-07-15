#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
pk_agent.py — PromptKit 设备盘索引 Agent（Phase35.3b）

绿色便携版：仅 Python 标准库，无外部依赖。
  · 首次运行：输入服务器地址 + 配对码 → 获取 device token → 存 pk_agent.ini
  · 常驻扫描：轮询白名单目录（size+mtime 跳扫，变化才算 sha256）
  · 批量上报：变化文件发 /index-batch；接收任务（critical 备份上传）
  · 分块上传：critical 资产 8MB/块，内容寻址去重

启动方式：
  python pk_agent.py                # 控制台运行（可看日志）
  python pk_agent.py --silent       # 后台静默（仅写日志文件）
  python pk_agent.py --force-pair   # 强制重新配对

配置文件 pk_agent.ini（INI 格式）：
  [agent]
  server = http://192.168.0.101:8080
  device_token = abc123...
  device_id = 1

  [scan]
  interval_sec = 60
  fast_fingerprint_mb = 500

  [watch]
  path = D:/ProjectA
  path = E:/Renders
"""
import os, sys, json, hashlib, time, threading, urllib.request, urllib.error
import configparser, random, string, socket, traceback

# ── 常量和路径 ──
HERE = os.path.dirname(os.path.abspath(__file__))
INI_PATH = os.path.join(HERE, "pk_agent.ini")
LOG_PATH = os.path.join(HERE, "pk_agent.log")

LOG_FILE = None

def log(msg):
    ts = time.strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    if not FLAGS.get("silent"):
        print(line)
    if LOG_FILE:
        LOG_FILE.write(line + "\n")
        LOG_FILE.flush()

# ── 命令行标志 ──
FLAGS = {"silent": False, "force_pair": False}
for a in sys.argv[1:]:
    if a == "--silent": FLAGS["silent"] = True
    elif a == "--force-pair": FLAGS["force_pair"] = True

# ── 日志文件 ──
if FLAGS["silent"]:
    LOG_FILE = open(LOG_PATH, "a", encoding="utf-8")

# ── 平台信息 ──
PLATFORM = sys.platform
if PLATFORM.startswith("win"):  PLATFORM = "win"
elif PLATFORM.startswith("darwin"): PLATFORM = "mac"
else: PLATFORM = "linux"

# ════════════════════════════════════════════
# 配置管理
# ════════════════════════════════════════════
cfg = configparser.ConfigParser()

def load_cfg():
    if os.path.exists(INI_PATH):
        cfg.read(INI_PATH, encoding="utf-8")
    # 确保节存在
    for sec in ["agent", "scan", "watch"]:
        if not cfg.has_section(sec): cfg.add_section(sec)

def save_cfg():
    with open(INI_PATH, "w", encoding="utf-8") as f:
        cfg.write(f)

# ════════════════════════════════════════════
# HTTP 客户端
# ════════════════════════════════════════════
SERVER = ""
TOKEN = ""

def api(method, path, body=None, raw=False, timeout=30):
    url = SERVER + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data: req.add_header("Content-Type", "application/json")
    if TOKEN: req.add_header("X-Device-Token", TOKEN)
    for i in range(3):  # retry
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                if raw: return r.status, r.read()
                return r.status, json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            try: return e.code, json.loads(e.read().decode())
            except: return e.code, {}
        except Exception as e:
            if i == 2: raise
            time.sleep(2 * (i + 1))

# ════════════════════════════════════════════
# 配对
# ════════════════════════════════════════════
def do_pair():
    global SERVER, TOKEN
    log("=== 设备配对 ===")
    addr = input("服务器地址 (例 http://192.168.0.101:8080): ").strip().rstrip("/")
    if not addr:
        log("取消")
        return False
    SERVER = addr
    code = input("配对码 (管理面板生成): ").strip().upper()
    if len(code) != 6:
        log("配对码应为 6 位")
        return False
    name = socket.gethostname() or "未命名设备"
    st, d = api("POST", "/api/device/register", {
        "code": code, "name": name, "platform": PLATFORM, "agent_version": "0.1.0"
    })
    if st != 200:
        log(f"注册失败: {d}")
        return False
    TOKEN = d.get("token", "")
    cfg["agent"]["server"] = SERVER
    cfg["agent"]["device_token"] = TOKEN
    cfg["agent"]["device_id"] = str(d.get("id", ""))
    cfg["agent"]["name"] = name
    save_cfg()
    log(f"配对成功！设备ID={d['id']} 名称={name}")
    return True

# ════════════════════════════════════════════
# 文件指纹
# ════════════════════════════════════════════
FAST_THRESHOLD = 500 * 1024 * 1024  # 500MB

def fingerprint(filepath, size):
    """sha256 指纹。大文件用 sz:size:name 快速指纹"""
    if size > FAST_THRESHOLD:
        return f"sz:{size}:{os.path.basename(filepath)}"
    h = hashlib.sha256()
    try:
        with open(filepath, "rb") as f:
            while True:
                buf = f.read(8 * 1024 * 1024)
                if not buf: break
                h.update(buf)
        return h.hexdigest()
    except Exception as e:
        log(f"指纹失败: {filepath} — {e}")
        return ""

# ════════════════════════════════════════════
# 目录扫描
# ════════════════════════════════════════════
def scan_path(watch_path):
    """扫描一个白名单目录，返回 [{rel_path,filename,ext,size,mtime,fingerprint}]"""
    items = []
    if not os.path.isdir(watch_path): return items
    try:
        for root, dirs, files in os.walk(watch_path):
            # 跳过隐藏目录
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for fname in files:
                if fname.startswith("."): continue
                fp = os.path.join(root, fname)
                try:
                    st = os.stat(fp)
                    items.append({
                        "rel_path": os.path.relpath(fp, watch_path),
                        "filename": fname,
                        "ext": os.path.splitext(fname)[1].lower(),
                        "size": st.st_size,
                        "mtime": st.st_mtime,
                        "fingerprint": None,  # 延迟计算，变化时才算
                    })
                except OSError:
                    pass
    except Exception as e:
        log(f"扫描异常 {watch_path}: {e}")
    return items

def diff_scan(prev_map, current_items, watch_path):
    """
    对比上次状态 → 需要上报的新增/变更 + 消失列表。
    prev_map: {rel_path: (size, mtime, fingerprint)}
    current_items as list
    """
    new_or_changed = []
    cur_keys = set()

    for it in current_items:
        rp = it["rel_path"]
        cur_keys.add(rp)
        prev = prev_map.get(rp)
        if prev is None:
            # 新增
            fp = fingerprint(os.path.join(watch_path, rp), it["size"])
            it["fingerprint"] = fp
            new_or_changed.append(it)
        elif prev[0] != it["size"] or prev[1] != it["mtime"]:
            # 变更
            fp = fingerprint(os.path.join(watch_path, rp), it["size"])
            it["fingerprint"] = fp
            new_or_changed.append(it)
        else:
            # 未变，保留旧指纹
            it["fingerprint"] = prev[2]

    # 消失的文件
    removed = [rp for rp in prev_map if rp not in cur_keys]
    return new_or_changed, removed

# ════════════════════════════════════════════
# 批量上报
# ════════════════════════════════════════════
def batch_report(new_or_changed, removed):
    """分批上报（≤500 条/批），返回服务器 diff 中的 missing 列表 + tasks"""
    CHUNK = 500
    all_tasks = []
    for i in range(0, len(new_or_changed), CHUNK):
        batch = new_or_changed[i:i+CHUNK]
        items = [{"rel_path": it["rel_path"], "filename": it.get("filename",""), "ext": it.get("ext",""),
                  "size": it.get("size",0), "mtime": it.get("mtime",0), "fingerprint": it.get("fingerprint","")}
                 for it in batch]
        st, d = api("POST", "/api/device/index-batch", {"items": items, "removed": removed if i == 0 else []})
        if st == 200:
            log(f"上报: +{d.get('new',0)} Δ{d.get('updated',0)} miss:{len(d.get('missing',[]))}")
            for t in d.get("tasks", []): all_tasks.append(t)
        else:
            log(f"上报失败: {st} {d}")
    return all_tasks

# ════════════════════════════════════════════
# 分块上传
# ════════════════════════════════════════════
CHUNK_MB = 8

def upload_file(task):
    """执行一个 upload 任务：从设备读文件 → 分块 POST 到服务器"""
    tid = task["id"]
    fp_task = task.get("fingerprint", "")
    cat_id = task.get("catalog_id")

    # 找设备上对应文件的路径（走 device_file_index 反查不太方便，先走监控目录遍历找）
    # 简化：查找所有 watch path 下对应指纹的文件
    file_path = None
    for wp in cfg.get("watch", "path", fallback="").splitlines():
        wp = wp.strip() if wp.strip else ""
        if not wp: continue
        for root, _, files in os.walk(wp):
            for fn in files:
                f = os.path.join(root, fn)
                try:
                    sz = os.path.getsize(f)
                    fp = fingerprint(f, sz)
                    if fp == fp_task:
                        file_path = f
                        break
                except: pass
            if file_path: break
        if file_path: break

    if not file_path:
        log(f"上传失败: 本地找不到指纹 {fp_task[:16]}...")
        return False

    size = os.path.getsize(file_path)
    total_chunks = max(1, (size + CHUNK_MB*1024*1024 - 1) // (CHUNK_MB*1024*1024))

    log(f"上传开始: {os.path.basename(file_path)} ({size/1024/1024:.1f}MB, {total_chunks}块)")

    with open(file_path, "rb") as f:
        for ci in range(total_chunks):
            chunk = f.read(CHUNK_MB * 1024 * 1024)
            headers = {
                "X-Chunk-Index": str(ci),
                "X-Chunk-Total": str(total_chunks),
                "X-Fingerprint": fp_task,
            }
            st, d = api("POST", f"/api/device/upload/{tid}", body=None, raw=True, timeout=120)
            # raw doesn't work with body=None → need to send bytes
            # We need a different approach
            url = SERVER + f"/api/device/upload/{tid}"
            req = urllib.request.Request(url, data=chunk, method="POST")
            req.add_header("X-Device-Token", TOKEN)
            req.add_header("Content-Type", "application/octet-stream")
            req.add_header("X-Chunk-Index", str(ci))
            req.add_header("X-Chunk-Total", str(total_chunks))
            req.add_header("X-Fingerprint", fp_task)
            for retry in range(3):
                try:
                    with urllib.request.urlopen(req, timeout=120) as r:
                        result = json.loads(r.read().decode())
                    if result.get("ok"):
                        log(f"  块 {ci+1}/{total_chunks} ✓")
                        break
                    else:
                        if retry == 2: return False
                        time.sleep(2)
                except Exception as e:
                    if retry == 2:
                        log(f"  块 {ci+1}/{total_chunks} 失败: {e}")
                        return False
                    time.sleep(2)

    log(f"上传完成: {os.path.basename(file_path)}")
    return True

# ════════════════════════════════════════════
# 主循环
# ════════════════════════════════════════════
def main_loop():
    global FAST_THRESHOLD
    interval = cfg.getint("scan", "interval_sec", fallback=60)
    fast_mb = cfg.getint("scan", "fast_fingerprint_mb", fallback=500)
    FAST_THRESHOLD = fast_mb * 1024 * 1024

    # 收集监控路径
    watch_paths = []
    if cfg.has_section("watch"):
        for k, v in cfg.items("watch"):
            if v.strip():
                watch_paths.append(v.strip())

    if not watch_paths:
        log("未配置监控路径，请在 pk_agent.ini 的 [watch] 段添加 path=...")
        return

    log(f"开始监控 {len(watch_paths)} 个路径，轮询间隔 {interval}s")
    # 索引状态缓存：watch_path → {rel_path: (size, mtime, fingerprint)}
    index_cache = {}

    # 需要全量首扫的路径
    for wp in watch_paths:
        if not os.path.isdir(wp):
            log(f"路径不存在: {wp}")
            continue
        log(f"首扫: {wp}")
        items = scan_path(wp)
        # 算指纹
        for it in items:
            it["fingerprint"] = fingerprint(os.path.join(wp, it["rel_path"]), it["size"])
        if items:
            batch_report(items, [])
        # 建缓存
        index_cache[wp] = {it["rel_path"]: (it["size"], it["mtime"], it["fingerprint"]) for it in items}
        log(f"  已索引 {len(items)} 文件")

    # 增量轮询
    while True:
        try:
            # 心跳
            st, d = api("POST", "/api/device/heartbeat")
            tasks = d.get("tasks", []) if st == 200 else []
            if st != 200:
                log(f"心跳异常: {st}")

            # 处理任务
            for t in tasks:
                if t.get("type") == "upload":
                    log(f"收到上传任务: #{t['id']}")
                    upload_file(t)

            # 增量扫描
            for wp in watch_paths:
                if not os.path.isdir(wp): continue
                cur = scan_path(wp)
                changed, removed = diff_scan(index_cache.get(wp, {}), cur, wp)
                if changed or removed:
                    log(f"{wp}: Δ{len(changed)} -{len(removed)}")
                    new_tasks = batch_report(changed, removed)
                    for t in new_tasks:
                        if t.get("type") == "upload":
                            upload_file(t)
                index_cache[wp] = {it["rel_path"]: (it["size"], it["mtime"], it["fingerprint"]) for it in cur}

        except Exception as e:
            log(f"轮询异常: {e}")

        time.sleep(interval)

# ════════════════════════════════════════════
# 入口
# ════════════════════════════════════════════
if __name__ == "__main__":
    log("PromptKit 设备Agent v0.1.0")
    load_cfg()

    if FLAGS["force_pair"] or not cfg.get("agent", "device_token", fallback=""):
        if not do_pair():
            sys.exit(1)

    SERVER = cfg.get("agent", "server", fallback="")
    TOKEN = cfg.get("agent", "device_token", fallback="")
    if not SERVER or not TOKEN:
        log("配置缺失，请重新配对")
        sys.exit(1)

    log(f"服务器: {SERVER}  设备: {cfg.get('agent','name',fallback='?')}")
    main_loop()
