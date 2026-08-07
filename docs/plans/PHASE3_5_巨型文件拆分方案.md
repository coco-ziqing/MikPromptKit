# Phase 3.5 — 巨型文件拆分方案（预研稿）

> 状态：**方案待执行**（2026-08-07 产出）
> 原则：只挪不重构、每个文件拆完立即启动验证、分批提交

## 现状

| 文件 | 规模 | 函数数 | 建议动作 |
|------|------|--------|----------|
| backend/api/comfyui.py | 121KB / 2668 行 | 68 | 拆 3 个服务模块 |
| backend/api/seedance_v2.py | 72KB | ~40 | 拆 2 个服务模块 |
| backend/api/word_cards.py | 67KB | ~30 | 暂缓（router 内聚度高） |
| frontend/static/js/app_collections.js | 189KB | — | 拆 3-4 个页面模块 |
| frontend/static/js/wc_bridge.js | 137KB | — | 拆 2 个（分组树 + 列表渲染） |
| frontend/static/js/seedance_v2_composer.js | 135KB | — | 拆 3 个（表单/预览/批次） |
| frontend/static/js/comfy_workflow_lib.js | 113KB | — | 拆 2 个 |

## 后端拆分（先做，风险可控）

### 1. comfyui.py → api/comfyui_*.py（纯移动，router 文件瘦身）

按函数域切分（68 函数）：
- `api/comfyui_batch.py`：批处理任务（_ensure_batch_task_table/_batch_update/_batch_worker/create_batch_task/list_batch_tasks/get_batch_task/cancel_batch_task/retry_batch_failed/batch_generate_thumbnail/_now_str）≈ 500 行
- `api/comfyui_ollama.py`：ollama 集成（_get_ollama_config/ollama_status/save_ollama_config/ollama_enhance）≈ 300 行
- `api/comfyui_presets.py`：预设管理（_get_module_presets/_save_module_presets/_auto_populate_missing_presets/list_presets/create_preset/update_preset/delete_preset/get_module_presets/update_module_presets）≈ 400 行
- `api/comfyui.py` 保留：router 定义 + workflow CRUD + 参数分析 + 运行时（主路径）

执行要点：
- 移动前先 `grep -r "from api.comfyui import"` 全仓确认外部引用
- 模块间互调函数（如 batch 用到 _run_comfyui）→ 从主模块 import（`from api.comfyui import _run_comfyui`）或下沉到公共模块
- **每拆一个模块 → py_compile + 启动 + 该域 API 冒烟**

### 2. seedance_v2.py → api/seedance_v2_*.py

- `api/seedance_v2_lib.py`：纯工具（解析/组装/媒体处理）
- `api/seedance_v2.py`：router + 主流程
- 依赖 seedance_v2_seed（backend 根）不动

## 前端拆分（Phase 3.6+，需先建模块化基础）

前端无模块化（全局 App 对象 + IIFE），直接拆文件会破坏跨文件全局引用。
**前置条件**：先建立 `window.App = window.App || {}` 的分片加载约定（每片独立 IIFE 挂 App），
再按页面域拆：app_collections.js → app_collections/{sidebar,grid,detail}.js。

前端拆分收益验证方式：node --check 每片 + 浏览器控制台无未定义引用 + eslint 通过。

## 执行顺序建议

1. comfyui.py 拆分（P0，后端可自动验证）
2. seedance_v2.py 拆分（P1）
3. 前端模块化约定 + app_collections.js（P2）
4. wc_bridge.js / seedance_v2_composer.js / comfy_workflow_lib.js（P3）

## 验收标准

- 拆分后 ruff 0 error、pytest 全绿、服务启动 + 受影响 API 冒烟
- 前端 node --check + eslint + 页面功能回归
- 每个拆分独立 commit（可回滚）
