---
name: code-review-audit
description: "标准化代码审查：多维度审计语法规范、业务逻辑、性能瓶颈、安全漏洞、可维护性、边界异常，输出结构化评审报告 + 可直接复制修复代码，支持单文件/多文件diff/PR变更片段评审。双模型分层路由控Token。触发词：代码审查、代码评审、code review、检查漏洞、安全审计、代码规范、PR评审、diff校验、重构建议、找bug、风险点排查。手动指令 /code-review-full（全维度审计）/code-review-quick（快速规范检查）。"
version: 1.0.0
homepage: ""
metadata:
  {
    "openclaw":
      {
        "emoji": "🔎",
        "id": "code-review-audit",
        "zh_name": "标准化代码审查Skill",
        "lazy_load": true,
        "requires": { "bins": ["python"] },
        "slash_commands":
          [
            { "cmd": "/code-review-full", "desc": "完整6维度深度审计（锁定 deepseek-v4-pro）" },
            { "cmd": "/code-review-quick", "desc": "轻量规范检查（锁定 deepseek-v4-flash）" },
          ],
        "auto_keywords":
          ["代码审查","代码评审","code review","检查漏洞","安全审计","代码规范","PR评审","diff校验","重构建议","找bug","风险点排查"],
      },
  }
---

# code-review-audit — 标准化代码审查

## 技能元数据
| 字段 | 值 |
|------|-----|
| name | `code-review-audit` |
| version | v1.0.0 (2026-06-22) |
| description | 多维度标准化代码审查：语法规范、业务逻辑、性能瓶颈、安全漏洞、可维护性、边界异常。输出结构化评审报告 + 可直接复制修复代码。支持单文件/多文件diff/PR变更片段评审 |
| user-invocable | true — 支持 `/code-review-full` `/code-review-quick` |
| bound | dynamic — Cache Boundary 动态下层 |
| lazy_load | true — 非匹配任务 0 Token注入 |

## 意图触发规则

### 自动匹配关键词
| 关键词 | 动作 | 路由 | Token预算 |
|--------|------|------|-----------|
| 代码审查、代码评审、code review、检查漏洞、安全审计、代码规范、PR评审、diff校验、重构建议、找bug、风险点排查 | 完整6维度深度审计 | **deepseek-v4-pro** | <8000 output |
| 代码格式检查、语法检查、性能优化提示、代码风格 | 轻量规范检查 | **deepseek-v4-flash** | <2000 output |
| `/code-review-full` | 强制全维度审计 | deepseek-v4-pro | <8000 output |
| `/code-review-quick` | 强制快速规范检查 | deepseek-v4-flash | <2000 output |

### 非匹配行为
- skills.lazy_load=true → 不匹配时 0 字节注入
- 仅 config.json 中 1 行 entry 解析 ≈ 3 tokens

---

## 6大维度分层评审流水线

### Step 0: 预处理过滤
- 剔除冗余注释、空行、print/console.log调试语句
- 裁剪超长工具返回日志（首尾各保留100行）
- 保留核心：业务逻辑、API路由、数据库操作、权限校验、循环/分支

### Step 1-6: 逐维评审（不可漏项）

```
▲ 维度1: 语法与编码规范
  · 对应语言规范 (Python→PEP8, JS→ESLint, Go→GoLint)
  · 命名规范 (变量/函数/类/常量)
  · 缩进一致性、行长度、空格使用
  · 魔法数字/字符串 → 应提取为常量
  · import/require 顺序与未使用导入

▲ 维度2: 业务逻辑缺陷
  · 分支遗漏 (if-else/switch 不缺分支)
  · 条件判断错误 (== vs ===、边界值)
  · 参数传递异常 (类型不匹配、空值未处理)
  · 状态流转bug (非法状态转换)
  · 重复逻辑/冗余实现

▲ 维度3: 性能隐患
  · N+1查询 / 循环内数据库调用
  · 无索引查询 / 全表扫描
  · 频繁IO操作 (循环内文件读写/网络请求)
  · 内存泄漏 (事件监听未移除、闭包引用)
  · 重复计算 (未缓存/未memoize)
  · 大数据量操作未分页

▲ 维度4: 安全高危漏洞 (强制评审,不可跳过)
  · SQL注入 (拼接字符串→参数化查询)
  · XSS (innerHTML→textContent/DOMPurify)
  · 未鉴权API接口
  · 敏感信息明文 (密钥/密码硬编码)
  · 越权访问 (无权限校验)
  · 输入未校验/未转义
  · 文件上传未限制类型/大小
  · CSRF/XSRF Token缺失

▲ 维度5: 可维护性
  · 函数过长 (>50行需拆分)
  · 模块耦合严重 (循环依赖)
  · 缺少关键注释 (复杂算法/业务规则)
  · 硬编码配置 (URL/密钥/阈值)
  · 重复代码块 (应抽取公共函数)
  · 无单元测试覆盖

▲ 维度6: 边界异常
  · 空值/NULL/undefined 未处理
  · 数组越界/索引负值
  · 数字溢出/除零
  · 超时未处理 (网络/DB)
  · 并发冲突 (race condition)
  · 异常捕获缺失 (空catch/过宽catch)
  · 错误码/错误消息不完整
```

