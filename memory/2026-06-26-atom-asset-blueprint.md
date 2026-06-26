# 🧬 PromptKit v5.5 — 原子化提示词资产闭环体系 · 总体规划蓝图

> 生成时间: 2026-06-26 11:00 GMT+8  
> 核心理念: **提示词原子化词库作为全平台唯一数据基底，贯通录入→组装→归档→沉淀→迭代的完整资产沉淀闭环**

---

## 一、闭环全景架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                     📥 录入层 (Input Layer)                           │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌──────────────────┐   │
│  │ 手动录入  │  │ AI拆解   │  │ 批量导入  │  │ 使用过程自动采集  │   │
│  │(词卡CRUD)│  │(OCR+LLM) │  │(CSV/JSON) │  │(组装→复制→导出) │   │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘  └────────┬─────────┘   │
│       └──────────────┴──────────────┴───────────────┘              │
│                          │  MD5 去重                                │
│                          ▼                                          │
│              ┌───────────────────────┐                              │
│              │   atom_asset_library  │  ← 唯一原子资产库            │
│              │   (media_category +   │                              │
│              │    linked_type +      │                              │
│              │    source_tracking)   │                              │
│              └───────────┬───────────┘                              │
└──────────────────────────┼──────────────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────────────┐
│                     🏗️ 组装层 (Assembly Layer)                       │
│                          ▼                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Unified Composer                          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │   │
│  │  │ 角色模板  │  │ 场景模板  │  │ 镜头模板  │  │ 音频模板  │   │   │
│  │  │(Profile) │  │(Profile) │  │(Camera) │  │(Audio)  │   │   │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │   │
│  │       │ 智能匹配    │ 智能匹配    │ 智能匹配    │ 智能匹配   │   │
│  │       ▼            ▼            ▼            ▼            │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │          原子化词库自动填充引擎 (Atom Filler)       │   │   │
│  │  │  keywords → scan asset_library → rank → inject     │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  │                          │                                 │   │
│  │                          ▼                                 │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐     │   │
│  │  │ 图片生成  │  │ 视频生成  │  │ 多平台格式输出       │     │   │
│  │  │(SD/MJ)  │  │(Kling/   │  │(seedance/kling/      │     │   │
│  │  │          │  │ Seedance)│  │ minimax/comfyui/raw) │     │   │
│  │  └──────────┘  └──────────┘  └──────────────────────┘     │   │
│  └─────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────────────┐
│                     📤 归档层 (Archive Layer)                        │
│                          ▼                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                  组装产物归档与沉淀                          │   │
│  │                                                             │   │
│  │  ① 组装结果 → 查重(MD5) → 原子化拆解(decompose)             │   │
│  │  ② 新原子 → 去重比对(asset_library) → 入库(补充词库)        │   │
│  │  ③ 旧原子 → 更新 usage_count + combo_count                  │   │
│  │  ④ 死码检测 → 低热度原子标记 → 降权/归档                    │   │
│  │  ⑤ 版本管理 → 每次组装记录快照 → 可回滚                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                          │                                          │
│                          ▼                                          │
│              ┌───────────────────────┐                              │
│              │   atom_asset_library  │  ← 资产持续增长              │
│              │   (迭代补充 ↑)       │                              │
│              └───────────────────────┘                              │
└──────────────────────────────────────────────────────────────────┘
                           │
                           ▼
              ┌───────────────────────┐
              │   🔄 循环回到组装层    │
              │   (下一次组装使用更   │
              │    丰富的原子库)      │
              └───────────────────────┘
