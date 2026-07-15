# Phase35 项目媒体资产管理（MAM）— 竞品分析与开发规划

> 状态：**设计讨论稿，待确认**　生成：2026-07-14
> 目标：把「项目内嵌、模块化、本地优先、带版本/审核/自愈备份」的媒体资产管理做成核心竞争力。
> 前置：Phase35.0 地基已落地（user_workspace / project_space / folder_preset / asset_catalog / master_project.workspace_id，迁移 FK=0）。

---

## 1. 新增需求（本轮）
- N1 **项目内嵌模块化资产库**：新建项目时从预设勾选需要的资产模块（图片/视频/音频/AI/PS/AE/C4D…），建立**独立隔离**的项目资产库；模块可随时增减组合。
- N2 **工程文件管理**：AI/PS/AE/C4D 等原始工程源文件的检测/归档/管理。
- N3 **资产管理嵌入项目管理流程**（不是独立模块，而是项目工作台的一部分）。
- N4 **多用户本地资产上传/下载/同步**。
- N5 **团队协作**：资产共享、同步、**版本管理、验证审核**。
- N6 **自检 + 备份**：素材完整性自检 + 备份，避免本地机器损坏/丢失导致资产灭失（灾难恢复）。

---

## 2. 竞品对比（开源 + 闭源）

| 产品 | 开/闭源 | 定位 | 值得借鉴 | 局限 |
|------|--------|------|---------|------|
| **Connecter** | 闭源·免费 | 本地/网络创意资产浏览器 + 团队共享 | ⭐ **索引现有文件夹**(不搬文件)、视觉缩略图/3D预览、**C4D/PS/Blender/3dsMax/UE DCC 集成**、本地预缓存离线可用、Shared Workspace 团队中心、拖拽导入 | 独立工具，不嵌项目管理，无审核批准流，无 AIGC 流程 |
| **Perforce P4 DAM (Helix DAM)** | 闭源·企业 | 2D/3D 资产 DAM（版本控制底座） | ⭐ **每个版本可查找/审阅/反馈**、高清缩略图(原生多格式)、悬停动画预览、**在 .psd/3D 上手绘批注审阅**、AI 标签、Jira 追溯 | 依赖 Perforce 版本控制，重、贵，适合大团队 |
| **Anchorpoint** | 闭源 | 基于 Git 的创意版本管理 + 审阅 | 大二进制版本控制、逐帧审阅(全格式) | 需学习 Git 模型 |
| **Kitsu (cgwire/kitsu)** | **开源** | 动画/VFX 制作管理平台 | ⭐ 项目内 **资产+任务+状态+审阅playlist+权限**、仪表盘、API/DCC 集成、标准化工作流 | 偏「制作追踪」，不负责本地文件存储/索引 |
| **ShotGrid / Flow (Autodesk)** | 闭源·行业标准 | 制作管理 + 审阅批准 + 版本 | 追踪/审阅/批准/版本，创意工具内看版本历史 | 云、贵 |
| **Frame.io** | 闭源(Adobe) | 视频审阅批准 | ⭐ 云端**审阅/批准流**、帧级评论、Adobe CC 集成 | 云、偏视频 |
| **immich** | **开源** | 自托管照片/视频 | ⭐ 多用户、共享相册、**校验和去重、备份、下载到设备**、元数据/AI 搜索 | 偏个人相册，非创意工程 |
| **C4D Asset Browser / Maxon** | 闭源 | DCC 原生资产库 | 本地+云统一、元数据/关键词、智能预览、拖拽入场景 | 仅 C4D 生态 |

**结论**：没有任何一个竞品同时具备「**AIGC 创作流程内嵌 + 项目内模块化隔离资产库 + 本地优先重资产/服务器轻索引 + 团队版本审核 + 自愈备份**」——这正是本项目在单 Windows 主机 + 局域网场景下的**差异化蓝海**。最贴近的 Connecter 也只是独立浏览器、无审核流、无创作流程绑定。

---

## 3. ⚠️ 必须点破的关键矛盾（需你定一条策略）
你 Q1 说「服务器只存**关键信息(索引)**」，但 N6 又要「**备份避免本地损坏丢失**」。
**索引 ≠ 备份**：只有指纹/元数据的话，本地机器一坏，文件本体仍然找不回。要真正防丢，服务器（或指定备份盘）**必须存实际字节副本**。

