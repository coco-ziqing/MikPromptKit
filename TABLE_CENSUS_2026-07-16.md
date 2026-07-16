# PromptKit 数据表普查报告（110 表）

> 生成时间：2026-07-16 · DB：`data/prompts.db` · 只读普查（未修改任何表）

> 图例：🟢在用 🟡空表但代码在用 🟠空表且无引用(废弃嫌疑) 🔴退役候选 ⚪系统内部

## 领域分布

| 领域 | 表数 |
|------|------|
| 项目管理 | 23 |
| 资产库/DAM | 16 |
| 原子化/组装 | 11 |
| 多用户/协作 | 10 |
| 检索索引(FTS) | 10 |
| 词卡核心 | 9 |
| 运维/系统 | 9 |
| 媒体/封面 | 6 |
| 收藏/词包 | 5 |
| 遗留/系统内部 | 4 |
| 资产库/DAM(设备) | 3 |
| AI增强 | 2 |
| 其他 | 2 |

## ⚠️ 重点：退役/排查候选（2 张）

| 表 | 行数 | 代码引用 | 领域 | 建议 |
|----|------|---------|------|------|
| `_old_prompt_word_card` | 297 | 6 | 遗留/系统内部 | 🔴 退役候选(遗留备份表) |
| `_old_prompt_library` | 30 | 5 | 遗留/系统内部 | 🔴 退役候选(遗留备份表) |

## 全量明细（按领域）


### AI增强

| 表 | 行数 | 代码引用 | 判定 |
|----|------|---------|------|
| `prompt_embeddings` | 169 | 5 | 🟢 在用 |
| `playground_history` | 0 | 3 | 🟡 空表但代码在用(功能未产生数据) |

### 其他

| 表 | 行数 | 代码引用 | 判定 |
|----|------|---------|------|
| `backup_task` | 7 | 20 | 🟢 在用 |
| `task_prompt_refs` | 0 | 2 | 🟡 空表但代码在用(功能未产生数据) |

### 原子化/组装

| 表 | 行数 | 代码引用 | 判定 |
|----|------|---------|------|
| `atom_asset_library` | 928 | 51 | 🟢 在用 |
| `seedance_id_map` | 297 | 21 | 🟢 在用 |
| `scene_card_ref` | 80 | 9 | 🟢 在用 |
| `atom_word_bridge` | 56 | 21 | 🟢 在用 |
| `atom_decompose` | 13 | 36 | 🟢 在用 |
| `atom_variation` | 9 | 8 | 🟢 在用 |
| `scene_template` | 6 | 14 | 🟢 在用 |
| `character_profiles` | 5 | 56 | 🟢 在用 |
| `character_template` | 4 | 14 | 🟢 在用 |
| `scene_profiles` | 4 | 37 | 🟢 在用 |
| `character_images` | 0 | 13 | 🟡 空表但代码在用(功能未产生数据) |

### 多用户/协作

| 表 | 行数 | 代码引用 | 判定 |
|----|------|---------|------|
| `user_actions` | 2558 | 20 | 🟢 在用 |
| `user_audit_log` | 473 | 17 | 🟢 在用 |
| `user_sessions` | 98 | 8 | 🟢 在用 |
| `users` | 6 | 60 | 🟢 在用 |
| `user_workspace` | 2 | 12 | 🟢 在用 |
| `notification_queue` | 1 | 11 | 🟢 在用 |
| `activity_feed` | 0 | 11 | 🟡 空表但代码在用(功能未产生数据) |
| `comments` | 0 | 12 | 🟡 空表但代码在用(功能未产生数据) |
| `user_custom_word` | 0 | 8 | 🟡 空表但代码在用(功能未产生数据) |
| `user_scene_prompt` | 0 | 14 | 🟡 空表但代码在用(功能未产生数据) |

### 媒体/封面

