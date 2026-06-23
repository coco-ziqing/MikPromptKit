---
name: build-deploy-opt
description: "工程打包与部署优化：解析 vite/webpack 构建配置补全分包/缓存/tree-shaking，扫描冗余依赖输出精简命令，解析构建报错日志定位根因给修复代码，生成静态资源 gzip/brotli 压缩策略，适配本地/测试/线上三套环境并生成 start.bat+Nginx+Docker 部署脚本。双模型分层路由控 Token。触发词：打包构建、vite编译、webpack优化、部署报错、打包体积过大、构建卡顿、静态资源压缩、依赖冗余、服务器部署、环境配置冲突。手动指令 /build-opt-full（全量深度优化）/build-check-quick（轻量配置校验）。"
version: 1.0.0
homepage: ""
metadata:
  {
    "openclaw":
      {
        "emoji": "🚀",
        "id": "build-deploy-opt",
        "zh_name": "工程打包&部署优化Skill",
        "env": "本地WebUI打包构建/服务器上线部署 / DeepSeek V4 Pro + V4 Flash 双模型调度",
        "lazy_load": true,
        "requires": { "bins": ["python"] },
        "slash_commands":
          [
            { "cmd": "/build-opt-full", "desc": "全量构建部署深度优化排查（锁定 deepseek-v4-pro）" },
            { "cmd": "/build-check-quick", "desc": "打包配置轻量化快速校验（锁定 deepseek-v4-flash）" },
          ],
        "auto_keywords":
          ["打包构建","vite编译","webpack优化","部署报错","打包体积过大","构建卡顿","静态资源压缩","依赖冗余","服务器部署","环境配置冲突"],
      },
  }
---

# 工程打包&部署优化 Skill (build-deploy-opt)

## 元数据
| 项 | 值 |
|---|---|
| 技能标识 ID | `build-deploy-opt` |
| 中文名称 | 工程打包&部署优化Skill |
| 版本 | 1.0.0 |
| 适用环境 | 本地 WebUI 打包构建 / 服务器上线部署；DeepSeek V4 Pro / V4 Flash 双模型调度 |
| 标签 | 项目构建、打包优化、vite/webpack、部署配置、构建报错修复、静态资源压缩、依赖精简、跨环境适配、部署排障 |
| 手动斜杠指令 | 启用 |

## 核心工程定位
面向 LLM 配套 WebUI 项目全流程构建与上线落地专用技能，解决打包报错、编译卡顿、产物臃肿、
依赖冗余、多环境配置不一致、服务器部署异常等痛点；自动分析构建配置、修复编译报错、
输出压缩瘦身方案、生成本地/服务器双环境部署配置，降低前端工程化部署维护成本。

## 触发规则

### 专属快捷指令（最高优先级，强制锁定模型）
| 指令 | 动作 | 锁定模型 |
|---|---|---|
| `/build-opt-full` | 全量构建部署深度优化排查 | `deepseek/deepseek-v4-pro` |
| `/build-check-quick` | 打包配置轻量化快速校验 | `deepseek/deepseek-v4-flash` |

### 自动触发关键词
`打包构建` `vite编译` `webpack优化` `部署报错` `打包体积过大` `构建卡顿` `静态资源压缩` `依赖冗余` `服务器部署` `环境配置冲突`

### lazy_load 行为
`lazy_load=true`：未命中关键词/指令时不注入上下文，零额外 Token；仅匹配触发时加载。

## 双模型分层路由（控 Token 核心，硬编码进 `scripts/model_router_dispatch.py`）

### ① DeepSeek V4 Pro — 高精度重型路由（高 Token，复杂构建部署）
- **触发**（自动判定 + `/build-opt-full` 强制）：构建堆栈崩溃、产物超标深度瘦身、多环境差异化部署、
  webpack/vite 深层配置重构、大型依赖清理、服务端部署权限/端口/镜像故障、构建性能全链路调优、多模块分包改造。
- **自动判定阈值**：报错命中 ≥2 类 / 配置风险=high / 环境冲突 ≥2 处 / 命中重型关键词 → PRO。
- **输出**：构建日志结构化分析 → 报错多层根因 → 完整配置优化代码 → 分步瘦身方案 → 本地+服务器两套部署脚本 → 依赖清理清单 → 缓存优化策略 → 上线风险规避清单。

