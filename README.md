# 咪卡MiK提示词助手 (PromptKit)

> AI创作者本地媒体+提示词一体化工作站

![Version](https://img.shields.io/badge/version-4.0.0_phase9.3-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Windows_10/11-lightgrey)

## 简介

面向 **Windows 系统后端 + 局域网跨设备访问** 的提示词快捷管理 WebUI 工具。

- 🗄️ **提示词管理** — 录入、编辑、删除、检索提示词
- 🔍 **智能搜索** — FTS5 全文搜索 + 语义搜索
- 📦 **词库系统** — 27 套维度词库，302 条专业词条
- 🎬 **视频脚本组装器** — 多镜头结构化组装，实时合成提示词
- 🖼️ **媒体资产管理** — 缩略图/视频上传+管理
- 🌐 **局域网跨设备** — 手机/平板/其他电脑浏览器访问
- 💾 **本地优先** — SQLite 数据库，完全离线可用

## 快速开始

### 开发环境启动

```powershell
# 1. 安装依赖
pip install -r requirements.txt

# 2. 启动服务
python backend/main.py

# 3. 浏览器访问
http://127.0.0.1:8080
```

### 打包 EXE 启动

```powershell
# 构建
python -m PyInstaller build.spec --clean --noconfirm

# 产物在 dist/PromptKit/
# 双击 PromptKit.exe 即可运行
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python 3.10+ / FastAPI / Uvicorn |
| 数据库 | SQLite (WAL + FTS5) |
| 前端 | Vanilla JS SPA / Bootstrap 5 / CSS3 |
| 图片 | Pillow (自动 3:2 裁剪) |
| 视频 | ffmpeg (封面提取 + 裁剪压缩) |
| 语义搜索 | sentence-transformers / all-MiniLM-L6-v2 |
| 打包 | PyInstaller |

## 项目结构

```
prompt-tool-dev/
├── backend/              # Python 后端
│   ├── main.py           # FastAPI 入口 + 路由注册
│   ├── database.py       # SQLite 30表 + FTS5
│   ├── semantic.py       # 语义搜索引擎
│   ├── seed_data.py      # 151 条种子数据
│   ├── backup.py         # 自动备份
│   ├── paths.py          # 路径适配
│   └── api/              # 16 个 API 模块
├── frontend/             # WebUI 前端
│   ├── index.html        # SPA 主页面
│   └── static/
│       ├── css/style.css
│       └── js/           # 10 个 JS 模块
├── memory/               # 开发记忆+路线图
├── build.spec            # PyInstaller 打包配置
└── requirements.txt      # Python 依赖
```

## 功能模块

- **提示词 CRUD** — 搜索/分页/筛选
- **收藏夹** — 多分组 + 图标 + 批量管理
- **自定义词包** — TXT/JSON 导出
- **最近使用** — 自动记录 + 清空
- **回收站** — 恢复/清空
- **智能推荐** — 标签匹配算法
- **组装器 v2** — 5 格式输出 + 3 档密度 + 音频 + 像素分辨率
- **审阅弹窗** — 多镜头时间线 + 拖拽排序
- **词库资产管理** — 27 维度词库 / 302 条专业词条
- **截图导入** — OCR 识别 + 自动创建词条
- **PNG 元数据导出** — 提示词嵌入 PNG zTXt
- **数据同步** — .pkb 包系统（ZIP 打包 + 恢复）
- **深色主题** — 一键切换
- **移动端适配** — 响应式布局

## 许可证

[MIT License](LICENSE) © 2026 咪卡MiK
