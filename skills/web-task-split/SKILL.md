---
name: web-task-split
description: "需求拆解与开发任务拆解：将零散口语化需求结构化，按前端/后端/模型/存储/工具分层切割模块，分析依赖、自动排优先级(P0-P3)，生成可落地开发Todo清单与多版本迭代规划，明确功能边界防过度开发。双模型分层路由控Token。触发词：需求拆解、开发任务、迭代规划、功能拆分、开发清单、模块划分、版本排期、开发计划、功能边界梳理。手动指令 /task-split-full（完整项目级深度拆解）/task-quick（单功能快速拆分）。"
version: 1.0.0
homepage: ""
metadata:
  {
    "openclaw":
      {
        "emoji": "🧩",
        "id": "web-task-split",
        "zh_name": "需求拆解与开发任务拆解Skill",
        "env": "本地WebUI功能迭代开发 / DeepSeek V4 Pro + V4 Flash 双模型调度",
        "lazy_load": true,
        "requires": { "bins": ["python"] },
        "slash_commands":
          [
            { "cmd": "/task-split-full", "desc": "完整项目级深度需求&任务拆解（锁定 deepseek-v4-pro）" },
            { "cmd": "/task-quick", "desc": "单功能轻量化快速拆分任务（锁定 deepseek-v4-flash）" },
          ],
        "auto_keywords":
          ["需求拆解","开发任务","迭代规划","功能拆分","开发清单","模块划分","版本排期","开发计划","功能边界梳理"],
      },
  }
---

# 需求拆解与开发任务拆解 Skill (web-task-split)

## 元数据
| 项 | 值 |
|---|---|
| 技能标识 ID | `web-task-split` |
| 中文名称 | 需求拆解与开发任务拆解Skill |
| 版本 | 1.0.0 |
| 适用环境 | 本地 WebUI 功能迭代开发；DeepSeek V4 Pro / V4 Flash 双模型智能调度 |
| 标签 | 需求拆解、开发任务拆分、迭代规划、模块划分、开发Todo清单、项目前置规划、WebUI迭代管理 |
| 手动斜杠指令 | 启用 |

## 核心工程定位
开发前置专用规划能力，解决需求模糊、开发无规划、迭代无序、功能边界模糊、过度开发等问题，
专为 LLM 配套本地 WebUI 持续迭代全流程设计；自动标准化梳理需求、切割业务模块、划分优先级，
输出可直接落地的开发任务清单与版本迭代方案，**前置规避盲目编码**。

## 触发规则

### 专属快捷指令（最高优先级，强制锁定模型）
| 指令 | 动作 | 锁定模型 |
|---|---|---|
| `/task-split-full` | 完整项目级深度需求&任务拆解 | `deepseek/deepseek-v4-pro` |
| `/task-quick` | 单功能轻量化快速拆分任务 | `deepseek/deepseek-v4-flash` |

### 自动触发关键词
`需求拆解` `开发任务` `迭代规划` `功能拆分` `开发清单` `模块划分` `版本排期` `开发计划` `功能边界梳理`

### lazy_load 行为
`lazy_load=true`：未命中关键词/指令时不注入上下文，零额外 Token；仅匹配触发时加载。

## 双模型分层路由（控 Token 核心，硬编码进 `scripts/model_router_dispatch.py`）

### ① DeepSeek V4 Pro — 高精度重型路由（高 Token，大型复杂项目）
- **触发**（自动判定 + `/task-split-full` 强制）：大型复合需求、多模块联动、跨前后端联合开发、
  多版本中长期排期、多人协作、复杂交互重构、含推理服务联动改造、需求边界模糊需深度梳理。
- **自动判定阈值**：需求点 ≥5 / 跨层(前·后·模型) ≥2 / 含多版本 / 含多人协作 / 边界模糊 / 含模型改造 → PRO。
- **输出**：结构化需求文档 → 模块分层拆分 → 依赖图谱 → 优先级分级(P0-P3) → 分版本迭代规划 → 完整 Todo → 边界约束 + 过度开发预警 + 前后端分工。

### ② DeepSeek V4 Flash — 轻量化极速路由（低 Token，简单单点）
- **触发**（自动判定 + `/task-quick` 强制）：单页面单点新增、小型优化、简单交互调整、短需求、临时待办梳理。
- **输出**：精简需求要点 + 单层功能拆分 + 极简 Todo，严格压缩输出长度。

### 优先级
**手动斜杠指令 > 自动场景判定**；手动强制覆盖自动分流，互不冲突。

## 六大核心能力 → 业务脚本映射
| # | 能力 | 实现脚本 |
|---|---|---|
| ① | 需求结构化拆解（清洗+标准化字段） | `scripts/req_struct_parser.py` |
| ② | 业务模块智能拆分（5层切割+依赖） | `scripts/module_split_analyzer.py` |
| ③ | 开发优先级自动排序（P0-P3） | `scripts/module_split_analyzer.py`（`_priority_of`） |
| ④ | 标准化开发 Todo 清单生成 | `scripts/todo_iter_generator.py`（`_make_todos`） |
| ⑤ | 迭代版本周期规划 | `scripts/todo_iter_generator.py`（`_make_iterations`） |
| ⑥ | 功能边界定义 & 防过度开发 | `scripts/scope_limit_checker.py` |
| 路由 | 双模型分层路由 + Token 控制 | `scripts/model_router_dispatch.py` |

## 执行流程（统一入口）
所有调用最终经 `todo_iter_generator.py` 编排：`parse → route → split → scope → todo+iteration`。

```bash
cd skills/web-task-split/scripts

# 完整项目级（PRO，深度规划）
python todo_iter_generator.py ../tests/full_complex_webui_req.txt --input "/task-split-full"

# 极速单点（FLASH，压缩输出）
python todo_iter_generator.py ../tests/simple_single_func_req.txt --input "/task-quick"

# 自动路由（不带 --input，按需求复杂度自动选 PRO/FLASH）
python todo_iter_generator.py ../tests/full_complex_webui_req.txt

# 机读 JSON
python todo_iter_generator.py ../tests/simple_single_func_req.txt --json
```

## 存量环境保护约束（最高优先级）
1. 全程增量挂载，**不删除/修改/覆盖**系统原有角色与配置；
2. **不清理/重置**全局 Token 缓存池、上下文缓存、历史对话缓存；
3. **不改动**存量优化参数、全局推理配置、本地 WebUI 部署配置；
4. 技能位于独立隔离目录 `skills/web-task-split/`，与原有服务完全解耦、无侵入。
   挂载方式为 workspace 技能根（precedence #1），由 `skills.load.watch` 自动热重载，**未触碰任何配置文件**。

## 目录结构
```
web-task-split/
├── SKILL.md                          # 调度/元数据/双模型路由主配置
├── README.md                         # 使用教程与场景文档
├── scripts/
│   ├── req_struct_parser.py          # ①需求清洗/结构化标准化
│   ├── model_router_dispatch.py      # 双模型分层路由/Token 控制
│   ├── module_split_analyzer.py      # ②模块切割/依赖分析/③优先级排序
│   ├── todo_iter_generator.py        # ④Todo清单/⑤迭代规划 + 编排入口
│   └── scope_limit_checker.py        # ⑥功能边界/防过度开发
└── tests/
    ├── full_complex_webui_req.txt    # 大型完整 WebUI 迭代需求样例
    └── simple_single_func_req.txt    # 单点小型功能优化需求样例
```
