# PromptKit — 提示词检索工具

## 项目标识
- 项目：提示词检索工具 (PromptKit) / 咪卡Mik词库
- 版本：v4.2.0-phase14-arch (2026-06-20)
- 工作目录：C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev
- 启动方式：`python backend/main.py` 或 `.\QUICK_START.bat`
- 默认端口：8080
- 局域网地址：http://192.168.0.101:8080
- 前一个tag: `v4.1.0-phase13.1-hotfix`
- 当前tag: `v4.2.0-phase14-arch` (分类架构重构)

## Phase14 分类架构重构（2026-06-20 23:00）

### 架构变更
```
📷 图像描述词库 (root_image)
├── 👤 人物表现 → emotion(26) + 神态情绪(8) + 服饰道具(7)
├── 🎨 画面调性 → color(31) + tone(23) + 光影(10) + 质感(8) + 配色(8) + 滤镜(6)
├── 🖼️ 构图与画质 → composition(52) + 画风(8) + 画质(6) + 虚实(5) + 胶片(5) + 构图(8)
├── 🌍 时空风格 → 年代(7) + 地域(6) + 人文环境(6)
├── ⚠️ 负面提示词 → negative(9)
└── 🗂️ 自定义收纳 → 12个自定义分组

🎬 视频描述词库 (root_video)
├── 🎥 运镜与构图 → 运镜(13) + 构图(8) + 焦段(8) + 视角(7) + 拍摄运镜(2)
├── 🔮 主体与场景 → 主体(8) + 场景(10) + 天气(8) + 特效(8) + 外力(7)
├── 🎞️ 动态特效 → 动作(8) + 速率(7) + 物理(6) + 转场(7)
├── 🔊 音频设计 → BGM(25) + 音效(30) + 旁白(35) + 环境音(7)
└── 📹 视频模板 → seedance(19)
```

### 变更清单
| 层级 | 文件 | 内容 |
|------|------|------|
| DB | migrate_phase14.py | 插入2根+11子类 + 50组分配parent_id + 清理空组 |
| 后端 | api/word_cards.py | 新增 `/groups/tree` 树形接口 + create支持parent_id + update放开权限 |
| 前端 | wc_bridge.js | **完全重写**: 树形侧边栏+陈列架+分组CRUD |
| 前端 | app_core.js | init适配Phase14(loadGroupTree+恢复分组选择) |
| 前端 | style.css | 新增 .showcase-card / .tree-node / .tree-arrow |
| 前端 | index.html | 版本号: wc_bridge v8 / app_core v12 / style v12 |

### 版本号
- wc_bridge.js: v7 → v8
- app_core.js: v11.1 → v12.0
- style.css: v11.0 → v12.0

## Phase13.1 热修复 — UTF-8编码修复（2026-06-20）

### 根因
`index.html` 被写入时发生 UTF-8 双重编码（mojibake）：正确的 UTF-8 中文被当成 Latin-1 再次编码为 UTF-8，导致所有中文变成乱码（如 `咪卡`→`鍜崱`）。commit `9123a56` 引入了损坏，所有后续 commit 继承。

### 修复清单（共 10 项）

| # | 问题 | 修复方案 | 文件 |
|---|------|---------|------|
| 1 | 版本号显示 `vv4.1.0` | `v.replace('v','')` → `v.replace(/^v+/i, '')` | app_core.js |
| 2 | 品牌名未统一 | 统一为「咪卡Mik词库」 | index.html + app_core.js |
| 3 | 词卡管理页侧边栏消失 | `_hideSidebar()` → `_showSidebar()+_collapseSidebar()` | app_core.js |
| 4 | 媒体资产视图空白 | 恢复被误删的 viewV4media + v4_library.js | index.html |
| 5 | 每次F5都跑自检 | sessionStorage `_pk_health_checked` 标记 | app_core.js |
| 6 | 中英文切换失效 | 重写 i18n 引擎（data-i18n + _applyI18n）+ 按钮 | app_i18n.js + index.html |
| 7 | 编辑模式新建分组走旧API | `POST /api/v4/word-cards/groups`（原生fetch） | app_editor.js |
| 8 | 新建空分组侧边栏不显示 | `?include_empty=true` 参数 | wc_bridge.js |
| 9 | 保存后侧边栏不刷新计数 | save/create 后 `await App.loadModules()` | word_editor.js + app_editor.js |
| 10 | **index.html UTF-8双重编码乱码** | 从干净 commit `06c47ca` 恢复 + 25项版本号升级 | index.html |

**版本号全面升级：** style.css→v11.0 / app_core.js→v11.1 / app_editor.js→v11.3 / wc_bridge.js→v7 + 其余21项