**推荐折中策略（调和 Q1 与 N6）——分级存储：**
| 层级 | 存哪 | 内容 |
|------|------|------|
| L0 索引层 | 服务器主盘（轻） | 全部资产的指纹/元数据/**缩略图**（跨设备可浏览、查重、检测缺失） |
| L1 备份层 | 服务器主盘/指定备份盘 | **关键资产的真实副本**：审核通过的成片、工程文件里程碑版、用户勾选「重要」的资产（内容寻址去重存储） |
| L2 本地层 | 各自设备盘 | 制作中的全部原始媒体 + 工程源文件（体量大、频繁变动，只索引不必全备份） |

> 即：**普通工作文件本地为主+服务器索引；关键/终版资产强制服务器备份**。用户可按项目/模块设定「哪些算关键、要备份」。这样既守住「服务器轻」又能灾难恢复。**请确认是否采用此分级策略。**

---

## 4. 目标数据模型（在 35.0 基础上扩展）
```
asset_module (系统定义资产模块字典)
  key(image/video/audio/project_ps/project_ai/project_ae/project_c4d/model_3d/other)
  name, icon, default_folder, accept_ext(json), sort

project_space.modules_json        -- 该项目启用的模块(可增减)  [N1]
project_space.backup_policy        -- none|critical|all         [N6]

asset_catalog (已建, 扩展)
  + module_key, is_critical, backup_status(none|pending|backed_up), backup_path
  (已有: fingerprint/perceptual_hash/thumb_path/origin_device/local_rel_path/status...)

asset_version                      -- 版本管理 [N5]
  id, catalog_id, version_no, fingerprint, size, thumb, local_rel_path, origin_device,
  author_user_id, note, status(draft|in_review|approved|rejected), created_at
  (asset_catalog 记录 current_version_id)

asset_review                       -- 审核批准 [N5]
  id, version_id, reviewer_user_id, action(submit|approve|reject|comment), comment, created_at

backup_blob (内容寻址备份仓)        -- [N6] 去重
  fingerprint(PK), rel_store_path, size, refcount, created_at
```

---

## 5. 分期规划（聚焦「最具竞争力的 MAM」）

- **Phase35.1 项目内嵌模块化资产库（服务器托管上传）** ← 建议先做，立即可用、跨设备
  - asset_module 字典 + 建项目选模块 + 生成隔离目录（N1/N3）
  - 上传→服务器：算指纹**查重(dedup)** + 生成缩略图 + catalog 入库（N2/N6 的 L1 雏形）
  - 项目工作台内嵌资产库 UI：按模块分组网格、上传、预览、删除、重复告警
  - 交付：**任意设备可用的项目资产库 + 查重 + 服务器即备份**（无需本地代理）

- **Phase35.2 版本管理 + 验证审核 + 团队共享**（N5）
  - asset_version + asset_review + 状态流（draft→in_review→approved/rejected）
  - 团队共享项目：成员浏览/拉取/审阅批准（接现有 project_members/角色）

- **Phase35.3 本地优先 + 自检 + 自愈备份（灾难恢复）**（N4/N6 核心）
  - 设备盘索引机制落地（M-Agent 推荐 / M-FSA 需 HTTPS，见 35 主方案第 11 节）
  - **自检**：设备上报现存指纹 ↔ catalog 比对 → 缺失/损坏/移动 标记告警
  - **分级备份**：关键/审核通过资产内容寻址复制到备份层；device 挂了可下载恢复
  - 下载/恢复到新设备

- **Phase35.4 进阶体验（拉开差距）**
  - DCC 集成（C4D/PS/AE 拖拽导入导出、原生缩略图）、AI 自动标签、3D 预览
  - 审阅批注（.psd/3D 上手绘标注，仿 P4 DAM/Frame.io）、批量重命名、审阅 playlist

---

## 6. 边界（防过度开发）
- 不做公网/云；不做实时双向文件同步守护(先做「按需上传/下载/对账」而非持续 rsync)。
- 3D/AE 原生预览、DCC 深度集成放 35.4，不阻塞核心。
- 版本控制不引入 Perforce/Git 重底座，用「版本快照 + 内容寻址」轻实现。

---

## 7. 待确认
1. **分级存储策略（第 3 节）是否采用？**（调和「服务器轻」与「防丢备份」的关键）
2. 分期顺序是否按 35.1→35.2→35.3？（先服务器托管跑通，再上本地优先+备份）
3. 资产模块清单（第 4 节）是否够用？要不要加：字幕/SRT、Excel/脚本表、PR(.prproj)、Blender、AU 音频工程？
4. 「关键资产」由谁定义：用户手动勾选 / 审核通过自动纳入备份 / 按模块（如「成片输出」整模块必备份）？
