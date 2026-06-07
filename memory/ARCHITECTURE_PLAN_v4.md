# PromptKit v4.0 — 架构升级规划方案

> 生成时间: 2026-06-07 15:15 (GMT+8)  
> 核心理念: **提示词卡作为整个系统的基础数据单元**

---

## 一、核心理念拆解

### 1.1 提示词卡 = 系统的原子单位

```
┌─────────────────────────────────────────┐
│           提示词卡 (Prompt Card)          │
├─────────────────────────────────────────┤
│  元数据：id, 名称, 创建时间, 版本号       │
│  内容：结构化字段 (主体/场景/构图/光影…)   │
│  媒体：缩略图, 原图, 关联视频, 音频       │
│  标签：tags, categories, models, modules │
│  资产引用：引用的词库条目 ID 列表          │
│  使用记录：复制次数, 关联项目, 收藏状态    │
└─────────────────────────────────────────┘
```

**设计原则：**
- 生图用提示词卡 = 生视频用提示词卡 = **同一结构**
- 区别仅在于输出类型标记 (`type: 'image' | 'video'`)
- 每张卡可独立编辑、搜索、收藏、导出
- 每张卡是各类高级操作的唯一输入单元

### 1.2 为什么需要结构化词卡而非纯文本

| 对比维度 | 纯文本提示词 | 结构化词卡 |
|---------|------------|-----------|
| 搜索精度 | 全文模糊匹配 | 按字段精准筛选 |
| 版本管理 | 无 | 版本号+变更记录 |
| 跨场景复用 | 手动复制粘贴 | 字段级组装 |
| AI 解析 | 依赖模型理解 | 字段明确可编程 |
| 组装能力 | 字符串拼接 | 结构化模板组合 |

---

## 二、竞品与参考项目分析

### 2.1 同类工具对比

| 项目 | 类型 | 优势 | 不足 |
|------|------|------|------|
| **PromptHero** | 提示词社区 | 高质量结构化标签、图片预览 | 商业闭源、无本地化 |
| **Lexica** | 搜索+生成 | 反向搜索能力强 | 仅图像领域、无视频 |
| **Langfuse** | 提示词管理 | 版本控制、团队协作 | 侧重 LLM、无媒体资产 |
| **Krea** | AI 创作平台 | 实时预览、风格迁移 | 重度依赖云端 |
| **YouMind** | 提示词库 | 跨模型、持续更新 | 无本地存储、只读 |

### 2.2 差异化定位

**PromptKit 的独特价值：**
- ✅ **本地优先** — 纯局域网，数据不上云
- ✅ **跨模态** — 生图 + 生视频统一管理
- ✅ **媒体资产管理** — 缩略图/原图/视频一体化
- ✅ **组装能力** — Seedance V2 组装器已验证可行性
- ✅ **可离线** — 无网络依赖

---

## 三、架构升级规划

### Phase 1: 提示词卡数据结构重构（核心）

#### 1.1 数据库表重构