```

---

## 二、数据层设计：四大原子域 + 两大媒体类别

### 2.1 核心表 `atom_asset_library`（新增）

```sql
CREATE TABLE IF NOT EXISTS atom_asset_library (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    atom_hash       TEXT    NOT NULL UNIQUE,          -- MD5(atom_text) 去重键
    atom_text       TEXT    NOT NULL,                 -- 原子文本（≤60字符）
    atom_type       TEXT    NOT NULL DEFAULT 'general', -- creative|style|composition|...
    
    -- ▸ 媒体类别（闭环核心分类）
    media_category  TEXT    NOT NULL DEFAULT 'image', -- 'image' | 'video' | 'both'
    
    -- ▸ 归属域（链接到四大模板体系）
    linked_type     TEXT    DEFAULT 'general',        -- 'character' | 'scene' | 'camera' | 'audio' | 'general'
    linked_id       INTEGER DEFAULT NULL,             -- character_profiles.id | scene_profiles.id
    
    -- ▸ 来源追踪（闭环溯源）
    source          TEXT    DEFAULT 'manual',         -- 'manual' | 'decompose' | 'usage_precipitate' | 'import'
    source_decompose_id INTEGER DEFAULT NULL,         -- 来自哪次AI拆解
    
    -- ▸ 质量与热度
    usage_count     INTEGER DEFAULT 0,
    combo_count     INTEGER DEFAULT 0,                -- 被组装使用的次数
    quality_score   REAL    DEFAULT 0,                -- AI评估分 0-1
    
    -- ▸ 状态标记
    is_active       INTEGER DEFAULT 1,                -- 1=活跃 0=死码归档
    is_verified     INTEGER DEFAULT 0,                -- 人工审核标记
    
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    updated_at      TEXT DEFAULT (datetime('now','localtime')),
    last_used_at    TEXT DEFAULT NULL
);

CREATE INDEX idx_aal_hash ON atom_asset_library(atom_hash);
CREATE INDEX idx_aal_media ON atom_asset_library(media_category);
CREATE INDEX idx_aal_linked ON atom_asset_library(linked_type, linked_id);
CREATE INDEX idx_aal_usage ON atom_asset_library(usage_count DESC);
CREATE INDEX idx_aal_source ON atom_asset_library(source, source_decompose_id);
```

### 2.2 四大原子域映射

| 原子域 | media_category | linked_type | linked_id 指向 | 典型 atom_type |
|--------|---------------|-------------|---------------|----------------|
| 🧑 角色原子库 | image/video | character | character_profiles.id | subject, style, action |
| 🏞️ 场景原子库 | image/video | scene | scene_profiles.id | lighting, color, atmosphere, composition |
| 🎥 镜头原子库 | video | camera | shot模板ID | camera, action, speed, focal_length |
| 🔊 音频原子库 | video | audio | character_profiles.id | (voice_type, bgm, sfx) |
| 📦 通用原子库 | both | general | NULL | quality, negative, constraint |

### 2.3 与现有表的桥接关系

```
atom_asset_library (新)          atom_word_bridge (已有)
┌──────────────────┐            ┌──────────────────┐
│ id               │◄───────────│ atom_hash        │
│ atom_hash (PK)   │            │ word_card_id     │──► word_card
│ atom_text        │            │ decompose_id     │──► atom_decompose
│ linked_type/id   │            └──────────────────┘
│ media_category   │
│ source_tracking  │            atom_stats (已有)
└──────────────────┘            ┌──────────────────┐
                                │ atom_id          │
character_profiles              │ text_hash ───────┤──► atom_asset_library.atom_hash
┌──────────────────┐            │ usage_count      │
│ id               │◄──linked_id│ combo_count      │
│ name, appearance │            └──────────────────┘
└──────────────────┘
```

---

## 三、闭环流程：从零到资产沉淀的完整链路

### 🔄 阶段 A：录入 (input)

```
触发方式:
  ├── 手动录入: word_card CRUD → 自动原子化 → atom_asset_library
  ├── AI拆解:   OCR/LLM decompose → atoms_json → 逐条入库
  ├── 批量导入: CSV/JSON/TXT → 逐行拆解 → 归档
  └── 使用采集: 组装/复制/导出时 → stats.track → 新原子自动沉淀

