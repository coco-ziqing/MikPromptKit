# 灵感站点导航 + 浏览器多标签抓取 + URL收藏库 — 存量整合分析报告

> 日期：2026-08-19 ｜ 需求源：`docs/requirements/2026-08-19-inspire-nav-urllib-collect-PRD.md`
> 方法：web-task-split 完整拆解（/task-split-full, PRO 路由）+ 存量代码实证核查（backend/api/card_collect.py）
> 结论：PRD 三大模块与存量 v5.42.x 词卡采集模块高度重叠，**增量扩展为主，仅浏览器扩展为全新建设**

---

## 一、PRD 模块 × 存量能力对照矩阵

| PRD 模块 | 存量对应（实证） | 判定 | 差距点 |
|---|---|---|---|
| 3.1 灵感站点导航页 | `card_collect_sites` 表 + `/sites` CRUD + logo 上传 + 10 条预置种子 + 前端图库入口（v5.42.2） | 🔁 **复用 + 扩展** | ① 无「分组」字段（PRD 要提示词站点/灵感图库/设计参考/素材榜单）② 无「预制不可删」标记 ③ 无「个人收藏站点」独立概念 ④ 备注字段已有 description，够用 |
| 3.2 浏览器扩展 | 无（存量 playwright 是应用内受控浏览器，非用户外部浏览器） | 🆕 **全新建设** | Chrome MV3 扩展：单页抓取 / 多标签批量抓取 / 回传通道；或轻量替代（书签脚本/油猴） |
| 3.3 后台信息抓取 | `_collect_worker` 已具 playwright 提取（title/prompt/model/media/OCR 兜底），但**采集时才抓、且下载媒体** | 🔁 **复用逻辑 + 新增轻量端点** | 需新增「收藏即抓」：只抓 title/meta-desc/正文核心文本/首图/域名/来源站点，不下载素材；失败保留 URL 标记状态 |
| 3.4 URL收藏库 | `card_collect_favorites`（url/title/note/status/created_at/collected_at）+ `/favorites` CRUD + 单条发起采集 | 🔁 **复用 + 扩展** | ① status 仅 pending，需扩四池（待处理/待采集/备用/废弃）② 无批量删除/批量状态变更 ③ 无 URL 清洗（去重/清参/短链还原/失效过滤）④ 无异步抓取状态列 ⑤ 无「勾选批量生成采集任务」 |
| 下游：采集任务输出 | `card_collect_tasks`/`items` + `/collect` + `/archive` 归档建词卡 + `/trace` 溯源 + 同图去重（v5.42.12） | 🔁 **直接复用** | 仅需新增「收藏库批量入队」端点（参照 v5.38.54 batch-to-card 单事务模式） |

**核心判断**：PRD 本质是给存量「收藏 → 采集 → 归档」链路加一个 **前置 URL 归集层（浏览器端）** 和 **收藏库工作台升级（四池+批量+清洗）**。站点导航 80% 已存在，采集/归档 100% 已存在。

---

## 二、按 PRD 模块的整合方案

### 模块 A：灵感站点导航页（升级存量，非新建）

**存量直接可用**：sites CRUD、logo 上传/服务、icon_emoji、sort_order、login_required 标注、外部浏览器跳转。

**增量开发（幂等 ALTER，沿用 login_required 先例）**：
1. `card_collect_sites` 加列：`group_name TEXT DEFAULT '灵感图库'`、`is_builtin INTEGER DEFAULT 0`
2. 预置种子加分组标签：提示词站点（LibLib/即梦/MJ/秒画）、灵感图库（小红书/Pinterest/ArtStation）、素材榜单（Civitai/可灵/海螺/B站）
3. 后端：sites 列表支持 group 过滤；`is_builtin=1` 的站点删除接口返回 400（预制不可删）
4. 前端：导航页按分组分区展示 + 「个人收藏站点」区（is_builtin=0）+ PRD 提示文案（引导装扩展）

### 模块 B：后台信息抓取（新增轻量端点，复用 worker 提取逻辑）