## Phase13 短期迭代完成（2026-06-19）

| 分支 | 内容 | 文件变更 |
|------|------|---------|
| P13.1 | bridge加固(custom_前缀、等待机制、双保险映射) + 词卡导入导出CSV/JSON + 拖拽移动sort_order | 2个文件 |
| P13.2 | CSS硬编码修复6处 + 骨架屏 + app_search.js/app_theme.js拆分 + _safeFetch错误边界 | 5个文件, +387行 |
| P13.3 | i18n模块 + en.json词典(105 key) + 语言切换按钮 | 3个文件, +214行 |
| P13.4 | 组装器快捷键(Ctrl+S/↑↓/Esc/撤销) + 脏标记渲染 + 撤销栈 + 高级搜索API | 2个文件, +186行 |

**Git分支说明：**
- `phase13-p131-bridge` / `phase13-p132-refactor` / `phase13-p133-i18n` / `phase13-p134-ux`
- 已全部合并到 `master`

## 技术栈
- Python 3.14 / FastAPI / Uvicorn / SQLite (WAL + FTS5)
- 前端：Bootstrap 5 CDN + Vanilla JS SPA (拆分为15模块)
- 图片处理：Pillow（自动 3:2 裁剪 + AI渐变渲染）
- 视频处理：ffmpeg（封面提取 + 裁剪压缩）
- 语义搜索：sentence-transformers + all-MiniLM-L6-v2 + LLM Rerank
- AI引擎：Ollama 本地大模型池(16模型) — 翻译/优化/标签/搜索重排/缩略图
- 版本管理：Git + Git tag

## 项目规模（2026-06-20 Phase14 架构重构后）
- 后端 API 模块：25 个
- 后端 API 端点：200+
- 前端 JS 源码：22 模块 ≈ 15,000 行
- CSS: 2,600+ 行
- 数据库表：30+ 张
- 词卡（word_cards）：694 条
- 分组：62 个（2 根 + 11 子类 + 34 叶子 + 15 自定义）
- 旧卡（v4/cards）：151 条
- library_assets 词库：233 条

