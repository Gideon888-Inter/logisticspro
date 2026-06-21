"""
LP2.0 Cashbook, Bank Reconciliation, AR/AP Allocation & Statement Engine
=========================================================================
Interland Distribution Cape (Pty) Ltd

MODULES IN THIS FILE
─────────────────────
1. Entity & VAT Config   — multi-entity setup, VAT cycle per entity
2. Cashbook              — CSV import, manual entry, memory allocation,
                           receipt/payment filtering, staging review
3. Bank Reconciliation   — formal recon of bank statement vs GL balance
4. AR Allocation Engine  — allocate receipts to specific invoices (open-item)
5. AP Allocation Engine  — allocate payments to specific supplier invoices
6. Customer Statements   — open-item mode and balance-forward mode
7. Supplier Statements   — open-item AP statement output

VAT CYCLE LOGIC
───────────────
Each entity has a vat_cycle setting:
  MONTHLY    : one VAT period per GL month  (Interland default — 12 per FY)
  BIMONTHLY  : one VAT period per 2 months  (SARS Cat A — 6 per FY)
  SIXMONTHLY : one VAT period per 6 months  (SARS Cat B — 2 per FY)

VAT periods are created by ensure_vat_periods_for_entity() which reads
vat_cycle from sys_entities and generates the correct windows.

OPEN-ITEM vs BALANCE-FORWARD STATEMENTS
────────────────────────────────────────
Open-item: every invoice shown individually. Receipts matched against
specific invoices. Unallocated receipts shown as credits. Customer can
see exactly which invoices are outstanding.

Balance-forward: prior periods collapsed to a single opening balance line.
Only current-period transactions shown in detail. Simpler, but hides
per-invoice detail for prior periods. Better for high-volume customers.

CASHBOOK DIRECTION FILTER
─────────────────────────
Every staging entry has direction = 'RECEIPT' or 'PAYMENT'.
  RECEIPT : amount > 0 — money in — DR bank account, CR income/debtor
  PAYMENT : amount < 0 — money out — CR bank account, DR expense/creditor

Filtering in review UI: pass direction='RECEIPT' or 'PAYMENT' to
get_staging_entries() to see each side independently before committing.

BANK RECONCILIATION WORKFLOW
─────────────────────────────
1. create_recon(period_id, bank_account, bank_stmt_closing, ...) → recon_id
2. auto_match_staging(recon_id)      → marks staged/posted items as reconciled
3. add_recon_item(recon_id, ...)     → manually add outstanding/unrecorded items
4. calculate_recon(recon_id)         → computes adjusted balances and difference
5. lock_recon(recon_id, locked_by)   → finalises when difference = 0
6. print_recon_report(recon_id)      → formatted reconciliation output
"""

import sqlite3
import csv
import json
import re
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional
from dateutil.relativedelta import relativedelta

DB_PATH = 'lp2_v2.db'

# ─────────────────────────────────────────────────────────────────────────────
# SHARED HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    return c

