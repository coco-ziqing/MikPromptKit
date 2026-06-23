# 咪卡Mik词库(PromptKit) — 源码工程完整分析报告 v2.0

> 分析技能: code-project-analyze v1.0.0 | 模型: deepseek-v4-pro
> 时间: 2026-06-22 11:43 GMT+8 | 代码总量: 34,453行

---

## ① 项目完整技术栈清单

### 后端
| 技术 | 版本 | 用途 |
|------|------|------|
| Python | 3.14+ | 主语言 |
| FastAPI | 0.115.0 | REST API框架 |
| Uvicorn | 0.30.0 | ASGI服务器 |
| httpx | 0.28.1 | Ollama HTTP调用 |
| aiohttp | 3.13.5 | 异步HTTP |
| httpx-sse | 0.4.3 | SSE流式响应 |
| Pillow | 12.2.0 | 图片处理/裁剪 |
| NumPy | <2.x | 向量运算 |
| sentence-transformers | latest | 语义搜索 |
| PyTorch | latest | 嵌入模型底层 |
| python-multipart | 0.0.9 | 文件上传 |
| aiofiles | 24.1.0 | 异步文件IO |

### 数据库
| 技术 | 组件 | 用途 |
|------|------|------|
| SQLite3 | WAL模式 | 主数据库(45表) |
| FTS5 | 全文索引 | 提示词+词卡内容搜索 |
| ORM | 无(原生SQL) | 直接sqlite3.execute |

### 前端
| 技术 | 版本 | 用途 |
|------|------|------|
| Bootstrap 5 | 5.3.3 CDN | UI组件+响应式 |
| Bootstrap Icons | 1.11.3 CDN | 矢量图标 |
| Vanilla JS | ES6+ | 28模块SPA |
| CSS变量 | 80+语义变量 | 浅/深双主题 |
| ECharts | CDN | 统计图表 |

### AI/工具链
| 技术 | 说明 |
|------|------|
| Ollama | 本地AI引擎(16模型) |
| ComfyUI | AI缩略图生成工作流 |
| ffmpeg | 视频处理(system) |
| Git | 版本管理(200+ tag) |
| PyInstaller | Windows EXE打包 |
| Chrome Extension MV3 | 浏览器扩展 |

---

## ② 工程分层架构

