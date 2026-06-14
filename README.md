<p align="center">
  <img src="macos/resources/app_icon.svg" width="120" alt="MikPromptKit Logo">
</p>

<h1 align="center">咪卡MiK提示词助手</h1>

<p align="center">
  <strong>AI创作者本地媒体 + 提示词一体化工作站</strong><br>
  Windows / macOS · 纯局域网 · 离线可用 · 跨设备访问
</p>

<p align="center">
  🎨 提示词管理 · 🖼️ 媒体资产库 · 🎬 Seedance 组装器 · 📦 一键迁移
</p>

<p align="center">
  <a href="https://python.org"><img src="https://img.shields.io/badge/Python-3.10%2B-blue" alt="Python"></a>
  <a href="https://fastapi.tiangolo.com"><img src="https://img.shields.io/badge/FastAPI-0.115-009688" alt="FastAPI"></a>
  <a href="https://sqlite.org"><img src="https://img.shields.io/badge/SQLite-FTS5-003B57" alt="SQLite"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="License"></a>
  <a href="https://github.com/coco-ziqing/MikPromptKit/releases"><img src="https://img.shields.io/badge/Release-v4.0.0--phase9.3.1-orange" alt="Release"></a>
</p>

---

## 📦 快速下载

| 平台 | 文件 | 大小 | 说明 |
|------|------|------|------|
| 🪟 Windows | [`MikPromptKit_Windows_v4.0.0-phase9.3.1.zip`][win] | 63 MB | **解压双击即用**，无需任何环境 |
| 🍎 macOS | [`MikPromptKit_macOS_build.zip`][mac] | 0.3 MB | 构建材料包，需在 Mac 上运行 `build_dmg.sh` 生成 `.dmg` |

[win]: https://github.com/coco-ziqing/MikPromptKit/releases/download/v4.0.0-phase9.3.1/MikPromptKit_Windows_v4.0.0-phase9.3.1.zip
[mac]: https://github.com/coco-ziqing/MikPromptKit/releases/download/v4.0.0-phase9.3.1/MikPromptKit_macOS_build.zip

### 🪟 Windows 用户

```bash
解压 → 双击 启动.bat → 浏览器访问 http://127.0.0.1:8080
```

### 🍎 macOS 用户

```bash
# 构建前先安装依赖
pip3 install -r requirements_macos.txt

# 一键生成 .dmg 安装包
chmod +x macos/build_dmg.sh
./macos/build_dmg.sh

# 输出 dist_macos/MikPromptKit_v4.0.0.dmg
# 打开 → 拖入 Applications 文件夹
```

> macOS 构建细节详见 [`macos/BUILD.md`](macos/BUILD.md)

---

## 🎯 适用场景

### 使用 AI 出图的创作者

与 Stable Diffusion、Midjourney、ComfyUI 配合使用：

| 场景 | 怎么做 |
|------|--------|
| 记不住好的 prompt | 看到满意的 prompt 马上录入 → 按模块/分类归档 → 下次复用 |
| 出图需要配图参考 | 拖入原图 → 自动生成缩略图 → 提示词卡片直接关联媒体资产 |
| ComfyUI 工作流配词 | Seedance 组装器选取维度词条 → 一键输出 Raw 格式 → 粘贴到节点 |
| 批量导出 prompt 素材 | 勾选勾选 → 批量复制 / 导出 TXT+JSON / 加入词包 |

### 使用 AI 视频工具的创作者

与 Seedance、Kling、MiniMax 配合使用：

| 场景 | 怎么做 |
|------|--------|
| 视频分镜需要结构化的 prompt | 新建项目 → 添加镜头 → 从 27 套词库选词填充每个镜头字段 |
| 不同平台输出格式不统一 | 组装器内置 5 平台适配（Seedance / Kling / MiniMax / ComfyUI / Raw）|
| 视频素材管理散乱 | 上传视频 → 自动提取封面 → 关联到提示词卡片 → 统一管理 |

### 跨设备使用的创作者

| 场景 | 怎么做 |
|------|--------|
| 台式机放创作素材，沙发上用手机查 prompt | 同一 WiFi 下，手机浏览器打开 `http://台式机IP:8080` |
| 换电脑/重装系统 | `.pkb` 包一键导出全部数据（DB+321缩略图+243原图+23视频）→ 新机器恢复 |
| 备份重要 prompt 库 | 自动备份（每小时）+ 手动导出 `.pkb` + CRC 校验 |

---

## ✨ 功能一览

| 功能 | 说明 |
|------|------|
| 📝 **提示词管理** | 5 大模块、151 条种子数据，支持自定义编辑、分类筛选、全文搜索 |
| 🖼️ **媒体资产管理** | 缩略图上传（3:2 自动裁剪）、原图查看器（缩放+拖拽）、视频封面提取 |
| 🎬 **Seedance 组装器** | 27 套维度词库、多镜头时间轴编排、5 平台输出引擎、3 档密度 |
| 🔍 **智能搜索** | 关键词模糊搜索 + FTS5 全文索引 |
| 🌗 **深色主题** | 一键切换，持久化偏好 |
| 📦 **数据同步** | `.pkb` 包一键导出（含全部媒体文件）→ 传输 → CRC 校验 → 恢复 |
| 🌐 **局域网共享** | 手机、平板、其他电脑在同一 WiFi 下直接浏览器访问 |
| ⭐ **收藏夹** | 多分组管理，一个提示词可归属多个分组 |
| 📁 **词包** | 自定义词包，批量添加/导出 TXT + JSON |

