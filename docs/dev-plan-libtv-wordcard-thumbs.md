# LibTV 生成能力接入 MikPromptKit 词库 — 开发计划

> 目标：在「AI 批量生成缩略图」弹窗中新增 **LibTV** 引擎，复用即梦（dreamina）的
> 批量任务 → 轮询 → 落库 → 预览刷新 完整链路，为词卡批量生成缩略图。
> 当前提交基线：master @ 040e39a（v5.31.0）

---

## 一、现状调研结论

### 1. 即梦接入的完整链路（参照物）

| 层 | 文件 | 职责 |
|----|------|------|
| 后端 CLI 封装 | `backend/api/dreamina.py` | `_dreamina_run()` 调 CLI、`dreamina_text2image()` 文生图（重试）、`save_generated_image()` 下载+缩略图+落库 |
| 批量任务 | `backend/api/comfyui.py` `_batch_worker()` | `engine=="dreamina"` 分支：组合提示词 → 调 dreamina → 下载 → 落库 → 结果进任务表 |
| 前端弹窗 | `frontend/static/js/app_collections.js` | `_batchEngine('dreamina')` 引擎切换、参数区（模型/比例/分辨率）、`_startBatchGen` 提交 `engine: 'dreamina'` |
| 前端轮询 | `app_collections.js` `_pollBatchTask()` | 2s 轮询 `/api/v2/comfyui/batch-tasks/{id}`，完成后 `loadPrompts()` 刷新预览 |
| 版本管理 | `frontend/index.html` | JS `?v=` 版本号破缓存 |

### 2. LibTV CLI 与即梦的关键差异

| 维度 | 即梦（dreamina） | LibTV（libtv） |
|------|------------------|----------------|
| CLI 位置 | `~/bin/dreamina.exe` | `~/.libtv/libtv.exe`（已装 v1.1.1） |
| 出图命令 | `dreamina text2image --prompt ...` | `libtv node create <名> -t image -p <画布UUID> -s "model=..." -s prompt=... --run` |
| 返回图片 | 直接返回 `image_url` | **不直接返回**；产物 URL 在节点 JSON 的 `data.url[0]` |
| 画布绑定 | 无 | **必须指定画布**（`-p <projectUuid>` 或先 `project use`） |
| 模型 | 即梦 3.0~5.0Pro | Lib Image / Seedream / Z-image Turbo / Qwen 等（`model search` 动态查） |
| 免费/付费 | 全付费（账号有积分） | 部分免费（Z-image Turbo / Seedream 4.x）；付费模型报「算力不足」 |
| 出图速度 | 秒级 | 10s~3min（模型而定，`--run` 阻塞等待） |
| 并发 | 无限制 | CLI 单进程，批量需串行（与即梦一致） |

### 3. 关键约束（LibTV 专属）

- **画布 UUID**：每张词卡缩略图都生成到同一张「缩略图画布」；需在配置中存 `projectUuid`
- **节点名唯一**：LibTV 画布内节点展示名必须唯一 → 批量生成时节点名需加后缀（如 `thumb_<词卡id>_<时间戳>`）
- **取图**：`node create --run` 返回 JSON 的 `data.url[0]` 即成品 URL（如 `https://libtv-res.liblib.art/sd-gen-save-img/...png`）
- **积分保护**：免费模型（Z-image Turbo / Seedream 4.x）优先；付费模型需前端明确提示
- **CLI 输出编码**：PowerShell 下中文乱码不影响 stdout JSON 解析（Python subprocess 读 stdout 正常）

---

## 二、开发计划（分 5 期）

### P0 期：后端 LibTV 引擎封装（`backend/api/libtv.py` 新增）

**目标**：复刻 `dreamina.py` 结构，提供 LibTV CLI 封装 + 单张生成 + 落库。

```
backend/api/libtv.py（新增，~200 行）
├── LIBTV_BIN = ~/.libtv/libtv.exe
├── _libtv_run(args, timeout)          # subprocess 封装（同 _dreamina_run）
├── @router.get("/status")             # CLI 可用 + 登录态 + 画布列表 + 免费模型列表
│     ├── cli_available / logged_in（libtv account info 探测）
│     ├── projects（libtv project list → uuid/name）
│     └── free_models（libtv model search --type image → modelKey/modelName）
├── class LibTVGenerateRequest         # prompt / prompt_id / card_type / project_uuid / model / ratio
├── libtv_text2image(prompt, project_uuid, model, ratio)  
│     # node create "thumb_<ts>" -t image -p <uuid> -s "model=..." -s prompt=... -s ratio=... --run
│     # 解析 stdout JSON → data.url[0]；失败重试 1 次（节点名加随机后缀）
├── save_generated_image(img_bytes, prompt_id, card_type, source="libtv")  
│     # 复用 dreamina 的 save_generated_image（提取到公共模块或 import）
└── @router.post("/generate")          # 单张生成（调试用）
```

**关键决策**：
- `save_generated_image` 从 `dreamina.py` **提取到 `backend/api/thumb_gen.py`** 公共模块（即梦/LibTV/未来引擎共用），避免复制粘贴
- `libtv_text2image` 的节点名 = `thumb_<epoch_ms>`，保证画布内唯一
- `--run` 阻塞 → `_libtv_run` timeout 设 300s（与即梦一致）

### P1 期：批量任务接入（`backend/api/comfyui.py` 改造）

