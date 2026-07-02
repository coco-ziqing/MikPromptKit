# PromptKit — 提示词检索工具

## 项目标识
- 项目：提示词检索工具 (PromptKit) / 咪卡Mik词库
- 版本：v5.3.7-phase17-word-editor-video (2026-07-02)
- 工作目录：C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev
- 启动方式：`python backend/main.py` 或 `.\QUICK_START.bat`
- 默认端口：8080（自增 8080→8089）
- 局域网地址：http://192.168.0.101:8080
- 当前tag: `v5.3.7-phase17-word-editor-video` (词卡编辑器视频上传按钮 + 视频库选取 + assign-video热修复 + .gitignore加固)

## Phase17.1 视频首帧封面修复（2026-07-02 13:10）

### 问题
- 视频卡片只显示「⏵ 播放」占位符 SVG，不显示视频首帧静态图
- 原因3层：
  1. `cards.py` 读 `prompt_videos` 时遗漏 `poster` 字段
  2. `upload-video` 和 word_card video 上传的 ffmpeg 首帧提取是**异步线程**，前端拿到响应时 poster 文件可能还不存在
  3. `prompt_videos.poster` 存在于 DB 但未映射到前端 `thumbnail` 字段

### 修复清单（4层）

| # | 层级 | 文件 | 修复内容 |
|---|------|------|---------|
| 1 | 后端 | `cards.py` | `prompt_videos` 查询增加 `poster/fps/width/height` 字段；`thumbnail` 为空时用 `video_poster` 回退 |
| 2 | 后端 | `thumbnails.py:upload_video` | ffmpeg 首帧提取从**异步线程**改为**同步**（~100ms）；仅元数据探测异步 |
| 3 | 后端 | `word_cards.py:POST /video` | 同上：同步提取首帧 + 同步写 thumbnail 到 DB |
| 4 | 后端 | `word_cards.py:video-from-library` | 从源视频同步提取首帧 + 立即写 DB，视频 copy 异步 |
| 5 | 前端 | `app_editor.js:renderPrompts` | 视频卡片增加 `.thumb-play-overlay`（播放▶提示图标） |
| 6 | CSS | `style.css` | 新增 `.thumb-play-overlay` 规则（半透明圆形+三角形▶，悬停时淡出） |

### 原理解释
```
上传视频 → ffmpeg同步截取第1帧（100ms）→ 写入 data/thumbnails/{base}.jpg
         → 响应返回 poster_filename（保证存在）
         → 前端收到 poster_ok=True，poster_url 立即可用
         → 卡片渲染：<img poster> (z-index:1 常显) + <video> (z-index:0 opacity:0 隐藏)
         → 鼠标悬停：poster z-index→0，video z-index→2, opacity→1 → 播放预览
```

### 版本号
- style.css: v12.8 → **v12.9**
- app_editor.js: v11.3 → **v11.4**

## Phase17.1.1 自动修复缺失首帧封面（2026-07-02 13:14）

### 需求
刷新页面时自动检测：有视频但无首帧海报 → 自动 ffmpeg 截取 + 写入 DB + 刷新视图

### 实现
| 层级 | 文件 | 内容 |
|------|------|------|
| 后端 | `thumbnails.py` | 新增 `POST /repair-missing-posters`：扫描 prompt_videos + word_card 3类缺失 → ffmpeg 逐个修复 |
| 前端 | `app_core.js` | `init()` 末尾调用 `_repairMissingPosters()`，`sessionStorage` 标记确保每会话一次 |

### 3 类缺失覆盖
1. `prompt_videos.poster IS NULL` → 提取首帧写入 thumbnails/ + 更新 prompt_videos + prompt_thumbnails
2. `word_card.thumbnail IS NULL AND preview_media != ''` → 提取首帧写入 wc_media/thumbs/ + 更新 word_card
3. `word_card.thumbnail` 有值但磁盘文件不存在 → 重新提取

