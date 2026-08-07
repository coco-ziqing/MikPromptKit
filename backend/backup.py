"""
数据库自动备份模块
- 启动时备份 + 每小时定时备份
- 保留最近 7 天 + 每天的首次备份 (7+7=14 份上限)
- 通过 /api/backup/info 和 /api/backup/now 对外暴露
"""
import json
import os
import threading
import time
from datetime import datetime

from paths import get_base_dir, get_data_dir, get_db_path

BASE_DIR = get_base_dir()
BACKUP_DIR = os.path.join(get_data_dir(), 'backups')
DB_PATH = get_db_path()
LOCK_FILE = os.path.join(BACKUP_DIR, ".backup.lock")

# 保留天数
KEEP_DAYS = 7
# 每小时备份间隔（秒）
BACKUP_INTERVAL = 3600

# 运行时状态
_last_backup_time = None
_backup_count = 0
_last_error = None
_timer = None


def _ensure_dir():
    """确保备份目录存在"""
    os.makedirs(BACKUP_DIR, exist_ok=True)


def _make_backup_name():
    """生成带时间戳的备份文件名"""
    now = datetime.now()
    return f"prompts_{now.strftime('%Y%m%d_%H%M%S')}.db"


def _get_backup_files():
    """获取所有备份文件列表（按时间倒序）"""
    if not os.path.isdir(BACKUP_DIR):
        return []
    files = []
    for f in os.listdir(BACKUP_DIR):
        if f.startswith("prompts_") and f.endswith(".db"):
            fpath = os.path.join(BACKUP_DIR, f)
            files.append({
                "name": f,
                "path": fpath,
                "size": os.path.getsize(fpath),
                "mtime": os.path.getmtime(fpath),
                "date": datetime.fromtimestamp(os.path.getmtime(fpath)).isoformat()
            })
    files.sort(key=lambda x: x["mtime"], reverse=True)
    return files


def _cleanup_old_backups():
    """清理过期备份：保留最近 7 天 + 每天最早的 1 份"""
    if not os.path.isdir(BACKUP_DIR):
        return 0
    cutoff = time.time() - KEEP_DAYS * 86400
    removed = 0

    # 按天分组
    daily_files = {}
    for f in os.listdir(BACKUP_DIR):
        if not f.startswith("prompts_") or not f.endswith(".db"):
            continue
        fpath = os.path.join(BACKUP_DIR, f)
        mtime = os.path.getmtime(fpath)
        day_key = datetime.fromtimestamp(mtime).strftime("%Y%m%d")

        if mtime < cutoff:
            # 超过 7 天的删除
            try:
                os.remove(fpath)
                removed += 1
            except OSError:
                pass
        else:
            if day_key not in daily_files:
                daily_files[day_key] = []
            daily_files[day_key].append((mtime, fpath))

    # 每天只保留最早（最旧）那天的多个备份中的第一个
    # 实际含义：同一天内的备份只保留 1 个+最近7天
    # 按天保留最新一份
    for day, files in daily_files.items():
        if len(files) > 1:
            files.sort(key=lambda x: x[0])  # 按时间升序
            for _, fpath in files[:-1]:  # 保留最后一个（最新）
                try:
                    os.remove(fpath)
                    removed += 1
                except OSError:
                    pass
    return removed


def _wal_checkpoint():
    """WAL 回写合并 — 独立连接，PASSIVE 不阻塞读写，TRUNCATE 清理 WAL 文件"""
    import sqlite3 as _sqlite3
    conn = None
    try:
        conn = _sqlite3.connect(DB_PATH, timeout=5)
        conn.execute("PRAGMA busy_timeout=3000")
        # 先用 PASSIVE 合并已提交页（不阻塞）
        result = conn.execute("PRAGMA wal_checkpoint(PASSIVE)").fetchone()
        # 如果 WAL 页≤32，再用 TRUNCATE 彻底清理 WAL 文件，释放磁盘
        if result and result[2] is not None and result[2] <= 32:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        return True
    except Exception:
        return False
    finally:
        if conn:
            try: conn.close()
            except Exception: pass


def _backup_snapshot(backup_path):
    """SQLite 在线备份 API — 生成一致性快照（WAL 写负载下也安全）

    2026-08-03 修复：原 shutil.copy 直接复制主库 .db 文件，
    WAL 模式下若 checkpoint/写入并发，复制产物会撕裂 → integrity_check 报 malformed
    （启动时语义索引重建 897+ pages 写库即触发）。
    sqlite3.Connection.backup() 基于 SQLite Online Backup API，
    在快照层面保证一致性，不受并发写影响，也无需先 checkpoint。
    """
    import sqlite3 as _sqlite3
    src = None
    dst = None
    try:
        src = _sqlite3.connect(DB_PATH, timeout=10)
        dst = _sqlite3.connect(backup_path, timeout=10)
        src.backup(dst)
        return True
    except Exception:
        # 失败时清理半成品，避免坏产物留在备份目录
        try:
            if os.path.exists(backup_path):
                os.remove(backup_path)
        except OSError:
            pass
        raise
    finally:
        if dst:
            try: dst.close()
            except Exception: pass
        if src:
            try: src.close()
            except Exception: pass