**目标**：`_batch_worker` 增加 `engine=="libtv"` 分支 + 任务表扩展。

```
backend/api/comfyui.py
├── BatchTaskCreate 增加字段：
│     project_uuid: str = ""        # LibTV 目标画布
│     libtv_model: str = "Z-image Turbo"   # 免费默认
│     libtv_ratio: str = "1:1"
├── _ensure_batch_task_table 加列：project_uuid / libtv_model / libtv_ratio
├── create_batch_task / retry_batch_failed 写入新字段
└── _batch_worker 内 engine=="libtv" 分支：
      from api.libtv import libtv_text2image, save_generated_image
      lt = libtv_text2image(final_prompt, d["project_uuid"], d["libtv_model"], d["libtv_ratio"])
      → 下载 lt["image_url"] → save_generated_image(..., source="libtv")
      → result {ok, thumbnail_url, ...}（与 dreamina 分支同构）
```

**复用现有机制**：
- card_type_map（word_card/prompts 显式标注，上轮已修）
- 全局锁 `_BATCH_GLOBAL_LOCK` 串行
- 进度/取消/重试/结果 JSON 全复用，前端轮询零改动

### P2 期：前端引擎切换（`frontend/static/js/app_collections.js` + `index.html`）

**目标**：批量弹窗加第三个引擎「LibTV」，参数区可配置。

```
app_collections.js
├── 弹窗引擎按钮加：<button id="bgenEngineLibtv" onclick="App._batchEngine('libtv')">LibTV</button>
├── _batchEngine('libtv') → 显示 libtv 参数区（bgenLibtvArea）
├── libtv 参数区：
│     ├── 画布选择 <select id="bgenLibtvProject">（/api/v2/libtv/status 拉取）
│     ├── 模型选择 <select id="bgenLibtvModel">（免费模型优先 + 付费模型分组提示）
│     └── 比例 <select id="bgenLibtvRatio">（1:1 / 16:9 / 9:16 / 4:3 / 3:4）
├── _saveBatchSettings / _restoreBatchSettings 增加 libtv 字段
└── _startBatchGen body 增加：project_uuid / libtv_model / libtv_ratio / engine:'libtv'

index.html
└── app_collections.js ?v=10.32 → 10.33
```

### P3 期：积分/额度保护与提示

**目标**：避免批量任务因「算力不足」整批失败。

```
- /status 返回 free_models + paid_models 分组
- 前端模型下拉：免费模型标「🆓」，付费模型标「💎 消耗积分」
- 选择付费模型时 toast 提示「当前账号积分不足可能失败（基础VIP未生效）」
- _batch_worker libtv 分支：单张失败 error 含 fail_reason（如「算力不足」），
  计入 failed，可走现有「重试失败」按钮（用户充值后一键重试）
```

### P4 期：测试与部署

| 项 | 内容 |
|----|------|
| 单元验证 | `libtv_text2image` 单张生成成功取到 URL（已手工验证过 node create --run） |
| 批量验证 | 选 3 张词卡 → LibTV 引擎 → 生成 → 缩略图落库 → 预览刷新 |
| 免费模型验证 | Z-image Turbo（已验证 1K 成功）|
| 付费模型验证 | Seedream 5.0 Pro → 预期「算力不足」→ 确认错误提示友好 |
| 回归 | 即梦/ComfyUI 引擎批量不受影响（card_type_map + 落库链路复用） |
| 部署 | git commit + tag；局域网访问测试 |

---

## 三、风险与对策

| 风险 | 等级 | 对策 |
|------|------|------|
| LibTV 画布内节点名冲突 | 中 | 节点名 `thumb_<epoch_ms>` 全局唯一；失败重试再加后缀 |
| `--run` 长时间阻塞（3min） | 中 | timeout 300s；批量全局锁串行（已有）；失败项可单独重试 |
| 付费模型积分不足整批失败 | 高 | 免费模型默认；付费需明确选择；错误按单条记 failed |
| 画布 UUID 失效/被删 | 低 | /status 拉取实时画布列表；批量前校验一次 |
| CLI 输出编码（GBK 终端） | 低 | Python subprocess 用 `encoding="utf-8", errors="replace"`（同 dreamina） |
| 未来 LibTV CLI 更新 | 低 | 按官方 activity 接口更新（skills/libtv-cli 已内置 install.md） |

---

## 四、交付物清单

1. `backend/api/libtv.py`（新增）— CLI 封装 + 单张生成 + /status
2. `backend/api/thumb_gen.py`（新增）— 公共 save_generated_image（从 dreamina 提取）
3. `backend/api/dreamina.py` — 改为 import 公共落库函数（行为不变）
4. `backend/api/comfyui.py` — 批量任务 libtv 分支 + 任务表新列
5. `frontend/static/js/app_collections.js` — 引擎切换 + 参数区 + 提交
6. `frontend/index.html` — 版本号升级
7. 测试报告 + git tag（v5.32.0）

---

## 五、预估工作量

| 期 | 内容 | 估时 |
|----|------|------|
| P0 | 后端 libtv.py + 公共落库提取 | 1.5h |
| P1 | 批量任务 libtv 分支 | 1h |
| P2 | 前端引擎切换 | 1.5h |
| P3 | 积分保护提示 | 0.5h |
| P4 | 测试部署 | 1h |
| **合计** | | **~5.5h** |
