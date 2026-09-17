# build-deploy-opt · 工程打包&部署优化 Skill

> **从「构建报错/打包臃肿/部署冲突」到「可落地优化代码+双环境部署脚本」一步到位。**
> 解析 vite/webpack 配置、修复构建报错、清理冗余依赖、压缩静态资源、适配三层环境、生成部署脚本。
> 内置 **DeepSeek V4 Pro + V4 Flash 双模型分层路由**，按复杂度精准控 Token。

---

## 1. 安装与挂载

完全隔离的增量挂载，位于工作区技能根：

```
C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\skills\build-deploy-opt\
```

- OpenClaw 技能加载 **precedence #1（workspace skills）**，无需任何配置文件改动；
- `skills.load.watch=true` → 文件落地后**自动热重载**，不重启全局服务；
- 未触碰角色配置、Token 缓存、全局优化参数、WebUI 部署配置。

**零依赖**：6 个脚本纯 Python 标准库（本机 Python 3.14）。

---

## 2. 快捷指令

| 指令 | 场景 | 锁定模型 | 输出特征 |
|---|---|---|---|
| `/build-opt-full` | 崩溃报错 / 深度瘦身 / 多环境 / 重构 | deepseek-v4-pro | 配置优化码+报错根因+依赖清理+压缩+部署脚本+风险清单 |
| `/build-check-quick` | 单命令 / 语法检查 / 小压缩 | deepseek-v4-flash | 精简问题点+极简修复命令（省Token） |

自动关键词：`打包构建 vite编译 webpack优化 部署报错 打包体积过大 构建卡顿 静态资源压缩 依赖冗余 服务器部署 环境配置冲突`

**优先级**：手动指令 > 自动判定（强制覆盖）。

---

## 3. 使用教程

### 3.1 统一入口（推荐）
```bash
cd skills/build-deploy-opt/scripts

# 全量深度优化（PRO）—— 多源一起分析
python env_deploy_generator.py \
  --error ../tests/vite-build-error.log \
  --config ../tests/webpack-big-size-config.js \
  --env ../tests/server-deploy-conflict.env \
  --input "/build-opt-full"

# 轻量校验（FLASH）
python env_deploy_generator.py --config ../tests/webpack-big-size-config.js --input "/build-check-quick"

# 自动路由
python env_deploy_generator.py --error ../tests/vite-build-error.log

# 机读 JSON
python env_deploy_generator.py --env ../tests/server-deploy-conflict.env --json
```

入参均可选，提供哪个就分析哪个：`--config` / `--error` / `--env` / `--package`。

### 3.2 单模块独立调用
```bash
python build_config_parser.py ../tests/webpack-big-size-config.js   # 仅配置优化缺口
python build_error_fixer.py   ../tests/vite-build-error.log         # 仅报错根因修复
python dep_clean_optimizer.py package.json                          # 仅依赖精简
python asset_compress_opt.py vite                                   # 仅压缩策略
python model_router_dispatch.py ../tests/vite-build-error.log       # 仅路由决策
```

### 3.3 在对话中使用
贴构建日志/配置 + 斜杠指令或关键词：
- `/build-check-quick` + 一段配置 → FLASH，极简校验；
- `/build-opt-full` + 完整构建报错日志 → PRO，全链路深度调优。

---

## 4. 六大能力

1. **构建配置解析优化** — 识别 vite/webpack，检出缺失的 splitChunks/cache/tree-shaking/contenthash/压缩/alias/懒加载，给可落地配置码 + 风险评分。
2. **冗余依赖清理** — 扫描 dev/prod 混淆、重复包、重型包(moment/lodash/jquery)，输出可执行卸载/迁移命令。
3. **构建报错修复** — 规则库覆盖 语法错/模块缺失/路径解析/版本冲突/内存溢出/插件错，给文件:行号 + 修复码。
4. **静态资源压缩** — 图片/字体/JS/CSS 策略 + gzip/brotli 配置码 + CDN 改造 + 大文件分片。
5. **跨环境配置适配** — 检出 .env 冲突(重复key/写死本机/端口冲突/debug未关)，生成 dev/test/prod 三层 .env。
6. **一键部署脚本** — 生成 start.bat + Nginx 反向代理(SPA路由+反代+gzip) + Dockerfile。

---

## 5. 工程价值
- **落地导向**：直接产出可粘贴的配置码、卸载命令、.env、部署脚本。
- **防臃肿**：分包/压缩/tree-shaking/依赖精简全覆盖，治打包体积膨胀。
- **跨环境一致**：本地/内网测试/线上三套配置标准化，治"本机能跑服务器报错"。
- **降本**：简单校验走 Flash 压缩输出，复杂构建才上 Pro，按需分配 Token。
- **零侵入**：纯标准库、热重载，不影响存量 WebUI / 模型服务 / 缓存。

---

## 6. 验证命令
```bash
# ① 技能注册校验
openclaw skills list | grep build-deploy-opt

# ② 极速配置校验
python skills/build-deploy-opt/scripts/env_deploy_generator.py --config skills/build-deploy-opt/tests/webpack-big-size-config.js --input "/build-check-quick"

# ③ 全量构建优化
python skills/build-deploy-opt/scripts/env_deploy_generator.py --error skills/build-deploy-opt/tests/vite-build-error.log --config skills/build-deploy-opt/tests/webpack-big-size-config.js --env skills/build-deploy-opt/tests/server-deploy-conflict.env --input "/build-opt-full"
```
