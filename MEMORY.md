# PromptKit — 提示词检索工具

## 项目标识
- 项目：提示词检索工具 (PromptKit)
- 版本：v3.1.1 (2026-05-31)
- 工作目录：C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev
- 启动方式：`python backend/main.py` 或 `.\start.bat`
- 默认端口：8080
- 局域网地址：http://192.168.0.103:8080

## 技术栈
- Python 3.10+ / FastAPI / Uvicorn / SQLite (WAL + FTS5)
- 前端：Bootstrap 5 CDN + Vanilla JS SPA (~4500 行)
- 图片处理：Pillow（自动 3:2 裁剪）
- 视频处理：ffmpeg（封面提取 + 裁剪压缩）
- 语义搜索：sentence-transformers + all-MiniLM-L6-v2
- 版本管理：Git + Git tag

## 项目规模
- 后端 API 端点：86+ 个
- 源代码总量：~11000 行
- 数据库表：21 张
- 种子词条：165 条（5 模块）

## Git Tag 节点
- `v3.1.1` — 语义搜索 + 版本管理（当前）
- `v3.0.0.2` — .pt 包系统 + 导出名称优化 + 拖拽增强
- `v3.0.0.1` — 基础版本

## v3.0.0.2 新增功能清单

### 词库浏览
- 5 模块：表情(26) / 色彩(31) / 色调(23) / 构图(52) / Seedance(19) = **151 条种子数据**
- 二级分类筛选 / 模糊搜索 (Ctrl+F) / 分页

### Seedance 视频模板
- 19 条场景模板（11 大类：叙事/产品/角色/风景/情感/创意/口播/卡点/伪纪录片/长镜头/视频扩展）
- 提示词组装器（风格+时间轴+声音+引用 → 一键生成完整提示词）
- 20 项镜头语言速查表 + 8 项多模态引用语法
- 精选画廊

### 收藏夹 ⭐
- 多分组管理（新建/图标下拉选择/删除）
- 卡片右侧竖排图标显示已收藏分组，双击图标跳转到分组
- ＋按钮 popover 菜单选择分组收藏
- 一个提示词可被多个分组同时收藏
- 原图/原视频查看器右栏：勾选列表控制收藏归属（勾选添加/取消移除）

### 自定义词包 📁
- 创建/删除/导出 TXT+JSON
- 批量添加词条到词包

### 批量操作
- 顶部 ✓ 激活批量模式 → 勾选 → 批量复制/导出 TXT+JSON/加词包

### 最近使用 ⏰
- 复制自动记录 / 清空 / 单条删除

### 缩略图系统 🖼️
- 上传 + Pillow 自动 3:2 裁剪成 240x160 + 图库选取 + 移除
- 原图查看器（滚轮缩放以光标为中心 + 左键拖拽 + Esc 关闭）
- 视频悬停预览 + 上传视频 + ffmpeg 封面提取 + 视频裁剪压缩弹窗（滑块选起止时间+质量选择）
- 视频播放器（时间轴滑块 + 逐帧控制 ±0.1s/±1s/±10s + 播放/暂停 + Esc 关闭）
- 原图/原视频查看器采用左右分栏：左=媒体，右=提示词详情+复制+收藏+勾选列表

### 编辑模式 ✏️
- 顶部 ✏ 按钮切换编辑模式
- 卡片底部出现编辑按钮 → 弹窗修改内容/释义/场景/模块/分类/标签
- 自定义词条可删除，内置词条仅可编辑

### UI 设置
- 深色/浅色主题一键切换（localStorage + 后端持久化）
- 卡片列数滑块（1-6 列精确控制 + 加减按钮）
- 缩略图尺寸随列数自适应（1列400×267 → 6列85×57）
- F5 刷新保持当前视图
- 手机自适应

### 智能推荐
- 复制任意词条后右侧滑出推荐面板（标签匹配算法）

## 目录结构
```
prompt-tool-dev/
├── start.bat                    # 一键启动（含端口检测+防火墙提示）
├── firewall_open.bat/ps1/vbs   # 防火墙一键放行脚本
├── requirements.txt
├── MEMORY.md                    # 长期记忆（会话启动自动注入）
├── backend/
│   ├── main.py                  # FastAPI 入口
│   ├── database.py              # SQLite 8 表 + FTS5 + 触发器
│   ├── seed_data.py             # 151 条种子数据
│   └── api/
│       ├── prompts.py           # 提示词 CRUD（含搜索/分页/收藏归属）
│       ├── v2.py                # 收藏/词包/历史/推荐/主题
│       ├── seedance.py          # Seedance 模板/组装/画廊/速查
│       └── thumbnails.py        # 缩略图/视频上传/裁剪/压缩
├── frontend/
│   ├── index.html               # WebUI 主页面（5视图+10模态框）
│   └── static/
│       ├── css/style.css        # 完整样式（~780 行）
│       └── js/app.js            # SPA 交互逻辑（~2200 行）
├── data/
│   ├── prompts.db               # SQLite 数据库（WAL 模式）
│   ├── thumbnails/              # 裁剪后缩略图 (240x160 JPEG)
│   ├── originals/               # 上传原图
│   └── videos/                  # 上传视频
└── memory/                      # 会话记忆目录
```

## 后端 API 总数：30+
| 端点 | 功能 |
|------|------|
| `GET /api/status` | 服务状态 |
| `GET /api/modules` / `categories` | 模块/分类列表 |
| `GET /api/prompts` | 搜索+筛选+分页+收藏归属 |
| `POST/PUT/DELETE /api/prompts/{id}` | 创建/编辑/删除 |
| `POST /api/prompts/{id}/usage` | 使用计数+历史 |
| `GET/POST/PUT/DELETE /api/v2/collections` | 收藏分组 CRUD |
| `GET/POST/DELETE /api/v2/collections/{id}/items` | 收藏词条管理 |
| `GET /api/v2/collections/prompt-batch` | 批量查询收藏归属 |
| `GET/POST/PUT/DELETE /api/v2/wordpacks` | 词包 CRUD |
| `GET/POST/DELETE /api/v2/wordpacks/{id}/items` | 词包条目管理 |
| `GET /api/v2/wordpacks/{id}/export` | 词包导出 TXT/JSON |
| `GET/DELETE /api/v2/history` | 最近使用 |
| `POST /api/v2/batch/copy` / `batch/export` | 批量复制/导出 |
| `GET /api/v2/recommend/{id}` | 智能推荐 |
| `GET/POST /api/v2/config/theme` | 主题设置 |
| `GET/POST /api/thumbnails/upload` | 图片上传+裁剪 |
| `POST /api/thumbnails/prepare-upload` | 视频预检 |
| `POST /api/thumbnails/trim-video` | 视频裁剪压缩 |
| `GET/POST/DELETE /api/thumbnails/*` | 图库/关联/原图 |
| `GET /api/seedance/*` | Seedance 模板/组装/画廊/速查 |

## 网络配置
- 防火墙 TCP 8080 入站已放行（规则名：PromptKit / PromptKit 8080）
- WiFi 网络设为"专用网络"
- Tailscale 作为备用通道

## 已知故障排除
- 汉字乱码：前端文件必须 UTF-8 无 BOM
- 端口冲突：start.bat 自动检测 8080-8100
- 局域网不通：WiFi 设为专用网络 / 运行 firewall_open.bat
- JS 重复函数定义：检查 console.error，运行 `dedup` 清理
