---
name: web-log-resolve
description: "报错日志智能解析与修复：结构化解析 WebUI 前端控制台、后端接口异常、DeepSeek 模型推理全链路日志，分层根因定位，输出可落地修复代码与配置。双模型分层路由控 Token。触发词：日志、报错、堆栈、推理崩溃、OOM、前端报错、后端500、模型加载失败、批量bug、日志排查。手动指令 /log-resolve-full（深度溯源）/log-check-quick（极速解析）。"
version: 1.0.0
homepage: ""
metadata:
  {
    "openclaw":
      {
        "emoji": "🩺",
        "id": "web-log-resolve",
        "zh_name": "报错日志智能解析&修复Skill",
        "env": "本地WebUI开发 / DeepSeek V4 Pro + V4 Flash 双模型调度",
        "lazy_load": true,
        "requires": { "bins": ["python"] },
        "slash_commands":
          [
            { "cmd": "/log-resolve-full", "desc": "深度全链路报错溯源修复（锁定 deepseek-v4-pro）" },
            { "cmd": "/log-check-quick", "desc": "日志极速轻量化解析（锁定 deepseek-v4-flash）" },
          ],
        "auto_keywords":
          ["日志","报错","堆栈","推理崩溃","OOM","前端报错","后端500","模型加载失败","批量bug","日志排查"],
      },
  }
---

# 报错日志智能解析&修复 Skill (web-log-resolve)

## 元数据
| 项 | 值 |
|---|---|
| 技能标识 ID | `web-log-resolve` |
| 中文名称 | 报错日志智能解析&修复Skill |
| 版本 | 1.0.0 |
| 适用环境 | 本地 WebUI 开发；DeepSeek V4 Pro / V4 Flash 双模型调度 |
| 标签 | 日志解析、报错修复、模型推理排障、Web前端调试、后端接口故障、批量日志治理、显存OOM排查 |
| 手动斜杠指令 | 启用 |

## 核心业务定位
一站式解析本地 WebUI 前端控制台报错、后端服务接口异常、DeepSeek 模型推理全链路日志；
自动结构化清洗日志、分层定位故障根因，输出可直接落地的修复代码与配置调整方案；
内置双模型智能分层路由，精准管控 Token 开销，适配本地 AI 项目全流程调试。

## 触发规则

### 专属快捷指令（最高优先级，强制锁定模型）
| 指令 | 动作 | 锁定模型 |
|---|---|---|
| `/log-resolve-full` | 深度全链路报错溯源修复 | `deepseek/deepseek-v4-pro` |
| `/log-check-quick` | 日志极速轻量化解析 | `deepseek/deepseek-v4-flash` |

### 自动触发关键词
`日志` `报错` `堆栈` `推理崩溃` `OOM` `前端报错` `后端500` `模型加载失败` `批量bug` `日志排查`

### lazy_load 行为
- `lazy_load=true`：未命中关键词 / 指令时不注入上下文，零额外 Token 占用。
- 仅在匹配触发时加载脚本与规则库。

## 双模型分层路由（控 Token 核心，已硬编码进 `scripts/model_router_dispatch.py`）

### ① DeepSeek V4 Pro — 高精度重型路由（高 Token，疑难场景）
- **触发**（自动判定 + `/log-resolve-full` 强制）：多层超长堆栈、偶现间歇 bug、显存 OOM / KV 缓存溢出、
  权重损坏/加载失败、多卡分布式报错、量化不兼容、前后端连锁故障、vLLM/Transformers 崩溃。
- **输出**：完整结构化元数据 → 三层根因拆解 → 临时快速修复代码 → 全局根治配置 → 四层长效防复发（代码/配置/运维/工程）。

### ② DeepSeek V4 Flash — 轻量化极速路由（低 Token，简单场景）
- **触发**（自动判定 + `/log-check-quick` 强制）：JS 语法报错、4xx/5xx 简易异常、传参错误、单条短日志、批量轻量巡检。
- **输出**：精简结构化信息 + 单层核心根因 + 极简可执行修复步骤，严格压缩输出长度。

### 优先级
**手动斜杠指令 > 自动场景判定**；手动指令强制覆盖自动分流，互不冲突。

## 五大核心能力 → 业务脚本映射
| # | 能力 | 实现脚本 |
|---|---|---|
| ① | 报错日志结构化解析（字段提取 + 故障标签） | `scripts/log_struct_parser.py` |
| ② | 多层根因定位（表层→中层→底层） | `scripts/root_cause_analyzer.py` |
| ③ | 批量同类 Bug 聚合修复 | `scripts/fix_solution_generator.py`（`_aggregate`） |
| ④ | DeepSeek 推理异常专项故障库 | `scripts/root_cause_analyzer.py`（`FAULT_LIBRARY`） |
| ⑤ | 防复发长效优化输出（四层） | `scripts/fix_solution_generator.py`（`render_markdown`） |
| 路由 | 双模型分层路由 + Token 控制 | `scripts/model_router_dispatch.py` |

## 执行流程（统一入口）
所有调用最终经 `fix_solution_generator.py` 编排：`parse → route → analyze → fix`。

```bash
# 进入脚本目录
cd skills/web-log-resolve/scripts

# 深度模式（PRO，全链路）：分析模型崩溃堆栈
python fix_solution_generator.py ../tests/model_oom_crash.log --input "/log-resolve-full"

# 极速模式（FLASH，压缩输出）：快速解析前端报错
python fix_solution_generator.py ../tests/web_front_error.log --input "/log-check-quick"

# 批量聚合：多条日志一次导入，自动归并同源故障
python fix_solution_generator.py ../tests/web_front_error.log ../tests/backend_api_500.log ../tests/model_oom_crash.log

# 机读 JSON 输出
python fix_solution_generator.py ../tests/backend_api_500.log --json
```

> 自动路由：不带 `--input` 时由 `model_router_dispatch.route()` 依据故障标签/关键词/跨模块连锁自动选 PRO 或 FLASH。

## 存量环境保护约束（最高优先级）
1. 全程增量挂载，**不删除/修改/覆盖**系统原有角色与配置；
2. **不清理/重置**全局 Token 缓存池、上下文缓存、历史对话缓存；
3. **不改动**存量优化参数、全局推理配置、本地 WebUI 部署配置；
4. 技能位于独立隔离目录 `skills/web-log-resolve/`，与原有服务完全解耦、无侵入。
   挂载方式为 workspace 技能根（precedence #1），由 `skills.load.watch` 自动热重载，**未触碰任何配置文件**。

## 目录结构
```
web-log-resolve/
├── SKILL.md                          # 调度/元数据/路由规则主配置
├── README.md                         # 使用教程与场景文档
├── scripts/
│   ├── log_struct_parser.py          # 日志清洗/结构化/故障标签
│   ├── model_router_dispatch.py      # 双模型分层路由/Token 控制
│   ├── root_cause_analyzer.py        # 根因分析 + DeepSeek 专项故障库
│   └── fix_solution_generator.py     # 修复代码/配置/优化方案 + 编排入口
└── tests/
    ├── web_front_error.log           # 前端报错样例
    ├── backend_api_500.log           # 后端接口异常样例
    └── model_oom_crash.log           # 模型推理 OOM 崩溃样例
```
