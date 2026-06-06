# PromptKit — 项目完整备份快照

> **生成时间**: 2026-06-04 09:38 CST  
> **版本**: v3.10.23  
> **Git Tag**: v3.10.23 (最新) — Git tags 仅到 v3.9.3，需补充打标  
> **工作目录**: `C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev`

---

## 1. 项目规模总览

| 维度 | 数值 |
|------|------|
| 后端源码文件 | 14 个 (≈5,748 行) |
| 前端源码文件 | 3 个 (≈7,709 行) |
| 源码总计 | **≈13,931 行 / 704 KB** |
| API 端点 | **110+** |
| 数据库表 | **23 张** |
| 提示词词条 | **206 条**（内置+自定义） |
| 用户自定义词条 | ≈41 条 (206 - 165 种子) |

### 模块分布
- 表情 / 色彩 / 色调 / 构图 / Seedance — 5 大模块

### 媒体资产
| 类型 | 数量 | 大小 |
|------|------|------|
| 缩略图 | 287 个 | 11.64 MB |
| 原图 | 236 个 | 418.15 MB |
| 视频 | 23 个 | 354.76 MB |
| `.pkb` 备份包 | 1 个 | 518.86 MB |

### 收藏与词包
| 类型 | 数量 |
|------|------|
| 收藏分组 | 2 个 |
| 收藏条目 | 3 个 |
| 词包 | 1 个 |
| 词包条目 | 2 个 |
| 自动备份历史 | 5 次 |

---

## 2. 完整文件清单

### 后端 (backend/)
| 文件 | 行数 | 字节 | 说明 |
|------|------|------|------|
| `main.py` | 273 | 10,941 | FastAPI 入口，挂载全部路由 |
| `database.py` | 298 | 13,471 | SQLite 23表定义 + WAL + FTS5 |
| `seed_data.py` | 311 | 32,995 | 165条种子数据（5模块） |
| `backup.py` | 224 | 8,444 | 自动备份核心 |
| `sync.py` | 360 | 14,412 | .pkb 完整打包/恢复 |
| `semantic.py` | 161 | 6,053 | sentence-transformers 语义搜索 |
| `exporter.py` | 413 | 17,411 | 导出 TXT/JSON/Markdown |
| `api/prompts.py` | 289 | 13,321 | 提示词 CRUD |
| `api/v2.py` | 940 | 40,869 | 收藏/词包/历史/推荐/主题 |
| `api/seedance.py` | 256 | 11,315 | Seedance 模板/组装/画廊 |
| `api/thumbnails.py` | 915 | 40,626 | 缩略图/视频上传/裁剪/压缩 |
| `api/exporter.py` | 173 | 7,079 | 批量导出 |
| `api/versions.py` | 128 | 4,485 | 版本管理 |
| `api/playground.py` | 149 | 6,004 | LLM Playground |
| `api/tags.py` | 58 | 2,012 | 标签管理 |
| `api/stats.py` | 77 | 3,048 | 统计 |
| `api/templates.py` | 51 | 1,599 | 模板变量 |
| `api/workflow.py` | 111 | 4,690 | AI Workflow API |
| `api/comfyui.py` | 507 | 22,880 | ComfyUI 缩略图生成 |
| `api/ocr.py` | 528 | 23,706 | OCR 截图导入 |

### 前端 (frontend/)
| 文件 | 行数 | 字节 | 说明 |
|------|------|------|------|
| `index.html` | 721 | 73,493 | 主页面（含10+模态框） |
| `static/js/app.js` | 5,617 | 300,656 | SPA 单页应用 (≈6300 行原稿) |
| `static/css/style.css` | 1,371 | 44,618 | 完整样式（深色/浅色主题） |

### 浏览器扩展 (browser-extension/)
| 文件 | 说明 |
|------|------|
| `manifest.json` | Chrome 扩展清单 |
| `background.js` | 后台脚本 |
| `content.js` | 内容注入脚本 |
| `popup.html` | 弹窗界面 |
| `popup.js` | 弹窗逻辑 |

