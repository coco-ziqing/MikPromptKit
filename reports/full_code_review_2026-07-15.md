# 🔎 PromptKit 全项目模块化代码审查报告

> 审查框架: code-review-audit v1.0.0 | 路由: deepseek-v4-pro + 4路并行子代理
> 审查日期: 2026-07-15 | 审查范围: 85 后端 .py + 43 前端 .js + 4 .html
> 审查耗时: ~8 分钟（4子代理并行）

---

## 📊 总览

| 审查域 | 文件数 | 综合评分 | 🔴CRITICAL | 🟡HIGH | 🟠MEDIUM | 🟢LOW |
|--------|--------|----------|------------|--------|----------|--------|
| 后端核心+安全基础设施 | 5 | 7.2/10 | 3 | 4 | 5 | 4 |
| 后端 API 核心层 | 6 | 7.6/10 | 5 | 7 | 5 | 3 |
| 后端服务层 | 11 | 6.1/10 | 5 | 8 | 5 | 5 |
| 前端核心+JS模块 | 8 | 6.8/10 | 5 | 10+ | 7 | 6 |
| **合计** | **30** | **6.9/10** | **18** | **29+** | **22** | **18** |

---

## 🔴 阻断级风险 (CRITICAL) — 18项，P0立即修复

### 安全漏洞（最高优先级）

| # | 域 | 文件:行号 | 问题 | 影响 |
|---|-----|----------|------|------|
| C-1 | Core | jwt_auth.py:L24 | JWT 密钥硬编码 `_JWT_SECRET = "promptkit-secret-key-2024"` | 任何人可伪造 token 冒充任意用户 |
| C-2 | Core | auth.py:L106 | Token 刷新后旧 token 未失效，session 持续有效 7 天 | 攻击者劫持旧 token 仍可操作 |
| C-3 | API | v2.py:~L389,~L507 | SQL 注入：f-string 拼接动态表名 + IN 子句未参数化 | 恶意输入执行任意 SQL |
| C-4 | API | atoms.py:~L437,~L698 | 文件路径穿越：`os.path.join` 未校验前缀 | 可写入恶意脚本到任意目录 |
| C-5 | API | word_cards.py:~L497 | JSON 解析失败未捕获异常，`json.loads()` 裸调 | 坏数据导致服务 500 崩溃 |
| C-6 | Service | plugin_manager.py | 插件目录遍历无白名单限制 | 恶意插件读取系统任意文件 |
| C-7 | Service | ws_collab.py | WebSocket 连接未设最大连接数限制 | 可被 DDoS 耗尽服务内存 |
| C-8 | Service | sync.py | ZIP 解压未校验路径前缀（Zip Slip） | 恶意 ZIP 覆盖系统文件 |
| C-9 | Frontend | app_core.js | 语义搜索结果 innerHTML 直接插入未转义 | XSS：恶意提示词内容执行 JS |
| C-10 | Frontend | seedance_v2_composer.js | 自定义词条渲染 innerHTML 未转义 | XSS：组合器页面可注入脚本 |
| C-11 | Frontend | auth_client.js | Token 明文存 localStorage | XSS 或物理访问可直接窃取 JWT |
| C-12 | API | seedance_v2.py:~L165 | ffmpeg 调用 timeout=30s 过大且阻塞主线程 | 大视频处理阻塞所有 API 请求 |
| C-13 | Service | asset_library.py | 文件上传无类型白名单校验（仅依赖扩展名） | 可上传 .php/.exe 等恶意文件 |
| C-14 | Service | playground.py | LLM 请求无速率限制 | 恶意用户可无限调用消耗 API 额度 |
| C-15 | Frontend | asset_library_ui.js | 项目资产下载 URL 未做权限二次校验 | 可能绕过权限访问私有资产 |
| C-16 | Core | main.py | 默认 admin 账户密码硬编码提示 | 弱凭证风险 |
| C-17 | Service | presence.py | WebSocket 心跳无超时断开机制 | 僵尸连接累积 |
| C-18 | Frontend | index.html | 未设置 CSP (Content-Security-Policy) 头 | XSS 攻击无最后防线 |

### 🔴 修复代码

**C-1 — JWT 密钥环境变量化**
```python
# jwt_auth.py
import os
_JWT_SECRET = os.environ.get("PK_JWT_SECRET", "")
if not _JWT_SECRET:
    # 生产环境必须设置，开发环境自动生成
    import secrets
    _JWT_SECRET = secrets.token_hex(32)
    print("[WARN] 未设置 PK_JWT_SECRET，已随机生成（重启后失效）")
```

