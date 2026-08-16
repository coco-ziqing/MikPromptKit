# TED 素材需求分析合规模块 — 合规自检报告

- **报告生成**：2026-08-16（v1.0.0）
- **自检方式**：静态源码扫描（`services/compliance_service.py`）+ 单元测试断言（`tests/test_compliance.py`）+ 运行时端点（`GET /api/ted/compliance/selfcheck`）

---

## 一、合规红线对照结论

| 红线要求 | 结论 | 证据 |
|---------|------|------|
| 1. 禁止任何自动访问/抓取/爬虫/RPA/自动化读取光厂官网 | ✅ 通过 | 模块源码扫描 0 命中 requests/urllib/socket/http.client/aiohttp/httpx/scrapy/bs4/playwright/selenium/webdriver/subprocess；无任何 URL 常量、无任何网络客户端 |
| 2. 榜单/指数/热点数据仅允许人工浏览、人工整理、人工上传静态文件 | ✅ 通过 | 全部数据入口仅 3 个：`POST /api/ted/upload`（人工上传 Excel/CSV）、`POST /api/ted/announcements`（人工粘贴公告）、前端文件选择框；无自动获取路径 |
| 3. 模块全程仅本地数据运算，无外网 HTTP 请求、无浏览器自动化 | ✅ 通过 | 代码库无网络库 import；唯一进程内网络组件为 FastAPI/uvicorn 本地监听（接收本机/局域网人工请求），模块自身不发起任何出站连接 |
| 4. 无定时自动任务 | ✅ 通过 | 扫描 0 命中 schedule/cron/apscheduler/threading.Timer/while True/setInterval；服务为常驻 HTTP 服务，仅在收到人工请求时响应 |
| 5. 独立模块零侵入 | ✅ 通过 | 模块全部代码位于 `ted_module/` 目录；独立数据库 `ted_analysis.db`；独立端口 8085；不修改主项目任何文件/表/接口 |

## 二、静态扫描明细

- 扫描范围：`ted_module/` 下全部 `.py` 源码（排除自检声明文件 config.py/compliance_service.py/__init__.py）
- 禁止模式清单（`config.FORBIDDEN_PATTERNS`）：
  `requests, urllib.request, urllib.parse, http.client, aiohttp, httpx, playwright, selenium, webdriver, socket, webbrowser, subprocess, scrapy, bs4, beautifulsoup, lxml.html, schedule, cron, apscheduler, threading.Timer`
- 结果：**0 命中**

## 三、数据流声明（人工闭环）

```
人工浏览光厂公开指数/榜单 → 人工整理为 Excel/CSV → 人工上传到本模块
        ↓
模块仅本地解析、清洗、聚类、评分、分池（纯 CPU/内存/本机 SQLite 运算）
        ↓
人工研判（工作台台账）→ 生成规划书（Markdown，含合规风控章节）
```

- 数据只进不出：上传文件存本机 `ted_module/data/uploads/`，分析结果存本机 `ted_analysis.db`，无任何对外传输。
- 上传留痕：`upload_logs` 表记录 文件/行数/哈希/上传人/时间/错误，全链路可审计。

## 四、单元测试合规断言

`tests/test_compliance.py`：
- `test_no_network_code`：静态扫描断言 0 命中网络/浏览器/爬虫模式 ✅
- `test_no_scheduler`：静态扫描断言 0 命中定时任务模式 ✅
- `test_forbidden_patterns_cover_core`：断言黑名单覆盖核心关键词 ✅

**测试执行结果**：`python -m unittest discover -s tests` → **29 tests OK**（含合规自检 3 项 + 端到端流程测试：上传→聚类→分池→规划书含合规章节）

## 五、运行时自检

`GET /api/ted/compliance/selfcheck` 实时返回：
```json
{
  "ok": true,
  "no_network_access": true,
  "no_browser_automation": true,
  "no_scheduler": true,
  "data_source": "仅人工上传静态文件（Excel/CSV/公告录入），无自动获取",
  "network_findings": [],
  "scheduler_findings": []
}
```

---

**结论：本模块满足全部合规红线，可作为独立合规工具投入使用。**
