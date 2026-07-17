# PromptKit — 提示词检索工具

## 【长期铁律】产品设计哲学（2026-07-17 用户确立，功能开发全程贯彻）
- **应用 = 朋友 + 得力助手**，服务于用户、服务于创作；不是牢笼、不是控制机器。交互与命名绝不能让用户感到被支配、被管理、被监视、被评判。
- **协作共创理念**：用户是创作者主体，文案以用户为主语（我的/邀请/发起）；职责分工只为满足创作需求，是分工非等级；否定必附建设性出口；透明即尊重（用户可查自己足迹）；状态呈现由用户自控。
- 术语改造基准：用户管理→团队空间，admin→主理人，owner→发起人，editor→共创者，reviewer→把关人，viewer→鉴赏者，驳回→建议打磨，批准→采纳，审核中→共审中，停用用户→暂停协作。只改显示层，API/DB 枚举不动。
- 方案文档：`reports/UX优化方案_用户主体性命名改造_2026-07-17.md`

## 2026-07-16 Phase35.3-DAM 开发总结

### 开发时间
04:46–05:00 GMT+8，约 2 小时

### 背景
用户确认进入开发，从 DAM（数字资产管理）全生命周期视角重构设备盘索引模块。

### 新增文件
| 文件 | 用途 |
|------|------|
| `backend/migrate_35_3_dam.py` | DAM 迁移：asset_catalog 扩展 11 列 + blob_store/project_snapshot/archive_policy/sys_notifications + device 补列 |
| `backend/archive_engine.py` | 归档引擎：压缩(LZMA/WebP/FLAC)、代理生成(图片/视频/音频)、内容寻址去重、还原 |
| `backend/api/dam_archive.py` | DAM API 路由：归档/还原/搜索/快照/策略/存储统计/完整性自检/通知 (20+ 端点) |
| `frontend/static/js/file_steward_ui.js` | 文件管家前端UI：设备列表/文件浏览/归档向导/配对码/存储统计/完整性自检 |
| `agent/pk_agent.py` | 文件管家助手（绿色便携版）：扫描/指纹/上报/心跳/备份任务 |

### 修改文件
| 文件 | 改动 |
|------|------|
| `backend/main.py` | 注册 dam_router |
| `frontend/index.html` | 「项目」下拉新增「📁 文件管家」入口 + 加载 file_steward_ui.js |
| `frontend/static/css/style.css` | 新增 40+ 行文件管家样式（深色/浅色双模式） |

### 关键设计与决策
- **命名体系**：设备盘索引→文件管家，Agent→文件管家助手，监控路径→关注的文件夹
- **概念压缩**：7层抽象→2层（设备列表→文件浏览），用户不可见 L0/L1/指纹等技术词
- **文件夹必须手动指定**：空列表不工作，不自动推荐/预设
- **归档=拷贝+压缩+落盘**（不是只建指针），原始文件继续当工作文件
- **全局内容寻址去重**（blob_store）：同一 sha256 只存 1 份实体，多 catalog 共享引用
- **压缩策略按文件类型自动选**：C4D→LZMA(省60%), PNG→WebP Lossless, WAV→FLAC, MP4→不压+生成720p代理

### 验证
- health 200, FK=0, 110 表
- API 端点全部可达 (health/storage/policy OK, devices/alerts 需登录 403 符合预期)
- Node.js 语法检查通过，Python 编译通过
- 数据库新增 5 表 (blob_store/archive_policy/project_snapshot/sys_notifications 已建, archive_engine 自测通过)

## 2026-07-16 规划修正 — 移除 SRS 间隔复习

**决策**：SRS 间隔复习从开发规划中永久移除。
**原因**：词卡定位是**存储+复用**，核心场景为「**存→搜→调**」，与记忆复习场景无关。
**影响**：
- SRS 插件早在 2026-07-10 即已开发完成并回滚至 `plugins/_disabled/srs_review/`
- 路线图 `DEVELOPMENT_ROADMAP.md` 已移除 SRS 相关条目
- v4.2.0-phase14 从「模板变量+学习系统」改为「模板变量+协作导出」

## 2026-07-14 开发总结（Phase34–36 + 导航/UI统一）

### 开发时间
10:00–22:56 GMT+8，约 13 小时，一次性完整会话。

### 回归验证
5 套回归脚本全部通过（presence 11/11, audit 18/18, asset_library 20/20, asset_review 21/21, phase36 18/18），总计 88/88，exit 全 0。

### 新增文件清单
| 文件 | 用途 |
|------|------|
| `backend/presence.py` | 实时在线状态 WS + REST |
| `frontend/static/js/presence_client.js` | 在线状态客户端 |
| `backend/audit.py` | 用户活动审计日志 |
| `backend/api/asset_library.py` | 项目资产库 API（上传/查重/缩略图/备份） |
| `backend/api/asset_review.py` | 资产版本/审核/成员 |
| `frontend/static/js/asset_library_ui.js` | 项目资产 UI（模块化网格/版本/审核/溯源/关联） |
| `backend/api/project_roles.py` | 项目角色/场景实例 API（继承/版本/档案/审核/分镜联动） |
| `frontend/static/js/project_roles_ui.js` | 项目角色/场景库 UI |
| `backend/migrate_phase35.py` ~ `phase36_review.py` | 8 个幂等迁移脚本 |
| `backend/seed_character_groups.py` | 角色词卡分组种子（14 组 110 张） |
| `backend/seed_scene_groups.py` | 场景词卡分组种子（13 组 102 张） |
| `backend/gen_wordcard_thumbs.py` | 角色/场景词卡缩略图生成 |
| `backend/migrate_legacy_media.py` | 旧 v4media 数据在位索引迁移 |
| `backend/_test_phase36.py` | Phase36 组合回归脚本 |

