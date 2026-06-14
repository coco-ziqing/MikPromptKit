"""
数据同步模块 — .pkb 备份包（完整打包/恢复）
- 打包：DB + 缩略图 + 原图 + 视频 → 单一 .pkb ZIP 文件
- 恢复：从 .pkb 还原全部数据
- 管理：列表/删除/清理
"""
import os
import io
import json
import zipfile
import shutil
import time
from datetime import datetime
from typing import Optional

# 路径配置（开发/封装通用）
try:
    from paths import get_data_dir, get_db_path
    DATA_DIR = get_data_dir()
    DB_PATH = get_db_path()
except ImportError:
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    DATA_DIR = os.path.join(BASE_DIR, "data")
    DB_PATH = os.path.join(DATA_DIR, "prompts.db")
PACKAGES_DIR = os.path.join(DATA_DIR, "packages")
THUMB_DIR = os.path.join(DATA_DIR, "thumbnails")
ORIG_DIR = os.path.join(DATA_DIR, "originals")
VIDEO_DIR = os.path.join(DATA_DIR, "videos")

# 保留包数量
MAX_PACKAGES = 20

PKG_EXT = ".pkb"


def _ensure_dirs():
    """确保目录存在"""
    os.makedirs(PACKAGES_DIR, exist_ok=True)
    os.makedirs(THUMB_DIR, exist_ok=True)
    os.makedirs(ORIG_DIR, exist_ok=True)
    os.makedirs(VIDEO_DIR, exist_ok=True)


def _make_pkg_name() -> str:
    """生成包文件名：prompts_20260602_105500.pkb"""
    now = datetime.now()
    return f"prompts_{now.strftime('%Y%m%d_%H%M%S')}{PKG_EXT}"


def _get_db_stats() -> dict:
    """获取数据库统计信息"""
    import sqlite3
    stats = {"prompts": 0, "collections": 0, "wordpacks": 0, "tables": []}
    if not os.path.exists(DB_PATH):
        return stats
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        for r in cur.fetchall():
            stats["tables"].append(r[0])
        cur = conn.execute("SELECT COUNT(*) FROM prompts WHERE deleted_at IS NULL")
        stats["prompts"] = cur.fetchone()[0]
        cur = conn.execute("SELECT COUNT(*) FROM collections")
        stats["collections"] = cur.fetchone()[0]
        cur = conn.execute("SELECT COUNT(*) FROM wordpacks")
        stats["wordpacks"] = cur.fetchone()[0]
        conn.close()
    except Exception:
        pass
    return stats


def _get_media_stats() -> dict:
    """获取媒体文件统计"""
    stats = {"thumbnails": 0, "originals": 0, "videos": 0, "total_bytes": 0}
    for d, key in [(THUMB_DIR, "thumbnails"), (ORIG_DIR, "originals"), (VIDEO_DIR, "videos")]:
        if os.path.isdir(d):
            files = [f for f in os.listdir(d) if os.path.isfile(os.path.join(d, f))]
            stats[key] = len(files)
            stats["total_bytes"] += sum(os.path.getsize(os.path.join(d, f)) for f in files)
    return stats


def _add_dir_to_zip(zf: zipfile.ZipFile, src_dir: str, arc_prefix: str):
    """将目录添加到 ZIP（跳过空目录）"""
    if not os.path.isdir(src_dir):
        return
    for fname in os.listdir(src_dir):
        fpath = os.path.join(src_dir, fname)
        if os.path.isfile(fpath):
            arcname = f"{arc_prefix}/{fname}"
            zf.write(fpath, arcname)


def _safe_copy(src: str, dst: str):
    """安全复制文件"""
    try:
        shutil.copy2(src, dst)
        return True
    except Exception:
        return False


# ============ 打包 ============

