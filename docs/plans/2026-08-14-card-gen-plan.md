# 词卡 AI 生成能力接入（高清/图生图/文生图/视频生成 + 生成历史）开发规划 v2

> 版本：v5.37.0 规划（v2，按二喵 2026-08-14 09:48 反馈修订）| 日期：2026-08-14
> 修订要点：①首尾帧视频移出词卡（后续单独开发）②生成结果自动归档到词卡生成历史，**不新建词卡** ③多视频记录存词卡生成历史，用户可选当前缩略预览 ④后续加图片/视频预览自由切换 ⑤批量入口与批量缩略图并列，支持文生图/图生图/视频 ⑥顶部+批量工具栏双入口

---

## 一、需求拆解（v2）

| # | 需求 | 拆解 |
|---|------|------|
| 1 | 图片生成/高清接入词卡 | 🔍 高清（image_upscale）+ 🎨 图生图（image2image）+ 🖼 文生图（text2image） |
| 2 | 首尾帧视频**不在词卡**实现 | frames2video 从本批范围移除，后续单独开发 |
| 3 | 视频生成能力 | 🎬 视频（text2video 文生视频 / image2video 图生视频）入词卡生成 |
| 4 | 生成结果**自动填入当前词卡生成记录** | 生成产物自动归档到该词卡的生成历史；**不新建词卡** |
| 5 | 同卡多视频 → 生成视频历史记录 | 词卡生成历史列表，含多次生成的图片/视频产物 |
| 6 | 用户选择当前显示在缩略预览框的产物 | 历史记录可「设为当前」，更新词卡缩略预览框显示 |
| 7 | 后续：图片预览与视频预览自由切换 | 卡片渲染层已支持（thumbnail+preview_media），本轮即实现切换 |
| 8 | 批量入口与批量缩略图并列 | 批量工具栏加「🚀 批量生成」：文生图/图生图/**视频** 三模式 |
| 9 | 顶部工具栏 + 批量工具栏双入口 | aiToolbar 加「🚀 生成」；编辑模式批量工具栏加「🚀 批量生成」 |
| 10 | 仅团队模式显示 | 前端 mode==='team' 渲染 + 后端 403 兜底 |

**目标**：词卡一键 AI 加工（图/视频），产物全部沉淀为该词卡的生成历史，随时切换展示；批量一条龙；团队模式专属能力。

---

## 二、现状关键结论（已核实）

### 2.1 CLI 能力与参数（bin/dreamina.exe）

| 命令 | 参数要点 | 本批 |
|------|---------|------|
| image_upscale | 单图 + res 2k/4k/8k（**严格校验必填**） | ✅ |
| image2image | 1-10 图 + prompt；model 3.0~5.0Pro；ratio 9 种；res 1k/2k/4k | ✅ |
| text2image | 同上参数 | ✅ |
| text2video | seedance model；ratio；duration；video_resolution；session | ✅ |
| image2video | 单图 + seedance 参数 | ✅ |
| frames2video | first+last + seedance | ❌ 移出本批 |

### 2.2 词卡产物展示链路（本轮核心依赖，已验证）

- 卡片渲染 `renderCollectionItems`：`thumbnail`（图片/poster）+ `preview_media`（视频文件）→ **图片/视频自动切换渲染已原生支持**（thumb-video-wrap-preview + hover 播放）
- 字段语义：`thumbnail`=图片或视频 poster 文件名；`preview_media`=视频文件名；`media_type`='image'/'video'
- 原图 URL：`/api/thumbnails/original/{fn}` 多目录探测；`/api/thumbnails/video/{fn}` 视频流
- 视频产物需要 poster：ffmpeg 首帧提取（复用 v5.36.32 视频模版封面链路）
- **「设为当前」= 更新 word_card.thumbnail/original_ref/preview_media/media_type 四字段**，全站渲染自动生效（零渲染改造）

### 2.3 队列架构（三套已验证模式，直接复用）

- DB 持久化 + 状态机（queued→submitting→querying→success/fail）+ progress 时间估算
- 全局锁串行（防 ExceedConcurrencyLimit）+ 孤儿接管（import 时幂等 resume）
- CLI not found 快速失败（v5.36.46）+ 大图压缩（v5.36.7 ≤1024px/JPEG q80）
- 队列总览悬浮条已存在：`bgenQueueBar`（右下角，3s 轮询，展开面板）——新队列复用同款

### 2.4 入口挂载点（已核实）

| 入口 | 位置 | 现状 |
|------|------|------|
| 顶部工具栏 | `aiToolbar`（pageHeaderRight，ai_tools.js renderToolbar） | 有 优化/翻译/标注/中英/标签/适配/缩图 → 加「🚀 生成」 |
| 批量工具栏 | 编辑模式 batchBar + aiToolbar 编辑模式按钮区 | 加「🚀 批量生成」与现有「🎨 缩图」并列 |
| 词卡卡片 | `renderCollectionItems` card-add-row / card-actions（收藏夹+主网格同构） | 注入生成按钮（仅团队模式） |
| 词卡详情 | `showCardDetail`（v4_cards.js，media 区已有图片/视频渲染） | 新增「🎬 生成历史」区 |

### 2.5 团队模式

- 前端：`wc_bridge_mode.js` mode==='team'（团队版激活锁定）
- 后端：无团队状态接口 → 新增 `GET /api/team/status` + card-gen API 403 兜底

---

## 三、生成流程分析

### 3.1 单卡生成时序（以图生图为例）

```
词卡卡片 [🎨 图生图]（仅团队模式显示）
 → 弹窗：预填原图缩略 + prompt(=content 可编辑) + 模型/比例/分辨率 + 预计消耗提示
 → POST /api/card-gen/tasks {card_id, task_type:'image2image', params}
 → 后端：校验词卡/原图存在 + 解析原图本地路径 + 建任务(queued, 绑定 card_id) + 起 worker
 → worker（全局锁串行）：
      submitting: 压缩原图 → dreamina image2image --poll 0 → submit_id
      querying: 轮询 query_result（8s 间隔/15min 超时/进度估算封顶 90）
      success: 下载结果图 → 保存（图片目录 + 缩略图）→ **自动设为该词卡当前预览**
      fail: 错误分类落库（concurrency/param/compliance/upload/timeout/login/gen_failed）
 → 前端 8s 轮询 → 任务面板状态更新 → 终态 toast + 卡片缩略预览自动刷新
```

### 3.2 生成产物归档（核心设计）

**产物归属**：`card_gen_tasks` 记录 = 词卡生成历史条目（不新建词卡）。

| 产物类型 | 文件落位 | 词卡字段更新（自动设为当前） |
|---------|---------|------------------------------|
| 图片（高清/图生图/文生图） | 原图 `data/originals/{uuid}.jpg` + 缩略图 `data/thumbnails/{uuid}.jpg` | thumbnail=缩略图, original_ref=原图, preview_media='', media_type='image' |
| 视频（文生视频/图生视频） | 视频 `data/card_gen/videos/{uuid}.mp4` + poster `data/card_gen/posters/{uuid}.jpg` | thumbnail=poster, preview_media=视频, original_ref='', media_type='video' |

- 每条生成记录：task 状态 + 产物文件 + 参数 + 时间 + 是否当前（`is_current` 标志用于历史列表高亮）
- **切换当前**：`POST /api/card-gen/tasks/{id}/activate` → 更新词卡四字段（与 3.2 表一致）→ 全站预览自动切换
- 同一词卡多次生成 → 历史列表多条，最新一条自动设为当前；用户可随时切回旧产物

### 3.3 批量生成时序

```
编辑模式勾选 N 张 → 批量工具栏 [🚀 批量生成]
 → 弹窗：模式 = 文生图 / 图生图 / 视频 + 全局参数（模型/比例/分辨率；视频加时长/清晰度）
 → 预检（可选）：无内容/无原图/超长风险分类（复用 batch_precheck 模式）
 → POST /api/card-gen/batch {card_ids, task_type, params}
 → 后端：逐卡建任务（同组批量）→ worker 队列串行
 → 前端：批量任务面板（聚合：完成/总数 + 每卡状态）+ 右下角队列悬浮条
```

---

## 四、交互流程设计

### 4.1 词卡卡片（仅团队模式）

**有原图**（card-add-row 悬停区）：
```
[🔍 查看原图] [⬇ 下载] [🔍 高清] [🎨 图生图] [🎬 视频] [🖼 文生图]
                         ↑新增      ↑新增      ↑新增    ↑新增
```
**无原图**：仅 `[🖼 文生图] [🎬 视频]`

**有生成历史**（缩略预览框右下角）：
```
历史切换器：🖼×3 🎬×2 （当前产物高亮，点击切换）
```
- 视频产物：预览框直接渲染 video（hover 播放）+ poster
- 图片产物：渲染 img

### 4.2 单卡参数弹窗（4 类）

| 操作 | 字段 | 默认 |
|------|------|------|
| 🔍 高清 | 分辨率 2k/4k/8k | 4k |
| 🎨 图生图 | 模型/比例/分辨率 + 提示词(=content 可编辑) | 5.0 / 1:1 / 2k |
| 🖼 文生图 | 模型/比例/分辨率 + 提示词 | 5.0 / 1:1 / 2k |
| 🎬 视频 | 模型(seedance)/时长/视频分辨率 + 提示词 + 模式(文生视频/图生视频) | seedance2.0_vip / 5s / 720p |

校验：高清 res 严格；视频模型→时长/分辨率映射（复用 v5.36.1 RESOLUTION_MAP + seedance2.5 480p/720p 规则）；提交前显示积分消耗提示。

### 4.3 批量弹窗（与批量缩略图并列）

```
模式切换：[🖼 文生图] [🎨 图生图] [🎬 视频]（默认文生图）
参数区：随模式切换（同上单卡参数）
本次处理词卡清单（复用 bgenPreview 列表样式，含风险预检标记）
[🚀 提交批量生成] → 逐卡入队
```

### 4.4 任务面板（双入口）

- **顶部工具栏「🚀 生成」**：打开生成任务面板（列表+聚合进度+预览/下载/设为当前/重试）
- **右下角队列悬浮条**（复用 bgenQueueBar 模式）：显示 card_gen 队列运行/排队/失败概要，点击展开
- 任务行操作：✅ → 预览图/视频 + [设为当前] [⬇下载]；❌ → [🔄重试]（30s 防抖）

### 4.5 词卡详情弹窗

新增「🎬 生成历史」区（showCardDetail）：
- 记录列表（时间倒序）：产物缩略（图/视频）+ 操作类型徽章 + 状态 + [设为当前] [删除]
- 当前显示产物高亮 + 「当前展示中」标签

---

## 五、技术架构设计

### 5.1 新表 `card_gen_tasks`（幂等迁移，含产物字段）

```sql
CREATE TABLE IF NOT EXISTS card_gen_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,                 -- word_card.id（生成历史归属）
  task_type TEXT NOT NULL,                  -- upscale/image2image/text2image/text2video/image2video
  engine TEXT DEFAULT 'dreamina',
  source_image TEXT DEFAULT '',             -- 原图文件名（图生图/图生视频）
  prompt TEXT DEFAULT '',
  model_version TEXT DEFAULT '',
  ratio TEXT DEFAULT '1:1',
  resolution_type TEXT DEFAULT '',          -- 图片: 1k/2k/4k；高清: 2k/4k/8k
  duration INTEGER DEFAULT 5,               -- 视频秒数
  video_resolution TEXT DEFAULT '',         -- 视频: 480p/720p/1080p/4k
  session INTEGER DEFAULT 0,
  submit_id TEXT DEFAULT '',
  status TEXT DEFAULT 'queued',             -- queued/submitting/querying/success/fail
  progress INTEGER DEFAULT 0,
  media_type TEXT DEFAULT '',               -- 产物: image/video（成功后回填）
  result_filename TEXT DEFAULT '',          -- 产物文件名（缩略图 或 视频文件）
  result_original TEXT DEFAULT '',          -- 原图文件名（图片产物）
  poster_filename TEXT DEFAULT '',          -- 视频 poster
  is_current INTEGER DEFAULT 0,             -- 是否当前显示产物
  fail_category TEXT DEFAULT '',
  error TEXT DEFAULT '',
  creator_id INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  finished_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
```

### 5.2 后端新模块 `backend/api/card_gen.py`

| 组件 | 说明 |
|------|------|
| `_ensure_card_gen_table()` | 幂等建表 |
| `_resolve_card_original_path(card_id)` | 原图本地路径（多目录探测 originals/ wc_media/originals/ comfyui_outputs/ dreamina_assets/ thumbnails/） |
| `_submit_task(task)` | 按 task_type 分发 CLI 提交（upscale/image2image/text2image/text2video/image2video，均 `--poll 0`） |
| `_card_gen_worker(task_id)` | 全局锁串行：提交→轮询(8s/15min)→下载→归档→**自动设为当前**；错误分类复用 |
| `_archive_image_result(task, img_bytes)` | 图片：原图 originals/ + 缩略图 thumbnails/（复用 save_generated_image 或独立实现）→ 更新任务 + 词卡字段 |
| `_archive_video_result(task, video_bytes)` | 视频：存 data/card_gen/videos/ + ffmpeg poster → 更新任务 + 词卡字段 |
| `_activate_task(task_id)` | 设为当前：更新 word_card 四字段 + 任务 is_current（先清同卡其他记录 is_current） |
| `_resume_orphaned_card_gen_tasks()` | 启动接管 |
| API | `POST /api/card-gen/tasks`（单卡）/ `POST /api/card-gen/batch`（批量）/ `GET /api/card-gen/tasks?card_id=&status=`（列表，含词卡名）/ `GET /api/card-gen/tasks/{id}` / `POST .../activate` / `POST .../retry` / `DELETE .../{id}`（删除记录+文件）/ `GET /api/card-gen/capabilities`（参数约束） |
| `GET /api/team/status` | 团队模式状态（card-gen 接口未激活返回 403 兜底） |

**复用/新增**：
- `api/dreamina.py` 新增 `dreamina_submit_upscale` / `dreamina_submit_image2image` / `dreamina_submit_text2video`（poll=0）；`dreamina_submit_text2image` 已有（v5.36.46）
- `_poll_dreamina_image`（project_roles v5.36.46）→ 提取公共或复制；视频轮询复用 seedance_v2_video `_query_and_download` 模式
- 视频参数校验复用 seedance_v2_video `_validate_duration` / `_valid_resolution` / `_classify_error`
- ffmpeg poster 复用 v5.36.32 封面提取逻辑

### 5.3 前端新模块 `frontend/static/js/card_gen_ui.js`

| 组件 | 说明 |
|------|------|
| `_teamActive()` | 团队模式判定（mode==='team' && tiers.team） |
| `initCardGenButtons()` | 卡片渲染后注入生成按钮 + 历史切换器（hook renderCollectionItems，仅团队模式） |
| `openCardGenDialog(cardId, taskType)` | 单卡参数弹窗（4 类） |
| `submitCardGen(cardId, taskType, params)` | 提交单卡 |
| `openBatchGenDialog()` | 批量弹窗（三模式切换，与批量缩略图并列入口） |
| `submitBatchGen(ids, taskType, params)` | 批量提交 |
| `openCardGenPanel()` | 任务面板（列表/聚合/8s 轮询/预览/下载/设为当前/重试） |
| `openCardGenHistory(cardId)` | 详情弹窗生成历史区 |
| `switchCardPreview(taskId)` | 历史切换器点击 → activate API → 刷新卡片 |
| 队列悬浮条 | 复用 bgenQueueBar 模式（或扩展同款新条，显示 card_gen 任务概要） |

**入口挂载**：
- 顶部 `aiToolbar` 加「🚀 生成」按钮（所有模式可见，团队模式才可用，非团队点击提示升级）
- 编辑模式批量工具栏（与「🎨 缩图」并列）加「🚀 批量生成」
- index.html 版本号 +5360x

### 5.4 团队模式控制

- 前端：`_teamActive()` false → 不渲染按钮/入口；面板打开时二次校验
- 后端：`GET /api/team/status`（读激活状态）；card-gen 全部接口 403 兜底（防绕过 UI 直接调 API）

---

## 六、开发任务拆分（版本规划）

### v5.37.0 — 单卡生成 + 生成历史（核心闭环）
- [ ] P0 后端：card_gen_tasks 表 + worker 框架（提交/轮询/下载/归档/孤儿接管/快速失败）
- [ ] P0 后端：`_resolve_card_original_path` + 5 个 submit 函数（upscale/image2image/text2image/text2video/image2video，poll=0）
- [ ] P0 后端：图片/视频产物归档 + **自动设为当前**（词卡四字段更新）+ activate API
- [ ] P0 后端：GET /api/team/status + 403 兜底
- [ ] P0 前端：词卡生成按钮注入（仅团队模式）+ 4 类参数弹窗
- [ ] P0 前端：任务面板（列表/轮询/下载/重试/设为当前）+ 右下角队列悬浮条
- [ ] P0 前端：详情弹窗「🎬 生成历史」区 + 历史切换器（卡片缩略预览框）
- [ ] P1 测试：worker 状态机（fake submit_id）、安全分支、归档/激活字段验证、孤儿接管、UI 冒烟

### v5.37.1 — 批量生成（与批量缩略图并列）
- [ ] P0 后端：batch 建任务接口（逐卡入队）+ 批量预检（无内容/无原图风险分类）
- [ ] P0 前端：批量工具栏「🚀 批量生成」+ 三模式弹窗（文生图/图生图/视频）+ 批量面板聚合进度
- [ ] P1 测试：批量串行验证、非法参数路径

### v5.37.2 — 打磨与增强
- [ ] P1 历史管理：删除记录（含文件清理）、清空记录、历史分页
- [ ] P1 预览切换增强：图片/视频自由切换交互完善（切换器动效、当前高亮持久化）
- [ ] P2 余额展示（user_credit）+ 生成前余额不足拦截
- [ ] P2 同卡并发保护：同一词卡有 running 任务时提示（防重复提交）
- [ ] P2 多引擎扩展（ComfyUI/LibTV 入统一队列，调研后定）

### 交付物
- 代码 + 测试脚本（backend/tests/_smoke_card_gen.py 等）+ VERSION 同步 + git tag + 推送
- 开发汇报存档（memory/2026-08-14-dev-report.md）

---

## 七、风险与边界

| 风险 | 对策 |
|------|------|
| 真实生成消耗即梦额度 | 弹窗积分消耗提示；测试走 fake submit_id 安全路径；真实生成需用户确认 |
| 即梦并发限制 ExceedConcurrencyLimit | worker 全局锁串行 + 错误分类 + 重试 |
| CLI 大图上传超时（v5.36.7） | 提交前 `_compress_ref_image` 压缩（≤1024px/JPEG q80） |
| upscale 严格 res 校验 / 视频模型时长映射 | 前端能力清单过滤 + 后端二次校验（400 不静默降级） |
| 无效 submit_id 卡轮询（v5.36.46） | CLI not found 快速失败 |
| 服务重启任务丢失 | 孤儿接管 |
| **生成结果覆盖用户手动上传的原图** | 「设为当前」仅更新词卡展示字段，**原图文件不删**；历史记录保留全部产物可切回；手动上传的 original_ref 文件仍在磁盘（切换仅改指针） |
| 视频产物 poster 提取失败 | ffmpeg 失败时用占位图，任务仍成功 |
| 团队模式绕过 | 前端隐藏 + 后端 403 双保险 |
| 词卡删除时残留生成文件 | 删除词卡时联动清理 card_gen 记录 + 文件（对齐 delete_role 模式） |

---

## 八、待确认问题（v2）

1. **「设为当前」语义**：生成完成自动设为当前（最新产物顶替预览）——确认？还是仅入历史不自动切换？（默认自动切换，符合「自动填入当前词卡生成记录」）
2. **历史记录保留上限**：每卡生成记录无上限 / 保留最近 N 条（建议默认无上限，用户可手动删）？
3. **视频产物目录**：`data/card_gen/videos/`（新目录）——确认？（不动 wc_media/videos 模版目录，避免混用）
4. **批量视频时长**：批量视频默认 5s（额度最小档），弹窗可调 4-15s——确认？
5. **切换器 UI**：卡片缩略预览框右下角叠加小图标（🖼/🎬 + 序号）——是否接受？

> 确认后按 v5.37.0 → v5.37.1 → v5.37.2 开发。