---

## 📖 使用说明

### 首次打开

```
http://127.0.0.1:8080      ← 本机访问
http://192.168.x.x:8080    ← 同局域网设备访问（WiFi 下可用）
```

### 五大模块

| 模块 | 词条数 | 内容 |
|------|--------|------|
| 人物表情 | 26 | 喜悦类 / 沉静类 / 氛围感 / 动态表情 |
| 场景色彩 | 31 | 自然色彩 / 城市色彩 / 复古色调 / 科幻色彩 / 奇幻色彩 |
| 画面色调 | 23 | 暖色调 / 冷色调 / 对比色 / 黑白 |
| 分镜构图 | 52 | 景别 / 构图方式 / 镜头角度 / 透视 |
| 视频模版 | 19 | 叙事 / 产品 / 角色 / 风景 / 情感 / 创意等场景模板 |

### Seedance 组装器

点击 🔧 按钮进入组装器：

1. **新建项目** → 设置总时长、画幅比、分辨率
2. **编排镜头** → 添加/删除/拖拽排序，锁定/解锁时长
3. **选词装配** → 从 27 套维度词库中选择词条填充镜头字段
4. **输出** → Seedance / Kling / MiniMax / ComfyUI / Raw 五平台适配
5. **审阅** → 全文预览 + 一键复制

### 数据同步（跨机迁移）

```bash
# 源机器：导出完整包（含 DB + 全部缩略图/原图/视频）
curl -X POST http://源机IP:8080/api/sync/export -o backup.pkb

# 目标机：打开 WebUI → 同步面板 → 上传 backup.pkb → 恢复
# 或命令行：
curl -X POST http://目标机IP:8080/api/sync/restore/backup.pkb
```

---

## 🏗️ 项目结构

```
MikPromptKit/
├── backend/                  # FastAPI 后端（165+ API / 30 表）
│   ├── main.py               # 入口 + 生命周期 + 路由挂载
│   ├── database.py           # SQLite 建表 / 迁移
│   ├── sync.py               # .pkb 打包 / 恢复 / CRC 验证
│   ├── paths.py              # 开发 / 封装路径统一解析
│   ├── backup.py             # 自动备份
│   ├── semantic.py           # 语义搜索（ML 依赖可选）
│   └── api/                  # API 路由模块
│       ├── prompts.py        # 提示词 CRUD / 模块 / 分类
│       ├── seedance_v2.py    # Seedance 组装器（~1800 行）
│       ├── thumbnails.py     # 图片视频上传 / 裁剪
│       └── ...               # 共 20 个路由文件
│
├── frontend/                 # Bootstrap 5 SPA
│   ├── index.html            # 主页面（878 行）
│   └── static/
│       ├── css/style.css     # 深色/浅色主题 + 响应式（2100 行）
│       └── js/               # 6 模块拆分（共 8500 行）
│           ├── app_core.js   # 核心框架
│           ├── app_editor.js # 编辑模式 / 侧边栏
│           ├── app_sync.js   # 同步面板 / .pkb 包管理
│           ├── app_collections.js  # 收藏夹
│           ├── app_media.js       # 媒体资产管理
│           ├── app_tools.js       # 工具函数
│           └── seedance_v2_composer.js  # 组装器主逻辑
│
├── macos/                    # macOS 构建资源
│   ├── BUILD.md              # 构建说明
│   ├── build_dmg.sh          # 一键 .dmg 安装包生成器
│   └── resources/
│       ├── app_icon.svg      # 应用图标源文件
│       └── dmg_background.svg # 安装包背景图
│
├── data/                     # 运行时数据（.gitignore）
│   ├── prompts.db            # SQLite 数据库
│   ├── thumbnails/           # 240×160 裁剪缩略图
│   ├── originals/            # 上传原图
│   ├── videos/               # 上传视频
│   └── packages/             # .pkb 备份包
│
├── build.spec                # Windows PyInstaller 配置
├── build_macos.spec          # macOS PyInstaller 配置
├── requirements.txt          # Windows 依赖
├── requirements_macos.txt    # macOS 依赖
└── README.md
```

---

## 📊 项目规模

| 指标 | 数值 |
|------|------|
| 后端 API 端点 | 165+ |
| 数据库表 | 30 |
| 种子词条 | 151 |
| 词库资产 | 233 |
| JS 源码行数 | ~8,500 |
| CSS 行数 | ~2,100 |
| Git 版本标签 | 27 个 |

---

## 🧪 技术栈

| 层 | 技术 |
|----|------|
| 运行时 | Python 3.10+ |
| Web 框架 | FastAPI + Uvicorn |
| 数据库 | SQLite 3（WAL 模式 + FTS5 全文索引）|
| 前端 | HTML5 + Bootstrap 5 CDN + Vanilla JS SPA |
| 图片处理 | Pillow（自动 3:2 裁剪）|
| 视频处理 | ffmpeg（封面提取 + 裁剪压缩）|
| 语义搜索 | sentence-transformers + all-MiniLM-L6-v2（可选）|
| Windows 打包 | PyInstaller（onedir 模式）|
| macOS 打包 | PyInstaller + create-dmg / hdiutil |

---

## 🤝 贡献

欢迎 Issue 反馈问题或功能建议。提交 PR 前请确保：

```bash
pip install -r requirements.txt
python backend/main.py    # 启动测试
# 浏览器访问 http://127.0.0.1:8080 验证
```

---

## 📄 License

MIT License — 自由使用、修改、分发。

Copyright © 2026 咪卡MiK