def export_package(name: Optional[str] = None, include_media: bool = True) -> dict:
    """
    导出完整 .pkb 包
    :param name: 包名（不含扩展名），None 自动生成
    :param include_media: 是否包含媒体文件
    :return: {"ok": bool, "file": str, "size": int, "stats": dict}
    """
    _ensure_dirs()

    if not os.path.exists(DB_PATH):
        return {"ok": False, "error": "数据库文件不存在"}

    pkg_name = (name or _make_pkg_name()).rstrip(PKG_EXT) + PKG_EXT
    pkg_path = os.path.join(PACKAGES_DIR, pkg_name)

    try:
        # 收集统计信息
        db_stats = _get_db_stats()
        media_stats = _get_media_stats()

        # 创建 ZIP
        with zipfile.ZipFile(pkg_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            # 1. 写入 manifest.json
            manifest = {
                "version": "1.0",
                "created_at": datetime.now().isoformat(),
                "app": "PromptKit",
                "db": {
                    "file": "prompts.db",
                    "size": os.path.getsize(DB_PATH),
                    "stats": db_stats
                },
                "media": {
                    "included": include_media,
                    "stats": media_stats
                },
                "files": []
            }

            # 2. 写入数据库
            zf.write(DB_PATH, "prompts.db")
            manifest["files"].append("prompts.db")

            # 3. 写入媒体文件
            if include_media:
                _add_dir_to_zip(zf, THUMB_DIR, "thumbnails")
                _add_dir_to_zip(zf, ORIG_DIR, "originals")
                _add_dir_to_zip(zf, VIDEO_DIR, "videos")
                manifest["files"].append("thumbnails/")
                manifest["files"].append("originals/")
                manifest["files"].append("videos/")

            # 4. 写入 manifest
            zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
            manifest["files"].append("manifest.json")

        pkg_size = os.path.getsize(pkg_path)

        # 清理旧包
        _cleanup_packages()

        return {
            "ok": True,
            "file": pkg_name,
            "path": pkg_path,
            "size": pkg_size,
            "stats": {
                "db": db_stats,
                "media": media_stats,
                "total_size": pkg_size
            }
        }

    except Exception as e:
        return {"ok": False, "error": str(e)}


# ============ 恢复 ============

def restore_package(pkg_name: str, backup_first: bool = True) -> dict:
    """
    从 .pkb 包恢复数据
    :param pkg_name: 包文件名（含 .pkb 扩展名）
    :param backup_first: 恢复前是否备份当前数据
    :return: {"ok": bool, "restored": list, "error": str}
    """
    _ensure_dirs()

    pkg_path = os.path.join(PACKAGES_DIR, pkg_name)
    if not os.path.isfile(pkg_path):
        return {"ok": False, "error": f"包文件不存在: {pkg_name}"}

    # 备份当前数据
    if backup_first and os.path.exists(DB_PATH):
        from backup import do_backup as backup_db
        try:
            backup_db()
        except Exception:
            pass

    restored = []
    errors = []

    try:
        with zipfile.ZipFile(pkg_path, 'r') as zf:
            namelist = zf.namelist()

            # 1. 检查 manifest
            if "manifest.json" in namelist:
                manifest = json.loads(zf.read("manifest.json"))
                restored.append("manifest.json")

            # 2. 恢复数据库
            if "prompts.db" in namelist:
                # 关闭当前连接，替换文件
                try:
                    from database import close_db
                    close_db()
                except Exception:
                    pass
                # 写入
                tmp_path = DB_PATH + ".restore_tmp"
                with open(tmp_path, 'wb') as f:
                    f.write(zf.read("prompts.db"))
                shutil.move(tmp_path, DB_PATH)
                restored.append("prompts.db")

                # 清理 WAL/SHM 遗留文件
                for ext in [".db-wal", ".db-shm"]:
                    fpath = DB_PATH + ext
                    if os.path.exists(fpath):
                        try:
                            os.remove(fpath)
                        except Exception:
                            pass

            # 3. 恢复缩略图
            for fname in namelist:
                if fname.startswith("thumbnails/") and fname.count('/') == 1:
                    out_path = os.path.join(THUMB_DIR, os.path.basename(fname))
                    with open(out_path, 'wb') as f:
                        f.write(zf.read(fname))
                    restored.append(fname)
                elif fname.startswith("originals/") and fname.count('/') == 1:
                    out_path = os.path.join(ORIG_DIR, os.path.basename(fname))
                    with open(out_path, 'wb') as f:
                        f.write(zf.read(fname))
                    restored.append(fname)
                elif fname.startswith("videos/") and fname.count('/') == 1:
                    out_path = os.path.join(VIDEO_DIR, os.path.basename(fname))
                    with open(out_path, 'wb') as f:
                        f.write(zf.read(fname))
                    restored.append(fname)

            # 4. 确保数据库重新初始化
            try:
                from database import init_db, get_db
                init_db()
            except Exception:
                pass

        return {
            "ok": True,
            "restored": restored,
            "count": len(restored),
            "errors": errors if errors else None
        }

    except Exception as e:
        return {"ok": False, "error": str(e)}


# ============ 上传导入 ============

def import_package(data: bytes, filename: str) -> dict:
    """
    上传导入 .pkb 包（内存数据）
    :param data: ZIP 二进制数据
    :param filename: 原始文件名
    :return: {"ok": bool, "saved_as": str, ...}
    """
    _ensure_dirs()

    # 验证是否为合法 ZIP
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            if "prompts.db" not in zf.namelist():
                return {"ok": False, "error": "无效的 .pkb 包：缺少 prompts.db"}
            if "manifest.json" not in zf.namelist():
                return {"ok": False, "error": "无效的 .pkb 包：缺少 manifest.json"}
    except zipfile.BadZipFile:
        return {"ok": False, "error": "无效的 ZIP 文件"}

    # 保存到 packages 目录
    save_name = os.path.basename(filename).rstrip(PKG_EXT) + PKG_EXT
    save_path = os.path.join(PACKAGES_DIR, save_name)

    # 避免重名
    if os.path.exists(save_path):
        base, ext = os.path.splitext(save_name)
        i = 1
        while os.path.exists(os.path.join(PACKAGES_DIR, f"{base}_{i}{ext}")):
            i += 1
        save_name = f"{base}_{i}{ext}"
        save_path = os.path.join(PACKAGES_DIR, save_name)

    try:
        with open(save_path, 'wb') as f:
            f.write(data)

        _cleanup_packages()

        return {
            "ok": True,
            "saved_as": save_name,
            "size": len(data)
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ============ 列表/管理 ============

def list_packages() -> list:
    """列出所有 .pkb 包"""
    _ensure_dirs()
    packages = []
    if not os.path.isdir(PACKAGES_DIR):
        return packages

    for fname in os.listdir(PACKAGES_DIR):
        if not fname.endswith(PKG_EXT):
            continue
        fpath = os.path.join(PACKAGES_DIR, fname)
        if not os.path.isfile(fpath):
            continue
        mtime = os.path.getmtime(fpath)
        size = os.path.getsize(fpath)

        # 读取 manifest 摘要
        manifest_summary = {}
        try:
            with zipfile.ZipFile(fpath, 'r') as zf:
                if "manifest.json" in zf.namelist():
                    m = json.loads(zf.read("manifest.json"))
                    manifest_summary = {
                        "version": m.get("version"),
                        "created_at": m.get("created_at"),
                        "prompts": m.get("db", {}).get("stats", {}).get("prompts", 0),
                        "media_included": m.get("media", {}).get("included", False),
                        "media_files": m.get("media", {}).get("stats", {})
                    }
        except Exception:
            pass

        packages.append({
            "name": fname,
            "path": fpath,
            "size": size,
            "size_str": _format_size(size),
            "mtime": datetime.fromtimestamp(mtime).isoformat(),
            "manifest": manifest_summary
        })

    packages.sort(key=lambda x: x["mtime"], reverse=True)
    return packages


def delete_package(pkg_name: str) -> dict:
    """删除一个 .pkb 包"""
    pkg_path = os.path.join(PACKAGES_DIR, pkg_name)
    if not os.path.isfile(pkg_path):
        return {"ok": False, "error": f"包不存在: {pkg_name}"}
    try:
        os.remove(pkg_path)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _cleanup_packages():
    """清理超出数量的旧包"""
    packages = list_packages()
    if len(packages) <= MAX_PACKAGES:
        return 0
    to_remove = packages[MAX_PACKAGES:]
    removed = 0
    for p in to_remove:
        try:
            os.remove(p["path"])
            removed += 1
        except Exception:
            pass
    return removed


def get_package_info(pkg_name: str) -> dict:
    """获取单个包详细信息"""
    pkg_path = os.path.join(PACKAGES_DIR, pkg_name)
    if not os.path.isfile(pkg_path):
        return {"ok": False, "error": "包不存在"}

    try:
        with zipfile.ZipFile(pkg_path, 'r') as zf:
            namelist = zf.namelist()
            # 列出所有文件大小
            files = []
            for n in namelist:
                info = zf.getinfo(n)
                files.append({
                    "name": n,
                    "size": info.file_size,
                    "compress_size": info.compress_size,
                    "ratio": round((1 - info.compress_size / info.file_size) * 100, 1) if info.file_size > 0 else 0
                })

            manifest = {}
            if "manifest.json" in namelist:
                manifest = json.loads(zf.read("manifest.json"))

        return {
            "ok": True,
            "name": pkg_name,
            "size": os.path.getsize(pkg_path),
            "size_str": _format_size(os.path.getsize(pkg_path)),
            "files": files,
            "file_count": len(files),
            "manifest": manifest
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _format_size(size_bytes: int) -> str:
    """格式化文件大小"""
    if size_bytes < 1024:
        return f"{size_bytes}B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f}KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / 1024 / 1024:.1f}MB"
    else:
        return f"{size_bytes / 1024 / 1024 / 1024:.1f}GB"