## Git Tag 节点（最近 7 个）
- `v4.2.0-phase14-arch` — 分类架构重构: 双总类嵌套树+陈列架+分组CRUD (2026-06-20)
- `v4.1.0-phase13.1-hotfix` — UTF-8双重编码乱码根因修复 + 10项bug修复 + 25项版本号升级 (2026-06-20)
- `v4.1.0-phase13-complete` — Phase13短期迭代完成 (2026-06-19)
- `v4.1.0-phase13-current` — Phase13开始前快照
- `v4.1.0-phase13` — Phase13 打标
- `v4.0.0-phase12` — Phase12: AI全栈升级 (2026-06-19)
- `v4.0.0-phase11.1` — 实时信号灯 (2026-06-18)
- `v4.0.0-phase10.2` — 角色头像裁剪: 拖拽选框+宽高比锁(1:1头像/3:2预览) (2026-06-17)
- `v4.0.0-phase10.1` — 角色库系统: 8种子角色+CRUD+viewer+场景嵌入 (2026-06-17)
- `v4.0.0-phase9.4` — 深色模式全面适配: 44处修复 (2026-06-15)
- `v4.0.0-phase9.1-ui` — 组装器前端对接: 5格式/3密度/音频面板+4K-8K (2026-06-12)
- `v4.0.0-phase9-assembler` — 组装器v2引擎: 5格式+像素分辨率+音频+3档密度 (2026-06-12)
- `v4.0.0-phase8.6-split` — 前端拆分: app.js→6模块(264方法零丢失) (2026-06-12)
- `v4.0.0-phase8.5-vm` — 版本管理: 编辑自动存档+完整回滚+v4历史/diff (2026-06-12)：防重复渲染bug + 画风/负面词库API+选取器 + 输出预览实时刷新 + 全局默认值持久化 + 画幅分辨率参数修正 + UI精简 (2026-06-07)
- `v3.10.24` — 会话关闭前完整备份快照 (2026-06-04)
- `v3.10.23` — 非编辑模式禁用拖入导入功能 (2026-06-03)
- `v3.10.22` — PNG拖拽导入失败修复 — File流被预览消耗后无法复用
- `v3.10.21` — 拖入缩略图区域替换+Ctrl+Z撤销
- `v3.10.20` — 统一单 document 级 drop 处理器解决闪烁+弹窗不显示
- `v3.10.19` — 移除PNG拖入虚线覆盖层(globalDropZone)消除闪烁
- `v3.10.16` ~ `v3.10.18` — 拖拽冲突系列修复
- `v3.10.14` — 分镜构图模块主体描述+构图词组合优化
- `v3.10.13` — 模块切换标题修复
- `v3.10.12` — 模块切换后标题显示
- `v3.10.10` — OCR截图导入保存原图到媒体资产管理库
- `v3.10.9` — 截图导入模块默认值改为当前所在模块
- `v3.10.7` — 编辑模式卡片新增「移动到其他模块」下拉
- `v3.10.6` — Ctrl+V预览剪贴板图片 → 确认后再分析
- `v3.10.5` — 粘贴弹窗打开即激活监听
- `v3.10.4` — 粘贴剪贴板图片在HTTP局域网下修复
- `v3.10.3` — 截图导入窗口新增粘贴按钮
- `v3.10.2` — AI生成原图不显示修复
- `v3.10.1` — AI生成缩略图async httpx死锁修复
- `v3.10.0` — 后端媒体资产管理库
- `v3.9.3` — safe_commit参数修复
- `v3.9.2` — OCR超时/故障修复(3项)
- `v3.9.1` — OCR故障修复(3项)
- `v3.9.0` — OCR预扫描语言检测+智能模型路由
- `v3.8.1` — OCR视觉模型配置修复
- `v3.8.0` — 截图导入替换脚本导致JS语法错误修复
- `v3.7.1` — 移动端汉堡菜单修复
- `v3.6.2` — 翻译对照显示 + 全选/取消切换 + 模块主体预设编辑器 + 缩略图清除按钮 + AI生成确认替换 + 翻译缓存清除（2026-06-02）
- `v3.6.1` — Bugfix: PNG拖拽导入确认弹窗修复 + 滚动位置恢复 + 卡片缩略图拖拽覆盖修复（2026-06-02）
- `v3.6.0` — 卡片布局垂直重构 + 收藏夹显示修复 + .pkb包系统 + 数据同步（2026-06-02）
- `v3.5.0` — 翻译(Ollama) + PNG导出元数据 + 拖拽上传
- `v3.4.0` — ComfyUI缩略图生成 + 模块预设 + 批量AI生成
- `v3.3.0` — 拖拽排序 + Markdown导出 + 浏览器扩展 + OCR导入
- `v3.2.0` — AI Workflow API
- `v3.1.3` — 提示词模板变量
- `v3.1.2` — LLM Playground + 快捷键 + 标签 + 统计 + 移动端
- `v3.1.1` — 语义搜索 + 版本管理
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

## v3.6.0 新增功能 — 数据同步 (.pkb 包系统)

### .pkb 完整打包
- 格式：标准 ZIP 包，含 prompts.db + 缩略图 + 原图 + 视频 + manifest.json
- `POST /api/sync/export` — 导出完整包（含媒体）
- `POST /api/sync/export-no-media` — 导出纯 DB 包
- `GET /api/sync/packages` — 列表（含 manifest 摘要）
- `GET /api/sync/packages/{name}` — 包详情（文件清单）
- `POST /api/sync/restore/{name}` — 恢复（自动备份当前数据）
- `POST /api/sync/upload` — 上传 .pkb 文件导入
- `DELETE /api/sync/packages/{name}` — 删除

### 前端同步面板
- 工具栏新增 ↔ 按钮打开同步面板
- 包列表：名称/大小/时间/含媒体标记
- 点击行展开详情（提示词数、文件数、媒体统计）
- 操作：恢复 / 删除 / 导出完整包 / 导入 .pkb 文件
- 自动清理：保留最近 20 个包

## 开发路线图 & 竞品分析
- 完整路线图: `memory/DEVELOPMENT_ROADMAP.md`（长期记忆，每次会话自动注入）
- 竞品调研报告: `research/competitor_analysis_v3.6.0.md`（12款工具对比）
- 当前定位: AI创作者本地媒体+提示词一体化工作站
- 下阶段推荐: v3.7.0 — 版本管理 + 模板变量 + 标签升级

