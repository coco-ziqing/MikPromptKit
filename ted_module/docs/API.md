# TED 素材需求分析合规模块 — 接口文档

- 基础地址：`http://127.0.0.1:8085`（独立服务，独立端口 8085，不占主项目 8080）
- 数据格式：JSON；上传接口为 multipart/form-data
- 鉴权：本模块为纯本地单机工具，无鉴权（仅监听本机/局域网，数据不对外）
- 所有接口**只读本机独立库** `ted_module/data/ted_analysis.db`，不访问任何外部站点

---

## 1. 健康与合规

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 服务健康（返回模块版本与 offline-only 声明） |
| GET | `/api/ted/health` | 模块健康 |
| GET | `/api/ted/compliance/selfcheck` | 合规自检：静态扫描模块源码，断言无外网请求/无浏览器自动化/无定时任务 |

## 2. 数据录入（全部人工）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ted/upload` | 人工上传快照（Excel/CSV）。字段：`file`(文件)、`source_type`(excel\|csv)、`version_name`、`uploaded_by`、`note` |
| POST | `/api/ted/announcements` | 官方公告人工录入。body：`title`、`content`、`publish_date`、`source_hint`、`entered_by` |

**Excel 表头模板（第一行，中英文均可）**：
`题材` | `需求指数` | `机会指数` | `销量` | `销售额` | `排名`
（仅「题材」+「需求指数」为必填列，缺列自动置 0）

**官方表格直接导入（自动表型识别）**：
- 含「机会指数/需求指数」列 → 识别为**视频机会排行表**（双维分析 → 四类题材池）
- 含「热搜/热度」列 → 识别为**热搜关键词排行表**（单维热度 → 热度导向分池：高热度=主力、中热度=观察、低热度=淘汰）
- 表型识别结果自动写入版本备注；上传/整理指引见 `docs/DATA_PREP.md`

## 3. 数据查询

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ted/versions?limit=` | 快照版本列表（含状态 imported/analyzed） |
| GET | `/api/ted/versions/{vid}/records?limit=` | 版本原始记录 |
| GET | `/api/ted/announcements?limit=` | 公告列表 |
| GET | `/api/ted/upload-logs?limit=` | 上传日志（留痕：文件/行数/哈希/上传人/错误） |

## 4. 分析

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ted/analyze/{version_id}?sales_version_id=N` | 执行分析：清洗→聚类→归一化→双维评分→四池落库；可选 `sales_version_id` 合并销售记录版本（按题材匹配注入真实销量/收益信号） |
| GET | `/api/ted/pools?version_id=` | 题材池结果（默认最新已分析版本），返回四池分组 |

**评分模型**：`综合分 = 0.6×需求指数 + 0.4×机会指数`；存在销售数据时自动切换 `0.5×需求 + 0.3×机会 + 0.2×销售信号`（销售信号=销量/销售额对数缩放 0-100）。

**四类题材池**（需求/机会归一化 0-100，阈值 60/50 可在 `config.py` 调整）：
- `main_pool` 主力投产池：需求≥60 且 机会≥50
- `red_ocean` 内卷慎入池：需求≥60 且 机会<50
- `blue_ocean` 蓝海观察池：需求<60 且 机会≥50
- `sunset` 滞销淘汰池：需求<60 且 机会<50

## 5. 研判工作台

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ted/themes?keyword=&limit=` | 题材主档（含同义词别名） |
| POST | `/api/ted/research` | 考察台账新增。body：`theme_id`、`research_date`、`researcher`、`conclusion`、`evidence`、`risk_points`、`decision`(投产/观察/放弃/待定) |
| GET | `/api/ted/research?theme_id=` | 考察台账列表 |
| POST | `/api/ted/risks` | 风险记录新增。body：`theme_id`、`risk_type`、`risk_level`(高/中/低)、`description`、`mitigation` |
| GET | `/api/ted/risks?theme_id=` | 风险记录列表 |

## 6. 规划书

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ted/plan/generate` | 生成开发规划书。body：`{"version_id": N, "generated_by": "..."}` |
| GET | `/api/ted/plan/{id}` | 规划书详情（content_md，含合规风控章节） |
| GET | `/api/ted/plans?limit=` | 规划书列表 |

---

## 开发与测试

```bash
# 启动（独立服务，端口 8085）
python ted_module/main.py
# 或双击 ted_module/start.bat

# 单元测试（29 项：清洗/聚类/归一化/评分/分池/导入/合规自检/端到端）
cd ted_module
python -m unittest discover -s tests -v
```

## 目录结构

```
ted_module/
├── main.py                      # 独立服务入口（端口 8085）
├── config.py                    # 配置 + 合规黑名单
├── schemas.sql                  # 独立数据表结构（仅本模块）
├── db.py                        # 独立库访问（ted_analysis.db）
├── api/router.py                # 全部接口
├── services/
│   ├── import_service.py        # 人工上传解析（Excel/CSV/公告）
│   ├── clean_service.py         # 清洗/同义词聚类/归一化
│   ├── score_service.py         # 双维评分 + 四池划分
│   ├── plan_service.py          # 规划书生成（含合规风控章节）
│   └── compliance_service.py    # 合规自检（静态扫描）
├── static/index.html            # 离线单页（零外部依赖）
├── tests/                       # 单元测试（29 项）
├── data/                        # 独立数据库与上传文件（运行期生成，不入 git）
├── start.bat / start_ted.ps1    # 一键启动
└── docs/API.md                  # 本文档
```
