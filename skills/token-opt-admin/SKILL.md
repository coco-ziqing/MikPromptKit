---
name: token-opt-admin
description: "Token消耗预估、缓存命中率、token优化、token检查、配置诊断：跑只读审计脚本拿真实用量与缓存命中数据，定位冷启动重算/前缀断裂/模型选型三类成本根因，输出可回滚的增量配置方案。手动指令 /token-check（只读健康巡检）/token-opt（诊断+优化方案）。"
version: 1.1.0
homepage: ""
metadata:
  {
    "openclaw":
      {
        "emoji": "🪙",
        "id": "token-opt-admin",
        "zh_name": "DeepSeek Token 配置运维Skill",
        "lazy_load": true,
        "slash_commands":
          [
            { "cmd": "/token-check", "desc": "只读健康巡检：跑审计脚本 + 判读 8 段指标，不改任何配置" },
            { "cmd": "/token-opt", "desc": "诊断 + 优化方案：归因根因，出增量 patch 方案，人工确认后才写配置" },
          ],
        "auto_keywords":
          ["token消耗预估","缓存命中率","token优化","token检查","配置诊断","上下文缓存"],
      },
  }
---

# DeepSeek Token 配置运维 (token-opt-admin)

## 角色定位
- 专属技能：Token 用量诊断 + 配置优化方案，服务于**降低真实花费**，不是刷指标
- 挂载位置：Cache Boundary 动态下层（不侵入静态可缓存区）
- 触发方式：用户指令 `/token-check` `/token-opt`，或上述自动关键词

## 执行环境（先读，必踩坑）

| 项 | 值 |
|---|---|
| 解释器 | `C:\Users\admin\AppData\Local\Python\bin\python.exe`（Python 3.14.3） |
| ⚠️ 不要用 | PATH 里的 `python` —— 指向 WindowsApps store stub，**exit 9009，静默失败** |
| 工作目录 | `C:\Users\admin\prompt-tool-dev`（脚本用相对路径 `tools\token_audit.py`） |
| 数据源 | `C:\Users\admin\.openclaw\agents\<agent>\agent\openclaw-agent.sqlite` → `transcript_events`，只读 |
| 计价 | 脚本内置 DeepSeek 官方价目（USD/1M）；peak = 周一至周五 UTC 01:00-04:00 / 06:00-10:00 |

本技能**没有自己的可执行入口**，唯一执行体是 `tools\token_audit.py`（只读、零 token 成本）。任何"调用某某 API 拿 stats"的写法都不要照抄。

## 执行流程

### Phase 1：取数（只读）

```powershell
cd C:\Users\admin\prompt-tool-dev
& C:\Users\admin\AppData\Local\Python\bin\python.exe tools\token_audit.py prompt-tool-dev
```

传 `agent` 名可指定对象（`main` / `dev` / `frontend` / `ship` / `mikprompt`），不传则全 agent 汇总。
输出 8 段：`[1]` 各 agent 汇总 · `[2]` 总量与成本结构 · `[3]` 按模型 · `[4]` 单次 prompt 规模 · `[5]` 缓存失效分布 · `[6]` 按天 · `[7]` 最贵会话 Top10 · `[8]` 输出/推理占比。
完成判据：拿到 `[3]` 的模型分布与 `[5]` 的 miss 分布两组数字。

### Phase 2：判读（对照真实基线，不是拍脑袋阈值）

| 指标 | 现状基线（2026-09-16 实测） | 关注点 |
|---|---|---|
| 缓存命中率 | 98.47% | 已在极高位，**再优化空间极小**，别把"命中率>85%"当验收线 |
| 成本结构 | cache读 48.8% / 未命中输入 37.2% / 输出 14.0% | 真正的大头是**未命中输入** |
| 未命中 >5 万的调用 | 116 次（1.3%）占历史成本 29.3% | 长会话隔夜冷启动整段重算 = 第一优先级 |
| 单次 prompt | 中位 203,323 · 均值 234,218 · max 707,384 | 与 `contextWindow` 上限强相关 |
| 模型 | v4-pro 2902 次 $33.77 vs flash 5794 次 $13.32 | 选型错配是最大单点成本 |