### 修复结果
- word_card 共 4 条缺 thumbnail：修复 2 条（4K 首帧），2 条视频文件损坏（moov atom not found）
- prompt_videos 无缺失
- 前端：修复后自动 `loadPrompts()` 刷新卡片渲染，首帧立即可见

### 版本号
- app_core.js: v12.4 → **v12.5**
- thumbnails.py: +120 行（新端点）

## Phase17.2 收藏夹编辑模式补全（2026-07-02 13:44）

### 需求
收藏夹分组内页面补全词卡列表拥有的编辑模式功能：批量选中/全选/移出分组

### 变更清单
| 层级 | 文件 | 内容 |
|------|------|------|
| 前端 | `app_tools.js` | `toggleEditMode` 扩展支持 collections 视图；`toggleSelect`/`selectAllPrompts`/`updateBatchCount` 适配收藏夹上下文 |
| 前端 | `app_collections.js` | `renderCollectionItems` 升级：编辑模式 CSS 类(batch-mode/edit-mode)+thumb-play-overlay+缩略图清除按钮；`batchRemoveFromCollection` 批量移出；`backToCollections` 退出编辑 |
| 前端 | `index.html` | batchBar 新增 `btnBatchRemoveColl`（首页隐藏/收藏夹显示） |
| 后端 | `v2.py` | 新增 `POST /collections/{cid}/items/batch-remove` 批量移出 API |

### 功能对齐
```
词卡列表编辑模式（home）       收藏夹编辑模式（collections）
  ✅ 编辑模式切换/toggle           ✅ 同
  ✅ 批量选中/全选/取消全选         ✅ 同（适配 collectionItems 数据源）
  ✅ 批量复制/批量导出             ✅ 继承
  ✅ 批量删除/移入回收站            ✅ 继承
  ✅ 批量移动分组                 ✅ 继承
  ✅ thumb-clear-btn 清除缩略图    ✅ 同（编辑模式下显示）
  — 无                           ✅ 批量移出本分组（专用按钮）
  — 无                           ✅ 返回分组列表自动退出编辑模式
```

### 版本号
- app_tools.js: v9 → **v9.1**
- app_collections.js: v5 → **v5.1**
- v2.py: +15 行
- index.html: +1 按钮

## Phase17 视频上传热修复（2026-07-02 11:42）

### 变更清单
| 层级 | 文件 | 内容 |
|------|------|------|
| 前端 | atom_editor.js | **新建**: 原子编辑器模块（AI拆解面板+原子卡片+三格式导入+归档词卡） |
| 前端 | index.html | 新增导航按钮「⚛ 原子引擎」+ 脚本加载 + 版本号 5.0.0 |
| CSS | style.css | 新增 .atom-editor-* 系列 30+ 规则（三栏布局+卡片+进度条+深色适配） |

### 版本号
- brandVersion: 4.1.0 → **5.0.0**
- atom_editor.js: v1 (新建)
- style.css: v12.7 → **v12.8**

## Phase15 原子引擎加固（2026-06-24 11:00~14:00）

### 架构变更
```
原子化提示词工业化平台 v5.0
├── 🤖 AI提取引擎 → atoms.py (12端点) + atoms_import.py (3导入)
├── 🔗 双向桥接 → atom_word_bridge (原子↔词卡映射)
├── 📊 资产溯源 → GET /atoms/stats (热门Top10/死码检测/类型分布)
├── 📥 多端导入 → CSV/JSON/TXT 一键自动拆解归档
└── 📷 OCR 识别 → extract-from-image (图片文字→原子拆解)
```

