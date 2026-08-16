# -*- coding: utf-8 -*-
"""需求分析 — 独立服务入口（独立端口 8085，零侵入主项目）

启动：python ted_module/main.py  →  http://127.0.0.1:8085
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from config import HOST, PORT
from db import init_db
from api.router import router

app = FastAPI(
    title="需求分析",
    description="基于光厂官方公开指数【人工快照】的本地分析工具：零外网、零抓取、零定时任务，数据全靠人工上传。",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

init_db()
app.include_router(router)


@app.get("/")
def index():
    return FileResponse(os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "index.html"))


@app.get("/api/health")
def api_health():
    return {"ok": True, "module": "需求分析", "version": "1.0.0", "mode": "offline-only"}


if __name__ == "__main__":
    import uvicorn
    print(f"[需求分析] 需求分析启动：http://127.0.0.1:{PORT} （独立服务，零外网）")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
