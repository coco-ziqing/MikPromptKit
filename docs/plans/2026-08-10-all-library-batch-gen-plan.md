# 全词库「批量优化 + 缩略图生成」一键流水线 — 方案设计

> 版本：v1（2026-08-10 方案稿，待二喵决策）
> 目标版本：v5.34.0
> 关联痛点：词卡分布松散多分组，批量优化/生成需逐分组勾选提交，效率低

---

## 1. 现状与根因

### 1.1 现有链路（v5.33.0）
```
编辑模式批量工具栏「AI 批量生成缩略图」
  → batchGenerateThumbnails()：取 state.batchSelected（当前分组勾选集，按分组独立持久化 _batchSelections）
  → 弹窗 batchGenDialog：
      · 「本次处理词卡」清单（前端数据渲染：缩略图/优化徽章/队列徽章）
      · Ollama 优化：串行队列逐条 /api/v2/comfyui/ollama/enhance → _batchPromptOverrides（localStorage）
      · 「全部存词卡」→ PUT /api/v4/word-cards/{id} 写 content_detailed（详细档）
      · 开始生成 → POST /api/v2/comfyui/batch-tasks
  → 后端 create_batch_task：按库过滤"已有缩略图"（word_card.thumbnail / prompt_thumbnails）→ 任务入队
  → _batch_worker：_BATCH_GLOBAL_LOCK 全局锁串行，逐张生成，进度/取消/重试/持久化
```

### 1.2 痛点根因（三处断裂）
| # | 断裂点 | 后果 |
|---|--------|------|
| 1 | 范围锁定「当前分组勾选集」 | 跨分组必须逐分组勾选+提交+等待，N 分组 × N 次操作 |
| 2 | 「已优化保存」无持久化跳过 | content_detailed 已写库的词卡，下次会话/其他分组仍会被再次优化（overrides 只在 localStorage 会话级） |
| 3 | 生成提示词未用 content_detailed | worker 取 `content`（标准档）+ overrides；「用优化后的详细提示词生成缩略图」语义不完整——存了详细档但生成仍用标准档 |

### 1.3 承载现状
- `_BATCH_GLOBAL_LOCK` 全局锁：**多任务排队串行**，同一时刻仅一个任务执行
- 单任务词卡数无上限：一次可提交几百张 → 在线引擎（即梦/LibTV）长队、积分/限流风险集中；ComfyUI 本地单任务过长恢复成本高

---

## 2. 完成态判定模型（核心决策 · 多维度综合判定）

### 2.1 问题：thumbnail 非空 ≠ AI 生成完成
词卡可能被**手动指定预览图**（上传 / 从图库复制 / 封面替换），不能仅凭 `thumbnail` 字段非空判定"已生成"，否则会漏生成。

### 2.2 来源指纹（真实数据验证 2026-08-10，290 张有图词卡）
| 指纹 | 检测方式 | AI 生成链路 | 手动指定链路 | 数据验证 |
|------|----------|------------|------------|---------|
| **D1 尺寸指纹** | `thumb_width/height` | 写入**原图真实尺寸**（2560×1440/2048²/1024²…） | 固定 **320×213**（代码写死） | 200 张非 0/非 320 尺寸 → 100% AI |
| **D2 目录指纹**（最强） | 文件存在位置 | `data/thumbnails/`（仅此一处） | `data/wc_media/thumbs/` + 同步副本到 thumbnails/ | 200 张 AI 图 0 张落 wc_media/thumbs/；唯一手动图两处都有 |
| D3 历史痕迹（可选） | `comfyui_batch_tasks.results` 成功记录 | 生成成功必然有记录 | 无 | 文件被删时兜底 |

> 89 张历史 0×0 无尺寸数据 → 目录指纹 100% 判定为 AI（全在 thumbnails/，0 张在 wc_media/thumbs/）。

