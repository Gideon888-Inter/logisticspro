-- LP2.0 FINANCIAL MODULE — COMPLETE SCHEMA
-- Compatible: SQLite (dev) | Azure SQL (production)

PRAGMA foreign_keys = ON;

-- TABLES

-- sys_periods
CREATE TABLE sys_periods (
    period_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    fy_id           INTEGER NOT NULL REFERENCES sys_financial_years(fy_id),
    period_number   INTEGER NOT NULL,              -- 1-12
    period_name     TEXT NOT NULL,                 -- e.g. 'Mar 2026'
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    is_closed       INTEGER NOT NULL DEFAULT 0,
    UNIQUE(fy_id, period_number)
);

-- sys_currencies
CREATE TABLE sys_currencies (
    currency_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    currency_code   TEXT NOT NULL UNIQUE,          -- ZAR, USD etc
    description     TEXT NOT NULL,
    is_functional   INTEGER NOT NULL DEFAULT 0     -- 1 = ZAR (functional currency)
);

-- gl_journal_lines
CREATE TABLE gl_journal_lines (
    line_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    journal_id          INTEGER NOT NULL REFERENCES gl_journals(journal_id),
    line_number         INTEGER NOT NULL,
    account_code        TEXT NOT NULL REFERENCES gl_accounts(account_code),
    description         TEXT,
    debit               REAL NOT NULL DEFAULT 0,
    credit              REAL NOT NULL DEFAULT 0,
    vat_type            TEXT REFERENCES sys_vat_types(vat_code),
    vat_amount          REAL NOT NULL DEFAULT 0,
    tax_period          TEXT,                      -- SARS VAT period e.g. '202602'
    cost_centre         TEXT,
    reference           TEXT,
    UNIQUE(journal_id, line_number),
    CHECK (NOT (debit > 0 AND credit > 0)),        -- cannot be both debit and credit
    CHECK (debit >= 0),
    CHECK (credit >= 0)
);

