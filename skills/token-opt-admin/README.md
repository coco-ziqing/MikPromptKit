# token-opt-admin - DeepSeek Token 配置运维 Skill

> 跑只读审计脚本拿真实用量与缓存命中数据，定位冷启动重算 / 前缀断裂 / 模型选型三类成本根因，输出可回滚的增量配置方案。
> 以对话 + 斜杠指令调用为主，无独立命令行入口。

## 快捷指令
| 指令 | 场景 | 模型 | 是否写配置 |
|---|---|---|---|
| /token-check | 只读健康巡检 + 判读 8 段指标 | flash | 否 |
| /token-opt | 诊断归因 + 优化方案 | flash（用户显式要求才升 pro） | 人工确认后才写 |

自动关键词：token消耗预估 缓存命中率 token优化 token检查 配置诊断 上下文缓存

## 唯一执行体

```powershell
cd C:\Users\admin\prompt-tool-dev
& C:\Users\admin\AppData\Local\Python\bin\python.exe tools\token_audit.py prompt-tool-dev
```

只读、零 token 成本。**不要用 PATH 里的 `python`**（store stub，exit 9009 静默失败）。

## 目录说明
- `SKILL.md` —— 技能主体（流程 / 阈值基线 / 编程约束）
- `SPELL.md` —— 已废弃的早期草稿，仅作留档，不要据此执行
- `*.bak-*` —— 历史版本备份