| 表 | 行数 | 代码引用 | 判定 |
|----|------|---------|------|
| `video_cache` | 26 | 8 | 🟢 在用 |
| `prompt_thumbnails` | 12 | 35 | 🟢 在用 |
| `app_cover_content` | 8 | 5 | 🟢 在用 |
| `prompt_videos` | 2 | 40 | 🟢 在用 |
| `thumb_meta` | 2 | 16 | 🟢 在用 |
| `thumb_hash` | 1 | 10 | 🟢 在用 |

### 收藏/词包

| 表 | 行数 | 代码引用 | 判定 |
|----|------|---------|------|
| `collection_items` | 12 | 37 | 🟢 在用 |
| `collections` | 9 | 64 | 🟢 在用 |
| `wordpacks` | 1 | 24 | 🟢 在用 |
| `usage_history` | 0 | 14 | 🟡 空表但代码在用(功能未产生数据) |
| `wordpack_items` | 0 | 18 | 🟡 空表但代码在用(功能未产生数据) |

### 检索索引(FTS)

| 表 | 行数 | 代码引用 | 判定 |
|----|------|---------|------|
| `word_card_fts` | 1273 | 11 | ⚪ FTS索引(随主表) |
| `word_card_fts_docsize` | 1273 | 0 | ⚪ FTS索引(随主表) |
| `prompts_fts` | 169 | 13 | ⚪ FTS索引(随主表) |
| `prompts_fts_docsize` | 169 | 0 | ⚪ FTS索引(随主表) |
| `word_card_fts_data` | 32 | 0 | ⚪ FTS索引(随主表) |
| `word_card_fts_idx` | 30 | 0 | ⚪ FTS索引(随主表) |
| `prompts_fts_data` | 13 | 0 | ⚪ FTS索引(随主表) |
| `prompts_fts_idx` | 11 | 0 | ⚪ FTS索引(随主表) |
| `prompts_fts_config` | 1 | 0 | ⚪ FTS索引(随主表) |
| `word_card_fts_config` | 1 | 0 | ⚪ FTS索引(随主表) |

### 词卡核心

| 表 | 行数 | 代码引用 | 判定 |
|----|------|---------|------|
| `word_card` | 1273 | 273 | 🟢 在用 |
| `library_assets` | 233 | 61 | 🟢 在用 |
| `prompts` | 169 | 269 | 🟢 在用 |
| `prompt_cards` | 165 | 79 | 🟢 在用 |
| `word_card_group` | 122 | 120 | 🟢 在用 |
| `translations` | 46 | 15 | 🟢 在用 |
| `word_card_versions` | 26 | 11 | 🟢 在用 |
| `custom_modules` | 2 | 5 | 🟢 在用 |
| `prompt_versions` | 0 | 23 | 🟡 空表但代码在用(功能未产生数据) |

### 资产库/DAM

| 表 | 行数 | 代码引用 | 判定 |
|----|------|---------|------|
| `media_assets` | 473 | 57 | 🟢 在用 |
| `asset_version` | 470 | 27 | 🟢 在用 |
| `asset_catalog` | 409 | 116 | 🟢 在用 |
| `asset_review` | 45 | 10 | 🟢 在用 |
| `asset_module` | 14 | 8 | 🟢 在用 |
| `archive_policy` | 1 | 11 | 🟢 在用 |
| `folder_preset` | 1 | 5 | 🟢 在用 |
| `asset_catalog_ref` | 0 | 6 | 🟡 空表但代码在用(功能未产生数据) |
| `asset_duplicates` | 0 | 12 | 🟡 空表但代码在用(功能未产生数据) |
| `asset_prompt_ref` | 0 | 13 | 🟡 空表但代码在用(功能未产生数据) |
| `asset_ratings` | 0 | 9 | 🟡 空表但代码在用(功能未产生数据) |
| `asset_tags` | 0 | 24 | 🟡 空表但代码在用(功能未产生数据) |
| `asset_versions` | 0 | 10 | 🟡 空表但代码在用(功能未产生数据) |
| `blob_store` | 0 | 43 | 🟡 空表但代码在用(功能未产生数据) |
| `project_snapshot` | 0 | 9 | 🟡 空表但代码在用(功能未产生数据) |
| `sys_notifications` | 0 | 10 | 🟡 空表但代码在用(功能未产生数据) |

