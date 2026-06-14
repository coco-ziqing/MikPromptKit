# 咪卡MiK提示词助手

> AI 创作者提示词管理与组装 WebUI — Windows/macOS 局域网多终端访问

[![Python](https://img.shields.io/badge/Python-3.10%2B-blue)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688)](https://fastapi.tiangolo.com)
[![SQLite](https://img.shields.io/badge/SQLite-FTS5-003B57)](https://sqlite.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## ✨ 功能

| 功能 | 说明 |
|------|------|
| 📝 **提示词管理** | 5 模块 151 条种子 + 自定义编辑/分类/搜索 |
| 🖼️ **媒体资产管理** | 缩略图上传 3:2 裁剪 + 原图查看 + 视频封面提取 |
| 🎬 **Seedance 组装器** | 27 套维度词库 + 多镜头时间轴编排 + 5 平台输出 |
| 🔍 **智能搜索** | 关键词模糊搜索 + FTS5 全文索引 |
| 🌗 **深色主题** | 一键切换，持久化偏好 |
| 📦 **数据同步** | .pkb 包：导出(含媒体文件) → 上传 → CRC 校验 → 恢复 |
| 🌐 **局域网共享** | 手机/平板/其他电脑浏览器直接访问 |

## 🚀 快速开始（Windows）

### 方式一：下载 EXE

从 [Releases](https://github.com/coco-ziqing/MikPromptKit/releases) 下载 MikPromptKit_Windows_v4.0.0.zip

`ash
# 解压后
双击 启动.bat    # 推荐
# 或
双击 PromptKit.exe
`

浏览器打开 http://127.0.0.1:8080

### 方式二：源码运行

`ash
pip install -r requirements.txt
python backend/main.py
`

## 🍎 快速开始（macOS）

在 Mac 上从源码构建：

`ash
# 1. 下载 macOS 构建包
# 2. 解压后执行
chmod +x macos/build_dmg.sh
./macos/build_dmg.sh
`

详见 [macos/BUILD.md](macos/BUILD.md)

## 📖 使用说明

### 首次打开

`
http://127.0.0.1:8080     ← 本机访问
http://192.168.x.x:8080   ← 局域网其他设备访问（WiFi 下）
`

### 五大模块

| 模块 | 词条 | 说明 |
|------|------|------|
| 人物表情 | 26 | 喜悦/沉静/氛围感/动态表情 |
| 场景色彩 | 31 | 自然/城市/复古/科幻/奇幻 |
| 画面色调 | 23 | 暖色调/冷色调/对比色/黑白 |
| 分镜构图 | 52 | 景别/构图方式/镜头角度/透视 |
| 视频模版 | 19 | 叙事/产品/角色/风景等场景模版 |

### 数据同步（跨机迁移）

`ash
# 源机器导出
curl -X POST http://源机IP:8080/api/sync/export -o backup.pkb

# 目标机导入（通过 WebUI 同步面板）
打开 同步面板 → 上传 .pkb → 恢复
`

## 🏗️ 项目结构

`
backend/          # FastAPI 后端（30+ 表 / 165+ API）
├── main.py       # 入口
├── database.py   # SQLite 建表/迁移
├── sync.py       # .pkb 打包/恢复/验证
├── paths.py      # 开发/封装路径统一
└── api/          # API 路由模块

frontend/         # Bootstrap5 SPA
├── index.html    # 主页面
└── static/
    ├── css/style.css
    └── js/       # 6 模块拆分

macos/            # macOS 构建资源
└── build_dmg.sh  # 一键 .dmg 生成器

data/             # 运行数据（.gitignore）
├── prompts.db    # SQLite 数据库
├── thumbnails/   # 缩略图(240×160)
├── originals/    # 上传原图
└── videos/       # 上传视频
`

## 📊 数据统计

| 指标 | 数量 |
|------|------|
| 后端 API 端点 | 165+ |
| 数据库表 | 30 |
| 种子词条 | 151 |
| 词库资产 | 233 |
| JS 源码 | ~8500 行 |
| CSS | 2100 行 |

## 🧪 技术栈

- **后端**: Python 3.10+ / FastAPI / Uvicorn / SQLite3 (WAL+FTS5)
- **前端**: HTML5 / Bootstrap5 CDN / Vanilla JS SPA
- **媒体**: Pillow (3:2 裁剪) / ffmpeg (封面提取+压缩)
- **打包**: PyInstaller (Windows EXE) / PyInstaller + create-dmg (macOS .dmg)

## 📝 License

MIT License — 自由使用、修改、分发