def _D(val) -> Decimal:
    return Decimal(str(val or 0)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

def _next_ref(conn, prefix: str, period_id: int) -> str:
    """Generate sequential reference: {PREFIX}-{YYYYMM}-{SEQ:05d}"""
    period = conn.execute(
        "SELECT period_start FROM sys_periods WHERE period_id=?",
        (period_id,)).fetchone()
    yyyymm = period['period_start'][:7].replace('-', '')
    like = f"{prefix}-{yyyymm}-"
    last = conn.execute(
        "SELECT journal_ref FROM gl_journals WHERE journal_ref LIKE ? "
        "ORDER BY journal_ref DESC LIMIT 1", (like+'%',)).fetchone()
    seq = (int(last['journal_ref'].split('-')[-1]) + 1) if last else 1
    return f"{like}{seq:05d}"

def _next_seq_ref(conn, table: str, col: str, prefix: str) -> str:
    """Generate sequential reference for non-journal tables."""
    last = conn.execute(
        f"SELECT {col} FROM {table} WHERE {col} LIKE ? ORDER BY {col} DESC LIMIT 1",
        (prefix+'%',)).fetchone()
    if last:
        seq = int(last[0].split('-')[-1]) + 1
    else:
        seq = 1
    return f"{prefix}-{seq:05d}"

def _audit(conn, table, record_id, action, by, old=None, new=None):
    conn.execute(
        "INSERT INTO gl_audit_log (table_name,record_id,action,changed_by,old_values,new_values) "
        "VALUES (?,?,?,?,?,?)",
        (table, record_id, action, by,
         json.dumps(old) if old else None,
         json.dumps(new) if new else None))


# ─────────────────────────────────────────────────────────────────────────────
# 1. ENTITY & VAT CYCLE CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────

def get_entity(entity_id: int = 1) -> dict:
    """Return entity configuration dict."""
    conn = _conn()
    e = conn.execute("SELECT * FROM sys_entities WHERE entity_id=?", (entity_id,)).fetchone()
    conn.close()
    return dict(e) if e else {}

def list_entities() -> list:
    """List all registered entities."""
    conn = _conn()
    rows = conn.execute("SELECT * FROM sys_entities WHERE is_active=1 ORDER BY entity_code").fetchall()
    conn.close()
    return [dict(r) for r in rows]

def create_entity(entity_code: str, entity_name: str,
                  vat_cycle: str = 'MONTHLY',
                  fy_start_month: int = 3,
                  vat_first_month: int = 3,
                  **kwargs) -> dict:
    """
    Register a new entity.

    Args:
        vat_cycle:      'MONTHLY', 'BIMONTHLY', or 'SIXMONTHLY'
        fy_start_month: month FY starts (3=March for SA standard)
        vat_first_month: first month of VAT cycle (typically same as fy_start_month)
        **kwargs:       any other sys_entities column (registration_no, vat_number,
                        email, telephone, bank_name, bank_branch_code, bank_account_no etc.)
    """
    valid_cycles = ('MONTHLY', 'BIMONTHLY', 'SIXMONTHLY')
    if vat_cycle not in valid_cycles:
        return {'status': 'ERROR', 'error': f'vat_cycle must be one of {valid_cycles}'}

    conn = _conn()
    try:
        cols = ['entity_code','entity_name','vat_cycle','fy_start_month','vat_first_month']
        vals = [entity_code, entity_name, vat_cycle, fy_start_month, vat_first_month]
        for k, v in kwargs.items():
            cols.append(k)
            vals.append(v)
        placeholders = ','.join(['?']*len(cols))
        conn.execute(
            f"INSERT INTO sys_entities ({','.join(cols)}) VALUES ({placeholders})",
            vals)
        entity_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.commit()
        conn.close()
        return {'status': 'CREATED', 'entity_id': entity_id, 'entity_code': entity_code}
    except sqlite3.IntegrityError:
        conn.close()
        return {'status': 'EXISTS', 'message': f"Entity '{entity_code}' already exists"}

def update_entity(entity_id: int, **kwargs) -> dict:
    """Update entity configuration (vat_cycle, bank details etc.)"""
    conn = _conn()
    if not kwargs:
        conn.close()
        return {'status': 'NO_CHANGES'}
    sets = ', '.join([f"{k}=?" for k in kwargs])
    vals = list(kwargs.values()) + [entity_id]
    conn.execute(f"UPDATE sys_entities SET {sets} WHERE entity_id=?", vals)
    conn.commit()
    conn.close()
    return {'status': 'UPDATED', 'entity_id': entity_id, 'changed': list(kwargs.keys())}

def ensure_vat_periods_for_entity(fy_id: int, entity_id: int = 1) -> list:
    """
    Auto-generate VAT periods for a financial year based on the entity's
    vat_cycle setting. Replaces the hardcoded period_end_engine version.

    MONTHLY    : 12 periods, one per GL month
    BIMONTHLY  : 6 periods (Cat A — every 2 months)
    SIXMONTHLY : 2 periods (Cat B — every 6 months)

    Returns list of created/existing VAT period dicts.
    """
    conn = _conn()
    fy = conn.execute("SELECT * FROM sys_financial_years WHERE fy_id=?", (fy_id,)).fetchone()
    entity = conn.execute("SELECT * FROM sys_entities WHERE entity_id=?", (entity_id,)).fetchone()
    if not fy or not entity:
        conn.close()
        return []

    vat_cycle = entity['vat_cycle']
    fy_start = date.fromisoformat(fy['fy_start'])
    fy_end   = date.fromisoformat(fy['fy_end'])
    created  = []

    # Determine step in months
    step_map = {'MONTHLY': 1, 'BIMONTHLY': 2, 'SIXMONTHLY': 6}
    step = step_map[vat_cycle]

    cursor = fy_start
    while cursor <= fy_end:
        p_start = cursor
        p_end   = (cursor + relativedelta(months=step)) - timedelta(days=1)
        if p_end > fy_end:
            p_end = fy_end
        code = p_end.strftime('%Y%m')
        try:
            conn.execute("""
                INSERT INTO sys_vat_periods
                (vat_period_code, period_start, period_end, vat_category, entity_id)
                VALUES (?,?,?,?,?)
            """, (code, str(p_start), str(p_end), vat_cycle[:1], entity_id))
            created.append({'code': code, 'start': str(p_start),
                            'end': str(p_end), 'status': 'CREATED'})
        except sqlite3.IntegrityError:
            created.append({'code': code, 'start': str(p_start),
                            'end': str(p_end), 'status': 'EXISTS'})
        cursor = cursor + relativedelta(months=step)

    conn.commit()
    conn.close()
    return created

def print_entity_config(entity_id: int = 1):
    """Display entity configuration summary."""
    e = get_entity(entity_id)
    if not e:
        print(f"Entity {entity_id} not found")
        return
    print()
    print("=" * 60)
    print(f"  ENTITY: {e['entity_code']}  —  {e['entity_name']}")
    print("=" * 60)
    print(f"  VAT Cycle:        {e['vat_cycle']}")
    print(f"  FY Start Month:   {e['fy_start_month']} ({date(2000,e['fy_start_month'],1).strftime('%B')})")
    print(f"  VAT Number:       {e.get('vat_number','—')}")
    print(f"  Bank Account:     {e.get('bank_account_no','—')}  ({e.get('bank_name','—')})")
    print("=" * 60)


# ─────────────────────────────────────────────────────────────────────────────
# 2. CASHBOOK — MEMORY SYSTEM + IMPORT + STAGING REVIEW
# ─────────────────────────────────────────────────────────────────────────────

def _normalise(description: str) -> str:
    """Normalise bank description: uppercase, strip dates/IDs/punctuation."""
    if not description:
        return ''
    s = description.upper().strip()
    s = re.sub(r'\b\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}\b', '', s)  # dates
    s = re.sub(r'\b\d{7,}\b', '', s)                             # long IDs
    s = re.sub(r'[^\w\s]', ' ', s)                               # punctuation
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def _amount_band(amount: float) -> str:
    a = abs(amount)
    if a < 500:        return 'TINY'
    elif a < 5000:     return 'SMALL'
    elif a < 50000:    return 'MED'
    elif a < 500000:   return 'LARGE'
    else:              return 'XLARGE'

def _direction(amount: float) -> str:
    return 'RECEIPT' if amount >= 0 else 'PAYMENT'


def suggest_allocation(description: str, amount: float, top_n: int = 3) -> list:
    """
    Query cb_allocation_memory to suggest GL allocations.
    Three-tier matching: exact+band → exact desc → partial word.
    Returns list of suggestions sorted by confidence.
    """
    conn = _conn()
    norm  = _normalise(description)
    sign  = _direction(amount)
    band  = _amount_band(amount)
    seen  = set()
    suggestions = []

    def _add(rows, tier, basis):
        for r in rows:
            if r['gl_account_code'] not in seen:
                suggestions.append({
                    'gl_account_code':    r['gl_account_code'],
                    'account_name':       r['account_name'],
                    'vat_type':           r['vat_type'],
                    'description_override': r['description_override'],
                    'confidence':         r['confidence'],
                    'match_tier':         tier,
                    'match_basis':        basis,
                })
                seen.add(r['gl_account_code'])

    # Tier 1: exact + band
    r1 = conn.execute("""
        SELECT m.*, a.account_name FROM cb_allocation_memory m
        JOIN gl_accounts a ON m.gl_account_code=a.account_code
        WHERE m.description_pattern=? AND m.amount_sign=? AND m.amount_band=?
        ORDER BY m.confidence DESC LIMIT ?
    """, (norm, sign, band, top_n)).fetchall()
    _add(r1, 1, 'Exact description + amount band')
    if len(suggestions) >= top_n:
        conn.close()
        return suggestions[:top_n]

    # Tier 2: exact desc + sign, any band
    r2 = conn.execute("""
        SELECT m.*, a.account_name FROM cb_allocation_memory m
        JOIN gl_accounts a ON m.gl_account_code=a.account_code
        WHERE m.description_pattern=? AND m.amount_sign=?
        ORDER BY m.confidence DESC LIMIT ?
    """, (norm, sign, top_n)).fetchall()
    _add(r2, 2, 'Exact description')
    if len(suggestions) >= top_n:
        conn.close()
        return suggestions[:top_n]

    # Tier 3: partial word match
    words = [w for w in norm.split() if len(w) > 3]
    for word in words[:5]:
        r3 = conn.execute("""
            SELECT m.*, a.account_name FROM cb_allocation_memory m
            JOIN gl_accounts a ON m.gl_account_code=a.account_code
            WHERE m.description_pattern LIKE ? AND m.amount_sign=?
            ORDER BY m.confidence DESC LIMIT ?
        """, (f'%{word}%', sign, top_n)).fetchall()
        _add(r3, 3, f'Partial match on "{word}"')
        if len(suggestions) >= top_n:
            break

    conn.close()
    return sorted(suggestions, key=lambda x: (-x['match_tier'], -x['confidence']))[:top_n]


def learn_allocation(description: str, amount: float,
                     gl_account_code: str, vat_type: str = None,
                     description_override: str = None) -> dict:
    """
    Record or reinforce an allocation in the memory table.
    Every time a user confirms or corrects a match, call this.
    The confidence score rises with each confirmation.
    """
    conn = _conn()
    norm  = _normalise(description)
    sign  = _direction(amount)
    band  = _amount_band(amount)
    today = str(date.today())

    existing = conn.execute(
        "SELECT memory_id, confidence FROM cb_allocation_memory "
        "WHERE description_pattern=? AND amount_sign=?",
        (norm, sign)).fetchone()

    if existing:
        conn.execute("""
            UPDATE cb_allocation_memory
            SET gl_account_code=?, vat_type=?, description_override=?,
                amount_band=?, confidence=confidence+1, last_used=?
            WHERE memory_id=?
        """, (gl_account_code, vat_type, description_override,
              band, today, existing['memory_id']))
        mid = existing['memory_id']
        action = 'REINFORCED'
    else:
        conn.execute("""
            INSERT INTO cb_allocation_memory
            (description_pattern, amount_sign, amount_band,
             gl_account_code, vat_type, description_override, confidence, last_used)
            VALUES (?,?,?,?,?,?,1,?)
        """, (norm, sign, band, gl_account_code, vat_type, description_override, today))
        mid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        action = 'CREATED'

    conn.commit()
    conn.close()
    return {'status': action, 'memory_id': mid, 'pattern': norm,
            'direction': sign, 'gl_account': gl_account_code}


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
                         delimiter: str = ',',
                         debit_col: str = None,
                         credit_col: str = None) -> dict:
    """
    Import bank statement CSV into cb_staging.

    Supports two CSV formats:
    A) Single amount column (positive=receipt, negative=payment)
    B) Separate debit_col / credit_col columns (pass both to activate)

    Auto-applies memory suggestions. Sets direction = RECEIPT or PAYMENT.

    Returns import summary with batch_ref for subsequent review.
    """
    conn = _conn()

    # Verify period and bank account
    period = conn.execute("SELECT * FROM sys_periods WHERE period_id=?", (period_id,)).fetchone()
    if not period:
        conn.close()
        return {'status': 'ERROR', 'error': f'Period {period_id} not found'}
    acc = conn.execute("SELECT account_code FROM gl_accounts WHERE account_code=?",
                       (bank_account,)).fetchone()
    if not acc:
        conn.close()
        return {'status': 'ERROR', 'error': f'Bank account {bank_account} not in GL'}

    batch_ref = f"CB-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    imported = matched = 0
    errors = []

    try:
        with open(filepath, newline='', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f, delimiter=delimiter)
            for i, row in enumerate(reader, 1):
                try:
                    raw_date = row.get(date_col, '').strip()
                    txn_date = datetime.strptime(raw_date, date_format).date()
                    description = row.get(description_col, '').strip()
                    reference   = row.get(reference_col, '').strip() if reference_col else ''

                    # Parse amount
                    if debit_col and credit_col:
                        # Two-column format: debit = outflow, credit = inflow
                        def _parse(v):
                            v = re.sub(r'[R,\s]', '', (v or '').strip())
                            if v.startswith('(') and v.endswith(')'):
                                v = '-' + v[1:-1]
                            return float(v) if v else 0.0
                        dr = _parse(row.get(debit_col, ''))
                        cr = _parse(row.get(credit_col, ''))
                        amount = cr - dr  # positive = receipt
                    else:
                        raw = re.sub(r'[R,\s]', '', row.get(amount_col, '0').strip())
                        if raw.startswith('(') and raw.endswith(')'):
                            raw = '-' + raw[1:-1]
                        amount = float(raw) if raw else 0.0

                    balance = None
                    if balance_col and balance_col in row:
                        raw_bal = re.sub(r'[R,\s]', '', row[balance_col].strip())
                        balance = float(raw_bal) if raw_bal else None

                    direction = _direction(amount)

                    # Memory suggestion
                    suggestions  = suggest_allocation(description, amount, top_n=1)
                    suggestion   = suggestions[0] if suggestions else None
                    status       = 'SUGGESTED' if suggestion else 'UNMATCHED'
                    gl_account   = suggestion['gl_account_code'] if suggestion else None
                    vat_type     = suggestion['vat_type'] if suggestion else None
                    jnl_desc     = (suggestion.get('description_override') or description) if suggestion else description
                    confidence   = min(suggestion['confidence'] / 10.0, 1.0) if suggestion else 0.0

                    conn.execute("""
                        INSERT INTO cb_staging
                        (import_batch, bank_account, transaction_date, value_date,
                         description, reference, amount, balance, direction,
                         status, gl_account_code, vat_type, journal_description,
                         confidence_score, source, imported_by)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """, (batch_ref, bank_account,
                          str(txn_date), str(txn_date),
                          description, reference, amount, balance, direction,
                          status, gl_account, vat_type, jnl_desc,
                          confidence, 'CSV_IMPORT', imported_by))

                    if suggestion:
                        matched += 1
                    imported += 1

                except Exception as e:
                    errors.append(f'Row {i}: {e}')

    except FileNotFoundError:
        conn.close()
        return {'status': 'ERROR', 'error': f'File not found: {filepath}'}

    conn.commit()
    conn.close()

    # Compute totals
    total_in = total_out = 0.0
    conn2 = _conn()
    totals = conn2.execute("""
        SELECT direction, COUNT(*), SUM(ABS(amount))
        FROM cb_staging WHERE import_batch=?
        GROUP BY direction
    """, (batch_ref,)).fetchall()
    conn2.close()
    for row in totals:
        if row[0] == 'RECEIPT': total_in  = row[2] or 0
        else:                   total_out = row[2] or 0

    return {
        'status':      'IMPORTED',
        'batch_ref':   batch_ref,
        'period_id':   period_id,
        'bank_account': bank_account,
        'total_rows':  imported,
        'matched':     matched,
        'unmatched':   imported - matched,
        'receipts_in':  total_in,
        'payments_out': total_out,
        'net':          total_in - total_out,
        'errors':       errors,
    }


