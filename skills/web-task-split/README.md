# web-task-split · 需求拆解与开发任务拆解 Skill

> **开发前置规划神器**：把一段乱糟糟的口语化需求，自动变成「结构化需求 + 分层模块 + 依赖图谱 +
> 优先级分级 + 开发 Todo 清单 + 多版本迭代规划 + 功能边界约束」。
> 内置 **DeepSeek V4 Pro + V4 Flash 双模型分层路由**，按需求复杂度精准控 Token。

---

## 1. 安装与挂载

本技能以**完全隔离的增量方式**挂载在工作区技能根：

```
C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\skills\web-task-split\
```

- OpenClaw 技能加载 **precedence #1（workspace skills）**，无需任何配置文件改动；
- `skills.load.watch=true` 默认开启 → 文件落地后**自动热重载**，不重启全局服务；
- 未触碰角色配置、Token 缓存、全局优化参数、WebUI 部署配置。

**零依赖**：5 个脚本纯 Python 标准库（本机 Python 3.14）。

---

## 2. 快捷指令

| 指令 | 场景 | 锁定模型 | 输出特征 |
|---|---|---|---|
| `/task-split-full` | 大型复合 / 多模块联动 / 多版本排期 | deepseek-v4-pro | 结构化需求+依赖图+优先级+多版本+完整Todo+边界约束 |
| `/task-quick` | 单点功能 / 小优化 / 短需求 | deepseek-v4-flash | 单层拆分+极简Todo（省Token） |

自动触发关键词：`需求拆解 开发任务 迭代规划 功能拆分 开发清单 模块划分 版本排期 开发计划 功能边界梳理`

**优先级**：手动指令 > 自动判定（强制覆盖）。

---

## 3. 使用教程

### 3.1 统一入口（推荐）
```bash
cd skills/web-task-split/scripts

# 完整项目级深度拆解（PRO）
python todo_iter_generator.py ../tests/full_complex_webui_req.txt --input "/task-split-full"

# 极速单点拆分（FLASH）
python todo_iter_generator.py ../tests/simple_single_func_req.txt --input "/task-quick"

# 自动路由（按需求复杂度自动选模型）
python todo_iter_generator.py ../tests/full_complex_webui_req.txt

# 批量多需求文件
python todo_iter_generator.py ../tests/full_complex_webui_req.txt ../tests/simple_single_func_req.txt

# 机读 JSON
python todo_iter_generator.py ../tests/simple_single_func_req.txt --json
```

### 3.2 单模块独立调用
```bash
python req_struct_parser.py ../tests/full_complex_webui_req.txt        # 仅结构化需求
python model_router_dispatch.py ../tests/full_complex_webui_req.txt    # 仅路由决策
python module_split_analyzer.py ../tests/full_complex_webui_req.txt    # 仅模块拆分+优先级
python scope_limit_checker.py ../tests/full_complex_webui_req.txt      # 仅边界/防过度开发
```

### 3.3 在对话中使用
直接粘贴需求 + 斜杠指令或关键词：
- `/task-quick` + 一句小需求 → FLASH，极简 Todo；
- `/task-split-full` + 一大段迭代需求 → PRO，完整规划。
- 不带指令时按复杂度（需求点数/跨层数/是否多版本/是否多人）自动路由。

---

## 4. 六大能力

1. **需求结构化拆解** — 清洗口语寒暄，标准化为：业务目标/用户场景/输入输出约束/交互规则/依赖服务/验收标准。
2. **业务模块智能拆分** — 按 前端页面/后端接口/模型调度/存储配置/工具脚本 5 层切割，区分独立 vs 联动。
3. **优先级自动排序** — P0 核心必做 / P1 次要迭代 / P2 优化体验 / P3 远期规划。
4. **标准化 Todo 清单** — 每条标注 模块/层/优先级/依赖/开发范围/验收标准，可直接当开发待办。
5. **迭代版本规划** — 按优先级切里程碑（MVP→完善→优化→Backlog），避免一次堆砌失控。
6. **功能边界 & 防过度开发** — 明确本期 in-scope / out-of-scope，扫描多账号/付费/云端等范围蔓延信号并预警。

---

## 5. 工程价值
- **前置规避盲目编码**：先规划后开发，需求模糊→结构清晰。
- **防过度开发**：P3 显式排除 + YAGNI 约束，避免范围蔓延。
- **降本**：简单需求走 Flash 压缩输出，复杂项目才上 Pro，按需分配 Token。
- **零侵入**：纯标准库、热重载，不影响存量 WebUI / 模型服务 / 缓存。

---

## 6. 验证命令
```bash
# ① 技能注册校验
openclaw skills list | grep web-task-split

# ② 极速拆分
python skills/web-task-split/scripts/todo_iter_generator.py skills/web-task-split/tests/simple_single_func_req.txt --input "/task-quick"

# ③ 完整项目拆解
python skills/web-task-split/scripts/todo_iter_generator.py skills/web-task-split/tests/full_complex_webui_req.txt --input "/task-split-full"
```
