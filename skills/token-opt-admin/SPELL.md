---
status: deprecated
deprecated_on: 2026-09-16
replaced_by: SKILL.md (v1.1.0)
---

# SPELL.md —— 已废弃

本文件是 token-opt-admin 技能早期的"施法"草稿，内容与真实环境不符，**不要再据此执行任何操作**。原件留在 `SPELL.md.bak-20260916-1913`。

## 为什么废弃

| 原文写法 | 实际情况 |
|---|---|
| `C:/Users/ASUS/.openclaw/openclaw.json` | 旧机器/旧用户名的路径，本机是 `C:\Users\admin\.openclaw\openclaw.json` |
| `/api/v3/tokens/optimize/{id}` | 该 HTTP 端点不存在 |
| `GET /api/v3/sessions/{id}/compress-status` | 该端点不存在 |
| `deepseek://api/v1/sessions/{id}/stats` | 臆造协议，不存在 |
| `await config.patch(path=..., delta=..., dry_run=True)` | 不存在此 JS API；真实用法是 CLI `openclaw config patch --file <f> --dry-run` |
| `diagnostic_run()` / `read_config()` / `get_session_stats(model=)` | 均为示意性伪代码，非可用接口 |
| "缓存命中率提升 > 15%" 等验收线 | 实测命中率已 98.47%，该指标失去区分度 |

## 现在的正确入口

读同目录 `SKILL.md`（v1.1.0）。唯一执行体是只读脚本：

```powershell
cd C:\Users\admin\prompt-tool-dev
& C:\Users\admin\AppData\Local\Python\bin\python.exe tools\token_audit.py prompt-tool-dev
```
