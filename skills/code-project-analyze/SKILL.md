---
name: code-project-analyze
description: "源码工程结构化解析：读取多文件源代码，自动识别项目技术栈、分层架构、前后端交互逻辑、接口流转、完整业务链路，输出标准化结构化梳理报告。双模型分层路由控Token。触发词：源码分析、项目梳理、代码架构、全链路、工程拆解、梳理接口、技术栈识别。手动指令 /analyze-code（完整深度解析）/code-stack-only（仅技术栈快照）。"
version: 1.0.0
homepage: ""
metadata:
  {
    "openclaw":
      {
        "emoji": "🔍",
        "id": "code-project-analyze",
        "zh_name": "源码工程结构化解析Skill",
        "lazy_load": true,
        "requires": { "bins": ["python"] },
        "slash_commands":
          [
            { "cmd": "/analyze-code", "desc": "完整工程结构化深度解析（锁定 deepseek-v4-pro）" },
            { "cmd": "/code-stack-only", "desc": "轻量技术栈快照（锁定 deepseek-v4-flash）" },
          ],
        "auto_keywords":
          ["源码分析","项目梳理","代码架构","全链路","工程拆解","梳理接口","技术栈识别","读代码","依赖清单"],
      },
  }
---

# code-project-analyze — 源码工程结构化解析

## 技能元数据
| 字段 | 值 |
|------|-----|
| name | `code-project-analyze` |
| version | v1.0.0 (2026-06-22) |
| description | 读取多文件源代码，自动识别项目技术栈、分层架构、前后端交互逻辑、接口流转流程、完整业务链路，输出标准化结构化梳理报告 |
| user-invocable | true — 支持 `/analyze-code` `/code-stack-only` 斜杠命令 |
| bound | dynamic — 挂载 Cache Boundary 动态下层 |
| lazy_load | true — 非匹配任务 0 Token 注入 |

## 意图触发规则

### 自动匹配关键词
| 关键词 | 触发动作 | 路由模型 | Token预算 |
|--------|---------|----------|-----------|
| 源码分析、项目梳理、代码架构、全链路、工程拆解、梳理接口、读代码+流程 | 完整工程结构化解析 | **deepseek-v4-pro** (262K ctx) | <8000 output |
| 技术栈识别、是什么项目、用了什么框架、依赖清单 | 轻量技术栈快照 | **deepseek-v4-flash** | <2000 output |
| `/analyze-code` | 强制完整深度解析 | deepseek-v4-pro | <8000 output |
| `/code-stack-only` | 强制仅技术栈识别 | deepseek-v4-flash | <2000 output |

### 非匹配任务行为
- skills.lazy_load=true → 不匹配关键词时 0 字节注入
- 仅 config.json 中 1 行 entry 解析 ≈ 3 tokens 开销
- 不影响任何 WebUI 开发、提示词管理、局域网部署其他路由

## 统一入口与命令行调用（与 6 技能矩阵同构）

```bash
cd skills/code-project-analyze/scripts
python project_analyze_runner.py ../tests/sample_project --input "/analyze-code"      # 完整解析(PRO)
python project_analyze_runner.py ../tests/sample_project --input "/code-stack-only"  # 技术栈快照(FLASH)
python project_analyze_runner.py ../tests/sample_project                              # 自动路由
python project_analyze_runner.py ../tests/sample_project --json                       # 机读JSON
```

| 能力 | 实现脚本 |
|---|---|
| 技术栈/目录分层/接口流转扫描 | `scripts/stack_scanner.py` |
| 双模型分层路由 + Token 控制 | `scripts/model_router_dispatch.py` |
| 编排入口 + quick/full 渲染 | `scripts/project_analyze_runner.py` |

目录结构：`SKILL.md / README.md / scripts/(3) / tests/sample_project/`

## 核心执行流水线（代码分析6步标准SOP）

### Step 1: 文件读取分层（先配置后源码）
```
P0 files first (always):  package.json | pom.xml | requirements.txt | build.gradle
                          tsconfig.json | vite.config.* | webpack.config.*
                          Dockerfile | docker-compose.yml | .env.example
                          README.md | Makefile | CMakeLists.txt

→ 输出: 全局技术栈(framework+lang+deps+version+build-tool+deploy-env)
```

### Step 2: 目录分层拆解
```
遍历完整目录树，按以下规则分类：
  frontend/ → React/Vue/Angular/Next.js 组件+页面+路由+状态管理
  backend/  → 控制器/服务/模型/中间件/路由
  shared/   → 公共类型/工具/常量
  db/       → 数据库迁移/SQL/ORM 模型
  infra/    → 配置/部署/CI-CD/监控

输出: 项目目录架构树 + 每层职责一句话
```

### Step 3: 交互逻辑识别
```
抓取全部:
  - HTTP API 路由 (GET/POST/PUT/DELETE/WebSocket)
  - 请求入参结构 (query/body/path/header)
  - 响应体结构 (status code + data shape)
  - 跨组件调用 (import/dependency injection/event bus)
  - 状态流转 (Redux/Vuex/Pinia/Context/useState)
  - 前后端数据传递链路 (fetch/axios/gRPC/GraphQL)

输出: 全量接口清单表 + 请求-响应流转描述
```