去重规则:
  atom_hash = MD5(atom_text + media_category)
  → UNIQUE 约束保证同文本不重复
  → 重复时仅 update usage_count + last_used_at
```

### 🔄 阶段 B：组装 (assemble)

```
用户选择:
  ┌──────────┐   ┌──────────┐   ┌──────────┐
  │ 角色模板  │   │ 场景模板  │   │ 镜头模板  │
  │(李明)    │   │(赛博朋克) │   │(推轨镜头) │
  └────┬─────┘   └────┬─────┘   └────┬─────┘
       │               │               │
       ▼               ▼               ▼
  ┌─────────────────────────────────────────┐
  │        Atom Filler 智能填充引擎          │
  │                                         │
  │ ① 提取模板关键词:                        │
  │    角色→appearance keywords              │
  │    场景→location/atmosphere keywords     │
  │    镜头→camera_move keywords             │
  │                                         │
  │ ② 查询 atom_asset_library:               │
  │    WHERE linked_type=? AND linked_id=?   │
  │    + WHERE atom_text LIKE '%keyword%'    │
  │    + media_category = target_media       │
  │                                         │
  │ ③ 排序: usage_count DESC, combo_count DESC│
  │ ④ 注入: 填充到对应镜头维度字段            │
  └─────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────┐
  │        Composer Engine 最终拼接          │
  │  图片类: subject+scene+lighting+style... │
  │  视频类: camera+subject+action+scene...  │
  └─────────────────────────────────────────┘
```

### 🔄 阶段 C：沉淀 (precipitate)

```
组装完成 → 用户满意 → 复制/导出:
  │
  ├── ① stats.track(atom_text, action='compose')
  │      → atom_asset_library.combo_count += 1
  │
  ├── ② 组装产物整体 → MD5 → atom_decompose
  │      → LLM 再次拆解为新原子列表
  │
  ├── ③ 新原子去重:
  │      for each new_atom:
  │        hash = MD5(new_atom.text + media_category)
  │        if hash NOT IN atom_asset_library:
  │          INSERT (source='usage_precipitate')
  │        else:
  │          UPDATE usage_count += 1
  │
  └── ④ 死码检测 (定时任务):
         SELECT * FROM atom_asset_library
         WHERE last_used_at < datetime('now','-90 days')
           AND usage_count < 5
         → is_active = 0 (归档，不删除)