-- fa_assets
CREATE TABLE fa_assets (
    asset_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_code          TEXT NOT NULL UNIQUE,      -- e.g. MH195, BT01/BT02
    description         TEXT NOT NULL,
    class_code          TEXT NOT NULL REFERENCES fa_asset_classes(class_code),
    purchase_date       DATE NOT NULL,
    depre_start_date    DATE,
    purchase_price      REAL NOT NULL,
    vat_paid            REAL NOT NULL DEFAULT 0,
    supplier_code       TEXT,                      -- links to suppliers table
    invoice_ref         TEXT,
    location            TEXT,                      -- JHB / CT / Mobile
    serial_number       TEXT,
    reg_number          TEXT,                      -- for fleet vehicles
    -- Tax depreciation (SARS W&T)
    tax_depre_prior     REAL NOT NULL DEFAULT 0,
    tax_depre_curr_yr   REAL NOT NULL DEFAULT 0,
    tax_depre_period    REAL NOT NULL DEFAULT 0,
    tax_value           REAL NOT NULL DEFAULT 0,
    tax_report_date     DATE,
    -- Book depreciation (IFRS IAS 16)
    book_depre_total    REAL NOT NULL DEFAULT 0,
    book_depre_prior    REAL NOT NULL DEFAULT 0,
    book_depre_curr_yr  REAL NOT NULL DEFAULT 0,
    book_depre_period   REAL NOT NULL DEFAULT 0,
    book_nbv            REAL NOT NULL DEFAULT 0,
    book_report_date    DATE,
    -- Status
    disposal_date       DATE,
    disposal_proceeds   REAL,
    is_active           INTEGER NOT NULL DEFAULT 1,
    fully_depreciated   INTEGER NOT NULL DEFAULT 0,
    notes               TEXT,
    document_ref        TEXT,                      -- SharePoint link
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ap_purchase_orders
CREATE TABLE ap_purchase_orders (
    po_id               INTEGER PRIMARY KEY AUTOINCREMENT,
    po_number           TEXT NOT NULL UNIQUE,      -- e.g. PO-2026-000001
    supplier_code       TEXT NOT NULL REFERENCES ap_suppliers(supplier_code),
    po_date             DATE NOT NULL,
    required_date       DATE,
    period_id           INTEGER REFERENCES sys_periods(period_id),
    status              TEXT NOT NULL DEFAULT 'DRAFT',
    description         TEXT,
    subtotal_excl_vat   REAL NOT NULL DEFAULT 0,
    vat_amount          REAL NOT NULL DEFAULT 0,
    total_incl_vat      REAL NOT NULL DEFAULT 0,
    approved_by         TEXT,
    approved_at         DATETIME,
    notes               TEXT,
    created_by          TEXT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK (status IN ('DRAFT','APPROVED','RECEIVED','INVOICED','CLOSED','CANCELLED'))
);

-- ap_po_lines
CREATE TABLE ap_po_lines (
    po_line_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id               INTEGER NOT NULL REFERENCES ap_purchase_orders(po_id),
    line_number         INTEGER NOT NULL,
    description         TEXT NOT NULL,
    gl_account_code     TEXT REFERENCES gl_accounts(account_code),
    quantity            REAL NOT NULL DEFAULT 1,
    unit_price_excl     REAL NOT NULL DEFAULT 0,
    vat_type            TEXT REFERENCES sys_vat_types(vat_code),
    vat_amount          REAL NOT NULL DEFAULT 0,
    line_total_excl     REAL NOT NULL DEFAULT 0,
    line_total_incl     REAL NOT NULL DEFAULT 0,
    UNIQUE(po_id, line_number)
);

-- ap_invoices
CREATE TABLE ap_invoices (
    invoice_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_ref         TEXT NOT NULL UNIQUE,      -- internal ref e.g. API-2026-000001
    supplier_code       TEXT NOT NULL REFERENCES ap_suppliers(supplier_code),
    supplier_invoice_no TEXT,                      -- supplier's own invoice number
    invoice_date        DATE NOT NULL,
    due_date            DATE NOT NULL,
    period_id           INTEGER NOT NULL REFERENCES sys_periods(period_id),
    po_id               INTEGER REFERENCES ap_purchase_orders(po_id),
    status              TEXT NOT NULL DEFAULT 'UNPOSTED',
    subtotal_excl_vat   REAL NOT NULL DEFAULT 0,
    vat_amount          REAL NOT NULL DEFAULT 0,
    total_incl_vat      REAL NOT NULL DEFAULT 0,
    amount_paid         REAL NOT NULL DEFAULT 0,
    balance_due         REAL NOT NULL DEFAULT 0,
    journal_id          INTEGER REFERENCES gl_journals(journal_id),
    document_ref        TEXT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK (status IN ('UNPOSTED','POSTED','PARTIAL','PAID','DISPUTED','CANCELLED'))
);

-- ap_payments
CREATE TABLE ap_payments (
    payment_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_ref         TEXT NOT NULL UNIQUE,
    supplier_code       TEXT NOT NULL REFERENCES ap_suppliers(supplier_code),
    payment_date        DATE NOT NULL,
    period_id           INTEGER NOT NULL REFERENCES sys_periods(period_id),
    bank_account        TEXT,
    payment_method      TEXT,                      -- EFT, CASH, CHEQUE
    amount              REAL NOT NULL,
    journal_id          INTEGER REFERENCES gl_journals(journal_id),
    notes               TEXT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ap_payment_allocations
CREATE TABLE ap_payment_allocations (
    alloc_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id          INTEGER NOT NULL REFERENCES ap_payments(payment_id),
    invoice_id          INTEGER NOT NULL REFERENCES ap_invoices(invoice_id),
    allocated_amount    REAL NOT NULL,
    allocated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(payment_id, invoice_id)
);

-- sys_vat_types
CREATE TABLE sys_vat_types (
    vat_type_id INTEGER PRIMARY KEY AUTOINCREMENT,
    vat_code TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    rate_pct REAL NOT NULL DEFAULT 0,
    vat201_field TEXT,
    vat201_description TEXT,
    vat_direction TEXT NOT NULL,
    allowed_on_ar INTEGER NOT NULL DEFAULT 0,
    allowed_on_ap INTEGER NOT NULL DEFAULT 0,
    allowed_on_fa INTEGER NOT NULL DEFAULT 0,
    allowed_on_gl INTEGER NOT NULL DEFAULT 0,
    is_capital_goods INTEGER NOT NULL DEFAULT 0,
    is_imported INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
);

-- vat_transactions
CREATE TABLE vat_transactions (
    vat_id INTEGER PRIMARY KEY AUTOINCREMENT,
    journal_id INTEGER NOT NULL REFERENCES gl_journals(journal_id),
    line_id INTEGER NOT NULL REFERENCES gl_journal_lines(line_id),
    source_module TEXT NOT NULL,
    vat_code TEXT NOT NULL REFERENCES sys_vat_types(vat_code),
    vat_direction TEXT NOT NULL,
    vat_period TEXT NOT NULL,
    transaction_date DATE NOT NULL,
    tax_invoice_no TEXT,
    counterparty_vat_no TEXT,
    counterparty_name TEXT,
    exclusive_amount REAL NOT NULL,
    vat_amount REAL NOT NULL,
    inclusive_amount REAL NOT NULL,
    gl_account_code TEXT NOT NULL,
    is_capital_goods INTEGER NOT NULL DEFAULT 0,
    capital_adj_required INTEGER NOT NULL DEFAULT 0,
    capital_adj_start_date DATE,
    capital_adj_end_date DATE,
    capital_adj_pct_taxable REAL,
    included_in_return INTEGER NOT NULL DEFAULT 0,
    vat201_period TEXT,
    filed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- sys_financial_years
CREATE TABLE sys_financial_years (
        fy_id INTEGER PRIMARY KEY AUTOINCREMENT,
        fy_code TEXT NOT NULL UNIQUE,
        fy_start DATE NOT NULL, fy_end DATE NOT NULL,
        is_current INTEGER NOT NULL DEFAULT 0,
        is_closed INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP);

-- gl_accounts
CREATE TABLE gl_accounts (
        account_id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_code TEXT NOT NULL UNIQUE,
        account_name TEXT NOT NULL,
        category TEXT NOT NULL,
        ifrs_classification TEXT NOT NULL,
        account_type TEXT NOT NULL,
        parent_code TEXT,
        is_sub_account INTEGER NOT NULL DEFAULT 0,
        default_vat_type TEXT,
        allow_journals INTEGER NOT NULL DEFAULT 1,
        active INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, vat_treatment TEXT NOT NULL DEFAULT 'NONE', allowed_vat_codes TEXT, vat_notes TEXT);

-- gl_journals
CREATE TABLE gl_journals (
        journal_id INTEGER PRIMARY KEY AUTOINCREMENT,
        journal_ref TEXT NOT NULL UNIQUE,
        journal_type TEXT NOT NULL,
        description TEXT NOT NULL,
        period_id INTEGER NOT NULL,
        journal_date DATE NOT NULL,
        source_document TEXT,
        source_module TEXT,
        posted INTEGER NOT NULL DEFAULT 0,
        posted_at DATETIME,
        posted_by TEXT,
        reversed INTEGER NOT NULL DEFAULT 0,
        reversal_journal_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT);

-- gl_audit_log
CREATE TABLE gl_audit_log (
        log_id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        table_name TEXT NOT NULL, record_id INTEGER NOT NULL,
        action TEXT NOT NULL, changed_by TEXT,
        old_values TEXT, new_values TEXT, ip_address TEXT);

-- ap_suppliers
CREATE TABLE ap_suppliers (
        supplier_id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_code TEXT NOT NULL UNIQUE,
        supplier_name TEXT NOT NULL,
        group_terms TEXT, contact_name TEXT, telephone TEXT, cell TEXT, email TEXT,
        physical_addr_1 TEXT, physical_addr_2 TEXT, city TEXT, postal_code TEXT,
        vat_number TEXT, tax_ref TEXT,
        default_vat_type TEXT,
        credit_limit REAL NOT NULL DEFAULT 0,
        payment_terms_days INTEGER NOT NULL DEFAULT 30,
        on_hold INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        gl_control_account TEXT DEFAULT '9200',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP);

-- fa_asset_classes
CREATE TABLE fa_asset_classes (
        class_id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_code TEXT NOT NULL UNIQUE,
        class_name TEXT NOT NULL,
        gl_cost_account TEXT NOT NULL,
        gl_accum_account TEXT NOT NULL,
        gl_depre_account TEXT NOT NULL,
        sars_wt_rate_pct REAL NOT NULL,
        ifrs_useful_life_yr INTEGER NOT NULL,
        ifrs_method TEXT NOT NULL DEFAULT 'SL',
        sars_section TEXT,
        active INTEGER NOT NULL DEFAULT 1);

-- fa_depreciation_runs
CREATE TABLE fa_depreciation_runs (
        run_id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id INTEGER NOT NULL,
        period_id INTEGER NOT NULL,
        run_date DATE NOT NULL,
        book_depre_amount REAL NOT NULL DEFAULT 0,
        tax_depre_amount REAL NOT NULL DEFAULT 0,
        book_nbv_after REAL NOT NULL,
        tax_value_after REAL NOT NULL,
        timing_difference REAL,
        deferred_tax REAL,
        journal_id INTEGER,
        UNIQUE(asset_id, period_id));

-- ar_customers
CREATE TABLE ar_customers (
    customer_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_code       TEXT NOT NULL UNIQUE,   -- Evolution code e.g. AFC001
    customer_name       TEXT NOT NULL,
    category            TEXT,
    vat_number          TEXT,                   -- Tax Reference from Evolution
    contact_name        TEXT,
    telephone           TEXT,
    cell                TEXT,
    email               TEXT,
    postal_addr_1       TEXT,
    postal_addr_2       TEXT,
    postal_addr_3       TEXT,
    postal_code         TEXT,
    delivery_addr_1     TEXT,
    delivery_addr_2     TEXT,
    delivery_addr_3     TEXT,
    delivery_postal     TEXT,
    credit_limit        REAL NOT NULL DEFAULT 0,
    payment_terms_days  INTEGER NOT NULL DEFAULT 30,
    default_vat_type    TEXT REFERENCES sys_vat_types(vat_code),
    accepts_e_invoice   INTEGER NOT NULL DEFAULT 1,
    statement_dist      TEXT DEFAULT 'Print and Email',
    auto_allocate       INTEGER NOT NULL DEFAULT 0,
    cash_sale           INTEGER NOT NULL DEFAULT 0,
    on_hold             INTEGER NOT NULL DEFAULT 0,
    active              INTEGER NOT NULL DEFAULT 1,
    -- LP2.0 alignment: client_code links to LP clients table
    lp_client_code      TEXT,
    gl_control_account  TEXT NOT NULL DEFAULT '8200',
    opening_balance     REAL NOT NULL DEFAULT 0,
    opening_balance_date DATE,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ar_invoices
CREATE TABLE ar_invoices (
    invoice_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_ref         TEXT NOT NULL UNIQUE,   -- e.g. INV-202602-00001
    customer_code       TEXT NOT NULL REFERENCES ar_customers(customer_code),
    customer_invoice_no TEXT,                   -- our invoice number to customer
    invoice_date        DATE NOT NULL,
    due_date            DATE NOT NULL,
    period_id           INTEGER NOT NULL REFERENCES sys_periods(period_id),
    status              TEXT NOT NULL DEFAULT 'UNPOSTED',
    -- LP2.0 alignment: load_number links back to LP loads
    lp_load_number      TEXT,
    lp_load_date        DATE,
    subtotal_excl_vat   REAL NOT NULL DEFAULT 0,
    vat_amount          REAL NOT NULL DEFAULT 0,
    total_incl_vat      REAL NOT NULL DEFAULT 0,
    amount_received     REAL NOT NULL DEFAULT 0,
    balance_due         REAL NOT NULL DEFAULT 0,
    journal_id          INTEGER REFERENCES gl_journals(journal_id),
    document_ref        TEXT,
    notes               TEXT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK (status IN ('UNPOSTED','POSTED','PARTIAL','PAID','DISPUTED',
                      'CANCELLED','OVERDUE'))
);

-- ar_invoice_lines
CREATE TABLE ar_invoice_lines (
    line_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id          INTEGER NOT NULL REFERENCES ar_invoices(invoice_id),
    line_number         INTEGER NOT NULL,
    description         TEXT NOT NULL,
    gl_account_code     TEXT REFERENCES gl_accounts(account_code),
    lp_load_number      TEXT,                   -- specific load this line relates to
    lp_route            TEXT,                   -- From-To route code
    quantity            REAL NOT NULL DEFAULT 1,
    unit_rate           REAL NOT NULL DEFAULT 0,
    subtotal_excl_vat   REAL NOT NULL DEFAULT 0,
    vat_type            TEXT REFERENCES sys_vat_types(vat_code),
    vat_amount          REAL NOT NULL DEFAULT 0,
    line_total_incl     REAL NOT NULL DEFAULT 0,
    UNIQUE(invoice_id, line_number)
);

-- ar_receipts
CREATE TABLE ar_receipts (
    receipt_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_ref         TEXT NOT NULL UNIQUE,   -- e.g. REC-202602-00001
    customer_code       TEXT NOT NULL REFERENCES ar_customers(customer_code),
    receipt_date        DATE NOT NULL,
    period_id           INTEGER NOT NULL REFERENCES sys_periods(period_id),
    bank_account        TEXT DEFAULT '8400',
    payment_method      TEXT DEFAULT 'EFT',
    amount              REAL NOT NULL,
    journal_id          INTEGER REFERENCES gl_journals(journal_id),
    notes               TEXT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ar_receipt_allocations
CREATE TABLE ar_receipt_allocations (
    alloc_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id          INTEGER NOT NULL REFERENCES ar_receipts(receipt_id),
    invoice_id          INTEGER NOT NULL REFERENCES ar_invoices(invoice_id),
    allocated_amount    REAL NOT NULL,
    allocated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(receipt_id, invoice_id)
);

-- ar_credit_notes
CREATE TABLE ar_credit_notes (
    cn_id               INTEGER PRIMARY KEY AUTOINCREMENT,
    cn_ref              TEXT NOT NULL UNIQUE,   -- e.g. CN-202602-00001
    customer_code       TEXT NOT NULL REFERENCES ar_customers(customer_code),
    original_invoice_id INTEGER REFERENCES ar_invoices(invoice_id),
    cn_date             DATE NOT NULL,
    period_id           INTEGER NOT NULL REFERENCES sys_periods(period_id),
    reason              TEXT,
    subtotal_excl_vat   REAL NOT NULL DEFAULT 0,
    vat_amount          REAL NOT NULL DEFAULT 0,
    total_incl_vat      REAL NOT NULL DEFAULT 0,
    status              TEXT NOT NULL DEFAULT 'UNPOSTED',
    journal_id          INTEGER REFERENCES gl_journals(journal_id),
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK (status IN ('UNPOSTED','POSTED','APPLIED','CANCELLED'))
);

-- VIEWS

-- vw_vat201_summary
CREATE VIEW vw_vat201_summary AS
SELECT
    t.vat_period,
    ROUND(SUM(CASE WHEN t.source_module='AR_INV' AND t.vat_direction='OUTPUT' AND t.is_capital_goods=0 THEN t.exclusive_amount ELSE 0 END),2) AS field1_output_sales_excl,
    ROUND(SUM(CASE WHEN t.source_module='AR_INV' AND t.vat_direction='OUTPUT' AND t.is_capital_goods=0 THEN t.vat_amount ELSE 0 END),2) AS field1_output_sales_vat,
    ROUND(SUM(CASE WHEN t.source_module='AR_CN' AND t.vat_direction='OUTPUT' THEN t.exclusive_amount ELSE 0 END),2) AS field1a_output_cn_excl,
    ROUND(SUM(CASE WHEN t.source_module='AR_CN' AND t.vat_direction='OUTPUT' THEN t.vat_amount ELSE 0 END),2) AS field1a_output_cn_vat,
    ROUND(SUM(CASE WHEN t.source_module='FA_DISP' AND t.vat_direction='OUTPUT' THEN t.exclusive_amount ELSE 0 END),2) AS field4_output_capital_excl,
    ROUND(SUM(CASE WHEN t.source_module='FA_DISP' AND t.vat_direction='OUTPUT' THEN t.vat_amount ELSE 0 END),2) AS field4_output_capital_vat,
    ROUND(SUM(CASE WHEN t.source_module IN ('AP_INV','AP_CN') AND t.vat_direction='INPUT' AND t.is_capital_goods=0 THEN t.vat_amount ELSE 0 END),2) AS field14_input_purchases_vat,
    ROUND(SUM(CASE WHEN t.source_module='FA_PUR' AND t.vat_direction='INPUT' AND t.is_capital_goods=1 THEN t.vat_amount ELSE 0 END),2) AS field15_input_capital_vat,
    ROUND(SUM(CASE WHEN v.is_imported=1 AND t.vat_direction='INPUT' THEN t.vat_amount ELSE 0 END),2) AS field16_input_imported_vat,
    ROUND(SUM(CASE WHEN t.vat_direction='OUTPUT' THEN t.vat_amount ELSE 0 END) - SUM(CASE WHEN t.vat_direction='INPUT' THEN t.vat_amount ELSE 0 END),2) AS net_vat_payable
FROM vat_transactions t
JOIN sys_vat_types v ON t.vat_code = v.vat_code
GROUP BY t.vat_period;

-- vw_trial_balance
CREATE VIEW vw_trial_balance AS
SELECT a.account_code, a.account_name, a.category, a.account_type, a.ifrs_classification,
    COALESCE(SUM(l.debit),0) AS total_debit,
    COALESCE(SUM(l.credit),0) AS total_credit,
    COALESCE(SUM(l.debit),0)-COALESCE(SUM(l.credit),0) AS balance
FROM gl_accounts a
LEFT JOIN gl_journal_lines l ON a.account_code=l.account_code
LEFT JOIN gl_journals j ON l.journal_id=j.journal_id AND j.posted=1
WHERE a.active=1
GROUP BY a.account_code,a.account_name,a.category,a.account_type,a.ifrs_classification;

-- vw_supplier_aging
CREATE VIEW vw_supplier_aging AS
SELECT i.supplier_code, s.supplier_name, s.group_terms,
    i.invoice_ref, i.supplier_invoice_no, i.invoice_date, i.due_date,
    i.total_incl_vat, i.amount_paid, i.balance_due,
    CAST((JULIANDAY('now')-JULIANDAY(i.due_date)) AS INTEGER) AS days_overdue,
    CASE WHEN JULIANDAY('now')-JULIANDAY(i.due_date)<=0 THEN 'Current'
         WHEN JULIANDAY('now')-JULIANDAY(i.due_date)<=30 THEN '1-30 Days'
         WHEN JULIANDAY('now')-JULIANDAY(i.due_date)<=60 THEN '31-60 Days'
         WHEN JULIANDAY('now')-JULIANDAY(i.due_date)<=90 THEN '61-90 Days'
         ELSE '90+ Days' END AS aging_bucket
FROM ap_invoices i JOIN ap_suppliers s ON i.supplier_code=s.supplier_code
WHERE i.status NOT IN ('PAID','CANCELLED') AND i.balance_due>0;

-- vw_fixed_assets
CREATE VIEW vw_fixed_assets AS
SELECT a.asset_code, a.description, c.class_name, c.class_code,
    a.purchase_date, a.purchase_price,
    a.tax_depre_prior, a.tax_depre_curr_yr, a.tax_value,
    a.book_depre_total, a.book_nbv,
    (a.book_nbv-a.tax_value) AS timing_difference,
    (a.book_nbv-a.tax_value)*0.27 AS deferred_tax_27pct,
    c.sars_wt_rate_pct, c.ifrs_useful_life_yr,
    a.fully_depreciated, a.is_active, a.location, a.reg_number
FROM fa_assets a JOIN fa_asset_classes c ON a.class_code=c.class_code;

-- vw_debtor_aging
CREATE VIEW vw_debtor_aging AS
SELECT
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
    i.balance_due,
    CAST((JULIANDAY('now') - JULIANDAY(i.due_date)) AS INTEGER) AS days_overdue,
    CASE
        WHEN JULIANDAY('now') - JULIANDAY(i.due_date) <= 0   THEN 'Current'
        WHEN JULIANDAY('now') - JULIANDAY(i.due_date) <= 30  THEN '1-30 Days'
        WHEN JULIANDAY('now') - JULIANDAY(i.due_date) <= 60  THEN '31-60 Days'
        WHEN JULIANDAY('now') - JULIANDAY(i.due_date) <= 90  THEN '61-90 Days'
        ELSE '90+ Days'
    END AS aging_bucket
FROM ar_invoices i
JOIN ar_customers c ON i.customer_code = c.customer_code
WHERE i.status NOT IN ('PAID','CANCELLED')
  AND i.balance_due > 0;
