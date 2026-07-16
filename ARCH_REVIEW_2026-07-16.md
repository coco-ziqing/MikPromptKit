# 咪卡MiK提示词助手 — 全景架构评审报告

> 报告版本：ARCH-REVIEW v1.0　｜　生成时间：2026-07-16 12:40 GMT+8
> 评审对象：`prompt-tool-dev`（运行版本 `v5.18.0-phase36`，服务在线 :8080）
> 证据基线：全部结论基于实测源码 / 配置文件 / 运行库（`data/prompts.db` 110 表）与实时接口，无主观臆测。
> 阅读对象：架构评审 / 重构规划

---

## 摘要（Executive Summary）

咪卡MiK（PromptKit）是一套 **Windows 本地后端 + 浏览器 WebUI + 局域网多终端** 的 AIGC 创作提示词一体化平台，核心业务闭环为「**存 → 搜 → 调 → 组装 → 资产化**」。技术形态为 **FastAPI 单体后端 + SQLite 单库 + 原生 JS 单页前端**，通过 **插件框架**（MIT 开源核心 + 商业插件）实现能力扩展，附带 **文件管家 Agent（EXE）** 与 **浏览器扩展** 两个边缘客户端。

- **成熟度**：核心创作链（词卡/检索/组装/AI 增强/同步备份/运维自检）成熟稳定；资产库 & DAM、项目管理为半激活状态。
- **架构定位**：典型的「**功能富集单体**」——迭代快、内聚在业务、部署极简；但已出现 **单库耦合、前端全局脚本耦合、卡片模型多代并存、鉴权未强制** 四大结构性张力。
- **核心建议**：短期收敛数据/前端技术债；中期沿 **AI 推理网关 / DAM 存储服务** 两条最重的边界做服务拆分预备；前后端各抽一层公共底座（`pk_common.js` / 后端统一 DB 访问层）。

---

# 一、业务产品层（Business / Product）

## 1.1 产品定位与价值闭环
| 项 | 内容 |
|----|------|
| 产品名 | 咪卡MiK提示词助手（PromptKit / MiK） |
| 目标用户 | AIGC 影视/短视频创作者，个人 + 小团队（局域网协作） |
| 核心闭环 | 提示词**存**（录入/持久化）→**搜**（FTS/语义/rerank）→**调**（复制/模板变量）→**组装**（原子/角色/场景/Seedance 分镜）→**资产化**（媒体入库/版本/审核/归档） |
| 商业模式 | MIT 开源核心 + 商业插件；个人版买断 ¥299（项目管理 + 资产管理），团队版订阅（预留） |
| 部署形态 | 纯局域网内网服务，数据本地、不上云、开机自启 |

## 1.2 业务域清单（9 大子系统 · 实测数据量）
| 业务域 | 关键实体（行数） | 状态 |
|--------|------------------|------|
| 词卡核心（存搜调） | word_card **1273** / word_card_group 122 | ✅ 成熟 |
| AI 增强 | prompt_embeddings 169 / translations 46 | ✅ 可用（Ollama/ComfyUI 可选） |
| 原子化 & 组装 | atom_asset_library **928** / seedance_id_map 297 | ✅ 最重创作域 |
| 多用户 & 协作 | users 6 / user_sessions 98 / user_audit_log 440 | ✅ 地基完成 |
| 项目管理 | master_project 1 / project_role 4 / project_tasks 3 | ⚙️ 半启用（数据个位数） |
| 资产库 & DAM | asset_catalog 409 / asset_version 465 / **blob_store 0** | ⚙️ 资产库✅ / 归档层未落数据 |
| 同步 / 备份 / 导入导出 | media_assets 473 / 30+ 备份快照 | ✅ 成熟 |
| 运维 & 可观测 | runtime_log 22185 / error_breadcrumbs 13255 | ✅ 完善 |
| 交付 & 部署 | EXE(Win/mac) / 浏览器扩展 / Agent | ✅ Win 主线成熟 |

## 1.3 产品层判断
- **优点**：业务闭环完整、场景聚焦、需求-代码对齐度高（`prompts_fts`/`word_card_fts` 直接服务检索场景）。
- **风险**：产品边界持续外扩（从「提示词工具」→「DAM 数字资产管理」→「项目全流程管理」），单体承载力接近临界；DAM/项目管理两个重域**已建表未产生业务数据**，存在「功能超前于使用」的过度开发信号（历史上 SRS 复习模块即因此被回滚移除）。