def add_cashbook_entry(period_id: int,
                       bank_account: str,
                       transaction_date: date,
                       description: str,
                       amount: float,
                       reference: str = None,
                       gl_account_code: str = None,
                       vat_type: str = None,
                       journal_description: str = None,
                       entered_by: str = 'MANUAL',
                       learn: bool = True) -> dict:
    """
    Add a single cashbook entry manually (not from CSV).
    Auto-suggests GL allocation from memory if gl_account_code not provided.
    """
    conn = _conn()
    direction = _direction(amount)
    status    = 'UNMATCHED'

    if gl_account_code:
        status = 'MATCHED'
        if learn:
            learn_allocation(description, amount, gl_account_code,
                             vat_type, journal_description)
    else:
        suggestions = suggest_allocation(description, amount, top_n=1)
        if suggestions:
            gl_account_code   = suggestions[0]['gl_account_code']
            vat_type          = suggestions[0]['vat_type'] or vat_type
            journal_description = suggestions[0].get('description_override') or description
            status = 'SUGGESTED'

    batch_ref = f"CB-MANUAL-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    conn.execute("""
        INSERT INTO cb_staging
        (import_batch, bank_account, transaction_date, value_date,
         description, reference, amount, direction,
         status, gl_account_code, vat_type, journal_description,
         confidence_score, source, imported_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (batch_ref, bank_account, str(transaction_date), str(transaction_date),
          description, reference, amount, direction,
          status, gl_account_code, vat_type,
          journal_description or description,
          1.0 if gl_account_code else 0.0,
          'MANUAL', entered_by))
    sid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.commit()
    conn.close()
    return {'status': 'ADDED', 'staging_id': sid, 'direction': direction,
            'gl_account': gl_account_code, 'match_status': status}


def get_staging_entries(batch_ref: str = None,
                         period_id: int = None,
                         direction: str = None,
                         status: str = None,
                         bank_account: str = None) -> list:
    """
    Retrieve cashbook staging entries for review.

    Args:
        batch_ref:    filter to a specific import batch
        period_id:    filter by GL period date range
        direction:    'RECEIPT', 'PAYMENT', or None (both)
        status:       'UNMATCHED', 'SUGGESTED', 'MATCHED', 'POSTED', 'EXCLUDED'
        bank_account: filter to a specific bank account GL code

    Returns list of entry dicts with account names resolved.
    """
    conn = _conn()
    sql  = """
        SELECT s.*, a.account_name AS gl_account_name,
               m.description_pattern, m.confidence AS memory_confidence
        FROM cb_staging s
        LEFT JOIN gl_accounts a ON s.gl_account_code = a.account_code
        LEFT JOIN cb_allocation_memory m ON s.memory_id = m.memory_id
        WHERE 1=1
    """
    args = []

    if batch_ref:
        sql += " AND s.import_batch=?"
        args.append(batch_ref)
    if direction:
        sql += " AND s.direction=?"
        args.append(direction.upper())
    if status:
        sql += " AND s.status=?"
        args.append(status.upper())
    if bank_account:
        sql += " AND s.bank_account=?"
        args.append(bank_account)
    if period_id:
        p = conn.execute(
            "SELECT period_start, period_end FROM sys_periods WHERE period_id=?",
            (period_id,)).fetchone()
        if p:
            sql += " AND s.transaction_date BETWEEN ? AND ?"
            args.extend([p['period_start'], p['period_end']])

    sql += " ORDER BY s.transaction_date, s.staging_id"
    rows = conn.execute(sql, args).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def confirm_staging_allocation(staging_id: int,
                                gl_account_code: str,
                                vat_type: str = None,
                                journal_description: str = None,
                                confirmed_by: str = 'USER',
                                learn: bool = True) -> dict:
    """
    Confirm or override the GL allocation for a staging entry.
    Updates status to MATCHED. Optionally feeds back to memory.
    """
    conn = _conn()
    entry = conn.execute("SELECT * FROM cb_staging WHERE staging_id=?", (staging_id,)).fetchone()
    if not entry:
        conn.close()
        return {'status': 'ERROR', 'error': f'Entry {staging_id} not found'}
    if entry['status'] == 'POSTED':
        conn.close()
        return {'status': 'ERROR', 'error': 'Already posted — cannot modify'}

    conn.execute("""
        UPDATE cb_staging
        SET gl_account_code=?, vat_type=?,
            journal_description=?, status='MATCHED'
        WHERE staging_id=?
    """, (gl_account_code, vat_type,
          journal_description or entry['description'], staging_id))
    conn.commit()

    if learn:
        learn_allocation(entry['description'], entry['amount'],
                         gl_account_code, vat_type, journal_description)
    conn.close()
    return {'status': 'MATCHED', 'staging_id': staging_id, 'gl_account': gl_account_code}


def exclude_staging_entry(staging_id: int, note: str = None) -> dict:
    """Mark a staging entry as EXCLUDED (e.g. inter-account transfers, contra entries)."""
    conn = _conn()
    conn.execute("UPDATE cb_staging SET status='EXCLUDED', notes=? WHERE staging_id=?",
                 (note, staging_id))
    conn.commit()
    conn.close()
    return {'status': 'EXCLUDED', 'staging_id': staging_id}


def post_cashbook_batch(staging_ids: list,
                         period_id: int,
                         bank_account: str,
                         posted_by: str) -> dict:
    """
    Post confirmed cashbook staging entries as BC journals.

    Posting logic:
      RECEIPT (amount >= 0): DR bank_account / CR gl_account  (money in)
      PAYMENT (amount < 0):  DR gl_account  / CR bank_account (money out)

    Only MATCHED or SUGGESTED entries are posted.
    Period must be open.
    Tracks posted_in_reopened_period flag automatically.
    """
    conn = _conn()
    period = conn.execute("SELECT * FROM sys_periods WHERE period_id=?", (period_id,)).fetchone()
    if not period:
        conn.close()
        return {'status': 'ERROR', 'error': f'Period {period_id} not found'}
    if period['is_closed']:
        conn.close()
        return {'status': 'ERROR',
                'error': f"{period['period_name']} is locked. Unlock first."}

    reopened = bool(period['reopen_count'] and period['reopen_count'] > 0)
    now      = datetime.now().isoformat(timespec='seconds')
    posted   = []
    errors   = []

    for sid in staging_ids:
        entry = conn.execute("SELECT * FROM cb_staging WHERE staging_id=?", (sid,)).fetchone()
        if not entry:
            errors.append(f'Staging {sid}: not found')
            continue
        if entry['status'] not in ('MATCHED', 'SUGGESTED'):
            errors.append(f'Staging {sid}: status={entry["status"]} — must be MATCHED')
            continue
        if not entry['gl_account_code']:
            errors.append(f'Staging {sid}: no GL account assigned')
            continue

        amount   = entry['amount']
        txn_date = date.fromisoformat(entry['transaction_date'])
        desc     = entry['journal_description'] or entry['description']
        gl_acc   = entry['gl_account_code']
        vat_t    = entry['vat_type']
        direction = entry['direction'] or _direction(amount)

        # Double entry
        if direction == 'RECEIPT':
            lines = [
                {'account_code': bank_account, 'debit': abs(amount), 'credit': 0,
                 'description': f'Receipt: {desc}'},
                {'account_code': gl_acc, 'debit': 0, 'credit': abs(amount),
                 'description': desc, 'vat_type': vat_t},
            ]
        else:
            lines = [
                {'account_code': gl_acc, 'debit': abs(amount), 'credit': 0,
                 'description': desc, 'vat_type': vat_t},
                {'account_code': bank_account, 'debit': 0, 'credit': abs(amount),
                 'description': f'Payment: {desc}'},
            ]

        cb_ref   = _next_ref(conn, 'CB', period_id)
        src_mod  = 'CB_IMPORT' if 'CSV' in (entry['source'] or '') else 'CB_MANUAL'

        conn.execute("""
            INSERT INTO gl_journals
            (journal_ref, journal_type, description, period_id, journal_date,
             source_module, posted, posted_at, posted_by, created_by,
             posted_in_reopened_period, reopen_reason)
            VALUES (?,?,?,?,?,?,1,?,?,?,?,?)
        """, (cb_ref, 'BC', desc, period_id, str(txn_date), src_mod,
              now, posted_by, posted_by,
              1 if reopened else 0,
              period['unlock_reason'] if reopened else None))

        journal_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

        for i, line in enumerate(lines, 1):
            conn.execute("""
                INSERT INTO gl_journal_lines
                (journal_id, line_number, account_code, description, debit, credit, vat_type)
                VALUES (?,?,?,?,?,?,?)
            """, (journal_id, i, line['account_code'], line['description'],
                  line['debit'], line['credit'], line.get('vat_type')))

        conn.execute("""
            UPDATE cb_staging
            SET status='POSTED', journal_id=?, journal_ref=?,
                posted_by=?, posted_at=?
            WHERE staging_id=?
        """, (journal_id, cb_ref, posted_by, now, sid))

        posted.append({'staging_id': sid, 'journal_ref': cb_ref, 'amount': amount,
                       'direction': direction})

    conn.commit()
    conn.close()
    return {'status': 'COMPLETE', 'posted': len(posted),
            'errors': errors, 'journals': posted}


def print_staging_review(batch_ref: str = None, period_id: int = None,
                          direction: str = None):
    """Print formatted cashbook staging review — all or filtered by direction."""
    entries = get_staging_entries(batch_ref=batch_ref, period_id=period_id,
                                  direction=direction)
    if not entries:
        print("  No entries found.")
        return

    dir_label = f" — {direction}" if direction else ""
    print()
    print("=" * 100)
    print(f"  CASHBOOK STAGING REVIEW{dir_label}")
    print(f"  Batch: {batch_ref or 'ALL'}  |  "
          f"Entries: {len(entries)}  |  "
          f"Receipts: {sum(1 for e in entries if e['direction']=='RECEIPT')}  |  "
          f"Payments: {sum(1 for e in entries if e['direction']=='PAYMENT')}")
    print("=" * 100)
    print(f"  {'ID':>6}  {'Date':<12}  {'Dir':<8}  {'Description':<35}  "
          f"{'Amount':>12}  {'Status':<10}  {'GL Account':<25}")
    print("-" * 100)

    total_in = total_out = 0.0
    for e in entries:
        icon = '↑' if e['direction'] == 'RECEIPT' else '↓'
        amt  = e['amount']
        gl   = (f"{e['gl_account_code']} {e['gl_account_name'] or ''}")[:25] if e['gl_account_code'] else '— UNMATCHED'
        stat = {'MATCHED':'✅','SUGGESTED':'💡','UNMATCHED':'❓',
                'POSTED':'📗','EXCLUDED':'🚫'}.get(e['status'], e['status'])
        print(f"  {e['staging_id']:>6}  {e['transaction_date']:<12}  "
              f"{icon} {e['direction']:<6}  {e['description'][:35]:<35}  "
              f"R {abs(amt):>10,.2f}  {stat} {e['status']:<8}  {gl}")
        if e['direction'] == 'RECEIPT': total_in  += abs(amt)
        else:                           total_out += abs(amt)

    print("-" * 100)
    print(f"  {'TOTALS':>62}  IN: R {total_in:>10,.2f}  OUT: R {total_out:>10,.2f}  "
          f"NET: R {total_in - total_out:>10,.2f}")
    print("=" * 100)


