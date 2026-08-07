# 咪卡MiK提示词助手 — 系统全景梳理与阶段性总结

> 生成时间：2026-07-16 12:1x GMT+8
> 运行版本：`v5.7.7-phase24`（main.py APP_VERSION）｜服务在线 :8080 ｜ DB 10.23MB / 110 表
> 定位：Windows 本地后端 + 浏览器 WebUI + 局域网多终端，AIGC 创作提示词「存 → 搜 → 调 → 组装 → 资产化」一体化平台

---

## 一、系统总览（L0）

| 维度 | 现状 |
|------|------|
| 后端 | Python + FastAPI + Uvicorn，单进程常驻，`reload=False`，端口 8080→8100 自增探测 |
| 前端 | 原生 JS + Bootstrap5 + HTML5，`index.html` 1053 行 + `style.css` 3510 行 + ~45 个 JS 模块 |
| 存储 | SQLite（WAL），`data/prompts.db` 10.23MB，**110 张表** |
| 认证 | JWT 中间件（仅解析不强制），`users` 6，`user_sessions` 98 |
| 插件 | 插件框架（Phase18），启用 1 个「项目管理专业版 v2.0」，停用 3 个（asset/srs_review/example） |
| 扩展件 | 浏览器扩展（Chrome）、pk_agent.exe（文件管家助手）、macOS 打包、PyInstaller EXE |
| 后端路由 | main.py 注册 **44+ 路由** + 插件路由 |
| 可观测 | runtime_log 22185 / error_breadcrumbs 13255 / user_actions 2558 / user_audit_log 440 |

**版本号三处不一致（技术债）**：`VERSION` 文件=`v3.1.3`、`main.py`=`v5.7.7-phase24`、FastAPI `version=4.0.0`。需统一。

---

## 二、功能域划分（L1）—— 9 大子系统

### 域 1：词卡核心域（存→搜→调）★平台地基
- **后端**：`api/prompts.py` `api/v2.py`(1162) `api/word_cards.py`(933) `api/cards.py`(595) `api/search.py` `api/tags.py` `api/templates.py` `api/versions.py` `api/stats.py`
- **前端**：`app_core.js`(988) `app_search.js` `app_editor.js`(775) `app_card_model.js` `word_card_manager.js` `word_editor.js`(1205) `word_picker.js` `app_i18n.js` `app_theme.js`
- **数据表**：`word_card`(1273) + `word_card_fts` + `word_card_group`(122) + `word_card_versions`(26)；遗留 `prompts`(169)+`prompts_fts`、`prompt_cards`(165)、`library_assets`(233)、`_old_*`
- **能力**：录入/编辑/删除/回收站、FTS 关键词检索、`{{变量}}`模板、标签自动补全、版本存档/diff、一键复制
- **状态**：✅ 成熟。历史演进 `prompts → prompt_cards → word_card` 已统一（migrate_unify_*），但三套表仍并存（可清理）

### 域 2：AI 增强域
- **后端**：`semantic.py`(Sentence-BERT 384维语义搜索) `llm_rerank.py` `ollama_client.py` `api/playground.py`(664) `api/translate.py`(353) `api/optimizer.py` `api/auto_tag.py` `api/ai_thumbnail.py` `api/ocr.py`(536) `api/comfyui.py`(492) `ai_tagger.py`
- **前端**：`app_playground.js` `ai_tools.js`(667)
- **数据表**：`prompt_embeddings`(169) `playground_history` `translations`(46)
- **能力**：语义搜索、LLM Playground（Ollama/OpenAI 兼容）、提示词优化/翻译、AI 自动标签、OCR 提词、ComfyUI 三级自动发现、AI 缩略图
- **状态**：✅ 核心可用，依赖本地 Ollama/ComfyUI（可选，缺失自动降级 SKIP）

### 域 3：原子化 & 智能组装域
- **后端**：`api/atoms.py`(954) `api/atoms_import.py` `api/atom_filler.py`(439) `api/character_composer.py`(439) `api/scene_composer.py`(538) `api/composer_v3.py` `composer_engine.py`(408) `api/seedance.py`(338) `api/seedance_v2.py`(1507) `seedance_v2_seed.py`
- **前端**：`atom_editor.js`(743) `character_composer.js`(789) `scene_composer.js`(801) `seedance_v2_composer.js`(2221 ★最大) `unified_composer.js` `v3_composer.js` `wc_bridge.js`(1191) `composer_wc_bridge.js` `scene_bridge.js`
- **数据表**：`atom_asset_library`(928) `atom_decompose`(13) `atom_variation` `atom_word_bridge`(56) `character_profiles`(5) `character_template`(4) `scene_profiles`(4) `scene_template`(6) `scene_card_ref`(80) `seedance_id_map`(297)
- **能力**：提示词原子化分解、角色/场景档案组装、Seedance V2 分镜编辑器、词卡↔组装器桥接
- **状态**：✅ 功能最重的创作域，Seedance V2 是当前最复杂模块

