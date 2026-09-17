# code-review-audit - 标准化代码审查 Skill

> 6维度审计：语法规范/业务逻辑/性能/安全/可维护性/边界异常，输出结构化报告+可复制修复。
> 双模型分层路由控Token，与6技能矩阵同构。

## 快捷指令
| 指令 | 场景 | 锁定模型 |
|---|---|---|
| /code-review-full | 完整审计/PR/找bug | deepseek-v4-pro |
| /code-review-quick | 只看规范/格式 | deepseek-v4-flash |

自动关键词：代码审查 代码评审 code review 检查漏洞 安全审计 PR评审 diff校验 重构建议 找bug 风险点排查

## 使用教程
```bash
cd skills/code-review-audit/scripts
python review_runner.py ../tests/sample_review_target.py --input "/code-review-full"
python review_runner.py ../tests/sample_review_target.py --input "/code-review-quick"
python review_runner.py ../tests/sample_diff.patch
python review_runner.py ../tests/sample_review_target.py --json
```

## 能力->脚本
| 能力 | 脚本 |
|---|---|
| 6维度规则审计 | scripts/review_auditor.py |
| 双模型分层路由 | scripts/model_router_dispatch.py |
| 编排入口 | scripts/review_runner.py |
