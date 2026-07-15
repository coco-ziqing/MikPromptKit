# PLAN Phase35.3 — 设备盘索引 + 自动内容检测 + 服务器备份监控

> 2026-07-15 立项。用户确认原则：**轻量化、免安装、支持多端管理、服务器备份监控**。
> 边界（不可违反）：纯局域网、不上云、无公网暴露、Windows 服务器、数据本地。

---

## 一、目标能力

| # | 能力 | 说明 |
|---|------|------|
| 1 | 设备盘索引 | 各成员设备本地磁盘的项目资产内容（工程源文件/媒体）纳入服务器中心索引（L0 索引层，只存指纹+元数据，不搬文件） |
| 2 | 自动内容检测 | 指定监控路径内 新增/修改/删除/移动 自动发现，无需手动上报 |
| 3 | 检测提醒 | 新内容 → 通知"检测到新文件，是否归档到项目资产？"；缺失/损坏 → 管理面板红色告警 |
| 4 | 指定存储路径 | 每设备可配置多个监控目录（白名单制，Agent 只读白名单内路径） |
| 5 | 多端管理 | 服务器 WebUI 统一查看/管理所有设备：在线态/监控路径/索引量/缺失数/备份覆盖率 |
| 6 | 服务器备份监控 | 关键资产（is_critical）从设备盘自动上传真实字节到服务器 L1 备份层（内容寻址去重），备份状态全程可视 |

## 二、技术选型（已按用户原则裁决）

| 方案 | 免安装 | 多端 | 自动检测 | 结论 |
|------|--------|------|---------|------|
| M-FSA 浏览器 File System Access | ✅ 纯浏览器 | ❌ 仅 Chromium，iOS/Safari 不支持；需局域网 HTTPS 自签 | ❌ 页面开着才能扫 | 弃（留作后续补充通道） |
| M-Agent 安装版服务 | ❌ 需安装 | ✅ | ✅ | 弃 |
| **M-Agent 绿色便携版（选定）** | ✅ 单文件 EXE（PyInstaller onefile）双击即跑，零安装零注册表；开发期直接 `python pk_agent.py` | ✅ Windows 工作站全覆盖（Mac 可跑 py 脚本）；手机/平板本身无工程文件，走 WebUI 管理端 | ✅ 常驻轮询增量扫描 | **采用** |

理由：工程源文件（C4D/AE/PS）只存在于 Windows/Mac 工作站，移动端只需"看"（管理面板是 WebUI，天然多端）。绿色单文件满足"免安装"，且不受浏览器 HTTPS/兼容性约束。

## 三、架构

```
┌─设备A (Windows工作站)─┐      ┌─────────── 服务器 (192.168.0.101:8080) ───────────┐
│ pk_agent.exe (绿色单文件)│HTTP │ /api/device/* (Agent通道, X-Device-Token)          │
│  · 配对码注册→拿token   │────▶│  register/heartbeat/index-batch/tasks/upload      │
│  · 增量扫描白名单目录    │      │ 数据: device / device_watch_path / device_file_index│
│  · 新增→上报指纹+元数据  │      │ L1备份: data/backup_store/<sha2>/<sha256> 内容寻址   │
│  · 领任务→上传critical  │      │ 完整性自检: 索引 vs 上报 diff → missing/changed 告警 │
└───────────────────────┘      │ /api/devices/* (管理通道, JWT admin/owner)          │
┌─设备B (Mac, python脚本)─┐────▶│  设备列表/路径配置/告警/备份覆盖率面板               │
└───────────────────────┘      │ 提醒: 通知中心(铃铛) + 设备面板徽章                  │
        手机/平板 ────────────────▶ WebUI 管理面板（只管理不扫描）                      │
                               └────────────────────────────────────────────────────┘
```

## 四、数据模型（migrate_phase35_3.py，幂等+快照）

```sql
device (
  id, name, platform,           -- 设备名/win|mac|linux
  token_hash,                   -- 配对后凭证(sha256存储)
  owner_user_id,                -- 归属账户
  agent_version, last_seen_at,  -- 在线判定: last_seen < 90s
  status,                       -- active|revoked
  created_at
)
device_watch_path (
  id, device_id, abs_path,      -- 监控目录（Agent 端白名单）
  module_hint,                  -- 可选：默认归类模块(project_c4d/image...)
  project_space_id,             -- 可选：绑定到某项目资产库
  enabled, created_at
)
device_file_index (             -- L0 设备盘索引（中心侧）
  id, device_id, watch_path_id,
  rel_path, filename, ext, size, mtime,
  fingerprint,                  -- sha256（大文件 sz:size:name 快速指纹）
  state,                        -- new|indexed|changed|missing|archived
  catalog_id,                   -- 已归档→关联 asset_catalog
  first_seen_at, last_seen_at,
  UNIQUE(device_id, rel_path)
)
backup_task (                   -- L1 备份队列
  id, catalog_id, device_id, file_index_id,
  fingerprint, size, state,     -- pending|uploading|done|failed
  attempts, created_at, done_at
)
-- asset_catalog 复用既有 backup_status/backup_path/is_critical 列
```

