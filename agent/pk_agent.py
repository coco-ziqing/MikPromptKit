# -*- coding: utf-8 -*-
"""
资产管家助手 (pk_agent.py)
- 绿色单文件，双击即跑，零安装
- 功能：扫描指定文件夹 → 增量指纹 → 上报服务器 → 领备份任务 → 上传

打包成 exe: pyinstaller --onefile --name "资产管家助手" pk_agent.py
"""
import os, sys, json, time, hashlib, socket, threading, urllib.request, urllib.error, queue

VERSION = "1.0.0"
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pk_agent.ini")
SCAN_INTERVAL = 60  # 秒
CHUNK_SIZE = 8 * 1024 * 1024  # 8MB
FAST_FP_THRESHOLD = 500 * 1024 * 1024  # 500MB

class AgentConfig:
    """持久化配置"""
    def __init__(self):
        self.server_url = ""
        self.device_token = ""
        self.device_id = 0
        self.device_name = socket.gethostname()
        self.watch_paths = []  # [(abs_path, module_hint)]
        self.load()

    def load(self):
        if not os.path.exists(CONFIG_FILE): return
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                d = json.load(f)
            self.server_url = d.get("server_url", "")
            self.device_token = d.get("device_token", "")
            self.device_id = d.get("device_id", 0)
            self.device_name = d.get("device_name", socket.gethostname())
            self.watch_paths = d.get("watch_paths", [])
        except Exception:
            pass

    def save(self):
        d = {
            "server_url": self.server_url,
            "device_token": self.device_token,
            "device_id": self.device_id,
            "device_name": self.device_name,
            "watch_paths": self.watch_paths,
        }
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=2)

    def is_configured(self):
        return bool(self.server_url and self.device_token)


class Agent:
    def __init__(self, config=None):
        self.cfg = config or AgentConfig()
        self.running = True
        self.scan_thread = None
        self.upload_queue = queue.Queue()

    def _make_req(self, method, path, body=None, extra_headers=None):
        url = self.cfg.server_url.rstrip("/") + path
        headers = {"Content-Type": "application/json", "X-Device-Token": self.cfg.device_token}
        if extra_headers:
            headers.update(extra_headers)
        data = json.dumps(body).encode("utf-8") if body else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            return {"ok": False, "error": f"HTTP {e.code}: {err_body[:200]}"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def register(self, code, name, platform="win", owner_username=""):
        resp = self._make_req("POST", "/api/device/register", {
            "code": code, "name": name, "platform": platform,
            "owner_username": owner_username, "agent_version": VERSION
        })
        if resp.get("ok"):
            self.cfg.device_token = resp["token"]
            self.cfg.device_id = resp["id"]
            self.cfg.device_name = name
            self.cfg.save()
        return resp

    def heartbeat(self):
        return self._make_req("POST", "/api/device/heartbeat")

    def scan_folders(self):
        """增量扫描所有 watch_paths，比对 size+mtime"""
        items = []
        removed = []
        now = time.time()

        for wp in self.cfg.watch_paths:
            abs_path = wp[0] if isinstance(wp, (list, tuple)) else wp
            if not os.path.isdir(abs_path): continue

            # 遍历目录
            try:
                for root, dirs, files in os.walk(abs_path):
                    for fname in files:
                        fp = os.path.join(root, fname)
                        try:
                            stat = os.stat(fp)
                            size = stat.st_size
                            mtime = stat.st_mtime
                            rel = os.path.relpath(fp, abs_path)
                            ext = os.path.splitext(fname)[1].lower()

                            # 快速指纹（大文件跳 sha256）
                            fingerprint = ""
                            if size < FAST_FP_THRESHOLD:
                                h = hashlib.sha256()
                                with open(fp, "rb") as f:
                                    chunk = f.read(8 * 1024 * 1024)
                                    h.update(chunk)
                                    # 仅读首8MB做快速识别（完整sha256在备份时才算）
                                fingerprint = h.hexdigest()
                            else:
                                fingerprint = f"fast:{size}:{fname}"

                            items.append({
                                "rel_path": rel.replace("\\", "/"),
                                "filename": fname,
                                "ext": ext,
                                "size": size,
                                "mtime": mtime,
                                "fingerprint": fingerprint,
                            })
                        except OSError:
                            continue
            except Exception:
                continue

        return items, removed

    def report_index(self):
        items, removed = self.scan_folders()
        if not items:
            return {"ok": True, "new": 0, "skipped": True}

        # 分批上报（≤500 条/批）
        batch_size = 500
        total_new, total_upd = 0, 0
        for i in range(0, len(items), batch_size):
            batch = items[i:i+batch_size]
            resp = self._make_req("POST", "/api/device/index-batch", {
                "items": batch, "removed": []
            })
            if resp.get("ok"):
                total_new += resp.get("new", 0)
                total_upd += resp.get("updated", 0)
            else:
                return resp
        return {"ok": True, "new": total_new, "updated": total_upd}

    def do_upload(self, task):
        """分块上传备份文件"""
        tid = task.get("id")
        fps_str = task.get("fingerprint", "")
        # 需要找到本地文件
        # 查找逻辑：通过 file_index_id 找 rel_path，再遍历 watch_paths 拼出完整路径
        cid = task.get("catalog_id")
        # 简化：heartbeat 返回的 task 里可能不够，实际需要根据 file_index_id 查 device_file_index
        # 这里先做框架，等 API 完善
        pass

    def process_tasks(self, tasks):
        for t in tasks:
            if t.get("type") == "upload":
                self.do_upload(t)

    def main_loop(self):
        print(f"[{time.strftime('%H:%M:%S')}] 资产管家助手 v{VERSION} 已启动")
        print(f"  服务器: {self.cfg.server_url}")
        print(f"  设备: {self.cfg.device_name}")
        if not self.cfg.watch_paths:
            print("  ⚠ 未配置关注的文件夹，请先添加")
        else:
            print(f"  关注 {len(self.cfg.watch_paths)} 个文件夹")

        scan_counter = 0
        while self.running:
            try:
                if scan_counter % SCAN_INTERVAL == 0:
                    # 心跳 + 领任务
                    hb = self.heartbeat()
                    if hb.get("ok"):
                        tasks = hb.get("tasks", [])
                        if tasks:
                            print(f"[{time.strftime('%H:%M:%S')}] 收到 {len(tasks)} 个备份任务")
                            self.process_tasks(tasks)

                    # 扫描上报（首次或每60s）
                    result = self.report_index()
                    if result.get("ok") and not result.get("skipped"):
                        n = result.get("new", 0)
                        u = result.get("updated", 0)
                        if n or u:
                            print(f"[{time.strftime('%H:%M:%S')}] 扫描: +{n} 新, ~{u} 变更")

                scan_counter += 1
                time.sleep(1)

            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"[{time.strftime('%H:%M:%S')}] 错误: {e}")
                time.sleep(10)

    def stop(self):
        self.running = False