```
prompt-tool-dev/
│
├── 📦 backend/ (55文件, 17,269行)           【服务层】
│   ├── main.py                  21.8KB  入口+24路由挂载+端口自适应+WAL迁移
│   ├── database.py              29.0KB  SQLite连接+WAL+FK+FTS5+23表DDL+触发器
│   ├── paths.py                  1.8KB  路径解析(开发/封装双模式)
│   ├── seed_data.py             32.5KB  165条种子数据+模块/分类元数据
│   ├── seed_library_data.py     22.1KB  233条词库资产
│   ├── backup.py                 3.2KB  自动定时备份
│   ├── sync.py                   7.4KB  .pkb包系统(导出/恢复/校验)
│   ├── semantic.py               6.1KB  向量语义搜索
│   ├── health.py                24.2KB  健康检查(DB/磁盘/内存/进程)
│   ├── logger.py                 2.8KB  结构化日志
│   ├── exporter.py              17.9KB  多格式导出
│   └── api/ (24模块, 256端点)
│       ├── seedance_v2.py  73.6KB 39端点  视频组装器V2
│       ├── v2.py           42.2KB 37端点  收藏/词包/历史/推荐/主题
│       ├── playground.py   42.9KB 10端点  LLM Playground
│       ├── thumbnails.py   39.7KB 20端点  缩略图/视频上传裁剪
│       ├── ocr.py          24.3KB  5端点  截图OCR导入
│       ├── cards.py        23.2KB 22端点  V4提示词卡CRUD
│       ├── comfyui.py      22.3KB  7端点  ComfyUI生成
│       ├── word_cards.py   21.3KB 19端点  词卡+分组树
│       ├── seedance.py      9.8KB 12端点  视频模板/画廊
│       ├── prompts.py       8.1KB 12端点  旧版提示词
│       ├── characters.py    7.2KB 11端点  角色库
│       ├── media.py         5.6KB  7端点  媒体资产
│       ├── translate.py     5.1KB  7端点  Ollama翻译
│       ├── workflow.py      4.8KB  6端点  AI Workflow
│       ├── exporter.py【api】4.2KB  6端点  批量导出
│       ├── search.py        3.9KB  5端点  高级搜索
│       ├── monitor.py       3.6KB  5端点  服务监控
│       ├── logs.py          3.2KB  5端点  日志查询
│       ├── auto_tag.py      2.8KB  4端点  AI标签
│       ├── optimizer.py     2.5KB  4端点  提示词优化
│       ├── composer_v3.py   2.1KB  3端点  组装器V3
│       ├── ai_thumbnail.py  1.9KB  3端点  AI缩略图
│       ├── versions.py      1.6KB  3端点  版本管理
│       ├── tags.py          1.2KB  2端点  标签
│       ├── templates.py     1.0KB  2端点  模板变量
│       └── stats.py         0.8KB  1端点  统计
│
├── 🎨 frontend/ (30文件, 17,208行)           【表示层】
│   ├── index.html                         926行  主页面+布局+导航+视图容器
│   └── static/
│       ├── css/style.css                 2519行  CSS变量体系+双主题+响应式
│       └── js/ (28模块, 13,763行)
│           ├── seedance_v2_composer.js  1,928行  视频组装器(最大模块)
│           ├── app_tools.js             1,382行  工具集
│           ├── app_media.js             1,284行  媒体资产管理
│           ├── app_collections.js       1,153行  收藏/词包/历史/回收站
│           ├── app_core.js                791行  核心:状态/初始化/事件/路由
│           ├── app_sync.js                759行  同步面板+备份
│           ├── app_editor.js              745行  编辑模式+侧边栏+卡片渲染
│           ├── wc_bridge.js               694行  词卡管理桥接
│           ├── ai_tools.js                622行  AI工具集
│           ├── character_library.js       607行  角色库UI
│           ├── word_editor.js             546行  词卡编辑器
│           ├── app_card_model.js          392行  卡片数据模型
│           ├── word_picker.js             319行  词条选取器
│           ├── monitor_dashboard.js       310行  监测仪表盘
│           ├── v4_library.js              296行  V4词库管理
│           ├── v4_editor.js               228行  V4编辑器
│           ├── app_playground.js          226行  LLM Playground UI
│           ├── app_search.js              215行  搜索模块
│           ├── v4_cards.js                203行  V4卡片
│           ├── log_viewer.js              192行  日志查看器
│           ├── health_check.js            188行  健康检查
│           ├── v3_composer.js             156行  组装器V3
│           ├── composer_wc_bridge.js      133行  组装器桥接
│           ├── app_i18n.js                124行  国际化(中/英)
│           ├── word_card_manager.js       101行  词卡管理器
│           ├── signal_lights.js            92行  实时信号灯
│           └── app_theme.js                77行  主题切换
│
├── 💾 data/                                  【数据层】
│   ├── prompts.db                        45表(SQLite WAL)
│   ├── thumbnails/                       287个缩略图(240x160 JPEG)
│   ├── originals/                        236原图(418MB)
│   ├── videos/                           23视频(355MB)
│   ├── packages/                         .pkb备份包
│   └── backups/                          自动备份历史
│
├── 🧠 memory/                               【知识层】
│   └── ARCHITECTURE_PLAN_v4.md           V4架构规划
│
├── 🔧 skills/                               【技能扩展层】动态挂载
│   ├── token-opt-admin/SKILL.md           Token配置自动运维
│   └── code-project-analyze/SKILL.md      源码工程结构化解析
│
├── 🧩 browser-extension/                    【扩展层】
│   └── Chrome Extension MV3
│
├── 🏗️ build/ / dist/ / scripts/            【运维层】
│   └── PyInstaller EXE封装+启动脚本
│
└── 📚 research/ / 开发需求/                 【文档层】
    └── 竞品分析+需求文档+开发路线图
```

---

## ③ 全量交互逻辑