### 资产库/DAM(设备)

| 表 | 行数 | 代码引用 | 判定 |
|----|------|---------|------|
| `device_file_index` | 27 | 32 | 🟢 在用 |
| `device` | 13 | 46 | 🟢 在用 |
| `device_watch_path` | 0 | 10 | 🟡 空表但代码在用(功能未产生数据) |

### 运维/系统

| 表 | 行数 | 代码引用 | 判定 |
|----|------|---------|------|
| `runtime_log` | 22354 | 11 | 🟢 在用 |
| `error_breadcrumbs` | 11928 | 3 | 🟢 在用 |
| `config` | 7 | 70 | 🟢 在用 |
| `sys_global_config` | 4 | 8 | 🟢 在用 |
| `plugin_registry` | 1 | 6 | 🟢 在用 |
| `operation_log` | 0 | 4 | 🟡 空表但代码在用(功能未产生数据) |
| `plugin_configs` | 0 | 8 | 🟡 空表但代码在用(功能未产生数据) |
| `plugin_licenses` | 0 | 12 | 🟡 空表但代码在用(功能未产生数据) |
| `plugin_migrations` | 0 | 3 | 🟡 空表但代码在用(功能未产生数据) |

### 遗留/系统内部

| 表 | 行数 | 代码引用 | 判定 |
|----|------|---------|------|
| `_old_prompt_word_card` | 297 | 6 | 🔴 退役候选(遗留备份表) |
| `sqlite_sequence` | 69 | 0 | ⚪ SQLite内部(勿动) |
| `sqlite_stat1` | 53 | 0 | ⚪ SQLite内部(勿动) |
| `_old_prompt_library` | 30 | 5 | 🔴 退役候选(遗留备份表) |

### 项目管理

| 表 | 行数 | 代码引用 | 判定 |
|----|------|---------|------|
| `project_role_review` | 36 | 6 | 🟢 在用 |
| `project_space_member` | 30 | 17 | 🟢 在用 |
| `user_project_scene` | 6 | 82 | 🟢 在用 |
| `user_project` | 5 | 48 | 🟢 在用 |
| `project_columns` | 4 | 29 | 🟢 在用 |
| `project_role` | 4 | 43 | 🟢 在用 |
| `project_role_version` | 4 | 9 | 🟢 在用 |
| `master_sub_project` | 3 | 25 | 🟢 在用 |
| `project_members` | 3 | 43 | 🟢 在用 |
| `project_milestones` | 3 | 22 | 🟢 在用 |
| `project_space` | 3 | 57 | 🟢 在用 |
| `project_tasks` | 3 | 46 | 🟢 在用 |
| `master_asset` | 2 | 30 | 🟢 在用 |
| `project_role_asset` | 2 | 15 | 🟢 在用 |
| `master_project` | 1 | 51 | 🟢 在用 |
| `project_assets` | 1 | 53 | 🟢 在用 |
| `project_task_scene` | 0 | 15 | 🟡 空表但代码在用(功能未产生数据) |
| `project_templates` | 0 | 2 | 🟡 空表但代码在用(功能未产生数据) |
| `projects` | 0 | 54 | 🟡 空表但代码在用(功能未产生数据) |
| `review_requests` | 0 | 2 | 🟡 空表但代码在用(功能未产生数据) |
| `squad_members` | 0 | 9 | 🟡 空表但代码在用(功能未产生数据) |
| `workspace_invites` | 0 | 8 | 🟡 空表但代码在用(功能未产生数据) |
| `workspace_squads` | 0 | 12 | 🟡 空表但代码在用(功能未产生数据) |