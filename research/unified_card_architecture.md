# 统一词卡基础单元架构设计

## 一、现状问题分析

当前系统存在**4套词卡数据结构**，它们字段不同、用途重叠、管理分散：

| 表 | 用途 | 字段数 | 核心问题 |
|------|------|--------|---------|
| `word_card` | 统一词卡管理（v4.1） | 25 | 是主表，但桥接层映射到其他表时丢失字段 |
| `prompt_word_card` | Seedance V2旧词卡 | 10 | 与word_card重复，需迁移 |
| `prompt_cards` | v4卡片视图 | 19 | 与word_card重复 |
| `prompts` | 原始提示词（v3） | 12 | 最老的表，seed data在此 |

**前端展示字段对照：**

| 功能 | 使用字段 | 来源表 |
|------|---------|-------|
| 统一词卡列表 | id, group_id, name, content, meaning, icon, tags, usage_count, group_name | word_card |
| 词卡编辑器 | + category, module, sort_order, is_builtin, group_id | word_card |
| 组装器桥接 | content, meaning, id, thumbnail, preview_media, is_builtin, usage_count, heat_weight | word_card→映射 |
| 组装器原生 | word_text, definition, preview_image, preview_video | prompt_word_card |

## 二、统一词卡基础单元（Unified Card Unit）

每个词卡作为独立数据单元，必须包含以下三层次要素：

### 第一层：标识与分类（基础要素）

| 字段 | 类型 | 说明 | 来源 |
|------|------|------|------|
| `id` | INTEGER PK | 自增主键 | 所有表 |
| `group_id` | INTEGER FK | 所属分组 | word_card已有 |
| `uuid` | TEXT | 全局唯一标识符 | **新增**——便于跨设备索引和导出引用 |
| `name` | TEXT | 词卡名称（冗余，从content截取） | word_card已有 |
| `module` | TEXT | 所属模块：emotion/custom/seedance等 | word_card已有 |

### 第二层：内容与语义（核心数据）

| 字段 | 类型 | 说明 | 来源 |
|------|------|------|------|
| `content` | TEXT | **主内容**——提示词实际文本 | 所有表共有 |
| `meaning` | TEXT | 释义/注释——人类可读的中文解释 | word_card/prompts/prompt_cards |
| `scene` | TEXT | 适用场景描述 | word_card/prompts/prompt_cards |
| `tags` | TEXT JSON | 标签数组 | word_card/prompts/prompt_cards |
| `icon` | TEXT | 显示用Emoji图标 | word_card已有 |
| `structured` | TEXT JSON | 结构化字段（键值对） | word_card已有 |

### 第三层：使用与运营（附加信息）

| 字段 | 类型 | 说明 | 来源 |
|------|------|------|------|
| `usage_count` | INTEGER | 使用次数 | word_card已有 |
| `heat_weight` | REAL | 热度权重(0~1) | word_card已有 |
| `version` | INTEGER | 编辑版本号 | word_card已有 |
| `sort_order` | INTEGER | 排序序号 | word_card已有 |
| `is_builtin` | INTEGER | 是否内置(1)/自定义(0) | word_card已有 |
| `source` | TEXT | 来源: manual/import/composer/batch_copy | word_card已有 |
| `created_at` | TEXT | 创建时间 | 所有表 |
| `updated_at` | TEXT | 更新时间 | word_card已有 |
| `thumbnail` | TEXT | 缩略图文件名 | word_card已有 |
| `preview_media` | TEXT | 预览视频文件名 | word_card已有 |
| `media_type` | TEXT | 媒体类型: image/video | word_card已有 |

### 分组单元（Group Unit）

| 字段 | 类型 | 说明 | 来源 |
|------|------|------|------|
| `id` | INTEGER PK | 自增主键 | word_card_group |
| `group_key` | TEXT UNIQUE | 唯一键标识（如camera_move） | word_card_group |
| `name` | TEXT | 分组名称（中文） | word_card_group |
| `icon` | TEXT | Emoji图标 | word_card_group |
| `description` | TEXT | 分组说明 | word_card_group |
| `group_type` | TEXT | seedance/builtin/custom | word_card_group |
| `sort_order` | INTEGER | 排序 | word_card_group |

## 三、架构缺陷与修复方案

### 缺陷1: Bridge层映射不一致

`composer_wc_bridge.js` 中 `_openRightPicker` 使用手动循环匹配，而原生 `openCardPicker` 使用 `getLibraryByKey`。桥接层加载的是 `/api/v4/word-cards/groups` 返回的 `group_key`，但组装器原生代码查找时用的是 `dimension_key`。

**修复**：确保 `word_card_group.group_key` 与 `prompt_library.dimension_key` 值完全一致。

### 缺陷2: 编辑弹窗缺少必填字段

`word_editor.js` 渲染的编辑弹窗中缺少 `group_id` 的选择（新建时用户无法选择分组）。已在HTML检查中发现 `wcEditGroup` 下拉列表，但 `openCreate()` 时没有填充分组选项。

### 缺陷3: 多个表共存导致前端多次请求

前端需要同时请求 `/api/v4/word-cards`（主表）和 `/api/seedance/v2/libraries`（旧表），两次请求语义相同但路径不同。

**修复**：统一 API 路径，逐步废弃旧端点。

## 四、立即修复：统一词卡编辑弹窗

我将在 `word_editor.js` 中完善以下功能：

1. 编辑弹窗 `group_id` 下拉列表填充（新建时可选择目标分组）
2. 编辑弹窗增加 `icon` 字段
3. 编辑弹窗中 `tags` 输入增强（输入时自动补全已有标签）
4. 编辑弹窗中 `heat_weight` 滑块
5. 保存后刷新列表并保持当前分组筛选

## 五、代码实现

我将实现一个独立的 `App.wordCardModel` 模块，封装词卡的 CRUD 操作，使所有调用方统一通过此模块访问词卡数据，而不是直接 `fetchJSON`。
