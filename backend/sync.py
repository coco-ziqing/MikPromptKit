"""
数据同步模块 — .pkb 备份包（完整打包/恢复）
- 打包：DB + 缩略图 + 原图 + 视频 → 单一 .pkb ZIP 文件
- 恢复：从 .pkb 还原全部数据
- 管理：列表/删除/清理
- 改进：智能压缩 / verify 端点 / 包列表快速扫描
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

# 保留包数量（20×800MB=16GB 太大，限5个）
MAX_PACKAGES = 5
PKG_EXT = ".pkb"

# 已压缩格式后缀——ZIP_STORED 节省 CPU，ZIP_DEFLATED 只用于 DB
_COMPRESSED_EXT = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp",
                   ".mp4", ".webm", ".mov", ".avi", ".mkv")


def _ensure_dirs():
    """确保目录存在"""
    os.makedirs(PACKAGES_DIR, exist_ok=True)
    os.makedirs(THUMB_DIR, exist_ok=True)
    os.makedirs(ORIG_DIR, exist_ok=True)
    os.makedirs(VIDEO_DIR, exist_ok=True)


def _make_pkg_name() -> str:
    """生成包文件名"""
    now = datetime.now()
    return f"prompts_{now.strftime('%Y%m%d_%H%M%S')}{PKG_EXT}"


def _get_compress_mode(filename: str) -> int:
    """智能压缩：已压缩媒体用 STORED，DB 用 DEFLATED"""
    ext = os.path.splitext(filename)[1].lower()
    if ext in _COMPRESSED_EXT:
        return zipfile.ZIP_STORED
    return zipfile.ZIP_DEFLATED


def _add_file_to_zip(zf: zipfile.ZipFile, src: str, arcname: str):
    """写入单个文件（自动选择压缩模式）"""
    compress = _get_compress_mode(arcname)
    zf.write(src, arcname, compress_type=compress)


def _add_dir_to_zip(zf: zipfile.ZipFile, src_dir: str, arc_prefix: str):
    """将目录添加到 ZIP"""
    if not os.path.isdir(src_dir):
        return
    for fname in sorted(os.listdir(src_dir)):
        fpath = os.path.join(src_dir, fname)
        if os.path.isfile(fpath):
            arcname = f"{arc_prefix}/{fname}"
            _add_file_to_zip(zf, fpath, arcname)


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


def _read_manifest_fast(pkg_path: str) -> dict:
    """快速读取 .pkb 包的 manifest 摘要（只读 ZIP 目录，不解压全部）"""
    try:
        with zipfile.ZipFile(pkg_path, 'r') as zf:
            if "manifest.json" in zf.namelist():
                return json.loads(zf.read("manifest.json"))
    except Exception:
        pass
    return {}


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
        db_stats = _get_db_stats()
        media_stats = _get_media_stats()
        start_t = time.time()

        with zipfile.ZipFile(pkg_path, 'w', zipfile.ZIP_STORED) as zf:
            manifest = {
                "version": "1.1",
                "created_at": datetime.now().isoformat(),
                "elapsed_sec": 0,  # 填入
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

            # 写入 DB（压缩）
            _add_file_to_zip(zf, DB_PATH, "prompts.db")
            manifest["files"].append("prompts.db")

            # 写入媒体文件（STORED，不浪费 CPU 压缩已压数据）
            if include_media:
                _add_dir_to_zip(zf, THUMB_DIR, "thumbnails")
                _add_dir_to_zip(zf, ORIG_DIR, "originals")
                _add_dir_to_zip(zf, VIDEO_DIR, "videos")
                manifest["files"].append("thumbnails/")
                manifest["files"].append("originals/")
                manifest["files"].append("videos/")

                # 预估总大小提示
                estimate = media_stats.get("total_bytes", 0) + db_stats.get("db_size", 0)
                manifest["media"]["estimate_bytes"] = estimate

            manifest["elapsed_sec"] = round(time.time() - start_t, 1)
            zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
            manifest["files"].append("manifest.json")

        pkg_size = os.path.getsize(pkg_path)
        _cleanup_packages()

        return {
            "ok": True,
            "file": pkg_name,
            "path": pkg_path,
            "size": pkg_size,
            "stats": {
                "db": db_stats,
                "media": media_stats,
                "total_size": pkg_size,
                "elapsed_sec": manifest["elapsed_sec"]
            }
        }

    except Exception as e:
        return {"ok": False, "error": str(e)}


# ============ 包完整性验证 ============

def verify_package(pkg_name: str) -> dict:
    """
    验证 .pkb 包完整性
    检查：ZIP 结构 / manifest 完整性 / 所有文件 CRC
    :return: {"ok": bool, "valid": bool, "files_total": int, "errors": list}
    """
    pkg_path = os.path.join(PACKAGES_DIR, pkg_name)
    if not os.path.isfile(pkg_path):
        return {"ok": False, "error": f"包文件不存在: {pkg_name}"}

    errors = []
    total = 0

    try:
        with zipfile.ZipFile(pkg_path, 'r') as zf:
            namelist = zf.namelist()
            total = len(namelist)

            # 检查必需文件
            for required in ["manifest.json", "prompts.db"]:
                if required not in namelist:
                    errors.append(f"缺少必需文件: {required}")

            # CRC 校验每个文件
            for name in namelist:
                try:
                    info = zf.getinfo(name)
                    # 触发 CRC 校验
                    data = zf.read(name)
                    if info.file_size > 0 and len(data) != info.file_size:
                        errors.append(f"文件大小不符: {name} (期望 {info.file_size}, 实际 {len(data)})")
                except Exception as e:
                    errors.append(f"CRC 校验失败: {name} → {e}")

            # 解析 manifest 内容
            if "manifest.json" in namelist:
                try:
                    m = json.loads(zf.read("manifest.json"))
                    if m.get("version", "") not in ("1.0", "1.1"):
                        errors.append(f"未知包版本: {m.get('version')}")
                except Exception as e:
                    errors.append(f"manifest.json 解析失败: {e}")

        return {
            "ok": True,
            "name": pkg_name,
            "size": os.path.getsize(pkg_path),
            "size_str": _format_size(os.path.getsize(pkg_path)),
            "valid": len(errors) == 0,
            "files_total": total,
            "errors": errors if errors else None
        }

    except zipfile.BadZipFile:
        return {"ok": True, "valid": False, "files_total": 0, "errors": ["非法 ZIP 文件"]}
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

            # 1. manifest
            if "manifest.json" in namelist:
                manifest = json.loads(zf.read("manifest.json"))
                restored.append("manifest.json")

            # 2. 恢复 DB
            if "prompts.db" in namelist:
                try:
                    from database import close_db
                    close_db()
                except Exception:
                    pass
                tmp_path = DB_PATH + ".restore_tmp"
                with open(tmp_path, 'wb') as f:
                    f.write(zf.read("prompts.db"))
                shutil.move(tmp_path, DB_PATH)
                restored.append("prompts.db")
                for ext in [".db-wal", ".db-shm"]:
                    fpath = DB_PATH + ext
                    if os.path.exists(fpath):
                        try:
                            os.remove(fpath)
                        except Exception:
                            pass

            # 3. 恢复媒体文件
            media_dirs = {
                "thumbnails": THUMB_DIR,
                "originals": ORIG_DIR,
                "videos": VIDEO_DIR,
            }
            for arcname in namelist:
                parts = arcname.split("/")
                if len(parts) == 2 and parts[0] in media_dirs:
                    out_path = os.path.join(media_dirs[parts[0]], parts[1])
                    with open(out_path, 'wb') as f:
                        f.write(zf.read(arcname))
                    restored.append(arcname)

            # 4. 重新初始化
            try:
                from database import init_db, get_db
                init_db()
            except Exception:
                pass

        return {"ok": True, "restored": restored, "count": len(restored), "errors": errors if errors else None}

    except Exception as e:
        return {"ok": False, "error": str(e)}


# ============ 上传导入 ============

def import_package(data: bytes, filename: str) -> dict:
    """上传导入 .pkb 包"""
    _ensure_dirs()

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            if "prompts.db" not in zf.namelist():
                return {"ok": False, "error": "无效的 .pkb 包：缺少 prompts.db"}
            if "manifest.json" not in zf.namelist():
                return {"ok": False, "error": "无效的 .pkb 包：缺少 manifest.json"}
    except zipfile.BadZipFile:
        return {"ok": False, "error": "无效的 ZIP 文件"}

    save_name = os.path.basename(filename).rstrip(PKG_EXT) + PKG_EXT
    save_path = os.path.join(PACKAGES_DIR, save_name)
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
        return {"ok": True, "saved_as": save_name, "size": len(data)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ============ 列表/管理 ============

def list_packages() -> list:
    """列出所有 .pkb 包（只读 ZIP 目录快速扫描）"""
    _ensure_dirs()
    if not os.path.isdir(PACKAGES_DIR):
        return []

    packages = []
    for fname in os.listdir(PACKAGES_DIR):
        if not fname.endswith(PKG_EXT):
            continue
        fpath = os.path.join(PACKAGES_DIR, fname)
        if not os.path.isfile(fpath):
            continue

        mtime = os.path.getmtime(fpath)
        size = os.path.getsize(fpath)

        # 快速读取 manifest（仅 ZIP 目录头部，无需解压全包）
        summary = {}
        try:
            with zipfile.ZipFile(fpath, 'r') as zf:
                if "manifest.json" in zf.namelist():
                    m = json.loads(zf.read("manifest.json"))
                    media = m.get("media", {})
                    summary = {
                        "version": m.get("version"),
                        "created_at": m.get("created_at"),
                        "elapsed_sec": m.get("elapsed_sec"),
                        "prompts": m.get("db", {}).get("stats", {}).get("prompts", 0),
                        "media_included": media.get("included", False),
                        "media_files": media.get("stats", {}),
                    }
        except Exception:
            pass

        packages.append({
            "name": fname,
            "path": fpath,
            "size": size,
            "size_str": _format_size(size),
            "mtime": datetime.fromtimestamp(mtime).isoformat(),
            "manifest": summary,
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
    """清理超出数量 + 超 24h 的旧包"""
    packages = list_packages()
    if not packages:
        return 0

    now = time.time()
    removed = 0
    keep = []

    for p in packages:
        # 条件1：数量不超过 MAX_PACKAGES
        if len(keep) < MAX_PACKAGES:
            keep.append(p)
            continue
        # 条件2：超过 MAX_PACKAGES 的最后一个如果是 24h 内的，保留一个额外
        if len(keep) == MAX_PACKAGES:
            age_h = (now - os.path.getmtime(p["path"])) / 3600
            if age_h < 24:
                keep.append(p)
                continue
        # 超出则删除
        try:
            os.remove(p["path"])
            removed += 1
        except Exception:
            pass

    return removed


def get_package_info(pkg_name: str) -> dict:
    """获取单个包详细信息（含完整文件清单）"""
    pkg_path = os.path.join(PACKAGES_DIR, pkg_name)
    if not os.path.isfile(pkg_path):
        return {"ok": False, "error": "包不存在"}

    try:
        with zipfile.ZipFile(pkg_path, 'r') as zf:
            namelist = zf.namelist()
            files = []
            for n in namelist:
                info = zf.getinfo(n)
                files.append({
                    "name": n,
                    "size": info.file_size,
                    "compress_size": info.compress_size,
                    "compress_method": "stored" if info.compress_type == 0 else "deflated",
                    "ratio": round((1 - info.compress_size / info.file_size) * 100, 1) if info.file_size > 0 else 0,
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
            "manifest": manifest,
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