### 修改文件清单
- **后端**：`main.py`, `auth.py`, `api/users.py`, `api/logs.py`, `api/v2.py`, `audit.py`, `action_logger.py`, `api/character_composer.py`, `api/scene_composer.py`
- **前端**：`index.html`, `admin_users.js`, `auth_client.js`, `ws_client.js`, `app_tools.js`, `monitor_dashboard.js`, `character_composer.js`, `scene_composer.js`, `seedance_v2_composer.js`, `project_roles_ui.js`
- **插件**：`plugins/project/__init__.py`, `plugins/project/api.py`, `plugins/project/plugin.json`
- **停用**：`plugins/asset/` → `plugins/_disabled/asset/`（资产管理专业版已退役）

---


## Phase35.2 资产版本管理 + 验证审核 + 团队协作（2026-07-14 下午）

### 迁移 migrate_phase35_2.py（已跑+快照 phase35_2_pre_*.db，FK=0）
- 新表：`asset_version`(catalog_id/version_no/fingerprint/filename/size/local_rel_path/thumb_path/author/note/status[draft|in_review|approved|rejected]) / `asset_review`(catalog_id/version_id/reviewer/action[submit|approve|reject|comment]/comment) / `project_space_member`(project_space_id/user_id/role[owner|reviewer|editor|viewer], UNIQUE(proj,user))。
- asset_catalog +current_version_id/+review_status/+version_count。
- 回填：每项目 owner→owner成员；每资产→v1 版本 + current_version_id。

### 后端 api/asset_review.py（复用 asset_library 辅助）
- 角色模型（项目内）owner>reviewer>editor>viewer；`_proj_role()` → admin/owner→owner，成员按其role，共享项目非成员默认editor，私有非成员 None。can_edit=owner|editor；can_review=owner|reviewer；can_manage=owner。
- 端点：GET /api/assets/{cid}(详情+role) ; 版本 GET/POST /api/assets/{cid}/versions(multipart上传新版→version_no+1,状态回 draft,更新catalog指针/指纹/缩略图) + POST /rollback/{vid} + GET /api/versions/{vid}/thumb ; 审核 POST /submit(draft→in_review) / POST /review{approve|reject,comment}(仅 owner|reviewer;approve且backup_policy!=none→is_critical=1,backup_status=backed_up) / POST /comment / GET /reviews ; 成员 GET/POST /api/projects/{pid}/members + DELETE /members/{uid}(仅owner;不能移除owner)。
- 审计埋点 asset_version/asset_submit/asset_approve/asset_reject/member_add/member_remove（audit.EVENT_DICT 已加中文名）。
- **修改 asset_library.py**：_can_access +成员可访问被共享的私有项目；list_projects(all) +“我是成员”的项目；**create_project 补 owner 成员行**；**upload_asset 补建 v1 asset_version**（否则新上传资产无版本行）。
- main.py 注册 asset_review_router。

### 前端 asset_library_ui.js v2(?v=2)
- 资产卡：左上**审核状态徒章**(草稿/审核中/已通过/已驳回)、左下v版本数、右上★关键；点击缩略图/文件名→详情弹窗。
- 资产详情弹窗 openAsset：大预览(图/视频/音频/文件图标) + 版本历史(缩略图/当前标记/回滚) + 审核动作(提交/批准/驳回按role显示) + 评论框 + 审核时间线；上传新版本。
- 项目头部「👥成员」→成员管理弹窗（列表/按用户名+角色添加/移除，仅owner可管）。
- 验证：JS node --check 通过 / 服务200 / 含 openAsset+openMembers。需强刷拿 v=2。

### 验证（重启8080后端到端 21/21）
建私有项目/上传v1/版本1+draft/上传v2/版本2/回滚/提交in_review/非成员404/加reviewer成员/成员可访问/reviewer批准→approved/批准后is_critical=1/审核记录含submit+approve/评论/无关用户404/成员=owner+reviewer/非owner加成员403/移除成员/移除后不可访/不能移除owner/删项目 均PASS。

### 部署/注意
- reload=False，已重启 8080（日志 backend/_p352_startup.log）。静态资源免重启，强刷拿 asset_library_ui.js?v=2。
- 回归：python backend\_test_asset_review.py（注意：测试脚本中参数名用 tk 而非 token，否则写入时 token=None 会被密钥掩码成 *** 导致语法错）。
- 待办：35.3 设备盘索引(M-Agent推荐/M-FSA需HTTPS)+自检+分级备份/恢复；35.4 DCC/AI标签/3D预览/批注审阅。

---

## Phase35.0/35.1 多用户工作空间 + 项目内嵌模块化资产库（2026-07-14 中午）

### 已确认决策
- Q1 混合存储：服务器主盘=关键信息/索引+共享空间；各自设备盘=实际媒体+工程源文件(C4D/AE/PS)。
- 分级存储：L0索引层(全部指纹/元数据/缩略图) / L1备份层(关键资产真实副本,内容寻址去重) / L2本地层(制作中文件只索引)。"索引≠备份,防丢必须存真实字节"。
- 分期 35.1服务器托管资产库 → 35.2版本+审核+团队共享 → 35.3本地优先+自检+自愈备份 → 35.4进阶(DCC/AI标签/3D预览/批注审阅)。
- 方案文档：PLAN_Phase35_user_workspace.md + PLAN_Phase35_MAM.md(竞品对比 Connecter/Perforce P4 DAM/Kitsu/Frame.io/immich)。

### 35.0 地基（migrate_phase35.py，已跑+快照）
新表：user_workspace(owner/name/location[server|device]/storage_root/visibility[private|shared]/is_default) / folder_preset(系统内置+自定义) / project_space(workspace内多项目) / asset_catalog(中心轻索引:fingerprint/perceptual_hash/thumb_path/origin_device/local_rel_path/status)。master_project +可空 workspace_id 回填默认公共空间(id=1)。种子：默认公共工作空间(server/shared) + 系统预设「影视/短视频」7段目录。FK=0。