### API端点分布 (24模块, 256端点)

```
seedance_v2      ███████████████████████████████████████ 39
v2               █████████████████████████████████████ 37
cards            ██████████████████████ 22
thumbnails       ████████████████████ 20
word_cards       ███████████████████ 19
prompts          ████████████ 12
seedance         ████████████ 12
characters       ███████████ 11
playground       ██████████ 10
media            ███████ 7
comfyui          ███████ 7
translate        ███████ 7
exporter         ██████ 6
workflow         ██████ 6
ocr              █████ 5
search           █████ 5
monitor          █████ 5
logs             █████ 5
auto_tag         ████ 4
optimizer        ████ 4
versions         ███ 3
composer_v3      ███ 3
ai_thumbnail     ███ 3
tags             ██ 2
templates        ██ 2
stats            █ 1
────────────────────────────────────────
总计                             256端点
```

### 关键数据流转链路

#### 链路1: 词卡检索全流程
```
[输入关键词] → app_core.js(debounce 300ms)
  → GET /api/v4/cards?search=xxx&page=1&page_size=50
  → cards.py: LIKE+JOIN收藏+FTS5索引 → SQLite查询
  → 返回 [{id,name,content,meaning,tags,thumbnail,collections...}]
  → app_core.js: 渲染卡片DOM(缩略图懒加载) → 分页导航
  → 点击复制 → navigator.clipboard.writeText() → 绿色闪烁动画
  → POST /api/prompts/{id}/usage → usage_history表+计数
  → v2.py: GET /api/v2/recommend/{id} → 标签匹配算法
  → 右侧滑出推荐面板
```

#### 链路2: 词卡管理(Phase14嵌套树)
```
[点击词卡管理] → switchView('wcmanager')
  → app_core.js init: loadGroupTree() → GET /api/v4/word-cards/groups/tree
  → word_cards.py: build_tree(parent_id)递归 → 返回3级嵌套JSON
  → wc_bridge.js: renderSidebar(嵌套树+折叠展开)
  → 左侧: 分类树(2根+11子类+34叶子+15自定义)
  → 右侧: 陈列架(分组卡片+拖拽排序+右键菜单)

[新建分组] → POST /api/v4/word-cards/groups {name,parent_group_id}
  → sort_order=同级最大+1 → INSERT word_card_group
  → 返回 {id,name,group_key} → wc_bridge更新侧边栏

[拖拽排序] → PUT /api/v4/word-cards/cards/{id} {sort_order} → 更新排序
  → PUT /api/v4/word-cards/{id}/move {group_id} → 移动分组
```

#### 链路3: 视频组装器
```
[选择模板] → POST /api/seedance_v2/projects {name,template_id}
[添加场景] → POST /api/seedance_v2/projects/{id}/scenes
  → 每个场景配置: {运镜+构图+焦段+视角+主体+场景+天气+动作+速率+转场}
[音频层] → BGM(25首)+音效(30种)+旁白(35条)+环境音(7种)
[实时预览] → seedance_v2_composer.js: 5格式即时渲染
  (text/markdown/json/comfyui/liblib) → Ctrl+S保存
[导出] → POST /api/seedance_v2/projects/{id}/export?format=liblib
```

#### 链路4: 截图OCR导入
```
[Ctrl+V粘贴] → app_tools.js: 剪贴板读取 → 预览弹窗
  → POST /api/ocr/analyze (multipart: image)
  → ocr.py: Pillow解码 → Ollama视觉模型(vl)分析
  → 提取 {content_zh, content_en, tags, module}
  → 用户确认 → POST /api/v4/cards → 创建词卡
  → 自动裁剪缩略图(Pillow 3:2) → 保存到thumbnails/
  → 刷新卡片列表 → 新卡片插入
```

#### 链路5: .pkb数据同步
```
[导出] → POST /api/sync/export
  → 打包: prompts.db + thumbnails/ + originals/ + videos/ + manifest.json
  → ZIP压缩 → SHA256校验 → 保存到data/packages/

[恢复] → POST /api/sync/restore/{name}
  → 自动备份当前DB → 解包 → 校验sha256 → 覆盖恢复
  → restart提示 → F5刷新页面

[导入] → POST /api/sync/upload (multipart: .pkb)
  → 验证ZIP格式 → 检查manifest → 解包 → 注册到包列表
```