# ─────────────────────────────────────────────────────────────────────────────
# 3. BANK RECONCILIATION
# ─────────────────────────────────────────────────────────────────────────────

def create_recon(period_id: int,
                 bank_account: str,
                 bank_stmt_opening: float,
                 bank_stmt_closing: float,
                 recon_date: date = None,
                 entity_id: int = 1,
                 created_by: str = 'SYSTEM') -> dict:
    """
    Create a new bank reconciliation for a period and bank account.

    Args:
        period_id:          GL period being reconciled
        bank_account:       GL account code for the bank account
        bank_stmt_opening:  opening balance per bank statement
        bank_stmt_closing:  closing balance per bank statement
        recon_date:         statement date (default: period end)
    """
    conn = _conn()
    period = conn.execute("SELECT * FROM sys_periods WHERE period_id=?", (period_id,)).fetchone()
    if not period:
        conn.close()
        return {'status': 'ERROR', 'error': f'Period {period_id} not found'}

    if not recon_date:
        recon_date = date.fromisoformat(period['period_end'])

    # Check for existing recon for this period/account
    existing = conn.execute(
        "SELECT recon_id FROM cb_bank_recon WHERE period_id=? AND bank_account=? AND status!='LOCKED'",
        (period_id, bank_account)).fetchone()
    if existing:
        conn.close()
        return {'status': 'EXISTS', 'recon_id': existing['recon_id'],
                'message': 'An in-progress recon already exists for this period/account'}

    # Calculate GL balances for the period
    gl_bal = _calculate_gl_balance(conn, bank_account, period)

    conn.execute("""
        INSERT INTO cb_bank_recon
        (entity_id, period_id, bank_account, recon_date,
         bank_stmt_opening, bank_stmt_closing,
         gl_opening, gl_closing, created_by)
        VALUES (?,?,?,?,?,?,?,?,?)
    """, (entity_id, period_id, bank_account, str(recon_date),
          bank_stmt_opening, bank_stmt_closing,
          gl_bal['opening'], gl_bal['closing'], created_by))

    recon_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.commit()
    conn.close()

    return {
        'status':       'CREATED',
        'recon_id':     recon_id,
        'period_name':  period['period_name'],
        'bank_account': bank_account,
        'bank_closing': bank_stmt_closing,
        'gl_closing':   gl_bal['closing'],
        'difference':   bank_stmt_closing - (gl_bal['closing'] or 0),
    }


def _calculate_gl_balance(conn, bank_account: str, period) -> dict:
    """Calculate GL opening and closing balance for a bank account in a period."""
    # Opening: all posted debits - credits up to period start - 1 day
    period_start = period['period_start']
    period_end   = period['period_end']

    opening = conn.execute("""
        SELECT COALESCE(SUM(l.debit) - SUM(l.credit), 0)
        FROM gl_journal_lines l
        JOIN gl_journals j ON l.journal_id = j.journal_id
        JOIN sys_periods p  ON j.period_id  = p.period_id
        WHERE l.account_code = ? AND j.posted = 1
          AND p.period_end < ?
    """, (bank_account, period_start)).fetchone()[0]

    # Closing: opening + current period movements
    period_movement = conn.execute("""
        SELECT COALESCE(SUM(l.debit) - SUM(l.credit), 0)
        FROM gl_journal_lines l
        JOIN gl_journals j ON l.journal_id = j.journal_id
        JOIN sys_periods p  ON j.period_id  = p.period_id
        WHERE l.account_code = ? AND j.posted = 1
          AND p.period_start = ? AND p.period_end = ?
    """, (bank_account, period_start, period_end)).fetchone()[0]

    return {'opening': float(opening), 'closing': float(opening + period_movement)}


def auto_match_staging(recon_id: int) -> dict:
    """
    Mark all POSTED staging entries for this recon's period/account as reconciled.
    These are transactions that appear both in GL and on the bank statement.
    """
    conn = _conn()
    recon = conn.execute("SELECT * FROM cb_bank_recon WHERE recon_id=?", (recon_id,)).fetchone()
    if not recon:
        conn.close()
        return {'status': 'ERROR', 'error': 'Recon not found'}

    # Get period date range
    period = conn.execute(
        "SELECT period_start, period_end FROM sys_periods WHERE period_id=?",
        (recon['period_id'],)).fetchone()

    now = datetime.now().isoformat(timespec='seconds')
    result = conn.execute("""
        UPDATE cb_staging
        SET recon_id=?, is_reconciled=1, reconciled_at=?
        WHERE bank_account=?
          AND status='POSTED'
          AND is_reconciled=0
          AND transaction_date BETWEEN ? AND ?
    """, (recon_id, now, recon['bank_account'],
          period['period_start'], period['period_end']))

    matched = result.rowcount
    conn.commit()
    conn.close()
    return {'status': 'OK', 'matched': matched, 'recon_id': recon_id}


def add_recon_item(recon_id: int,
                   item_type: str,
                   description: str,
                   amount: float,
                   transaction_date: date = None,
                   bank_reference: str = None,
                   gl_journal_ref: str = None,
                   staging_id: int = None) -> dict:
    """
    Add a reconciling item explaining a difference between bank and GL.

    item_type options:
      OUTSTANDING_DEPOSIT  : cheque/deposit in GL not yet on bank statement
      OUTSTANDING_PAYMENT  : payment in GL not yet on bank statement
      UNRECORDED_RECEIPT   : bank statement credit not yet in GL
      UNRECORDED_PAYMENT   : bank statement debit not yet in GL (e.g. bank charges)
      TIMING_DIFFERENCE    : date mismatch — same transaction, different dates
      ERROR                : actual error to be corrected
    """
    valid = {'OUTSTANDING_DEPOSIT','OUTSTANDING_PAYMENT','UNRECORDED_RECEIPT',
             'UNRECORDED_PAYMENT','TIMING_DIFFERENCE','ERROR'}
    if item_type not in valid:
        return {'status': 'ERROR', 'error': f'item_type must be one of {valid}'}

    conn = _conn()
    conn.execute("""
        INSERT INTO cb_recon_items
        (recon_id, item_type, description, amount, transaction_date,
         bank_reference, gl_journal_ref, staging_id)
        VALUES (?,?,?,?,?,?,?,?)
    """, (recon_id, item_type, description, abs(amount),
          str(transaction_date) if transaction_date else None,
          bank_reference, gl_journal_ref, staging_id))
    item_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.commit()
    conn.close()
    return {'status': 'ADDED', 'item_id': item_id}


def calculate_recon(recon_id: int) -> dict:
    """
    Compute the reconciliation and update the recon record.

    Standard bank reconciliation formula:
      Bank statement closing balance
      + Outstanding deposits    (in GL, not on statement yet)
      - Outstanding payments    (in GL, not on statement yet)
      = Adjusted bank balance

      GL closing balance
      + Unrecorded receipts     (on statement, not in GL yet)
      - Unrecorded payments     (on statement, not in GL yet)
      = Adjusted GL balance

      Difference = Adjusted bank balance - Adjusted GL balance  (should = 0)
    """
    conn = _conn()
    recon = conn.execute("SELECT * FROM cb_bank_recon WHERE recon_id=?", (recon_id,)).fetchone()
    if not recon:
        conn.close()
        return {'status': 'ERROR', 'error': 'Recon not found'}

    items = conn.execute(
        "SELECT item_type, SUM(amount) as total FROM cb_recon_items "
        "WHERE recon_id=? AND resolved=0 GROUP BY item_type",
        (recon_id,)).fetchall()

    item_totals = {r['item_type']: r['total'] or 0 for r in items}

    outstanding_deposits = item_totals.get('OUTSTANDING_DEPOSIT', 0)
    outstanding_payments = item_totals.get('OUTSTANDING_PAYMENT', 0)
    unrecorded_receipts  = item_totals.get('UNRECORDED_RECEIPT',  0)
    unrecorded_payments  = item_totals.get('UNRECORDED_PAYMENT',  0)

    bank_closing = recon['bank_stmt_closing']
    gl_closing   = recon['gl_closing'] or 0

    adj_bank = bank_closing + outstanding_deposits - outstanding_payments
    adj_gl   = gl_closing   + unrecorded_receipts  - unrecorded_payments
    diff     = adj_bank - adj_gl

    status = 'BALANCED' if abs(diff) < 0.01 else 'DRAFT'

    conn.execute("""
        UPDATE cb_bank_recon
        SET outstanding_deposits=?, outstanding_payments=?,
            unrecorded_receipts=?, unrecorded_payments=?,
            adjusted_bank_balance=?, adjusted_gl_balance=?,
            difference=?, status=?
        WHERE recon_id=?
    """, (outstanding_deposits, outstanding_payments,
          unrecorded_receipts, unrecorded_payments,
          adj_bank, adj_gl, diff, status, recon_id))

    conn.commit()
    conn.close()

    return {
        'status':           status,
        'recon_id':         recon_id,
        'bank_stmt_closing': bank_closing,
        'gl_closing':       gl_closing,
        'outstanding_deposits': outstanding_deposits,
        'outstanding_payments': outstanding_payments,
        'unrecorded_receipts':  unrecorded_receipts,
        'unrecorded_payments':  unrecorded_payments,
        'adjusted_bank':   adj_bank,
        'adjusted_gl':     adj_gl,
        'difference':      diff,
        'balanced':        abs(diff) < 0.01,
    }