```sql
-- 核心提示词卡表（替换旧 prompts 表）
CREATE TABLE prompt_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_type TEXT NOT NULL DEFAULT 'image',     -- 'image' | 'video'
    name TEXT DEFAULT '',
    content TEXT NOT NULL,                        -- 纯文本提示词（兼容旧数据）
    
    -- 结构化字段 (JSON)
    structured_fields TEXT DEFAULT '{}',          -- {"subject":"...","scene":"...","camera":"...","lighting":"...","motion":"..."}
    
    -- 标准元数据
    meaning TEXT DEFAULT '',                      -- 释义
    scene TEXT DEFAULT '',                        -- 使用场景
    module TEXT DEFAULT 'custom',                 -- 所属模块
    category TEXT DEFAULT '',                     -- 分类
    tags TEXT DEFAULT '[]',                       -- JSON 数组
    
    -- 版本控制
    version INTEGER DEFAULT 1,
    parent_card_id INTEGER REFERENCES prompt_cards(id),
    
    -- 引用关联
    library_refs TEXT DEFAULT '[]',              -- 引用的词库条目 JSON [{lib_id, card_id, field}]
    
    -- 使用统计
    usage_count INTEGER DEFAULT 0,
    favorite_count INTEGER DEFAULT 0,
    is_builtin INTEGER DEFAULT 0,               -- 内置种子数据标记
    is_deleted INTEGER DEFAULT 0,
    
    -- 时间线
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 媒体资产表（替换旧 thumbnails/originals 表）
CREATE TABLE media_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER REFERENCES prompt_cards(id),
    media_type TEXT NOT NULL,                   -- 'image' | 'video' | 'audio'
    file_path TEXT NOT NULL,
    thumbnail_path TEXT,                         -- 自动生成的缩略图
    file_size INTEGER,
    width INTEGER,
    height INTEGER,
    duration REAL,                               -- 视频/音频时长(秒)
    format TEXT,                                -- 'jpg' | 'png' | 'mp4' | 'webm'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 词库资产表（统一管理所有词库）
CREATE TABLE library_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lib_type TEXT NOT NULL,                      -- 'style' | 'negative' | 'camera' | 'subject' | 'scene' | ...
    name TEXT NOT NULL,
    icon TEXT DEFAULT '',
    category TEXT DEFAULT '',
    prompt TEXT DEFAULT '',                      -- 完整提示词
    tags TEXT DEFAULT '[]',
    usage_count INTEGER DEFAULT 0,
    is_builtin INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 1.2 结构化字段规范

```typescript
// 统一的提示词结构化字段
interface StructuredFields {
  // ===== 通用字段（生图/生视频共用）=====
  subject?: string;        // 主体
  scene_desc?: string;     // 场景
  lighting?: string;       // 光影
  color_grade?: string;    // 调色
  mood?: string;           // 情绪/氛围
  style?: string;          // 画风
  composition?: string;    // 构图
  texture?: string;        // 质感
  
  // ===== 生视频扩展字段 =====
  camera_move?: string;    // 运镜
  motion?: string;         // 动作
  speed?: string;          // 速率
  duration?: number;       // 时长
  focal_length?: string;   // 焦段
  perspective?: string;    // 视角
  depth_of_field?: string; // 景深
  particles?: string;      // 粒子
  weather?: string;        // 天气
  natural_force?: string;  // 外力
  environment_detail?: string; // 环境细节
  filter?: string;         // 滤镜
  film_flaw?: string;      // 瑕疵
  fantasy_physics?: string; // 奇幻物理
}
```

---

### Phase 2: 词库系统统一化

#### 2.1 当前问题

```
旧结构:
  prompts.db       ← 提示词+种子数据 (213条)
  seedance_styles.json    ← 画风词库 (8类58种)
  seedance_negative_prompts.json  ← 负面词库 (10类74条)
  Seedance V2 libraries ← 镜头词库 (API 管理)
  
问题: 4 个分散存储源, 管理逻辑不统一
```

#### 2.2 统一方案

```
新结构 (统一到数据库):
  library_assets 表
  ├── lib_type='style'      → 画风词库 (58条)
  ├── lib_type='negative'   → 负面词库 (74条)
  ├── lib_type='camera'     → 镜头语言 (20条)
  ├── lib_type='subject'    → 主体词库
  ├── lib_type='scene'      → 场景词库
  ├── lib_type='lighting'   → 光影词库
  ├── lib_type='composition' → 构图词库
  ├── lib_type='motion'     → 运动词库
  └── lib_type='custom'     → 自定义词库
```

#### 2.3 词库资产面板

```
[词库资产管理器]
├── 🎨 画风词库 (58)
├── 🚫 负面词库 (74)
├── 🎬 镜头语言 (20)
├── 🧑 主体词库
├── 🌄 场景词库
├── 💡 光影词库
├── 📐 构图词库
└── 🔧 自定义词库