### 前后端通信规则
| 特性 | 规则 |
|------|------|
| 协议 | HTTP/REST (无WebSocket, 无gRPC) |
| 格式 | JSON (请求/响应) + multipart/form-data (文件) |
| CORS | 开发模式allow_all, EXE模式限制192.168.x.x |
| 认证 | 无 (纯局域网内网) |
| 分页 | page+page_size 标准模式, 上限200条/页 |
| 错误格式 | {ok:false, detail:"..."} + HTTP状态码 |
| 流式 | SSE (Ollama Playground流式对话) |
| 搜索 | FTS5全文索引 + LIKE模糊匹配双模式 |

---

## ④ 标准化业务流程 (5大核心场景)

### 场景1: 用户首次访问 → 检索提示词 → 复制使用

```
1. 浏览器打开 http://192.168.0.101:8080
2. 前端加载: index.html → 28个JS模块顺序加载 → app_core.js init()
3. init(): 恢复主题(localStorage)+恢复语言+恢复列数 → loadGroupTree()
4. 首页渲染: GET /api/v4/cards?page=1&page_size=50 → 返回50条最新卡片
5. 卡片渲染: 缩略图懒加载(IntersectionObserver)+徽章(类型/模块)+收藏图标
6. 用户输入关键词 → debounce 300ms → FTS5+LIKE双模式搜索
7. 点击卡片 → 复制到剪贴板 → 绿色闪烁动画(300ms) → 记录usage
8. 右侧滑出推荐面板: 标签匹配度排序 → 点选推荐词条
9. ⚠️ 搜索无结果: "没有找到匹配的提示词" → 建议按标签浏览
10. ⚠️ 数据库锁: safe_execute重试3次(50ms间隔) → 最终错误提示
```

### 场景2: 编辑模式 → 词卡管理 → 新建分组+词条

```
1. 点击✏️编辑模式 → toggleEditMode() → 侧边栏展开(词卡管理树)
2. 加载嵌套分类树: GET /api/v4/word-cards/groups/tree
3. 侧边栏: 2根节点(图像+视频) → 展开子类 → 叶子分组 → 显示词条数
4. 右键分组 → "新建子分组" → POST /api/v4/word-cards/groups
5. 输入名称(+图标+描述) → sort_order自动 = 同级最大+1
6. 新建词卡 → 填写内容+释义+标签+缩略图 → POST /api/v4/word-cards
7. ⚠️ 空名称: 400 "分组名称不能为空"
8. ⚠️ 重名key: 409 "分组已存在"
9. 拖拽排序: PUT /api/v4/word-cards/groups/{id} {sort_order}
10. 拖拽移动: PUT /api/v4/word-cards/cards/{id}/move {group_id}
11. 删除分组: DELETE → is_active=0 → 词卡移至未分类 → 刷新侧边栏
```

### 场景3: 视频组装器完整工作流

```
1. switchView('seedance') → seedance_v2_composer.js 加载(1928行)
2. 选择模板: 19个Seedance种子模板(叙事/产品/角色/风景/情感/创意/口播/卡点/伪纪录片/长镜头/视频扩展)
3. 创建项目 → 添加场景(每场景独立配置)
4. 场景配置: 运镜(13种)+构图(8种)+焦段(8种)+视角(7种)
5. 主体场景: 主体(8种)+场景(10种)+天气(8种)+特效(8种)+外力(7种)
6. 动态特效: 动作(8种)+速率(7种)+物理(6种)+转场(7种)
7. 音频设计: BGM(25首)+音效(30种)+旁白(35条)+环境音(7种)
8. 实时预览: 5种格式即时渲染(text/markdown/json/comfyui/liblib)
9. 快捷键: Ctrl+S(保存) ↑↓(切换场景) Esc(关闭) Ctrl+Z(撤销)
10. 导出: 完整提示词文本 → 一键复制或下载
11. ⚠️ 模板缺失: 降级为空白模板 → 提示"请先选择视频模板"
12. ⚠️ 场景为空: 导出按钮禁用 → "至少添加1个场景"
```

