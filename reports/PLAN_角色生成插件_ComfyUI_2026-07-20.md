# 角色生成（角色肖像生成）插件开发方案 v1.0

> 2026-07-20 | com.promptkit.generator 子模块 | 研讨阶段

---

## 一、现有基础盘点

### 1.1 已有的可用积木

| 积木 | 位置 | 已具备能力 |
|------|------|-----------|
| **ComfyUI 桥接** | `backend/api/comfyui.py` | 工作流配置/导入/JSON 管理、提示词组合引擎、SSE 流式生成 + 轮询、批量生成、图片自动下载/缩略图收录 |
| **角色组装器** | `backend/api/character_composer.py` + `character_composer.js` | 22 维度角色编辑（性别/年龄/脸型/发型/眼/表情/服装/姿态等）、模板系统、词卡关联、输出提示词组合 |
| **词卡系统** | `prompts.db` word_card 表 | 165 张词卡，`char_gender_age`/`char_hairstyle` 等角色分组，可被 Composer 引用 |
| **生成插件** | `plugins/generator/`（刚建） | 导航入口 + 占位视图，预留 角色/场景/分镜 三个按钮 |
| **缩略图管理** | `data/thumbnails/` + API | 上传/删除/ComfyUI 生成后自动收录 |

### 1.2 角色组装器已有的 22 个维度

```
gender, age, face_shape, hairstyle, eye, expression, clothing, 
pose, body_type, accessories, skin, height, occupation, style, 
background, lighting, mood, personality, hair_color, makeup, 
eye_color, special_features
```

---

## 二、用户需求梳理

| # | 需求 | 优先级 |
|---|------|--------|
| 1 | **捏脸参数滑块界面** — 直观调节面部/姿态/风格参数 | P0 |
| 2 | **关联 ComfyUI Portrait Master 插件** — 参数映射到工作流节点 | P0 |
| 3 | **参数调整 → 提交生成 → 实时预览** | P0 |
| 4 | **生成历史记录** — 历史生成结果可回看、对比 | P1 |
| 5 | **生成结果归档入库** — 存入角色资产库，支持标记/备注 | P1 |
| 6 | **导出** — PNG/原图/参数JSON 导出 | P1 |
| 7 | **关联角色词卡** — 从词卡选取描述词条注入参数 | P0 |
| 8 | **关联角色组装模板** — 读取已有角色设定填充参数 | P0 |

---

## 三、架构设计

### 3.1 分层架构

```
┌─────────────────────────────────────────────────────────┐
│  前端 UI 层 (generator_ui.js v2.0)                       │
│  ┌──────────┬───────────┬───────────┬────────────────┐  │
│  │ 捏脸面板  │ 提示词面板  │ 生成队列   │ 历史/画廊      │  │
│  │ 滑块+色盘 │ 词卡选取   │ 进度+预览  │ 归档+导出      │  │
│  └──────────┴───────────┴───────────┴────────────────┘  │
├─────────────────────────────────────────────────────────┤
│  插件 API 层 (generator/api.py)                          │
│  ┌──────────┬───────────┬───────────┬────────────────┐  │
│  │ 参数预设   │ 生成提交   │ 历史查询   │ 资产入库       │  │
│  │ CRUD      │ +队列管理  │ +对比     │ +导出          │  │
│  └──────────┴───────────┴───────────┴────────────────┘  │
├─────────────────────────────────────────────────────────┤
│  ComfyUI 桥接层 (复用 comfyui.py)                        │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 工作流模板注入 → 参数映射 → 提交 Prompt → SSE 轮询   │   │
│  └──────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│  ComfyUI + Portrait Master 插件 (外部)                   │
└─────────────────────────────────────────────────────────┘
```

### 3.2 数据流

```
角色词卡 / 组装模板 
       ↓ 选取/加载
  捏脸参数面板 ←→ 滑块参数 JSON
       ↓ 参数序列化 → 提示词组合
  ComfyUI Prompt 工作流
       ↓ HTTP POST → ComfyUI Server
  生成结果 (image/png)
       ↓ 自动下载 → 本地缩略图
  前端预览展示 → 历史记录入库
       ↓ 用户确认
  归档到角色资产库 ← 关联角色 ID
```

---

## 四、捏脸参数滑块设计

### 4.1 参数分组与控件