### 项目根配置
| 文件 | 说明 |
|------|------|
| `start.bat` | 一键启动（含端口检测+防火墙提示） |
| `firewall_open.bat / .ps1 / .vbs` | 防火墙放行脚本（3种方式） |
| `requirements.txt` | Python 依赖 |
| `.gitignore` | Git 忽略规则 |
| `CHANGELOG.md` | 版本变更日志 |
| `VERSION` | 版本号文件 |
| `VERSIONING.md` | 版本管理规范 |
| `DEV.md` | 开发说明 |
| `TECH_STACK.md` | 技术栈说明 |
| `WORKFLOW.md` | 工作流文档 |
| `RULE.md` | 编码规范 |
| `BUG_REPORT.md` | 排错手册 |
| `CAPABILITY.md` | 能力说明 |
| `AGENTS.md` | Agent 角色规则 |
| `SOUL.md` | 人格设定 |
| `IDENTITY.md` | 身份定义 |
| `USER.md` | 用户信息 |
| `TOOLS.md` | 工具配置 |
| `MEMORY.md` | 长期记忆 |
| `HEARTBEAT.md` | 心跳自检清单 |

### 记忆目录 (memory/)
| 文件 | 说明 |
|------|------|
| `2026-05-29.md` ~ `2026-06-02.md` | 每日开发日志 |
| `DEVELOPMENT_ROADMAP.md` | 开发路线图 |
| `competitor_analysis_v3.6.0.md` | 竞品分析（12款工具） |
| `deep_analysis_v3.6.0.md` | 深度分析 |

---

## 3. 网络配置

| 配置项 | 值 |
|--------|-----|
| 内网IP | **http://192.168.0.103** |
| 端口 | **8080** |
| 访问地址 | **http://192.168.0.103:8080** |
| 防火墙规则 | PromptKit / PromptKit 8080 — 已放行 |
| 网络类型 | WiFi 专用网络 |
| 备用通道 | Tailscale |

---

## 4. Git Tag 节点

```
v3.8.1 → v3.9.0 → v3.9.1 → v3.9.2 → v3.9.3
```
后续提交(v3.10.0 ~ v3.10.23) **尚未打标**，需补充:
- `v3.10.0` — 后端媒体资产管理库
- `v3.10.4` — 粘贴剪贴板图片HTTP修复
- `v3.10.5` — 粘贴弹窗激活监听
- `v3.10.9` — OCR截图导入保存原图
- `v3.10.13` — 模块切换标题修复
- `v3.10.21` — 拖入缩略图替换+Ctrl+Z
- `v3.10.22` — PNG拖拽导入修复
- `v3.10.23` — 非编辑模式禁用拖入导入 (最新)

---

## 5. 启动与访问

```bash
# 直接启动
python backend/main.py

# 一键启动
.\start.bat

# 浏览器访问
http://192.168.0.103:8080
```

### 防火墙排错
如需重新放行端口，管理员 PowerShell:
```powershell
.\firewall_open.ps1
```

---

## 6. 数据库 WAL 模式

当前数据库文件:
- `data/prompts.db` — 主文件 (680 KB)
- `data/prompts.db-wal` — WAL 日志 (4.1 MB)
- `data/prompts.db-shm` — 共享内存 (33 KB)

> ⚠ 关闭前如未调用 `PRAGMA wal_checkpoint;`，WAL 可能含未合并数据。
> 下次启动时自动合并，无需手动操作。

---

## 7. 下次开发说明

打开后请先执行:
1. `cd C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev`
2. `python backend/main.py` 启动服务
3. `git tag -a v3.10.23 -m "非编辑模式禁用拖入导入"` 补充 tag
4. 查看 `MEMORY.md` + `DEV.md` 了解当前进度

> **重要**: 下次会话打开后，先读取 `PROJECT_SUMMARY.md`、`MEMORY.md`、`HEARTBEAT.md` 恢复上下文。

---

_备份快照结束 — 2026-06-04 09:38 CST_
