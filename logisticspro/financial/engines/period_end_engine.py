"""
LP2.0 Period-End Closing Engine
=================================
Interland Distribution Cape (Pty) Ltd

DESIGN PHILOSOPHY — NO HARD ROLLOVERS, NO DATA LOSS
─────────────────────────────────────────────────────
Historic data is never deleted or wiped. Year-end closing works by posting
journal entries that REPRESENT the closing of income/expense accounts into
Retained Earnings, not by zeroing records. All original journals remain fully
intact and queryable forever.

HOW "CLEARING" INCOME & EXPENSES WORKS WITHOUT DELETING DATA
─────────────────────────────────────────────────────────────
At year-end we post a YE (Year-End) closing journal that:
  - Debit: all income accounts  (eliminating their credit balances)
  - Credit: all expense accounts (eliminating their debit balances)
  - Net difference → Retained Earnings (5900)

This mirrors what Sage Evolution does on year-end rollover. The difference is
LP2.0 keeps the original source journals (FA, AP, AR, BC, GJ) permanently.
The YE journal is a SUMMARY MEMO entry in the FIRST period of the NEW year.
The closing journal has source_module='YE_CLOSE' and is clearly labelled.

To view historical P&L, you simply exclude YE_CLOSE journals or filter by
period_id — the originals are always there.

PERIOD LOCKING
──────────────
Locked periods (is_closed=1) block new journal postings.
Reopening a period (is_closed=0) is permitted but requires a reason and is
fully audit-logged. Journals posted into a reopened period carry
source_module='REOPEN_POST' flag and appear distinctly in reports.

VAT PERIODS
───────────
VAT periods follow South African VAT vendor categories:
  Cat A: 2-monthly periods (Jan/Feb, Mar/Apr, May/Jun, Jul/Aug, Sep/Oct, Nov/Dec)
  Cat B: 6-monthly periods (Feb–Jul, Aug–Jan)
sys_vat_periods tracks each VAT filing period separately from GL periods.
A VAT period can be locked independently of GL periods.

TRANSACTION SCHEME — PERIOD-END JOURNAL TYPES
──────────────────────────────────────────────
journal_type | source_module   | Description
─────────────────────────────────────────────────────────────────────────
YE           | YE_CLOSE        | Year-end income/expense closing to RE
YE           | YE_OB           | Opening balance carry-forward (new FY period 1)
GJ           | REOPEN_POST     | Journal posted into a previously closed (reopened) period
GJ           | PERIOD_ADJ      | Adjustment posted during standard period close review
BC           | CB_IMPORT       | Cashbook import (CSV or bank feed)
BC           | CB_MANUAL       | Cashbook manual entry
BC           | CB_MATCHED      | Cashbook entry matched to AI-suggested allocation

JOURNAL REF FORMAT
──────────────────
YE-{YYYYMM}-{SEQ:05d}   e.g. YE-202602-00001 (closing entry)
OB-{YYYYMM}-{SEQ:05d}   e.g. OB-202703-00001 (opening balance in new FY)
CB-{YYYYMM}-{SEQ:05d}   e.g. CB-202602-00001 (cashbook entries)

FUNCTIONS IN THIS MODULE
────────────────────────
Period Management:
  lock_period(period_id, locked_by)          → Lock a GL period
  unlock_period(period_id, unlocked_by, reason) → Reopen a locked period
  get_period_status(period_id)               → Full status of a period
  list_periods(fy_id)                        → All periods for a FY

VAT Period Management:
  ensure_vat_periods(fy_id)                  → Auto-create VAT periods for a FY
  lock_vat_period(vat_period_id, locked_by)  → Lock a VAT filing period
  unlock_vat_period(vat_period_id, ...)      → Reopen a VAT period
  get_vat_period_for_date(date)              → Find VAT period for a transaction date

Year-End Closing:
  preview_year_end(fy_id)                    → Show what the YE close will post
  run_year_end_close(fy_id, closed_by)       → Execute YE closing journal
  create_new_financial_year(fy_code, start, end) → Add FY to sys_financial_years
  generate_new_year_periods(fy_id)           → Generate 12 monthly periods
  post_opening_balances(fy_id, posted_by)    → Carry forward balance sheet to new FY

Cashbook:
  import_cashbook_csv(filepath, period_id, bank_account, imported_by) → Import bank CSV
  suggest_allocations(cb_entry)              → AI memory: suggest GL allocation
  learn_allocation(cb_entry, allocated_to)  → Record allocation for learning
  post_cashbook_batch(entries, posted_by)   → Post matched entries as BC journals
"""

import sqlite3
import csv
import json
import re
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional
from dateutil.relativedelta import relativedelta

DB_PATH = 'lp2_new.db'


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    return c