功能:
  - 搜索/筛选
  - 预览（显示对应提示词）
  - 编辑/新增/删除
  - 批量导入/导出 JSON
  - 关联卡片统计
```

---

### Phase 3: 媒体资产管理统一化

#### 3.1 当前问题

```
旧结构:
  data/thumbnails/   ← 240x160 JPEG 缩略图 (287个)
  data/originals/    ← 原图 (236个, 418MB)
  data/videos/       ← 视频 (23个, 355MB)
  
问题: 3 个独立目录, 管理分离
```

#### 3.2 统一方案

```
新结构:
  data/media/
  ├── images/       ← 原图 (UUID命名)
  ├── thumbnails/   ← 自动生成的缩略图
  ├── videos/       ← 视频文件
  └── audio/        ← 音频文件 (新增)

  统一 media_assets 表管理所有文件引用
```

#### 3.3 媒体资产面板

```
[媒体资产管理器]
├── 📷 图片库 (236)  [网格/列表视图]
│   ├── 预览: 缩略图
│   ├── 关联卡片: 显示引用此媒体的提示词卡
│   └── 操作: 删除/下载/替换
├── 🎬 视频库 (23)
│   ├── 预览: 悬停播放/封面
│   ├── 时长/分辨率/大小
│   └── 操作: 裁剪/压缩/删除
└── 🎵 音频库 (新增)
```

---

### Phase 4: 高级功能重建

#### 4.1 提示词卡一致性系统

```
[一致性引擎]
├── 字段级校验
│   ├── 必填字段检查
│   ├── 字段类型校验
│   └── 引用完整性检查
├── 自动模板填充
│   ├── 从词库推荐匹配条目
│   ├── 智能补全缺失字段
│   └── 格式标准化
└── 批量一致性修复
    ├── 选中多张卡 → 统一字段格式
    ├── 批量添加/移除标签
    └── 批量关联词库条目
```

#### 4.2 搜索系统升级

```
[统一搜索引擎]
├── 全方位搜索
│   ├── 提示词内容 (全文搜索)
│   ├── 结构化字段 (按字段筛选)
│   ├── 媒体资产 (图片内容搜索)
│   ├── 词库条目
│   └── 语义搜索 (sentence-transformers)
├── 高级筛选器
│   ├── 卡片类型: 生图 / 生视频 / 全部
│   ├── 模块/分类
│   ├── 标签组合 (AND/OR)
│   ├── 媒体状态: 有图 / 有视频 / 无媒体
│   ├── 日期范围
│   └── 使用频率
└── 搜索结果
    ├── 统一卡片展示
    ├── 高亮匹配字段
    ├── 关联操作 (复制/收藏/编辑)
    └── 批量操作
```

#### 4.3 Seedance 组装器升级

```
[提示词组装器 v3]
├── 输入: 选择多张提示词卡
├── 流程:
│   ├── Step 1: 选定时序 (拖拽排序)
│   ├── Step 2: 每张卡映射到分镜
│   │   ├── 自动提取结构化字段
│   │   ├── 补全缺失字段（从词库推荐）
│   │   └── 添加运镜/转场
│   ├── Step 3: 全局参数配置
│   │   ├── 画幅/分辨率
│   │   ├── 全局画风/负面词
│   │   └── 总时长/转场
│   └── Step 4: 输出预览
│       ├── 文本提示词
│       ├── JSON 结构化数据
│       └── 导出到 LibTV / ComfyUI
└── 输出: 完整的视频提示词剧本
```

---

### Phase 5: 导入导出标准化

#### 5.1 包格式 (v2)

```typescript
// promptkit_package_v2.pkb (ZIP)
interface PackageV2 {
  manifest: {
    version: '2.0',
    name: string,
    description: string,
    created_at: string,
    card_count: number,
    media_count: number,
    library_count: number,
  },
  // 数据文件
  'data/prompt_cards.json': PromptCard[],
  'data/library_assets.json': LibraryAsset[],
  'data/media_assets.json': MediaAsset[],
  