### 35.1 项目内嵌模块化资产库（服务器托管上传）
- 迁移 migrate_phase35_1.py：asset_module 字典(14模块 image/video/audio/project_ps·ai·ae·c4d·pr·blender·au/model_3d/doc/subtitle/other，含 default_folder/media_kind/accept_ext) + project_space +modules_json/backup_policy + asset_catalog +module_key/is_critical/backup_status/backup_path。
- API backend/api/asset_library.py（自持sqlite+get_current_user）：GET /api/asset-modules；项目 POST/GET/GET{id}/PUT/DELETE /api/projects(建项选模块→生成隔离目录;私有→自动建个人私有工作空间,共享→默认公共)；资产 POST /api/projects/{id}/assets(multipart→sha256查重+缩略图[PIL图/ffmpeg视频首帧]+入库;工程文件默认 is_critical=1) / GET assets(列表+按模块计数) / PATCH /api/assets/{cid} / DELETE / GET /api/assets/{cid}/thumb|file(路径限 data/ 内防穿越) / GET /api/projects/{id}/dedup。私有隔离 _can_access(owner/共享/admin)；审计埋点 project_create/delete、asset_upload/delete。
- 存储：私有 data/workspaces/user{uid}/projects/proj{pid}/<模块目录>/；共享 data/projects/proj{pid}/；缩略图 data/catalog_thumbs/{cid}.jpg。
- 验证（重启8080后 20/20 PASS）：模块≥14/建私有项目/上传图片生缩略图/图片非关键/查重命中/C4D默认关键/错扩展名被拒/列表计数/缩略图服务/原文件服务/查重报告1组/他人看不到私有/他人访问404/他人上传被拒/删资产/删项目。

### 部署/注意
- reload=False，已重启 8080（当前 PID 44716，日志 backend/_p351_startup.log）。备份快照 data/backups/phase35_pre_*.db、phase35_1_pre_*.db。回归 python backend\_test_asset_library.py。
- **前端 UI 已完成（Phase35.1-UI）**：新增 `frontend/static/js/asset_library_ui.js?v=1`（自包含 PK_ASSETLIB，不侵入 78KB 项目插件）+ index.html 加 `#viewProjectAssets` 面板。header 导航注入「📦 项目资产」按钮 → 项目列表(全部/我的/共享筛选,卡片显模块图标/资产数) → 新建项目向导(名称/可见性/备份策略/多选模块) → 项目详情(按模块分区网格,缩略图/星标关键/下载/删除,每模块上传多文件,重复告警,⚙编辑模块,🔍查重弹窗)。静态资源免重启,用户强刷即可。验证：JS node --check 通过 / 服务200 / API 形状一致(14模块,module_info 字段齐)。
- 待办：35.2 asset_version+asset_review+团队共享；35.3 设备盘索引(M-Agent推荐/M-FSA需HTTPS)+自检+分级备份/恢复。

---

## Phase35-audit 用户活动审计日志 — 账户登录态/关键操作服务端可追溯（2026-07-14 上午）

### 背景/痛点
旧日志无法归属到账户：`action_logger.py` 写 `user_actions`（前端行为 2219 条）但 **从不填 `actor_id`**（该列早被某迁移 ALTER 加上但没用）；登录/登出只在 `user_sessions`；`/api/logs/*` 无鉴权、无按用户过滤。→ 管理员无法追溯“某账户干了什么”。

### 实现
| 层 | 文件 | 改动 |
|----|------|------|
| 后端 | **新增 `backend/audit.py`** | 专用**服务端权威审计表 `user_audit_log`**(user_id/username/event_type/category/status/detail/target_type/target_id/client_ip/device/ua/created_at + 3 索引)；`record_audit()` 短连接写入、异常不影响主流程；`resolve_actor()` 从 JWT 解析登录者；EVENT_DICT/CATEGORY_NAMES 中文字典；`_parse_device` UA→设备。端点（均 **admin-only**）：`/api/audit/user/{uid}`(审计事件，查询“该账户自己做的 OR 针对该账户做的 target_id”) / `/user/{uid}/actions`(前端行为 actor_id 过滤) / `/user/{uid}/sessions`(登录会话+设备) / `/user/{uid}/summary`(首末登录/次数/失败数/最近活动/分类计数/当前在线态) / `/feed`(全局) / `/event-types` |
| 后端埋点 | `auth.py` | login(成功)/login_failed(三种失败:用户不存在/禁用/密码错)/logout/register 均 `record_audit` |
| 后端埋点 | `api/users.py` | update(区分 user_toggle/password_reset/user_update+变更字段) / delete(user_delete,删前取名) / batch-toggle |
| 后端 | `action_logger.py` + `api/logs.py` | `record_action` 新增 `actor_id` 参数并写入；`/api/logs/action(s)` 从 token 解析 `_actor_id(request)` → 给前端行为补齐账户归属 |
| main.py | 注册 | `include_router(audit_router)` |
| 前端 | `admin_users.js` **v3(?v=2)** | 用户卡新增「📜 日志」按钮 → `openLog(uid,name)` 弹窗：顶部概览chips(当前在线态接 PK_PRESENCE/最后登录/登录次数/失败/最近活动/审计数/行为数) + 三标签【审计事件/操作行为/登录会话】+ 搜索/分类筛选 + 分页“加载更多”；图标化行渲染，失败/错误红色。走全局 fetch 拦截器自动带 token |

### 验证（重启 8080 后，端到端 18/18）
注册→错密码登录被拒→正确登录→审计含login/login_failed/register→summary(登录次数/失败数/最后登录)→会话历史含device→改角色(user_update)→停用(user_toggle)→非管理员403→feed→删除(user_delete) 均 PASS。关键修正：`/user/{uid}` 列表按 `(user_id=? OR (target_type='user' AND target_id=?))`，使管理员对该账户的操作也能在该账户日志里看到。

### 部署/注意
- **reload=False**，已重启 8080（当前 PID 45680，日志 `backend/_audit_startup.log`）。管理员需强刷拿 v=2 的 admin_users.js。
- 回归测试：`python backend\_test_audit.py`。
- 历史 `user_actions`(2219条) 的 actor_id 仍为 NULL（只能归属今后新行为）；旧登录事件无审计记录（只有 user_sessions）。

### 遗留/可扩展
- 项目/素材的 create/update/delete 已定义 event_type 但**尚未在各业务端点埋点**（待 Phase35 工作空间阶段一并接）。
- 可加：日志导出 CSV、保留期/自动清理、可疑登录告警。

---

## Phase34 实时在线状态（Presence）— 局域网多账户实时在线态（2026-07-14 上午）