### 变更清单
| 层级 | 文件 | 内容 |
|------|------|------|
| 后端 | api/atoms.py | **全新升级**: +4端点 OCR/文本拆解/归档/统计 + atom-type映射表 |
| 后端 | api/atoms_import.py | **新建**: CSV/JSON/TXT 批量导入+自动拆解归档 |
| DB | migrate_atom_tables.py | 新增 atom_word_bridge (3索引) + atom 分组类型修正 |
| 后端 | main.py | 加载 atoms_import 路由 + 版本号 v5.0.0 + 修复导入 (api_log→logger) |
| 工具 | test_atoms_api.py | 全端点测试脚本 |
| 规划 | PLAN_v5.0_PHASE15.md | 完整升级工程规划书 |

### 版本号
- APP_VERSION: v4.1.0-phase13 → **v5.0.0-phase15-atom-engine**
- atoms.py: 5 routes → **12 routes**
- atoms_import.py: **3 routes** (csv/json/txt)

### 原子系统表 (5张)
- atom_decompose: AI拆解缓存 (MD5去重)
- atom_variation: 变异重组结果
- atom_template: 发布模板
- atom_stats: 使用统计
- atom_word_bridge: **新增** 原子↔词卡双向桥接

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

## Phase14.1 侧边栏空白修复 — 7层问题链排查实录（2026-06-21 13:39）

> 症状：侧边栏空白，折叠按钮消失。根因链7层：const App 不挂window → 自引用比对失效 → arguments.callee严格模式崩溃 → _injectSidebarToggle缺失 → signal_lights抢占 → renderSidebar无try-catch。修复7项，详见 `git show v4.2.0-phase14-arch`。

### 经验教训（8条）

1. **`const` 声明顶层对象是危险的**：跨 `<script>` 标签共享对象必须用 `var` 或显式 `window.App = ...`
2. **`self === this` 引用陷阱**：`self.prop !== App.prop` 在 `self === App` 时永远为假，需命名函数表达式
3. **IIFE 等待条件要用 try-catch**：`if (!window.App)` 可能抛 ReferenceError
4. **`'use strict'` + `arguments.callee` 不兼容**：重试循环必须用命名函数
5. **模块加载顺序决定生死**：被依赖者必须在依赖者之前加载
6. **浏览器缓存 + 版本号 = 双刃剑**：修复迭代时需频繁升级版本号 `v=8→9.0→...→9.6`
7. **诊断面板比 F12 Console 快**：排查阶段注入可见的 `#_wcDebug` 面板
8. **try-catch 是所有动态渲染函数的标配**：200行 renderSidebar 应从一开始就包裹