| 分组 | 参数 | 控件类型 | 范围 | ComfyUI Portrait Master 对应节点 |
|------|------|---------|------|-------------------------------|
| **面部** | 脸型 | 预设选择 | oval/round/square/heart/diamond | `face_shape` selector |
| | 颧骨高度 | 滑块 | 0.0 — 1.0 | `cheekbone_height` |
| | 下巴宽度 | 滑块 | 0.0 — 1.0 | `chin_width` |
| | 下颌角度 | 滑块 | 0.0 — 1.0 | `jaw_angle` |
| **眼部** | 眼型 | 预设选择 | almond/round/monolid/hooded/downturned | `eye_shape` |
| | 眼距 | 滑块 | 0.3 — 1.0 | `eye_distance` |
| | 眼睛大小 | 滑块 | 0.5 — 1.5 | `eye_size` |
| | 瞳孔颜色 | 色盘 | #hex | `eye_color` |
| **鼻部** | 鼻型 | 预设选择 | straight/aquiline/snub/button/hawk | `nose_shape` |
| | 鼻梁高度 | 滑块 | 0.0 — 1.0 | `nose_bridge` |
| | 鼻翼宽度 | 滑块 | 0.0 — 1.0 | `nose_width` |
| **唇部** | 唇形 | 预设选择 | thin/full/heart/wide/bow | `lip_shape` |
| | 唇厚 | 滑块 | 0.0 — 1.0 | `lip_thickness` |
| | 唇色 | 色盘 | #hex | `lip_color` |
| **发型** | 发型 | 预设选择 | long/short/bob/ponytail/bun/curly等 | `hair_style` |
| | 发色 | 色盘 | #hex | `hair_color` |
| | 刘海 | 预设选择 | none/straight/side/curtain/wispy | `bangs_style` |
| **表情** | 表情类型 | 预设选择 | neutral/smile/sad/angry/surprised/shy | `expression` |
| | 表情强度 | 滑块 | 0.0 — 1.0 | `expression_strength` |
| **姿态** | 头部角度 | 滑块×3 | pitch(-30°~30°) yaw(-45°~45°) | `head_rotation` |
| | 肩部角度 | 滑块 | 0.0 — 1.0 | `shoulder_angle` |
| **风格** | 画风 | 预设选择 | realistic/anime/semi-realistic/sketch/oil | `art_style` |
| | 光照方向 | 预设选择 | front/side/back/top/rim | `lighting_direction` |
| | 背景类型 | 预设选择 | studio/nature/urban/solid/gradient/transparent | `background_type` |

### 4.2 面向用户的前端交互设计

不需要显示 ComfyUI 内部节点名称！只展示人性化分组：