### 背景/痛点
“在线状态”之前全是假的：`auth_client.js` 用户菜单/个人详情里的“🟢 在线”是**写死的静态文本**（只对自己显、永远绿）；`admin_users.js` 只显 `is_active`(账户启停)+`last_login_at`(静态时间戳)；`ws_collab.py` 的 `_online_users` 只跟踪进入某项目协作房间的用户，`_notif_conns` 只做定向推送不向全体广播。→ 局域网多账户登录时，谁真在线/什么状态前端看不出。

### 实现（独立通道，零侵入 Phase29 通知）
| 层 | 文件 | 改动 |
|----|------|------|
| 后端 WS | **新增 `backend/presence.py`** | 独立 `/ws/presence?token=JWT` 通道；JWT 鉴权（以 token 内 user_id 为准）；连接池 `_conns{uid:{cid:{ws,client_ip,device,connected_at,last_active}}}` 支持**一用户多设备/多标签**聚合；`_derive_status` 状态机 online(<90s)/idle(90-300s)/away(>300s 或手动)/busy(手动)/offline(无连接)；`_parse_device` 从 UA 解析设备(iPhone·Safari / Windows·Edge...)；任一变化 `_broadcast` 向全体广播 `presence_update`/`presence_offline`；`presence_sweep_loop()` 每 15s 巡检推导 idle/away 跨阈广播 |
| 后端 API | presence.py | `GET /api/presence` 快照(首屏/降级轮询/管理页初始化)；`POST /api/presence/status` 手动设自身 online/away/busy |
| main.py | 注册 | `include_router(presence_router)` + lifespan `loop.create_task(presence_sweep_loop())` |
| 前端 | **新增 `frontend/static/js/presence_client.js`** | 登录即连、常驻；25s 心跳 ping；监听 mousemove/keydown/scroll/touch/visibility 节流(≤20s)发 `active`；收 snapshot/presence_update/presence_offline 维护 `_users` 并派 `pk:presence` 事件；**header 在线人数指示器**(绿点+计数，点击弹出在线列表：头像/状态色点/角色/设备/在线时长)；指数退避重连 |
| 前端 | `admin_users.js` | 每张用户卡头像右下实时状态点 + meta 行实时徒章(🟢在线/🟡空闲/⚪离开/🔴忙碌/⚫离线 + 设备)；订阅 `PK_PRESENCE.on()` 无刷新更新；统计栏新增“🌐在线 N” |
| 前端 | `auth_client.js` | 登出时 `PK_PRESENCE.disconnect()` + 移除指示器 |
| 前端 | `index.html` | 引入 `presence_client.js?v=1`（在 ws_client.js 后） |

### 验证（重启 8080 后，多账户 WS 端到端 11/11）
A首屏snapshot(self_id) / A快照含自己online / A实时收B上线 / B手动busy广播到A / B恢复online / A收C(张鹏,admin)上线 / REST快照含1,2,10且total=3 / 含设备信息 / B断开→A收presence_offline / A多标签connection_count=2 / A关一标签仍online(count=1)。状态机单测：now→online/120s→idle/400s→away/manual busy/no conn→offline 均正确。

### 部署/注意
- **reload=False**，已重启 8080（杀 PID 38028 → `python backend\main.py` 后台，日志 `backend/_presence_startup.log`）。旧前端客户端需**强刷**才会加载 presence_client.js 并连 presence 通道。
- 本机 IP 192.168.0.101；自检提示防火墙未配置 8080（旧提示，不影响本次）。
- 回归测试：`python backend\_test_presence.py`（需 websockets 库）。

### 遗留/可扩展
- idle/away 阈值写死(90s/300s)，可做成配置。
- 可选：在在线列表里显“当前所在页面/项目”（需客户端上报当前视图）；可接 admin “强制下线/踢出”。
- 与 Phase29 通知通道完全解耦（每客户端登录后现持有 collab(仅项目页)+notif+presence 最多 3 条 WS）。

---

## Phase32 P4 后期音频资产接入（2026-07-13 晚）

### 背景
Phase31 后 P4 工作台已有清单但 `_renderPhaseExtra` 唯独 P4 无专属面板(P5/P6 有)；而 master_asset 早支持 `bgm`/`sfx` 类型却无任何 UI 入口(P2 只渲染 character/scene/prompt_template/ref_image)。

### 实现（纯前端，零后端改动）
- project_dashboard.js **v2.5.0**：`_renderPhaseExtra` 新增 P4 分支 → `_renderP4Audio()`。
- `_renderP4Audio`：并发拉 `?asset_type=bgm` + `?asset_type=sfx`，分组(BGM/音效)卡片列表；有 image_path 则渲染 `<audio controls preload=none src=path>` 预览，无则显“未设音频路径”。
- `_showAudioForm(type)`：专用轻量弹窗(名称 + 音频路径/URL + 描述) → POST /master/{id}/assets（asset_type=bgm/sfx，音频路径存入 image_path 复用字段，无需新 schema）。`_deleteAudio` → DELETE /master/assets/{id}。
- 设计分工：P2=视觉资产，P4=音频资产，干净隔离。

### 验证(master 3, 前端依赖的 API 路径)
创建 bgm/sfx→分类型拉取(bgm=1/sfx=1)→有路径渲染audio/空路径提示→P2视觉资产不受影响(character=1)→删除回零。master3 原资产(character李白/script测试)完好。
- 纯静态资源，无需重启；用户强刷拿 v2.5.0。

### 遗留/可扩展
- 目前音频靠粘贴路径/URL（与封面编辑器同思路）；未接文件上传/媒体库选择器(媒体库当前只有图/视频，无音频)。后期可接 P4 时间轴。

---

## Phase33 封面图替换 + 基表-视图漂移审计（2026-07-13 晚）

### 封面占位图 → 真实媒体截图
- `PUT /api/cover` 更新 cover_images: 3 张占位 `/static/img/covers/*.png` → `/api/thumbnails/file/{uuid}.jpg`(真实缩略图,从 369 张中选,各约 600KB 高清)。
- 纯数据操作,无代码改动；封面 `/api/cover` 返回数据确认已更新,缩略图 URL 均可 200 访问。用户需强刷看新封面。

