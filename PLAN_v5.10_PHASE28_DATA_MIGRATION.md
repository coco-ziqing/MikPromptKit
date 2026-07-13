# 数据模型迁移专项规划书 — project_id / master_project_id 收敛

- 日期: 2026-07-13
- 阶段: Phase28 (数据模型迁移专项)
- 前置备份: data/backups/phase28_premigration_*.db
- 关联: MEMORY.md Phase26 (孤儿收养) / Phase22 (master 层引入)

## 一、现状审计结论

### 1.1 顶层数据模型（真实数据）
```
master_project (顶层总项目)          2 条: id2「特种兵学校」in_progress / id3「宣传片」draft
  └─ master_sub_project (子层/幕)    2 条: 都挂 master2, 各链 seedance_project_id 32/33
       └─ user_project (seedance镜头组装)  2 条: id32「第一幕·相遇」/ id33「第二幕·高潮」
  └─ master_asset (项目资产)         6 条: 挂 master2(4测试)/master3(2)
```

### 1.2 割裂点：团队协作 4 表 同时带 project_id + master_project_id
| 表 | 行数 | project_id 现值 | master_project_id 现值 |
|----|------|-----------------|------------------------|
| project_members    | 3 | **29 (死值,已删)** | 2 (有效) |
| project_columns    | 4 | **29 (死值)** | 2 |
| project_tasks      | 3 | **29 (死值)** | 2 |
| project_milestones | 3 | **29 (死值)** | 2 |

- project_id=29 指向的 seedance user_project 早已删除 → 谁都不指向 → 纯死值。
- Phase26 已把这批孤儿的 master_project_id 补成 2，但遗留了 project_id=29。

### 1.3 代码使用真相
- **前端 project_dashboard.js：100% 只用 master_project_id**（columns/tasks/members/milestones 全部 `?master_project_id=` + POST 带 master_project_id）。
- **后端 api.py：双模式** `if master_project_id: ... else: (project_id)`。else 分支是历史死路径，前端不触发。
- `_on_project_created(project_id)` 钩子：seedance 项目创建时给 project_id 播种 4 看板列（旧 Phase21 逻辑，master 面板不显示这些列）。
- 已知 BUG（本次可顺带修）：`_renderP3Gantt` 调 `/gantt?project_id=masterId`，但 gantt 端点按 user_project.id 查 → master id 当 project_id 用，甘特图查错表。

### 1.4 废弃空表（0 行，另一套没落地的设计）
`projects` / `project_assets` / `project_templates` / `activity_feed`(有代码写入) / `review_requests` / `user_project_scene`(seedance分镜,当前0行但结构在用) / `workspace_squads` / `squad_members` / `project_task_scene`

> 注意：`activity_feed` 虽 0 行，但 api_collab.py 有 `_log_activity` 写入逻辑 → **不可删**。
> `user_project_scene` 是 seedance 分镜表，功能在用 → **不可删**。

## 二、目标模型（定案）
**master_project_id = 团队协作 4 表的唯一主键。** project_id 退役。
```
master_project (唯一顶层锚点)
  ├─ 团队: project_members / columns / tasks / milestones  →  master_project_id
  ├─ 工作区: workspace_invites / workspace_squads          →  master_project_id (已是)
  ├─ 资产: master_asset                                    →  master_project_id (已是)
  └─ 子项目: master_sub_project → seedance_project_id → user_project(镜头/分镜)
```

## 三、分阶段执行（可逆优先）— 执行结果

> ✅ **Phase1/2/3 已完成并通过真实 API 回归；Phase4 有意推迟（见下）。**

### Phase 1 — 数据归一化【✅ 已执行】
- UPDATE 4 表 SET project_id=0 WHERE project_id=29（对齐 master 模式约定：project_id=0=非seedance域）。
- 回滚：SET project_id=29 WHERE master_project_id=2 AND project_id=0（或恢复备份）。

### Phase 2 — 代码路径收敛【✅ 已执行】
1. api.py：columns/tasks/milestones/members 全部移除 `else project_id` 死分支 + INSERT 去 project_id，统一 master_project_id。
2. `_on_project_created` 钩子已中和（不再播种 project_id 看板列）。
3. gantt 端点修复：按 master_project_id 查询，且兼容前端历史传参 `?project_id=masterId`。
4. `_sync` 改为 no-op（进度在 dashboard 实时计算）。
5. api_workspace.py 邀请加入成员 INSERT 去 project_id。
6. 插件 `_ensure_tables` 新装 schema 已改为 master 模型（无 project_id）。

### Phase 3 — Schema 收敛【✅ 已执行 / 整表重建】
- 4 表整表重建移除 project_id（因 idx_pt_project 索引 + members UNIQUE 约束，DROP COLUMN 不可行）。
- 保留 id 不变维持 project_task_scene 外键；project_tasks 新建 `idx_pt_master(master_project_id,column_id)`；members 新 `UNIQUE(master_project_id,user_id)`。
- integrity_check=ok；行数 4/3/3/3 零丢失。
- 前向迁移脚本 `plugins/project/migrations/003_phase28_converge_master.py`（幂等，供旧库/重部署自动收敛）。

### Phase 4 — 废表清理【⏸ 有意推迟】
- 复查发现 `project_assets` 是**资产管理插件活跃表**（0 行但代码在用）→ 不可删。
- `projects`/`project_templates`/`review_requests` 仅被 `db_migrate_phase18.py` 创建，无运行引用；删除收益极小且会与迁移文件产生 schema 漂移，影响新机重部署一致性 → 推迟，列为低优先技术债。

## 四、验证矩阵（每阶段后跑真实 API）
- GET /plugins/project/master/2/dashboard → 成员3/看板4/任务3/里程碑3
- GET /plugins/project/columns?master_project_id=2 → 4
- GET /plugins/project/tasks?master_project_id=2 → 3
- GET /plugins/project/members?master_project_id=2 → 3
- GET /plugins/project/milestones?master_project_id=2 → 3
