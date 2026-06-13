"""
主入口 — FastAPI 应用 + Uvicorn 启动（加固版）
"""
import sys, os, socket, traceback, subprocess
from contextlib import asynccontextmanager
import uvicorn
from fastapi import FastAPI, Request, UploadFile, File
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import init_db, rebuild_fts, get_db, safe_commit
from seed_data import SEED_PROMPTS, get_builtin_count
from backup import start_auto_backup, stop_auto_backup, do_backup, get_backup_info

# 启动时读取 git 版本号（优先 tag，否则 short hash）
def _get_git_version():
    try:
        repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        r = subprocess.run(
            ["git", "describe", "--tags", "--abbrev=0"],
            cwd=repo,
            capture_output=True, text=True, timeout=3
        )
        tag = r.stdout.strip()
        if tag:
            return tag.lstrip("v")
    except Exception:
        pass
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--short=7", "HEAD"],
            cwd=os.path.dirname(os.path.abspath(__file__)),
            capture_output=True, text=True, timeout=3
        )
        return r.stdout.strip()[:7]
    except Exception:
        return "unknown"

APP_VERSION = _get_git_version()
from api.prompts import router as prompts_router
from api.v2 import router as v2_router
from api.seedance import router as seedance_router
from api.thumbnails import router as thumbnails_router
from api.exporter import router as exporter_router
from api.versions import router as versions_router
from api.search import router as search_router
from api.playground import router as playground_router
from api.tags import router as tags_router
from api.stats import router as stats_router
from api.templates import router as templates_router
from api.workflow import router as workflow_router
from api.comfyui import router as comfyui_router
from api.ocr import router as ocr_router
from api.cards import router as cards_v4_router
from api.composer_v3 import router as composer_v3_router
from api.translate import router as translate_router
from api.media import router as media_router
from api.seedance_v2 import router as seedance_v2_router
from sync import (
    export_package, restore_package, import_package,
    list_packages, delete_package, get_package_info
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        init_db()
        db = get_db()
        existing = db.execute("SELECT COUNT(*) as cnt FROM prompts").fetchone()["cnt"]
        if existing == 0:
            print("[初始化] 导入 %d 条内置提示词..." % get_builtin_count())
            for p in SEED_PROMPTS:
                db.execute(
                    "INSERT INTO prompts (module, category, subcategory, content, meaning, scene, tags) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (p[0], p[1], p[2], p[3], p[4], p[5], p[6])
                )
            safe_commit()
            rebuild_fts()
            print("[初始化] 数据导入完成。")
    except Exception as e:
        print("[初始化] 错误:", e)
        traceback.print_exc()

    host_ip = _get_local_ip()

    # 启动自动备份
    start_auto_backup()

    # 异步重建语义搜索索引
    try:
        from semantic import rebuild_all_embeddings
        import threading
        t = threading.Thread(target=rebuild_all_embeddings, daemon=True)
        t.start()
        print("[语义搜索] 索引重建已异步启动")
    except Exception as e:
        print("[语义搜索] 启动失败:", e)

    # 初始化 Seedance V2 种子数据
    try:
        from seedance_v2_seed import init_seedance_v2_seed
        init_seedance_v2_seed(db)
        safe_commit()
    except Exception as e:
        print("[Seedance V2] 种子初始化失败:", e)

    try:
        total = db.execute("SELECT COUNT(*) as cnt FROM prompts").fetchone()["cnt"]
    except Exception:
        total = 0
    print()
    print("=" * 50)
    print("  [OK] 咪卡MiK提示词助手 v3.0 已启动")
    print("  [本机] http://127.0.0.1:8080")
    print("  [局域网] http://%s:8080" % host_ip)
    print("  [词库] %d 条" % total)
    print("=" * 50)
    print()
    yield
    print("[关闭] 服务停止")
    stop_auto_backup()


app = FastAPI(
    title="咪卡MiK提示词助手",
    description="AI创作提示词管理与组装 WebUI",
    version="3.0.0.1",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(prompts_router)
app.include_router(v2_router)
app.include_router(seedance_router)
app.include_router(thumbnails_router)
app.include_router(exporter_router)
app.include_router(versions_router)
app.include_router(search_router)
app.include_router(playground_router)
app.include_router(tags_router)
app.include_router(stats_router)
app.include_router(templates_router)
app.include_router(workflow_router)
app.include_router(comfyui_router)
app.include_router(ocr_router)
app.include_router(cards_v4_router)
app.include_router(composer_v3_router)
app.include_router(translate_router)
app.include_router(media_router)
app.include_router(seedance_v2_router)


# ============ 数据同步 API (.pkb 包系统) ============

@app.get("/api/sync/packages")
async def sync_list_packages():
    """列出所有 .pkb 包"""
    packages = list_packages()
    return {"ok": True, "packages": packages, "count": len(packages)}


@app.get("/api/sync/packages/{pkg_name}")
async def sync_get_package(pkg_name: str):
    """获取单个包详细信息"""
    return get_package_info(pkg_name)


@app.post("/api/sync/export")
async def sync_export():
    """导出完整 .pkb 包（含 DB + 媒体）"""
    result = export_package(include_media=True)
    if result.get("ok"):
        return {
            "ok": True,
            "file": result["file"],
            "size": result["size"],
            "size_str": result.get("stats", {}).get("total_size", 0),
            "stats": result["stats"]
        }
    return result


@app.post("/api/sync/export-no-media")
async def sync_export_no_media():
    """导出纯 DB 包（不含媒体）"""
    result = export_package(include_media=False)
    if result.get("ok"):
        return {
            "ok": True,
            "file": result["file"],
            "size": result["size"],
            "stats": result["stats"]
        }
    return result


@app.post("/api/sync/restore/{pkg_name}")
async def sync_restore(pkg_name: str, backup_first: bool = True):
    """从 .pkb 包恢复数据"""
    result = restore_package(pkg_name, backup_first=backup_first)
    return result


@app.post("/api/sync/upload")
async def sync_upload(file: UploadFile = File(...)):
    """上传 .pkb 包导入"""
    body = await file.read()
    filename = file.filename or "imported.pkb"
    result = import_package(body, filename)
    return result


@app.delete("/api/sync/packages/{pkg_name}")
async def sync_delete(pkg_name: str):
    """删除一个 .pkb 包"""
    result = delete_package(pkg_name)
    return result


# ============ 备份管理 API ============
@app.get("/api/backup/info")
async def backup_info():
    """获取备份状态"""
    return get_backup_info()


@app.post("/api/backup/now")
async def backup_now():
    """手动触发一次备份"""
    result = do_backup()
    return result


# ============ 全局异常处理器 ============
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print("[全局异常]", request.url.path, type(exc).__name__, str(exc)[:200])
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"ok": False, "error": "服务器内部错误", "detail": str(exc)[:200]}
    )