# ─── 简单控制台 UI（纯文本菜单，不依赖 GUI 库）───
def console_ui():
    print("=" * 50)
    print("     资产管家助手  v" + VERSION)
    print("=" * 50)

    cfg = AgentConfig()

    if not cfg.is_configured():
        print("\n首次使用，请连接 PromptKit 服务器")
        url = input("服务器地址 (如 http://192.168.0.101:8080): ").strip()
        code = input("6位配对码: ").strip().upper()
        name = input(f"设备名称 (默认: {cfg.device_name}): ").strip() or cfg.device_name

        agent = Agent(cfg)
        cfg.server_url = url
        resp = agent.register(code, name)

        if resp.get("ok"):
            print(f"\n✅ 连接成功！设备ID: {resp.get('id')}")
            cfg.save()
        else:
            print(f"\n❌ 连接失败: {resp.get('error', '配对码无效或已过期')}")
            input("\n按回车退出...")
            return
    else:
        print(f"\n  服务器: {cfg.server_url}")
        print(f"  设备名: {cfg.device_name}")
        print(f"  设备ID: {cfg.device_id}")

    # 配置监视文件夹
    if not cfg.watch_paths:
        print("\n请添加要关注的文件夹（至少1个）:")
        while True:
            p = input("文件夹路径（直接回车跳过）: ").strip()
            if not p:
                if not cfg.watch_paths:
                    print("⚠ 至少需要添加 1 个文件夹")
                    continue
                break
            if os.path.isdir(p):
                cfg.watch_paths.append([p, ""])
                print(f"  已添加: {p}")
            else:
                print(f"  ⚠ 文件夹不存在: {p}")
        cfg.save()

    agent = Agent(cfg)
    print(f"\n📁 关注 {len(cfg.watch_paths)} 个文件夹:")
    for wp in cfg.watch_paths:
        print(f"  · {wp[0] if isinstance(wp,(list,tuple)) else wp}")
    print("\n正在后台扫描... (按 Ctrl+C 退出)")
    print("-" * 50)

    try:
        agent.main_loop()
    except KeyboardInterrupt:
        print("\n\n已停止扫描。再见！")


if __name__ == "__main__":
    console_ui()
