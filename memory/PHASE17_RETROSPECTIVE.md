# Phase17 诊断引擎 + 全链路修复 — 开发总结

> Tag: `v5.1.0-phase17-diagnostics` | 2026-07-01 17:33 GMT+8  
> 16 commits | 19 files | +1277/-320 行

---

## 一、修复内容总览

### 1. 缩略图系统（8 项修复）

| # | Bug | 根因 | 修复 |
|---|-----|------|------|
| 1 | 所有词卡缩略图 404 | `/api/thumbnails/file/` 只查旧目录 `data/thumbnails/`，不查 `data/wc_media/thumbs/` | 3 个端点添加 wc_media fallback |
| 2 | 缩略图上传感 100x67 像素模糊 | 尺寸太小 | 升级到 320x213，CSS `object-fit:cover` 自适应 |
| 3 | 原图查看显示缩略图 | `openImageViewer` 传入 thumbnail UUID 而非 original_ref | 新增 `original_ref` 列 + 原图归档 `wc_media/originals/` |
| 4 | 上传后点保存缩略图消失 | `cardModel._normalize` 无条件填充 `thumbnail:""` → PUT 覆盖 | 条件展开：仅显式传入时包含 |
| 5 | 上传报 500 `database is locked` | `async def upload` 在 `await file.read()` 前持 DB 锁 | 先读文件+Pillow处理，最后再开 DB |
| 6 | 上传报 500 `unsupported operand type for @` | `return` 后缺换行，与下一行 `@router.delete` 拼接 | 加空行分隔 |
| 7 | 新建词卡无法上传缩略图 | `_uploadThumb` 检查 `!this._cardId` 直接 return | 新建模式暂存 File/图库源 → 保存后自动 POST |
| 8 | 从图库选按钮无效 | `_openThumbnailModal` 无条件清空回调 `_onThumbnailSelected=null` | 调用者先设回调再打开弹窗 |

### 2. 收藏夹系统（4 项修复）

| # | Bug | 根因 | 修复 |
|---|-----|------|------|
| 9 | word_card 词卡收藏后不显示 | `list_collection_items` 只 JOIN `prompts` 表 | 同时 JOIN `word_card` 表合并结果 |
| 10 | 新建收藏分组按钮无效 | `openAddPromptModal` 被误重命名为 `createCollection`，影子覆盖真实现 | 恢复正确函数名 |
| 11 | 收藏图标显示乱码 | `_escape(c.icon)` 对 emoji HTML 编码 | 去掉 `_escape` |
| 12 | 最近使用崩溃 `p is not defined` | `for (const card of items)` 但模板引用 `p` | `p` → `card` |

### 3. 运行日志诊断引擎（新增 10+ 端点）

| 模块 | 文件 | 功能 |
|------|------|------|
| 结构化日志 | `logger.py` | `runtime_log` 表（1956 条存量），级别/来源/栈/请求体 |
| 行为追踪 | `action_logger.py` | `user_actions` 表，20+ 方法自动埋点注入 |
| 面包屑 | `breadcrumb_logger.py` | `error_breadcrumbs` 表，错误前 40 条事件上下文 |
| 前端捕获 | `diag_capture.js` | `window.onerror` + `unhandledrejection` + XHR/fetch hook 注入 `X-Request-ID` |
| 日志查看器 | `log_viewer.js` | 右侧滑出面板 + 全屏弹窗双模式，SSE 实时流，📋一键复制错误 |
| API | `api/logs.py` | 6 个查询/上报/清理端点 |

### 4. 数据库稳定性（3 项修复）

| # | 问题 | 修复 |
|---|------|------|
| 13 | `safe_commit` 3 次重试不够，频繁 `database is locked` | 15 次重试 + 5 次失败后 `PRAGMA wal_checkpoint(PASSIVE)` |
| 14 | 批量删除 `is_builtin=0` 词卡被物理 DELETE | 统一软删除 `is_deleted=1` |
| 15 | 语义索引重建阻塞 Uvicorn 事件循环 12 秒 | 改为 `threading.Thread(daemon=True)` 后台运行 |

### 5. 前端修复（4 项）

| # | 问题 | 修复 |
|---|------|------|
| 16 | `app_media.js:482 SyntaxError` | 删除编辑合并残留的 5 行孤儿代码 |
| 17 | `bindVideoHover is not a function` 每页报错 | `typeof` 守卫检查 |
| 18 | ESC 关闭多个弹窗冲突 | `closeAny` 按 z-index 优先级逐层关闭 |
| 19 | 日志 SyntaxError 噪声（1548 条）| 浏览器扩展注入过滤（`:1` 来源检测） |

---

## 二、经验教训