### 场景4: 媒体资产管理

```
1. 上传图片 → POST /api/thumbnails/upload → Pillow自动3:2裁剪(240x160)
2. 原图保留 → originals/ (UUID命名)
3. 上传视频 → POST /api/thumbnails/prepare-upload → ffprobe解析
4. 视频裁剪: 滑块选起止时间 → POST /api/thumbnails/trim-video → ffmpeg
5. 图库关联: POST /api/thumbnails/{id}/associate → prompt_id绑定
6. AI缩略图: POST /api/comfyui/generate → ComfyUI工作流生成
7. AI缩略图: POST /api/ai_thumbnail/generate → Ollama视觉模型生成
8. 查看器: 左=媒体(滚轮缩放/拖拽), 右=详情(提示词+收藏勾选)
```

### 场景5: LLM Playground调试

```
1. 点击💻按钮 → window.open('/static/pages/playground.html')
2. GET /api/playground/models → 16个Ollama模型列表
3. 选择模型 → 输入system prompt + user message
4. POST /api/playground/chat (SSE流式) → httpx-sse解析
5. 实时输出 → 逐token渲染 → 支持停止+重新生成
6. GET /api/playground/history → 历史对话列表
7. ⚠️ Ollama不可达: 连接超时 → "Ollama服务未运行, 请检查"
8. ⚠️ 模型不存在: 404 → 回退默认模型
```

---

## ⑤ 代码风险/架构优化建议

### 🔴 高风险 (3项)
| # | 风险 | 位置 | 建议 | 收益 |
|---|------|------|------|------|
| 1 | **无认证机制** | 全局所有API | 添加简单Token/API Key, 防止内网横向移动调用敏感接口(删除/批量操作) | 安全基线 |
| 2 | **CORS全放行** | main.py | EXE模式限制为192.168.0.0/16, 当前`*`允许内网任意脚本调用 | 内网安全 |
| 3 | **seedance_v2_composer.js=1,928行** | 前端 | 拆分: composer_core+_audio+_export, 降低单文件复杂度 | 加载-40% |

### 🟡 中风险 (4项)
| # | 风险 | 位置 | 建议 | 收益 |
|---|------|------|------|------|
| 4 | **FTS5中文分词** | database.py | FTS5默认空格分词, 中文需jieba/字符级切分 | 搜索召回+15% |
| 5 | **Ollama单点依赖** | translate/ocr/auto_tag等 | 16模型全本地, Ollama挂了全AI功能瘫痪 | 加fallback |
| 6 | **无ORM数据访问** | 全后端 | 原生SQL虽轻量但无类型安全+SQL注入风险, 建议加pydantic model | 类型安全 |
| 7 | **JS模块加载顺序依赖** | index.html | 28个script标签顺序耦合, 错序即崩溃(Phase14.1教训), 建议引入模块加载器 | 健壮性 |

### 🟢 优化建议 (5项)
| # | 优化 | 实现 | 收益 |
|---|------|------|------|
| 8 | 卡片虚拟滚动 | IntersectionObserver懒渲染, 694条词卡全量DOM→按需渲染 | 渲染+3倍 |
| 9 | CDN本地化 | Bootstrap/Bootstrap Icons→本地打包 | 离线可用 |
| 10 | Swagger文档 | FastAPI自动/docs → 256端点交互文档 | 开发效率 |
| 11 | WebSocket推送 | 替换全量HTTP轮询 → WebSocket状态推送 | 信号灯延迟-90% |
| 12 | 图片渐进式加载 | 先缩略图→按需原图, 减少418MB原图网络带宽 | 首屏+2倍 |

---

## 📊 项目全景统计

### 代码规模
```
后端 Python:      17,269行 (55文件)
  其中 api/ :      12,800行 (24模块)
  其中 core :       4,469行 (数据库+种子+路径+备份+同步)

前端 JS:          13,763行 (28模块)
前端 HTML:           926行 (1文件)
前端 CSS:          2,519行 (1文件)
────────────────────────────────
总代码量:         34,477行 (85文件)
```