---

# 二、工程基建层（Engineering Infrastructure）

## 2.1 技术栈（实测 requirements.txt + 运行时）
| 层 | 选型 | 版本 |
|----|------|------|
| Web 框架 | FastAPI | 0.115.0 |
| ASGI 服务器 | Uvicorn | 0.30.0 |
| 存储 | SQLite（WAL） | 内置，单文件 10.23MB |
| ORM | **无**（原生 sqlite3 + 线程本地连接 + 重试封装） | — |
| AI/ML | sentence-transformers / torch / numpy<2 | Sentence-BERT 384维 |
| 媒体 | Pillow 12.2 + ffmpeg（外部） | 缩略图/视频首帧/代理 |
| 本地大模型 | Ollama（HTTP 11434）+ ComfyUI（三级自动发现） | 可选依赖 |
| HTTP 客户端 | aiohttp / httpx / httpx-sse | — |
| 上传/异步IO | python-multipart / aiofiles | — |
| 前端 | 原生 JS + Bootstrap5 + HTML5 | **无构建工具/无打包器** |
| 打包 | PyInstaller（Win `.exe` + macOS `.spec`/`.dmg`） | onefile |

## 2.2 依赖与构建策略
- **后端**：`pip install -r requirements.txt`；`start.bat` 首启自动装依赖 + 端口探测（8080→8100）+ 局域网 IP 提示 + 防火墙引导。
- **前端**：**零构建**。`index.html` 直接 `<script src>` 引入，靠 URL query `?v=14.16` 手工 cache-busting；后端 `cache_control_middleware` 对 html/js/css/json 强制 `no-cache`。
- **配置**：`.env.mail`（邮件）；应用配置落 `config` / `sys_global_config` 表；版本号已统一为根目录 `VERSION` 单一来源（本次评审同步修复）。
- **仓库隔离**：`.gitignore` 明确划定开源边界——License 私钥/签名工具/商业插件（`plugins/project_mgmt|asset_mgmt|team_collab`）/构建脚本禁止入库，商业部分由私有仓库 `prompt-tool-dev-private` 通过 `build_merged.py` 注入。

## 2.3 基建层判断
- **优点**：零前端工具链 → 启动/部署极简，契合「Windows 本地一键启动」定位；开源/商业仓库隔离设计清晰（`docs/REPO_ISOLATION.md`）。
- **技术债**：
  - 前端无模块系统/无 tree-shaking，靠手工 `?v=` 版本戳，**易漏改导致缓存不一致**；
  - 无依赖锁（`torch`/`sentence-transformers` 未固定版本），构建可复现性弱；
  - 后端无 ORM，SQL 散落各 router，schema 演进靠 20+ 个 `migrate_*.py` 手工脚本累积。

---

# 三、目录分层架构层（Directory Layering）

```
prompt-tool-dev/
├─ backend/                 后端服务（本次已瘦身）
│   ├─ main.py              入口：FastAPI app + lifespan + 中间件 + 44+ 路由挂载
│   ├─ api/                 44 个路由模块（HTTP 边界层）
│   ├─ database.py/paths/logger/auth/jwt_auth/audit/...   核心服务层
│   ├─ semantic/llm_rerank/ollama_client/ai_tagger        AI 服务
│   ├─ archive_engine/tier_engine/version_engine/sim_search  DAM 引擎
│   ├─ migrate_*.py (20+)   schema 迁移脚本（运行时按需 import）
│   ├─ seed_*.py            种子数据
│   ├─ tests/               ★本次归档：回归测试（11 个 _test_*.py）
│   ├─ logs/                ★本次归档：启动/调试日志
│   └─ _scratch/            ★本次归档：一次性调试脚本
├─ frontend/                前端 WebUI（零构建）
│   ├─ index.html (1053行)  单页壳 + 15+ view-panel
│   ├─ login.html / admin_users.html / cover_editor.html
│   └─ static/js/ (~45模块) + static/css/style.css (3510行)
├─ plugins/                 插件框架
│   ├─ project/             启用：项目管理专业版 v2.0
│   └─ _disabled/           停用：asset / srs_review / example
├─ agent/                   文件管家助手（pk_agent.exe，绿色便携）
├─ browser-extension/       Chrome 扩展（manifest/background/content/popup）
├─ macos/                   macOS 打包资源
├─ data/                    prompts.db + backups/ + 媒体资产
├─ docs/                    架构/许可/多用户/插件开发文档
└─ *.md / *.bat / *.spec    规划文档 / 启动脚本 / 打包配置
```