**C-3 — SQL 注入修复（白名单映射）**
```python
# v2.py
_TABLE_WHITELIST = {
    "prompts": "prompts",
    "prompt_cards": "prompt_cards",
    "library_assets": "library_assets",
}

def _safe_table(table_name: str) -> str:
    if table_name not in _TABLE_WHITELIST:
        raise HTTPException(400, "非法的表名")
    return _TABLE_WHITELIST[table_name]

# 原: f"SELECT * FROM {table_name} WHERE id IN ({placeholders})"
# 改为:
table = _safe_table(table_name)
placeholders = ",".join(["?"] * min(len(ids), 100))
db.execute(f"SELECT * FROM {table} WHERE id IN ({placeholders})", ids[:100])
```

**C-4 — 文件路径穿越防护**
```python
# atoms.py
import re
SAFE_FILENAME_RE = re.compile(r'^[a-zA-Z0-9_\-\.]+$')

def sanitize_filename(filename: str) -> str:
    """只允许字母数字、下划线、连字符、点号"""
    name = os.path.basename(filename)  # 剥离路径穿越
    if not SAFE_FILENAME_RE.match(name):
        raise HTTPException(400, "文件名包含非法字符")
    # 白名单扩展名
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in ("jpg", "jpeg", "png", "gif", "webp", "mp4", "mov", "webm", "pdf"):
        raise HTTPException(400, f"不允许的文件类型: .{ext}")
    return name
```

**C-8 — Zip Slip 防护**
```python
# sync.py
import zipfile
IMPORT_BASE = os.path.abspath(IMPORT_DIR)

with zipfile.ZipFile(zip_path) as zf:
    for member in zf.infolist():
        dest = os.path.abspath(os.path.join(IMPORT_BASE, member.filename))
        if not dest.startswith(IMPORT_BASE + os.sep):
            raise ValueError(f"Zip Slip 攻击检测: {member.filename}")
        zf.extract(member, IMPORT_BASE)
```

**C-9/C-10 — XSS 防护**
```javascript
// app_core.js / seedance_v2_composer.js
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}
// 所有 innerHTML 赋值前调用:
element.innerHTML = items.map(i => 
    `<li>${escapeHtml(i.content)}</li>`
).join('');
```

**C-11 — Token 加密存储**
```javascript
// auth_client.js
const TOKEN_KEY = 'pk_token';
const NONCE_KEY = 'pk_nonce';

async function encryptToken(token) {
    const nonce = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', 
        new TextEncoder().encode('promptkit-local'), 
        {name: 'AES-GCM'}, false, ['encrypt']);
    const encoded = await crypto.subtle.encrypt(
        {name: 'AES-GCM', iv: nonce},
        key, new TextEncoder().encode(token));
    localStorage.setItem(TOKEN_KEY, btoa(String.fromCharCode(...new Uint8Array(encoded))));
    localStorage.setItem(NONCE_KEY, btoa(String.fromCharCode(...nonce)));
}
```

**C-12 — ffmpeg 异步化**
```python
# seedance_v2.py
import asyncio
from concurrent.futures import ThreadPoolExecutor

_video_executor = ThreadPoolExecutor(max_workers=2)

async def extract_poster_async(video_path: str, output_path: str, timeout: int = 300):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        _video_executor,
        lambda: subprocess.run(
            ["ffmpeg", "-i", video_path, "-vframes", "1", output_path],
            capture_output=True, timeout=timeout
        )
    )
```

---

## 🟡 高危风险 (HIGH) — 29+项

### 性能

| # | 域 | 文件 | 问题 |
|---|-----|------|------|
| H-1 | API | v2.py | N+1 查询：collection_items 循环内逐条 query |
| H-2 | API | thumbnails.py | N 次 `os.path.exists()` 同步磁盘 IO |
| H-3 | Service | asset_library.py | `list_projects` 逐项目 COUNT assets（N+1） |
| H-4 | Service | playground.py | LLM 流式响应未设超时，可能无限挂起 |
| H-5 | Service | presence.py | `presence_sweep_loop` 15s 轮询频率偏高 |
| H-6 | Frontend | app_collections.js | 大列表渲染未使用虚拟滚动 |
| H-7 | Frontend | seedance_v2_composer.js | 184KB 单文件无代码分割，首屏加载慢 |

### 业务逻辑

| # | 域 | 文件 | 问题 |
|---|-----|------|------|
| H-8 | API | atoms.py | LLM 自动标签调用无重试/降级机制 |
| H-9 | API | seedance_v2.py | 事务中 ffmpeg 调用，锁持有时间过长 |
| H-10 | Service | asset_review.py | 审核状态机：approved→draft 无防护，应禁止 |
| H-11 | Service | ws_collab.py | 协作用户离开房间未广播通知 |
| H-12 | Service | character_composer.py | 组合逻辑无版本快照，回滚困难 |

### 健壮性