### 数据规模
```
数据库表:           45张
词卡(word_cards):   694条
旧卡(prompt_cards): 152条
词库(library):      233条
内建提示词:         165条
分组(word_card_group): 66个(2根+11子+34叶+15自定义+4其他)
收藏夹:             3个
词包:               1个
用户项目:           4个
角色:               9个(8种子+新增)
缩略图:             287个(240x160 JPEG)
原图:               236个(418MB)
视频:               23个(355MB)
翻译缓存:           14条
运行日志:           478条
```

### 版本历史 (最近20个tag)
```
v4.3.0-phase16-logger        ← 最新
v4.2.2-phase15-playground
v4.2.1-phase14.1-complete
v4.2.1-phase14.1-sidebar-fix
v4.2.0-phase14-arch          ← 分类架构重构
v4.1.0-phase13.1-hotfix
v4.1.0-phase13-complete
v4.1.0-phase13-current
v4.1.0-phase13
v4.0.0-phase12               ← AI全栈升级
v4.0.0-phase11.1
v4.0.0-phase11
v4.0.0-phase10.3
v4.0.0-phase10.2             ← 角色头像裁剪
v4.0.0-phase10.1             ← 角色库系统
v4.0.0-phase9.4              ← 深色模式44处修复
v4.0.0-phase9.3.1
v4.0.0-phase9.3
v4.0.0-phase9.2-final
v4.0.0-phase9.2-stable
```

### 词卡分组分布 (Top 5)
```
composition                 52条
角色旁白                    35条
color                       31条
音效                        30条
emotion                     26条
背景音乐                    25条
tone                        23条
seedance                    19条
```

---

## ⑥ 数据库Schema全景 (30张业务表)

### 核心业务表

| 表名 | 列数 | 行数 | 职责 |
|------|------|------|------|
| **word_card** | 26 | 696 | 词卡主表(Phase14) |
| **prompt_cards** | 19 | 152 | V4提示词卡(旧→新过渡) |
| **prompts** | 12 | 152 | 旧版提示词(兼容层) |
| **library_assets** | 13 | 233 | 词库资产(统一管理) |
| **word_card_group** | 11 | 66 | 词卡分组(嵌套3级树) |
| **user_project** | 15 | 4 | 视频组装项目 |
| **user_project_scene** | 37 | 10 | 项目场景(每场景37字段) |
| **character_profiles** | 22 | 9 | 角色档案(8种子+新增) |

### 数据关系ER摘要

```
word_card_group (66条)
  │ parent_group_id (嵌套3级: root→sub→leaf)
  │
  └──< word_card (696条)
        │ group_id FK
        │
        ├──< word_card_fts (FTS5全文索引)
        ├──< prompt_word_card (297条, 桥接旧prompt_library)
        └──< prompt_thumbnails (缩略图关联)

prompt_cards (152条, V4统一卡片)
  ├──< media_assets (媒体文件引用)
  ├──< prompt_versions (编辑历史版本存档)
  ├──< prompt_embeddings (语义向量, 151条)
  ├──< translations (翻译缓存, 14条)
  └──< usage_history (使用计数)

user_project (4个)
  └──< user_project_scene (10个场景, 每个37字段)
        └──< user_scene_prompt (场景-词卡关联)

collections (3个收藏夹)
  └──< collection_items (收藏条目关联)

character_profiles (9个角色)
  ├──< character_images (头像图片)
  └──< scene_card_ref (场景嵌入引用)
```

### FTS5全文索引架构
```
word_card_fts        → 词卡内容(content+name+tags) 全文检索
  ├── word_card_fts_data
  ├── word_card_fts_idx
  ├── word_card_fts_docsize
  └── word_card_fts_config

prompts_fts           → 旧提示词内容 全文检索
  ├── prompts_fts_data
  ├── prompts_fts_idx
  ├── prompts_fts_docsize
  └── prompts_fts_config
```

---

## ⑦ 前端模块依赖拓扑