## 3.1 分层判断
- **优点**：后端 `api/`（边界）与核心服务/引擎分离度尚可；插件、Agent、扩展、桌面打包各自独立目录，物理边界清晰。
- **技术债**：
  - `backend/` 根目录曾混入测试/日志/调试散件（**本次已归档至 `tests/`·`logs/`·`_scratch/`**）；
  - `migrate_*.py` × 20 + `seed_*.py` × 8 与生产模块平铺同层，缺 `migrations/` `seeds/` 归类（因运行时 `import`，本次未强移，建议后续做包内规整）；
  - 前端 `static/js` 45 个模块**全部平铺**，无 `core/ feature/ ui/` 分层，模块归属靠文件名前缀（`app_*` / `*_composer` / `*_ui` / `*_bridge`）隐式约定。

---

# 四、核心运行架构层（Core Runtime）

## 4.1 后端运行时（实测 main.py）
**启动生命周期 `lifespan`**（顺序）：
1. `init_db()` 建表 → Phase18 插件框架迁移 → 内置提示词种子导入 + `rebuild_fts()`
2. `start_auto_backup()` 自动备份线程
3. 语义索引后台线程 `rebuild_all_embeddings`（ML 可用时）
4. Seedance V2 种子 + v4 数据迁移 `_migrate_v4`（prompts→prompt_cards / library→library_assets 幂等）
5. `init_plugin_system(app, db)` 插件发现/加载/启用/注册路由
6. 启动后台自检任务（10 项）+ `presence_sweep_loop` 在线状态巡检 + `start_watcher` 信号灯轮询（30s）

**中间件栈（自外向内）**：
```
CORS(allow_origins=*)  →  JWTAuthMiddleware(仅解析,不强制)  →  cache_control(no-cache)  →  record_request(request_id + breadcrumb + body capture)
```
**路由层**：44 个内建 router（`app.include_router`）+ 插件路由动态注册（agent/mgmt 双通道、cover、dam_archive/search/vault）。

**数据访问**：`database.py` 线程本地连接（`threading.local`），`PRAGMA journal_mode=WAL / foreign_keys=ON / synchronous=NORMAL / busy_timeout=5000`，`safe_execute` 带 3 次锁重试。

**实时通道**：`ws_collab`（协作 WS）+ `presence`（在线状态 WS/REST）。

## 4.2 前端运行时（实测 index.html + JS）
- **单页壳**：`index.html` 承载 15+ `view-panel`（viewHome / viewCollections / viewWordpacks / viewSeedance / viewCharacterComposer / viewSceneComposer / viewProjectAssets / viewProjectRoles / viewAdminUsers / viewV4media / viewWCManager / viewHistory / viewTrash …）。
- **模块加载**：`<script src>` 顺序注入，无 ES Module/无打包；模块以 **window 全局对象** 暴露能力（如 `PK_ASSETLIB`、`pk_project`）。
- **编排核心**：`app_core.js`(988) 做视图切换 + 事件总线角色；`wc_bridge.js`(1191) / `composer_wc_bridge.js` / `scene_bridge.js` 作为「词卡 ↔ 组装器」桥接层。
- **实时**：`ws_client.js` + `presence_client.js` + `signal_lights.js`（运维信号灯）+ `notif_center.js`（通知中心，服务端 `notify.py` 经 WS 推送）。

