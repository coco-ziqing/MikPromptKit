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
from paths import get_base_dir, get_frontend_dir

# 实际端口（__main__ 探测后设置，lifespan 读取）
ACTUAL_PORT = 8080

BASE_DIR = get_base_dir()
sys.path.insert(0, os.path.join(BASE_DIR, 'backend'))
_dev_backend = os.path.dirname(os.path.abspath(__file__))
if _dev_backend not in sys.path:
    sys.path.insert(0, _dev_backend)

from database import init_db, rebuild_fts, get_db, safe_commit
from seed_data import SEED_PROMPTS, get_builtin_count
from backup import start_auto_backup, stop_auto_backup, do_backup, get_backup_info

# 启动时读取版本号
APP_VERSION = '4.0.0-phase9.3'
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
    list_packages, delete_package, get_package_info,
    verify_package
)


def _migrate_v4(db):
    """幂等迁移: prompts→prompt_cards, prompt_library+word_card→library_assets, 表结构补列"""
    # === 第〇步：确保 user_project 有完整列（bgm/sfx/dialogue/template_id）===
    cols = [c[1] for c in db.execute("PRAGMA table_info(user_project)").fetchall()]
    for name, typ in [
        ("bgm", "TEXT DEFAULT ''"),
        ("sfx", "TEXT DEFAULT ''"),
        ("dialogue", "TEXT DEFAULT ''"),
        ("template_id", "INTEGER DEFAULT NULL"),
    ]:
        if name not in cols:
            db.execute(f"ALTER TABLE user_project ADD COLUMN {name} {typ}")
            print("[迁移] user_project 补列: %s" % name)
    # === 同样确保 user_project_scene 有完整列 ===
    scols = [c[1] for c in db.execute("PRAGMA table_info(user_project_scene)").fetchall()]
    for name, typ in [
        ("duration", "REAL DEFAULT 3"),
        ("is_manual", "INTEGER DEFAULT 0"),
        ("is_locked", "INTEGER DEFAULT 0"),
    ]:
        if name not in scols:
            db.execute(f"ALTER TABLE user_project_scene ADD COLUMN {name} {typ}")
            print("[迁移] user_project_scene 补列: %s" % name)
    # === 第一步: prompts → prompt_cards ===
    count = db.execute("SELECT COUNT(*) FROM prompt_cards").fetchone()[0]
    if count == 0:
        rows = db.execute("SELECT * FROM prompts ORDER BY id").fetchall()
        if rows:
            for r in rows:
                r = dict(r)
                db.execute(
                    "INSERT INTO prompt_cards (card_type,name,content,meaning,scene,module,category,tags,structured_fields,usage_count,is_builtin,is_deleted) VALUES (?,?,?,?,?,?,?,?,?,?,1,0)",
                    ('image',(r.get('subcategory','') or '')[:60],r.get('content',''),r.get('meaning',''),r.get('scene',''),r.get('module',''),r.get('category',''),r.get('tags','[]'),'{}',r.get('usage_count',0))
                )
            db.commit()
            print("[迁移] prompts -> prompt_cards: %d 条" % len(rows))
    # === 第二步: prompt_library + prompt_word_card → library_assets ===
    count2 = db.execute("SELECT COUNT(*) FROM library_assets").fetchone()[0]
    if count2 == 0:
        libs = db.execute("SELECT * FROM prompt_library ORDER BY sort_order").fetchall()
        for lib in libs:
            lib = dict(lib)
            db.execute("INSERT INTO library_assets (name,lib_type,category,prompt,icon,is_builtin,sort_order) VALUES (?,?,?,?,?,1,?)",(
                lib.get('dimension_name',''),'style',lib.get('category',''),lib.get('description',''),'📚',lib.get('sort_order',0)
            ))
            cards = db.execute("SELECT * FROM prompt_word_card WHERE library_id=? ORDER BY id",[lib['id']]).fetchall()
            for card in cards:
                card = dict(card)
                db.execute("INSERT INTO library_assets (name,lib_type,category,prompt,icon,is_builtin,sort_order) VALUES (?,?,?,?,?,1,999)",(
                    card.get('word_text','')[:60],'style',lib.get('category',''),card.get('definition','') or card.get('word_text',''),'📄'
                ))
        db.commit()
        total = db.execute("SELECT COUNT(*) FROM library_assets").fetchone()[0]
        print("[迁移] prompt_library -> library_assets: %d 条" % total)


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
        from semantic import _ML_OK
        if _ML_OK:
            from semantic import rebuild_all_embeddings
            import threading
            t = threading.Thread(target=rebuild_all_embeddings, daemon=True)
            t.start()
            print("[语义搜索] 索引重建已启动")
        else:
            print("[语义搜索] ML 依赖不可用，跳过")
    except Exception as e:
        print("[语义搜索] 初始化失败:", e)

    # 初始化 Seedance V2 种子数据
    try:
        from seedance_v2_seed import init_seedance_v2_seed
        init_seedance_v2_seed(db)
        safe_commit()
    except Exception as e:
        print("[Seedance V2] 种子初始化失败:", e)

    # v4 数据迁移: prompts→prompt_cards, prompt_library→library_assets
    _migrate_v4(db)

    try:
        total = db.execute("SELECT COUNT(*) as cnt FROM prompts").fetchone()["cnt"]
        cards = db.execute("SELECT COUNT(*) as cnt FROM prompt_cards WHERE is_deleted=0").fetchone()["cnt"]
        libs = db.execute("SELECT COUNT(*) as cnt FROM library_assets").fetchone()["cnt"]
    except Exception:
        total = cards = libs = 0
    print()
    print("=" * 50)
    print("  [OK] 咪卡MiK提示词助手 v4.0.0-phase9.3 已启动")
    print("  [本机] http://127.0.0.1:%s" % ACTUAL_PORT)
    print("  [局域网] http://%s:%s" % (host_ip, ACTUAL_PORT))
    print("  [词库] %d 条 | 卡片 %d | 资产 %d" % (total, cards, libs))
    print("=" * 50)
    print()
    yield
    print("[关闭] 服务停止")
    stop_auto_backup()


