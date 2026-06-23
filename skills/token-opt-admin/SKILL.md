---
name: token-opt-admin
description: "DeepSeek Token 配置诊断与自动优化：诊断Token用量/缓存命中率，生成懒加载与配置优化方案，复杂诊断走 deepseek-v4-pro、轻量巡检走 deepseek-v4-flash，精准控Token消耗。触发词：token消耗预估、缓存命中率、token优化、token检查、配置诊断。手动指令 /token-opt（优化诊断+方案）/token-check（健康快速检查）。"
version: 1.0.0
homepage: ""
metadata:
  {
    "openclaw":
      {
        "emoji": "🪙",
        "id": "token-opt-admin",
        "zh_name": "DeepSeek Token 配置自动运维Skill",
        "lazy_load": true,
        "requires": { "bins": ["python"] },
        "slash_commands":
          [
            { "cmd": "/token-opt", "desc": "Token优化诊断 + 配置方案生成（锁定 deepseek-v4-pro）" },
            { "cmd": "/token-check", "desc": "Token健康状态快速检查（锁定 deepseek-v4-flash）" },
          ],
        "auto_keywords":
          ["token消耗预估","缓存命中率","token优化","token检查","配置诊断","上下文缓存"],
      },
  }
---

# DeepSeek Token 配置自动运维 (token-opt-admin)

## 角色定位
- 专属技能：Token配置诊断与自动优化
- 挂载位置：Cache Boundary 动态下层（不侵入静态可缓存区）
- 路由策略：复杂诊断 → deepseek-v4-pro，轻量巡检 → deepseek-v4-flash
- 触发方式：用户指令 /token-opt /token-check 或自动监控

## 触发规则

### 意图自动触发匹配
| 用户输入关键词 | 触发动作 | 路由模型 |
|---|---|---|
| `/token-opt {target}` | Token优化诊断 + 配置方案生成 | deepseek-v4-pro |
| `/token-check {target}` | Token健康状态快速检查 | deepseek-v4-flash |
| `token消耗预估` / `缓存命中率` | 实时Token用量诊断 | deepseek-v4-pro |
| 会话启动时自动巡检 | 轻量健康快照 | deepseek-v4-flash |

### 非匹配任务行为
- **lazy_load=true**: 非匹配任务不注入上下文
- 额外Token消耗控制: <1% 基准上下文
- 仅在匹配到上述关键词时加载

## 执行流程

### Phase 1: 健康诊断（自动/手动触发）
```python
# 步骤1: 读取当前config快照
config = read_config("openclaw.json")
baseHash = hash(config)

# 步骤2: 轻量巡检 (deepseek-v4-flash)
stats = await get_session_stats(model="deepseek-v4-flash")

# 步骤3: 深度诊断 (deepseek-v4-pro, 仅复杂场景)
if stats.anomaly_detected:
    full_report = await deep_diagnostic(model="deepseek-v4-pro")
```

### Phase 2: Token优化执行
```python
# 生成懒加载策略补丁
patch = {
    "skills.entries.token-opt-admin": {
        "enabled": True,
        "lazy_load": True,
        "max_context_tokens_per_nonmatch": 128
    }
}

# 增量合并（禁止全量覆盖）
apply_patch_delta(config_path, patch, dry_run=True)
```

### Phase 3: 验证与报告
- [ ] 缓存命中率 > 85%
- [ ] Token消耗 < 基准值 -15%
- [ ] 会话压缩率达标
- [ ] 懒加载策略生效

## 编程约束

| # | 规则 | 违反后果 |
|---|------|---------|
| 1 | 禁止全量覆盖 config.json | 丢失所有agents/tools/bindings配置 |
| 2 | skills.lazy_load 必须保持 true | 每次会话都注入完整上下文 |
| 3 | 不侵入静态可缓存区 | 破坏 Cache Boundary 前缀隔离 |
| 4 | 复杂操作强制 deepseek-v4-pro | 轻量模型无法完成诊断 |
| 5 | 增量patch优先，dry-run先验 | 配置损坏无法回滚 |

## Cache Boundary 隔离架构

```
📦 静态可缓存区 (禁止修改)
├── agents/              # 角色定义
├── memory/*.md          # 会话记忆
├── data/prompts.db      # 提示词数据
└── openclaw.json        # 主配置(仅增量patch)

💾 Cache Boundary 动态下层 (本技能挂载点)
└── session/cache/dynamic/
    └── token-opt-admin/
        ├── diagnostics/     # 诊断快照
        ├── patches/         # 增量补丁
        └── reports/         # 优化报告
```

## 调用示例

```
用户: /token-check prompt-tool-dev
Agent: [Token健康检查] 
  ✅ 缓存命中率: 94.2%
  ✅ 活跃会话: 3 running / 2 completed
  ✅ Token消耗趋势: 876 tokens/run (-45% vs baseline)
  🎯 建议: 当前配置最优，无需调整

用户: /token-opt main-agent
Agent: [Token优化诊断 - deepseek-v4-pro]
  🔍 深度分析中...
  📊 发现: 3个非活跃会话可压缩
  📊 缓存预热可节省 ~230 tokens/run
  ⚡ 已应用懒加载策略
  ✅ 优化完成，预估节省 27% Token消耗
```

## 版本记录
- v1.0.0 (2026-06-22): 初始技能包，Token诊断+优化+懒加载策略