```
┌──────────────────────────────────────────────────┐
│  🎭 角色肖像生成                                   │
│  ┌────────────────────────────────────────────┐   │
│  │  数据来源: [从角色组装器加载 ▼]  [从词卡选取 ▼] │   │
│  │  当前角色: 小明 · 少年 · 开朗                   │   │
│  └────────────────────────────────────────────┘   │
│                                                    │
│  ┌─ 面部 ────────────────────────────────────┐    │
│  │ 脸型  [瓜子脸 ▼]  颧骨  [━━●━━━━] 0.4      │    │
│  │ 下巴  [━━━━●━━━] 0.6  下颌  [━━●━━━━] 0.35  │    │
│  └────────────────────────────────────────────┘    │
│                                                    │
│  ┌─ 眼鼻唇 ──────────────────────────────────┐    │
│  │ 眼型  [杏眼 ▼]  眼距  [━━━●━━━] 0.5        │    │
│  │ 眼睛大小 [━━━━●━] 1.1  瞳孔色 [🟤 选择]    │    │
│  │ 鼻型  [直鼻 ▼]  鼻梁  [━━●━━━━] 0.3        │    │
│  │ 唇型  [薄唇 ▼]  唇厚  [━━━●━━━] 0.5        │    │
│  └────────────────────────────────────────────┘    │
│                                                    │
│  ┌─ 发型 ────────────────────────────────────┐    │
│  │ 发型  [长发 ▼]  发色  [⚫ 选择]             │    │
│  │ 刘海  [齐刘海 ▼]                            │    │
│  └────────────────────────────────────────────┘    │
│                                                    │
│  ┌─ 风格 ────────────────────────────────────┐    │
│  │ 画风  [写实 ▼]  光照  [正面光 ▼]             │    │
│  │ 背景  [工作室灰 ▼]                           │    │
│  │ 表情  [微笑 ▼]  强度  [━━━●━━━] 0.6        │    │
│  └────────────────────────────────────────────┘    │
│                                                    │
│  ┌─ 作品比例 ────────────────────────────────┐    │
│  │ [1:1 头像] [3:4 半身] [9:16 全身] [16:9 横]  │    │
│  └────────────────────────────────────────────┘    │
│                                                    │
│  [🔮 生成预览 (1张)]  [🎲 随机参数]  [💾 保存预设]  │
│                                                    │
│  ┌─ 生成预览区 ──────────────────────────────┐    │
│  │         [生成结果图片展示]                    │    │
│  │         上一次生成 · 2026-07-20 11:20        │    │
│  └────────────────────────────────────────────┘    │
│                                                    │
│  ┌─ 生成历史 (4) ────────────────────────────┐    │
│  │ [小图1] [小图2] [小图3] [小图4] ... [更多→] │    │
│  └────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

---

## 五、数据库设计（新增表）

### 5.1 参数预设表

```sql
CREATE TABLE IF NOT EXISTS generator_character_presets (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER,                          -- 所属用户（NULL=系统预设）
    name           TEXT NOT NULL,                     -- 预设名称
    description    TEXT DEFAULT '',
    params_json    TEXT NOT NULL DEFAULT '{}',        -- {face:{shape:"oval",cheekbone:0.4,...}, hair:{style:"long",...}, ...}
    aspect_ratio   TEXT DEFAULT '1:1',                -- 作品比例
    character_id   INTEGER,                           -- 关联角色组装器角色 ID
    template_id    INTEGER,                           -- 关联模板 ID
    is_public      INTEGER DEFAULT 0,                 -- 是否公开（团队共享）
    created_at     TEXT DEFAULT (datetime('now','localtime')),
    updated_at     TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (character_id) REFERENCES character_profiles(id) ON DELETE SET NULL
);
```

### 5.2 生成历史表

```sql
CREATE TABLE IF NOT EXISTS generator_jobs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER,
    preset_id       INTEGER,                          -- 使用的预设
    character_id    INTEGER,                          -- 关联角色
    prompt_text     TEXT NOT NULL,                     -- 最终发送的提示词
    params_json     TEXT NOT NULL DEFAULT '{}',        -- 使用的参数快照
    workflow_id     TEXT,                              -- 使用的 ComfyUI 工作流 ID
    comfyui_job_id  TEXT,                              -- ComfyUI 返回的 job_id
    status          TEXT DEFAULT 'pending',            -- pending/queued/generating/done/failed
    result_path     TEXT,                              -- 生成结果图片路径
    thumb_path      TEXT,                              -- 缩略图路径
    duration_ms     INTEGER,                           -- 生成耗时
    rating          INTEGER DEFAULT 0,                 -- 用户评分 1-5
    tags            TEXT DEFAULT '[]',                 -- JSON 标签数组
    note            TEXT DEFAULT '',                   -- 备注
    is_archived     INTEGER DEFAULT 0,                 -- 是否已归档到资产库
    archived_asset_id INTEGER,                         -- 归档后的资产 ID
    error_message   TEXT,
    created_at      TEXT DEFAULT (datetime('now','localtime'))
);
```

### 5.3 参数映射配置表

```sql
CREATE TABLE IF NOT EXISTS generator_param_mapping (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id     TEXT NOT NULL,                     -- 关联的 ComfyUI 工作流
    param_key       TEXT NOT NULL,                     -- 前端参数键名 (如 face.cheekbone)
    node_id         TEXT NOT NULL,                     -- ComfyUI 节点 ID
    input_field     TEXT NOT NULL,                     -- 节点内的输入字段名
    value_type      TEXT DEFAULT 'float',              -- float/int/string/color
    value_min       REAL DEFAULT 0.0,
    value_max       REAL DEFAULT 1.0,
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(workflow_id, param_key)
);
```

---

## 六、API 设计

### 6.1 参数预设

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/plugins/com.promptkit.generator/presets` | 列出用户可用的参数预设 |
| GET | `/api/plugins/com.promptkit.generator/presets/{id}` | 获取单个预设详情 |
| POST | `/api/plugins/com.promptkit.generator/presets` | 创建新预设 |
| PUT | `/api/plugins/com.promptkit.generator/presets/{id}` | 更新预设 |
| DELETE | `/api/plugins/com.promptkit.generator/presets/{id}` | 删除预设 |