def lock_recon(recon_id: int, locked_by: str) -> dict:
    """Lock a balanced bank reconciliation. Requires status=BALANCED."""
    conn = _conn()
    recon = conn.execute("SELECT * FROM cb_bank_recon WHERE recon_id=?", (recon_id,)).fetchone()
    if not recon:
        conn.close()
        return {'status': 'ERROR', 'error': 'Recon not found'}
    if recon['status'] != 'BALANCED':
        conn.close()
        return {'status': 'ERROR',
                'error': f"Cannot lock — status is {recon['status']}. Must be BALANCED."}
    if abs(recon['difference'] or 1) > 0.01:
        conn.close()
        return {'status': 'ERROR',
                'error': f"Difference is R{recon['difference']:,.2f} — must be zero to lock."}

    now = datetime.now().isoformat(timespec='seconds')
    conn.execute("""
        UPDATE cb_bank_recon SET status='LOCKED', locked_by=?, locked_at=?
        WHERE recon_id=?
    """, (locked_by, now, recon_id))
    conn.commit()
    conn.close()
    return {'status': 'LOCKED', 'recon_id': recon_id, 'locked_by': locked_by}


def print_recon_report(recon_id: int):
    """Print formatted bank reconciliation report."""
    conn = _conn()
    recon = conn.execute("""
        SELECT r.*, p.period_name, p.period_start, p.period_end,
               a.account_name AS bank_account_name
        FROM cb_bank_recon r
        JOIN sys_periods p ON r.period_id=p.period_id
        JOIN gl_accounts a ON r.bank_account=a.account_code
        WHERE r.recon_id=?
    """, (recon_id,)).fetchone()
    items = conn.execute(
        "SELECT * FROM cb_recon_items WHERE recon_id=? ORDER BY item_type",
        (recon_id,)).fetchall()
    conn.close()

    if not recon:
        print(f"Recon {recon_id} not found")
        return

    calc = calculate_recon(recon_id)

    print()
    print("=" * 70)
    print(f"  BANK RECONCILIATION — {recon['period_name']}")
    print(f"  Bank Account: {recon['bank_account']} {recon['bank_account_name']}")
    print(f"  Statement Date: {recon['recon_date']}  |  Status: {recon['status']}")
    print("=" * 70)

    print(f"\n  BANK STATEMENT")
    print(f"  {'Opening balance per bank statement:':<45} R {recon['bank_stmt_opening']:>12,.2f}")
    print(f"  {'Closing balance per bank statement:':<45} R {recon['bank_stmt_closing']:>12,.2f}")

    print(f"\n  GL BALANCE")
    print(f"  {'Opening balance per GL:':<45} R {(recon['gl_opening'] or 0):>12,.2f}")
    print(f"  {'Closing balance per GL:':<45} R {(recon['gl_closing'] or 0):>12,.2f}")

    print(f"\n  RECONCILING ITEMS")
    print("-" * 70)
    for item in items:
        sign = '+' if item['item_type'] in ('OUTSTANDING_DEPOSIT','UNRECORDED_RECEIPT') else '-'
        status = '✅' if item['resolved'] else '  '
        print(f"  {status} {item['item_type']:<25}  {item['description'][:25]:<25}  "
              f"{sign} R {item['amount']:>10,.2f}")
    if not items:
        print("  (no reconciling items)")

    print()
    print("-" * 70)
    print(f"  {'Adjusted bank balance:':<45} R {(calc['adjusted_bank'] or 0):>12,.2f}")
    print(f"  {'Adjusted GL balance:':<45} R {(calc['adjusted_gl'] or 0):>12,.2f}")
    print()
    diff = calc.get('difference', 0) or 0
    if abs(diff) < 0.01:
        print(f"  ✅ RECONCILED — Difference: R 0.00")
    else:
        print(f"  ❌ DIFFERENCE: R {diff:,.2f}  — reconciliation not balanced")
    print("=" * 70)


# ─────────────────────────────────────────────────────────────────────────────
# 4. AR ALLOCATION ENGINE — open-item receipt matching
# ─────────────────────────────────────────────────────────────────────────────

def allocate_receipt(receipt_id: int,
                     allocations: list,
                     allocated_by: str = 'SYSTEM') -> dict:
    """
    Allocate a customer receipt to one or more specific invoices.

    This is the core of open-item AR. Each client payment can be matched
    to the exact invoice(s) they are paying.

    Args:
        receipt_id:   ar_receipts.receipt_id
        allocations:  list of dicts: [{invoice_id, amount}, ...]
                      amounts must not exceed invoice balance_due
                      total allocations must not exceed receipt amount
        allocated_by: username

    Returns:
        dict with allocated total, remaining unallocated, any errors

    Example:
        allocate_receipt(
            receipt_id=5,
            allocations=[
                {'invoice_id': 12, 'amount': 50000.00},  # pays invoice 12 in full
                {'invoice_id': 13, 'amount': 30000.00},  # partial payment on 13
            ],
            allocated_by='GIDEON'
        )
    """
    conn = _conn()

    receipt = conn.execute("SELECT * FROM ar_receipts WHERE receipt_id=?", (receipt_id,)).fetchone()
    if not receipt:
        conn.close()
        return {'status': 'ERROR', 'error': f'Receipt {receipt_id} not found'}

    receipt_amount = _D(receipt['amount'])
    already_allocated = _D(receipt['amount_allocated'])
    available = receipt_amount - already_allocated

    errors   = []
    results  = []
    total_now = _D(0)
    today    = str(date.today())

    for alloc in allocations:
        inv_id = alloc['invoice_id']
        alloc_amt = _D(alloc['amount'])

        # Fetch invoice
        inv = conn.execute(
            "SELECT * FROM ar_invoices WHERE invoice_id=? AND customer_code=?",
            (inv_id, receipt['customer_code'])).fetchone()
        if not inv:
            errors.append(f'Invoice {inv_id}: not found for customer {receipt["customer_code"]}')
            continue
        if inv['status'] in ('PAID', 'CANCELLED'):
            errors.append(f'Invoice {inv_id} ({inv["invoice_ref"]}): already {inv["status"]}')
            continue

        inv_balance = _D(inv['balance_due'])
        if alloc_amt > inv_balance + _D('0.01'):
            errors.append(f'Invoice {inv_id}: allocation R{float(alloc_amt):,.2f} exceeds '
                          f'balance R{float(inv_balance):,.2f}')
            continue
        if total_now + alloc_amt > available + _D('0.01'):
            errors.append(f'Invoice {inv_id}: would exceed receipt available balance '
                          f'R{float(available):,.2f}')
            continue

        # Check if allocation already exists for this receipt/invoice pair
        existing = conn.execute(
            "SELECT alloc_id, allocated_amount FROM ar_receipt_allocations "
            "WHERE receipt_id=? AND invoice_id=?",
            (receipt_id, inv_id)).fetchone()

        if existing:
            # Update existing allocation
            new_alloc_total = _D(existing['allocated_amount']) + alloc_amt
            conn.execute(
                "UPDATE ar_receipt_allocations SET allocated_amount=?, allocation_date=?, "
                "allocation_ref=?, created_by=? WHERE alloc_id=?",
                (float(new_alloc_total), today,
                 f"RCP-{receipt_id}-INV-{inv_id}", allocated_by,
                 existing['alloc_id']))
        else:
            conn.execute("""
                INSERT INTO ar_receipt_allocations
                (receipt_id, invoice_id, allocated_amount, allocation_date,
                 allocation_ref, created_by)
                VALUES (?,?,?,?,?,?)
            """, (receipt_id, inv_id, float(alloc_amt), today,
                  f"RCP-{receipt_id}-INV-{inv_id}", allocated_by))

        # Update invoice: amount_received and balance_due
        new_received = _D(inv['amount_received']) + alloc_amt
        new_balance  = _D(inv['total_incl_vat']) - new_received - _D(inv['amount_written_off'])
        new_status   = 'PAID' if new_balance <= _D('0.01') else 'PARTIAL'
        conn.execute("""
            UPDATE ar_invoices
            SET amount_received=?, balance_due=?, status=?
            WHERE invoice_id=?
        """, (float(new_received), float(new_balance), new_status, inv_id))

        total_now += alloc_amt
        results.append({
            'invoice_id':  inv_id,
            'invoice_ref': inv['invoice_ref'],
            'allocated':   float(alloc_amt),
            'new_balance': float(new_balance),
            'status':      new_status,
        })

    # Update receipt: amount_allocated and fully_allocated flag
    new_total_allocated = already_allocated + total_now
    fully_allocated     = new_total_allocated >= receipt_amount - _D('0.01')
    conn.execute("""
        UPDATE ar_receipts
        SET amount_allocated=?, amount_unallocated=?, fully_allocated=?
        WHERE receipt_id=?
    """, (float(new_total_allocated),
          float(receipt_amount - new_total_allocated),
          1 if fully_allocated else 0,
          receipt_id))

    _audit(conn, 'ar_receipts', receipt_id, 'ALLOCATE', allocated_by,
           None, {'allocated': float(total_now), 'invoices': len(results)})

    conn.commit()
    conn.close()

    return {
        'status':            'ALLOCATED' if not errors else 'PARTIAL',
        'receipt_id':        receipt_id,
        'receipt_amount':    float(receipt_amount),
        'allocated_this_run': float(total_now),
        'total_allocated':   float(new_total_allocated),
        'unallocated':       float(receipt_amount - new_total_allocated),
        'fully_allocated':   fully_allocated,
        'allocations':       results,
        'errors':            errors,
    }