### 域 4：多用户 & 实时协作域
- **后端**：`auth.py` `jwt_auth.py` `password.py` `api/users.py` `presence.py`(365) `ws_collab.py` `audit.py`(404) `action_logger.py` `breadcrumb_logger.py`
- **前端**：`auth_client.js` `admin_users.js` `presence_client.js` `ws_client.js` `notif_center.js`
- **数据表**：`users`(6) `user_sessions`(98) `user_actions`(2558) `user_audit_log`(440) `notification_queue`
- **能力**：注册/登录/JWT、管理员用户管理、实时在线状态（online/idle/away 巡检广播）、WebSocket 协作、服务端权威审计日志
- **状态**：✅ 地基完成；JWT 中间件当前「仅解析不强制」，部分 API 才 admin-only 硬校验

### 域 5：项目管理域（AIGC 影片全流程）
- **插件**：`plugins/project`（v2.0，personal 授权）`api.py`(993) `api_workspace.py` `api_collab.py` `api_squads.py` + `project_dashboard.js/css`
- **后端**：`api/project_roles.py`(464)
- **前端**：`project_roles_ui.js`
- **数据表**：`master_project`(1) `master_sub_project`(3) `user_project`(5) `user_project_scene`(6) `project_role`(4) `project_role_version`(4) `project_role_review`(36) `project_tasks`(3) `project_milestones`(3) `project_columns`(4) `project_members`(3) `workspace_squads` `squad_members`
- **能力**：7 阶段工作流、总项目+子项目+资产三层、剧本/角色/场景档案、看板/甘特图/里程碑、提示词继承链
- **状态**：⚙️ 半启用。核心表已建但数据量小（多为个位数），是升级重点区

### 域 6：资产库 & DAM 数字资产管理域 ★近期主战场（Phase35.x）
- **后端**：`api/asset_library.py`(472) `api/asset_review.py`(426) `api/device_index.py`(472) `api/dam_archive.py`(540) `api/dam_search.py`(358) `api/dam_vault.py`(295) `archive_engine.py`(435) `tier_engine.py`(333) `version_engine.py` `sim_search.py` `ai_tagger.py`
- **前端**：`asset_library_ui.js`(569) `file_steward_ui.js`(348) `device_manager_ui.js`
- **Agent**：`agent/pk_agent.exe`（绿色便携版文件管家助手：扫描/指纹/上报/心跳/备份）
- **数据表**：`asset_catalog`(409) `asset_module`(14) `asset_version`(465) `asset_review`(42) `project_space`(3) `project_space_member`(28) `user_workspace`(2) `device`(13) `device_file_index`(27) `blob_store`(**0**) `archive_policy`(1) `folder_preset`(1) `media_assets`(473)
- **能力**：项目内嵌模块化资产库、上传查重(sha256)+缩略图、版本管理+审核流(draft→in_review→approved)、成员角色(owner/reviewer/editor/viewer)、设备盘索引、归档(LZMA/WebP/FLAC+代理+内容寻址去重)、感知哈希相似搜索、冷热分层、三层自检、外置备份
- **状态**：⚙️ 资产库/版本/审核 ✅ 已跑通并有数据；**DAM 归档层（blob_store=0）代码就绪但尚未真正落盘数据** —— 下一阶段验证/激活重点

### 域 7：数据同步 / 备份 / 导入导出域
- **后端**：`sync.py`(431 .pkb 包) `backup.py`(自动备份) `api/exporter.py` `exporter.py`(460) `api/media.py` `api/thumbnails.py`(1071) `api/unified_media.py`
- **前端**：`app_sync.js`(774) `app_media.js`(1398)
- **数据表**：`media_assets`(473) `prompt_thumbnails`(12) `prompt_videos`(2) `video_cache`(26) `thumb_hash` `thumb_meta`
- **能力**：`.pkb` 全量包（DB+媒体）导出/恢复/校验、`.pt` 单卡包、每日自动备份、WAL checkpoint、关机备份
- **状态**：✅ 成熟，`data/backups/` 已积累 30+ 快照

