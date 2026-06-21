-- LP2.0 v2 SCHEMA MIGRATION
-- Covers: multi-entity config, configurable VAT cycle, cashbook bank recon,
--         enhanced AR/AP allocation tracking, open-item statement support
-- Run via: sqlite3 lp2_period_end.db < lp2_v2_migration.sql
-- SAFE TO RE-RUN — uses IF NOT EXISTS / OR IGNORE throughout

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────────────────────
-- ENTITY CONFIGURATION
-- Supports multiple companies sharing the same database.
-- Every financial table references entity_id.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sys_entities (
    entity_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_code         TEXT NOT NULL UNIQUE,       -- e.g. 'ILC', 'ILW', 'IRE'
    entity_name         TEXT NOT NULL,              -- full legal name
    registration_no     TEXT,
    vat_number          TEXT,
    tax_ref             TEXT,
    -- VAT cycle configuration
    vat_cycle           TEXT NOT NULL DEFAULT 'MONTHLY',
    -- MONTHLY   : one VAT period = one GL month (e.g. Interland monthly)
    -- BIMONTHLY : two GL months = one VAT period (SARS Cat A standard)
    -- SIXMONTHLY: six GL months = one VAT period (SARS Cat B)
    vat_first_month     INTEGER NOT NULL DEFAULT 1, -- month VAT periods start (1=Jan,3=Mar)
    -- Financial year configuration
    fy_start_month      INTEGER NOT NULL DEFAULT 3, -- 3 = March year-end entity
    -- Company details for documents
    addr_line1          TEXT,
    addr_line2          TEXT,
    city                TEXT,
    postal_code         TEXT,
    telephone           TEXT,
    email               TEXT,
    -- Banking details (for statements)
    bank_name           TEXT,
    bank_branch         TEXT,
    bank_branch_code    TEXT,
    bank_account_no     TEXT,
    bank_account_type   TEXT DEFAULT 'Cheque / Current',
    bank_swift          TEXT,
    -- System
    is_active           INTEGER NOT NULL DEFAULT 1,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK (vat_cycle IN ('MONTHLY','BIMONTHLY','SIXMONTHLY'))
);