归因三分类，只走这三条：
1. **模型选型错配** → 交互 agent 是否在跑 pro（`[3]`）
2. **冷启动重算** → `[5]` 里 miss > 5万 的占比，`[7]` 找具体会话
3. **前缀断裂** → 会话中途改配置 / 中途换模型 / 工具输出塞进前缀

### Phase 3：出方案（人工确认后才写）

- 单点改：`openclaw config set <dot.path> <value>`（内部增量合并，不需重启网关）
- 批量改：`openclaw config patch --file ./patch.json5 --dry-run` 先验，再去掉 `--dry-run` 落盘
- **禁止**整文件覆盖写 `openclaw.json`（会丢 agents/tools/bindings）
- 方案必须给出：预期省多少、怎么回滚（原值 + 回滚命令）

### Phase 4：验证与报告

- [ ] 写出方案和回滚命令
- [ ] 报告写清"改前 → 改后"，不留"预计节省 XX%"这种无据数字
- [ ] 变化要等 **≥1 天**后重跑 `tools/token_audit.py` 才判断得出来，不看单会话

## 编程约束

| # | 规则 | 违反后果 |
|---|------|---------|
| 1 | 禁止整文件覆盖 `openclaw.json` | 丢失所有 agents/tools/bindings 配置 |
| 2 | `skills.lazy_load` 必须保持 `true` | 每次会话都注入完整上下文 |
| 3 | 不侵入静态可缓存区（agents / memory / openclaw.json 前缀段） | 破坏前缀缓存，命中率暴跌 |
| 4 | 默认用 flash；**只有用户显式要求**才切 pro | 优化 token 却在 pro 上跑诊断，自相矛盾 |
| 5 | 增量 patch + dry-run 先验 | 配置损坏无法回滚 |

> 约束 4 说明：本技能 v1.0.0 曾写"复杂诊断强制 pro"、/token-opt 锁 pro。因全局默认模型已于 2026-09-16 切为 flash，该规则改为默认 flash、pro 仅按需显式升级。

## 调用示例

```
/token-check
→ 跑 tools/token_audit.py，只读回报：
  ✅ 命中率 98.47%（高位，无优化空间）
  ⚠️ 未命中>5万 的调用占历史成本 29.3% → 建议跨天开新会话
  ✅ 当前配置无异常，不建议改动

/token-opt prompt-tool-dev
→ 归因 + 方案（不落盘）：
  📊 根因1：v4-pro 占真实成本 72%，交互 agent 应走 flash
  📊 根因2：冷启动重算集中在长会话隔夜后
  ⚡ 方案：config set agents.defaults.model.primary deepseek/deepseek-v4-flash
  ↩️ 回滚：openclaw config set agents.defaults.model.primary deepseek/deepseek-v4-pro
  等确认后执行
```

## 禁止引用（v1.0.0 遗留的虚构内容，已废）

`/api/v3/tokens/optimize/{id}`、`deepseek://api/v1/sessions/{id}/stats`、`read_config()`、`get_session_stats(model=)`、`diagnostic_run()`、`await config.patch(delta=, dry_run=)` —— 这些接口在 OpenClaw 里**都不存在**。另：`SPELL.md` 已废弃，内容和旧机器路径（`C:/Users/ASUS/...`）都不可用，不要再读。

## 版本记录
- v1.0.0 (2026-06-22): 初始技能包（含虚构 API 与示意性伪代码）
- v1.1.0 (2026-09-16): 对齐真实工具链（`tools/token_audit.py`）；写入真实解释器绝对路径与 9009 坑；阈值改为实测基线；路由默认 flash；标注并废弃伪造 API 与 SPELL.md
