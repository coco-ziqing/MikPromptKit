# web-log-resolve · 报错日志智能解析&修复 Skill

> 一站式解析 **本地 WebUI 前端 / 后端接口 / DeepSeek 推理** 全链路报错日志，
> 分层定位根因，输出可落地修复方案；内置 **DeepSeek V4 Pro + V4 Flash 双模型分层路由**，精准控 Token。

---

## 1. 安装与挂载

本技能以 **完全隔离的增量方式** 挂载在工作区技能根：

```
C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\skills\web-log-resolve\
```

- 属于 OpenClaw 技能加载 **precedence #1（workspace skills）**，无需任何配置文件改动；
- `skills.load.watch=true` 默认开启 → 文件落地后 **自动热重载**，不重启全局服务；
- 未触碰角色配置、Token 缓存、全局优化参数、WebUI 部署配置。

无需额外安装依赖：四个脚本 **纯 Python 标准库**实现（本机 Python 3.14）。

---

## 2. 快捷指令

| 指令 | 场景 | 锁定模型 | 输出特征 |
|---|---|---|---|
| `/log-resolve-full` | 疑难 / 连锁 / 推理崩溃 | deepseek-v4-pro | 三层根因 + 临时/全局/防复发四层 |
| `/log-check-quick` | 语法错 / 4xx-5xx / 单条 | deepseek-v4-flash | 单层根因 + 极简步骤（省 Token） |

自动触发关键词：`日志 报错 堆栈 推理崩溃 OOM 前端报错 后端500 模型加载失败 批量bug 日志排查`

**优先级**：手动指令 > 自动判定（手动强制覆盖自动分流）。

---

## 3. 使用教程

### 3.1 直接命令行调用（统一入口）
```bash
cd skills/web-log-resolve/scripts

# 深度溯源（PRO）
python fix_solution_generator.py ../tests/model_oom_crash.log --input "/log-resolve-full"

# 极速解析（FLASH）
python fix_solution_generator.py ../tests/web_front_error.log --input "/log-check-quick"

# 自动路由（不带 --input，按日志内容自动选模型）
python fix_solution_generator.py ../tests/backend_api_500.log

# 批量多日志聚合（自动归并同源故障）
python fix_solution_generator.py ../tests/web_front_error.log ../tests/backend_api_500.log ../tests/model_oom_crash.log

# 机读 JSON
python fix_solution_generator.py ../tests/backend_api_500.log --json
```

### 3.2 单模块独立调用
```bash
# 仅结构化解析
python log_struct_parser.py ../tests/backend_api_500.log

# 仅查看路由决策
python model_router_dispatch.py ../tests/model_oom_crash.log --input "/log-check-quick"

# 仅根因分析
python root_cause_analyzer.py ../tests/web_front_error.log
```

### 3.3 在对话中使用
直接粘贴报错日志 + 关键词或斜杠指令，例如：
- `/log-check-quick` 后跟一段 JS 报错 → 走 FLASH，极简修复；
- `/log-resolve-full` 后跟模型崩溃堆栈 → 走 PRO，全链路根治。

---

## 4. 场景适配

| 报错来源 | 识别字段 | 典型故障标签 |
|---|---|---|
| 前端 Vue/React 控制台 | `.vue/.js` 文件行号、Uncaught | JS运行时报错 / JSON解析失败 / 资源加载失败 |
| 后端 FastAPI/Uvicorn | Traceback 末帧、HTTP 状态码 | 接口500 / 接口404 / 参数校验失败 / 数据库锁 / 端口占用 |
| DeepSeek / 本地推理 | CUDA、NCCL、safetensors、tokenizer | OOM显存溢出 / KV缓存超限 / 权重文件损坏 / 多卡通信故障 / 量化不匹配 |

---

## 5. 五大能力

1. **结构化解析** — 过滤噪声，提取时间/级别/模块/文件行号/堆栈/HTTP/资源信号，自动打故障标签。
2. **多层根因定位** — 表层异常 → 中层代码/参数/通信 → 底层硬件/驱动/权重/网络。
3. **批量聚合修复** — 多日志同时导入，按 `fault_tag` 归并同源故障，分别给临时与全局方案。
4. **推理专项故障库** — `FAULT_LIBRARY` 内置显存/KV/量化/Tokenizer/并发/批处理/多卡/兼容 8 类规则。
5. **防复发四层优化** — 代码 / 配置 / 运维 / 工程 长效建议。

---

## 6. 开发价值
- **降本**：简单故障走 Flash 压缩输出，复杂故障才上 Pro，按需分配 Token。
- **提效**：从「贴日志」到「拿到可落地修复代码+配置」一步到位。
- **稳定**：纯标准库、零侵入、热重载，不影响存量 WebUI / 模型服务 / 缓存。

---

## 7. 验证命令
```bash
# ① 技能注册校验
openclaw skills list | grep web-log-resolve

# ② 极速模式
python skills/web-log-resolve/scripts/fix_solution_generator.py skills/web-log-resolve/tests/web_front_error.log --input "/log-check-quick"

# ③ 深度溯源模式
python skills/web-log-resolve/scripts/fix_solution_generator.py skills/web-log-resolve/tests/model_oom_crash.log --input "/log-resolve-full"
```
