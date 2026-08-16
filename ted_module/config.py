# -*- coding: utf-8 -*-
"""配置：独立模块路径与参数（全部本地，零外网）"""
import os

MODULE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(MODULE_DIR, "data")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
DB_PATH = os.path.join(DATA_DIR, "ted_analysis.db")

HOST = "0.0.0.0"
PORT = 8085

# 双维度评分权重（需求指数 / 机会指数 / 自有销售信号）
W_DEMAND = 0.6
W_OPPORTUNITY = 0.4
W_SALES = 0.0        # 有销售数据时自动切换为 0.5/0.3/0.2

# 四类题材池划分阈值（demand/opportunity 归一化后 0-100）
POOL_THRESHOLD_DEMAND = 60
POOL_THRESHOLD_OPP = 50

# 合规红线（模块内禁止出现的 import/关键字，静态自检用）
FORBIDDEN_PATTERNS = [
    "requests", "urllib.request", "urllib.parse", "http.client", "aiohttp",
    "httpx", "playwright", "selenium", "webdriver", "socket", "webbrowser",
    "subprocess", "scrapy", "bs4", "beautifulsoup", "lxml.html",
    "schedule", "cron", "apscheduler", "threading.Timer",
]

for _d in (DATA_DIR, UPLOAD_DIR):
    os.makedirs(_d, exist_ok=True)