```

### 🔄 阶段 D：迭代 (iterate)

```
┌──────────────────────────────────────────────┐
│            资产库持续进化                      │
│                                              │
│  atom_asset_library 规模增长:                  │
│    初始种子: ~500 条 (现有 word_card)          │
│    + AI拆解: ~200/次 (每次批量导入)            │
│    + 使用沉淀: ~30/天 (组装过程采集)           │
│    - 死码归档: ~10/月 (低热度自动降权)         │
│                                              │
│  质量提升:                                    │
│    usage_count 高的原子 → 优先推荐             │
│    combo_count 高的组合 → 模板化               │
│    quality_score → AI评估 + 人工审核           │
└──────────────────────────────────────────────┘
```

---

## 四、实施路线图 (分三阶段)

### Phase16-v5.2: 基础设施 (当前 — 预计 2h)

| # | 任务 | 文件 | 说明 |
|---|------|------|------|
| 1 | 创建 `atom_asset_library` 表 | `backend/migrate_atom_asset_library.py` | 新表 + 索引 + 幂等迁移 |
| 2 | 现有数据迁移: word_card → atom_asset_library | 同上 | 将694条词卡 + 233条原子拆解结果写入新表 |
| 3 | 补全 `media_category` + `linked_type` | 同上 | 根据现有 group_key 推断分类 |
| 4 | 新建 `atom_filler.py` API | `backend/api/atom_filler.py` | 智能填充端点 |

### Phase16-v5.3: 角色/场景联动 (预计 2h)

| # | 任务 | 说明 |
|---|------|------|
| 5 | `_fill_atoms_by_character()` | composer_engine 集成，角色→原子卡自动填充 |
| 6 | `_fill_atoms_by_scene()` | composer_engine 集成，场景→原子卡自动填充 |
| 7 | 统一 API: `POST /api/composer/template-fill` | 前端一键调用 |

### Phase16-v5.4: 闭环沉淀 (预计 3h)

| # | 任务 | 说明 |
|---|------|------|
| 8 | 使用过程自动采集 | copy/compose/export → atom_stats.track |
| 9 | 组装产物回写拆解 | 组装完成后台自动 decompose → 新原子入库 |
| 10 | 去重匹配管线 | 每次 assemble 前检查所有维度字段是否已有对应原子 |
| 11 | 死码检测定时任务 | cron 每周清理 low-usage atoms |

---

## 五、已存在能力 vs 需新增能力对照

### ✅ 已有 (可复用)

| 能力 | 位置 | 复用方式 |
|------|------|---------|
| AI拆解引擎 | `atoms.py` - decompose() | 组装产物沉淀时直接调用 |
| MD5去重缓存 | `atoms.py` - source_hash UNIQUE | 扩展到 asset_library |
| 原子↔词卡桥接 | `atom_word_bridge` 表 | 升级为 asset_library 主表 |
| 使用统计追踪 | `atom_stats` 表 + track() | 直接复用 |
| 角色CRUD+注入 | `characters.py` + composer | 补充 linked_type='character' |
| 场景维度系统 | `scene_composer.py` | 补充 linked_type='scene' |
| 词卡选取器 | `word_cards.py` picker | 增加 media_category 筛选 |
| 版本管理 | `word_card_versions` 表 | 扩展为 assembled_prompt_versions |

### ⚠️ 需新增

| 能力 | 优先级 | 工作量 |
|------|--------|--------|
| `atom_asset_library` 统一资产表 | P0 | 迁移脚本 ~100行 |
| `media_category` 二分体系 | P0 | 字段+索引 |
| `linked_type/linked_id` 关联 | P0 | 字段+索引+填充逻辑 |
| `atom_filler.py` 智能填充引擎 | P0 | 新API ~150行 |
| 组装产物自动沉淀 | P1 | composer 集成 ~60行 |
| 死码检测定时任务 | P2 | cron job ~40行 |
| 前端预览面板联动 | P2 | app_core.js 扩展 ~80行 |

---

## 六、数据库迁移脚本（伪代码概览）

```python
# backend/migrate_atom_asset_library.py (待实现)

def migrate():
    # ① 创建 atom_asset_library 主表
    # ② 迁移现有数据：
    #    - word_card → 逐条 atom_asset_library (linked_type='general')
    #    - atom_decompose → 提取 atoms_json 逐元素入库
    #    - character_profiles → 提取 appearance/personality 关键词原子
    # ③ 补全 media_category：
    #    - 根据 word_card_group.group_key 推断 (camera→video, composition→image)
    # ④ 创建索引
    # ⑤ 输出统计报告
    pass
```

---

## 七、关键决策点（需确认）

| # | 决策项 | 选项 A | 选项 B |
|---|--------|--------|--------|
| 1 | 原子库主表策略 | **新建 atom_asset_library** (独立干净) | 扩展现有 atom_word_bridge (渐进迁移) |
| 2 | 组装后自动沉淀 | **实时触发** (每次组装立刻拆解) | 延迟批处理 (定时批量拆解) |
| 3 | 图片/视频分类粒度 | **二分** (image | video | both) | 细粒度 (image_static, image_anim, video_short, video_long) |
| 4 | 角色原子提取方式 | **手动标记** (用户主动关联) | AI自动提取 (appearance→关键词→匹配) |

---

> 📌 **建议**: 选项均选 A 列（稳健起步，后续扩展），从 Phase16.1 开始实施。是否开始创建数据库迁移脚本？