## 4.3 全栈数据流（关键链路端到端）
```
① 存储链  编辑器 → POST /api/v4/word-cards → word_card + 触发 word_card_fts + 异步 prompt_embeddings 向量 → word_card_group
② 检索链  搜索框 →（FTS MATCH | 语义余弦 | LLM rerank）→ 相似度% → 卡片渲染
③ 调用链  卡片 → {{变量}}检测 → 填充分窗渲染 → 复制 / 送入组装器
④ 组装链  atom_asset_library + word_card →(wc_bridge)→ character/scene/seedance_v2 composer → 结构化提示词输出
⑤ 资产链  上传 → sha256查重 + 缩略图(PIL/ffmpeg) → asset_catalog → asset_version v1 → 提交审核 → approve → is_critical=1 + 备份
⑥ DAM链   pk_agent 扫描设备 → 上报指纹/心跳 → device_file_index → 归档(压缩+代理+内容寻址去重 blob_store)→ 检索/pHash相似/冷热分层/三层自检/外置备份
⑦ 协作链  登录 → JWT → 中间件解析 actor → workspace/project 成员角色鉴权 → presence 广播 + ws_collab 实时 + record_audit 落权威日志
⑧ 运维链  每请求 record_request(request_id) → monitor/runtime_log/breadcrumb → 定时 health 自检 → 信号灯(绿/黄/红) → 异常自愈重启 + 自动备份
```

## 4.4 运行架构判断
- **优点**：lifespan 编排清晰、可观测中间件（request_id 贯穿前端行为↔后端日志↔错误面包屑）设计到位；WAL + 重试 + 线程本地连接对单机并发足够稳健。
- **结构性张力**：
  - **JWT 中间件默认注入 admin 且 `_ENFORCE_AUTH=0`** —— 所有业务模块假设 `request.state.user` 存在，鉴权实为「软约束」，仅个别 admin-only 接口硬校验（安全边界模糊，详见第六章）。
  - **部分 API 自开 SQLite 连接**（如 `asset_library.py` 自持 sqlite、`audit.py` 短连接）绕过 `database.py` 统一入口 —— 数据访问策略不一致。

---

# 五、业务模块实现层（Business Module Implementation）

## 5.1 模块规模热力（实测 LOC）
**后端 api/（Top）**：seedance_v2 1507 · v2 1162 · thumbnails 1071 · atoms 954 · word_cards 933 · playground 664 · cards 595 · dam_archive 540 · scene_composer 538 · ocr 536
**后端核心**：main 700 · health 687 · database 684 · plugin_manager 661 · db_migrate_phase18 530
**前端 js（Top）**：seedance_v2_composer **2221** · app_tools 1536 · app_media 1398 · app_collections 1276 · word_editor 1205 · wc_bridge 1191 · app_core 988 · scene_composer 801

## 5.2 模块边界与职责分析（前/后端双视角）
| 业务模块 | 后端实现 | 前端实现 | 边界评价 |
|----------|----------|----------|----------|
| 词卡核心 | prompts/v2/word_cards/cards/search/tags/templates/versions | app_core/app_search/app_editor/word_editor/word_card_manager | ✅ 边界清晰，但**卡片模型三代表并存**（prompts/prompt_cards/word_card） |
| 组装器 | atoms/atom_filler/character_composer/scene_composer/seedance_v2/composer_engine | seedance_v2_composer/character_composer/scene_composer + **3 个 bridge** | ⚠️ 组装器↔词卡强耦合，靠 bridge 胶水层维系；seedance_v2 前端 2221 行单体 |
| AI 增强 | semantic/llm_rerank/ollama_client/playground/translate/optimizer/auto_tag/ai_thumbnail/ocr/comfyui | app_playground/ai_tools | ✅ 服务相对独立，但**重依赖（torch）与主进程同生命周期** |
| 资产库/DAM | asset_library/asset_review/device_index/dam_archive/dam_search/dam_vault + engines | asset_library_ui/file_steward_ui/device_manager_ui | ⚙️ 引擎层（archive/tier/version/sim）解耦良好；**API 层自开 DB 连接**破坏一致性 |
| 多用户/协作 | auth/jwt_auth/users/presence/ws_collab/audit | auth_client/admin_users/presence_client/ws_client/notif_center | ✅ 结构清晰；鉴权未强制是全局横切问题 |
| 项目管理 | plugins/project(api/workspace/collab/squads) + project_roles | project_roles_ui + project_dashboard.js | ⚙️ 插件化隔离良好，但**未接入真实创作流程** |

