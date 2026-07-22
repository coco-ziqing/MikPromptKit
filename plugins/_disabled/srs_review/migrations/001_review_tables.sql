-- ============================================================
-- SRS 间隔复习插件 — 数据库迁移
-- Phase: v1.0.0 com.promptkit.srs-review
-- 执行方式: 插件管理器自动执行（幂等）
-- ============================================================

-- 表 1: srs_cards — 复习卡片
CREATE TABLE IF NOT EXISTS srs_cards (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    word_card_id    INTEGER NOT NULL,           -- 关联词卡
    collection_id   INTEGER DEFAULT NULL,       -- 加入时的收藏夹ID（可选）
    card_mode       TEXT DEFAULT 'text',        -- 卡片模式: text/translation/image/classification
    state           INTEGER DEFAULT 0,          -- FSRS状态: New=0/Learning=1/Review=2/Relearning=3
    difficulty      REAL DEFAULT 0.0,           -- 难度 D ∈ [1, 10]
    stability       REAL DEFAULT 0.0,           -- 稳定性 S (天)
    elapsed_days    REAL DEFAULT 0.0,           -- 上次间隔
    scheduled_days  REAL DEFAULT 0.0,           -- 计划间隔
    reps            INTEGER DEFAULT 0,          -- 复习次数
    lapses          INTEGER DEFAULT 0,          -- 遗忘次数
    last_review     REAL DEFAULT NULL,          -- 上次复习时间戳
    due             REAL DEFAULT NULL,          -- 到期时间戳
    enrolled_at     REAL DEFAULT (strftime('%s','now')),  -- 加入时间
    is_active       INTEGER DEFAULT 1,          -- 是否活跃
    user_id         INTEGER DEFAULT NULL,       -- 所属用户
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    updated_at      TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (word_card_id) REFERENCES word_cards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_srs_cards_word ON srs_cards(word_card_id);
CREATE INDEX IF NOT EXISTS idx_srs_cards_due ON srs_cards(due, is_active);
CREATE INDEX IF NOT EXISTS idx_srs_cards_user ON srs_cards(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_srs_cards_unique ON srs_cards(word_card_id, user_id);

-- 表 2: srs_reviews — 复习记录
CREATE TABLE IF NOT EXISTS srs_reviews (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id         INTEGER NOT NULL,           -- 关联 srs_cards.id
    rating          INTEGER NOT NULL,           -- 评分 1-4 (Again/Hard/Good/Easy)
    state_before    INTEGER DEFAULT 0,          -- 复习前状态
    state_after     INTEGER DEFAULT 0,          -- 复习后状态
    elapsed_days    REAL DEFAULT 0.0,           -- 实际间隔
    scheduled_days  REAL DEFAULT 0.0,           -- 新计划间隔
    review_time_ms  INTEGER DEFAULT 0,          -- 回答用时(毫秒)
    reviewed_at     REAL DEFAULT (strftime('%s','now')),  -- 时间戳
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (card_id) REFERENCES srs_cards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_srs_reviews_card ON srs_reviews(card_id);
CREATE INDEX IF NOT EXISTS idx_srs_reviews_date ON srs_reviews(reviewed_at);

-- 表 3: srs_params — 用户 FSRS 参数
CREATE TABLE IF NOT EXISTS srs_params (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER DEFAULT NULL,       -- 所属用户
    w0  REAL DEFAULT 0.40255,
    w1  REAL DEFAULT 0.59745,
    w2  REAL DEFAULT 2.46748,
    w3  REAL DEFAULT 5.89120,
    w4  REAL DEFAULT 4.90186,
    w5  REAL DEFAULT 0.93915,
    w6  REAL DEFAULT 0.86210,
    w7  REAL DEFAULT 0.00992,
    w8  REAL DEFAULT 1.49434,
    w9  REAL DEFAULT 0.13636,
    w10 REAL DEFAULT 0.94365,
    w11 REAL DEFAULT 2.18487,
    w12 REAL DEFAULT 0.05185,
    w13 REAL DEFAULT 0.33876,
    w14 REAL DEFAULT 1.26308,
    w15 REAL DEFAULT 0.28576,
    w16 REAL DEFAULT 2.61022,
    target_retrievability REAL DEFAULT 0.90,     -- 目标回忆率
    optimized_at    REAL DEFAULT NULL,           -- 上次优化时间
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    updated_at      TEXT DEFAULT (datetime('now','localtime'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_srs_params_user ON srs_params(user_id);

-- 表 4: srs_deck_config — 用户策略配置
CREATE TABLE IF NOT EXISTS srs_deck_config (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER DEFAULT NULL,
    daily_new_limit       INTEGER DEFAULT 20,   -- 每日新卡上限
    daily_review_limit    INTEGER DEFAULT 200,   -- 每日复习上限
    review_order          TEXT DEFAULT 'mixed',  -- 复习顺序: mixed/new_first/review_first
    auto_enroll           INTEGER DEFAULT 0,    -- 新建词卡自动加入复习
    card_mode_default     TEXT DEFAULT 'text',   -- 默认卡片模式
    notify_enabled        INTEGER DEFAULT 0,    -- 浏览器通知
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    updated_at      TEXT DEFAULT (datetime('now','localtime'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_srs_config_user ON srs_deck_config(user_id);

-- ============================================================
-- 种子数据: 为 admin 用户插入默认参数和配置
-- ============================================================

INSERT OR IGNORE INTO srs_params (user_id) VALUES (NULL);

INSERT OR IGNORE INTO srs_deck_config (user_id) VALUES (NULL);