### 2.3 判定规则（word_card，按优先级，防误判优先）
```
1. thumbnail 为空                                        → 未生成（纳入生成）
2. 文件存在于 data/wc_media/thumbs/                     → 手动指定（D2 最强，即使尺寸/目录兼有）
3. 文件仅存在于 data/thumbnails/                        → AI 生成（兼容 AI 尺寸 + 0×0 历史）
4. 文件都不存在（被清理）:
   - thumb_width>0 且非 320×213                          → AI 生成（尺寸记录兜底）
   - 320×213                                             → 手动指定（尺寸特判）
   - 0×0                                                  → 未知（保守：纳入生成，UI 标「来源未知」）
```

### 2.4 流水线动作（每卡状态）
| 状态 | content_detailed | 缩略图来源判定 | 动作 |
|------|:---:|------|------|
| **待处理** | 空 | 无图 | 优化 → 保存 → 生成 |
| **已优化未生成** | ✅ | 无图 | 仅生成（提示词用详细档） |
| **AI 已生成**（含优化/未优化） | 任意 | D1/D2/D3 确认 AI | 跳过（默认）；未优化者清单提示可勾选重生成 |
| **手动指定图** | 任意 | wc_media/thumbs/ 或 320×213 | **不跳过**，纳入生成（UI 提示"将覆盖手动预览图"，可勾选排除） |
| **完全完成** | ✅ | AI 生成确认 | 跳过 |
| **队列中** | — | — | 跳过（防重复入队） |

> 决策点 B 数据支撑：「已生成未优化」= AI 生成过但未存详细档 → 默认跳过生成（图已有，不浪费在线额度），清单提供「重生成」勾选。

---

## 3. 后端设计

### 3.1 新增 `POST /api/v2/comfyui/batch-scan`（探测统计，不建任务）
```
入参: { scope: "all" | "group" | "ids", group_id?: int, ids?: [], include_legacy?: bool }
出参: {
  ok: true, total: 1439,
  stats: { complete: 800, opt_only: 120, ai_generated: 60, manual: 19, unknown: 5, pending: 450, queued: 9 },
  items: [ { id, name, group_name, module, content_detailed, thumbnail, queued,
             thumb_state: "ai" | "manual" | "unknown" | "none" } ]
}
```
- `scope=all`：`SELECT ... FROM word_card WHERE is_deleted=0`（全词库）
- `scope=ids`：支持收藏夹混合两表（沿用 card_type_map 语义；prompts 旧表无尺寸/目录指纹，仅能按 prompt_thumbnails 存在性判定，标注 `thumb_state:"legacy"`）
- `thumb_state` 按 **§2.3 判定规则**（目录指纹 → 尺寸指纹 → 未知）计算
- `queued` 判定：内存扫描活跃任务（status IN queued/running）展开 prompt_ids 集合
- **过滤逻辑单一事实来源**：抽取 `_filter_pending_ids(ids, ctm)` 公共函数（内部用同一 thumb_state 判定），batch-scan 与 create_batch_task 复用（防两端判定漂移）

### 3.2 `POST /api/v2/comfyui/batch-tasks` 增加 `batch_size`
- 入参新增 `batch_size?: int`（0=不切片全量单任务；缺省按引擎默认：comfyui=50，dreamina/libtv=20）
- 过滤后的 pending_ids 按 batch_size 切片 → **单事务**创建 N 条任务记录 → 返回
  `{ ok, task_ids: [...], total, skipped, batches: N }`（兼容旧响应字段 task_id=task_ids[0]，旧前端无感）
- 多任务天然由 `_BATCH_GLOBAL_LOCK` 排队串行执行，无需改 worker 调度

### 3.3 `_batch_worker` 提示词优先级修正（补齐断裂点 3）
```
card_text = overrides[pid]  →  content_detailed（非空时）  →  content（标准档兜底）
```
- word_card 路径读取 content_detailed；prompts 旧表无此列保持原样

### 3.4 性能
- 1439 张扫描 = 1 条全表 SQL + 内存队列集合，毫秒级，无压力

---

## 4. 前端设计（app_collections_batch.js + index.html）