### 基表 vs 视图/迁移漂移审计
- **发现**：`database.py` 中 `prompt_library` 和 `prompt_word_card` 仍定义为 `CREATE TABLE IF NOT EXISTS`，但实时库已被迁移改为 **VIEW**(底层映射 `word_card_group`/`word_card`)。
- 实时库另有 `_old_prompt_library`+`_old_prompt_word_card` 两张备份表(迁移重命名产物),证实迁移过程存在但 database.py 没跟进。
- **新装风险**：新库执行 `CREATE VIEW IF NOT EXISTS`(SQLite 3.50+ 支持)方可保 schema 正确；当前 `CREATE TABLE IF NOT EXISTS` 在新库会确实建表(因为无同名视图可跳),导致后续迁移需纠正,产生 schema 抖动。
- **方案记录**：database.py 中这 2 处应改为 `CREATE VIEW IF NOT EXISTS`(定义与实时库视图一致) + 确保 word_card_group/word_card 建在前。列为中等技术债,适合下阶段专项清理。

### 遗留
- 封面数据已更新但**需强刷**浏览器才能看到新图。

---

## Phase31 P4-P6 阶段工作台落地 — 7 阶段流程闭环（2026-07-13 晚）

### 背景
P4(后期)/P5(交付)/P6(归档) 一直是「Coming soon」占位。project_tasks 已有 `phase` 列，可分阶段。

### 实现
- **后端**(api.py)：`list_tasks` 新增 `phase` 过滤参；`create_task` 接受 `phase`(默认 P3)，且**仅 P3 自动分配看板列**（P4-P6 任务 column_id=NULL，不进看板）。
- **前端**(project_dashboard.js v2.4.0)：`_renderP4P6` 重写为阶段工作台：
  - 每阶段独立**工作项清单**(添加/勾选完成/删除/进度条)，基于 project_tasks(phase 过滤)。
  - `_phaseMeta` 内置预设流程：P4[粗剪/精剪/调色/配乐音效/字幕/成片输出]、P5[内部审核/客户审核/修改反馈/终审/交付打包]、P6[复盘/提示词归档/素材归档/经验总结]，「✨生成流程清单」一键播种。
  - **P5 专属**：交付摘要卡 + 「✅ 标记交付完成」(PUT /master/{id} status=completed)。
  - **P6 专属**：项目复盘统计面板(各阶段完成度进度条 + 任务/分镜/资产总数，复用 phase_stats)。
- **P3 看板隔离**：`_renderP3Kanban` 改拉 `?phase=P3`，P4-P6 任务不再混入看板。

### 验证(master 3)
P4 seed 4 项(column_id 均 None)；阶段隔离 P4=4/P3=0；勾选 2/4；P5 status draft→completed→回退；P6 phase_stats 正确(P4:4/2)；master2 P3 看板回归=3。

---

## Phase30.1 删除端点手动级联 — 根治孤儿问题（2026-07-13 晚）

### 根因
app 运行时 `PRAGMA foreign_keys` 默认 **OFF**，所有 `ON DELETE CASCADE` 均不触发 → 删除 master_project / user_project / 子项目 会遗留孤儿子行(本会话 master3 丢失、Phase28.1 三悬空行均源于此)。

### 方案选择
- **未**全局开 `foreign_keys=ON`：该库多年 FK OFF + 历史视图当 FK 等遗留，贸然全开可能让现有功能突然报错，风险高。
- **采用**在删除端点手动级联清理，精准堵住产生孤儿的路径，零波及面。

### 实现（api.py）
- 新增 `_cascade_delete_master(db, master_id)`：按 FK 安全顺序删 project_task_scene→tasks→columns→milestones→members→squad_members→workspace_squads→invites→master_asset→master_sub_project→activity_feed→master_project。每步 `_try` 容忍表不存在。保留 seedance user_project(遵原 ON DELETE SET NULL 设计)。
- `delete_master_project` 改调 `_cascade_delete_master`。
- `delete_sub_project`：先 `UPDATE master_asset SET sub_project_id=NULL` 再删。
- `delete_project`(user_project)：置空 master_sub_project.seedance_project_id + 删 project_task_scene/user_scene_prompt/user_project_scene 再删项目。

### 验证
一次性测试总项目(4列/1任务/2里程碑/1成员/1资产) → 删除后所有子表归零，foreign_key_check violations=0，master 2/3 未受影响。

---

## Phase30 master3 团队看板初始化 + 可复用 init-board（2026-07-13 晚）

### 发现（重要）
master 3「宣传片」的 `master_project` 主行已不存在（只剩 id=2），但遗留 master_asset×2(测试/李白) + workspace_invites×3 悬空指向 master 3。根因：app 运行时 `PRAGMA foreign_keys` 默认 **OFF**，master 3 被（UI）删除时 `ON DELETE CASCADE` 未触发 → 子表变孤儿。（Phase28/29 从未动 master_project。）

### 处理
1. **重建 master 3**：显式回收 id=3 插入「宣传片」(draft, ad, 16:9/4K) → 遗留的 2 资产 + 3 邀请自动重新关联(因它们 ref 3)。备份 phase30_master3_*.db。foreign_key_check=0。
2. **新增可复用端点** `POST /master/{id}/init-board`(api.py)：幂等初始化—默认看板列(待办/进行中/审核中/已完成，仅无列时) + 可选创始成员(founder_user_id/role，已在则跳) + 可选起始里程碑。返回 created 计数。
3. **应用到 master 3**：created {columns:4, members:1(张鹏=总制片人 uid10), milestones:3(脚本定稿/样片初剪/成片交付)}。再次调用 created 全 0(幂等验证通过)。
4. **前端**：团队成员空状态新增「🚀 一键初始化团队看板」按钮→ `_initBoard()` 调 init-board(以当前登录用户为创始总制片人)。版本 v2.3.0。

### 验证
master 3 dashboard ok，看板 4 列/成员 1/里程碑 3；master/list 显示 2+3。