@app.get("/api/status")
def get_status():
    try:
        db = get_db()
        total = db.execute("SELECT COUNT(*) as cnt FROM prompts").fetchone()["cnt"]
        usage = db.execute("SELECT SUM(usage_count) as cnt FROM prompts").fetchone()["cnt"] or 0
        cards = db.execute("SELECT COUNT(*) as cnt FROM prompt_cards WHERE is_deleted=0").fetchone()["cnt"]
        libs = db.execute("SELECT COUNT(*) as cnt FROM library_assets").fetchone()["cnt"]
        return {
            "status": "running",
            "total_prompts": total,
            "total_usage": usage,
            "total_cards": cards,
            "total_library_assets": libs,
            "version": APP_VERSION
        }
    except Exception as e:
        print("[状态] 查询失败:", e)
        return {"status": "degraded", "error": str(e), "version": "3.0.0"}


FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
STATIC_DIR = os.path.join(FRONTEND_DIR, "static")
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR, html=True), name="static")


@app.get("/")
def serve_index():
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return JSONResponse(status_code=404, content={"error": "前端页面未找到"})


@app.post("/api/utils/check-path")
def check_path(data: dict = None):
    """验证本地路径是否存在且为目录"""
    if not data or "path" not in data:
        return {"ok": False, "error": "缺少路径参数"}
    p = data["path"].strip()
    if not p:
        return {"ok": False, "error": "路径为空"}
    p = os.path.abspath(p)
    if os.path.isdir(p):
        return {"ok": True, "path": p, "name": os.path.basename(p)}
    elif os.path.exists(p):
        return {"ok": False, "error": "路径已存在但不是一个目录"}
    else:
        return {"ok": False, "error": "目录不存在，请先创建"}


@app.post("/api/utils/pick-folder")
def pick_folder():
    """弹出 Windows 原生文件夹选择对话框，返回真实完整路径"""
    try:
        import tkinter
        from tkinter import filedialog
        root = tkinter.Tk()
        root.withdraw()
        root.attributes('-topmost', True)
        folder = filedialog.askdirectory(title="选择导出文件夹")
        root.destroy()
        if folder:
            folder = os.path.abspath(folder)
            return {"ok": True, "path": folder, "name": os.path.basename(folder)}
        return {"ok": False, "error": "未选择目录"}
    except Exception as e:
        return {"ok": False, "error": f"打开目录选择器失败: {e}"}


@app.post("/api/utils/save-blob")
def save_blob(data: dict = None):
    """将 base64 数据写入指定路径，文件已存在时自动新建副本不覆盖"""
    import base64
    if not data:
        return {"ok": False, "error": "缺少数据"}
    path = data.get("path", "")
    content_b64 = data.get("content", "")
    if not path or not content_b64:
        return {"ok": False, "error": "缺少路径或内容"}
    try:
        path = os.path.abspath(path)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        # 如果文件已存在，自动新建副本（不覆盖）
        if os.path.exists(path):
            base, ext = os.path.splitext(path)
            counter = 1
            while os.path.exists(f"{base} ({counter}){ext}"):
                counter += 1
            path = f"{base} ({counter}){ext}"
        raw = base64.b64decode(content_b64)
        with open(path, "wb") as f:
            f.write(raw)
        return {"ok": True, "path": path}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(3)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    print("[启动] 服务启动中 (端口: %d)..." % port)
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False, log_level="info")
