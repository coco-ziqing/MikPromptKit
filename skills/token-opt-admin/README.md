# token-opt-admin - DeepSeek Token 配置自动运维 Skill

> 诊断Token用量/缓存命中率，生成懒加载与配置优化方案。双模型分层路由控Token。
> 以对话+斜杠指令调用为主。

## 快捷指令
| 指令 | 场景 | 锁定模型 |
|---|---|---|
| /token-opt | 深度诊断+优化方案 | deepseek-v4-pro |
| /token-check | 健康快查(只读) | deepseek-v4-flash |

自动关键词：token消耗预估 缓存命中率 token优化 token检查 配置诊断

## 使用方式
输入 /token-check 触发轻量巡检（只读，不改配置）；输入 /token-opt 触发深度诊断+优化方案。
本技能以对话+斜杠指令调用为主，无独立命令行入口。
