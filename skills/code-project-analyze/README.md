# code-project-analyze · 源码工程结构化解析 Skill

> 读取多文件源码，自动识别**技术栈 / 分层架构 / 接口流转 / 业务链路**，输出结构化梳理报告。
> 双模型分层路由控 Token，与 6 技能矩阵同构。

## 安装与挂载
隔离挂载于 `skills/code-project-analyze/`（workspace 技能根 precedence #1，`skills.load.watch` 自动热重载，零配置改动）。纯标准库零依赖（Python 3.14）。

## 快捷指令
| 指令 | 场景 | 锁定模型 | 输出 |
|---|---|---|---|
| `/analyze-code` | 完整工程/全链路 | deepseek-v4-pro | 技术栈+目录分层+接口流转+业务链路+依赖清单 |
| `/code-stack-only` | 只想知道技术栈 | deepseek-v4-flash | 语言/框架/构建工具/依赖快照（省Token） |

自动关键词：`源码分析 项目梳理 代码架构 全链路 工程拆解 梳理接口 技术栈识别 依赖清单`
优先级：手动指令 > 自动判定（强制覆盖）。

## 使用教程

### 统一入口（推荐）
```bash
cd skills/code-project-analyze/scripts

# 完整解析（PRO）
# 注：本机 PATH 里的 `python` 是 WindowsApps stub（exit 9009 静默失败），必须用上面的绝对路径
& C:\Users\admin\AppData\Local\Python\bin\python.exe project_analyze_runner.py ../tests/sample_project --input "/analyze-code"

# 技术栈快照（FLASH）
& C:\Users\admin\AppData\Local\Python\bin\python.exe project_analyze_runner.py ../tests/sample_project --input "/code-stack-only"

# 自动路由（按文件数/跨层/接口数自动选档）
& C:\Users\admin\AppData\Local\Python\bin\python.exe project_analyze_runner.py ../tests/sample_project

# 机读 JSON
& C:\Users\admin\AppData\Local\Python\bin\python.exe project_analyze_runner.py ../tests/sample_project --json
```

### 单模块
```bash
& C:\Users\admin\AppData\Local\Python\bin\python.exe stack_scanner.py ../tests/sample_project          # 仅扫描技术栈/分层/接口
& C:\Users\admin\AppData\Local\Python\bin\python.exe model_router_dispatch.py ../tests/sample_project --input "/analyze-code"   # 仅路由决策
```

### 对话中
贴源码/项目结构 + `/analyze-code`（深度）或 `/code-stack-only`（仅技术栈）；不带指令按复杂度自动路由。

## 能力 → 脚本映射
| 能力 | 脚本 |
|---|---|
| 技术栈/目录分层/接口流转扫描 | `scripts/stack_scanner.py` |
| 双模型分层路由 + Token 控制 | `scripts/model_router_dispatch.py` |
| 编排入口 + quick/full 渲染 | `scripts/project_analyze_runner.py` |

## 目录结构
```
code-project-analyze/
├── SKILL.md / README.md
├── scripts/{stack_scanner, model_router_dispatch, project_analyze_runner}.py
└── tests/sample_project/  (前端 src/api + 后端 backend/api + package.json)
```
