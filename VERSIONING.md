# PromptKit 版本管理指南

## 仓库结构
```
本地仓库:  C:\Users\admin\prompt-tool-dev\MikPromptKit
远端 origin: https://github.com/coco-ziqing/MikPromptKit.git
```

## 分支策略（2026-10-30 重置）
| 分支 | 用途 | 说明 |
|------|------|------|
| `master` | 发布主干 | 唯一长期分支，日常提交直接落在功能分支后合入 |
| `dev` | 集成镜像 | 与 master 保持同步，不再独立承载旧代码 |
| `feat/*` `fix/*` | 功能/修复分支 | 从 master 切出，完成后合回并删除 |

> 历史：旧 dev（v5.29.1）已归档为 tag `archive/dev-v5.29.1`，dev 已重置为跟随 master。
> 不再使用「dev 长期开发 → 合并 master 发布」的旧流程。

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
git checkout master && git pull --ff-only
git checkout -b feat/功能名
git commit -m "feat: 功能描述"
```

### 2. 完成并发布
```bash
git checkout master
git merge --no-ff feat/功能名
git tag -a v5.51.0 -m "v5.51.0 — 功能说明"
git push origin master --tags
git branch -f dev master && git push origin dev
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
远端 `origin` 即 GitHub 仓库，master / dev / tag 均推送至 origin：
```bash
git push origin master --tags
git push origin dev
```

## 忽略规则 (`.gitignore`)
不纳入版本管理的文件：
- `data/` — 运行时数据库 + 上传的缩略图/原图/视频
- `memory/.dreams/` — OpenClaw 梦境状态
- `fix_*.py / check_*.py` — 一次性修复脚本
- `.openclaw/` — 运行时配置
- `开发需求/` — 需求文档（非源码）