-- Seed Interland as entity 1
INSERT OR IGNORE INTO sys_entities (
    entity_id, entity_code, entity_name, registration_no, vat_number,
    vat_cycle, vat_first_month, fy_start_month,
    email, telephone,
    bank_name, bank_branch, bank_branch_code, bank_account_no, bank_account_type
) VALUES (
    1, 'ILC', 'Interland Distribution Cape (Pty) Ltd',
    '2003/023456/07', '4560098765',
    'MONTHLY', 3, 3,
    'accounts@interlandsa.co.za', '011 795 XXXX',
    'Nedbank Business Banking', 'Honeydew', '198765', '1234 567 890', 'Cheque / Current'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- ADD entity_id TO FINANCIAL YEAR AND PERIOD TABLES
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE sys_financial_years ADD COLUMN entity_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sys_periods         ADD COLUMN entity_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sys_vat_periods     ADD COLUMN entity_id INTEGER NOT NULL DEFAULT 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- BANK RECONCILIATION
-- Tracks the formal reconciliation of bank statement balance to GL balance.
-- Each recon covers one bank account for one GL period.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cb_bank_recon (
    recon_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id           INTEGER NOT NULL DEFAULT 1 REFERENCES sys_entities(entity_id),
    period_id           INTEGER NOT NULL REFERENCES sys_periods(period_id),
    bank_account        TEXT NOT NULL REFERENCES gl_accounts(account_code),
    recon_date          DATE NOT NULL,              -- statement date being reconciled
    -- Bank statement figures (entered from actual bank statement)
    bank_stmt_opening   REAL NOT NULL DEFAULT 0,   -- opening balance per bank statement
    bank_stmt_closing   REAL NOT NULL DEFAULT 0,   -- closing balance per bank statement
    -- GL figures (calculated from posted journals)
    gl_opening          REAL,                       -- GL balance at period start
    gl_closing          REAL,                       -- GL balance at period end
    -- Reconciliation result
    outstanding_deposits    REAL NOT NULL DEFAULT 0,    -- deposits in transit (in GL, not on stmt)
    outstanding_payments    REAL NOT NULL DEFAULT 0,    -- payments in transit (in GL, not on stmt)
    unrecorded_receipts     REAL NOT NULL DEFAULT 0,    -- on stmt, not in GL (e.g. bank charges)
    unrecorded_payments     REAL NOT NULL DEFAULT 0,    -- on stmt, not in GL
    adjusted_bank_balance   REAL,                       -- bank_stmt_closing + adjustments
    adjusted_gl_balance     REAL,                       -- gl_closing + adjustments
    difference              REAL,                       -- should be 0 when reconciled
    -- Status
    status              TEXT NOT NULL DEFAULT 'DRAFT',
    -- DRAFT: in progress
    -- BALANCED: difference = 0, ready to lock
    -- LOCKED: confirmed and locked (period must be locked too)
    locked_by           TEXT,
    locked_at           DATETIME,
    notes               TEXT,
    created_by          TEXT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK (status IN ('DRAFT','BALANCED','LOCKED'))
);

-- Recon line items — individual items explaining the difference
CREATE TABLE IF NOT EXISTS cb_recon_items (
    item_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    recon_id            INTEGER NOT NULL REFERENCES cb_bank_recon(recon_id),
    item_type           TEXT NOT NULL,
    -- OUTSTANDING_DEPOSIT  : in GL as receipt, not yet on bank statement
    -- OUTSTANDING_PAYMENT  : in GL as payment, not yet on bank statement
    -- UNRECORDED_RECEIPT   : on bank statement, not yet in GL
    -- UNRECORDED_PAYMENT   : on bank statement, not yet in GL (e.g. bank charges)
    -- TIMING_DIFFERENCE    : date mismatch, explain manually
    -- ERROR                : identified error in GL or bank statement
    description         TEXT NOT NULL,
    amount              REAL NOT NULL,              -- positive always; direction from item_type
    transaction_date    DATE,
    bank_reference      TEXT,
    gl_journal_ref      TEXT,
    staging_id          INTEGER REFERENCES cb_staging(staging_id),
    resolved            INTEGER NOT NULL DEFAULT 0,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK (item_type IN ('OUTSTANDING_DEPOSIT','OUTSTANDING_PAYMENT',
                         'UNRECORDED_RECEIPT','UNRECORDED_PAYMENT',
                         'TIMING_DIFFERENCE','ERROR'))
);

-- Mark cb_staging entries as reconciled
ALTER TABLE cb_staging ADD COLUMN recon_id INTEGER REFERENCES cb_bank_recon(recon_id);
ALTER TABLE cb_staging ADD COLUMN is_reconciled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cb_staging ADD COLUMN reconciled_at DATETIME;
-- Track debit/credit direction explicitly for filter UI
ALTER TABLE cb_staging ADD COLUMN direction TEXT;
-- RECEIPT  : money coming in (amount > 0 / DR bank account)
-- PAYMENT  : money going out (amount < 0 / CR bank account)

-- ─────────────────────────────────────────────────────────────────────────────
-- ENHANCED AR: open-item allocation tracking
-- ar_receipt_allocations already exists — add columns for open-item support
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE ar_receipt_allocations ADD COLUMN allocation_date DATE;
ALTER TABLE ar_receipt_allocations ADD COLUMN allocation_ref  TEXT;   -- cross-reference
ALTER TABLE ar_receipt_allocations ADD COLUMN note            TEXT;
ALTER TABLE ar_receipt_allocations ADD COLUMN created_by      TEXT;

-- Explicit tracking of unallocated receipt balances
ALTER TABLE ar_receipts ADD COLUMN amount_allocated REAL NOT NULL DEFAULT 0;
ALTER TABLE ar_receipts ADD COLUMN amount_unallocated REAL;  -- computed on allocation
ALTER TABLE ar_receipts ADD COLUMN fully_allocated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ar_receipts ADD COLUMN receipt_type TEXT NOT NULL DEFAULT 'PAYMENT';
-- PAYMENT, ADVANCE, SETTLEMENT (full/partial settlement with write-off)

-- Write-off support on invoices
ALTER TABLE ar_invoices ADD COLUMN amount_written_off REAL NOT NULL DEFAULT 0;
ALTER TABLE ar_invoices ADD COLUMN write_off_date DATE;
ALTER TABLE ar_invoices ADD COLUMN write_off_by TEXT;
ALTER TABLE ar_invoices ADD COLUMN write_off_reason TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- ENHANCED AP: open-item allocation tracking (mirrors AR)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE ap_payment_allocations ADD COLUMN allocation_date DATE;
ALTER TABLE ap_payment_allocations ADD COLUMN allocation_ref  TEXT;
ALTER TABLE ap_payment_allocations ADD COLUMN note            TEXT;
ALTER TABLE ap_payment_allocations ADD COLUMN created_by      TEXT;

ALTER TABLE ap_payments ADD COLUMN amount_allocated   REAL NOT NULL DEFAULT 0;
ALTER TABLE ap_payments ADD COLUMN amount_unallocated REAL;
ALTER TABLE ap_payments ADD COLUMN fully_allocated    INTEGER NOT NULL DEFAULT 0;

ALTER TABLE ap_invoices ADD COLUMN amount_written_off REAL NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ar_recv_alloc_receipt  ON ar_receipt_allocations(receipt_id);
CREATE INDEX IF NOT EXISTS idx_ar_recv_alloc_invoice  ON ar_receipt_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_ap_pay_alloc_payment   ON ap_payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_ap_pay_alloc_invoice   ON ap_payment_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_cb_staging_direction   ON cb_staging(direction);
CREATE INDEX IF NOT EXISTS idx_cb_staging_recon       ON cb_staging(recon_id, is_reconciled);
CREATE INDEX IF NOT EXISTS idx_cb_recon_period        ON cb_bank_recon(period_id, bank_account);
CREATE INDEX IF NOT EXISTS idx_entities               ON sys_entities(entity_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATED VIEWS
-- ─────────────────────────────────────────────────────────────────────────────

-- Enhanced debtor aging: includes allocation detail and open-item balances
DROP VIEW IF EXISTS vw_debtor_aging;
CREATE VIEW vw_debtor_aging AS
SELECT
    i.invoice_id,
    i.customer_code,
    c.customer_name,
    c.category,
    i.invoice_ref,
    i.customer_invoice_no,
    i.invoice_date,
    i.due_date,
    i.lp_load_number,
    i.total_incl_vat,
    i.amount_received,
    i.amount_written_off,
    i.balance_due,
    COALESCE((
        SELECT SUM(a.allocated_amount)
        FROM ar_receipt_allocations a
        WHERE a.invoice_id = i.invoice_id
    ), 0) AS total_allocated,
    i.status,
    CAST((JULIANDAY('now') - JULIANDAY(i.due_date)) AS INTEGER) AS days_overdue,
    CASE
        WHEN JULIANDAY('now') - JULIANDAY(i.due_date) <= 0  THEN 'Current'
        WHEN JULIANDAY('now') - JULIANDAY(i.due_date) <= 30 THEN '1-30 Days'
        WHEN JULIANDAY('now') - JULIANDAY(i.due_date) <= 60 THEN '31-60 Days'
        WHEN JULIANDAY('now') - JULIANDAY(i.due_date) <= 90 THEN '61-90 Days'
        ELSE '90+ Days'
    END AS aging_bucket
FROM ar_invoices i
JOIN ar_customers c ON i.customer_code = c.customer_code
WHERE i.status NOT IN ('PAID','CANCELLED')
  AND i.balance_due > 0;

-- Enhanced supplier aging
DROP VIEW IF EXISTS vw_supplier_aging;
CREATE VIEW vw_supplier_aging AS
SELECT
    i.invoice_id,
    i.supplier_code,
    s.supplier_name,
    s.group_terms,
    i.invoice_ref,
    i.supplier_invoice_no,
    i.invoice_date,
    i.due_date,
    i.total_incl_vat,
    i.amount_paid,
    i.balance_due,
    COALESCE((
        SELECT SUM(a.allocated_amount)
        FROM ap_payment_allocations a
        WHERE a.invoice_id = i.invoice_id
    ), 0) AS total_allocated,
    i.status,
    CAST((JULIANDAY('now') - JULIANDAY(i.due_date)) AS INTEGER) AS days_overdue,
    CASE
        WHEN JULIANDAY('now') - JULIANDAY(i.due_date) <= 0  THEN 'Current'
        WHEN JULIANDAY('now') - JULIANDAY(i.due_date) <= 30 THEN '1-30 Days'
        WHEN JULIANDAY('now') - JULIANDAY(i.due_date) <= 60 THEN '31-60 Days'
        WHEN JULIANDAY('now') - JULIANDAY(i.due_date) <= 90 THEN '61-90 Days'
        ELSE '90+ Days'
    END AS aging_bucket
FROM ap_invoices i
JOIN ap_suppliers s ON i.supplier_code = s.supplier_code
WHERE i.status NOT IN ('PAID','CANCELLED')
  AND i.balance_due > 0;

-- Open receipts: unallocated receipt balances for AR
CREATE VIEW IF NOT EXISTS vw_ar_open_receipts AS
SELECT
    r.receipt_id,
    r.receipt_ref,
    r.customer_code,
    c.customer_name,
    r.receipt_date,
    r.amount,
    r.amount_allocated,
    COALESCE(r.amount - r.amount_allocated, r.amount) AS amount_unallocated,
    r.fully_allocated,
    r.payment_method
FROM ar_receipts r
JOIN ar_customers c ON r.customer_code = c.customer_code
WHERE r.fully_allocated = 0;

-- Open payments: unallocated payment balances for AP
CREATE VIEW IF NOT EXISTS vw_ap_open_payments AS
SELECT
    p.payment_id,
    p.payment_ref,
    p.supplier_code,
    s.supplier_name,
    p.payment_date,
    p.amount,
    p.amount_allocated,
    COALESCE(p.amount - p.amount_allocated, p.amount) AS amount_unallocated,
    p.fully_allocated,
    p.payment_method
FROM ap_payments p
JOIN ap_suppliers s ON p.supplier_code = s.supplier_code
WHERE p.fully_allocated = 0;

-- Bank recon summary view
CREATE VIEW IF NOT EXISTS vw_bank_recon_summary AS
SELECT
    r.recon_id,
    r.period_id,
    p.period_name,
    r.bank_account,
    a.account_name AS bank_account_name,
    r.recon_date,
    r.bank_stmt_closing,
    r.gl_closing,
    r.difference,
    r.status,
    COUNT(ri.item_id) AS item_count,
    SUM(CASE WHEN ri.resolved=0 THEN 1 ELSE 0 END) AS unresolved_items
FROM cb_bank_recon r
JOIN sys_periods p ON r.period_id = p.period_id
JOIN gl_accounts a ON r.bank_account = a.account_code
LEFT JOIN cb_recon_items ri ON r.recon_id = ri.recon_id
GROUP BY r.recon_id;

-- END OF MIGRATION
