-- LP2.0 PERIOD-END CLOSING — SCHEMA MIGRATION
-- Interland Distribution Cape (Pty) Ltd
-- Run via: sqlite3 lp2_new.db < lp2_period_end_migration.sql
-- Azure SQL: syntax changes noted inline
-- SAFE TO RE-RUN — all statements use IF NOT EXISTS / catch duplicate column errors

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: sys_vat_periods
-- Tracks VAT filing periods separately from GL periods.
-- Cat A = 2-monthly (Jan/Feb, Mar/Apr etc.)  Cat B = 6-monthly
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sys_vat_periods (
    vat_period_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    vat_period_code TEXT NOT NULL UNIQUE,   -- e.g. '202602' (Jan/Feb Cat A period, filed by end Feb)
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    vat_category    TEXT NOT NULL DEFAULT 'A',
    is_filed        INTEGER NOT NULL DEFAULT 0,
    is_locked       INTEGER NOT NULL DEFAULT 0,
    filed_by        TEXT,
    filed_at        DATETIME,
    locked_by       TEXT,
    locked_at       DATETIME,
    unlocked_by     TEXT,
    unlocked_reason TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: sys_period_lock_log
-- Human-readable audit trail for all period lock/unlock actions
-- (supplements gl_audit_log with structured lock history)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sys_period_lock_log (
    log_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    period_id       INTEGER,                -- GL period (NULL if VAT period)
    vat_period_id   INTEGER,                -- VAT period (NULL if GL period)
    period_type     TEXT NOT NULL,          -- 'GL' or 'VAT'
    action          TEXT NOT NULL,          -- 'LOCK' or 'UNLOCK'
    actioned_by     TEXT NOT NULL,
    reason          TEXT,
    actioned_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: cb_allocation_memory
-- Cashbook AI memory — learns GL account allocations from past entries.
-- Matching keys: normalised description + debit/credit sign + amount band.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cb_allocation_memory (
    memory_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    description_pattern TEXT NOT NULL,      -- normalised description (uppercase, dates/IDs stripped)
    counterparty        TEXT,               -- bank narration counterparty if extractable
    amount_sign         TEXT NOT NULL,      -- 'DEBIT' (money out) or 'CREDIT' (money in)
    amount_band         TEXT,               -- 'SMALL'(<1k) 'MED'(1k-10k) 'LARGE'(10k-100k) 'XLARGE'
    gl_account_code     TEXT NOT NULL REFERENCES gl_accounts(account_code),
    vat_type            TEXT REFERENCES sys_vat_types(vat_code),
    description_override TEXT,             -- suggested journal narrative
    confidence          INTEGER NOT NULL DEFAULT 1,   -- usage count; higher = more reliable
    last_used           DATE,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(description_pattern, amount_sign)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: cb_staging
-- Cashbook staging area: imported/manual entries awaiting GL posting.
-- Source: CSV import, manual entry, or (future) live bank feed.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cb_staging (
    staging_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    import_batch        TEXT NOT NULL,      -- batch ref e.g. 'CB-IMPORT-20260620-143022'
    bank_account        TEXT NOT NULL REFERENCES gl_accounts(account_code),
    transaction_date    DATE NOT NULL,
    value_date          DATE,
    description         TEXT NOT NULL,
    reference           TEXT,
    amount              REAL NOT NULL,      -- positive=receipt (DR bank), negative=payment (CR bank)
    balance             REAL,              -- running balance from bank statement
    -- Allocation (suggested or confirmed)
    status              TEXT NOT NULL DEFAULT 'UNMATCHED',
    -- UNMATCHED: no suggestion found
    -- SUGGESTED: memory match found, awaiting user confirmation
    -- MATCHED:   user confirmed allocation
    -- POSTED:    journal posted to GL
    -- EXCLUDED:  deliberately excluded (e.g. inter-account transfer)
    gl_account_code     TEXT REFERENCES gl_accounts(account_code),
    vat_type            TEXT REFERENCES sys_vat_types(vat_code),
    journal_description TEXT,
    memory_id           INTEGER REFERENCES cb_allocation_memory(memory_id),
    confidence_score    REAL,              -- 0.0 to 1.0 match confidence
    -- After posting
    journal_id          INTEGER REFERENCES gl_journals(journal_id),
    journal_ref         TEXT,
    posted_by           TEXT,
    posted_at           DATETIME,
    -- Metadata
    source              TEXT NOT NULL DEFAULT 'CSV_IMPORT',
    -- CSV_IMPORT / MANUAL / BANK_FEED
    imported_by         TEXT,
    imported_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes               TEXT,
    CHECK (status IN ('UNMATCHED','SUGGESTED','MATCHED','POSTED','EXCLUDED'))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- COLUMNS ADDED TO EXISTING TABLES
-- (SQLite: ALTER TABLE; Azure SQL: use IF NOT EXISTS workaround)
-- ─────────────────────────────────────────────────────────────────────────────

-- sys_periods: period lock/reopen audit columns
ALTER TABLE sys_periods ADD COLUMN locked_by TEXT;
ALTER TABLE sys_periods ADD COLUMN locked_at DATETIME;
ALTER TABLE sys_periods ADD COLUMN unlocked_by TEXT;
ALTER TABLE sys_periods ADD COLUMN unlocked_at DATETIME;
ALTER TABLE sys_periods ADD COLUMN unlock_reason TEXT;
ALTER TABLE sys_periods ADD COLUMN reopen_count INTEGER NOT NULL DEFAULT 0;

-- gl_journals: flag journals posted into reopened periods
ALTER TABLE gl_journals ADD COLUMN posted_in_reopened_period INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gl_journals ADD COLUMN reopen_reason TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- NEW GL ACCOUNT: 5900 Retained Earnings
-- (if not already in CoA — check your CoA export first)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO gl_accounts
    (account_code, account_name, category, ifrs_classification,
     account_type, is_sub_account, vat_treatment, allow_journals, active)
VALUES
    ('5900', 'Retained Earnings', 'Owners Equity', 'Equity Statement',
     'Balance Sheet', 0, 'NONE', 1, 1);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES for performance
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cb_staging_batch    ON cb_staging(import_batch);
CREATE INDEX IF NOT EXISTS idx_cb_staging_status   ON cb_staging(status);
CREATE INDEX IF NOT EXISTS idx_cb_staging_date     ON cb_staging(transaction_date);
CREATE INDEX IF NOT EXISTS idx_cb_memory_pattern   ON cb_allocation_memory(description_pattern, amount_sign);
CREATE INDEX IF NOT EXISTS idx_vat_periods_dates   ON sys_vat_periods(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_lock_log_period     ON sys_period_lock_log(period_id, actioned_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- VIEW: vw_period_status
-- Dashboard view of all periods with lock and journal stats
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS vw_period_status;
CREATE VIEW vw_period_status AS
SELECT
    p.period_id,
    f.fy_code,
    p.period_number,
    p.period_name,
    p.period_start,
    p.period_end,
    p.is_closed,
    p.locked_by,
    p.locked_at,
    p.reopen_count,
    COUNT(j.journal_id)                                      AS total_journals,
    SUM(CASE WHEN j.posted=1 THEN 1 ELSE 0 END)             AS posted_journals,
    SUM(CASE WHEN j.posted_in_reopened_period=1 THEN 1 ELSE 0 END) AS reopen_journals,
    vp.vat_period_code,
    vp.is_locked  AS vat_period_locked,
    vp.is_filed   AS vat_period_filed
FROM sys_periods p
JOIN sys_financial_years f ON p.fy_id = f.fy_id
LEFT JOIN gl_journals j  ON j.period_id = p.period_id
LEFT JOIN sys_vat_periods vp
    ON p.period_start >= vp.period_start
   AND p.period_end   <= vp.period_end
GROUP BY p.period_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- VIEW: vw_cashbook_staging
-- Working view for cashbook review screen
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS vw_cashbook_staging;
CREATE VIEW vw_cashbook_staging AS
SELECT
    s.staging_id,
    s.import_batch,
    s.bank_account,
    s.transaction_date,
    s.description,
    s.reference,
    s.amount,
    s.balance,
    s.status,
    s.gl_account_code,
    a.account_name    AS gl_account_name,
    s.vat_type,
    s.journal_description,
    s.confidence_score,
    s.journal_ref,
    s.posted_by,
    s.source,
    m.description_pattern AS memory_pattern,
    m.confidence      AS memory_confidence
FROM cb_staging s
LEFT JOIN gl_accounts a     ON s.gl_account_code = a.account_code
LEFT JOIN cb_allocation_memory m ON s.memory_id = m.memory_id;

-- END OF MIGRATION
-- After running: python3 -c "from period_end_engine import apply_schema_extensions; apply_schema_extensions()"