## 5.3 高耦合 / 职责模糊点（重点识别）
1. **组装器 ↔ 词卡（前端）**：`wc_bridge.js`(1191) + `composer_wc_bridge.js` + `scene_bridge.js` 三个桥接模块，说明「词卡数据模型」与「组装器消费模型」未抽象统一契约，靠胶水层适配 —— **最高耦合缝**。
2. **`app_tools.js`(1536) / `app_media.js`(1398) 巨石**：混合导入导出、批量操作、媒体上传/预览多职责，属「工具箱型」上帝模块。
3. **卡片数据模型三代并存（后端+DB）**：`prompts`(169) → `prompt_cards`(165) → `word_card`(1273），迁移已完成但旧表未退役，读写路径存在历史分叉（`_migrate_v4` 仍在每次启动执行）。
4. **DB 访问策略不统一**：多数走 `database.py` 线程本地连接，`asset_library`/`audit` 等自开短连接 —— 事务/FK/WAL 行为不一致。
5. **鉴权横切缺失**：业务 router 直接信任 `request.state.user`（默认 admin），权限校验散落在个别端点内联 `if role==...`，无统一依赖注入式鉴权。

---

# 六、非功能质量架构层（Non-Functional Quality）

## 6.1 可靠性 / 数据安全
- ✅ WAL + `synchronous=NORMAL` + `busy_timeout` + `safe_execute` 重试；FK 强制开启。
- ✅ 自动备份线程 + 关机 `WAL checkpoint → .pkb` 全量备份；`data/backups/` 已积累 30+ 快照。
- ✅ `.pkb`（DB+媒体全量包）/`.pt`（单卡包）导出/恢复/校验（`verify_package`）。
- ⚠️ 单库 10MB，`error_breadcrumbs` 13255 / `runtime_log` 22185 行持续增长，**保留期清理仅审计表有**（`audit.apply_retention`），breadcrumb/runtime_log 无自动清理策略。

## 6.2 可观测性
- ✅ `request_id` 全链路贯穿（前端行为 ↔ api_log ↔ 错误面包屑）；`record_request` 记录方法/路径/状态/耗时，>500ms 或 ≥400 落 body。
- ✅ 10 项启动自检（DB/WAL/IP/防火墙/Pillow/ffmpeg/Ollama/ComfyUI/Playground/磁盘）+ 信号灯前端实时（绿/黄/红）+ 崩溃自愈重启。
- ✅ 服务端权威审计 `user_audit_log`（actor 解析 + 中文事件字典 + admin-only 查询）。

## 6.3 安全（重点风险）
| 风险项 | 现状 | 等级 |
|--------|------|------|
| **鉴权未强制** | `_ENFORCE_AUTH=0`，JWT 仅解析；token 无效即降级为默认 admin | 🔴 高（内网单机可接受，联网/多用户即缺口） |
| **JWT 密钥非持久** | 未设 `PK_JWT_SECRET` 时随机生成，**重启即失效登录**（本次重启已复现，触发全体 token 失效） | 🟠 中 |
| **CORS 全开** | `allow_origins=["*"] + allow_credentials=True` | 🟠 中（组合本身不规范） |
| **本地文件写接口** | `/api/utils/save-blob`（base64 写任意 abspath）、`/api/utils/pick-folder`（tkinter）| 🟠 中（无沙箱，路径穿越面） |
| License 私钥边界 | `.gitignore` 严格隔离签名私钥/商业插件，设计正确 | ✅ 良 |

## 6.4 性能 / 可伸缩
- 单进程 `uvicorn`（`reload=False`），CPU 密集项（torch 语义、LZMA/WebP 归档、ffmpeg 代理）与 Web 请求**同进程竞争**；后台线程（备份/巡检/信号灯/语义重建）共用 GIL。
- SQLite 单写者模型：写并发靠 WAL + 重试兜底，单机小团队够用，**多用户高并发即瓶颈**。

---

# 七、交付运维扩展层（Delivery / Ops / Extension）

## 7.1 交付形态
- **主线**：`start.bat` / `QUICK_START.bat` 一键启动（依赖检查 + 端口探测 + IP/防火墙引导）；`firewall_open.bat/.ps1/.vbs` 放行。
- **打包**：PyInstaller `build.spec`（Windows onefile）+ `build_macos.spec`/`.dmg`（macOS）；`paths.py` 用 `sys.frozen`/`_MEIPASS` 兼容开发与打包双环境。
- **边缘客户端**：`pk_agent.exe`（文件管家助手，扫描/指纹/上报/心跳/备份）+ Chrome 浏览器扩展。
- **运维自动化**：`daily_report.py` 开发日报邮件机器人（QQ SMTP 465 SSL，读 `.env.mail`）。

## 7.2 扩展机制（插件框架，实测 plugin_manager.py）
- 生命周期：`DISCOVERED → LOADED → ENABLED / DISABLED / ERROR`；许可分级 `FREE / PERSONAL / TEAM`。
- 契约：`plugin.json`（plugin_id / min_core_version / api_router_module / db_migrations / frontend_modules / hooks / nav_buttons / license_tier）。
- 已启用：项目管理专业版 v2.0（`api_router_module=api`，hook `on_db_init`）。
- 隔离：开源核心（MIT）+ 商业插件私有仓库注入，边界由 `.gitignore` + `build_merged.py` 保障。

## 7.3 交付层判断
- **优点**：Windows 主线交付成熟、插件框架具备完整生命周期与许可分级、开源/商业隔离清晰。
- **技术债**：`start.bat` 标题仍写「v3.0」（版本展示未随 VERSION 更新）；macOS/浏览器扩展/Agent 为旁支，回归覆盖弱。

---

# 八、架构优缺点总评

## 8.1 优点
1. **业务闭环完整、需求对齐度高**，迭代速度快（36 phase 演进有据可查）。
2. **部署极简**：零前端构建 + 单库 + 一键 bat，完美契合「Windows 本地内网」定位。
3. **可观测性与自愈能力强**：request_id 全链路 + 10 项自检 + 信号灯 + 崩溃重启 + 自动备份。
4. **扩展机制成型**：插件框架 + 许可分级 + 开源/商业仓库隔离，商业化路径清晰。
5. **DAM 引擎层解耦良好**：archive/tier/version/sim 引擎与 API 分离，具备独立演进基础。

## 8.2 缺点 / 结构性问题
1. **单体承载临界**：产品边界外扩到 DAM + 项目管理，单进程 + 单库难以支撑重 IO/重算与 Web 请求并存。
2. **前端全局脚本耦合**：45 个 window 全局模块 + 巨石（seedance 2221 / app_tools 1536）+ 3 个 bridge 胶水层，无模块系统、无公共底座。
3. **数据模型多代并存**：卡片三代表、`asset_version`/`asset_versions` 双表、`_old_*` 遗留、110 表含空表/废表。
4. **鉴权是软约束**：安全模型停留在「单用户 admin 兼容」，与「多用户局域网协作」的产品定位不匹配。
5. **DB 访问不统一**：共享连接 vs 自开连接混用，事务/FK 行为不可预期。

---

# 九、全栈技术债务与潜在风险清单

| 编号 | 债务/风险 | 位置 | 影响 | 优先级 |
|------|-----------|------|------|--------|
| T1 | 鉴权未强制 + JWT 密钥非持久 | jwt_auth.py | 安全缺口 + 重启登出 | 🔴 P0 |
| T2 | 卡片模型三代表并存，`_migrate_v4` 每次启动执行 | main.py / DB | 读写分叉、启动开销 | 🟠 P1 |
| T3 | DB 访问策略不统一（自开 sqlite） | asset_library/audit | 事务/FK 不一致 | 🟠 P1 |
| T4 | DAM 归档层 blob_store=0，代码就绪未落数据 | dam_* / engines | 功能未验证即上线风险 | 🟠 P1 |
| T5 | 前端无模块系统 + 巨石 + bridge 胶水 | frontend/static/js | 维护成本、回归面大 | 🟠 P1 |
| T6 | breadcrumb/runtime_log 无保留期清理 | logger/monitor | 单库膨胀 | 🟡 P2 |
| T7 | 110 表含空表/废表/`_old_*` | DB | 认知负担、迁移风险 | 🟡 P2 |
| T8 | 依赖未锁版本（torch/sentence-transformers） | requirements.txt | 构建不可复现 | 🟡 P2 |
| T9 | CORS 全开 + 本地文件写接口无沙箱 | main.py | 攻击面 | 🟡 P2 |
| T10 | start.bat 版本展示滞后、旁支回归弱 | 交付层 | 交付一致性 | 🟢 P3 |

---

# 十、架构优化与扩展落地思路

## 10.1 短期（收敛技术债，低风险，1–2 周）
- **[P0] 鉴权闭环**：设置持久 `PK_JWT_SECRET`（写入 `.env` 并由 `start.bat` 注入），补齐写接口的统一鉴权依赖（FastAPI `Depends(require_role)`），分阶段开启 `_ENFORCE_AUTH`。
- **[P1] 数据模型收敛**：确立 `word_card` 为唯一卡片主线，冻结 → 迁移 → 退役 `prompts`/`prompt_cards`，移除启动期 `_migrate_v4`。
- **[P1] DB 访问统一**：所有 API 收敛到 `database.py`（或统一 `get_conn()` 工厂），消灭自开连接。
- **[P2] 表普查瘦身**：对 110 表做「用途/行数/引用/保留判定」普查，退役空表/废表/`_old_*`；对 breadcrumb/runtime_log 加保留期清理。

## 10.2 中期（服务拆分预备，按边界解耦）
- **拆分优先级（按耦合度/资源画像）**：
  1. **AI 推理网关**（最优先）：`semantic/llm_rerank/ollama_client/playground/translate/optimizer/auto_tag/ocr/comfyui` + torch 重依赖，抽为独立进程/服务，可单独部署/GPU 化，主服务通过 HTTP 调用 —— **解除 torch 与 Web 进程的资源竞争**。
  2. **DAM 存储服务**（次优先）：`archive/tier/version/sim` 引擎 + blob_store，IO/CPU 密集（压缩/代理），独立进程避免阻塞 Web；引擎层已解耦，改造成本低。
  3. **实时协作**（可选）：`ws_collab/presence` 独立化，为多用户扩展铺路。
- **拆分前置阻塞**：**SQLite 单库是服务拆分的最大障碍**。建议先按 bounded context **拆库**（core / dam / collab 分库），再评估是否上 DB 服务（PostgreSQL），否则跨服务共享单文件 DB 无法真正解耦。

## 10.3 前端微前端可行性
- **可行**：现有 `view-panel` 边界天然对应微前端切分线（词卡核心 / 组装器 / 资产库DAM / 项目管理 / 管理后台），且 `PK_ASSETLIB`/`pk_project` 已是自包含命名空间。
- **落地路径**（渐进，不推翻现状）：
  1. 抽 **`pk_common.js` 公共底座**：统一 `fetch`/鉴权头/toast/modal/主题/i18n（当前各 `*_ui.js` 重复实现）。
  2. 引入 **ES Module 边界** 替代 window 全局，用轻量 import map，保留零构建特性。
  3. 巨石拆分：`seedance_v2_composer`(2221)/`app_tools`(1536) 按职责切分，`wc_bridge` 提炼为**统一卡片契约**（消灭三 bridge）。
  4. 按 view-panel 做懒加载（进入面板再加载对应 feature 模块），减小首屏。

## 10.4 公共底层库抽离
- **后端**：抽 `common/`（paths/logger/db/auth/audit 已具雏形），统一 DB 访问层 + 统一鉴权依赖 + 统一响应模型。
- **前端**：`pk_common.js`（http/auth/toast/modal/theme/i18n）+ 统一卡片数据契约 `pk_card_model`（已有 `app_card_model.js` 392 行可作为起点扩展）。

---

## 附录 A：本次评审同步完成的修复
- ✅ **版本号统一**：`VERSION` 文件设为单一来源（`v5.18.0-phase36`）→ `main.py._read_app_version()` 读取 → FastAPI `version` + 封面页 `v5.18` 同步；已重启验证 `/api/status` 返回新版本。
- ✅ **backend 目录瘦身**：`_test_*.py`→`backend/tests/`（+README 运行说明）、`*.log`→`backend/logs/`、调试脚本→`backend/_scratch/`；`.gitignore` 补充归档目录；`compileall` 全绿。
- ⚠️ **发现并记录**：重启触发 JWT 随机密钥重置（T1），已列入 P0。

---
*本报告基于 2026-07-16 源码实测生成，可直接用于架构评审与重构规划立项。*