def unallocate_receipt(receipt_id: int, invoice_id: int,
                        unallocated_by: str = 'SYSTEM') -> dict:
    """Reverse a specific receipt-to-invoice allocation."""
    conn = _conn()
    alloc = conn.execute(
        "SELECT * FROM ar_receipt_allocations WHERE receipt_id=? AND invoice_id=?",
        (receipt_id, invoice_id)).fetchone()
    if not alloc:
        conn.close()
        return {'status': 'ERROR', 'error': 'Allocation not found'}

    alloc_amt = _D(alloc['allocated_amount'])

    # Restore invoice balance
    inv = conn.execute("SELECT * FROM ar_invoices WHERE invoice_id=?", (invoice_id,)).fetchone()
    new_received = _D(inv['amount_received']) - alloc_amt
    new_balance  = _D(inv['total_incl_vat']) - new_received - _D(inv['amount_written_off'])
    new_status   = 'OUTSTANDING' if new_balance > _D('0.01') else 'PAID'
    conn.execute(
        "UPDATE ar_invoices SET amount_received=?, balance_due=?, status=? WHERE invoice_id=?",
        (float(new_received), float(new_balance), new_status, invoice_id))

    # Remove allocation
    conn.execute("DELETE FROM ar_receipt_allocations WHERE receipt_id=? AND invoice_id=?",
                 (receipt_id, invoice_id))

    # Update receipt
    rcp = conn.execute("SELECT * FROM ar_receipts WHERE receipt_id=?", (receipt_id,)).fetchone()
    new_alloc = _D(rcp['amount_allocated']) - alloc_amt
    conn.execute(
        "UPDATE ar_receipts SET amount_allocated=?, amount_unallocated=?, fully_allocated=0 "
        "WHERE receipt_id=?",
        (float(new_alloc), float(_D(rcp['amount']) - new_alloc), receipt_id))

    _audit(conn, 'ar_receipts', receipt_id, 'UNALLOCATE', unallocated_by,
           {'invoice_id': invoice_id, 'amount': float(alloc_amt)}, None)
    conn.commit()
    conn.close()
    return {'status': 'REVERSED', 'receipt_id': receipt_id, 'invoice_id': invoice_id,
            'amount_reversed': float(alloc_amt)}