### 遗留
- 该 accepted 邀请(D9EF6F, master3) 无对应 project_members(旧测试残留)，低优先。
- 根本防范：app 运行时未开 `PRAGMA foreign_keys=ON`，删项目不级联 → 会持续产生孤儿。后续可考虑在删除端点手动级联或连接统一开 FK。

---

## Phase28 数据模型迁移 — project_id/master_project_id 彻底收敛（2026-07-13 下午）

### 背景
团队协作 4 表(project_members/columns/tasks/milestones)历史上同时带 `project_id`(旧 seedance/projects 维度) + `master_project_id`(Phase22 新顶层)。project_id 现值全是死值 29(已删项目)。前端 project_dashboard.js 100% 只用 master_project_id;后端 `else project_id` 是死路径。→ 定案:master_project_id 单一主键,project_id 退役。

### 执行(3 阶段,每步备份+API回归)
| Phase | 内容 | 备份 |
|-------|------|------|
| 1 数据归一化 | 4 表死值 project_id 29→0,13 行,零风险无改码 | phase28_premigration_20260713_174049.db |
| 2 代码收敛 | api.py 删全部 else 死分支+INSERT去project_id;`_on_project_created`中和;gantt改master(顺带修前端`?project_id=masterId`bug);`_sync`→no-op;api_workspace.py:178去project_id;插件`_ensure_tables`新装schema改master模型 | — |
| 3 Schema收敛 | 4表整表重建移除project_id(因idx_pt_project索引+members UNIQUE,DROP COLUMN不可行)。保留id维持project_task_scene外键;新idx_pt_master;新UNIQUE(master_project_id,user_id)。integrity=ok,行数4/3/3/3零丢失 | phase28_dropcol_20260713_180846.db |

### 前向迁移
- `plugins/project/migrations/003_phase28_converge_master.py`:幂等,检测到project_id列即整表重建收敛。已在实时库验证「已收敛,跳过」。用于旧库/新机重部署自动收敛。
- **未改写** db_migrate_phase18.py(保留历史迁移);Phase4 废表清理**有意推迟**(project_assets 是资产插件活跃表;projects/project_templates/review_requests 仅迁移文件引用,删除收益极小且引发schema漂移)。

### API 回归(master 2「特种兵学校」)
- 读 columns/tasks/members/milestones = 4/3/3/3;dashboard/org-tree 正常。
- gantt `?master_project_id=2` 与 `?project_id=2` 均正确解析(前端bug修复)。
- 建/改/删生命周期:列/任务/里程碑/成员全通过,**无 project_id NOT NULL 报错**;成员新 UNIQUE 去重返回 409。

### 已知遗留(非本次)
- 库内预存无关外键违规:`user_custom_word` → `prompt_library`(foreign_key_check 全库扫描会命中,本次用表级 foreign_key_check(表名) 规避)。低优先技术债。

---

## Phase28.1 遗留外键修复 — 结构性坏 FK + 悬空孤儿行（2026-07-13 傍晚）

### 根因(比预期严重)
- `prompt_library` / `prompt_word_card` **都是视图(VIEW)**，不是表。`user_custom_word.library_id REFERENCES prompt_library(id)` → **外键引用视图，结构上无法成立** → SQLite 报 "foreign key mismatch"，也是 Phase28 整库 foreign_key_check 直接崩溃的元凶。
- `prompt_library` 视图 id = `word_card_group.id`(干净1:1)；`prompt_word_card` 视图 id = `COALESCE(seedance_id_map.old_id, word_card.id)`(重映射，不可作 FK 目标)。

### 修复
1. **实时库**：重建 `user_custom_word`(0行)，`library_id` FK 由视图 `prompt_library` → 真表 `word_card_group(id) ON DELETE CASCADE`。备份 phase28_1_fkfix_*.db。
2. **database.py(新装源头)**：`user_custom_word.library_id` 改指 word_card_group；`user_scene_prompt.word_card_id` 去掉 `REFERENCES prompt_word_card(id)` 死 FK(对齐实时库已在用的正常结构)。
3. **整库 foreign_key_check 跑通后暴露 3 条真实悬空行**，均 Phase23 测试残留，已按条件清除：workspace_invites×1(指已删 master1 的死邀请) + user_sessions×2(已删测试用户 uid4/6 的会话)。备份 phase28_1_orphans_*.db。

### 结果
- **整库 `PRAGMA foreign_key_check` violations=0**（从崩溃 → 3 悬空 → 0），integrity_check=ok。
- 活数据完好：workspace_invites 4→3、user_sessions 80→78（仅删孤儿）。服务 health 200。

### 未处理技术债
- database.py 中 `prompt_word_card` 仍以 `CREATE TABLE IF NOT EXISTS` 定义，但实时库已被迁移改为 **视图**(基表与迁移后现状漂移)。新装走 CREATE IF NOT EXISTS 因同名视图存在而自动跳过，不报错；彻底校正需一次专项「基表 vs 视图/迁移漂移」梳理，已记录，低优先。

---

## Phase29 通知实时推送 — WebSocket 取代 30s 轮询（2026-07-13 傍晚）

### 背景
`_startNotifPoll` 用 `setInterval(30000)` 轮询 unread-count，铃铛刷新最长 30s 延迟。ws_collab.py 已有 `ws_notifications` 端点骨架(JWT 认证)但只收不推。

### 实现(3 层，零破坏改旧)
| 层 | 文件 | 改动 |
|----|------|------|
| 1 后端 WS | `ws_collab.py` | 新增 `_notif_conns` 连接池(user_id→WebSocket Set，多标签/多设备)；`ws_notifications` 升级:以 token 内 user_id 为准防冒用 + 注册/注销清理；新增 `push_to_user()` 线程安全推送(`asyncio.run_coroutine_threadsafe` 给同步请求处理器用)；`_capture_loop()` 捕获事件循环；`/ws/status` 增 notif 计数 |
| 2 后端 API | `api_collab.py` | `_notify()` 写 DB 后 `from ws_collab import push_to_user` 实时推送；失败降级(DB 已落库) |
| 3 前端 | `project_dashboard.js` | `_startNotifPoll` 加 `_connectNotifWS()`:读 `pk_token`+`pk_user` 连 `/ws/notifications/{uid}`，收到 `notification` 即刷铃铛+toast；断线指数退避重连(3s/15s，最多5次)；**保留 30s 轮询降级** |