### 当前版本号
- wc_bridge.js v9.6 | app_core.js v12.4 | signal_lights.js v5
- index.html — wc_bridge 移至第1行加载

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
*(50 older tags truncated — full list in CHANGELOG.md)*

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
├── backend/            # Python FastAPI 后端 (25模块/200+端点)
├── frontend/           # WebUI (index.html + static/js/ 22模块/~15000行)
│   └── static/i18n/    # 国际化字典 (en.json 473条)
├── data/               # SQLite WAL+FTS5 + backups
├── tools/              # 迁移/修复/验证脚本
├── start.bat / QUICK_START.bat
└── dist/               # PyInstaller EXE 输出
```

## 后端 API 端点（120+，25 模块）

| 模块 | 核心端点 | 数量 |
|------|---------|------|
| word_cards | CRUD + tree + search + export/import | 30+ |
| word_assets (v4) | CRUD + search + batch | 15+ |
| prompts | CRUD + search + semantic + categories | 12+ |
| collections | CRUD + add/remove items | 8+ |
| wordpacks | CRUD + items | 8+ |
| ai_workflow | optimize + translate + autotag + thumbnail | 10+ |
| media | upload + thumbnail + list | 6+ |
| health | check + watcher-status + stats | 5+ |
| 其余 17 模块 | backup/sync/comfyui/ocr/seedance/character... | 30+ |

## 网络配置
- 防火墙 TCP 8080 入站已放行（规则名：PromptKit / PromptKit 8080）
- WiFi 网络设为"专用网络"
- Tailscale 作为备用通道
- 当前内网IP：192.168.0.103


## 📦 跨平台封装规则（Win+macOS 双系统，2026-06-15）

### ZIP 打包（zipfile 替代 PowerShell Compress-Archive）
| # | 规则 |
|---|------|
| 1 | 用 Python zipfile 打 ZIP，不用 Compress-Archive（路径分隔符 \ 在 macOS 不可用）|
| 2 | arcname 统一用 /：Path.as_posix() 或 '/'.join(parts) |
| 3 | 排除 __pycache__/、data/（GB 级）、dist/、.git/、memory/、
ode_modules/ |
| 4 | 包含目录: ackend/ rontend/ 	ools/；包含文件: start.command 
equirements.txt INSTALL_MACOS.md |
| 5 | ZIP 产物的 arcname 在 Windows 和 macOS 解压后路径必须一致 |

### requirements.txt 跨平台约束
| # | 规则 |
|---|------|
| 1 | 
umpy<2（NumPy 2.x 破坏 PyTorch，macOS Intel GPU 回退 CPU 触发 _ARRAY_API not found）|
| 2 | sentence-transformers 不加 == 锁死版本 |
| 3 | 必须含 python-multipart（FastAPI UploadFile 依赖）|
| 4 | 必须含 	orch（macOS Intel vs Apple Silicon 需用户自行装对版本）|
| 5 | 必须含 iofiles（异步文件 IO）|

### Python 代码兼容性
| # | 规则 |
|---|------|
| 1 | AI/OCR API 用 except Exception，不要只用 except ImportError（macOS 缺 PyTorch 会抛 NameError/RuntimeError）|
| 2 | msvcrt 用 	ry: import msvcrt except ImportError: input() 替代 |
| 3 | 路径一律 os.path.join() / pathlib.Path，禁 \ 硬编码 |
| 4 | LLM 请求 timeout 设合理值（2013 款 iMac 无 GPU 跑 sentence-transformers 极慢）|

### macOS 启动脚本 (.command)
| # | 规则 |
|---|------|
| 1 | 分发前 chmod +x start.command |
| 2 | 用 xattr -cr start.command 清除 com.apple.quarantine 标记（Gatekeeper）|
| 3 | Shebang 用 #!/bin/bash（Catalina 后默认 zsh 但 bash 可用）|
| 4 | Python 查找：python3.12 python3 python 依次尝试 |
| 5 | 自动创建 venv 并安装依赖 |
| 6 | ffmpeg 检测并提示安装（rew install ffmpeg）|

### Windows EXE（PyInstaller）+ macOS ZIP 统一打包示例

**PyInstaller spec.hiddenimports：**
\\python
hiddenimports = ['uvicorn.logging','uvicorn.loops.auto','uvicorn.protocols.http.auto',
    'fastapi','aiohttp','PIL._imaging','sentence_transformers','numpy','aiofiles','sqlite3','asyncio']
excludes = ['tkinter','PyQt5','PySide6','wx','matplotlib','scipy','pandas','torch','tensorflow']
\
**打包命令：**
\\ash
# Windows EXE (onedir)
pyinstaller build.spec --clean --noconfirm
# macOS ZIP
python tools/pack_zip.py
\
**启动初始化顺序：** init_db() → seed_data.init_seedance_v2(db) → _migrate_v4(db) → safe_commit(db) → include_router

### 打包前检查清单
- [ ] ZIP 在 Windows 解压后 dir backend\main.py 可见
- [ ] ZIP 在 macOS 解压后 ls backend/main.py 可见（路径分隔符一致性）
- [ ] start.command 已 chmod +x
- [ ] start.bat 已含端口自适应 + 防火墙提示
- [ ] 端口探测范围 8080~8089
- [ ] PyInstaller 已配置 hiddenimports + excludes
- [ ] EXE 启动不抛 ModuleNotFoundError

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