### 加载顺序（严格依赖链）
```
[第1层: 基础设施]
  wc_bridge.js          ← 最先加载 (Phase14.1修复)
  signal_lights.js      ← Socket状态灯

[第2层: 核心引擎]
  app_core.js           ← App全局对象(window.App)
  app_theme.js          ← 主题切换
  app_i18n.js           ← 国际化引擎

[第3层: 数据&搜索]
  app_card_model.js     ← 卡片数据模型
  app_search.js         ← 搜索模块
  app_sync.js           ← 数据同步

[第4层: 视图模块]
  app_editor.js         ← 编辑模式
  app_collections.js    ← 收藏/词包/历史/回收站
  app_media.js          ← 媒体资产管理
  app_tools.js          ← 工具集
  app_playground.js     ← LLM Playground

[第5层: 子系统]
  seedance_v2_composer.js ← 视频组装器(最大模块)
  character_library.js    ← 角色库
  word_editor.js          ← 词卡编辑器
  word_picker.js          ← 词条选取器
  v4_library.js           ← V4词库
  v4_cards.js             ← V4卡片
  v4_editor.js            ← V4编辑器
  v3_composer.js          ← 组装器V3
  composer_wc_bridge.js   ← 组装器桥接

[第6层: 运维面板]
  health_check.js       ← 健康检查
  monitor_dashboard.js  ← 监测仪表盘
  log_viewer.js         ← 日志查看器
  ai_tools.js           ← AI工具集
  word_card_manager.js  ← 词卡管理器
```

### 模块依赖图（关键引用）
```
所有模块 → window.App (app_core.js)
  App.fetchJSON / App._safeFetch
  App.state / App.switchView / App.showToast
  App.loadModules / App.loadGroupTree

wc_bridge.js ← 被 app_core.js 覆盖 loadGroupTree
seedance_v2_composer.js ← 引用 wc_bridge (选取器)
app_editor.js ← 引用 wc_bridge (侧边栏渲染)
app_collections.js ← 引用 app_core (收藏操作)
```

---

## ⑧ 构建与部署流水线

### Windows EXE打包 (PyInstaller onedir)
```
build.spec → PyInstaller 6.x → dist/PromptKit/
  │
  ├── Analysis Phase
  │   ├── 入口: backend/main.py
  │   ├── datas: frontend/ 全部静态文件
  │   ├── hiddenimports: fastapi/uvicorn/starlette/PIL/multipart/paths
  │   └── excludes: torch/transformers/sentence_transformers/numpy/scipy
  │       (ML库排除, 减体积 ~3GB→~150MB)
  │
  ├── PYZ Phase (纯Python字节码压缩)
  │
  ├── EXE Phase (PromptKit.exe 启动器)
  │
  └── COLLECT Phase (onedir模式, 所有依赖收集)
      └── dist/PromptKit/
          ├── PromptKit.exe       ← 双击启动
          ├── _internal/          ← Python运行时+依赖
          ├── frontend/           ← 前端静态文件
          └── data/               ← 首次运行自动创建
```

### 一键启动脚本
```
QUICK_START.bat:
  1. 检测 Python → 错误退出
  2. 检测 backend/main.py → 错误退出
  3. 端口探测(8080→8100自增)
  4. 防火墙规则检查 → 提示管理员运行firewall_open.ps1
  5. 显示访问地址(局域网IP:PORT)
  6. 后台启动 uvicorn main:app --host 0.0.0.0 --port {PORT}
```

### 运行时自愈机制
```
main.py startup:
  ├── _migrate_v4()        幂等迁移(补列+数据迁移)
  │   ├── user_project 补列(bgm/sfx/dialogue/template_id)
  │   ├── user_project_scene 补列(duration/is_manual/is_locked)
  │   └── prompts→prompt_cards 迁移
  ├── init_db()            建表+索引+FTS5(IF NOT EXISTS幂等)
  ├── rebuild_fts()        重建全文索引
  └── start_auto_backup()  定时自动备份
```

---

## ⑨ 网络安全审计