### 端到端验证
- Python websockets 客户端连 WS → API `push_notification` 写入 → **~200ms 内 WS 收到 `type:notification`** ✅
- 生成测试 token: `backend/jwt_auth.generate_test_token(uid,name,role)`
- 离线用户 DB 已落库，下次轮询可见；多标签每标签独立连接全收到

### 保留的降级
- WS 断开时 30s 轮询继续；未登录不连 WS 纯轮询；`_notify()` 推送失败只 catch 不报错

---

## ⚠️ 暂停开发触发器
- **触发词**: 用户说「暂停开发」「停止开发」「先不做了」「休息一下」或关闭 OpenClaw
- **必须执行**: ① git status 确认干净 ② git push origin master ③ WAL checkpoint ④ 确认最新 tag 已推送 ⑤ 输出安全关闭清单
- **设置时间**: 2026-07-02 15:17 GMT+8

## 项目标识
- 项目：提示词检索工具 (PromptKit) / 咪卡Mik词库
- 版本：v5.12.0-phase30-master3-initboard (2026-07-13)
- 工作目录：C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev
- 启动方式：`python backend/main.py` 或 `.\QUICK_START.bat`
- 默认端口：8080（自增 8080→8089）
- 局域网地址：http://192.168.0.101:8080
- 当前tag: `v5.14.0-phase32-p4-audio` (P4 后期音频资产接入 BGM/SFX)

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

## 2026-07-16 Phase35.3b 检索增强开发总结

### 开发时间
05:02-05:10 GMT+8

### 新增文件
| 文件 | 用途 |
|------|------|
| backend/ai_tagger.py | AI 自动标签引擎：Ollama vision 模型分析图片/视频首帧 → 中文标签 + 视频 ffprobe 元数据 + 文件类型标签 + 后台异步队列 |
| backend/sim_search.py | 感知哈希相似搜索（pHash + 汉明距离）+ 智能合集（保存搜索条件） |
| backend/api/dam_search.py | 检索增强 API：统一搜索 + 标签管理 + 相似搜索 + 智能合集 + 系统建议 |

### 能力
- AI 自动标签: Ollama llava:7b vision → 5-8 中文关键词
- 感知哈希: imagehash pHash → 去重 + 相似搜索
- 智能合集: 保存搜索条件，每次实时计算
- 统一搜索: 跨项目/设备/文件类型，一个搜索框搜所有

### 验证
- health 200, tags/suggestions/collections OK
- search/unified 403 (需要登录，符合预期)
- pip install imagehash done

## 2026-07-16 Phase35.3c 版本+备份开发总结

### 开发时间
09:55-10:02 GMT+8

### 新增文件
| 文件 | 用途 |
|------|------|
| backend/version_engine.py | 版本增量存储：v1全量LZMA + v2+块级差异 + 链深5自动全量快照 + 差异还原 |
| backend/tier_engine.py | 冷热分层(hot/warm/cold 3层自动流转) + 代理生命周期(90天TTL) + 三层自检(L1每日/L2每周/L3DB) + 外置备份 |
| backend/api/dam_vault.py | 版本+分层+自检+备份 API (20+端点) |

### 修改
| 文件 | 改动 |
|------|------|
| backend/main.py | 注册 dam_vault_router |

### 能力
- 版本增量: v1全量90MB → v2差异约8-15MB → 链深5自动全量快照
- 冷热分层: 30天hot→180天warm→cold, 按访问时间自动流转
- 代理清理: 90天未访问代理自动清理, 可手动重生成
- 三层自检: L1实体存在性 + L2抽样解压验证 + L3数据库完整性
- 外置备份: 全部blob实体+数据库dump, 历史备份列表, 支持恢复
- 后台维护: 每6小时自动分层+清理, 守护线程

### 验证
- 6/6 API端点通过
- Python编译全部通过

## 2026-07-16 下午 — T3 DB 访问统一完成（14:30-15:05）

### 改动
- sset_library._db() / udit._conn() 从自开 sqlite3.connect 改为调用 database.get_db()
- 用 _NC proxy 包装器使 c.close() 变为无操作（sqlite3.Connection.close 是 C 级只读属性，不能赋值 lambda）
- 保留所有业务代码逻辑不变，0 行业务改动

### 验证
- audit 18/18, asset_library 20/20, asset_review 21/21 全部通过
- 启动零错误，compileall 全绿

### 当前总回归
88/88（audit 18 + presence 11 + composer 18 + asset_library 20 + asset_review 21）+ DAM 17/17

### 剩余技术债
- T5 前端巨石拆分 + pk_common.js + 三 bridge
- _old_prompt_word_card(297)/_old_prompt_library(30) 退役（需迁移确认后删除）
- 逐步开启 _ENFORCE_AUTH（配合统一鉴权依赖）

## 2026-07-16 系统梳理 + 架构评审 + P0/P1 技术债逐项落地

### 时间
12:00–13:20 GMT+8

### 交付文档（工作区根目录）
- `SYSTEM_OVERVIEW_2026-07-16.md` — 9 大功能域全景 + 8 条端到端交互链
- `ARCH_REVIEW_2026-07-16.md` — 七维度架构评审（已邮件发送至 2547159966@qq.com，QQ SMTP 465 SSL）
- `TABLE_CENSUS_2026-07-16.md` — 110 表普查（只读，未动表）

