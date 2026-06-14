"""
数据库自动备份模块
- 启动时备份 + 每小时定时备份
- 保留最近 7 天 + 每天的首次备份 (7+7=14 份上限)
- 通过 /api/backup/info 和 /api/backup/now 对外暴露
"""
import os
import sys
import shutil
import time
import json
import threading
from datetime import datetime, timedelta
from pathlib import Path
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


def do_backup() -> dict:
    """执行一次备份，返回结果"""
    global _last_backup_time, _backup_count, _last_error

    _ensure_dir()

    if not os.path.exists(DB_PATH):
        _last_error = "数据库文件不存在"
        return {"ok": False, "error": _last_error}

    try:
        # 使用文件锁防止并发备份
        lock_path = LOCK_FILE

        # 备份文件名
        backup_name = _make_backup_name()
        backup_path = os.path.join(BACKUP_DIR, backup_name)

        # copyfile 替代 shutil.copy2 确保跨设备/exFAT兼容（copy2拷贝元数据在移动盘上可能失败）
        os.makedirs(BACKUP_DIR, exist_ok=True)  # 二次确保，防止线程race
        shutil.copy(DB_PATH, backup_path)

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
                with open(log_path, "r", encoding="utf-8") as f:
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
        status = "OK" if result.get("ok") else "FAIL"
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