app = FastAPI(
    title="咪卡MiK提示词助手",
    description="AI创作提示词管理与组装 WebUI",
    version="4.0.0",
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


@app.get("/api/sync/download/{pkg_name}")
async def sync_download(pkg_name: str):
    """直接下载 .pkb 包文件"""
    from paths import get_data_dir
    pkg_path = os.path.join(get_data_dir(), "packages", pkg_name)
    if not os.path.isfile(pkg_path):
        return JSONResponse({"ok": False, "error": "包不存在"}, 404)
    return FileResponse(pkg_path, filename=pkg_name, media_type="application/zip")


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


@app.get("/api/sync/verify/{pkg_name}")
async def sync_verify(pkg_name: str):
    """验证包完整性（CRC 校验所有文件）"""
    result = verify_package(pkg_name)
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


FRONTEND_DIR = get_frontend_dir()
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
    import sys as _sys
    base_port = int(os.environ.get("PORT", 8080))
    # 预探测可用端口（自兜底 +0..+9）
    port = base_port
    for offset in range(10):
        candidate = base_port + offset
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        try:
            sock.bind(("0.0.0.0", candidate))
            sock.close()
            port = candidate
            break
        except Exception:
            sock.close()
            if offset < 9:
                print("[启动] 端口 %d 被占用，尝试 %d..." % (candidate, candidate + 1))
            else:
                print("[启动] ❌ 端口 %d~%d 均被占用" % (base_port, base_port + 9))
                try:
                    _sys.stdout.flush()
                    print("[启动] 按任意键退出...")
                    import msvcrt
                    msvcrt.getch()
                except ImportError:
                    try:
                        input()
                    except Exception:
                        pass
                except Exception:
                    pass
                _sys.exit(1)
    print("[启动] 服务启动中 (端口: %d)..." % port)
    # 更新全局端口号（lifespan 中打印用）
    globals()['ACTUAL_PORT'] = port
    uvicorn.run(app, host="0.0.0.0", port=port, reload=False, log_level="info")