### 域 8：运维 & 可观测域
- **后端**：`health.py`(687) `api/monitor.py` `api/logs.py` `logger.py` `daily_report.py`(429) `notify.py`
- **前端**：`health_check.js` `signal_lights.js` `monitor_dashboard.js`(312) `log_viewer.js` `diag_capture.js`(335)
- **数据表**：`runtime_log`(22185) `error_breadcrumbs`(13255) `operation_log` `config`(7) `sys_global_config`(4)
- **能力**：10 项启动自检（DB/WAL/IP/防火墙/Pillow/ffmpeg/Ollama/ComfyUI/Playground/磁盘）、30s 后台信号灯、请求中间件(request_id+面包屑)、崩溃自动重启、每日报告
- **状态**：✅ 完善（HEARTBEAT 心跳已代码化）

### 域 9：交付 & 部署域
- `start.bat` / `QUICK_START.bat` / `start_server.cmd` 启动脚本
- `firewall_open.bat/.ps1/.vbs` 防火墙放行
- `build.spec` / PyInstaller EXE 打包、`build_macos.spec` macOS 打包
- `browser-extension/`（Chrome 扩展：manifest+background+content+popup）
- **状态**：✅ Windows 主线成熟，macOS/浏览器扩展为旁支

---

## 三、端到端交互逻辑链（L2）

**① 存储链**：编辑器录入 → `POST word_cards` → 写 `word_card` + 触发 `word_card_fts` + 异步写 `prompt_embeddings` 语义向量 → 归入 `word_card_group`

**② 检索链**：搜索框 →（关键词=FTS `MATCH` / 语义=Sentence-BERT 余弦 / rerank=LLM 重排）→ 结果带相似度% → 卡片渲染

**③ 调用链**：卡片 → 一键复制 / `{{变量}}` 检测 → 填充分窗 → 渲染最终文本 / 加入组装器

**④ 组装链**：原子库 `atom_asset_library` + 词卡 → `wc_bridge` 桥接 → composer（角色/场景/Seedance V2）→ 分镜/档案 → 结构化输出提示词

**⑤ 资产链**：上传文件 → sha256 查重 + 生成缩略图(PIL/ffmpeg) → `asset_catalog` 入库 → `asset_version` v1 → 提交审核 → reviewer approve → 关键资产 `is_critical=1` + 备份

**⑥ DAM 链**：pk_agent 扫描设备 → 上报指纹/心跳 → `device_file_index` → 归档(压缩+代理+内容寻址去重 `blob_store`)→ 检索/pHash 相似/冷热分层/三层自检/外置备份

**⑦ 协作链**：登录→JWT→中间件解析 actor → workspace/project 成员角色鉴权 → presence 巡检广播 + ws_collab 实时 + `record_audit` 落权威日志

**⑧ 运维链**：每请求 `record_request_middleware`(request_id) → monitor/runtime_log/breadcrumb → 启动/定时 health 自检 → 信号灯(绿/黄/红) → 异常自动重启 start.bat + 自动备份

---

## 四、系统认知与状态评估（L3）

### 成熟稳定（可直接复用）
- 词卡核心（存搜调）、AI 语义/Playground、原子+组装、.pkb/.pt 同步备份、运维自检体系

### 半成品 / 待激活（升级重点）
1. **DAM 归档层**：`blob_store=0` —— 压缩/去重/代理/分层/自检代码全就绪，但从未真正落盘归档数据，需端到端跑通并验证
2. **项目管理域**：表结构全，数据量个位数，7 阶段工作流未被真正使用
3. **JWT 强制校验**：当前「仅解析不强制」，多数写接口未强鉴权，安全上是缺口

### 技术债清单
- **版本号三处不一致**（VERSION/main.py/FastAPI）需统一
- **多套并存表**：`prompts`/`prompt_cards`/`word_card`（卡片三代）、`asset_version`/`asset_versions`、`collections`/`wordpacks`、`_old_prompt_*` 遗留
- **110 张表偏多**，含空表/废表（asset_ratings/comments/review_requests/projects 等 0 行），建议做一次表普查与瘦身
- **backend/ 根目录混入大量** `_test_*.py` / `_startup_*.log` / `_chk_*.py` 散件，建议归入 `tests/` `logs/`
- 单库 10MB + `error_breadcrumbs` 13255 / `runtime_log` 22185 行，需保留期清理策略

### 建议的下一阶段方向（供决策）
- **P0** 版本号统一 + backend 根目录散件归档 + 空表/遗留表普查瘦身
- **P1** DAM 归档层端到端激活验证（真正写入 blob_store，跑通归档→去重→还原→自检）
- **P1** JWT 强制鉴权补齐（写接口全覆盖，闭合安全缺口）
- **P2** 项目管理域落地（把 7 阶段工作流接进真实创作流程）
- **P2** 卡片三代表收敛为单一 `word_card` 主线，退役遗留表

---

*本文件由系统梳理自动生成，作为 Phase24+ 升级开发的认知基线。*