### 6.2 生成管理

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/plugins/com.promptkit.generator/generate` | **提交生成任务** → 返回 job_id，SSE 流式推送进度 |
| GET | `/api/plugins/com.promptkit.generator/generate/{job_id}` | 查询单个生成任务状态 |
| POST | `/api/plugins/com.promptkit.generator/generate/batch` | 批量生成（多参数组合） |
| GET | `/api/plugins/com.promptkit.generator/generate/{job_id}/image` | 获取生成结果原图 |
| GET | `/api/plugins/com.promptkit.generator/generate/{job_id}/thumb` | 获取缩略图 |

### 6.3 生成历史

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/plugins/com.promptkit.generator/history` | 生成历史列表（分页、筛选） |
| PATCH | `/api/plugins/com.promptkit.generator/history/{job_id}` | 更新备注/评分 |
| DELETE | `/api/plugins/com.promptkit.generator/history/{job_id}` | 删除记录及图片 |
| POST | `/api/plugins/com.promptkit.generator/history/{job_id}/archive` | 归档到角色资产库 |
| POST | `/api/plugins/com.promptkit.generator/history/{job_id}/export` | 导出（PNG+参数JSON 打包） |

### 6.4 词卡/组装器关联

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/plugins/com.promptkit.generator/wordcards` | 获取角色相关词卡分组（复用已有 API） |
| POST | `/api/plugins/com.promptkit.generator/wordcards/inject` | 将选中的词条注入参数面板（服务端组合提示词） |
| GET | `/api/plugins/com.promptkit.generator/characters` | 获取角色组装器已有的角色列表 |
| POST | `/api/plugins/com.promptkit.generator/characters/load` | 从角色组装器加载角色设定到参数面板 |

---

## 七、开发分期

### Phase 1 — 基础参数面板 + 生成链路 (P0)
**预期工时**: 2-3 天

| 任务 | 文件 |
|------|------|
| 1.1 定义参数模型（face/hair/eyes/nose/lips/style） | `generator/api.py` |
| 1.2 实现滑块预设 CRUD API | `generator/api.py` |
| 1.3 参数 → ComfyUI Prompt 映射引擎 | `generator/param_engine.py` |
| 1.4 提交生成 → ComfyUI 桥接（复用 comfyui.py） | `generator/api.py` |
| 1.5 SSE 进度推送 + 结果回传 | `generator/api.py` |
| 1.6 前端参数面板 UI（滑块/色盘/预设选择） | `generator/static/generator_ui.js` |
| 1.7 生成预览 + 进度展示 | `generator/static/generator_ui.js` |
| **数据库** | 建 `generator_character_presets` + `generator_jobs` 表 |

### Phase 2 — 词卡 & 组装器关联 (P0)
**预期工时**: 1-2 天

| 任务 | 文件 |
|------|------|
| 2.1 从词卡系统拉取角色相关分组列表 | `generator/api.py` |
| 2.2 词条选取 → 注入参数面板（智能映射） | `generator/param_engine.py` |
| 2.3 从角色组装器加载已有角色设定 | `generator/api.py` |
| 2.4 前端「数据来源」下拉选择器 | `generator/static/generator_ui.js` |
| 2.5 角色预设 ↔ 组装器角色双向同步 | `generator/api.py` |

### Phase 3 — 生成历史 + 归档入库 (P1)
**预期工时**: 1-2 天

| 任务 | 文件 |
|------|------|
| 3.1 生成历史列表 API（分页/筛选/排序） | `generator/api.py` |
| 3.2 历史画廊前端 UI（缩略图网格、点击放大） | `generator/static/generator_ui.js` |
| 3.3 备注/评分编辑 | `generator/api.py` + UI |
| 3.4 归档到角色资产库（匹配已有 asset_catalog 表） | `generator/api.py` |
| 3.5 删除历史 + 清理关联文件 | `generator/api.py` |
| **数据库** | 补 `generator_jobs` rating/tags/is_archived 字段 |

### Phase 4 — 导出 + 对比 + 批量 (P2)
**预期工时**: 1 天

| 任务 | 文件 |
|------|------|
| 4.1 单张导出（PNG + 参数 JSON + 提示词 TXT 打包 ZIP） | `generator/api.py` |
| 4.2 多选对比模式（2-4 张并排对比） | `generator/static/generator_ui.js` |
| 4.3 批量生成（参数矩阵: 发型×3 + 发色×3 = 9 张） | `generator/api.py` |

### Phase 5 — Portrait Master 参数映射配置(P2)
**预期工时**: 1 天

| 任务 | 文件 |
|------|------|
| 5.1 参数映射配置 API（CRUD） | `generator/api.py` |
| 5.2 可视化参数映射编辑器 | `generator/static/generator_ui.js` |
| 5.3 从 ComfyUI 工作流自动发现可映射节点 | `generator/api.py` |
| **数据库** | 建 `generator_param_mapping` 表 |

---

## 八、推荐方案扩展

### 8.1 💡 方案 A: 渐进式（推荐，稳妥）
按 Phase 1→2→3→4→5 顺序开发，每阶段独立可交付。**Phase 1 完成后即可使用**。

**优点**: 风险低，每阶段有可见成果
**缺点**: 功能完善需要时间

### 8.2 💡 方案 B: Portrait Master 直连（激进，适合 ComfyUI 重度用户）
跳过参数映射抽象层，直接读取 ComfyUI Portrait Master 插件的 `input` schema，**自动生成**参数面板。理论上不需要手动写 4.1 节的参数列表。

**实现思路**:
```
GET /api/plugins/com.promptkit.generator/workflow/{id}/params
→ 解析 ComfyUI workflow JSON 中的 PortraitMaster 节点
→ 提取 inputs 列表 + 类型 + 默认值
→ 前端自动渲染对应控件
```

**优点**: 零配置，ComfyUI 工作流里改了参数，前端自动同步
**缺点**: 依赖 Portrait Master 节点的 inputs 结构稳定；中文标签需额外配置

### 8.3 💡 方案 C: 参考图驱动（创新方案）
不做滑块捏脸，改为上传参考图 + 参考图特征提取提示词 → ComfyUI IP-Adapter/FaceID 生成。

**实现思路**:
- 用户上传一张/Multi 张参考图
- 后端调用 ComfyUI IP-Adapter 工作流
- 参考图 → FaceID embedding → 生成 → 保持面部一致性

**优点**: 操作最直观，"我想要长这样的角色"
**缺点**: 需要 IP-Adapter 模型（ComfyUI 需预装）

### 8.4 💡 方案 D: AI 对话式描述生成
用户用自然语言描述角色 → LLM 解析 → 自动填充参数面板。

**实现思路**:
```
"一个20岁的亚洲女孩，圆脸、大眼睛、长发、穿水手服、微笑"
→ LLM 解析 → {gender:"女", age:"20", face:"圆脸", eye:"大眼", hair:"长发", clothing:"水手服", expression:"微笑"}
→ 自动填充滑块参数
→ 用户微调 → 生成
```

**优点**: 最快上手，新手友好
**缺点**: LLM 解析不准时需要手动修正

---

## 九、接口衔接设计（角色词卡 & 角色组装器）

### 9.1 从角色词卡加载

```
流程:
1. 用户点击「从词卡选取」→ 调出词卡浏览器（类似角色组装器右侧面板）
2. 按分组筛选: char_gender_age, char_hairstyle, char_facial 等
3. 选中词条 → 自动注入到参数面板的对应字段
   例: 词卡「大眼睛」∈ char_facial 组 → 自动设 eye_size = 1.2