def _pid_alive(pid: int) -> bool:
    """检查进程是否存活（跨平台；权限不足视为存活）"""
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True  # 进程存在但无权限访问（Windows Access Denied）
    except OSError:
        return False


class _BackupLock:
    """跨线程/跨进程互斥锁（进程内 threading.Lock + 文件锁 O_EXCL）

    2026-08-03 修复: ① 原代码声明了 lock_path 却从未真正加锁，
    定时备份与手动 /api/backup/now 并发时可能同时 checkpoint + 写备份目录。
    ② 锁文件含持有者 PID，获取时检测 PID 存活：进程崩溃/kill 后锁立即失效
    （原实现只靠 mtime>30 分钟僵死检测，服务被杀后 30 分钟内备份会被跳过）。
    """
    _inner = threading.Lock()
    _STALE_SECONDS = 1800

    def __enter__(self):
        self._inner.acquire()
        _ensure_dir()
        for _ in range(5):
            try:
                fd = os.open(LOCK_FILE, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, str(os.getpid()).encode())
                os.close(fd)
                self._held = True
                return self
            except FileExistsError:
                # 锁已存在：检查持有者进程是否存活 / 是否超时僵死
                owner_dead = False
                try:
                    with open(LOCK_FILE, encoding='utf-8', errors='replace') as lf:
                        content = lf.read().strip()
                    if content.isdigit():
                        owner_dead = not _pid_alive(int(content))
                except OSError:
                    pass
                stale = time.time() - os.path.getmtime(LOCK_FILE) > self._STALE_SECONDS
                if owner_dead or stale:
                    try:
                        os.remove(LOCK_FILE)
                    except OSError:
                        pass
                    continue
                # 锁被占用：等待后重试
                self._inner.release()
                time.sleep(1)
                self._inner.acquire()
        raise RuntimeError("无法获取备份锁（另一备份正在进行或锁文件僵死）")

    def __exit__(self, *exc):
        try:
            if getattr(self, "_held", False):
                os.remove(LOCK_FILE)
        except OSError:
            pass
        self._inner.release()
        return False


def _check_db_health(db_path=None, max_detail=200):
    """数据库健康校验：PRAGMA integrity_check

    2026-08-02 加固：备份前必须校验源库，防止把损坏库备份进历史。
    已知坑：Python 3.14 + SQLite 3.50 在损坏库上会把乱码二进制当错误消息返回，
    解码失败抛 UnicodeDecodeError（极具误导性），必须整体兜底捕获。

    返回 (ok: bool, detail: str|None)
    """
    import sqlite3 as _sqlite3
    target = db_path or DB_PATH
    conn = None
    try:
        conn = _sqlite3.connect(target, timeout=5)
        rows = conn.execute("PRAGMA integrity_check").fetchall()
        if len(rows) == 1 and rows[0][0] == "ok":
            return True, None
        # 失败：收集前几条错误，截断防乱码刷屏
        detail = "; ".join(str(r[0])[:max_detail] for r in rows[:5])
        return False, detail or "unknown error"
    except UnicodeDecodeError:
        # 库损坏时 SQLite 错误消息含乱码二进制 → UTF-8 解码失败
        return False, "UnicodeDecodeError（数据库文件可能已损坏）"
    except Exception as e:
        return False, f"{type(e).__name__}: {str(e)[:max_detail]}"
    finally:
        if conn:
            try: conn.close()
            except Exception: pass