### 1. 规则：上传 endpoint 中 DB 锁只在最后获取
**教训**: `async def upload` 中任何 `await` 都会出让事件循环。如果在 `await` 前持有 DB 连接，其他协程可能同时写库导致 `database is locked`。

**防止方法**: 
```
❌ db = get_db() → validate → await file.read() → db.execute → commit
✅ validate ext → await file.read() → Pillow处理 → db = get_db() → execute → commit
```

### 2. 规则：`cardModel._normalize` 只能用条件包含媒体字段
**教训**: 无条件填充 `thumbnail: data.thumbnail || ''` 意味着每次 PUT 都会发送 `thumbnail=""`，覆盖已上传的值。保存按钮不传 thumbnail → 后端收到空字符串 → DB 被覆盖。

**防止方法**: `...(('thumbnail' in data) ? {thumbnail: data.thumbnail} : {})`

### 3. 规则：回调设置必须在 `_openThumbnailModal` 之前
**教训**: `_openThumbnailModal` 历史代码在函数开头写 `this._onThumbnailSelected = null`，调用者在之后设置的 callback 被覆盖。用户点击图库缩略图时 callback 是 null → 静默失败。

**防止方法**: 弹窗打开函数不做副作用清理。调用者在调用前自行清理旧回调。

### 4. 规则：收藏夹必须同时 JOIN 两张数据表
**教训**: `prompts` 表（旧）和 `word_card` 表（新）并存。任何查询收藏/历史/搜索的 endpoint 都必须双表 JOIN，否则新的 word_card 词卡全部隐形。

**防止方法**: 每个列表查询端点先查 prompts 再查 word_card → 合并结果 → 按时间排序 → 分页。

### 5. 规则：前端 placeholder 图片缩略图不能固定尺寸
**教训**: Pillow 把上传图片裁剪成 100x67，在不同列数（1-6）下要么模糊（大卡）要么浪费带宽。320x213 是合适的基准尺寸——1-2 列清晰，3-6 列 CSS `object-fit:cover` 降采样无锯齿。

### 6. 经验：日志系统应在开发早期建设
**教训**: 今天 3 小时内靠日志系统精准定位了 8 个隐藏 Bug（DB 锁/Breadcrumb 422/语义索引阻塞 WAL）。如果起始就有日志，Phase13-16 的 Bug 排查时间至少缩短 60%。

### 7. 经验：`sendBeacon` 发 `text/plain`，后端必须手动解析 JSON
**教训**: `navigator.sendBeacon` 不支持自定义 Content-Type，Pydantic `BaseModel` 收到 `text/plain` 返回 422。后端 breadcrumbs endpoint 必须从 `await request.body()` 手动 JSON 解析。

---

## 三、Git 变更统计

```
19 files changed, 1277 insertions(+), 320 deletions(-)

新增文件:
  backend/action_logger.py          155 行  — 用户行为追踪
  backend/breadcrumb_logger.py       64 行  — 错误面包屑
  frontend/static/js/diag_capture.js 378 行  — 全局错误捕获+行为埋点

核心修改:
  backend/api/word_cards.py         80 行  — 缩略图管线+软删除+500修复
  backend/api/v2.py                 83 行  — 收藏双表JOIN+重试
  backend/api/logs.py              117 行  — 日志API+面包屑
  frontend/static/js/word_editor.js 130 行  — 新建词卡缩略图+视频预览
  frontend/static/js/log_viewer.js  209 行  — 右侧面板+全屏双模式
  frontend/static/js/app_media.js   163 行  — 查看器精简+回调修复
  backend/database.py               16 行  — safe_commit 15次重试+checkpoint
```

## 四、日志存量快照

| 指标 | 清理前 | 清理后 |
|------|--------|--------|
| runtime_log 总量 | 2890 条 | 744 条 |
| ERROR | 1802 条 | 236 条 |
| INFO | 893 条 | 483 条 |
| WARN | 195 条 | 25 条 |
| 噪声（SyntaxError 注入）| 1548 条 | 0 条 |
| 旧 Bug（char_info）| 3 条 | 0 条 |
| 重复条目 | ~400 条 | 0 条 |

---

## 五、下一步建议

1. **P0**: 把日志系统日志自动归档 cron（每周清 7 天前日志）
2. **P1**: `collection_items` 表添加 `unique(collection_id, prompt_id)` 约束
3. **P1**: 语义索引重建改为事件驱动（新词卡创建时增量更新），非全量重建
4. **P2**: 缩略图缓存 — 前端加 `?v=thumbnail_hash` 防浏览器缓存过期
5. **P2**: DB WAL 大小监控告警（> 5MB 自动 checkpoint）