## 目录结构
```
prompt-tool-dev/
├── QUICK_START.bat              # 快捷启动（端口自适应+防火墙提示）【推荐】
├── PROJECT_SUMMARY.md           # 项目完整备份快照（2026-06-04）
├── start.bat                    # 一键启动（含端口检测+防火墙提示）
├── firewall_open.bat/ps1/vbs   # 防火墙一键放行脚本
├── requirements.txt
├── MEMORY.md                    # 长期记忆（会话启动自动注入）
├── backend/
│   ├── main.py                  # FastAPI 入口（20个路由挂载）
│   ├── database.py              # SQLite 23 表 + FTS5 + 触发器
│   ├── seed_data.py             # 165 条种子数据
│   ├── backup.py                # 自动备份核心
│   ├── sync.py                  # .pkb 打包/恢复/管理
│   ├── semantic.py              # 语义搜索
│   ├── exporter.py              # 导出功能
│   └── api/
│       ├── prompts.py           # 提示词 CRUD（含搜索/分页/收藏归属）
│       ├── v2.py                # 收藏/词包/历史/推荐/主题（940行核心）
│       ├── seedance.py          # Seedance 模板/组装/画廊/速查
│       ├── thumbnails.py        # 缩略图/视频上传/裁剪/压缩（915行）
│       ├── exporter.py          # 批量导出
│       ├── versions.py          # 版本管理
│       ├── playground.py        # LLM Playground
│       ├── tags.py              # 标签管理
│       ├── stats.py             # 统计
│       ├── templates.py         # 模板变量
│       ├── workflow.py          # AI Workflow API
│       ├── comfyui.py           # ComfyUI 缩略图生成（507行）
│       └── ocr.py               # OCR 截图导入（528行）
├── frontend/
│   ├── index.html               # WebUI 主页面（721行/73KB）
│   └── static/
│       ├── css/style.css        # 完整样式（1,371行/45KB）
│       └── js/app.js            # SPA 交互逻辑（5,617行/301KB）
├── browser-extension/
│   ├── manifest.json            # Chrome 扩展清单
│   ├── background.js            # 后台脚本
│   ├── content.js               # 内容注入
│   ├── popup.html               # 弹窗界面
│   └── popup.js                 # 弹窗逻辑
├── data/
│   ├── prompts.db               # SQLite 数据库（WAL 模式，704KB）
│   ├── packages/                # .pkb 备份包
│   ├── backups/                 # 自动备份历史
│   ├── thumbnails/              # 裁剪后缩略图 (240x160 JPEG, 287个)
│   ├── originals/               # 上传原图（236个, 418MB）
│   └── videos/                  # 上传视频（23个, 355MB）
├── memory/                      # 会话记忆目录
└── 开发需求/                     # 需求文档
```

## 后端 API 总数：120+
| 端点 | 功能 |
|------|------|
| `GET /api/status` | 服务状态（含cards/library统计）|
| `GET /api/v4/cards` | 统一提示词卡列表（搜索+类型/模块/分类筛选）|
| `POST/PUT/DELETE /api/v4/cards/{id}` | 提示词卡创建/编辑/删除 |
| `GET /api/v4/library` | 统一词库资产列表（类型/分类筛选）|
| `GET/POST/PUT/DELETE /api/v4/library/{id}` | 词库条目 CRUD |
| `GET /api/v4/library/types` | 词库类型统计 |
| `GET /api/v4/library/categories` | 词库分类列表 |
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
| `POST /api/sync/export` | .pkb 完整导出 |
| `POST /api/sync/restore/{name}` | .pkb 恢复 |
| `POST /api/ocr/analyze` | OCR 截图分析 |
| `POST /api/comfyui/generate` | ComfyUI 缩略图生成 |

## 网络配置
- 防火墙 TCP 8080 入站已放行（规则名：PromptKit / PromptKit 8080）
- WiFi 网络设为"专用网络"
- Tailscale 作为备用通道
- 当前内网IP：192.168.0.103

## 架构升级规划
- 完整方案: `memory/ARCHITECTURE_PLAN_v4.md`
- 核心理念：提示词卡作为系统基础数据单元
- 5 个 Phase：数据结构重构 → 词库统一 → 媒体资产管理统一 → 高级功能重建 → 导入导出标准化
- 下次会话优先启动 Phase 1：prompt_cards 表 + 迁移脚本

## 已安装 ClawHub 技能
- `page-builder` — WebUI 页面生成
- `api-tester` — API 测试
- `log-analyzer` — 日志分析
- `bug-fixer` — Bug 修复

## 会话关闭备忘（2026-06-14 23:59）
本次关闭前已完成以下操作：
1. ✅ 数据库 WAL checkpoint 合并（WAL 已清除）
2. ✅ Git 打标 v4.0.0-phase9.3.1
3. ✅ MEMORY.md 更新 + 会话记忆归档
4. ✅ EXE 重新封装 `dist/PromptKit/`

## 本次会话成果总结（Phase 9.3.1 — 6项 Bugfix）

### 数据封装修复
- `seed_migrate` → 内联 `_migrate_v4()` 到 main.py，避免 PyInstaller 丢失模块
- 修复启动顺序：Seedance V2 初始化必须在 v4 迁移之前，否则 `library_assets` 为 0