def do_backup() -> dict:
    """执行一次备份，返回结果"""
    global _last_backup_time, _backup_count, _last_error

    _ensure_dir()

    if not os.path.exists(DB_PATH):
        _last_error = "数据库文件不存在"
        return {"ok": False, "error": _last_error}

    try:
        # ===== 修复(2026-08-03): 文件锁真正生效，防并发备份 =====
        with _BackupLock():
            # WAL 回写（保持 WAL 文件精简；快照一致性已由 backup API 保证，不再依赖此步）
            _wal_checkpoint()

            # ===== 加固(2026-08-02): 备份前校验源库健康度 =====
            # 历史教训: 7/30、7/31 备份的都是坏库（malformed），带病备份毫无意义
            ok, err = _check_db_health(DB_PATH)
            if not ok:
                _last_error = f"备份中止: 源库健康校验失败 - {err}"
                print(f"[备份] 中止: {_last_error}")
                return {"ok": False, "error": _last_error, "skipped": True}

            # 备份文件名
            backup_name = _make_backup_name()
            backup_path = os.path.join(BACKUP_DIR, backup_name)

            # ===== 修复(2026-08-03): 在线备份 API 替代 shutil.copy =====
            # 裸复制在 WAL 写负载下会撕裂产物（启动时语义重建即触发 malformed）
            os.makedirs(BACKUP_DIR, exist_ok=True)  # 二次确保，防止线程race
            _backup_snapshot(backup_path)

            # ===== 加固(2026-08-02): 备份后校验产物，坏备份不入库 =====
            ok2, err2 = _check_db_health(backup_path)
            if not ok2:
                try:
                    os.remove(backup_path)
                except OSError:
                    pass
                _last_error = f"备份产物校验失败，已删除: {err2}"
                print(f"[备份] 产物校验失败: {err2}")
                return {"ok": False, "error": _last_error, "skipped": True}

            # 清理旧备份
            removed = _cleanup_old_backups()

            _last_backup_time = time.time()
            _backup_count += 1
            _last_error = None

            # 写入备份日志
            log_path = os.path.join(BACKUP_DIR, "backup_history.json")
            history = []
            if os.path.exists(log_path):
                try:
                    with open(log_path, encoding="utf-8") as f:
                        history = json.load(f)
                except Exception:
                    history = []
            history.append({
                "time": datetime.now().isoformat(),
                "file": backup_name,
                "size": os.path.getsize(backup_path),
                "kept": True
            })
            # 只保留最近 100 条记录
            if len(history) > 100:
                history = history[-100:]
            with open(log_path, "w", encoding="utf-8") as f:
                json.dump(history, f, ensure_ascii=False, indent=2)

            return {
                "ok": True,
                "file": backup_name,
                "size": os.path.getsize(backup_path),
                "removed": removed
            }

    except Exception as e:
        _last_error = str(e)
        return {"ok": False, "error": _last_error}


def get_backup_info() -> dict:
    """获取备份状态信息"""
    global _last_backup_time, _backup_count, _last_error

    files = _get_backup_files()
    total_size = sum(f["size"] for f in files)
    backup_dir_size = 0
    if os.path.isdir(BACKUP_DIR):
        for f in os.listdir(BACKUP_DIR):
            fpath = os.path.join(BACKUP_DIR, f)
            if os.path.isfile(fpath):
                backup_dir_size += os.path.getsize(fpath)

    return {
        "ok": True,
        "db_path": DB_PATH,
        "db_exists": os.path.exists(DB_PATH),
        "db_size": os.path.getsize(DB_PATH) if os.path.exists(DB_PATH) else 0,
        "backup_dir": BACKUP_DIR,
        "backup_dir_exists": os.path.isdir(BACKUP_DIR),
        "backup_dir_size": backup_dir_size,
        "total_backups": len(files),
        "total_size": total_size,
        "last_backup_time": _last_backup_time,
        "last_backup_time_str": datetime.fromtimestamp(_last_backup_time).isoformat() if _last_backup_time else None,
        "backup_count_today": _backup_count,
        "last_error": _last_error,
        "keep_days": KEEP_DAYS,
        "recent_backups": files[:10]  # 最近 10 条
    }


# ============ 定时任务 ============

def _scheduler():
    """定时备份调度器"""
    global _timer
    try:
        result = do_backup()
        if not result.get("ok"):
            print(f"[备份] 定时备份失败: {result.get('error')}")
        else:
            print(f"[备份] 定时备份完成: {result.get('file')} ({result.get('size')//1024}KB)")
            if result.get("removed", 0) > 0:
                print(f"[备份] 清理了 {result['removed']} 个旧备份")
    except Exception as e:
        print(f"[备份] 定时备份异常: {e}")

    # 重新调度
    _timer = threading.Timer(BACKUP_INTERVAL, _scheduler)
    _timer.daemon = True
    _timer.start()


def start_auto_backup():
    """启动时调用：立即备份一次 + 启动定时器"""
    global _timer

    _ensure_dir()
    print(f"[备份] 目录: {BACKUP_DIR}")
    print(f"[备份] 策略: 每小时备份一次，保留 {KEEP_DAYS} 天")

    # 首次立即备份（异步）
    def first_backup():
        os.makedirs(BACKUP_DIR, exist_ok=True)  # 线程抢跑确保
        result = do_backup()
        print("[备份] 启动备份: " + str(result.get("file", result.get("error", "unknown"))))

    t = threading.Thread(target=first_backup, daemon=True)
    t.start()

    # 启动定时器
    if _timer is None:
        _timer = threading.Timer(BACKUP_INTERVAL, _scheduler)
        _timer.daemon = True
        _timer.start()
        print(f"[备份] 定时器已启动（间隔 {BACKUP_INTERVAL//60} 分钟）")


def stop_auto_backup():
    """停止定时备份"""
    global _timer
    if _timer:
        _timer.cancel()
        _timer = None
        print("[备份] 定时器已停止")


if __name__ == "__main__":
    # 测试
    print("=== 备份模块测试 ===")
    print(f"DB: {DB_PATH}")
    print(f"Backup dir: {BACKUP_DIR}")
    print(f"DB exists: {os.path.exists(DB_PATH)}")

    result = do_backup()
    print(f"Backup result: {result}")

    info = get_backup_info()
    print(f"Info: {json.dumps(info, indent=2, default=str)[:500]}")