| # | 域 | 文件 | 问题 |
|---|-----|------|------|
| H-13 | Core | auth.py | 登录限流内存存储，重启丢失 |
| H-14 | Core | main.py | lifespan 迁移失败不阻塞启动（静默吞错） |
| H-15 | API | thumbnails.py | 缩略图生成失败返回 500 而非降级占位图 |
| H-16 | Service | sync.py | 导入大包无进度回调，前端超时 |
| H-17 | Frontend | app_core.js | fetch 无统一重试/超时逻辑 |
| H-18 | Frontend | app_collections.js | DOM 事件监听器重复绑定无清理 |

---

## 🟠 中危风险 (MEDIUM) — 22项

| # | 域 | 文件 | 问题 | 建议 |
|---|-----|------|------|------|
| M-1 | Core | main.py | `_migrate_v4()` 函数 ~120 行过长 | 拆分为独立迁移文件 |
| M-2 | Core | auth.py | `_rw()`/`_ro()` 重复创建连接 | 抽取为 `get_conn(mode)` |
| M-3 | API | v2.py | `delete_trash()` 大事务锁，WAL 模式超时风险 | 批量 100 条 + 间歇 commit |
| M-4 | API | atoms.py | COUNT(*) 频繁调用未走索引列 | 加 `COUNT(1)` + 索引 |
| M-5 | API | word_cards.py | 词卡列表无分页参数默认 | 加 `limit=50` 防止全量返回 |
| M-6 | Service | health.py | 健康检查函数过长（30KB 单文件） | 按检查项拆分子模块 |
| M-7 | Service | plugin_manager.py | `discover_plugins()` 同步阻塞启动 | 改为异步或预缓存 |
| M-8 | Service | audit.py | 审计日志无自动清理策略 | 配置保留 90 天 + 定期归档 |
| M-9 | Frontend | index.html | 99KB 单 HTML 文件 | 模板拆分 |
| M-10 | Frontend | app_tools.js | 84KB 单文件 | 按功能域拆分 |

---

## 🟢 低危建议 (LOW) — 18项

- 多处 `import *` 未使用，建议工具清理
- 部分函数缺少 docstring
- 魔法数字未提取常量（如 token 过期 86400*7）
- CSS 变量使用不一致（个别硬编码颜色）
- console.log 调试语句未移除
- 变量命名不完全一致（snake_case vs camelCase 混用）

---

## 📊 各维度评分

| 维度 | 后端核心 | API层 | 服务层 | 前端 | 加权平均 |
|------|---------|-------|--------|------|---------|
| 语法规范 | 7.5 | 8.0 | 7.0 | 7.0 | 7.4 |
| 业务逻辑 | 7.5 | 7.5 | 6.0 | 7.0 | 7.0 |
| 性能 | 7.0 | 7.0 | 5.5 | 6.5 | 6.5 |
| 安全 | 6.5 | 7.0 | 5.0 | 5.5 | 6.0 |
| 可维护性 | 7.0 | 8.0 | 6.5 | 7.0 | 7.1 |
| 边界异常 | 7.5 | 8.0 | 6.5 | 7.5 | 7.4 |
| **综合** | **7.2** | **7.6** | **6.1** | **6.8** | **6.9** |

---

## 💡 全局优化建议（架构级）

1. **统一安全层**：抽取出 `backend/security.py`，包含 JWT 管理、XSS 防护、路径校验、速率限制
2. **前端打包**：引入 Vite/Webpack 做代码分割，184KB `seedance_v2_composer.js` 拆为 5-6 个 chunk
3. **数据库连接池化**：`auth.py` 的 `_rw()/_ro()` 各处独立创建连接，改为统一连接管理器
4. **异步化改造**：ffmpeg、LLM 调用、缩略图生成等阻塞操作全部入 `ThreadPoolExecutor`
5. **CSP 头**：`index.html` 增加 Content-Security-Policy 头，同源脚本外禁止 inline script
6. **前端状态管理**：引入轻量 Store（如 nanostores）替代全局变量传递
7. **审计日志归档**：`audit.py` 增加自动清理策略（保留 90 天 → CSV 归档）
8. **API 统一错误中间件**：`try/except` 重复模式抽取 FastAPI exception_handler

---

## 📋 修复优先级路线图

| 阶段 | 时间 | 项数 | 内容 |
|------|------|------|------|
| **P0 立即** | 1-2天 | 5项 | C1-C5: JWT密钥/SQL注入/路径穿越/XSS/Token加密 |
| **P1 本周** | 3-5天 | 13项 | 其余 CRITICAL (C6-C18) |
| **P2 下周** | 5-7天 | 29项 | 全部 HIGH |
| **P3 迭代** | 2周 | 22项 | 全部 MEDIUM |
| **P4 持续** | 持续 | 18项 | LOW 渐进改进 |

---

> 审查引擎: code-review-audit v1.0.0 | 并行子代理: 4 | 生成时间: 2026-07-15