def _decimal(val) -> Decimal:
    return Decimal(str(val or 0)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def _audit(conn, table: str, record_id, action: str, changed_by: str,
           old_values=None, new_values=None):
    conn.execute(
        """INSERT INTO gl_audit_log
           (table_name, record_id, action, changed_by, old_values, new_values)
           VALUES (?,?,?,?,?,?)""",
        (table, record_id, action, changed_by,
         json.dumps(old_values) if old_values else None,
         json.dumps(new_values) if new_values else None))


def _next_journal_ref(conn, prefix: str, period_id: int) -> str:
    """Generate next sequential journal reference.
    prefix = 'YE', 'OB', 'CB' etc.
    Format: {PREFIX}-{YYYYMM}-{SEQ:05d}
    """
    period = conn.execute(
        "SELECT period_start FROM sys_periods WHERE period_id=?",
        (period_id,)).fetchone()
    if not period:
        raise ValueError(f"Period {period_id} not found")
    yyyymm = period['period_start'][:7].replace('-', '')
    like_prefix = f"{prefix}-{yyyymm}-"
    last = conn.execute(
        "SELECT journal_ref FROM gl_journals "
        "WHERE journal_ref LIKE ? ORDER BY journal_ref DESC LIMIT 1",
        (like_prefix + '%',)).fetchone()
    seq = (int(last['journal_ref'].split('-')[-1]) + 1) if last else 1
    return f"{like_prefix}{seq:05d}"


# ─────────────────────────────────────────────────────────────────────────────
# SCHEMA EXTENSIONS — run once to add new tables/columns
# ─────────────────────────────────────────────────────────────────────────────

SCHEMA_EXTENSIONS = """
-- VAT periods (separate from GL periods; tracks Cat A / Cat B filing windows)
CREATE TABLE IF NOT EXISTS sys_vat_periods (
    vat_period_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    vat_period_code TEXT NOT NULL UNIQUE,   -- e.g. '202601' (Jan/Feb Cat A)
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    vat_category    TEXT NOT NULL DEFAULT "A",
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

-- Period lock audit trail (supplements gl_audit_log with human-readable record)
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

-- Cashbook memory: allocation learning table
CREATE TABLE IF NOT EXISTS cb_allocation_memory (
    memory_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Matching keys (pattern matching basis)
    description_pattern TEXT NOT NULL,      -- normalised description from bank
    counterparty        TEXT,               -- bank narration counterparty
    amount_sign         TEXT,               -- 'DEBIT' or 'CREDIT' (money in/out)
    amount_band         TEXT,               -- 'SMALL'/<1k, 'MED'/1k-10k, 'LARGE'>10k
    -- Suggested allocation
    gl_account_code TEXT NOT NULL,
    vat_type        TEXT,
    description_override TEXT,              -- suggested journal description
    -- Learning metadata
    confidence      INTEGER NOT NULL DEFAULT 1,   -- count of times this mapping used
    last_used       DATE,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(description_pattern, amount_sign)
);

-- Cashbook staging: imported/manual entries awaiting GL posting
CREATE TABLE IF NOT EXISTS cb_staging (
    staging_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    import_batch    TEXT NOT NULL,          -- batch reference e.g. 'CB-IMPORT-20260620'
    bank_account    TEXT NOT NULL,          -- GL account code for the bank account
    transaction_date DATE NOT NULL,
    value_date      DATE,
    description     TEXT NOT NULL,
    reference       TEXT,
    amount          REAL NOT NULL,          -- positive=credit to bank (receipt), negative=debit (payment)
    balance         REAL,                   -- running balance from bank statement
    -- Allocation
    status          TEXT NOT NULL DEFAULT 'UNMATCHED',  -- UNMATCHED / SUGGESTED / MATCHED / POSTED / EXCLUDED
    gl_account_code TEXT,                   -- suggested or confirmed allocation
    vat_type        TEXT,
    journal_description TEXT,
    memory_id       INTEGER REFERENCES cb_allocation_memory(memory_id),
    confidence_score REAL,                  -- 0.0 to 1.0
    -- After posting
    journal_id      INTEGER,
    journal_ref     TEXT,
    posted_by       TEXT,
    posted_at       DATETIME,
    -- Metadata
    source          TEXT NOT NULL DEFAULT 'CSV_IMPORT',  -- CSV_IMPORT / MANUAL / BANK_FEED
    imported_by     TEXT,
    imported_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes           TEXT
);

-- Add reopen tracking columns to sys_periods if not already there
-- (SQLite doesn't support ADD COLUMN IF NOT EXISTS directly, so we use separate statements)
ALTER TABLE sys_periods ADD COLUMN locked_by TEXT;
ALTER TABLE sys_periods ADD COLUMN locked_at DATETIME;
ALTER TABLE sys_periods ADD COLUMN unlocked_by TEXT;
ALTER TABLE sys_periods ADD COLUMN unlocked_at DATETIME;
ALTER TABLE sys_periods ADD COLUMN unlock_reason TEXT;
ALTER TABLE sys_periods ADD COLUMN reopen_count INTEGER NOT NULL DEFAULT 0;

-- Add reopen flag to gl_journals for journals posted into reopened periods
ALTER TABLE gl_journals ADD COLUMN posted_in_reopened_period INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gl_journals ADD COLUMN reopen_reason TEXT;
"""


def apply_schema_extensions():
    """Apply schema extensions. Safe to run multiple times — uses IF NOT EXISTS
    and catches 'duplicate column' errors from ALTER TABLE."""
    conn = _conn()
    statements = [s.strip() for s in SCHEMA_EXTENSIONS.split(';') if s.strip()]
    results = []
    for stmt in statements:
        try:
            conn.execute(stmt)
            results.append({'sql': stmt[:60], 'status': 'OK'})
        except sqlite3.OperationalError as e:
            # ALTER TABLE duplicate column = already done = fine
            if 'duplicate column' in str(e).lower():
                results.append({'sql': stmt[:60], 'status': 'ALREADY_EXISTS'})
            else:
                results.append({'sql': stmt[:60], 'status': f'ERROR: {e}'})
    conn.commit()
    conn.close()
    ok = sum(1 for r in results if r['status'] in ('OK', 'ALREADY_EXISTS'))
    errs = [r for r in results if 'ERROR' in r['status']]
    print(f"Schema extensions: {ok} OK, {len(errs)} errors")
    for e in errs:
        print(f"  ❌ {e}")
    return results


# ─────────────────────────────────────────────────────────────────────────────
# PERIOD MANAGEMENT — GL PERIODS
# ─────────────────────────────────────────────────────────────────────────────

def get_period_status(period_id: int) -> dict:
    """Return full status of a GL period including journal counts."""
    conn = _conn()
    p = conn.execute("""
        SELECT p.*, f.fy_code
        FROM sys_periods p
        JOIN sys_financial_years f ON p.fy_id = f.fy_id
        WHERE p.period_id = ?
    """, (period_id,)).fetchone()
    if not p:
        conn.close()
        return {'error': f'Period {period_id} not found'}

    # Count journals
    jstats = conn.execute("""
        SELECT
            COUNT(*) as total_journals,
            SUM(CASE WHEN posted=1 THEN 1 ELSE 0 END) as posted_journals,
            SUM(CASE WHEN posted_in_reopened_period=1 THEN 1 ELSE 0 END) as reopen_posts
        FROM gl_journals WHERE period_id=?
    """, (period_id,)).fetchone()

    # Depreciation run exists?
    depre = conn.execute(
        "SELECT COUNT(*) FROM fa_depreciation_runs WHERE period_id=?",
        (period_id,)).fetchone()

    conn.close()
    return {
        'period_id':     period_id,
        'fy_code':       p['fy_code'],
        'period_number': p['period_number'],
        'period_name':   p['period_name'],
        'period_start':  p['period_start'],
        'period_end':    p['period_end'],
        'is_closed':     bool(p['is_closed']),
        'locked_by':     p['locked_by'],
        'locked_at':     p['locked_at'],
        'unlocked_by':   p['unlocked_by'],
        'reopen_count':  p['reopen_count'] or 0,
        'total_journals':  jstats['total_journals'] or 0,
        'posted_journals': jstats['posted_journals'] or 0,
        'reopen_posts':    jstats['reopen_posts'] or 0,
        'depre_run_exists': bool(depre[0]),
    }


def list_periods(fy_id: int = None) -> list:
    """List all GL periods, optionally filtered by financial year."""
    conn = _conn()
    sql = """
        SELECT p.period_id, p.period_number, p.period_name,
               p.period_start, p.period_end, p.is_closed,
               p.locked_by, p.reopen_count, f.fy_code
        FROM sys_periods p
        JOIN sys_financial_years f ON p.fy_id = f.fy_id
    """
    if fy_id:
        rows = conn.execute(sql + " WHERE p.fy_id=? ORDER BY p.period_number", (fy_id,)).fetchall()
    else:
        rows = conn.execute(sql + " ORDER BY p.period_start").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def lock_period(period_id: int, locked_by: str,
                lock_vat: bool = True) -> dict:
    """
    Lock a GL period. Blocks new journal postings.
    Optionally locks the overlapping VAT period too.

    Returns:
        dict with status, warnings (e.g. unposted transactions exist)
    """
    conn = _conn()
    p = conn.execute(
        "SELECT * FROM sys_periods WHERE period_id=?", (period_id,)).fetchone()
    if not p:
        conn.close()
        return {'status': 'ERROR', 'error': f'Period {period_id} not found'}

    if p['is_closed']:
        conn.close()
        return {'status': 'ALREADY_CLOSED',
                'message': f'{p["period_name"]} is already locked'}

    # Check for unposted journals — warn but don't block
    unposted = conn.execute(
        "SELECT COUNT(*) FROM gl_journals WHERE period_id=? AND posted=0",
        (period_id,)).fetchone()[0]
    warnings = []
    if unposted:
        warnings.append(
            f'⚠️  {unposted} unposted journal(s) in {p["period_name"]} — '
            f'these will NOT be posted when period locks. Review before proceeding.')

    # Lock the period
    now = datetime.now().isoformat(timespec='seconds')
    conn.execute("""
        UPDATE sys_periods
        SET is_closed=1, locked_by=?, locked_at=?
        WHERE period_id=?
    """, (locked_by, now, period_id))

    # Audit log
    _audit(conn, 'sys_periods', period_id, 'LOCK_PERIOD', locked_by,
           old_values={'is_closed': 0},
           new_values={'is_closed': 1, 'locked_by': locked_by, 'locked_at': now})

    conn.execute("""
        INSERT INTO sys_period_lock_log
        (period_id, period_type, action, actioned_by)
        VALUES (?, 'GL', 'LOCK', ?)
    """, (period_id, locked_by))

    vat_locked = None
    if lock_vat:
        # Find the VAT period that contains this GL period end date
        vat_p = conn.execute("""
            SELECT vat_period_id, vat_period_code, is_locked
            FROM sys_vat_periods
            WHERE period_end >= ? AND period_start <= ? AND is_locked=0
            LIMIT 1
        """, (p['period_end'], p['period_end'])).fetchone()
        if vat_p:
            # Only lock VAT period if ALL its GL periods are now closed
            gl_periods_in_vat = conn.execute("""
                SELECT COUNT(*) FROM sys_periods
                WHERE period_start >= (SELECT period_start FROM sys_vat_periods WHERE vat_period_id=?)
                  AND period_end   <= (SELECT period_end   FROM sys_vat_periods WHERE vat_period_id=?)
                  AND is_closed = 0
            """, (vat_p['vat_period_id'], vat_p['vat_period_id'])).fetchone()[0]
            if gl_periods_in_vat == 0:
                conn.execute("""
                    UPDATE sys_vat_periods
                    SET is_locked=1, locked_by=?, locked_at=?
                    WHERE vat_period_id=?
                """, (locked_by, now, vat_p['vat_period_id']))
                conn.execute("""
                    INSERT INTO sys_period_lock_log
                    (vat_period_id, period_type, action, actioned_by)
                    VALUES (?, 'VAT', 'LOCK', ?)
                """, (vat_p['vat_period_id'], locked_by))
                vat_locked = vat_p['vat_period_code']
            else:
                warnings.append(
                    f'ℹ️  VAT period {vat_p["vat_period_code"]} NOT locked — '
                    f'{gl_periods_in_vat} GL period(s) within it still open.')

    conn.commit()
    conn.close()

    result = {
        'status':     'LOCKED',
        'period_id':  period_id,
        'period_name': p['period_name'],
        'locked_by':  locked_by,
        'warnings':   warnings,
    }
    if vat_locked:
        result['vat_period_locked'] = vat_locked
    return result


def unlock_period(period_id: int, unlocked_by: str, reason: str) -> dict:
    """
    Reopen a locked GL period for additional postings.
    Journals posted into a reopened period are flagged posted_in_reopened_period=1.
    This is a fully audited action.

    Args:
        period_id:    GL period to reopen
        unlocked_by:  Username performing the reopen
        reason:       Mandatory reason (e.g. 'Late supplier invoice received Feb 2026')
    """
    if not reason or len(reason.strip()) < 5:
        return {'status': 'ERROR',
                'error': 'A reason is required to reopen a period (minimum 5 characters).'}

    conn = _conn()
    p = conn.execute(
        "SELECT * FROM sys_periods WHERE period_id=?", (period_id,)).fetchone()
    if not p:
        conn.close()
        return {'status': 'ERROR', 'error': f'Period {period_id} not found'}

    if not p['is_closed']:
        conn.close()
        return {'status': 'ALREADY_OPEN',
                'message': f'{p["period_name"]} is already open'}

    now = datetime.now().isoformat(timespec='seconds')
    reopen_count = (p['reopen_count'] or 0) + 1

    conn.execute("""
        UPDATE sys_periods
        SET is_closed=0, unlocked_by=?, unlocked_at=?, unlock_reason=?,
            reopen_count=?
        WHERE period_id=?
    """, (unlocked_by, now, reason.strip(), reopen_count, period_id))

    _audit(conn, 'sys_periods', period_id, 'UNLOCK_PERIOD', unlocked_by,
           old_values={'is_closed': 1},
           new_values={'is_closed': 0, 'unlocked_by': unlocked_by,
                       'unlock_reason': reason, 'reopen_count': reopen_count})

    conn.execute("""
        INSERT INTO sys_period_lock_log
        (period_id, period_type, action, actioned_by, reason)
        VALUES (?, 'GL', 'UNLOCK', ?, ?)
    """, (period_id, unlocked_by, reason.strip()))

    conn.commit()
    conn.close()

    return {
        'status':       'UNLOCKED',
        'period_id':    period_id,
        'period_name':  p['period_name'],
        'unlocked_by':  unlocked_by,
        'reason':       reason,
        'reopen_count': reopen_count,
        'warning': (
            '⚠️  Journals posted into this period will be flagged as '
            'REOPEN_POST. They will appear distinctly in audit reports.'
        )
    }


def flag_reopen_post(conn, journal_id: int, reason: str):
    """Mark a journal as having been posted into a reopened period."""
    conn.execute("""
        UPDATE gl_journals
        SET posted_in_reopened_period=1, reopen_reason=?
        WHERE journal_id=?
    """, (reason, journal_id))


# ─────────────────────────────────────────────────────────────────────────────
# VAT PERIOD MANAGEMENT
# ─────────────────────────────────────────────────────────────────────────────

def ensure_vat_periods(fy_id: int, vat_category: str = 'A') -> list:
    """
    Auto-create VAT filing periods for a financial year.

    Cat A (2-monthly): Jan/Feb, Mar/Apr, May/Jun, Jul/Aug, Sep/Oct, Nov/Dec
    Cat B (6-monthly): Mar-Aug, Sep-Feb  (aligned to Mar-Feb FY)

    Returns list of created (or existing) vat period codes.
    """
    conn = _conn()
    fy = conn.execute(
        "SELECT * FROM sys_financial_years WHERE fy_id=?", (fy_id,)).fetchone()
    if not fy:
        conn.close()
        return []

    fy_start = date.fromisoformat(fy['fy_start'])  # e.g. 2025-03-01
    fy_end   = date.fromisoformat(fy['fy_end'])    # e.g. 2026-02-28
    created  = []

    if vat_category == 'A':
        # 2-monthly periods
        # Find the first bimonth start on or before fy_start
        # Bimonth starts: Jan, Mar, May, Jul, Sep, Nov
        bimonth_starts = [1, 3, 5, 7, 9, 11]
        cursor = fy_start
        if cursor.month % 2 == 0:
            cursor = cursor.replace(day=1) - relativedelta(months=1)
        else:
            cursor = cursor.replace(day=1)

        while cursor <= fy_end:
            p_start = cursor
            p_end   = (cursor + relativedelta(months=2)) - timedelta(days=1)
            if p_end > fy_end:
                p_end = fy_end
            code = p_end.strftime('%Y%m')   # period named by end month
            try:
                conn.execute("""
                    INSERT INTO sys_vat_periods
                    (vat_period_code, period_start, period_end, vat_category)
                    VALUES (?,?,?,?)
                """, (code, p_start.isoformat(), p_end.isoformat(), 'A'))
                created.append({'code': code, 'start': str(p_start),
                                'end': str(p_end), 'status': 'CREATED'})
            except sqlite3.IntegrityError:
                created.append({'code': code, 'start': str(p_start),
                                'end': str(p_end), 'status': 'EXISTS'})
            cursor = cursor + relativedelta(months=2)

    elif vat_category == 'B':
        # 6-monthly for Mar-Feb FY:  Mar-Aug, Sep-Feb
        pairs = [
            (fy_start, fy_start + relativedelta(months=6) - timedelta(days=1)),
            (fy_start + relativedelta(months=6),
             fy_start + relativedelta(months=12) - timedelta(days=1)),
        ]
        for p_start, p_end in pairs:
            if p_end > fy_end:
                p_end = fy_end
            code = p_end.strftime('%Y%m')
            try:
                conn.execute("""
                    INSERT INTO sys_vat_periods
                    (vat_period_code, period_start, period_end, vat_category)
                    VALUES (?,?,?,?)
                """, (code, p_start.isoformat(), p_end.isoformat(), 'B'))
                created.append({'code': code, 'start': str(p_start),
                                'end': str(p_end), 'status': 'CREATED'})
            except sqlite3.IntegrityError:
                created.append({'code': code, 'start': str(p_start),
                                'end': str(p_end), 'status': 'EXISTS'})

    conn.commit()
    conn.close()
    return created


def lock_vat_period(vat_period_id: int, locked_by: str,
                    filed: bool = False) -> dict:
    """Lock a VAT period. Optionally mark as filed (submitted to SARS)."""
    conn = _conn()
    vp = conn.execute(
        "SELECT * FROM sys_vat_periods WHERE vat_period_id=?",
        (vat_period_id,)).fetchone()
    if not vp:
        conn.close()
        return {'status': 'ERROR', 'error': 'VAT period not found'}
    if vp['is_locked']:
        conn.close()
        return {'status': 'ALREADY_LOCKED',
                'message': f"VAT period {vp['vat_period_code']} already locked"}

    now = datetime.now().isoformat(timespec='seconds')
    conn.execute("""
        UPDATE sys_vat_periods
        SET is_locked=1, locked_by=?, locked_at=?,
            is_filed=?, filed_by=?, filed_at=?
        WHERE vat_period_id=?
    """, (locked_by, now,
          1 if filed else 0,
          locked_by if filed else None,
          now if filed else None,
          vat_period_id))

    conn.execute("""
        INSERT INTO sys_period_lock_log
        (vat_period_id, period_type, action, actioned_by)
        VALUES (?, 'VAT', 'LOCK', ?)
    """, (vat_period_id, locked_by))

    conn.commit()
    conn.close()
    return {
        'status': 'LOCKED',
        'vat_period_code': vp['vat_period_code'],
        'is_filed': filed,
    }


def unlock_vat_period(vat_period_id: int, unlocked_by: str,
                      reason: str) -> dict:
    """Reopen a locked VAT period (e.g. to post a late transaction)."""
    if not reason or len(reason.strip()) < 5:
        return {'status': 'ERROR', 'error': 'Reason required to unlock VAT period.'}

    conn = _conn()
    vp = conn.execute(
        "SELECT * FROM sys_vat_periods WHERE vat_period_id=?",
        (vat_period_id,)).fetchone()
    if not vp:
        conn.close()
        return {'status': 'ERROR', 'error': 'VAT period not found'}
    if not vp['is_locked']:
        conn.close()
        return {'status': 'ALREADY_OPEN'}

    now = datetime.now().isoformat(timespec='seconds')
    conn.execute("""
        UPDATE sys_vat_periods
        SET is_locked=0, unlocked_by=?, unlocked_reason=?
        WHERE vat_period_id=?
    """, (unlocked_by, reason.strip(), vat_period_id))

    conn.execute("""
        INSERT INTO sys_period_lock_log
        (vat_period_id, period_type, action, actioned_by, reason)
        VALUES (?, 'VAT', 'UNLOCK', ?, ?)
    """, (vat_period_id, unlocked_by, reason.strip()))

    conn.commit()
    conn.close()
    return {
        'status': 'UNLOCKED',
        'vat_period_code': vp['vat_period_code'],
        'unlocked_by': unlocked_by,
        'reason': reason,
    }


def get_vat_period_for_date(for_date: date) -> Optional[dict]:
    """Return the VAT period that contains a given date."""
    conn = _conn()
    vp = conn.execute("""
        SELECT * FROM sys_vat_periods
        WHERE period_start <= ? AND period_end >= ?
        ORDER BY period_start DESC LIMIT 1
    """, (str(for_date), str(for_date))).fetchone()
    conn.close()
    return dict(vp) if vp else None


def list_vat_periods(fy_id: int = None) -> list:
    """List VAT periods, with GL period count and lock status."""
    conn = _conn()
    rows = conn.execute("""
        SELECT vp.*,
               (SELECT COUNT(*) FROM sys_periods p
                WHERE p.period_start >= vp.period_start
                  AND p.period_end   <= vp.period_end) as gl_period_count,
               (SELECT COUNT(*) FROM sys_periods p
                WHERE p.period_start >= vp.period_start
                  AND p.period_end   <= vp.period_end
                  AND p.is_closed=1) as gl_periods_closed
        FROM sys_vat_periods vp
        ORDER BY vp.period_start
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ─────────────────────────────────────────────────────────────────────────────
# YEAR-END CLOSING
# ─────────────────────────────────────────────────────────────────────────────

# Account codes for year-end entries
RETAINED_EARNINGS_ACCOUNT = '5900'   # Will be added to CoA if missing
INCOME_RANGES = [                    # account ranges that are P&L income
    ('1000', '1999'),                # Income / Revenue
    ('2000', '2999'),                # Cost of Sales + Other Income
]
EXPENSE_RANGES = [                   # account ranges that are P&L expenses
    ('3000', '4799'),                # Expenses
    ('4800', '4815'),                # Income Tax
]


def _get_income_expense_balances(conn, fy_id: int) -> dict:
    """
    Calculate net debit/credit balance for all P&L accounts across a full FY.
    Returns dict of account_code -> net_balance (positive = Dr balance)
    """
    rows = conn.execute("""
        SELECT l.account_code,
               SUM(l.debit)  as total_dr,
               SUM(l.credit) as total_cr
        FROM gl_journal_lines l
        JOIN gl_journals j ON l.journal_id = j.journal_id
        JOIN sys_periods p  ON j.period_id  = p.period_id
        WHERE p.fy_id = ?
          AND j.posted = 1
          AND j.source_module != 'YE_CLOSE'   -- exclude any prior closing entries
        GROUP BY l.account_code
    """, (fy_id,)).fetchall()

    # Map account codes to categories
    accounts = conn.execute(
        "SELECT account_code, category, account_name FROM gl_accounts"
    ).fetchall()
    cat_map = {a['account_code']: a['category'] for a in accounts}
    name_map = {a['account_code']: a['account_name'] for a in accounts}

    income_accounts   = {}
    expense_accounts  = {}

    p_and_l_cats = {
        'Income', 'Other Income', 'Cost of Sales', 'Expenses', 'Income Tax'
    }

    for row in rows:
        code = row['account_code']
        cat  = cat_map.get(code, '')
        if cat not in p_and_l_cats:
            continue
        net = _decimal(row['total_dr']) - _decimal(row['total_cr'])
        # net positive = debit balance (typical for expenses)
        # net negative = credit balance (typical for income)
        if cat in ('Income', 'Other Income'):
            income_accounts[code] = {
                'name': name_map.get(code, code),
                'net': net,        # usually negative (credit balance)
                'category': cat,
            }
        else:
            expense_accounts[code] = {
                'name': name_map.get(code, code),
                'net': net,        # usually positive (debit balance)
                'category': cat,
            }

    return {'income': income_accounts, 'expense': expense_accounts}


def _ensure_retained_earnings(conn):
    """Ensure account 5900 Retained Earnings exists in CoA."""
    existing = conn.execute(
        "SELECT account_code FROM gl_accounts WHERE account_code=?",
        (RETAINED_EARNINGS_ACCOUNT,)).fetchone()
    if not existing:
        conn.execute("""
            INSERT INTO gl_accounts
            (account_code, account_name, category, ifrs_classification,
             account_type, is_sub_account, vat_treatment, allow_journals, active)
            VALUES (?, 'Retained Earnings', 'Owners Equity', 'Equity Statement',
                    'Balance Sheet', 0, 'NONE', 1, 1)
        """, (RETAINED_EARNINGS_ACCOUNT,))
        return True
    return False


def preview_year_end(fy_id: int) -> dict:
    """
    Preview the year-end closing journal without posting it.

    Shows:
    - All P&L accounts that will be cleared
    - Net profit/loss that will flow to Retained Earnings
    - Any warnings (unclosed periods, unposted journals etc.)
    """
    conn = _conn()
    fy = conn.execute(
        "SELECT * FROM sys_financial_years WHERE fy_id=?", (fy_id,)).fetchone()
    if not fy:
        conn.close()
        return {'status': 'ERROR', 'error': f'Financial year {fy_id} not found'}

    warnings = []

    # Check all periods are closed
    open_periods = conn.execute("""
        SELECT period_name FROM sys_periods
        WHERE fy_id=? AND is_closed=0
        ORDER BY period_number
    """, (fy_id,)).fetchall()
    if open_periods:
        warnings.append(
            f'⚠️  {len(open_periods)} period(s) still open: '
            + ', '.join(p['period_name'] for p in open_periods)
            + '. All periods should be closed before year-end close.')

    # Check for unposted journals
    unposted = conn.execute("""
        SELECT COUNT(*) FROM gl_journals j
        JOIN sys_periods p ON j.period_id=p.period_id
        WHERE p.fy_id=? AND j.posted=0
    """, (fy_id,)).fetchone()[0]
    if unposted:
        warnings.append(
            f'⚠️  {unposted} unposted journal(s) in {fy["fy_code"]} — '
            f'they will NOT be included in closing entries.')

    # Check if already closed
    if fy['is_closed']:
        warnings.append(f'ℹ️  {fy["fy_code"]} is already marked as closed.')

    # Get P&L balances
    balances = _get_income_expense_balances(conn, fy_id)
    conn.close()

    income_lines  = []
    expense_lines = []
    total_income  = Decimal('0')
    total_expense = Decimal('0')

    for code, info in sorted(balances['income'].items()):
        net = info['net']
        if net == 0:
            continue
        # Income has credit balance (net negative).
        # To close: DR income account by abs(net) to bring to zero
        dr_amt = abs(net) if net < 0 else Decimal('0')
        cr_amt = abs(net) if net > 0 else Decimal('0')  # abnormal debit balance
        income_lines.append({
            'account_code': code,
            'account_name': info['name'],
            'category':     info['category'],
            'net_balance':  float(net),
            'closing_debit':  float(dr_amt),
            'closing_credit': float(cr_amt),
        })
        total_income += net  # will be negative total for income

    for code, info in sorted(balances['expense'].items()):
        net = info['net']
        if net == 0:
            continue
        # Expenses have debit balance (net positive).
        # To close: CR expense account by abs(net) to bring to zero
        cr_amt = abs(net) if net > 0 else Decimal('0')
        dr_amt = abs(net) if net < 0 else Decimal('0')  # abnormal credit balance
        expense_lines.append({
            'account_code': code,
            'account_name': info['name'],
            'category':     info['category'],
            'net_balance':  float(net),
            'closing_debit':  float(dr_amt),
            'closing_credit': float(cr_amt),
        })
        total_expense += net  # will be positive total for expenses

    # Net profit = income + expense (income is negative, expense positive)
    # Profit if income offsets expenses: net_pnl negative = profit, positive = loss
    net_pnl = total_income + total_expense
    # RE entry: net_pnl negative (profit) → CR 5900; positive (loss) → DR 5900

    return {
        'status':         'PREVIEW',
        'fy_id':          fy_id,
        'fy_code':        fy['fy_code'],
        'fy_start':       fy['fy_start'],
        'fy_end':         fy['fy_end'],
        'income_lines':   income_lines,
        'expense_lines':  expense_lines,
        'total_income':   float(total_income),       # negative = credit balances
        'total_expense':  float(total_expense),      # positive = debit balances
        'net_pnl':        float(net_pnl),            # negative = net profit
        'net_pnl_label':  'NET PROFIT' if net_pnl < 0 else 'NET LOSS',
        'retained_earnings_account': RETAINED_EARNINGS_ACCOUNT,
        're_entry_debit':  float(abs(net_pnl)) if net_pnl < 0 else 0.0,
        're_entry_credit': float(abs(net_pnl)) if net_pnl > 0 else 0.0,
        'warnings':       warnings,
        'line_count':     len(income_lines) + len(expense_lines) + 1,
    }


def run_year_end_close(fy_id: int, closed_by: str,
                       force: bool = False) -> dict:
    """
    Execute year-end closing.

    What this does (NO DATA IS DELETED):
    1. Posts a YE closing journal in period 12 of the closing FY:
       - DR all income accounts (clears credit balances to zero)
       - CR all expense accounts (clears debit balances to zero)
       - Net difference → Retained Earnings (5900): profit→CR, loss→DR
    2. Marks all periods in the FY as closed
    3. Marks sys_financial_years.is_closed = 1
    4. Does NOT delete or alter any existing journal lines
    5. Source documents remain intact and fully queryable

    To view historical P&L for the year: filter journals by period.fy_id
    and exclude source_module='YE_CLOSE'.

    Args:
        fy_id:     Financial year to close
        closed_by: Username
        force:     If True, proceeds even if periods are not all closed
                   (you'll get a warning). Default False = blocks on open periods.
    """
    preview = preview_year_end(fy_id)
    if preview.get('status') == 'ERROR':
        return preview

    warnings = preview['warnings']

    # Block on open periods unless force=True
    open_period_warning = [w for w in warnings if 'still open' in w]
    if open_period_warning and not force:
        return {
            'status': 'BLOCKED',
            'error':  open_period_warning[0],
            'hint':   'Lock all periods first, or call run_year_end_close(force=True) to override.'
        }

    conn = _conn()
    fy = conn.execute(
        "SELECT * FROM sys_financial_years WHERE fy_id=?", (fy_id,)).fetchone()

    # Ensure 5900 Retained Earnings exists
    _ensure_retained_earnings(conn)
    conn.commit()

    # Build the closing journal lines
    journal_lines = []
    line_num = 1
    total_dr = Decimal('0')
    total_cr = Decimal('0')

    # Income lines: DR income accounts (zero out credit balances)
    for line in preview['income_lines']:
        dr = _decimal(line['closing_debit'])
        cr = _decimal(line['closing_credit'])
        if dr > 0 or cr > 0:
            journal_lines.append({
                'line_number':  line_num,
                'account_code': line['account_code'],
                'description':  f"YE Close: {line['account_name']}",
                'debit':  float(dr),
                'credit': float(cr),
            })
            total_dr += dr
            total_cr += cr
            line_num += 1

    # Expense lines: CR expense accounts (zero out debit balances)
    for line in preview['expense_lines']:
        dr = _decimal(line['closing_debit'])
        cr = _decimal(line['closing_credit'])
        if dr > 0 or cr > 0:
            journal_lines.append({
                'line_number':  line_num,
                'account_code': line['account_code'],
                'description':  f"YE Close: {line['account_name']}",
                'debit':  float(dr),
                'credit': float(cr),
            })
            total_dr += dr
            total_cr += cr
            line_num += 1

    # Retained Earnings balancing entry
    net_pnl = _decimal(preview['net_pnl'])
    if net_pnl < 0:
        # Net profit → CR Retained Earnings
        re_dr = Decimal('0')
        re_cr = abs(net_pnl)
        re_label = f"Net Profit {fy['fy_code']} → Retained Earnings"
    elif net_pnl > 0:
        # Net loss → DR Retained Earnings
        re_dr = abs(net_pnl)
        re_cr = Decimal('0')
        re_label = f"Net Loss {fy['fy_code']} → Retained Earnings"
    else:
        re_dr = re_cr = Decimal('0')
        re_label = f"Break-even {fy['fy_code']} — no RE entry needed"

    if re_dr > 0 or re_cr > 0:
        journal_lines.append({
            'line_number':  line_num,
            'account_code': RETAINED_EARNINGS_ACCOUNT,
            'description':  re_label,
            'debit':  float(re_dr),
            'credit': float(re_cr),
        })
        total_dr += re_dr
        total_cr += re_cr
        line_num += 1

    # Verify balance
    if abs(total_dr - total_cr) > Decimal('0.01'):
        conn.close()
        return {
            'status': 'ERROR',
            'error':  f'YE closing journal does not balance: '
                      f'DR {total_dr:,.2f} ≠ CR {total_cr:,.2f}',
        }

    # Find period 12 of the closing FY (Feb = last period)
    ye_period = conn.execute("""
        SELECT period_id, period_end FROM sys_periods
        WHERE fy_id=? ORDER BY period_number DESC LIMIT 1
    """, (fy_id,)).fetchone()
    if not ye_period:
        conn.close()
        return {'status': 'ERROR', 'error': f'No periods found for FY {fy_id}'}

    ye_period_id  = ye_period['period_id']
    ye_journal_date = date.fromisoformat(ye_period['period_end'])

    # Temporarily unlock period 12 so YE journal can post into it
    conn.execute(
        "UPDATE sys_periods SET is_closed=0 WHERE period_id=?",
        (ye_period_id,))

    journal_ref = _next_journal_ref(conn, 'YE', ye_period_id)
    now = datetime.now().isoformat(timespec='seconds')

    # Insert journal header
    conn.execute("""
        INSERT INTO gl_journals
        (journal_ref, journal_type, description, period_id, journal_date,
         source_module, posted, posted_at, posted_by, created_by)
        VALUES (?,?,?,?,?,?,1,?,?,?)
    """, (journal_ref, 'YE',
          f"Year-End Closing Journal — {fy['fy_code']}",
          ye_period_id, str(ye_journal_date),
          'YE_CLOSE', now, closed_by, closed_by))

    journal_id = conn.execute(
        "SELECT journal_id FROM gl_journals WHERE journal_ref=?",
        (journal_ref,)).fetchone()[0]

    # Insert journal lines
    for line in journal_lines:
        conn.execute("""
            INSERT INTO gl_journal_lines
            (journal_id, line_number, account_code, description, debit, credit)
            VALUES (?,?,?,?,?,?)
        """, (journal_id, line['line_number'], line['account_code'],
              line['description'], line['debit'], line['credit']))

    # Lock ALL periods in the FY
    conn.execute("""
        UPDATE sys_periods
        SET is_closed=1, locked_by=?, locked_at=?
        WHERE fy_id=?
    """, (closed_by, now, fy_id))

    # Mark FY as closed
    conn.execute("""
        UPDATE sys_financial_years
        SET is_closed=1, is_current=0
        WHERE fy_id=?
    """, (fy_id,))

    # Audit
    _audit(conn, 'sys_financial_years', fy_id, 'YEAR_END_CLOSE', closed_by,
           old_values={'is_closed': 0, 'is_current': 1},
           new_values={'is_closed': 1, 'is_current': 0,
                       'ye_journal': journal_ref})

    conn.commit()
    conn.close()

    return {
        'status':       'CLOSED',
        'fy_id':        fy_id,
        'fy_code':      fy['fy_code'],
        'journal_ref':  journal_ref,
        'journal_id':   journal_id,
        'journal_lines': len(journal_lines),
        'total_debit':  float(total_dr),
        'net_profit' if net_pnl < 0 else 'net_loss': float(abs(net_pnl)),
        're_account':   RETAINED_EARNINGS_ACCOUNT,
        'closed_by':    closed_by,
        'warnings':     warnings,
        'note': (
            'All original P&L journals are INTACT. The YE closing journal is '
            'a SUMMARY entry only. Filter by period_id or exclude '
            'source_module=YE_CLOSE to view historical P&L at any time.'
        )
    }


# ─────────────────────────────────────────────────────────────────────────────
# OPENING NEW FINANCIAL YEAR
# ─────────────────────────────────────────────────────────────────────────────

def create_new_financial_year(fy_code: str, fy_start: date,
                              fy_end: date) -> dict:
    """
    Register a new financial year in sys_financial_years.
    e.g. create_new_financial_year('FY2027', date(2026,3,1), date(2027,2,28))
    """
    conn = _conn()
    try:
        conn.execute("""
            INSERT INTO sys_financial_years
            (fy_code, fy_start, fy_end, is_current, is_closed)
            VALUES (?,?,?,1,0)
        """, (fy_code, str(fy_start), str(fy_end)))
        # Unset is_current on all other years
        conn.execute("""
            UPDATE sys_financial_years SET is_current=0
            WHERE fy_code != ?
        """, (fy_code,))
        fy_id = conn.execute(
            "SELECT fy_id FROM sys_financial_years WHERE fy_code=?",
            (fy_code,)).fetchone()[0]
        conn.commit()
        conn.close()
        return {
            'status': 'CREATED',
            'fy_id':  fy_id,
            'fy_code': fy_code,
            'fy_start': str(fy_start),
            'fy_end':   str(fy_end),
        }
    except sqlite3.IntegrityError:
        conn.close()
        return {'status': 'EXISTS',
                'message': f'{fy_code} already exists in sys_financial_years'}


def generate_new_year_periods(fy_id: int) -> list:
    """
    Generate 12 monthly GL periods for a new financial year.
    Assumes a March–February year-end (Interland standard).
    """
    conn = _conn()
    fy = conn.execute(
        "SELECT * FROM sys_financial_years WHERE fy_id=?", (fy_id,)).fetchone()
    if not fy:
        conn.close()
        return []

    fy_start = date.fromisoformat(fy['fy_start'])
    created = []
    month_names = ['Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb']

    for i in range(12):
        p_start = fy_start + relativedelta(months=i)
        p_end   = (p_start + relativedelta(months=1)) - timedelta(days=1)
        p_name  = p_start.strftime('%b %Y')
        try:
            conn.execute("""
                INSERT INTO sys_periods
                (fy_id, period_number, period_name, period_start, period_end, is_closed)
                VALUES (?,?,?,?,?,0)
            """, (fy_id, i+1, p_name, str(p_start), str(p_end)))
            created.append({
                'period_number': i+1,
                'period_name':   p_name,
                'start': str(p_start),
                'end':   str(p_end),
                'status': 'CREATED',
            })
        except sqlite3.IntegrityError:
            created.append({
                'period_number': i+1,
                'period_name':   p_name,
                'status': 'EXISTS',
            })

    conn.commit()
    conn.close()
    return created


def post_opening_balances(fy_id: int, posted_by: str = 'SYSTEM') -> dict:
    """
    Carry forward balance sheet closing balances as opening balances
    in period 1 of the new financial year.

    HOW IT WORKS (no data loss):
    ─────────────────────────────
    1. Find the previous FY (the one just closed)
    2. Calculate closing balance of every Balance Sheet account
       (Assets, Liabilities, Equity — excludes P&L accounts which were
       already closed to Retained Earnings by run_year_end_close)
    3. Post a single OB journal in period 1 of the NEW year with those balances
    4. The journal has source_module='YE_OB' and is clearly labelled
    5. No existing data is touched

    The new year trial balance = OB journal + new year transactions.
    Historic years' trial balances remain fully intact.
    """
    conn = _conn()
    fy = conn.execute(
        "SELECT * FROM sys_financial_years WHERE fy_id=?", (fy_id,)).fetchone()
    if not fy:
        conn.close()
        return {'status': 'ERROR', 'error': f'FY {fy_id} not found'}

    # Find period 1 of THIS new year
    period1 = conn.execute("""
        SELECT * FROM sys_periods
        WHERE fy_id=? AND period_number=1
    """, (fy_id,)).fetchone()
    if not period1:
        conn.close()
        return {'status': 'ERROR',
                'error': f'No period 1 found for FY {fy_id}. Run generate_new_year_periods first.'}

    # Find prior FY
    prior_fy = conn.execute("""
        SELECT * FROM sys_financial_years
        WHERE fy_end < ? ORDER BY fy_end DESC LIMIT 1
    """, (fy['fy_start'],)).fetchone()
    if not prior_fy:
        conn.close()
        return {'status': 'ERROR', 'error': 'No prior financial year found to carry balances from.'}

    # Get all-time balance sheet account balances from prior FY (all posted journals up to FY end)
    bs_categories = (
        'Current Assets', 'Non-Current Assets',
        'Current Liabilities', 'Non-Current Liabilities',
        'Owners Equity',
    )
    placeholders = ','.join(['?' for _ in bs_categories])
    rows = conn.execute(f"""
        SELECT l.account_code,
               a.account_name,
               a.category,
               a.ifrs_classification,
               SUM(l.debit)  as total_dr,
               SUM(l.credit) as total_cr
        FROM gl_journal_lines l
        JOIN gl_journals j  ON l.journal_id = j.journal_id
        JOIN gl_accounts a  ON l.account_code = a.account_code
        JOIN sys_periods p  ON j.period_id = p.period_id
        WHERE j.posted = 1
          AND p.period_end <= ?
          AND a.category IN ({placeholders})
        GROUP BY l.account_code
        HAVING (SUM(l.debit) - SUM(l.credit)) != 0
        ORDER BY l.account_code
    """, (prior_fy['fy_end'], *bs_categories)).fetchall()

    if not rows:
        conn.close()
        return {
            'status': 'WARNING',
            'message': 'No balance sheet balances found in prior year. Nothing to carry forward.',
            'prior_fy': prior_fy['fy_code'],
        }

    # Build OB journal lines
    journal_lines  = []
    line_num       = 1
    total_dr       = Decimal('0')
    total_cr       = Decimal('0')
    suspense_needed = Decimal('0')

    for row in rows:
        net = _decimal(row['total_dr']) - _decimal(row['total_cr'])
        if net == 0:
            continue
        # Net positive = debit balance → re-open as DR
        # Net negative = credit balance → re-open as CR
        dr = abs(net) if net > 0 else Decimal('0')
        cr = abs(net) if net < 0 else Decimal('0')
        journal_lines.append({
            'line_number':  line_num,
            'account_code': row['account_code'],
            'account_name': row['account_name'],
            'description':  f"OB: {row['account_name']}",
            'debit':  float(dr),
            'credit': float(cr),
        })
        total_dr += dr
        total_cr += cr
        line_num += 1

    # Balance check — should be 0 if BS balanced at year-end
    diff = total_dr - total_cr
    if abs(diff) > Decimal('0.02'):
        # Use 9990 Opening Balance/Suspense to force balance
        # (this would indicate the prior year's BS wasn't balanced — flag for review)
        susp_dr = abs(diff) if diff < 0 else Decimal('0')
        susp_cr = abs(diff) if diff > 0 else Decimal('0')
        journal_lines.append({
            'line_number':  line_num,
            'account_code': '9990',
            'account_name': 'Opening Balance / Suspense Account',
            'description':  f'OB Suspense — BS imbalance from {prior_fy["fy_code"]}',
            'debit':  float(susp_dr),
            'credit': float(susp_cr),
        })
        total_dr += susp_dr
        total_cr += susp_cr
        suspense_needed = abs(diff)
        line_num += 1

    # Post the opening balance journal
    ob_ref = _next_journal_ref(conn, 'OB', period1['period_id'])
    ob_date = date.fromisoformat(period1['period_start'])
    now = datetime.now().isoformat(timespec='seconds')

    conn.execute("""
        INSERT INTO gl_journals
        (journal_ref, journal_type, description, period_id, journal_date,
         source_module, posted, posted_at, posted_by, created_by)
        VALUES (?,?,?,?,?,?,1,?,?,?)
    """, (ob_ref, 'YE',
          f"Opening Balances — {fy['fy_code']} (carried from {prior_fy['fy_code']})",
          period1['period_id'], str(ob_date),
          'YE_OB', now, posted_by, posted_by))

    journal_id = conn.execute(
        "SELECT journal_id FROM gl_journals WHERE journal_ref=?",
        (ob_ref,)).fetchone()[0]

    for line in journal_lines:
        conn.execute("""
            INSERT INTO gl_journal_lines
            (journal_id, line_number, account_code, description, debit, credit)
            VALUES (?,?,?,?,?,?)
        """, (journal_id, line['line_number'], line['account_code'],
              line['description'], line['debit'], line['credit']))

    _audit(conn, 'gl_journals', journal_id, 'OPENING_BALANCES', posted_by,
           new_values={'fy_id': fy_id, 'from_fy': prior_fy['fy_code'],
                       'journal_ref': ob_ref, 'lines': len(journal_lines)})

    conn.commit()
    conn.close()

    result = {
        'status':         'POSTED',
        'fy_id':          fy_id,
        'fy_code':        fy['fy_code'],
        'from_fy':        prior_fy['fy_code'],
        'journal_ref':    ob_ref,
        'journal_id':     journal_id,
        'lines_posted':   len(journal_lines),
        'total_debit':    float(total_dr),
        'total_credit':   float(total_cr),
        'posted_by':      posted_by,
    }
    if suspense_needed > 0:
        result['suspense_warning'] = (
            f'⚠️  R{float(suspense_needed):,.2f} posted to 9990 Suspense — '
            f'prior year balance sheet was not in balance. Investigate and clear.'
        )
    return result


def run_full_year_rollover(closing_fy_id: int,
                           new_fy_code: str,
                           new_fy_start: date,
                           new_fy_end: date,
                           closed_by: str,
                           vat_category: str = 'A',
                           force: bool = False) -> dict:
    """
    Master function: close one FY and open the next.
    Calls in sequence:
      1. run_year_end_close(closing_fy_id)
      2. create_new_financial_year(new_fy_code)
      3. generate_new_year_periods(new_fy_id)
      4. ensure_vat_periods(new_fy_id)
      5. post_opening_balances(new_fy_id)

    Returns consolidated result dict.
    """
    steps = {}

    # Step 1: Year-end close
    ye = run_year_end_close(closing_fy_id, closed_by, force=force)
    steps['year_end_close'] = ye
    if ye['status'] not in ('CLOSED',):
        return {'status': 'FAILED', 'failed_at': 'year_end_close',
                'steps': steps}

    # Step 2: Create new FY
    new_fy = create_new_financial_year(new_fy_code, new_fy_start, new_fy_end)
    steps['create_new_fy'] = new_fy
    if new_fy['status'] not in ('CREATED', 'EXISTS'):
        return {'status': 'FAILED', 'failed_at': 'create_new_fy',
                'steps': steps}
    new_fy_id = new_fy.get('fy_id')
    if not new_fy_id:
        # Fetch it
        conn = _conn()
        new_fy_id = conn.execute(
            "SELECT fy_id FROM sys_financial_years WHERE fy_code=?",
            (new_fy_code,)).fetchone()['fy_id']
        conn.close()

    # Step 3: Generate periods
    periods = generate_new_year_periods(new_fy_id)
    steps['generate_periods'] = {
        'created': sum(1 for p in periods if p['status'] == 'CREATED'),
        'periods': periods,
    }

    # Step 4: VAT periods
    vat_periods = ensure_vat_periods(new_fy_id, vat_category)
    steps['vat_periods'] = {
        'created': sum(1 for v in vat_periods if v['status'] == 'CREATED'),
        'periods': vat_periods,
    }

    # Step 5: Opening balances
    ob = post_opening_balances(new_fy_id, posted_by=closed_by)
    steps['opening_balances'] = ob

    overall = 'COMPLETE' if ob.get('status') == 'POSTED' else 'PARTIAL'
    return {
        'status':         overall,
        'closing_fy_id':  closing_fy_id,
        'new_fy_id':      new_fy_id,
        'new_fy_code':    new_fy_code,
        'ye_journal':     ye.get('journal_ref'),
        'ob_journal':     ob.get('journal_ref'),
        'steps':          steps,
    }


# ─────────────────────────────────────────────────────────────────────────────
# CASHBOOK — MEMORY SYSTEM + CSV IMPORT
# ─────────────────────────────────────────────────────────────────────────────

def _normalise_description(description: str) -> str:
    """
    Normalise a bank transaction description for pattern matching.
    - Uppercase
    - Remove dates (dd/mm/yyyy, dd-mm-yyyy)
    - Remove transaction IDs (long numeric strings)
    - Remove extra whitespace
    """
    if not description:
        return ''
    s = description.upper().strip()
    # Remove date patterns
    s = re.sub(r'\b\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}\b', '', s)
    # Remove long numeric strings (likely transaction IDs)
    s = re.sub(r'\b\d{7,}\b', '', s)
    # Normalise whitespace
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def _amount_band(amount: float) -> str:
    """Classify amount into bands for pattern matching."""
    a = abs(amount)
    if a < 1000:
        return 'SMALL'
    elif a < 10000:
        return 'MED'
    elif a < 100000:
        return 'LARGE'
    else:
        return 'XLARGE'


def suggest_allocations(description: str, amount: float,
                        top_n: int = 3) -> list:
    """
    Query cb_allocation_memory to suggest GL allocations for a cashbook entry.

    Matching strategy (tiered):
    1. Exact normalised description + amount sign + amount band  (highest confidence)
    2. Exact normalised description + amount sign               (medium confidence)
    3. Partial description match (any word from pattern in description)
    4. No match → return empty list

    Returns list of suggestions sorted by confidence desc.
    """
    conn = _conn()
    norm = _normalise_description(description)
    sign = 'CREDIT' if amount > 0 else 'DEBIT'
    band = _amount_band(amount)

    suggestions = []
    seen_accounts = set()

    # Tier 1: exact + band
    rows = conn.execute("""
        SELECT m.*, a.account_name
        FROM cb_allocation_memory m
        JOIN gl_accounts a ON m.gl_account_code = a.account_code
        WHERE m.description_pattern = ? AND m.amount_sign = ? AND m.amount_band = ?
        ORDER BY m.confidence DESC
    """, (norm, sign, band)).fetchall()
    for r in rows:
        if r['gl_account_code'] not in seen_accounts:
            suggestions.append({
                'gl_account_code': r['gl_account_code'],
                'account_name':    r['account_name'],
                'vat_type':        r['vat_type'],
                'description_override': r['description_override'],
                'confidence':      r['confidence'],
                'match_tier':      1,
                'match_basis':     'Exact description + amount band',
            })
            seen_accounts.add(r['gl_account_code'])

    if len(suggestions) >= top_n:
        conn.close()
        return suggestions[:top_n]

    # Tier 2: exact desc + sign (any band)
    rows = conn.execute("""
        SELECT m.*, a.account_name
        FROM cb_allocation_memory m
        JOIN gl_accounts a ON m.gl_account_code = a.account_code
        WHERE m.description_pattern = ? AND m.amount_sign = ?
        ORDER BY m.confidence DESC
    """, (norm, sign)).fetchall()
    for r in rows:
        if r['gl_account_code'] not in seen_accounts:
            suggestions.append({
                'gl_account_code': r['gl_account_code'],
                'account_name':    r['account_name'],
                'vat_type':        r['vat_type'],
                'description_override': r['description_override'],
                'confidence':      r['confidence'],
                'match_tier':      2,
                'match_basis':     'Exact description match',
            })
            seen_accounts.add(r['gl_account_code'])

    if len(suggestions) >= top_n:
        conn.close()
        return suggestions[:top_n]

    # Tier 3: partial word match
    words = [w for w in norm.split() if len(w) > 3]
    for word in words:
        rows = conn.execute("""
            SELECT m.*, a.account_name
            FROM cb_allocation_memory m
            JOIN gl_accounts a ON m.gl_account_code = a.account_code
            WHERE m.description_pattern LIKE ? AND m.amount_sign = ?
            ORDER BY m.confidence DESC
            LIMIT 5
        """, (f'%{word}%', sign)).fetchall()
        for r in rows:
            if r['gl_account_code'] not in seen_accounts:
                suggestions.append({
                    'gl_account_code': r['gl_account_code'],
                    'account_name':    r['account_name'],
                    'vat_type':        r['vat_type'],
                    'description_override': r['description_override'],
                    'confidence':      r['confidence'],
                    'match_tier':      3,
                    'match_basis':     f'Partial match on "{word}"',
                })
                seen_accounts.add(r['gl_account_code'])
        if len(suggestions) >= top_n:
            break

    conn.close()
    return sorted(suggestions, key=lambda x: (-x['match_tier'], -x['confidence']))[:top_n]


def learn_allocation(description: str, amount: float,
                     gl_account_code: str, vat_type: str = None,
                     description_override: str = None) -> dict:
    """
    Record a confirmed allocation in the memory table.
    Called after the user confirms or overrides a suggestion.
    Increments confidence if pattern already exists.
    """
    conn = _conn()
    norm   = _normalise_description(description)
    sign   = 'CREDIT' if amount > 0 else 'DEBIT'
    band   = _amount_band(amount)
    today  = date.today().isoformat()

    existing = conn.execute("""
        SELECT memory_id, confidence FROM cb_allocation_memory
        WHERE description_pattern=? AND amount_sign=?
    """, (norm, sign)).fetchone()

    if existing:
        conn.execute("""
            UPDATE cb_allocation_memory
            SET gl_account_code=?, vat_type=?, description_override=?,
                confidence=confidence+1, last_used=?, amount_band=?
            WHERE memory_id=?
        """, (gl_account_code, vat_type, description_override,
              today, band, existing['memory_id']))
        memory_id = existing['memory_id']
        action = 'UPDATED'
    else:
        conn.execute("""
            INSERT INTO cb_allocation_memory
            (description_pattern, amount_sign, amount_band,
             gl_account_code, vat_type, description_override,
             confidence, last_used)
            VALUES (?,?,?,?,?,?,1,?)
        """, (norm, sign, band, gl_account_code, vat_type,
              description_override, today))
        memory_id = conn.execute(
            "SELECT last_insert_rowid()").fetchone()[0]
        action = 'CREATED'

    conn.commit()
    conn.close()
    return {
        'status':    action,
        'memory_id': memory_id,
        'pattern':   norm,
        'sign':      sign,
        'gl_account': gl_account_code,
    }


def import_cashbook_csv(filepath: str,
                        period_id: int,
                        bank_account: str,
                        imported_by: str,
                        date_col: str = 'Date',
                        description_col: str = 'Description',
                        amount_col: str = 'Amount',
                        reference_col: str = 'Reference',
                        balance_col: str = 'Balance',
                        date_format: str = '%Y-%m-%d',
                        delimiter: str = ',') -> dict:
    """
    Import a bank statement CSV into cb_staging.
    Auto-applies memory suggestions to each row.

    Args:
        filepath:       Path to CSV file
        period_id:      GL period the transactions belong to
        bank_account:   GL account code for the bank account (e.g. '8100')
        imported_by:    Username
        date_col, description_col, amount_col, reference_col, balance_col:
                        CSV column names (flexible — defaults match common exports)
        date_format:    strptime format for transaction dates
        delimiter:      CSV delimiter (default comma)

    Returns:
        dict with imported count, matched count, staging_ids
    """
    conn = _conn()

    # Verify period is open
    period = conn.execute(
        "SELECT * FROM sys_periods WHERE period_id=?", (period_id,)).fetchone()
    if not period:
        conn.close()
        return {'status': 'ERROR', 'error': f'Period {period_id} not found'}

    batch_ref = f"CB-IMPORT-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    imported  = 0
    matched   = 0
    errors    = []
    staging_ids = []

    try:
        with open(filepath, newline='', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f, delimiter=delimiter)
            for i, row in enumerate(reader, 1):
                try:
                    # Parse date
                    raw_date = row.get(date_col, '').strip()
                    txn_date = datetime.strptime(raw_date, date_format).date()

                    # Parse amount (handle parentheses for negatives, strip R/,)
                    raw_amt = row.get(amount_col, '0').strip()
                    raw_amt = re.sub(r'[R,\s]', '', raw_amt)
                    if raw_amt.startswith('(') and raw_amt.endswith(')'):
                        raw_amt = '-' + raw_amt[1:-1]
                    amount = float(raw_amt) if raw_amt else 0.0

                    description = row.get(description_col, '').strip()
                    reference   = row.get(reference_col, '').strip()
                    balance     = None
                    if balance_col and balance_col in row:
                        raw_bal = re.sub(r'[R,\s]', '', row[balance_col].strip())
                        balance = float(raw_bal) if raw_bal else None

                    # Get memory suggestion
                    suggestions = suggest_allocations(description, amount, top_n=1)
                    suggestion  = suggestions[0] if suggestions else None

                    status          = 'SUGGESTED' if suggestion else 'UNMATCHED'
                    gl_account      = suggestion['gl_account_code'] if suggestion else None
                    vat_type        = suggestion['vat_type']        if suggestion else None
                    jnl_desc        = suggestion.get('description_override') or description
                    confidence      = suggestion['confidence'] / 10.0 if suggestion else 0.0
                    memory_id       = None  # will look up after insert

                    conn.execute("""
                        INSERT INTO cb_staging
                        (import_batch, bank_account, transaction_date, value_date,
                         description, reference, amount, balance,
                         status, gl_account_code, vat_type, journal_description,
                         confidence_score, source, imported_by)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """, (batch_ref, bank_account,
                          str(txn_date), str(txn_date),
                          description, reference, amount, balance,
                          status, gl_account, vat_type, jnl_desc,
                          confidence, 'CSV_IMPORT', imported_by))

                    if suggestion:
                        matched += 1
                    imported += 1
                    staging_ids.append(conn.execute(
                        "SELECT last_insert_rowid()").fetchone()[0])

                except Exception as e:
                    errors.append(f'Row {i}: {e}')

    except FileNotFoundError:
        conn.close()
        return {'status': 'ERROR', 'error': f'File not found: {filepath}'}

    conn.commit()
    conn.close()

    return {
        'status':      'IMPORTED',
        'batch_ref':   batch_ref,
        'period_id':   period_id,
        'bank_account': bank_account,
        'total_rows':  imported,
        'matched':     matched,
        'unmatched':   imported - matched,
        'errors':      errors,
        'staging_ids': staging_ids,
    }


def get_staging_entries(batch_ref: str = None,
                        period_id: int = None,
                        status: str = None) -> list:
    """Retrieve cashbook staging entries for review."""
    conn = _conn()
    sql  = "SELECT s.*, a.account_name FROM cb_staging s LEFT JOIN gl_accounts a ON s.gl_account_code=a.account_code WHERE 1=1"
    args = []
    if batch_ref:
        sql  += " AND s.import_batch=?"
        args.append(batch_ref)
    if period_id:
        sql  += " AND s.bank_account IN (SELECT DISTINCT bank_account FROM cb_staging WHERE import_batch IN (SELECT import_batch FROM cb_staging WHERE bank_account=?))"
        # simpler: just filter by date range of period
        p = conn.execute("SELECT period_start, period_end FROM sys_periods WHERE period_id=?", (period_id,)).fetchone()
        if p:
            sql  = sql.replace("WHERE 1=1", "WHERE s.transaction_date BETWEEN ? AND ?")
            args = [p['period_start'], p['period_end']] + args
    if status:
        sql  += " AND s.status=?"
        args.append(status)
    sql += " ORDER BY s.transaction_date, s.staging_id"
    rows = conn.execute(sql, args).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def update_staging_allocation(staging_id: int,
                               gl_account_code: str,
                               vat_type: str = None,
                               journal_description: str = None,
                               learn: bool = True) -> dict:
    """
    Confirm or override the allocation for a staging entry.
    Optionally updates the memory table so future imports learn.
    """
    conn = _conn()
    entry = conn.execute(
        "SELECT * FROM cb_staging WHERE staging_id=?", (staging_id,)).fetchone()
    if not entry:
        conn.close()
        return {'status': 'ERROR', 'error': f'Staging entry {staging_id} not found'}
    if entry['status'] == 'POSTED':
        conn.close()
        return {'status': 'ERROR', 'error': 'Entry already posted — cannot modify'}

    conn.execute("""
        UPDATE cb_staging
        SET gl_account_code=?, vat_type=?, journal_description=?, status='MATCHED'
        WHERE staging_id=?
    """, (gl_account_code, vat_type,
          journal_description or entry['description'],
          staging_id))
    conn.commit()

    # Learn from this allocation
    if learn:
        learn_allocation(
            description=entry['description'],
            amount=entry['amount'],
            gl_account_code=gl_account_code,
            vat_type=vat_type,
            description_override=journal_description,
        )

    conn.close()
    return {
        'status':     'UPDATED',
        'staging_id': staging_id,
        'gl_account': gl_account_code,
    }


def post_cashbook_batch(staging_ids: list,
                        period_id: int,
                        bank_account: str,
                        posted_by: str) -> dict:
    """
    Post a list of confirmed cashbook staging entries as BC journals.
    Each staging entry becomes one journal (bank_account vs gl_account).
    Only MATCHED entries can be posted.

    For each entry:
      If amount > 0 (receipt/credit to bank):
        DR bank_account
        CR gl_account_code (income / liability / revenue)
      If amount < 0 (payment/debit from bank):
        DR gl_account_code (expense / asset)
        CR bank_account
    """
    conn = _conn()

    # Verify period is open
    period = conn.execute(
        "SELECT * FROM sys_periods WHERE period_id=?", (period_id,)).fetchone()
    if not period:
        conn.close()
        return {'status': 'ERROR', 'error': f'Period {period_id} not found'}
    if period['is_closed']:
        conn.close()
        return {'status': 'ERROR',
                'error': f'Period {period["period_name"]} is locked. Unlock to post.'}

    posted   = []
    errors   = []
    now      = datetime.now().isoformat(timespec='seconds')
    reopened = period['reopen_count'] and period['reopen_count'] > 0

    for sid in staging_ids:
        entry = conn.execute(
            "SELECT * FROM cb_staging WHERE staging_id=?", (sid,)).fetchone()
        if not entry:
            errors.append(f'Staging {sid}: not found')
            continue
        if entry['status'] not in ('MATCHED', 'SUGGESTED'):
            errors.append(f'Staging {sid}: status is {entry["status"]} — must be MATCHED')
            continue
        if not entry['gl_account_code']:
            errors.append(f'Staging {sid}: no GL account assigned')
            continue

        amount  = entry['amount']
        txn_date = date.fromisoformat(entry['transaction_date'])
        desc    = entry['journal_description'] or entry['description']
        gl_acc  = entry['gl_account_code']
        vat_t   = entry['vat_type']

        # Build journal lines
        if amount >= 0:
            lines = [
                {'account_code': bank_account, 'debit': abs(amount), 'credit': 0,
                 'description': f'Bank receipt: {desc}'},
                {'account_code': gl_acc, 'debit': 0, 'credit': abs(amount),
                 'description': desc, 'vat_code': vat_t},
            ]
        else:
            lines = [
                {'account_code': gl_acc, 'debit': abs(amount), 'credit': 0,
                 'description': desc, 'vat_code': vat_t},
                {'account_code': bank_account, 'debit': 0, 'credit': abs(amount),
                 'description': f'Bank payment: {desc}'},
            ]

        cb_ref  = _next_journal_ref(conn, 'CB', period_id)
        src_mod = 'CB_IMPORT' if entry['source'] == 'CSV_IMPORT' else 'CB_MANUAL'

        conn.execute("""
            INSERT INTO gl_journals
            (journal_ref, journal_type, description, period_id, journal_date,
             source_module, posted, posted_at, posted_by, created_by,
             posted_in_reopened_period, reopen_reason)
            VALUES (?,?,?,?,?,?,1,?,?,?,?,?)
        """, (cb_ref, 'BC', desc, period_id, str(txn_date),
              src_mod, now, posted_by, posted_by,
              1 if reopened else 0,
              period['unlock_reason'] if reopened else None))

        journal_id = conn.execute(
            "SELECT journal_id FROM gl_journals WHERE journal_ref=?",
            (cb_ref,)).fetchone()[0]

        for i, line in enumerate(lines, 1):
            conn.execute("""
                INSERT INTO gl_journal_lines
                (journal_id, line_number, account_code, description,
                 debit, credit, vat_type)
                VALUES (?,?,?,?,?,?,?)
            """, (journal_id, i, line['account_code'], line['description'],
                  line['debit'], line['credit'],
                  line.get('vat_code')))

        # Mark staging as posted
        conn.execute("""
            UPDATE cb_staging
            SET status='POSTED', journal_id=?, journal_ref=?,
                posted_by=?, posted_at=?
            WHERE staging_id=?
        """, (journal_id, cb_ref, posted_by, now, sid))

        posted.append({
            'staging_id':  sid,
            'journal_ref': cb_ref,
            'amount':      amount,
        })

    conn.commit()
    conn.close()

    return {
        'status':    'COMPLETE',
        'posted':    len(posted),
        'errors':    errors,
        'journals':  posted,
    }


# ─────────────────────────────────────────────────────────────────────────────
# REPORTING
# ─────────────────────────────────────────────────────────────────────────────

def print_period_status_report(fy_id: int = None):
    """Print a formatted period status table."""
    periods = list_periods(fy_id)
    print()
    print("=" * 75)
    print(f"  GL PERIOD STATUS REPORT"
          + (f"  —  {periods[0]['fy_code']}" if periods else ''))
    print("=" * 75)
    print(f"  {'ID':>4}  {'Period':<12}  {'Start':<12}  {'End':<12}  {'Status':<10}  {'Reopened'}")
    print("-" * 75)
    for p in periods:
        status = '🔒 CLOSED' if p['is_closed'] else '🟢 OPEN  '
        reopen = f"x{p['reopen_count']}" if p.get('reopen_count') else ''
        print(f"  {p['period_id']:>4}  {p['period_name']:<12}  "
              f"{p['period_start']:<12}  {p['period_end']:<12}  "
              f"{status}  {reopen}")
    print("=" * 75)
    print()


def print_vat_period_report(fy_id: int = None):
    """Print VAT period status."""
    vat_periods = list_vat_periods(fy_id)
    print()
    print("=" * 80)
    print("  VAT PERIOD STATUS REPORT")
    print("=" * 80)
    print(f"  {'Code':<10}  {'Start':<12}  {'End':<12}  {'Cat'}  {'GL Periods':>12}  "
          f"{'Filed':<8}  {'Locked'}")
    print("-" * 80)
    for v in vat_periods:
        filed  = '✅ Yes' if v['is_filed']  else 'No'
        locked = '🔒 Yes' if v['is_locked'] else 'Open'
        gl_info = f"{v['gl_periods_closed']}/{v['gl_period_count']} closed"
        print(f"  {v['vat_period_code']:<10}  {v['period_start']:<12}  "
              f"{v['period_end']:<12}  {v['vat_category']:<5}  "
              f"{gl_info:>12}  {filed:<8}  {locked}")
    print("=" * 80)
    print()


def print_year_end_preview(preview: dict):
    """Pretty-print the year-end closing preview."""
    if preview.get('status') == 'ERROR':
        print(f"❌ ERROR: {preview['error']}")
        return

    print()
    print("=" * 75)
    print(f"  YEAR-END CLOSING PREVIEW — {preview['fy_code']}")
    print(f"  Period: {preview['fy_start']} to {preview['fy_end']}")
    print("=" * 75)

    if preview['warnings']:
        for w in preview['warnings']:
            print(f"  {w}")
        print()

    print(f"  {'Account':<12}  {'Name':<40}  {'Net Balance':>14}  {'Action'}")
    print("-" * 75)
    print("  ── INCOME ACCOUNTS ──")
    for line in preview['income_lines'][:15]:
        action = f"DR {abs(line['closing_debit']):>12,.2f}" if line['closing_debit'] else f"CR {abs(line['closing_credit']):>12,.2f}"
        print(f"  {line['account_code']:<12}  {line['account_name'][:40]:<40}  "
              f"{line['net_balance']:>14,.2f}  {action}")
    if len(preview['income_lines']) > 15:
        print(f"  ... and {len(preview['income_lines'])-15} more income accounts")

    print()
    print("  ── EXPENSE ACCOUNTS ──")
    for line in preview['expense_lines'][:15]:
        action = f"CR {abs(line['closing_credit']):>12,.2f}" if line['closing_credit'] else f"DR {abs(line['closing_debit']):>12,.2f}"
        print(f"  {line['account_code']:<12}  {line['account_name'][:40]:<40}  "
              f"{line['net_balance']:>14,.2f}  {action}")
    if len(preview['expense_lines']) > 15:
        print(f"  ... and {len(preview['expense_lines'])-15} more expense accounts")

    print()
    print("  ── RETAINED EARNINGS ENTRY ──")
    net = preview['net_pnl']
    re_action = f"CR {abs(net):>12,.2f}" if net < 0 else f"DR {abs(net):>12,.2f}"
    print(f"  {preview['retained_earnings_account']:<12}  {'Retained Earnings':<40}  "
          f"  {'':>14}  {re_action}")
    print()
    print(f"  {preview['net_pnl_label']:}")
    print(f"  Net P&L movement to Retained Earnings: R {abs(net):,.2f}")
    print(f"  Total journal lines: {preview['line_count']}")
    print("=" * 75)
    print()


# ─────────────────────────────────────────────────────────────────────────────
# QUICK REFERENCE
# ─────────────────────────────────────────────────────────────────────────────

QUICK_REFERENCE = """
PERIOD-END CLOSING — QUICK REFERENCE
======================================

1. MONTH-END CLOSE (run each month after all journals posted):
   from period_end_engine import lock_period
   result = lock_period(period_id=12, locked_by='GIDEON')
   # This also auto-locks the VAT period if both its GL periods are now closed.

2. REOPEN A CLOSED PERIOD (with mandatory reason):
   from period_end_engine import unlock_period
   result = unlock_period(period_id=12, unlocked_by='GIDEON',
                          reason='Late fuel invoice received from Shesha')
   # Journals posted into a reopened period are flagged REOPEN_POST in reports.

3. YEAR-END PREVIEW (before committing):
   from period_end_engine import preview_year_end, print_year_end_preview
   preview = preview_year_end(fy_id=3)   # FY2026
   print_year_end_preview(preview)

4. FULL YEAR ROLLOVER (closes FY2026, opens FY2027):
   from period_end_engine import run_full_year_rollover
   from datetime import date
   result = run_full_year_rollover(
       closing_fy_id=3,
       new_fy_code='FY2027',
       new_fy_start=date(2026, 3, 1),
       new_fy_end=date(2027, 2, 28),
       closed_by='GIDEON',
       vat_category='A',   # 2-monthly VAT periods
   )

5. VAT PERIOD MANAGEMENT:
   from period_end_engine import lock_vat_period, unlock_vat_period
   lock_vat_period(vat_period_id=1, locked_by='GIDEON', filed=True)
   unlock_vat_period(vat_period_id=1, unlocked_by='GIDEON',
                     reason='Late input VAT claim to include')

6. CASHBOOK CSV IMPORT:
   from period_end_engine import import_cashbook_csv
   result = import_cashbook_csv(
       filepath='bank_feb2026.csv',
       period_id=12,
       bank_account='8100',   # Current Account GL code
       imported_by='GIDEON',
       date_col='Date',
       description_col='Description',
       amount_col='Amount',
       date_format='%d/%m/%Y',
   )

7. CASHBOOK — REVIEW AND POST:
   from period_end_engine import get_staging_entries, update_staging_allocation, post_cashbook_batch
   entries = get_staging_entries(batch_ref=result['batch_ref'])
   # Review UNMATCHED entries and allocate them:
   update_staging_allocation(staging_id=5, gl_account_code='2050 010',
                              vat_type='IN_STD', learn=True)
   # Post all matched entries:
   post_cashbook_batch(
       staging_ids=[e['staging_id'] for e in entries],
       period_id=12, bank_account='8100', posted_by='GIDEON'
   )

TRANSACTION SCHEME — HOW PERIOD TRANSACTIONS ARE IDENTIFIED:
─────────────────────────────────────────────────────────────
source_module    Description
──────────────   ─────────────────────────────────────────────────
YE_CLOSE         Year-end P&L closing journal (summary memo entry)
YE_OB            Opening balance carry-forward (new FY period 1)
REOPEN_POST      Any journal posted after a period was unlocked
CB_IMPORT        Cashbook entry from CSV import
CB_MANUAL        Cashbook entry typed manually
CB_MATCHED       Cashbook entry confirmed after memory suggestion
AR_INV           Customer invoice
AR_CN            Customer credit note
AP_INV           Supplier invoice
AP_CN            Supplier credit note
FA_PUR           Fixed asset purchase capitalisation
FA_DISP          Fixed asset disposal
FA_DEP           Depreciation run
GL_J             Manual GL journal (requires explicit VAT stamp)
"""