### ② DeepSeek V4 Flash — 轻量化极速路由（低 Token，简单校验）
- **触发**（自动判定 + `/build-check-quick` 强制）：单命令校验、简易语法检查、小型压缩建议、基础冗余筛查、简单环境参数修正。
- **输出**：精简问题点 + 极简修复命令 + 轻量优化建议，严格压缩输出。

### 优先级
**手动斜杠指令 > 自动场景判定**；手动强制覆盖自动分流，互不冲突。

## 六大核心能力 → 业务脚本映射
| # | 能力 | 实现脚本 |
|---|---|---|
| ① | Webpack/Vite 构建配置解析优化 | `scripts/build_config_parser.py` |
| ② | 冗余依赖智能清理 | `scripts/dep_clean_optimizer.py` |
| ③ | 构建报错自动修复（根因+修复码） | `scripts/build_error_fixer.py` |
| ④ | 静态资源压缩处理（gzip/brotli/CDN/分片） | `scripts/asset_compress_opt.py` |
| ⑤ | 跨环境部署配置适配（.env 三层） | `scripts/env_deploy_generator.py`（`analyze_env`/`_gen_layered_env`） |
| ⑥ | 一键部署脚本生成（start.bat/Nginx/Docker） | `scripts/env_deploy_generator.py`（`_gen_deploy_scripts`） |
| 路由 | 双模型分层路由 + Token 控制 | `scripts/model_router_dispatch.py` |

## 执行流程（统一入口）
所有调用最终经 `env_deploy_generator.py` 编排：`config + error + dep + asset + env-deploy`。

```bash
cd skills/build-deploy-opt/scripts

# 全量深度优化（PRO）：构建报错 + 配置 + 环境一起分析
python env_deploy_generator.py --error ../tests/vite-build-error.log --config ../tests/webpack-big-size-config.js --env ../tests/server-deploy-conflict.env --input "/build-opt-full"

# 轻量校验（FLASH）：只看一个配置
python env_deploy_generator.py --config ../tests/webpack-big-size-config.js --input "/build-check-quick"

# 自动路由（按报错/风险/冲突信号自动选 PRO/FLASH）
python env_deploy_generator.py --error ../tests/vite-build-error.log

# 机读 JSON
python env_deploy_generator.py --env ../tests/server-deploy-conflict.env --json
```

> 单模块亦可独立运行：`build_config_parser.py` / `build_error_fixer.py` / `dep_clean_optimizer.py` / `asset_compress_opt.py` / `model_router_dispatch.py`。

## 存量环境保护约束（最高优先级）
1. 全程增量挂载，**不删除/修改/覆盖**系统原有角色与配置；
2. **不清理/重置**全局 Token 缓存池、上下文缓存、历史对话缓存；
3. **不改动**存量优化参数、全局推理配置、本地 WebUI 部署配置；
4. 技能位于独立隔离目录 `skills/build-deploy-opt/`，与原有服务完全解耦、无侵入。
   挂载方式为 workspace 技能根（precedence #1），由 `skills.load.watch` 自动热重载，**未触碰任何配置文件**。

## 目录结构
```
build-deploy-opt/
├── SKILL.md                          # 调度/元数据/双模型路由主配置
├── README.md                         # 使用教程与场景文档
├── scripts/
│   ├── build_config_parser.py        # ①vite/webpack 配置解析+优化缺口
│   ├── model_router_dispatch.py      # 双模型分层路由/Token 控制
│   ├── build_error_fixer.py          # ③构建报错根因定位+修复生成
│   ├── dep_clean_optimizer.py        # ②冗余依赖扫描+精简命令
│   ├── asset_compress_opt.py         # ④静态资源压缩策略
│   └── env_deploy_generator.py       # ⑤多环境配置/⑥部署脚本 + 编排入口
└── tests/
    ├── vite-build-error.log          # Vite 构建崩溃报错样例
    ├── webpack-big-size-config.js    # 打包体积臃肿配置样例
    └── server-deploy-conflict.env    # 多环境配置冲突样例
```
