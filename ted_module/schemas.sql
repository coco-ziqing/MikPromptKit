-- TED 模块独立数据表结构（独立库 ted_analysis.db，与主项目 prompts.db 完全隔离）

-- 快照版本（人工上传的官方指数快照/销售报表/公告）
CREATE TABLE IF NOT EXISTS snapshot_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'excel',  -- excel | csv | manual
  file_name TEXT DEFAULT '',
  file_hash TEXT DEFAULT '',
  rows_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'imported',             -- imported | analyzed
  uploaded_by TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 原始记录（快照解析后的逐行数据，来自人工上传文件）
CREATE TABLE IF NOT EXISTS raw_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL,
  theme_raw TEXT NOT NULL,
  demand_index REAL DEFAULT 0,      -- 官方需求指数（人工快照）
  opportunity_index REAL DEFAULT 0, -- 官方机会指数（人工快照）
  sales_qty REAL DEFAULT 0,         -- 自有销售数量（人工 CSV）
  revenue REAL DEFAULT 0,           -- 自有销售额（人工 CSV）
  rank_no INTEGER DEFAULT 0,        -- 榜单排名（人工录入）
  extra TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 官方公告录入（人工粘贴）
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  publish_date TEXT DEFAULT '',
  source_hint TEXT DEFAULT '',      -- 人工说明来源
  entered_by TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 题材主档（清洗/同义词聚类/归一化后）
CREATE TABLE IF NOT EXISTS themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_key TEXT NOT NULL UNIQUE,   -- 归一化键
  display_name TEXT NOT NULL,
  aliases TEXT DEFAULT '[]',        -- 归并到该主档的原始名 JSON
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 题材指标（按版本聚合，0-100 归一化）
CREATE TABLE IF NOT EXISTS theme_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL,
  theme_id INTEGER NOT NULL,
  demand_index REAL DEFAULT 0,
  opportunity_index REAL DEFAULT 0,
  sales_qty REAL DEFAULT 0,
  revenue REAL DEFAULT 0,
  record_count INTEGER DEFAULT 0,
  computed_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(version_id, theme_id)
);

-- 题材池划分结果
CREATE TABLE IF NOT EXISTS theme_pools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL,
  theme_id INTEGER NOT NULL,
  pool_type TEXT NOT NULL,          -- main_pool | red_ocean | blue_ocean | sunset
  composite_score REAL DEFAULT 0,
  demand_score REAL DEFAULT 0,
  opportunity_score REAL DEFAULT 0,
  reason TEXT DEFAULT '',
  rank_no INTEGER DEFAULT 0,
  computed_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(version_id, theme_id)
);

-- 题材人工研判考察台账
CREATE TABLE IF NOT EXISTS research_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_id INTEGER NOT NULL,
  version_id INTEGER DEFAULT 0,
  research_date TEXT DEFAULT '',
  researcher TEXT DEFAULT '',
  conclusion TEXT DEFAULT '',
  evidence TEXT DEFAULT '',
  risk_points TEXT DEFAULT '',
  decision TEXT DEFAULT '',          -- 投产/观察/放弃/待定
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 风险记录
CREATE TABLE IF NOT EXISTS risk_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_id INTEGER NOT NULL,
  risk_type TEXT DEFAULT '',
  risk_level TEXT DEFAULT '中',      -- 高/中/低
  description TEXT DEFAULT '',
  mitigation TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 开发规划书
CREATE TABLE IF NOT EXISTS plan_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER DEFAULT 0,
  title TEXT NOT NULL,
  content_md TEXT DEFAULT '',
  status TEXT DEFAULT 'draft',
  generated_at TEXT DEFAULT (datetime('now','localtime')),
  generated_by TEXT DEFAULT ''
);

-- 上传日志（留痕）
CREATE TABLE IF NOT EXISTS upload_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT DEFAULT '',
  source_type TEXT DEFAULT '',
  rows_total INTEGER DEFAULT 0,
  rows_ok INTEGER DEFAULT 0,
  rows_fail INTEGER DEFAULT 0,
  errors TEXT DEFAULT '',
  file_hash TEXT DEFAULT '',
  uploaded_by TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