### 新建项目报错修复
- `database.py` CREATE TABLE `user_project` 缺 `bgm/sfx/dialogue/template_id` 4列 → 建表补全 + ALTER TABLE 幂等迁移
- `user_project_scene` 缺 `duration/is_manual/is_locked` → 同补

### 模块英文名修复
- `app_editor.js` 侧边栏 `names` 映射缺 `composition: '分镜构图'` 键 → 补充
- `app_core.js` 卡片徽章 `card.module` 直接显示原始 ID → 加 `_moduleDisplayName()` 统一翻译
- `v3_composer.js` / `v4_cards.js` 同理修复
- API 后端 `_module_name()` 补 `composition` 映射

### EXE 打包优化
- `sync.py` 路径从硬编码改为 `paths.py` 统一解析（开发/封装通用）
- 移除 `backend.` 前缀导入
- 主入口端口自兜底 8080→8089
- 启动失败 pause 保留错误信息
- 删除残留 `dist/PromptKit.exe` 单文件

### Git 变更
- `git tag v4.0.0-phase9.3.1`
- 排除：data/ 目录（含 .pkb 备份、缩略图、原图、视频）

## 会话关闭备忘（2026-06-12 20:10）
本次关闭前已完成以下操作：
1. ✅ 数据库 WAL checkpoint 合并（WAL 已清除）
2. ✅ Git 打标 v4.0.0-phase9.2-final
3. ✅ MEMORY.md 更新 + 会话记忆归档到 memory/2026-06-12.md

## 本次会话成果总结（Phase 8.5 — Phase 9.2）

### 版本管理系统 (v4.0.0-phase8.5-vm)
- 编辑自动存档：每次编辑前将完整状态存入 prompt_versions
- 完整回滚：恢复全部字段（原仅恢复2个）
- v4 版本历史 API: GET /cards/{id}/versions, v4 diff

### 前端拆分 (v4.0.0-phase8.6-split)
- app.js 6164行→6模块: app_core/tools/sync/collections/media/editor
- 264方法零丢失，Object.assign 注入

### 组装器v2 (Phase 9-9.2)
- 5平台多格式引擎：Seedance/Kling/MiniMax/ComfyUI/Raw
- 像素级分辨率计算：16:9 4K→3840×2160, 9:16→2160×3840
- 3档密度：compact/standard/detailed
- 音频支持：BGM+音效+对白
- 镜头文本审阅弹窗（衬线体阅读排版+ESC关闭+一键复制）
- 字段悬停预览：鼠标悬停标签弹出词卡缩略图/视频
- 项目重命名保存+卡片移动修复（v4表读写统一）
- 侧边栏折叠按钮（fixed定位+localStorage记忆）
- 深色主题按钮/标签可读性修复（!important+ID优先）

### 架构补丁
- 模块统计改为 prompt_cards 主表（不再双表重复计数）
- PUT端点数据表统一（/api/v4/cards替代/api/prompts）
- 创建项目时长上限15s→60s

---

## 📦 跨平台封装规则（2026-06-15 macOS 适配实战总结）

> ⚠️ **每次版本更新重新封装时，必须逐条核对以下规则，避免重复踩坑！**

### 一、源码分发 ZIP 打包（Windows → macOS/Linux）