### 已落地修复（全部验证通过）
1. **版本号统一**：`VERSION` 文件设为单一来源（`v5.18.0-phase36`）→ `main.py._read_app_version()` 读取 → FastAPI version + 封面页 v5.18 同步；`/api/status` 实测返回新版本。
2. **backend 目录瘦身**：`_test_*.py`→`backend/tests/`(+README)、`*.log`→`backend/logs/`、调试脚本→`backend/_scratch/`；`.gitignore` 补 `backend/_scratch/`+`backend/logs/`。这些文件均非运行时 import，`migrate_*`/`seed_*` 保留原位（运行时依赖）。
3. **T1 JWT 密钥持久化**（P0）：`jwt_auth.py` 改为「环境变量 > `data/.jwt_secret` 持久文件 > 首次生成落盘(0o600)」。**重启不再重置密钥/不再登出**（实测 3 次重启 SAME_SECRET=True、无「已生成」日志）。`.gitignore` 加 `data/.jwt_secret`。副作用：修复后 audit 回归从 7/18 恢复到 18/18（测试与服务现共享持久密钥）。
4. **T6 日志保留期清理**：`breadcrumb_logger.clear_breadcrumbs_before()` 新增 + `main.py` 启动接入（config 驱动，默认 runtime_log 30 天 / breadcrumb 14 天，0=不清理）。实测启动清理 breadcrumb 1327 条。
5. **T8 依赖修正**：`requirements.txt` 修 `numpy<2`→`numpy>=2,<3`（与已装 2.4.6/torch2.12 冲突），锁 `sentence-transformers==5.5.1`、`torch>=2.2`。
6. **T10 start.bat**：改为从 `VERSION` 文件动态读取版本号显示（原硬编码 v3.0），用 write 重写（edit 工具本会话转义异常）。

### T4 DAM 归档层端到端验证（P1，关键）
- 新增 `backend/tests/_test_dam_archive.py`（引擎级，17 项）。验证前 `data/backups/t4_dam_pre_*.db` 快照。
- **结论：归档层功能完好可用**（此前 `blob_store=0` 仅因从未用真实数据跑过）。覆盖：LZMA 压缩(99.7%)、内容寻址去重(2 次归档→1 blob/ref_count=2)、字节级还原(sha256 一致)、WebP 无损 PNG 归档+还原、实体落盘、引用计数清理归零。测试自清理，blob_store 复位为 0。

### 110 表普查结论
- **真正退役候选仅 2 张**：`_old_prompt_word_card`(297)、`_old_prompt_library`(30) — 遗留备份表。
- **32 张空表但代码在用**（功能已建未产数据）：集中在项目管理（projects/project_task_scene/squad*/workspace*）+ 资产子功能（asset_ratings/asset_tags/asset_versions[单数 asset_version 才是在用表]/asset_prompt_ref 等）。
- **无「空表且无引用」纯死表** → 110 表不算臃肿，主要是「功能超前于使用」。

### 回归
88/88 全绿（audit 18 + presence 11 + composer 18 + asset_library 20 + asset_review 21）+ DAM 17/17。

### 剩余技术债（未做，见 ARCH_REVIEW T2/T3/T5/T7/T9）
- T2 卡片三代表收敛（prompts/prompt_cards→word_card，移除启动期 _migrate_v4）
- T3 DB 访问统一（asset_library/audit 自开 sqlite → 收敛 database.py）
- T5 前端巨石拆分 + pk_common.js 公共底座 + 消灭 3 个 bridge
- T7 退役 `_old_*` 2 表（需迁移确认）
- T9 CORS 收紧 + 本地文件写接口(/api/utils/save-blob)沙箱
- 逐步开启 `_ENFORCE_AUTH`（配合统一鉴权依赖 Depends(require_role)）


## 2026-07-16 下午 — ENFORCE_AUTH 开启 + require_role 统一鉴权守卫（15:20-15:40）

### 改动
- jwt_auth.py：新增 `require_role(*roles)` 和 `require_auth()` FastAPI 依赖注入；PUBLIC_PATHS 扩为全部 `/api/` 开放（敏感接口由守卫二次检查）
- api/users.py：`_require_admin` 从内联函数改为 `require_role("admin")` 依赖
- audit.py：同上
- start.bat：加 `set PK_ENFORCE_AUTH=1` 启动时开启强制验证

### 验证
- 无 token 访问 /api/audit/feed -> 401
- 有效 token 访问 -> 200
- audit 18/18, asset_library 20/20 全部通过
- 匿名用户访问公开 API（/api/status、/api/v4/word-cards/groups、/api/auth/login）不受影响

### 效果
- 所有 API 公开可访问（匿名用户兼容），但 admin-only 接口有守卫：未登录/非管理员账户不可访问审计日志、用户管理
- 全局中间件：`PK_ENFORCE_AUTH=1` 时，携带无效/过期 token 的请求被拒绝（之前静默降级为匿名管理员）
- require_role 可供后续逐步收紧到更多敏感接口

### 当前回归基线
audit 18 + presence 11 + composer 18 + asset_library 20 + asset_review 21 + DAM 17 = 105/105

## Promoted From Short-Term Memory (2026-07-17)

<!-- openclaw-memory-promotion:memory:memory/2026-07-10.md:15:18 -->
- | 3 | 团队版 | 订阅 ¥99/月 ¥999/年（+团队协作 ≤5席） | | 4 | License | 个人版=离线RSA+机器指纹 / 团队版=在线+14天宽限期 | | 5 | 多用户 | 纯本地局域网 + 预埋远程Tailscale/Relay | | 6 | 旧数据 | user_id=NULL → 全局共享 | [score=0.889 recalls=0 avg=0.620 source=memory/2026-07-10.md:15-18]
<!-- openclaw-memory-promotion:memory:memory/2026-07-10.md:19:21 -->
- | 7 | 试用期 | 14天全功能 | | 8 | 全包价 | ¥399/年 | | 9 | 能力边界 | 仅提示词管理+辅助预览，不生成最终图片/视频 | [score=0.889 recalls=0 avg=0.620 source=memory/2026-07-10.md:19-21]
<!-- openclaw-memory-promotion:memory:memory/2026-07-10.md:28:28 -->
- **文件**: `backend/plugin_manager.py` (720行) [score=0.889 recalls=0 avg=0.620 source=memory/2026-07-10.md:28-28]
<!-- openclaw-memory-promotion:memory:memory/2026-07-10.md:36:36 -->
- **文件**: `backend/db_migrate_phase18.py` (420行) [score=0.889 recalls=0 avg=0.620 source=memory/2026-07-10.md:36-36]
