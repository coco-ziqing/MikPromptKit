# PromptKit — 提示词检索工具

## 项目标识
- 项目：提示词检索工具 (PromptKit)
- 版本：v4.0.0-phase9.3.1 (2026-06-14 会话关闭)
- 工作目录：C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev
- 启动方式：`python backend/main.py` 或 `.\start.bat` **推荐: `.\QUICK_START.bat`**
- 默认端口：8080
- 局域网地址：http://192.168.0.101:8080

## 技术栈
- Python 3.10+ / FastAPI / Uvicorn / SQLite (WAL + FTS5)
- 前端：Bootstrap 5 CDN + Vanilla JS SPA (已拆分为6模块)
- 图片处理：Pillow（自动 3:2 裁剪）
- 视频处理：ffmpeg（封面提取 + 裁剪压缩）
- 语义搜索：sentence-transformers + all-MiniLM-L6-v2
- 版本管理：Git + Git tag

## 项目规模（2026-06-12 更新）
- 后端 API 端点：165 个 (v4: 17 / Seedance: 35)
- 前端 JS 源码：app_core.js(658行) + 5模块 + seedance_v2_composer(1250行) ≈ 8,500 行
- CSS: 2,100 行
- 数据库表：30 张
- 种子词条：165 条（5 模块）
- 实际词条：213 条
- library_assets 词库：302 条（10 类）
- 媒体资产：缩略图 287 / 原图 236 / 视频 23
- 收藏分组：2 / 词包：1

## Git Tag 节点（最近 10 个）
- `v4.0.0-phase9.2-final` — 本次关闭: 组装器v2+审阅+预览+项目管理+深色UI (2026-06-12)
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