| # | 规则 | 原因 |
|---|------|------|
| 1 | **必须用 Python `zipfile` 打包**，禁止 Windows Compress-Archive | PowerShell 的 `Compress-Archive` 用反斜杠 `\` 做路径分隔符，macOS/Linux 解压后目录结构彻底损坏（`backend/main.py` 变 `backend\main.py` 扁平文件名） |
| 2 | **路径分隔符强制正斜杠** `/` | `arcname = '/'.join(parts)` 或 `Path.as_posix()` |
| 3 | **排除 `__pycache__/`** | 字节码缓存与 Python 版本绑定，跨平台不可用且增加体积 |
| 4 | **排除 `data/` 目录** | 含用户媒体文件（GB 级），源码分发仅含代码+配置 |
| 5 | **排除 `dist/` `.git/` `memory/` `node_modules/`** | 构建产物、版本控制、会话记忆均不随源码分发 |

### 二、`requirements.txt` 版本约束

| # | 规则 | 原因 |
|---|------|------|
| 1 | `numpy<2`（非 `numpy==2.x`） | NumPy 2.x 与旧 PyTorch（macOS Intel GPU → CPU fallback）二进制不兼容，报 `_ARRAY_API not found` |
| 2 | `sentence-transformers` 不加 `==` 固定版本 | 让其自动匹配 PyTorch/transformers 兼容版本 |
| 3 | 必须包含 `python-multipart` | FastAPI UploadFile/Form 依赖此包，缺失则 RuntimeError |
| 4 | 必须包含 `torch` | macOS PyTorch 版本由 pip 根据架构自动选择（Intel x86 vs Apple Silicon） |
| 5 | 必须包含 `aiofiles` | 异步文件操作依赖，缺失则媒体上传失败 |

### 三、跨平台代码兼容

| # | 规则 | 原因 |
|---|------|------|
| 1 | **所有平台专有 API 必须 `except Exception` 兜底**（非仅 `except ImportError`） | macOS 上 PyTorch/transformers 加载失败可能是 `NameError`、`RuntimeError`、`UserWarning` 等，`except ImportError` 兜不住 |
| 2 | `msvcrt` 仅 Windows 有 → `try: import msvcrt except ImportError: input()` | macOS/Linux 无此模块 |
| 3 | `paths.py` 统一路径解析，禁止硬编码 `\\` 或盘符 `C:\` | `os.path.join()` / `pathlib.Path` 自动适配分隔符 |
| 4 | 语义搜索（ML）模块必须优雅降级 | 2013年 iMac 无 GPU，`sentence-transformers` 加载失败不应阻止核心提示词检索功能 |

### 四、macOS 部署特有

| # | 规则 | 原因 |
|---|------|------|
| 1 | `.command` 文件分发后需 `chmod +x` | macOS 从外部来源复制的脚本默认剥夺执行权限 |
| 2 | `.command` 文件需 `xattr -cr` 清除隔离标记 | macOS Gatekeeper 对下载文件打 `com.apple.quarantine` 标记，Finder 右键打开不够 |
| 3 | 启动器使用 `#!/bin/bash`（非 `#!/bin/zsh`） | bash 兼容性好，Catalina 默认 bash |
| 4 | 启动器必须自动探测 Python 版本（`python3.12 python3 python` 依次尝试） | 用户可能自装不同版本 |
| 5 | 首选 `venv` 虚拟环境安装依赖 | 避免污染系统 Python |
| 6 | 启动器检测 `ffmpeg` 缺失时不崩溃，仅警告 | 视频上传非核心功能，不应阻断启动 |

### 五、Windows EXE 封装（PyInstaller）

> ⚠️ **以下规则来自 v4.0.0-phase9.3.1 实战踩坑总结（2026-06-14），每条背后都是实际崩溃！**

| # | 规则 | 原因 |
|---|------|------|
| 1 | `seed_migrate.py` 等独立模块 → **内联到 `main.py`** | PyInstaller 静态分析不一定发现动态 import 引用模块，打包后 `ModuleNotFoundError` |
| 2 | Spec 文件 `hiddenimports` 必须补全 | `uvicorn.logging`, `uvicorn.loops.auto`, `uvicorn.protocols.http.auto`, `fastapi`, `aiohttp`, `PIL._imaging`, `sentence_transformers`, `numpy`, `aiofiles`, `sqlite3` 等 |
| 3 | **启动顺序不可颠倒**：Seedance V2 种子数据初始化 → v4 迁移 `_migrate_v4()` → 路由挂载 | 先初始化种子数据再迁移，否则 `library_assets` 为空（0 条），迁移后所有模块无数据 |
| 4 | `database.py` 建表必须幂等 | `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` 补缺失列（旧数据库可能缺列如 `bgm/sfx/dialogue/template_id` 4列、`duration/is_manual/is_locked` 3列） |
| 5 | 端口自兜底 `8080~8089` | 避免 EXE 双击即崩溃，占用时自动探测下一个可用端口 |
| 6 | 打包后 `__main__` 中不应有 `msvcrt.getch()` 裸调用 | 需 `try: msvcrt.getch() except ImportError: input()` 包裹 |
| 7 | `sync.py` / 所有模块路径必须走 `paths.py` 统一解析 | 禁止硬编码 `backend\` 前缀或盘符，PyInstaller 打包后 sys.path 结构变化 |
| 8 | 移除所有 `backend.` 前缀导入 | PyInstaller onedir 模式根目录即含 backend，前缀会导致双重路径查找失败 |
| 9 | onedir 模式优先（非 `--onefile`） | onedir 启动快、依赖可见、升级替换单文件即可；onefile 解压慢且易触发杀毒误报 |
| 10 | 启动失败必须 pause 保留错误信息 | 打包 EXE 双击启动，窗口一闪而过无法看到错误，`input()` 保持窗口不关 |
| 11 | `build.spec` 中 `excludes` 排除不必要大型库 | `tkinter`, `PyQt5`, `PySide6`, `wx`, `matplotlib`, `scipy`, `pandas`, `torch`, `tensorflow` 等不用的库可缩减几十 MB |
| 12 | 前端 `card.module` 显示必须经 `_moduleDisplayName()` 翻译 | 新增模块（如 `composition`）须同步更新后端 `_module_name()` 和前端所有出现位置的映射表 |

#### 5.1 PyInstaller Spec 模板关键段

```python
# hiddenimports 必须补全（否则启动时报 ImportError）
hiddenimports=[
    'uvicorn.logging',
    'uvicorn.loops.auto',
    'uvicorn.protocols.http.auto',
    'fastapi',
    'aiohttp',
    'PIL._imaging',
    'sentence_transformers',
    'numpy',
    'aiofiles',
    'sqlite3',
    'asyncio',
],

