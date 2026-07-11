# Phase22 — 项目管理架构重构方案
# 日期: 2026-07-11

## 新表设计

### 1. master_project（总项目 — 顶层容器）
```sql
CREATE TABLE master_project (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,              -- 项目名称
    description  TEXT DEFAULT '',             -- 项目描述
    project_type TEXT DEFAULT 'short_film',   -- 类型: short_film/ad/mv/tutorial/other
    aspect_ratio TEXT DEFAULT '16:9',         -- 默认画幅
    resolution   TEXT DEFAULT '4K',            -- 默认分辨率
    status       TEXT DEFAULT 'draft',         -- draft/in_progress/review/completed
    cover_image  TEXT DEFAULT '',              -- 封面图路径
    created_at   TEXT DEFAULT (datetime('now','localtime')),
    updated_at   TEXT DEFAULT (datetime('now','localtime'))
);
```

### 2. master_sub_project（子项目 — 桥接总项目↔seedance项目）
```sql
CREATE TABLE master_sub_project (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    master_project_id INTEGER NOT NULL,        -- 所属总项目
    seedance_project_id INTEGER,               -- 关联的 seedance user_project（可为空，先建壳）
    name              TEXT NOT NULL,            -- 子项目名称（如"第一幕·相遇"）
    sub_type          TEXT DEFAULT 'storyboard', -- storyboard/asset_only
    description       TEXT DEFAULT '',
    sort_order        INTEGER DEFAULT 0,
    created_at        TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (master_project_id) REFERENCES master_project(id) ON DELETE CASCADE,
    FOREIGN KEY (seedance_project_id) REFERENCES user_project(id) ON DELETE SET NULL
);
```

### 3. master_asset（资产 — 统一管理文稿/角色/场景/词卡）
```sql
CREATE TABLE master_asset (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    master_project_id INTEGER NOT NULL,         -- 所属总项目（全局资产）
    sub_project_id    INTEGER,                  -- 可选：关联到特定子项目
    asset_type        TEXT NOT NULL,             -- script/character/scene/prompt_template/ref_image
    name              TEXT NOT NULL,             -- 资产名称
    description       TEXT DEFAULT '',           -- 详细描述
    content           TEXT DEFAULT '',           -- 文本内容（剧本/提示词等）
    image_path        TEXT DEFAULT '',           -- 图片路径
    tags              TEXT DEFAULT '',           -- JSON标签
    word_card_id      INTEGER,                  -- 关联词卡（模板类）
    sort_order        INTEGER DEFAULT 0,
    created_at        TEXT DEFAULT (datetime('now','localtime')),
    updated_at        TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (master_project_id) REFERENCES master_project(id) ON DELETE CASCADE,
    FOREIGN KEY (sub_project_id) REFERENCES master_sub_project(id) ON DELETE SET NULL
);
```

### 4. 现有表改造（project_columns/project_tasks/project_milestones）
```sql
-- 将 project_id 从指向 user_project 改为指向 master_project
-- 方案A: 新建列 master_project_id，渐进迁移
-- 方案B: 直接改外键（风险大）
-- 推荐方案A: 保持向后兼容
ALTER TABLE project_columns ADD COLUMN master_project_id INTEGER;
ALTER TABLE project_tasks ADD COLUMN master_project_id INTEGER;
ALTER TABLE project_milestones ADD COLUMN master_project_id INTEGER;
```

---

## AIGC 制作流程映射

```
总项目创建
  │
  ├─ [1] 📝 文稿阶段
  │   ├── 创建 script 类资产（剧本/大纲/旁白）
  │   └── AI辅助：文本优化、翻译、扩写
  │
  ├─ [2] 👤 角色设定阶段
  │   ├── 创建 character 类资产
  │   ├── AI生成角色外观描述
  │   └── 关联参考图
  │
  ├─ [3] 🌍 场景设定阶段
  │   ├── 创建 scene 类资产
  │   ├── AI生成场景氛围描述
  │   └── 场景概念图
  │
  ├─ [4] 📋 词卡模板阶段
  │   ├── 创建 prompt_template 类资产
  │   └── 关联已有词卡库（word_card）
  │
  ├─ [5] 🎬 分镜段落（子项目）
  │   ├── 创建 master_sub_project（storyboard 类型）
  │   ├── 关联 seedance 分镜项目
  │   ├── 每个子项目内：镜头构图 → 提示词 → AI出图 → AI出视频
  │   └── 看板/甘特图/里程碑 → 追踪每个段落的进度
  │
  └─ [6] 🎯 导出/交付
      ├── 汇总各段落成片
      ├── 导出项目报告
      └── 归档
```

---

## 前端布局改造（三栏→两栏响应式）

```
┌──────────┬──────────────────────────────────────┐
│ 📦 总项目  │  [📝文稿] [👤角色] [🌍场景] [📋模板] [🎬分镜] │
│          │──────────────────────────────────────│
│ ├ 子项目A │                                      │
│ │ ├ 镜头1 │  ← 点击标签切换右侧内容面板              │
│ │ ├ 镜头2 │                                      │
│ │ └ ...   │  [资产卡片网格 / 分镜导航 / 进度看板]    │
│ ├ 子项目B │                                      │
│ └ 子项目C │                                      │
└──────────┴──────────────────────────────────────┘
```

---

## 实施分阶段计划

| Phase | 内容 | 预估 |
|-------|------|------|
| P22.1 | 新表建表 + 迁移脚本 + 旧数据兼容 | ~30min |
| P22.2 | 总项目 CRUD API + 子项目管理 API | ~30min |
| P22.3 | 资产面板 API + 资产 CRUD | ~20min |
| P22.4 | 前端三栏布局 + 项目树 + 标签导航 | ~40min |
| P22.5 | 资产卡片渲染 + 文稿/角色/场景/模板面板 | ~30min |
| P22.6 | 子项目↔seedance 联动 + 流程导航 | ~30min |
| P22.7 | 联调测试 + 打tag | ~20min |

---

⚠️ **关键决策点**：
1. 现有 PM 插件数据（project_columns/tasks/milestones）是迁移到 master_project 还是保持双轨？
   → 建议：渐进迁移，先建 master_project 壳，旧数据保留不动
2. 子项目和 seedance 项目的关系是 1:1 还是 1:N？
   → 建议 1:1（每个子项目对应一个 seedance 分镜项目），简单清晰
3. 资产是全局的还是按子项目隔离？
   → 建议：默认全局可见，可标记关联子项目（master_asset.sub_project_id 可空）