**新增**：
- `POST /api/card-collect/fetch-meta {url}` → 异步任务，抓取 title / meta-description / 正文核心文本（优先提示词特征段）/ 首图缩略图 / 域名 / 来源站点名
- `GET /api/card-collect/urls/{id}` 返回抓取状态（success / fail / pending）
- 提取函数直接复用：`_extract_prompt_from_dom`、`_extract_media_from_dom`、`_extract_model_from_json`、`_suggest_group`
- 抓取用轻量模式：**不下载媒体**，首图仅存缩略图（Pillow，参照现有 serve_thumbnail）

**关键坑（沿用存量教训）**：
- 下载/抓取必须带预算：单请求 timeout 30s + 任务总预算 240s（memory/2026-08-18 教训：无预算会卡死服务 HTTP）
- 抓取失败：保留原始 URL，status=fail，不自动删除（PRD 6.1）
- 仅 http/https，非公开页面标记「抓取异常」人工复核（PRD 6.2）

### 模块 C：URL 收藏库升级（核心工作台）

**表扩展（`card_collect_favorites` 幂等 ALTER）**：
- `status` 枚举扩展：`pending`(待处理) / `ready`(待采集) / `hold`(备用) / `discard`(废弃)
- 加列：`fetch_status`(pending/success/fail)、`fetch_title`、`fetch_desc`、`fetch_text`、`thumb`、`domain`、`site_name`、`clean_url`（清洗后链接，**原始 url 列不动**，保留溯源）

**后端新增**：
1. `POST /api/card-collect/urls`：手动粘贴/扩展回传统一入库入口（原始 URL 原样存 + 触发异步 fetch-meta）
2. `POST /api/card-collect/urls/batch`：扩展多标签回传（预览确认后调用，列表携带 title/domain 预展示）
3. `POST /api/card-collect/urls/clean`：批量 URL 清洗（去重=域名+页面指纹、清追踪参数 utm_*/spm/from、短链还原=跟随 redirect 一次、过滤 fail/404）
4. `POST /api/card-collect/urls/status`：批量状态变更（ready/hold/discard）
5. `POST /api/card-collect/urls/delete`：批量删除（或 DELETE /urls 带 body ids）
6. `POST /api/card-collect/urls/collect`：勾选待采集 → 批量生成采集任务（复用 `_start_collect`，单事务，参照 batch-to-card）

**前端新增**：收藏库工作台页（四池 tabs + 勾选 + 批量工具栏 + URL 清洗入口 + 一键生成采集任务 + 缩略图/摘要/域名展示）

### 模块 D：浏览器扩展（全新，独立版本）

**技术路线（给二喵拍板，二选一）**：
- **路线① Chrome MV3 扩展**（PRD 原意）：`tabs` API 读当前/全部标签 URL → background fetch 回传 `http://127.0.0.1:8080/api/card-collect/urls[/batch]`；仅读 URL 不读 Cookie/表单（PRD 3.2.3）；局域网工具走开发者模式加载，不上架商店
  - 权限：`tabs`、`host_permissions: http://127.0.0.1:8080/*`；manifest 声明用途文案（合规）
  - 多标签批量：tabs.query({}) → 过滤 http/https → 回传后**应用内弹预览勾选确认**（PRD 5 ❌禁止自动入库）
- **路线② 书签脚本（javascript:）**：零安装、零权限，但只能取当前标签 URL，无多标签批量能力 → 不满足 PRD 3.2.2
- **建议**：P0-P2 先完成模块 A/B/C（应用内闭环，手动粘贴已可用）；**扩展作为独立版本 v5.44.0** 最后交付，避免阻塞核心链路

### 模块 E：合规 & 边界（沿用 v5.38.62 整改基调）

- 扩展仅读取标签 URL，不读隐私数据（manifest 权限最小化）
- 多标签回传必须用户勾选确认，禁止自动入库（与「人工确认制」一致）
- 批量采集仍受存量约束：滚动 ≤8 轮、单批 ≤20 条、单小时限额 6 条（光厂环节）
- 搜集阶段不做精细分组/打标（PRD 5），精细归档全部后置到采集归档环节

---

## 三、整合后 Todo 清单（按依赖排序）