# excludes 缩减体积（Pytorch/tensorflow 不打包，ML用轻量模型）
excludes=[
    'tkinter', 'PyQt5', 'PySide6', 'wx',
    'matplotlib', 'scipy', 'pandas',
    'torch', 'tensorflow',
],

# 启动入口：backend/main.py（非直接 main.py）
Analysis(['backend/main.py'], ...)
```

#### 5.2 启动顺序伪代码

```python
# 正确的初始化顺序（错一步全空）
init_db()                          # 1. 建表（幂等）
seed_data.init_seedance_v2(db)     # 2. Seedance V2 种子（写入 library_assets）
_migrate_v4(db)                    # 3. v4 迁移（依赖上一步的数据）
safe_commit(db)
# 4. 最后挂载路由（此时数据已就绪）
app.include_router(...)
```

#### 5.3 Windows EXE 打包命令

```bash
# onedir 模式（推荐）
pyinstaller build.spec --clean --noconfirm

# 输出在 dist/PromptKit/，含 启动.bat
```

### 六、打包脚本标准模板（Python zipfile）

```python
import zipfile
from pathlib import Path

root = Path('项目根目录')
dest = Path('输出.zip')

# 白名单模式，只打包明确需要的目录/文件
include_dirs = {'backend', 'frontend', 'browser-extension'}
include_files = {'start.command', 'INSTALL_MACOS.md', 'requirements.txt', ...}

with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED) as zf:
    for f in sorted(root.iterdir()):
        if f.is_dir() and f.name in include_dirs:
            for sf in f.rglob('*'):
                if sf.is_file() and '__pycache__' not in sf.parts:
                    arcname = '/'.join(sf.relative_to(root).parts)  # 正斜杠!
                    zf.write(sf, arcname)
        elif f.is_file() and f.name in include_files:
            zf.write(f, f.name)
```

### 七、交付前检查清单

- [ ] ZIP 包在 Windows 解压验证：文件夹结构正常
- [ ] ZIP 包在 macOS 解压验证：`ls backend/main.py` 能列出文件（非 `backend\main.py`）
- [ ] `start.command` 有执行权限（`chmod +x`）
- [ ] `requirements.txt` 含全部依赖（含 `python-multipart`, `aiofiles`, `torch`）
- [ ] `numpy<2` 约束已设置
- [ ] `semantic.py` 捕获 `Exception`（非仅 `ImportError`）
- [ ] 无 Windows 专有 API 裸调用（`msvcrt` 等）
- [ ] `.gitignore` 排除 `dist/`, `data/`, `__pycache__/`, `venv/`, `*.pyc`
- [ ] bundle内 `INSTALL_MACOS.md` 已同步更新

---

## 🎨 深色/亮色模式校验规则（2026-06-15 全模块排查总结）

> ⚠️ **每次新增 UI 组件或模块后，必须逐条核对以下规则，避免"切到亮色模式后背景仍是深色"类 bug！**

### 一、CSS 变量架构铁律

| # | 规则 | 原因 |
|---|------|------|
| 1 | **`:root` 必须是亮色默认值**，禁止在 `:root` 中硬编码深色值 | 亮色/深色切换依靠 CSS 变量覆盖，`:root` 值=亮色，`body.dark-theme` 值=深色；若 `:root` 写了深色，切亮色无效 |
| 2 | **每个 CSS 变量必须在 `:root` 和 `body.dark-theme` 两处同时定义** | 缺一则模式切换时该变量不跟随变化 |
| 3 | **新增颜色必须优先用 CSS 变量** | 禁止在组件样式中硬编码 `#ffffff` / `#1e293b` 等固定色值 |
| 4 | **所有 `--*-bg` / `--*-text` / `--*-border` 语义变量也必须双处定义** | 例如 `--card-bg` `--tag-bg` `--danger-bg` `--hover-bg` 等 |

