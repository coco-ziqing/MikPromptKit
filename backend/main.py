"""
主入口 — FastAPI 应用 + Uvicorn 启动
"""
import sys
import os
import socket
from pathlib import Path
from contextlib import asynccontextmanager
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# 将 backend 目录加入 Python 路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import init_db, rebuild_fts, get_db
from seed_data import SEED_PROMPTS, get_builtin_count
from api.prompts import router as prompts_router
from api.v2 import router as v2_router
from api.seedance import router as seedance_router
from api.thumbnails import router as thumbnails_router


# ============ 应用生命周期 ============
@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时初始化数据库，关闭时清理"""
    init_db()
    db = get_db()

    # 检查是否已有数据
    existing = db.execute("SELECT COUNT(*) as cnt FROM prompts").fetchone()["cnt"]
    if existing == 0:
        print("[初始化] 导入 %d 条内置提示词..." % get_builtin_count())
        for p in SEED_PROMPTS:
            db.execute(
                "INSERT INTO prompts (module, category, subcategory, content, meaning, scene, tags) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (p[0], p[1], p[2], p[3], p[4], p[5], p[6])
            )
        db.commit()
        rebuild_fts()
        print("[初始化] 数据导入完成，全文索引已重建。")

    # 打印访问地址
    host_ip = _get_local_ip()
    total = db.execute("SELECT COUNT(*) as cnt FROM prompts").fetchone()["cnt"]
    print()
    print("=" * 50)
    print("  [OK] 提示词检索工具 v3.0 已启动")
    print("  [本机] http://127.0.0.1:8080")
    print("  [局域网] http://%s:8080" % host_ip)
    print("  [词库] %d 条" % total)
    print("=" * 50)
    print()

    yield  # 应用运行中

    print("[关闭] 服务停止")


# ============ 创建应用 ============
app = FastAPI(
    title="提示词检索工具",
    description="Windows桌面端AI创作提示词检索工具 WebUI",
    version="3.0.0",
    lifespan=lifespan
)

# CORS — 允许局域网所有设备访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============ 注册 API 路由（必须在静态文件挂载之前） ============
app.include_router(prompts_router)
app.include_router(v2_router)
app.include_router(seedance_router)
app.include_router(thumbnails_router)


@app.get("/api/status")
def get_status():
    """服务状态接口"""
    db = get_db()
    total = db.execute("SELECT COUNT(*) as cnt FROM prompts").fetchone()["cnt"]
    usage = db.execute("SELECT SUM(usage_count) as cnt FROM prompts").fetchone()["cnt"] or 0
    return {
        "status": "running",
        "total_prompts": total,
        "total_usage": usage,
        "version": "3.0.0"
    }


# ============ 挂载静态文件 /static/ 路径 ============
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
STATIC_DIR = os.path.join(FRONTEND_DIR, "static")
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# ============ 前端页面路由 ============
@app.get("/")
def serve_index():
    """首页"""
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"error": "前端页面未找到"}


def _get_local_ip() -> str:
    """获取本机局域网 IP"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


# ============ 直接运行 ============
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    print("[启动] 服务启动中 (端口: %d)..." % port)
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=False,
        log_level="info"
    )
