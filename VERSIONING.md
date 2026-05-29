# PromptKit 版本管理指南

## 仓库结构
```
本地仓库:  C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev
备份仓库:  C:\Users\ASUS\.openclaw\workspace\.backup\prompt-tool-dev.git
```

## 分支策略
| 分支 | 用途 | 说明 |
|------|------|------|
| `master` | 稳定发布版 | 只允许合并 → 打 tag |
| `dev` | 开发迭代 | 日常开发分支 |

## 版本号规则
```
v3.0.0          ← 当前版本
  │││
  ││└── patch（修复/小优化，如 v3.0.1）
  │└── minor（新功能，如 v3.1.0）
  └── major（重大重构，如 v4.0.0）
```

## 迭代工作流

### 1. 开始新功能迭代
```bash
git checkout dev
git commit -m "wip: 功能描述"
```

### 2. 完成并发布
```bash
git checkout master
git merge dev
git tag -a v3.1.0 -m "v3.1.0 — 功能说明"
git push backup master --tags
```

### 3. 回退到旧版本
```bash
git checkout tags/v3.0.0    # 查看旧版本
git checkout -b hotfix/v3.0.1  # 基于旧版本修 bug
```

### 4. 查看历史
```bash
git log --oneline --decorate --graph
git tag -l                    # 列出所有版本
```

## 备份同步
自动推送至本地备份仓库 `backup` remote：
```bash
git push backup --all --tags
```

## 忽略规则 (`.gitignore`)
不纳入版本管理的文件：
- `data/` — 运行时数据库 + 上传的缩略图/原图/视频
- `memory/.dreams/` — OpenClaw 梦境状态
- `fix_*.py / check_*.py` — 一次性修复脚本
- `.openclaw/` — 运行时配置
- `开发需求/` — 需求文档（非源码）