### 二、禁止模式（会直接导致 bug）

| # | 禁止写什么 | 为什么 | 正确写法 |
|---|-----------|--------|---------|
| 1 | `background: #ffffff` | 永远白色，深色模式不跟随 | `background: var(--bg-card)` |
| 2 | `background: #f1f5f9` | 永远浅灰 | `background: var(--hover-bg)` |
| 3 | `background: #eef2ff` | 永远浅蓝 | `background: rgba(79,70,229,0.12)`（主题色叠加，通用） |
| 4 | `color: #64748b` | 永远中灰，深色背景下不可读 | `color: var(--text-muted)` |
| 5 | `border-color: #e2e8f0` | 永远浅灰边框 | `border-color: var(--border-color)` |
| 6 | `border-top: 1px solid #f1f5f9` | 永远浅灰 | `border-top: 1px solid var(--border-color)` |
| 7 | `<span class="badge bg-light text-dark">` | Bootstrap 固定类，不随主题变 | CSS 新增 `body.dark-theme #headerStats { ... }` 覆盖 |

### 三、必须覆盖的核心选择器清单

新增任何前端模块后，检查以下选择器是否有 `body.dark-theme` 适配：

| 区域 | 必须覆盖的选择器示例 |
|------|---------------------|
| 顶部导航 | `.navbar-tool`, `.header-btn`, `.header-btn:hover`, `.header-btn.active`, `.search-box input`, `.search-box .search-icon` |
| 侧边栏 | `.sidebar`, `.module-item`, `.module-item:hover`, `.module-item.active`, `.count-badge` |
| 卡片 | `.prompt-card`, `.prompt-card .card-content`, `.prompt-card .card-scene`, `.prompt-card .card-badge`, `.prompt-card.selected`, `.prompt-card.copy-flash` |
| 分类标签 | `.cat-tab`, `.cat-tab:hover`, `.cat-tab.active` |
| 弹窗 | `.modal-content`, `.modal-input`, `.confirm-modal`, `.collect-popover` |
| 推荐面板 | `.recommend-panel`, `.rec-item`, `.rec-empty` |
| 收藏/词包 | `.collection-card`, `.card-action-btn`, `.coll-add-btn` |
| 查看器 | `.viewer-right`, `.viewer-btn-collect` |
| 种子舞 | `.s2-project-item`, `.s2-editor-header`, `.s2-section`, `.s2-search-box`, `.s2-output-section`, `.s2-picker-card` |
| 类型徽章 | `.card-type-image`, `.card-type-video` |
| 状态指示 | `.empty-state`, `.loading-spinner`, `.page-header .count-info` |

### 四、JS/HTML 内联样式校验

| # | 规则 | 原因 |
|---|------|------|
| 1 | JS 动态生成 DOM 时，内联 `style="background:..."` 必须写 `var(--bg-card,#fff)` 带 fallback | 双保险：有 CSS 变量用变量，没有就回退白色 |
| 2 | `color:#fff` 的白色文字可保留（纯装饰性，深浅都可见） | 前提是承载它的背景一定是深色/亮色都有足够对比度 |
| 3 | 绿色/红色等语义色（如删除、成功）无需跟随主题变换 | 但需在深色下调整饱和度（如 `#ef4444`→`#f87171`）避免刺眼 |

### 五、新增 UI 组件的检查清单

每新增一个带背景色的 UI 区域，检查：

- [ ] 背景色用了 `var(--*)` 还是硬编码？
- [ ] 如果是硬编码，是否已在 `body.dark-theme` 中添加覆盖？
- [ ] 文字颜色对比度在两种模式下是否都 ≥ 4.5:1？
- [ ] 边框色是否用了 `var(--border-color)`？
- [ ] hover/active 状态两种模式下是否都有适配？
- [ ] 如果是 JS 动态生成 DOM，是否有 fallback 值？

### 六、本次修复实际数据

> 2026-06-15 全模块排查：共修复 **44 处** 深色/亮色模式不匹配问题

| 类别 | 数量 |
|------|------|
| 新增缺失 CSS 变量 | 4（`--card-bg` `--tag-bg` `--danger-bg` `--danger`） |
| `:root` 变量浅色化修正 | 3（`--bg-sidebar` `--text-sidebar` `--text-sidebar-active`） |
| `body.dark-theme` 变量补充 | 4（同上 + 新增 4 个） |
| 硬编码→CSS 变量转换 | 12 处 |
| 新增 `body.dark-theme` 选择器 | 28 处 |
| HTML 内联类覆盖 | 1 处（`#headerStats`） |