### Step 4: 业务流程拆解
```
按用户操作维度梳理完整闭环:
  正常分支: 用户操作 → 前端事件 → API调用 → 后端处理 → DB读写 → 响应 → UI更新
  异常分支: 权限校验失败/参数校验失败/超时/服务降级/缓存穿透
  缓存逻辑: Redis/内存缓存/浏览器缓存 命中/穿透/预热
  数据持久化: CRUD 操作 + 事务 + 索引 + 关联查询

输出: 分场景闭环流程文字拆解（正常1条+异常分支N条）
```

### Step 5: 依赖关联梳理
```
模块导入图 → 函数调用链 → 第三方SDK → 数据库表关联 → 缓存中间件交互
(递归深度≤3层，避免Token爆炸)
```

### Step 6: 结构化输出（5模块固定格式）

```markdown
# {项目名} 源码工程分析报告

## ① 项目完整技术栈清单
| 层级 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 语言 | TypeScript | 5.x | 前后端统一 |
| 前端框架 | React 18 | 18.3 | SPA UI |
| 后端框架 | FastAPI | 0.115 | REST API |
| 数据库 | SQLite | 3.x | 本地持久化 |
| ... | ... | ... | ... |

## ② 工程分层架构
```
{项目}/
├── frontend/          # UI层：组件+路由+状态+样式
├── backend/           # 服务层：控制器+模型+中间件
├── shared/            # 共享层：类型定义+工具函数
└── data/              # 数据层：SQLite + 迁移脚本
```
每层职责一句话说明。

## ③ 全量交互逻辑
| 端点 | 方法 | 入参 | 响应 | 说明 |
|------|------|------|------|------|
| /api/cards | GET | ?search=&page= | {items,total} | 提示词检索 |
| /api/cards/{id} | PUT | body:{...} | {updated} | 编辑词条 |
| ... | ... | ... | ... | ... |

关键数据流转图（文字描述）。

## ④ 标准化业务流程
### 场景1: 用户检索提示词
1. 用户输入关键词 → 前端debounce 300ms → GET /api/cards?search=xxx
2. 后端 FTS5 全文检索 → SQLite 查询 → 按相关度排序 → 返回分页结果
3. 前端渲染卡片列表 → 点击复制 → 记录 usage 计数
4. 异常: 搜索无结果 → 空状态提示 → 建议标签相关词

### 场景2: ...
...

## ⑤ 代码风险/架构优化建议
- [ ] 风险: ... → 建议: ...
- [ ] 优化: ... → 预期收益: ...
```

## Token 节流策略

| 策略 | 说明 |
|------|------|
| 日志裁剪 | 工具输出 >500行自动中断，保留首尾各100行 |
| 注释过滤 | 分析报告阶段跳过纯注释/空行 | 
| 深度控制 | 函数调用链递归≤3层，依赖图节点≤50个 |
| 摘要优先 | 接口清单先输出摘要表，详情按需展开 |
| 模型分流 | 单文件→flash(快70%)，多文件→pro(推理质量优先) |

## 编程约束

| # | 规则 | 原因 |
|---|------|------|
| 1 | 绝对不能修改 workspace 下任何源码文件 | 只读分析，不写操作 |
| 2 | 读取文件先读配置再读源码 | P0 配置优先识别全局技术栈 |
| 3 | 多文件项目 >3 个源文件 → 强制 deepseek-v4-pro | 保推理质量 |
| 4 | 输出严格5模块格式 | 可读性+AI友好 |
| 5 | 不输出超长完整源码原文 | 只引用关键片段+行号 |
| 6 | 不分析二进制/图片/视频/数据库文件 | 跳过非文本 |
| 7 | 分析完毕不写入任何结果文件到 workspace | 纯输出报告到对话 |

## Cache Boundary 隔离架构

```
📦 静态可缓存区 (禁止修改)
├── IDENTITY.md / AGENTS.md / SOUL.md / USER.md / TOOLS.md
├── openclaw.json (仅增量patch)
├── agents/prompt-tool-dev/agent/*
└── memory/*.md

💾 Cache Boundary 动态下层 (本技能挂载点)
└── skills/code-project-analyze/
    └── SKILL.md ← 仅匹配意图时注入上下文
```

## 调用示例

```
用户: /analyze-code   或   帮我梳理这个项目的完整代码架构

Agent: [源码工程分析 - deepseek-v4-pro]
  Step1/6: 读取配置文件 → 识别: FastAPI+React+Bootstrap5+SQLite
  Step2/6: 遍历目录树 → 25后端模块+22前端模块
  Step3/6: 抓取交互逻辑 → 200+ API端点+前后端数据链路
  Step4/6: 拆解业务流程 → 12个核心闭环场景
  Step5/6: 梳理依赖关联 → 模块导入图+调用链
  Step6/6: 生成结构化报告 ↓

  # 咪卡Mik词库(PromptKit) 源码工程分析报告
  [完整5模块Markdown报告输出]
```

## 版本记录
- v1.0.0 (2026-06-22): 初始技能包，完整源码工程6步分析流水线+5模块结构化输出+双路由分流