### 4.1 弹窗顶部「处理范围」选择器
```
[ 当前分组（N 张） | 全部词库（M 张） ]   ← segmented 控件
```
- 默认「当前分组」保持旧行为；切「全部词库」→ 调 batch-scan → 渲染统计 + 清单
- 入口按钮不变（批量工具栏「AI 批量生成缩略图」）

### 4.2 清单改造（_renderBatchPreview 数据源扩展）
- `_batchIds`（选中集）→ 扩展 `_batchScope` + `_batchScanResult`
- 顶部统计条：`待处理 450 · 仅待生成 120 · 已完成 860（跳过）· 队列 9`
- **分类 Tab**：全部 / 待处理 / 仅待生成 / 已完成（可展开检查跳过的卡，防止误跳过）
- 行内徽章与后端扫描一致：✨ 已优化（detailed）✅ 已生成（thumbnail）⏳ 队列中
- 「本次处理」= pending + opt_only（要执行的卡），提交前确认数

### 4.3 批次控制（承载限制）
- 底部「开始生成」旁：`每批提交 <select> 10 / 20 / 50 / 100 / 200 / 不限 </select> 张`
- 说明文案：`在线引擎（即梦/LibTV）建议 ≤20，本地 ComfyUI 可 ≥50；批次越小单任务失败影响面越小`
- 默认值跟随引擎切换自动调整，用户选择 localStorage 记忆
- 提交传 batch_size；返回 task_ids[] 全部入 `_batchTaskIds` 多任务队列（**现有机制直接复用**：独立轮询、localStorage 持久化恢复、进度条显示任务 x/N）

### 4.4 Ollama 优化联动
- 优化队列跳过逻辑扩展：`content_detailed 非空`（后端扫描状态）自动跳过，清单显示「已优化（存词卡）」
- 生成前自动完成「未保存优化 → 存词卡」？**不自动**，保持用户控制（现有「全部存词卡」按钮）

### 4.5 完成闭环
- 任务全部完成后自动刷新词卡列表（现有 _pollBatchTask 完成回调已有 loadPrompts，确认复用）

---

## 5. 承载限制分析与默认值

| 引擎 | 风险 | 建议默认批次 | 理由 |
|------|------|:---:|------|
| ComfyUI（本地） | 无并发风险；任务过长恢复成本 | 50 | 串行安全；进度/中断恢复友好 |
| 即梦（在线） | 限流、积分/Token 集中消耗、单任务可能超时 | 20 | 失败面小；**开发时确认 CLI 是否有单次张数硬上限** |
| LibTV（在线） | 付费模型「算力不足」整批失败（现有 confirm 已提示） | 20 | 单批损失最小化 |
| 不限（0） | — | 高级选项 | 保持全量单任务能力 |

> 批次数 = ceil(pending / batch_size)，N 个任务排队由全局锁串行消化，不增加并发压力。

---

## 6. 开发步骤

| 阶段 | 内容 | 验收 |
|------|------|------|
| P0 | 后端：抽 `_filter_pending_ids` + batch-scan 接口 + batch-tasks 切片 + worker 详细档优先级 | curl 实测：扫描统计正确、切片任务串行执行、详细档生效 |
| P1 | 前端：范围选择器 + 扫描统计清单 + 分类 Tab + 批次选择器 + 多任务提交 | 全词库一键提交，任务队列独立轮询 |
| P2 | Ollama 跳过联动 detailed、完成自动刷新、localStorage 记忆 | 跨会话重开弹窗状态正确 |
| P3 | 全库实测（1439 张）：扫描性能、切片恢复、即梦小批次、防重复入队 | 用户验收 |

## 7. 待确认项（开发前）
1. ~~即梦 CLI 是否有单任务张数硬上限~~ → 开发时实测（影响默认批次值）
2. ~~「已生成未优化」默认跳过还是重生成~~ → **已定**：AI 生成过默认跳过 + 清单可勾选重生成（见 §2.4）
3. batch_size 默认值是否接受「引擎自适应 + 用户可改」
4. **手动指定预览图的词卡**：默认纳入生成（覆盖手动图）+ UI 提示，还是默认排除？建议纳入 + 提示（用户主动跑流水线即有意愿）