def get_customer_open_items(customer_code: str,
                             as_at_date: date = None) -> dict:
    """
    Return open-item position for a customer: outstanding invoices,
    unallocated receipts, and net balance.
    """
    if not as_at_date:
        as_at_date = date.today()
    conn = _conn()

    invoices = conn.execute("""
        SELECT i.invoice_id, i.invoice_ref, i.invoice_date, i.due_date,
               i.lp_load_number, i.customer_invoice_no,
               i.total_incl_vat, i.amount_received, i.balance_due,
               i.amount_written_off, i.status
        FROM ar_invoices i
        WHERE i.customer_code=? AND i.invoice_date <= ?
          AND i.status NOT IN ('PAID','CANCELLED')
          AND i.balance_due > 0
        ORDER BY i.invoice_date
    """, (customer_code, str(as_at_date))).fetchall()

    receipts = conn.execute("""
        SELECT r.receipt_id, r.receipt_ref, r.receipt_date,
               r.amount, r.amount_allocated,
               COALESCE(r.amount - r.amount_allocated, r.amount) AS unallocated
        FROM ar_receipts r
        WHERE r.customer_code=? AND r.receipt_date <= ?
          AND r.fully_allocated=0
        ORDER BY r.receipt_date
    """, (customer_code, str(as_at_date))).fetchall()

    total_outstanding = sum(r['balance_due'] for r in invoices)
    total_unallocated = sum(r['unallocated'] for r in receipts)

    conn.close()
    return {
        'customer_code':     customer_code,
        'as_at_date':        str(as_at_date),
        'invoices':          [dict(r) for r in invoices],
        'unallocated_receipts': [dict(r) for r in receipts],
        'total_outstanding': total_outstanding,
        'total_unallocated': total_unallocated,
        'net_balance':       total_outstanding - total_unallocated,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 5. AP ALLOCATION ENGINE — mirror of AR allocation for suppliers
# ─────────────────────────────────────────────────────────────────────────────

def allocate_payment(payment_id: int,
                     allocations: list,
                     allocated_by: str = 'SYSTEM') -> dict:
    """
    Allocate a supplier payment to specific invoices.
    Mirrors allocate_receipt() for the AP side.

    Args:
        payment_id:   ap_payments.payment_id
        allocations:  [{invoice_id, amount}, ...]
    """
    conn = _conn()
    payment = conn.execute("SELECT * FROM ap_payments WHERE payment_id=?", (payment_id,)).fetchone()
    if not payment:
        conn.close()
        return {'status': 'ERROR', 'error': f'Payment {payment_id} not found'}

    pay_amount        = _D(payment['amount'])
    already_allocated = _D(payment['amount_allocated'])
    available         = pay_amount - already_allocated
    errors            = []
    results           = []
    total_now         = _D(0)
    today             = str(date.today())

    for alloc in allocations:
        inv_id    = alloc['invoice_id']
        alloc_amt = _D(alloc['amount'])

        inv = conn.execute(
            "SELECT * FROM ap_invoices WHERE invoice_id=? AND supplier_code=?",
            (inv_id, payment['supplier_code'])).fetchone()
        if not inv:
            errors.append(f'Invoice {inv_id}: not found for supplier {payment["supplier_code"]}')
            continue
        if inv['status'] in ('PAID','CANCELLED'):
            errors.append(f'Invoice {inv_id}: already {inv["status"]}')
            continue

        inv_balance = _D(inv['balance_due'])
        if alloc_amt > inv_balance + _D('0.01'):
            errors.append(f'Invoice {inv_id}: R{float(alloc_amt):,.2f} exceeds balance R{float(inv_balance):,.2f}')
            continue
        if total_now + alloc_amt > available + _D('0.01'):
            errors.append(f'Invoice {inv_id}: would exceed payment available balance')
            continue

        existing = conn.execute(
            "SELECT alloc_id, allocated_amount FROM ap_payment_allocations "
            "WHERE payment_id=? AND invoice_id=?",
            (payment_id, inv_id)).fetchone()

        if existing:
            new_alloc_total = _D(existing['allocated_amount']) + alloc_amt
            conn.execute(
                "UPDATE ap_payment_allocations SET allocated_amount=?, allocation_date=?, "
                "created_by=? WHERE alloc_id=?",
                (float(new_alloc_total), today, allocated_by, existing['alloc_id']))
        else:
            conn.execute("""
                INSERT INTO ap_payment_allocations
                (payment_id, invoice_id, allocated_amount, allocation_date, created_by)
                VALUES (?,?,?,?,?)
            """, (payment_id, inv_id, float(alloc_amt), today, allocated_by))

        new_paid    = _D(inv['amount_paid']) + alloc_amt
        new_balance = _D(inv['total_incl_vat']) - new_paid - _D(inv['amount_written_off'])
        new_status  = 'PAID' if new_balance <= _D('0.01') else 'PARTIAL'
        conn.execute(
            "UPDATE ap_invoices SET amount_paid=?, balance_due=?, status=? WHERE invoice_id=?",
            (float(new_paid), float(new_balance), new_status, inv_id))

        total_now += alloc_amt
        results.append({'invoice_id': inv_id, 'invoice_ref': inv['invoice_ref'],
                        'allocated': float(alloc_amt), 'new_balance': float(new_balance),
                        'status': new_status})

    new_total_allocated = already_allocated + total_now
    fully_allocated     = new_total_allocated >= pay_amount - _D('0.01')
    conn.execute(
        "UPDATE ap_payments SET amount_allocated=?, amount_unallocated=?, fully_allocated=? "
        "WHERE payment_id=?",
        (float(new_total_allocated),
         float(pay_amount - new_total_allocated),
         1 if fully_allocated else 0, payment_id))

    conn.commit()
    conn.close()
    return {
        'status':            'ALLOCATED' if not errors else 'PARTIAL',
        'payment_id':        payment_id,
        'payment_amount':    float(pay_amount),
        'allocated_this_run': float(total_now),
        'total_allocated':   float(new_total_allocated),
        'unallocated':       float(pay_amount - new_total_allocated),
        'fully_allocated':   fully_allocated,
        'allocations':       results,
        'errors':            errors,
    }


def get_supplier_open_items(supplier_code: str, as_at_date: date = None) -> dict:
    """Return open-item position for a supplier."""
    if not as_at_date:
        as_at_date = date.today()
    conn = _conn()
    invoices = conn.execute("""
        SELECT invoice_id, invoice_ref, supplier_invoice_no, invoice_date, due_date,
               total_incl_vat, amount_paid, balance_due, status
        FROM ap_invoices
        WHERE supplier_code=? AND invoice_date <= ?
          AND status NOT IN ('PAID','CANCELLED') AND balance_due > 0
        ORDER BY invoice_date
    """, (supplier_code, str(as_at_date))).fetchall()

    payments = conn.execute("""
        SELECT payment_id, payment_ref, payment_date, amount, amount_allocated,
               COALESCE(amount - amount_allocated, amount) AS unallocated
        FROM ap_payments
        WHERE supplier_code=? AND payment_date <= ? AND fully_allocated=0
        ORDER BY payment_date
    """, (supplier_code, str(as_at_date))).fetchall()

    conn.close()
    return {
        'supplier_code':     supplier_code,
        'invoices':          [dict(r) for r in invoices],
        'unallocated_payments': [dict(r) for r in payments],
        'total_outstanding': sum(r['balance_due'] for r in invoices),
        'total_unallocated': sum(r['unallocated'] for r in payments),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 6. CUSTOMER STATEMENTS — open-item and balance-forward modes
# ─────────────────────────────────────────────────────────────────────────────

def get_statement_data_open_item(customer_code: str,
                                  statement_date: date) -> dict:
    """
    Build open-item statement data.
    Shows every outstanding invoice individually.
    Receipts shown matched to specific invoices or as unallocated credits.
    Prior-period invoices that are still outstanding are shown individually
    with their original dates.
    """
    conn = _conn()

    cust = conn.execute("""
        SELECT * FROM ar_customers WHERE customer_code=? AND active=1
    """, (customer_code,)).fetchone()
    if not cust:
        conn.close()
        return {'error': f"Customer '{customer_code}' not found"}

    # All transactions up to statement date
    invoices = conn.execute("""
        SELECT i.invoice_id, i.invoice_ref, i.invoice_date, i.due_date,
               i.customer_invoice_no, i.lp_load_number,
               i.total_incl_vat, i.amount_received, i.balance_due,
               i.amount_written_off, i.status
        FROM ar_invoices i
        WHERE i.customer_code=? AND i.invoice_date <= ?
        ORDER BY i.invoice_date, i.invoice_ref
    """, (customer_code, str(statement_date))).fetchall()

    receipts = conn.execute("""
        SELECT r.receipt_id, r.receipt_ref, r.receipt_date, r.amount,
               r.amount_allocated,
               COALESCE(r.amount - r.amount_allocated, r.amount) AS unallocated,
               r.payment_method
        FROM ar_receipts r
        WHERE r.customer_code=? AND r.receipt_date <= ?
        ORDER BY r.receipt_date
    """, (customer_code, str(statement_date))).fetchall()

    credit_notes = conn.execute("""
        SELECT cn_ref, cn_date, reason, total_incl_vat, status
        FROM ar_credit_notes
        WHERE customer_code=? AND cn_date <= ?
        ORDER BY cn_date
    """, (customer_code, str(statement_date))).fetchall()

    # Allocation detail: which invoices each receipt is matched to
    allocations = conn.execute("""
        SELECT a.receipt_id, a.invoice_id, a.allocated_amount,
               i.invoice_ref, r.receipt_ref
        FROM ar_receipt_allocations a
        JOIN ar_invoices i ON a.invoice_id = i.invoice_id
        JOIN ar_receipts r ON a.receipt_id = r.receipt_id
        WHERE i.customer_code=?
    """, (customer_code,)).fetchall()

    # Aging buckets
    aging = conn.execute("""
        SELECT aging_bucket, COUNT(*) as cnt, SUM(balance_due) as total
        FROM vw_debtor_aging
        WHERE customer_code=?
        GROUP BY aging_bucket
        ORDER BY CASE aging_bucket
            WHEN 'Current'    THEN 1 WHEN '1-30 Days' THEN 2
            WHEN '31-60 Days' THEN 3 WHEN '61-90 Days' THEN 4
            ELSE 5 END
    """, (customer_code,)).fetchall()

    conn.close()

    total_invoiced    = sum(r['total_incl_vat'] for r in invoices)
    total_outstanding = sum(r['balance_due'] for r in invoices if r['balance_due'] > 0)
    total_unallocated = sum(r['unallocated'] for r in receipts)
    aging_dict        = {r['aging_bucket']: r['total'] for r in aging}

    return {
        'mode':            'OPEN_ITEM',
        'customer_code':   cust['customer_code'],
        'customer_name':   cust['customer_name'],
        'vat_number':      cust['vat_number'],
        'contact_name':    cust['contact_name'],
        'email':           cust['email'],
        'telephone':       cust['telephone'],
        'address':         [x for x in [cust['postal_addr_1'], cust['postal_addr_2'],
                            cust['postal_addr_3'], cust['postal_code']] if x],
        'payment_terms':   cust['payment_terms_days'],
        'credit_limit':    cust['credit_limit'],
        'statement_date':  str(statement_date),
        'invoices':        [dict(r) for r in invoices],
        'receipts':        [dict(r) for r in receipts],
        'credit_notes':    [dict(r) for r in credit_notes],
        'allocations':     [dict(r) for r in allocations],
        'aging':           aging_dict,
        'total_invoiced':  total_invoiced,
        'total_outstanding': total_outstanding,
        'total_unallocated': total_unallocated,
        'net_balance':     total_outstanding - total_unallocated,
    }


def get_statement_data_balance_forward(customer_code: str,
                                        statement_date: date,
                                        current_period_start: date = None) -> dict:
    """
    Build balance-forward statement data.
    Prior-period activity collapsed to a single opening balance.
    Only current-period transactions shown in detail.

    The opening balance = sum of all prior balances (positive = amount owed).
    """
    if not current_period_start:
        # Default: first day of statement month
        current_period_start = statement_date.replace(day=1)

    conn = _conn()

    cust = conn.execute(
        "SELECT * FROM ar_customers WHERE customer_code=? AND active=1",
        (customer_code,)).fetchone()
    if not cust:
        conn.close()
        return {'error': f"Customer '{customer_code}' not found"}

    # Opening balance: net of all activity BEFORE current period
    prior_invoiced = conn.execute("""
        SELECT COALESCE(SUM(total_incl_vat), 0) FROM ar_invoices
        WHERE customer_code=? AND invoice_date < ?
    """, (customer_code, str(current_period_start))).fetchone()[0]

    prior_received = conn.execute("""
        SELECT COALESCE(SUM(amount), 0) FROM ar_receipts
        WHERE customer_code=? AND receipt_date < ?
    """, (customer_code, str(current_period_start))).fetchone()[0]

    prior_cn = conn.execute("""
        SELECT COALESCE(SUM(total_incl_vat), 0) FROM ar_credit_notes
        WHERE customer_code=? AND cn_date < ?
    """, (customer_code, str(current_period_start))).fetchone()[0]

    opening_balance = prior_invoiced - prior_received - prior_cn

    # Current period transactions
    curr_invoices = conn.execute("""
        SELECT invoice_id, invoice_ref, invoice_date, due_date,
               customer_invoice_no, lp_load_number,
               total_incl_vat, amount_received, balance_due, status
        FROM ar_invoices
        WHERE customer_code=? AND invoice_date >= ? AND invoice_date <= ?
        ORDER BY invoice_date
    """, (customer_code, str(current_period_start), str(statement_date))).fetchall()

    curr_receipts = conn.execute("""
        SELECT receipt_id, receipt_ref, receipt_date, amount, payment_method
        FROM ar_receipts
        WHERE customer_code=? AND receipt_date >= ? AND receipt_date <= ?
        ORDER BY receipt_date
    """, (customer_code, str(current_period_start), str(statement_date))).fetchall()

    curr_cn = conn.execute("""
        SELECT cn_ref, cn_date, reason, total_incl_vat
        FROM ar_credit_notes
        WHERE customer_code=? AND cn_date >= ? AND cn_date <= ?
        ORDER BY cn_date
    """, (customer_code, str(current_period_start), str(statement_date))).fetchall()

    # Aging (always based on total outstanding, not just current period)
    aging = conn.execute("""
        SELECT aging_bucket, SUM(balance_due) as total
        FROM vw_debtor_aging WHERE customer_code=?
        GROUP BY aging_bucket
        ORDER BY CASE aging_bucket
            WHEN 'Current' THEN 1 WHEN '1-30 Days' THEN 2
            WHEN '31-60 Days' THEN 3 WHEN '61-90 Days' THEN 4 ELSE 5 END
    """, (customer_code,)).fetchall()

    conn.close()

    curr_invoiced_total = sum(r['total_incl_vat'] for r in curr_invoices)
    curr_received_total = sum(r['amount'] for r in curr_receipts)
    curr_cn_total       = sum(r['total_incl_vat'] for r in curr_cn)
    closing_balance     = opening_balance + curr_invoiced_total - curr_received_total - curr_cn_total

    return {
        'mode':                   'BALANCE_FORWARD',
        'customer_code':          cust['customer_code'],
        'customer_name':          cust['customer_name'],
        'vat_number':             cust['vat_number'],
        'contact_name':           cust['contact_name'],
        'email':                  cust['email'],
        'telephone':              cust['telephone'],
        'address':                [x for x in [cust['postal_addr_1'], cust['postal_addr_2'],
                                  cust['postal_addr_3'], cust['postal_code']] if x],
        'payment_terms':          cust['payment_terms_days'],
        'statement_date':         str(statement_date),
        'current_period_start':   str(current_period_start),
        'opening_balance':        float(opening_balance),
        'current_invoices':       [dict(r) for r in curr_invoices],
        'current_receipts':       [dict(r) for r in curr_receipts],
        'current_credit_notes':   [dict(r) for r in curr_cn],
        'aging':                  {r['aging_bucket']: r['total'] for r in aging},
        'curr_invoiced_total':    curr_invoiced_total,
        'curr_received_total':    curr_received_total,
        'curr_cn_total':          curr_cn_total,
        'closing_balance':        float(closing_balance),
    }


def generate_statement_text(customer_code: str,
                              statement_date: date = None,
                              mode: str = 'OPEN_ITEM',
                              entity_id: int = 1) -> str:
    """
    Generate a plain-text statement for a customer.
    Use this for email body or when reportlab is unavailable.
    PDF generation requires reportlab (call generate_statement_pdf instead).

    Args:
        mode: 'OPEN_ITEM' or 'BALANCE_FORWARD'
    """
    if not statement_date:
        statement_date = date.today()

    entity = get_entity(entity_id)

    if mode == 'OPEN_ITEM':
        data = get_statement_data_open_item(customer_code, statement_date)
    else:
        data = get_statement_data_balance_forward(customer_code, statement_date)

    if 'error' in data:
        return f"ERROR: {data['error']}"

    lines = []
    W = 72

    lines.append("=" * W)
    lines.append(f"  {entity.get('entity_name','')}")
    lines.append(f"  VAT: {entity.get('vat_number','')}")
    lines.append(f"  {entity.get('email','')}  |  {entity.get('telephone','')}")
    lines.append("=" * W)
    lines.append(f"  CUSTOMER STATEMENT — {mode.replace('_', '-')}")
    lines.append(f"  Date: {statement_date.strftime('%d %B %Y')}")
    lines.append("-" * W)
    lines.append(f"  Customer:  {data['customer_name']} ({data['customer_code']})")
    lines.append(f"  Terms:     {data.get('payment_terms','30')} days")
    lines.append("=" * W)

    if mode == 'BALANCE_FORWARD':
        lines.append(f"\n  Opening Balance (before {data['current_period_start']}):")
        lines.append(f"  {'B/F Balance':<50} R {data['opening_balance']:>12,.2f}")
        lines.append("")

        if data['current_invoices']:
            lines.append("  CURRENT PERIOD INVOICES:")
            lines.append(f"  {'Date':<12} {'Reference':<20} {'Load':<15} {'Amount':>12}")
            lines.append("  " + "-" * 62)
            for inv in data['current_invoices']:
                load = inv.get('lp_load_number') or inv.get('customer_invoice_no') or '—'
                lines.append(f"  {inv['invoice_date']:<12} {inv['invoice_ref']:<20} "
                             f"{load:<15} R {inv['total_incl_vat']:>10,.2f}")

        if data['current_receipts']:
            lines.append("\n  RECEIPTS RECEIVED:")
            for rec in data['current_receipts']:
                lines.append(f"  {rec['receipt_date']:<12} {rec['receipt_ref']:<20} "
                             f"{'Payment — thank you':<15} R ({rec['amount']:>10,.2f})")

        if data['current_credit_notes']:
            lines.append("\n  CREDIT NOTES:")
            for cn in data['current_credit_notes']:
                lines.append(f"  {cn['cn_date']:<12} {cn['cn_ref']:<20} "
                             f"{(cn['reason'] or '')[:15]:<15} R ({cn['total_incl_vat']:>10,.2f})")

        lines.append("")
        lines.append("=" * W)
        lines.append(f"  {'CLOSING BALANCE DUE':<50} R {data['closing_balance']:>12,.2f}")

    else:  # OPEN_ITEM
        lines.append("\n  OUTSTANDING INVOICES:")
        lines.append(f"  {'Date':<12} {'Invoice Ref':<18} {'Load':<12} "
                     f"{'Due Date':<12} {'Invoice':>12} {'Balance':>12}")
        lines.append("  " + "-" * 80)
        for inv in data['invoices']:
            if inv['balance_due'] <= 0:
                continue
            load = inv.get('lp_load_number') or inv.get('customer_invoice_no') or '—'
            lines.append(f"  {inv['invoice_date']:<12} {inv['invoice_ref']:<18} "
                        f"{load[:12]:<12} {inv['due_date']:<12} "
                        f"R {inv['total_incl_vat']:>10,.2f} R {inv['balance_due']:>10,.2f}")

        if data['receipts']:
            unalloc = [r for r in data['receipts'] if r['unallocated'] > 0]
            if unalloc:
                lines.append("\n  UNALLOCATED RECEIPTS (credits available):")
                for rec in unalloc:
                    lines.append(f"  {rec['receipt_date']:<12} {rec['receipt_ref']:<20} "
                                f"R ({rec['unallocated']:>10,.2f})")

        lines.append("")
        lines.append("=" * W)
        lines.append(f"  {'TOTAL OUTSTANDING':<50} R {data['total_outstanding']:>12,.2f}")
        if data['total_unallocated'] > 0:
            lines.append(f"  {'Less: Unallocated receipts':<50} R ({data['total_unallocated']:>10,.2f})")
            lines.append(f"  {'NET BALANCE DUE':<50} R {data['net_balance']:>12,.2f}")

    # Aging
    lines.append("\n  AGING ANALYSIS:")
    buckets = ['Current','1-30 Days','31-60 Days','61-90 Days','90+ Days']
    for b in buckets:
        v = data['aging'].get(b, 0)
        if v:
            lines.append(f"    {b:<20} R {v:>12,.2f}")

    # Banking details
    lines.append("\n  BANKING DETAILS:")
    lines.append(f"  Bank: {entity.get('bank_name','')}  |  "
                f"Branch: {entity.get('bank_branch_code','')}")
    lines.append(f"  Account: {entity.get('bank_account_no','')}  |  "
                f"Ref: {data['customer_code']}")
    lines.append("=" * W)

    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# 7. REPORTING HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def print_open_items_summary(customer_code: str, as_at_date: date = None):
    """Print AR open-item position for a customer."""
    data = get_customer_open_items(customer_code, as_at_date)
    if 'error' in data:
        print(f"  ❌ {data['error']}")
        return
    print(f"\n  OPEN ITEMS — {customer_code}  as at {data['as_at_date']}")
    print("  " + "─" * 70)
    print(f"  {'Invoice':<18} {'Date':<12} {'Due':<12} {'Load':<12} {'Balance':>12}")
    for inv in data['invoices']:
        load = inv.get('lp_load_number') or '—'
        print(f"  {inv['invoice_ref']:<18} {inv['invoice_date']:<12} "
              f"{inv['due_date']:<12} {load[:12]:<12} R {inv['balance_due']:>10,.2f}")
    print("  " + "─" * 70)
    print(f"  {'TOTAL OUTSTANDING':<55} R {data['total_outstanding']:>10,.2f}")
    if data['unallocated_receipts']:
        print(f"\n  Unallocated receipts:")
        for r in data['unallocated_receipts']:
            print(f"    {r['receipt_ref']:<18} {r['receipt_date']:<12} "
                  f"R {r['unallocated']:>10,.2f} available")
        print(f"  {'NET BALANCE':<55} R {data['net_balance']:>10,.2f}")


def print_allocation_detail(customer_code: str):
    """Show which receipts are matched to which invoices."""
    conn = _conn()
    rows = conn.execute("""
        SELECT a.receipt_id, a.invoice_id,
               r.receipt_ref, r.receipt_date, r.amount AS receipt_amount,
               i.invoice_ref, i.invoice_date, i.total_incl_vat,
               a.allocated_amount
        FROM ar_receipt_allocations a
        JOIN ar_receipts r ON a.receipt_id = r.receipt_id
        JOIN ar_invoices i ON a.invoice_id = i.invoice_id
        WHERE i.customer_code=?
        ORDER BY r.receipt_date, i.invoice_date
    """, (customer_code,)).fetchall()
    conn.close()

    if not rows:
        print(f"  No allocations found for {customer_code}")
        return

    print(f"\n  RECEIPT-TO-INVOICE ALLOCATIONS — {customer_code}")
    print("  " + "─" * 80)
    print(f"  {'Receipt':<18} {'Rec Date':<12} {'Invoice':<18} {'Inv Date':<12} {'Allocated':>12}")
    print("  " + "─" * 80)
    for r in rows:
        print(f"  {r['receipt_ref']:<18} {r['receipt_date']:<12} "
              f"{r['invoice_ref']:<18} {r['invoice_date']:<12} "
              f"R {r['allocated_amount']:>10,.2f}")
    print("  " + "─" * 80)
    print(f"  Total allocated: R {sum(r['allocated_amount'] for r in rows):>10,.2f}")


QUICK_REFERENCE = """
CASHBOOK & ALLOCATION ENGINE — QUICK REFERENCE
================================================

ENTITY SETUP:
  from cashbook_engine import create_entity, update_entity
  create_entity('ILW', 'Interland Workshop (Pty) Ltd',
                vat_cycle='BIMONTHLY', fy_start_month=3)
  update_entity(2, bank_account_no='9876 543 210', bank_name='FNB')

VAT PERIODS (entity-aware):
  from cashbook_engine import ensure_vat_periods_for_entity
  ensure_vat_periods_for_entity(fy_id=3, entity_id=1)  # MONTHLY = 12 periods
  ensure_vat_periods_for_entity(fy_id=3, entity_id=2)  # BIMONTHLY = 6 periods

CASHBOOK CSV IMPORT:
  from cashbook_engine import import_cashbook_csv
  result = import_cashbook_csv(
      filepath='nedbank_feb2026.csv',
      period_id=12, bank_account='8400', imported_by='GIDEON',
      date_col='Date', description_col='Description',
      amount_col='Amount', date_format='%Y-%m-%d')

  # Two-column format (debit/credit separate):
  result = import_cashbook_csv(
      filepath='fnb_feb2026.csv', ...,
      debit_col='Debit', credit_col='Credit')

CASHBOOK REVIEW (filtered by direction):
  from cashbook_engine import get_staging_entries, print_staging_review
  print_staging_review(batch_ref=result['batch_ref'])            # all
  print_staging_review(batch_ref=result['batch_ref'],
                       direction='RECEIPT')                       # money in only
  print_staging_review(batch_ref=result['batch_ref'],
                       direction='PAYMENT')                       # money out only

CONFIRM ALLOCATION (with learning):
  from cashbook_engine import confirm_staging_allocation
  confirm_staging_allocation(staging_id=5,
      gl_account_code='2050 010', vat_type='IN_STD',
      journal_description='Shesha fuel Feb 2026', learn=True)

POST CASHBOOK BATCH:
  from cashbook_engine import post_cashbook_batch
  post_cashbook_batch(
      staging_ids=[1,2,3,4,5],
      period_id=12, bank_account='8400', posted_by='GIDEON')

BANK RECONCILIATION:
  from cashbook_engine import (create_recon, auto_match_staging,
      add_recon_item, calculate_recon, lock_recon, print_recon_report)
  recon = create_recon(period_id=12, bank_account='8400',
                       bank_stmt_opening=105000, bank_stmt_closing=128765,
                       created_by='GIDEON')
  auto_match_staging(recon['recon_id'])
  add_recon_item(recon['recon_id'],
      item_type='UNRECORDED_PAYMENT',
      description='Bank service fee not yet in GL',
      amount=485.00)
  calc = calculate_recon(recon['recon_id'])
  print(f"Difference: R{calc['difference']:,.2f}")
  if calc['balanced']:
      lock_recon(recon['recon_id'], 'GIDEON')
  print_recon_report(recon['recon_id'])

AR OPEN-ITEM ALLOCATION:
  from cashbook_engine import allocate_receipt, get_customer_open_items
  # See which invoices are outstanding:
  get_customer_open_items('MAS001')
  # Allocate receipt 5 to invoices 12 and 13:
  allocate_receipt(receipt_id=5, allocations=[
      {'invoice_id': 12, 'amount': 50000.00},
      {'invoice_id': 13, 'amount': 30000.00},
  ], allocated_by='GIDEON')

AP PAYMENT ALLOCATION:
  from cashbook_engine import allocate_payment
  allocate_payment(payment_id=3, allocations=[
      {'invoice_id': 8, 'amount': 97750.00},
  ], allocated_by='GIDEON')

CUSTOMER STATEMENTS:
  from cashbook_engine import generate_statement_text
  # Open-item (shows every invoice individually):
  print(generate_statement_text('MAS001', mode='OPEN_ITEM'))

  # Balance-forward (prior months as one opening balance line):
  from datetime import date
  print(generate_statement_text('MAS001', statement_date=date(2026,2,28),
                                 mode='BALANCE_FORWARD'))
"""