| ID | 优先级 | 模块/层 | 开发项 | 依赖 | 验收要点 |
|---|---|---|---|---|---|
| I01 | P0 | 存储 | favorites 表扩展（四池状态+元数据列+clean_url）幂等 ALTER | — | 存量数据 status=pending 自动归待处理池 |
| I02 | P0 | 后端 | POST /urls 统一入库 + 触发异步 fetch-meta | I01 | 原始 URL 原样保留；失败标记不删 |
| I03 | P0 | 后端 | 批量状态变更 + 批量删除 | I01 | 单事务；discard 可复盘不硬删 |
| I04 | P0 | 前端 | 收藏库工作台（四池 tabs+勾选+批量工具栏+摘要/缩略图/域名） | I01-I03 | PC/手机渲染，深色适配 |
| I05 | P0 | 后端 | POST /urls/collect 勾选批量生成采集任务 | I01 | 复用 _start_collect，任务入队，携带元信息 |
| I06 | P0 | 前端 | 一键生成采集任务入口 + 任务面板联动 | I05 | 完成后跳转采集任务列表 |
| I07 | P1 | 后端 | fetch-meta 轻量抓取（title/desc/正文/首图/域名）预算控制 | I02 | 30s/240s 预算；不下载素材 |
| I08 | P1 | 后端 | POST /urls/clean 批量清洗（去重/清参/短链还原/失效过滤） | I01 | 清洗结果写 clean_url，不动原始 url |
| I09 | P1 | 前端 | URL 清洗入口 + 清洗前后对照展示 | I08 | 预览可回滚（clean_url 可清空） |
| I10 | P1 | 存储 | sites 表加 group_name/is_builtin（幂等）+ 种子分组标签 | — | 预制不可删 400 |
| I11 | P1 | 后端 | sites group 过滤 + 预制删除拦截 | I10 | 删 is_builtin=1 返回 400 |
| I12 | P1 | 前端 | 导航页分组分区 + 个人收藏站点 + 提示文案 | I10-I11 | 分组展示正确 |
| I13 | P2 | 后端 | POST /urls/batch 多标签回传（预展示+确认后入库） | I02 | 空标签提示，不生成空数据 |
| I14 | P2 | 前端 | 手动粘贴入库 UI（URL 输入框+批量粘贴） | I02 | 兼容手机端 |
| I15 | P3 | 扩展 | Chrome MV3 扩展（单页抓取+多标签批量+回传） | I13 | 开发者模式加载；仅读 URL |
| I16 | P3 | 扩展 | 扩展安装引导页/说明（导航页提示文案落地） | I15 | 引导闭环 |

**版本规划**：
- **v5.43.0（MVP）**：I01-I06 — 收藏库工作台 + 批量采集任务打通（应用内闭环）
- **v5.43.1（完善）**：I07-I12 — 后台抓取 + URL 清洗 + 导航页分组升级
- **v5.43.2（收口）**：I13-I14 — 批量回传端点 + 手动粘贴 UI
- **v5.44.0（桥梁）**：I15-I16 — 浏览器扩展交付

---

## 四、边界约束 & 防过度开发

1. **不做**：扩展上架 Chrome Web Store（局域网工具，开发者模式加载即可）
2. **不做**：多用户/权限体系、云同步收藏库、短链还原的多级跳转（单次 redirect 即可）
3. **不做**：搜集阶段精细分组/打标/素材下载（PRD 5 明令禁止）
4. **保留**：原始 url 列永不修改，清洗结果只写 clean_url（溯源原则）
5. **复用优先**：提取函数/归档/溯源/同图去重全部走存量，不重写
6. **风险预警**：fetch-meta 若做成同步接口会卡 HTTP（存量教训），必须异步任务 + 轮询

---

## 五、决策记录（2026-08-19 二喵拍板 ✅）

1. **浏览器扩展路线**：✅ Chrome MV3 扩展按 PRD 照做，排期后置 v5.44.0
2. **四池状态映射**：✅ 待处理/待采集/备用/废弃 → pending/ready/hold/discard
3. **废弃池语义**：✅ 软删（status=discard，留存可复盘）
4. **导航页入口位置**：✅ 挂「词卡采集」页顶部 tab