## 五、Agent 设计（`agent/pk_agent.py` → 打包 `pk_agent.exe`）

- **零依赖**：仅 Python 标准库（urllib/hashlib/json/threading），单文件 <1000 行，打包后约 8MB。
- **配对**：首次运行输入 `服务器地址 + 6位配对码`（管理面板生成，5分钟有效）→ 换取永久 device token（存旁边 `pk_agent.ini`）。
- **扫描策略（轻量化核心）**：
  - 周期轮询（默认 60s，可配）；目录树遍历只比对 `size+mtime`，两者未变直接跳过（零 IO 读取）；
  - 变化/新增才算 sha256（>500MB 用 `sz:size:name` 快速指纹）；
  - 单次上报批量打包（≤500 条/批），服务器返回 diff 结果与待办任务。
- **任务通道**：心跳响应中携带任务：`upload`（critical 文件上传备份）/ `rescan` / `update_paths`（服务器下发新监控路径）。
- **上传**：分块 POST（8MB/块，断点续传按块号），服务器落 `data/backup_store/<sha256[:2]>/<sha256>`，同指纹秒传（内容寻址天然去重）。
- **资源占用**：空闲时纯 sleep；扫描线程单线程低优先级；内存 <50MB。

## 六、服务器端

### Agent 通道 `/api/device/*`（X-Device-Token 鉴权，独立于 JWT）
| 端点 | 用途 |
|------|------|
| POST /api/device/register | 配对码 → 发 token |
| POST /api/device/heartbeat | 心跳 + 领任务 |
| POST /api/device/index-batch | 批量上报文件索引（新增/变更/消失） |
| POST /api/device/upload/{task_id} | 分块上传备份字节 |

### 管理通道 `/api/devices/*`（JWT，owner 管自己设备 / admin 管全部）
| 端点 | 用途 |
|------|------|
| GET /api/devices | 设备列表（在线态/索引量/缺失数/备份覆盖率） |
| POST /api/devices/pair-code | 生成配对码 |
| PUT/DELETE /api/devices/{id} | 改名/吊销 |
| GET/POST/DELETE /api/devices/{id}/paths | 监控路径管理（服务器下发） |
| GET /api/devices/{id}/files | 该设备索引浏览（按 state 筛选） |
| POST /api/device-files/{fid}/archive | 手动归档：索引条目 → asset_catalog（选项目/模块） |
| GET /api/devices/alerts | 全局告警：missing/changed/备份失败 |

### 完整性自检（接现有 30min 心跳自检体系）
- Agent 每次全量扫描即一次自检：上报清单与 device_file_index diff → 未出现的标 `missing`，指纹变化标 `changed`；
- 已归档且 critical 的资产若源文件 missing 且无 L1 备份 → **红色告警**（数据丢失风险）；有 L1 备份 → 提示可恢复。

### 提醒（复用现有通知中心/铃铛 + 审计）
- `new` 状态文件聚合通知："设备A 检测到 12 个新文件 → 去归档"；
- missing/备份失败 → 面板红徽章 + 通知；
- 审计埋点：device_register/device_revoke/device_backup_done 等。

## 七、前端（自包含 `device_manager_ui.js`，不侵入现有模块）

- 入口：「项目」下拉 → 「💻 设备盘索引」；
- 设备卡：在线灯(绿/灰)/平台图标/最后心跳/索引数/新增数/缺失数/备份覆盖率进度条；
- 设备详情：监控路径管理（增删/绑定项目）+ 文件索引表（state 筛选 + 批量归档）+ 告警时间线；
- 配对弹窗：生成 6 位配对码 + 倒计时 + Agent 使用说明。

## 八、分期交付

| 期 | 内容 | 验收 |
|----|------|------|
| **35.3a 服务器地基** | 迁移 4 表 + Agent 通道 API + 管理通道 API + 配对机制 | 回归脚本：配对→注册→心跳→上报→diff→归档 全链路 |
| **35.3b Agent 便携端** | pk_agent.py（扫描/指纹/批量上报/任务） + pyinstaller 打包 start 脚本 | 真机双设备实测：本机 + 局域网另一台 Windows |
| **35.3c 备份+自检+提醒** | 分块上传→L1 内容寻址落盘 + missing/changed 告警 + 通知接入 + 前端面板 | critical 资产端到端：检测→归档→自动备份→拔盘模拟丢失→告警→恢复 |

## 九、风险与对策

| 风险 | 对策 |
|------|------|
| 大目录首扫慢 | size+mtime 跳扫 + 分批上报 + 后台线程；首扫进度回报心跳 |
| 磁盘占用（L1 备份） | 内容寻址去重 + 仅 critical 入 L1 + 面板显示 backup_store 用量（接现有磁盘自检） |
| Agent token 泄露 | token 仅局域网可用 + 可吊销 + hash 存储 + 绑定 owner |
| 服务器 IP 变更 | Agent 支持 ini 改地址；后续可加 UDP 局域网广播发现（可选） |
| Windows 防火墙 | Agent 是出站 HTTP 请求，无需入站放行（仅服务器 8080 已放行即可） |