---

## 风险分级标准

| 等级 | 标识 | 含义 | 示例 |
|------|------|------|------|
| 🔴 **阻断** | CRITICAL | 必须修复，阻止合并 | SQL注入、未鉴权API、XSS、密钥硬编码 |
| 🟡 **高危** | HIGH | 强烈建议修复 | N+1查询、内存泄漏、越权、空值崩溃 |
| 🟠 **中危** | MEDIUM | 建议修复 | 函数过长、硬编码配置、缺少异常处理 |
| 🟢 **低危** | LOW | 可选优化 | 命名不规范、缺少注释、魔法数字 |

---

## 结构化输出模板（固定格式）

```markdown
# 代码审查报告 — {文件名/PR标题}

> 审查技能: code-review-audit v1.0.0 | 路由: deepseek-v4-pro
> 路径: {file_path} | 语言: {lang} | 行数: {lines}
> 时间: {timestamp} | 耗时: {duration}s

## 📊 综合评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 语法规范 | {score}/10 | {brief} |
| 业务逻辑 | {score}/10 | {brief} |
| 性能 | {score}/10 | {brief} |
| 安全 | {score}/10 | {brief} |
| 可维护性 | {score}/10 | {brief} |
| 边界异常 | {score}/10 | {brief} |
| **总分** | **{avg}/10** | {verdict} |

## 🔴 阻断级风险 (CRITICAL)
| # | 位置 | 问题 | 影响 | 修复代码 |
|---|------|------|------|---------|
| 1 | L{line} | {desc} | {impact} | ```{lang}\n{fixed_code}\n``` |

## 🟡 高危风险 (HIGH)
...

## 🟠 中危风险 (MEDIUM)
...

## 🟢 低危建议 (LOW)
...

## 💡 全局优化建议
- {arch_suggestion_1}
- {arch_suggestion_2}

## 🧪 单元测试补充建议
- {test_suggestion}

## 📋 修复优先级排序
1. 🔴 {critical_1} — L{line}
2. 🔴 {critical_2} — L{line}
3. 🟡 {high_1} — L{line}
...
```

---

## Token节流策略

| 策略 | 说明 |
|------|------|
| 代码分段 | 单次注入代码 ≤ 24K tokens，超长文件分批评审 |
| 日志裁剪 | 工具输出 >500行 → 首尾100行 |
| 会话压缩 | 超过3轮的审查自动摘要前文，保留本次完整上下文 |
| 模型分流 | 简单规范→flash(快70%)，安全/逻辑→pro(质量优先) |
| 不记录 | 审查结果不持久化到workspace，纯输出到对话 |

---

## 编程约束

| # | 规则 | 后果 |
|---|------|------|
| 1 | 绝对不能修改被审查的源文件 | 只读评审，不改写 |
| 2 | 安全维度(维度4)在任何评审中都不可跳过 | 漏判SQL注入/XSS等严重漏洞 |
| 3 | 多文件评审/安全审计 → 强制 deepseek-v4-pro | flash可能漏判高危漏洞 |
| 4 | 输出固定7段结构化报告 | 可读性+AI友好 |
| 5 | 修复代码必须可直接复制替换 | 不准伪代码/省略号 |
| 6 | 不输出超长完整源码原文 | 仅引用关键行号+片段 |
| 7 | 不分析二进制/图片/视频 | 跳过非文本 |

---

## Cache Boundary 隔离

```
📦 静态可缓存区 (禁止修改)
├── IDENTITY.md / AGENTS.md / SOUL.md / USER.md / TOOLS.md
└── openclaw.json (仅增量patch)

💾 Cache Boundary 动态下层 (本技能挂载点)
├── skills/code-review-audit/SKILL.md      ← 仅匹配意图时注入
└── skills/code-project-analyze/SKILL.md   ← 源码分析(独立技能,不冲突)
```

---

## 调用示例

```
用户: /code-review-full backend/api/cards.py
  或: 帮我审查这段代码的安全漏洞
      [粘贴代码]

Agent: [代码审查 - deepseek-v4-pro]
  📄 backend/api/cards.py (752行, Python)
  🔍 审查中...
  维度1/6: 语法规范 → 7/10
  维度2/6: 业务逻辑 → 8/10
  维度3/6: 性能隐患 → 6/10 ⚠️ 发现N+1查询
  维度4/6: 安全漏洞 → 9/10
  维度5/6: 可维护性 → 7/10
  维度6/6: 边界异常 → 8/10
  📊 总分: 7.5/10

  [完整结构化报告输出]
```

## 版本记录
- v1.0.0 (2026-06-22): 初始技能包，6维度分层评审+4级风险分类+结构化修复代码输出