4. 注入规则表（可配置）:
   ┌──────────────────┬─────────────────────┐
   │ 词卡分组          │ 映射参数            │
   ├──────────────────┼─────────────────────┤
   │ char_gender_age  │ gender, age         │
   │ char_hairstyle   │ hair_style, bangs   │
   │ char_facial      │ eye, nose, lip      │
   │ char_clothing    │ clothing            │
   │ char_expression  │ expression          │
   │ char_style       │ art_style, lighting │
   └──────────────────┴─────────────────────┘
```

### 9.2 从角色组装器加载

```
流程:
1. 用户点击「从角色组装器加载」→ 下拉列出已有角色
2. 选择角色 → 读取 settings_json 中的 22 个维度值
3. 自动映射到捏脸面板参数:
   - 直接映射: gender→gender, age→age, face_shape→face_shape, ...
   - 语义映射: mood→expression, style→art_style, background→background_type
4. 用户微调后生成
5. 生成结果可反写回角色组装器作为「封面图」
```

---

## 十、风险与依赖

| 风险 | 缓解措施 |
|------|---------|
| ComfyUI Portrait Master 参数格式未知 | Phase 1 先用通用参数面板，Phase 5 再做精确映射 |
| ComfyUI 生成速度慢（30s-2min/张） | SSE 流式推送进度 + 前端等待动画 + 队列管理 |
| C 盘空间有限（仅 75GB） | 过期历史自动清理策略 + 图片压缩 |
| 个人版 License 限制 | 后端 API 始终可用，前端按 License 控制并发数 |

---

## 十一、下一步行动建议

1. **确认 ComfyUI Portrait Master 工作流** — 导出一份 JSON 让我分析节点结构
2. **选择方案组合** — 推荐 **Phase 1 (基础面板) + Phase 2 (词卡关联)** 并行 → 立即可用
3. **是否采纳方案 D (对话式)** — 可做快速原型的加分项
4. **确认 Portrait Master 安装情况** — 在 ComfyUI 里确认插件已装、可用节点列表

---

> 方案已备好，等待你确认开发方向后即可开始编码实现。