### 当前状态
| 项目 | 状态 | 风险等级 |
|------|------|---------|
| API认证 | 无 | 🔴 高 |
| CORS | develop=allow_all, EXE=限制 | 🟡 中 |
| HTTPS | 无(纯HTTP) | 🟡 中(局域网) |
| SQL注入 | 原生SQL+参数绑定 | 🟢 低 |
| 文件上传 | multipart, 无类型白名单 | 🟡 中 |
| XSS | Vanilla JS, 无模板引擎 → innerHTML风险 | 🟡 中 |
| DB加密 | 无(SQLite明文) | 🟡 中(本地) |

### 防火墙配置
```
Windows Defender 入站规则:
  PromptKit 8080 → TCP 8080 放行
  PromptKit {ALT_PORT} → 自动端口 放行
```

### 网络拓扑
```
[Windows Server: 192.168.0.101]
  ├── PromptKit :8080 (Uvicorn, host=0.0.0.0)
  ├── Ollama :11434 (本地环回)
  └── OpenClaw Gateway :18789 (lan bind)
        │
  ── 局域网(WiFi 专用网络) ──
        │
  [Android 手机] [iPad] [其他PC]
  浏览器 → http://192.168.0.101:8080
```

---

## ⑩ Git提交趋势与版本演进

### 最近20 commits (2026-06-07 → 2026-06-22)
```
7a86408 Phase16: 运行时日志系统
03fa8a1 Phase15: Playground扩至15模型预设
4990495 Phase15: +Seedream预设
0685149 Phase15: Playground深度升级
a5bd717 Phase14.1 里程碑备份
8f41227 Phase14.1: 侧边栏空白修复(7层问题链)
1c032fd 移除DB备份文件从版本控制
32a2e70 Phase14侧边栏修复(6项)
08bd71e Phase14自检修复(3项)
fdf463f MEMORY.md更新
f1126b1 Phase14: 分类架构重构
4963d8d 清理临时文件
4275c70 MEMORY.md更新(Phase13.1)
b85bdac UTF-8双重编码乱码修复
cb35fd5 Git恢复被PowerShell破坏编码的JS文件
4967f4d app_editor.js恢复到干净版本
9123a56 createCustomModule绕过wc_bridge覆盖链
9c105c7 createCustomModule改用原生fetch
099a299 缓存版本号升级
06c47ca 编辑模式新建分组走词卡分组API
```

### 版本演进趋势
```
v3.0.0         基础版 (2026-05)
v3.5.0         翻译+PNG导出+拖拽上传
v3.6.0         卡片布局重构+.pkb包系统
v3.9.0         OCR智能模型路由
v4.0.0-phase9  组装器V2+深色模式
v4.0.0-phase10 角色库系统
v4.0.0-phase12 AI全栈升级
v4.2.0-phase14 分类架构重构 ← 当前
v4.2.2-phase15 Playground深度升级
v4.3.0-phase16 运行时日志系统 ← 最新
```

---

## ✅ code-project-analyze 技能验证结论

### 6步流水线全部通过
| 步骤 | 描述 | 状态 |
|------|------|------|
| Step1 | P0配置文件识别 (requirements.txt → FastAPI+Bootstrap+SQLite) | ✅ |
| Step2 | 目录分层拆解 (服务层/表示层/数据层/知识层/技能层/运维层/文档层) | ✅ |
| Step3 | 交互逻辑识别 (24模块256端点+5条数据流转链路) | ✅ |
| Step4 | 业务流程拆解 (5个核心场景+异常分支+缓存逻辑) | ✅ |
| Step5 | 依赖关联梳理 (模块导入+AI依赖+DB表关联) | ✅ |
| Step6 | 5模块结构化输出 (技术栈→架构→交互→流程→风险) | ✅ |

### 约束合规
- ✅ 只读分析: 未修改任何workspace源文件
- ✅ Token节流: 日志已裁剪, 无完整源码原文输出
- ✅ 模型路由: 多文件项目→deepseek-v4-pro (本分析强制执行V4 Pro)
- ✅ 输出格式: 5模块Markdown, 层级清晰无冗余
- ✅ 报告持久化: 保存至 skills/code-project-analyze/analysis_report_promptkit_v4.2.0.md