  // 媒体文件
  'media/images/': File[],
  'media/thumbnails/': File[],
  'media/videos/': File[],
  
  // 可选高级数据
  'data/projects.json'?: Project[],
  'data/collections.json'?: Collection[],
}
```

#### 5.2 导出目标

| 目标平台 | 格式 | 字段映射 |
|---------|------|---------|
| LibTV | 纯文本 | `[header]` + `time: fields` |
| ComfyUI | JSON Workflow | 结构化字段 → ComfyUI 节点 |
| 标准 TXT | 纯文本 | `{style} {subject}, {scene}, {lighting}...` |
| Markdown | .md | 格式化的可读文档 |
| JSON 数据 | .json | 完整结构化数据 |

---

## 四、开发优先级

```
Phase 1 (核心) ⭐⭐⭐⭐⭐
├── prompt_cards 表设计 + 数据迁移脚本
├── structured_fields 规范 + API
├── 兼容旧数据（prompts 表）
├── 前端卡片组件重构
└── 版本控制基础

Phase 2 (词库) ⭐⭐⭐⭐
├── library_assets 表设计
├── JSON → SQLite 迁移脚本
├── 词库资产管理器 UI
└── 统一管理 API

Phase 3 (媒体) ⭐⭐⭐⭐
├── media_assets 表设计
├── 文件存储重构 (UUID命名)
├── 媒体资产面板 UI
└── 导入导出适配

Phase 4 (高级) ⭐⭐⭐
├── 一致性引擎
├── 搜索系统升级
├── 组装器 v3
└── 批量操作强化

Phase 5 (生态) ⭐⭐
├── 导入导出 v2
├── 多平台导出适配
└── API 文档
```

---

## 五、技术建议

### 5.1 数据库优化
- **WAL 模式**（已启用）
- **FTS6 全文索引**（当前 FTS5 已覆盖内容，需扩展至结构化字段）
- **视图层**：创建 `v_prompt_cards_full` 视图 JOIN 媒体和词库引用
- **迁移脚本**: 提供向后兼容的迁移路径

### 5.2 前端架构建议
- **卡片组件**: 统一 `<prompt-card>` 组件，支持 image/video 两种渲染模式
- **状态管理**: 当前 App.state 已够用，考虑引入 observable pattern
- **缓存策略**: Service Worker 缓存词库和媒体缩略图

### 5.3 性能关注点
- 媒体文件懒加载（虚拟滚动）
- 大图渐进式加载（先缩略图再原图）
- 视频封面帧缓存

---

## 六、参考资源

| 项目 | 可借鉴点 |
|------|---------|
| [Langfuse](https://langfuse.com) | 提示词版本管理、团队协作 |
| [PromptHero](https://prompthero.com) | 结构化标签、高质量预览 |
| [Lexica](https://lexica.art) | 反向搜索、跨模态 |
| [Krea](https://krea.ai) | 实时预览、风格迁移 |
| [YouMind](https://youmind.com) | 跨模型、持续更新 |
| [Hailuo AI Asset Library](https://hailuoai.video) | 角色一致性资产库 |

---

## 七、后续行动计划

1. **Phase 1 启动** — prompt_cards 表 + 迁移脚本 (1-2 天)
2. **旧数据兼容** — 确保现有 213 条提示词无缝迁移 (0.5 天)
3. **前端卡片组件统一** — 支持 image/video 双模式 (1 天)
4. **词库迁移** — 4 个分散源合并到数据库 (0.5 天)
5. **架构文档** — 输出完整 API 文档和数据结构规范

---

> 本方案基于 v3.10.30 现状 + 竞品调研 + 用户核心理念构建  
> 每次 Phase 完成需做 .pkb 全量备份  
> 下次会话优先执行 Phase 1
