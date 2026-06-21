"""
LP2.0 Journal Posting Engine
==============================
Handles creation, validation, posting, and reversal of GL journals.

Journal types:
  FA   - Fixed Asset (depreciation runs, disposals, revaluations)
  AP   - Accounts Payable (supplier invoices, credit notes, payments)
  AR   - Accounts Receivable (customer invoices, credit notes, receipts)
  BC   - Bank/Cash (receipts, payments, bank charges)
  GJ   - General Journal (manual adjustments)
  YE   - Year End (closing entries)

Core rules:
  - Every journal MUST balance (sum debits = sum credits)
  - Posted journals are IMMUTABLE — reverse to correct
  - VAT direction stamped by source_module, never inferred
  - Period must be open before posting
  - Ref format: {TYPE}-{YYYYMM}-{SEQ:05d}  e.g. DEP-202602-00001
"""

import sqlite3
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

DB_PATH = 'lp2_validation.db'


# ─────────────────────────────────────────────────────────────────────────────
# REFERENCE HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def next_journal_ref(conn: sqlite3.Connection, journal_type: str,
                     period_id: int) -> str:
    """
    Generate next sequential journal reference.
    Format: {TYPE}-{YYYYMM}-{SEQ:05d}
    e.g. DEP-202602-00001, AP-202602-00042
    """
    period = conn.execute(
        "SELECT period_start FROM sys_periods WHERE period_id=?",
        (period_id,)).fetchone()
    yyyymm = period[0][:7].replace('-', '')  # '2026-02-01' -> '202602'

    prefix = f"{journal_type}-{yyyymm}-"
    last = conn.execute(
        "SELECT journal_ref FROM gl_journals "
        "WHERE journal_ref LIKE ? ORDER BY journal_ref DESC LIMIT 1",
        (prefix + '%',)).fetchone()

    if last:
        seq = int(last[0].split('-')[-1]) + 1
    else:
        seq = 1
    return f"{prefix}{seq:05d}"


def get_period_id(conn: sqlite3.Connection, for_date: date) -> Optional[int]:
    """Find the period_id for a given date."""
    row = conn.execute(
        "SELECT period_id FROM sys_periods "
        "WHERE period_start <= ? AND period_end >= ? AND is_closed = 0",
        (str(for_date), str(for_date))).fetchone()
    return row[0] if row else None


def validate_account(conn: sqlite3.Connection,
                     account_code: str) -> Optional[dict]:
    """Return account details or None if not found/inactive."""
    row = conn.execute(
        "SELECT account_code, account_name, vat_treatment, "
        "allowed_vat_codes, allow_journals, active "
        "FROM gl_accounts WHERE account_code=?",
        (account_code,)).fetchone()
    if not row or not row[5] or not row[4]:
        return None
    return {
        'code':          row[0],
        'name':          row[1],
        'vat_treatment': row[2],
        'allowed_vat':   row[3].split(',') if row[3] else [],
        'allow_journals': row[4],
    }


# ─────────────────────────────────────────────────────────────────────────────
# CORE: CREATE AND POST JOURNAL
# ─────────────────────────────────────────────────────────────────────────────

def post_journal(journal_date: date,
                 journal_type: str,
                 description: str,
                 lines: list,
                 source_module: str = None,
                 source_document: str = None,
                 posted_by: str = 'SYSTEM',
                 mode: str = 'POST') -> dict:
    """
    Create and optionally post a GL journal.

    Args:
        journal_date:    date of the transaction
        journal_type:    FA / AP / AR / BC / GJ / YE
        description:     human-readable journal description
        lines:           list of dicts, each:
                           {account_code, debit, credit,
                            description (optional),
                            vat_code (optional),
                            vat_amount (optional)}
        source_module:   AR_INV / AR_CN / AP_INV / AP_CN /
                         FA_PUR / FA_DISP / GL_J etc.
        source_document: invoice number, PO number etc.
        posted_by:       username for audit trail
        mode:            VALIDATE (check only) / POST (commit)

    Returns:
        dict with journal_id, journal_ref, status, errors, lines_summary
    """
    result = {
        'mode':        mode,
        'status':      'PENDING',
        'journal_id':  None,
        'journal_ref': None,
        'errors':      [],
        'warnings':    [],
        'total_debit': Decimal('0'),
        'total_credit': Decimal('0'),
        'line_count':  len(lines),
    }

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")

    # ── 1. Validate period ────────────────────────────────────────────────────
    period_id = get_period_id(conn, journal_date)
    if not period_id:
        result['errors'].append(
            f"No open period found for {journal_date}. "
            f"Check sys_periods — period may be closed or date out of range.")
        result['status'] = 'FAILED'
        conn.close()
        return result

    # ── 2. Validate journal type ──────────────────────────────────────────────
    valid_types = ('FA', 'AP', 'AR', 'BC', 'GJ', 'ADJ', 'YE')
    if journal_type not in valid_types:
        result['errors'].append(
            f"Invalid journal_type '{journal_type}'. "
            f"Must be one of: {', '.join(valid_types)}")
        result['status'] = 'FAILED'
        conn.close()
        return result

    # ── 3. Validate lines ─────────────────────────────────────────────────────
    if len(lines) < 2:
        result['errors'].append(
            "Journal must have at least 2 lines (minimum: 1 debit + 1 credit)")
        result['status'] = 'FAILED'
        conn.close()
        return result

    validated_lines = []
    for i, line in enumerate(lines, 1):
        dr = Decimal(str(line.get('debit', 0))).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP)
        cr = Decimal(str(line.get('credit', 0))).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP)
        vat_amount = Decimal(str(line.get('vat_amount', 0))).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP)

        # Cannot be both debit and credit
        if dr > 0 and cr > 0:
            result['errors'].append(
                f"Line {i} ({line.get('account_code')}): "
                f"cannot have both debit and credit on the same line")
            continue

        # Must have one or the other
        if dr == 0 and cr == 0:
            result['errors'].append(
                f"Line {i} ({line.get('account_code')}): "
                f"both debit and credit are zero")
            continue

        # Validate account
        acc = validate_account(conn, line.get('account_code', ''))
        if not acc:
            result['errors'].append(
                f"Line {i}: account '{line.get('account_code')}' "
                f"not found, inactive, or does not allow journals")
            continue

        # Validate VAT code if provided
        vat_code = line.get('vat_code')
        if vat_code:
            vat_type = conn.execute(
                "SELECT vat_code, vat_direction, rate_pct "
                "FROM sys_vat_types WHERE vat_code=? AND active=1",
                (vat_code,)).fetchone()
            if not vat_type:
                result['errors'].append(
                    f"Line {i}: VAT code '{vat_code}' not found or inactive")
                continue
            # Check account allows this VAT code
            if acc['allowed_vat'] and vat_code not in acc['allowed_vat']:
                result['errors'].append(
                    f"Line {i}: account '{acc['code']}' ({acc['name']}) "
                    f"does not allow VAT code '{vat_code}'. "
                    f"Allowed: {acc['allowed_vat']}")
                continue

        result['total_debit']  += dr
        result['total_credit'] += cr

        validated_lines.append({
            'line_number':  i,
            'account_code': line['account_code'],
            'description':  line.get('description', ''),
            'debit':        float(dr),
            'credit':       float(cr),
            'vat_code':     vat_code,
            'vat_amount':   float(vat_amount),
        })

    if result['errors']:
        result['status'] = 'FAILED'
        conn.close()
        return result

    # ── 4. Balance check ──────────────────────────────────────────────────────
    balance = result['total_debit'] - result['total_credit']
    if abs(balance) > Decimal('0.01'):
        result['errors'].append(
            f"Journal out of balance by R {float(balance):,.2f}. "
            f"Total debits: R {float(result['total_debit']):,.2f}, "
            f"Total credits: R {float(result['total_credit']):,.2f}")
        result['status'] = 'FAILED'
        conn.close()
        return result

    result['total_debit']  = float(result['total_debit'])
    result['total_credit'] = float(result['total_credit'])

    if mode == 'VALIDATE':
        result['status'] = 'VALID'
        conn.close()
        return result

    # ── 5. Post to database ───────────────────────────────────────────────────
    journal_ref = next_journal_ref(conn, journal_type, period_id)

    conn.execute("""
        INSERT INTO gl_journals
        (journal_ref, journal_type, description, period_id,
         journal_date, source_document, source_module,
         posted, posted_at, posted_by)
        VALUES (?,?,?,?,?,?,?,1,?,?)""",
        (journal_ref, journal_type, description, period_id,
         str(journal_date), source_document, source_module,
         datetime.now().isoformat(), posted_by))

    journal_id = conn.execute(
        "SELECT last_insert_rowid()").fetchone()[0]

    for line in validated_lines:
        conn.execute("""
            INSERT INTO gl_journal_lines
            (journal_id, line_number, account_code, description,
             debit, credit, vat_type, vat_amount)
            VALUES (?,?,?,?,?,?,?,?)""",
            (journal_id,
             line['line_number'],
             line['account_code'],
             line['description'],
             line['debit'],
             line['credit'],
             line['vat_code'],
             line['vat_amount']))

    # Audit log
    conn.execute("""
        INSERT INTO gl_audit_log
        (table_name, record_id, action, changed_by, new_values)
        VALUES ('gl_journals', ?, 'POST', ?, ?)""",
        (journal_id, posted_by,
         f"ref={journal_ref}, type={journal_type}, "
         f"lines={len(validated_lines)}, "
         f"total={result['total_debit']:.2f}"))

    conn.commit()
    conn.close()

    result['status']      = 'POSTED'
    result['journal_id']  = journal_id
    result['journal_ref'] = journal_ref
    return result


# ─────────────────────────────────────────────────────────────────────────────
# REVERSAL
# ─────────────────────────────────────────────────────────────────────────────

def reverse_journal(journal_id: int,
                    reversal_date: date,
                    reversed_by: str = 'SYSTEM',
                    reason: str = '') -> dict:
    """
    Reverse a posted journal by creating an equal and opposite entry.
    Original journal is flagged reversed=1.
    Reversal journal gets journal_type='ADJ' and links back.

    Args:
        journal_id:    ID of journal to reverse
        reversal_date: date for the reversal entry
        reversed_by:   user name
        reason:        reason for reversal (for audit)
    """
    result = {'status': 'PENDING', 'errors': [], 'reversal_ref': None}

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")

    # Fetch original
    orig = conn.execute(
        "SELECT journal_id, journal_ref, journal_type, description, "
        "period_id, posted, reversed "
        "FROM gl_journals WHERE journal_id=?",
        (journal_id,)).fetchone()

    if not orig:
        result['errors'].append(f"Journal ID {journal_id} not found")
        result['status'] = 'FAILED'
        conn.close()
        return result

    if not orig[5]:
        result['errors'].append(
            f"Journal {orig[1]} is not posted — cannot reverse")
        result['status'] = 'FAILED'
        conn.close()
        return result

    if orig[6]:
        result['errors'].append(
            f"Journal {orig[1]} has already been reversed")
        result['status'] = 'FAILED'
        conn.close()
        return result

    # Get reversal period
    rev_period_id = get_period_id(conn, reversal_date)
    if not rev_period_id:
        result['errors'].append(
            f"No open period for reversal date {reversal_date}")
        result['status'] = 'FAILED'
        conn.close()
        return result

    # Fetch original lines
    orig_lines = conn.execute(
        "SELECT account_code, description, debit, credit, "
        "vat_type, vat_amount "
        "FROM gl_journal_lines WHERE journal_id=? ORDER BY line_number",
        (journal_id,)).fetchall()

    # Build reversal lines (swap debit/credit)
    rev_lines = []
    for i, line in enumerate(orig_lines, 1):
        rev_lines.append({
            'line_number':  i,
            'account_code': line[0],
            'description':  f"REVERSAL: {line[1]}",
            'debit':        line[3],   # swapped
            'credit':       line[2],   # swapped
            'vat_code':     line[4],
            'vat_amount':   -line[5] if line[5] else 0,
        })

    rev_ref = next_journal_ref(conn, 'ADJ', rev_period_id)
    rev_desc = (f"REVERSAL of {orig[1]} — {orig[3]}"
                + (f" | {reason}" if reason else ""))

    conn.execute("""
        INSERT INTO gl_journals
        (journal_ref, journal_type, description, period_id,
         journal_date, source_module, posted, posted_at, posted_by,
         reversal_journal_id)
        VALUES (?,?,?,?,?,?,1,?,?,?)""",
        (rev_ref, 'ADJ', rev_desc, rev_period_id,
         str(reversal_date), 'REVERSAL',
         datetime.now().isoformat(), reversed_by, journal_id))

    rev_journal_id = conn.execute(
        "SELECT last_insert_rowid()").fetchone()[0]

    for line in rev_lines:
        conn.execute("""
            INSERT INTO gl_journal_lines
            (journal_id, line_number, account_code, description,
             debit, credit, vat_type, vat_amount)
            VALUES (?,?,?,?,?,?,?,?)""",
            (rev_journal_id, line['line_number'], line['account_code'],
             line['description'], line['debit'], line['credit'],
             line['vat_code'], line['vat_amount']))

    # Flag original as reversed
    conn.execute(
        "UPDATE gl_journals SET reversed=1, reversal_journal_id=? "
        "WHERE journal_id=?",
        (rev_journal_id, journal_id))

    conn.execute("""
        INSERT INTO gl_audit_log
        (table_name, record_id, action, changed_by, new_values)
        VALUES ('gl_journals', ?, 'REVERSE', ?, ?)""",
        (journal_id, reversed_by,
         f"original={orig[1]}, reversal={rev_ref}, reason={reason}"))

    conn.commit()
    conn.close()

    result['status']       = 'REVERSED'
    result['reversal_ref'] = rev_ref
    result['reversal_id']  = rev_journal_id
    return result


# ─────────────────────────────────────────────────────────────────────────────
# DEPRECIATION JOURNAL — links depreciation engine to GL
# ─────────────────────────────────────────────────────────────────────────────

def post_depreciation_journal(depre_results: dict,
                               period_id: int,
                               journal_date: date,
                               posted_by: str = 'SYSTEM') -> dict:
    """
    Convert depreciation run results into a posted GL journal.
    Called after run_depreciation(mode='POST') completes.

    Generates:
      DR  3450 010  Depreciation Fleet       (for FH/FT assets)
      DR  3450 020  Depreciation Other       (for all other classes)
      CR  6600 020  Accum Depre Fleet        (for FH/FT assets)
      CR  6200 020  Accum Depre Motor Veh    (for VH assets)
      CR  6250 020  Accum Depre Computer     (for PC/TR assets)
      CR  6850 020  Accum Depre Generators   (for GE assets)
      etc.

    Args:
        depre_results: dict returned by run_depreciation()
        period_id:     sys_periods.period_id
        journal_date:  typically period end date
        posted_by:     user name
    """
    if depre_results.get('errors'):
        return {'status': 'FAILED',
                'errors': ['Depreciation run had errors — cannot post journal']}

    if not depre_results.get('journal_balanced'):
        return {'status': 'FAILED',
                'errors': ['Depreciation journal is not balanced']}

    # Build lines from depreciation run output
    lines = []
    for jl in depre_results['journal_lines']:
        lines.append({
            'account_code': jl['account_code'],
            'description':  jl['description'],
            'debit':        jl['debit'],
            'credit':       jl['credit'],
            'vat_code':     None,
            'vat_amount':   0,
        })

    period_name = sqlite3.connect(DB_PATH).execute(
        "SELECT period_name FROM sys_periods WHERE period_id=?",
        (period_id,)).fetchone()[0]

    result = post_journal(
        journal_date   = journal_date,
        journal_type   = 'FA',
        description    = f"Monthly Depreciation Run — {period_name}",
        lines          = lines,
        source_module  = 'FA',
        source_document= f"DEP-{period_id}",
        posted_by      = posted_by,
        mode           = 'POST',
    )

    # Link journal back to depreciation runs
    if result['status'] == 'POSTED' and result['journal_id']:
        conn = sqlite3.connect(DB_PATH)
        conn.execute(
            "UPDATE fa_depreciation_runs SET journal_id=? WHERE period_id=?",
            (result['journal_id'], period_id))
        conn.commit()
        conn.close()
        result['linked_depre_runs'] = depre_results['assets_processed']

    return result


# ─────────────────────────────────────────────────────────────────────────────
# REPORTING
# ─────────────────────────────────────────────────────────────────────────────

def print_journal(journal_id: int):
    """Print a posted journal in ledger format."""
    conn = sqlite3.connect(DB_PATH)

    jnl = conn.execute("""
        SELECT journal_ref, journal_type, description,
               journal_date, posted, reversed, posted_by,
               source_document, source_module
        FROM gl_journals WHERE journal_id=?""",
        (journal_id,)).fetchone()

    if not jnl:
        print(f"Journal ID {journal_id} not found")
        conn.close()
        return

    lines = conn.execute("""
        SELECT l.line_number, l.account_code, a.account_name,
               l.description, l.debit, l.credit,
               l.vat_type, l.vat_amount
        FROM gl_journal_lines l
        LEFT JOIN gl_accounts a ON l.account_code=a.account_code
        WHERE l.journal_id=?
        ORDER BY l.line_number""",
        (journal_id,)).fetchall()

    conn.close()

    print()
    print("="*80)
    print(f"  JOURNAL: {jnl[0]}  |  Type: {jnl[1]}  |  Date: {jnl[3]}")
    print(f"  {jnl[2]}")
    if jnl[7]: print(f"  Source: {jnl[7]}  |  Module: {jnl[8]}")
    print(f"  Status: {'POSTED' if jnl[4] else 'UNPOSTED'}"
          + (" *** REVERSED ***" if jnl[5] else "")
          + f"  |  Posted by: {jnl[6]}")
    print("─"*80)
    print(f"  {'#':<4} {'Account':<12} {'Account Name':<32} "
          f"{'Description':<20} {'Debit':>12} {'Credit':>12}")
    print("  "+"─"*76)

    total_dr = total_cr = 0
    for line in lines:
        dr = f"R {line[4]:>9,.2f}" if line[4] else ''
        cr = f"R {line[5]:>9,.2f}" if line[5] else ''
        vat = f" [VAT:{line[6]} R{line[7]:.2f}]" if line[6] else ''
        print(f"  {line[0]:<4} {line[1]:<12} {str(line[2] or ''):<32} "
              f"{str(line[3] or ''):<20} {dr:>12} {cr:>12}{vat}")
        total_dr += line[4] or 0
        total_cr += line[5] or 0

    print("  "+"─"*76)
    print(f"  {'TOTAL':<49} "
          f"R {total_dr:>9,.2f} R {total_cr:>9,.2f}")
    balanced = abs(total_dr - total_cr) < 0.01
    print(f"  {'✅ BALANCED' if balanced else '❌ OUT OF BALANCE'}")
    print("="*80)


def trial_balance(period_id: int = None) -> list:
    """
    Return trial balance. If period_id given, returns balances
    for journals posted in that period only. Otherwise all posted journals.
    """
    conn = sqlite3.connect(DB_PATH)

    if period_id:
        rows = conn.execute("""
            SELECT a.account_code, a.account_name, a.category,
                   a.account_type, a.ifrs_classification,
                   COALESCE(SUM(l.debit),0) AS dr,
                   COALESCE(SUM(l.credit),0) AS cr,
                   COALESCE(SUM(l.debit),0)-COALESCE(SUM(l.credit),0) AS bal
            FROM gl_accounts a
            LEFT JOIN gl_journal_lines l ON a.account_code=l.account_code
            LEFT JOIN gl_journals j ON l.journal_id=j.journal_id
                AND j.posted=1 AND j.period_id=?
            WHERE a.active=1
            GROUP BY a.account_code
            HAVING dr != 0 OR cr != 0
            ORDER BY a.account_code""", (period_id,)).fetchall()
    else:
        rows = conn.execute("""
            SELECT a.account_code, a.account_name, a.category,
                   a.account_type, a.ifrs_classification,
                   COALESCE(SUM(l.debit),0),
                   COALESCE(SUM(l.credit),0),
                   COALESCE(SUM(l.debit),0)-COALESCE(SUM(l.credit),0)
            FROM gl_accounts a
            LEFT JOIN gl_journal_lines l ON a.account_code=l.account_code
            LEFT JOIN gl_journals j ON l.journal_id=j.journal_id
                AND j.posted=1
            WHERE a.active=1
            GROUP BY a.account_code
            HAVING SUM(l.debit) != 0 OR SUM(l.credit) != 0
            ORDER BY a.account_code""").fetchall()

    conn.close()
    return [{'account_code': r[0], 'account_name': r[1],
             'category': r[2], 'account_type': r[3],
             'ifrs_classification': r[4],
             'total_debit': r[5], 'total_credit': r[6],
             'balance': r[7]} for r in rows]


def print_trial_balance(rows: list, title: str = "TRIAL BALANCE"):
    """Print formatted trial balance."""
    print()
    print("="*80)
    print(f"  {title}")
    print("="*80)
    print(f"  {'Code':<14} {'Account Name':<35} {'Type':<20} "
          f"{'Debit':>12} {'Credit':>12}")
    print("  "+"─"*76)

    cur_stmt = None
    total_dr = total_cr = 0
    for r in rows:
        if r['ifrs_classification'] != cur_stmt:
            cur_stmt = r['ifrs_classification']
            print(f"\n  ── {cur_stmt.upper()}")
        dr = f"R {r['total_debit']:>9,.2f}" if r['total_debit'] else ''
        cr = f"R {r['total_credit']:>9,.2f}" if r['total_credit'] else ''
        print(f"  {r['account_code']:<14} {r['account_name']:<35} "
              f"{r['account_type']:<20} {dr:>12} {cr:>12}")
        total_dr += r['total_debit']
        total_cr += r['total_credit']

    print()
    print("  "+"─"*76)
    print(f"  {'TOTALS':<70} "
          f"R {total_dr:>9,.2f} R {total_cr:>9,.2f}")
    balanced = abs(total_dr - total_cr) < 0.01
    print(f"  {'✅ IN BALANCE' if balanced else '❌ OUT OF BALANCE'}")
    print("="*80)


# ─────────────────────────────────────────────────────────────────────────────
# VAT TRANSACTION STAMPING ENGINE
# Appended to journal_engine.py
#
# Called automatically after post_journal() for any VAT-bearing transaction.
# Writes immutable records to vat_transactions — direction fixed by source_module,
# NEVER inferred from debit/credit.
#
# Source module → VAT direction rules:
#   AR_INV  Customer Invoice      → OUTPUT  (Field 1)
#   AR_CN   Customer Credit Note  → OUTPUT  (Field 1A — separate disclosure)
#   AP_INV  Supplier Invoice      → INPUT   (Field 14)
#   AP_CN   Supplier Credit Note  → INPUT   (Field 14 — no separate disclosure)
#   FA_PUR  Asset Purchase        → INPUT   (Field 15 — capital goods)
#   FA_DISP Asset Disposal        → OUTPUT  (Field 4  — capital goods)
#   GL_J    Manual Journal        → direction MUST be explicitly passed
# ─────────────────────────────────────────────────────────────────────────────

# Direction rules — immutable mapping
_VAT_DIRECTION_RULES = {
    'AR_INV':  'OUTPUT',
    'AR_CN':   'OUTPUT',
    'AP_INV':  'INPUT',
    'AP_CN':   'INPUT',
    'FA_PUR':  'INPUT',
    'FA_DISP': 'OUTPUT',
}

# VAT201 field mapping per source_module + is_capital_goods
def _vat201_field(source_module: str, vat_code: str,
                  is_capital: bool) -> str:
    """Return the VAT201 return field for this transaction."""
    if source_module == 'AR_INV' and not is_capital:
        return '1'
    if source_module == 'AR_CN':
        return '1A'
    if source_module == 'FA_DISP' or (source_module == 'AR_INV' and is_capital):
        return '4'
    if source_module in ('AP_INV', 'AP_CN') and not is_capital:
        return '14'
    if source_module == 'FA_PUR' or is_capital:
        return '15'
    if vat_code == 'IN_IMP':
        return '16'
    return '14'   # default input


def stamp_vat_transactions(journal_id: int,
                            journal_date: date,
                            source_module: str,
                            period_id: int,
                            vat_period: str,
                            counterparty_code: str = None,
                            counterparty_name: str = None,
                            counterparty_vat_no: str = None,
                            tax_invoice_no: str = None,
                            gl_direction_override: str = None) -> dict:
    """
    Write VAT transaction records for all VAT-bearing lines in a journal.

    Called immediately after post_journal() for AR/AP/FA journals.
    For GL_J (manual journals), gl_direction_override must be passed.

    Args:
        journal_id:           from post_journal() result
        journal_date:         transaction date
        source_module:        AR_INV / AR_CN / AP_INV / AP_CN / FA_PUR / FA_DISP / GL_J
        period_id:            sys_periods.period_id
        vat_period:           YYYYMM string e.g. '202602'
        counterparty_code:    customer_code or supplier_code
        counterparty_name:    customer or supplier name
        counterparty_vat_no:  their VAT registration number
        tax_invoice_no:       invoice number (required for input VAT claims)
        gl_direction_override: 'INPUT' or 'OUTPUT' — required only for GL_J

    Returns:
        dict with stamped count, total vat, errors
    """
    result = {
        'stamped': 0,
        'total_vat': 0.0,
        'errors': [],
        'lines': [],
    }

    conn = sqlite3.connect(DB_PATH)

    # Determine direction
    if source_module == 'GL_J':
        if not gl_direction_override or gl_direction_override not in ('INPUT','OUTPUT'):
            result['errors'].append(
                "GL_J source_module requires gl_direction_override='INPUT' or 'OUTPUT'")
            conn.close()
            return result
        direction = gl_direction_override
    elif source_module in _VAT_DIRECTION_RULES:
        direction = _VAT_DIRECTION_RULES[source_module]
    else:
        result['errors'].append(
            f"Unknown source_module '{source_module}'. "
            f"Must be one of: {', '.join(_VAT_DIRECTION_RULES.keys())} or GL_J")
        conn.close()
        return result

    # Fetch VAT-bearing journal lines
    lines = conn.execute("""
        SELECT l.line_id, l.account_code, l.description,
               l.debit, l.credit, l.vat_type, l.vat_amount,
               v.is_capital_goods, v.rate_pct
        FROM gl_journal_lines l
        JOIN sys_vat_types v ON l.vat_type = v.vat_code
        WHERE l.journal_id = ?
          AND l.vat_type IS NOT NULL
          AND l.vat_amount != 0
    """, (journal_id,)).fetchall()

    if not lines:
        # No VAT lines — nothing to stamp (valid for exempt/zero-rate journals)
        conn.close()
        return result

    for line in lines:
        (line_id, acc_code, desc, dr, cr, vat_code, vat_amount,
         is_capital, rate_pct) = line

        # Exclusive amount = the non-VAT portion of this line
        excl_amount = dr if dr else cr
        incl_amount = excl_amount + abs(vat_amount)
        is_capital_bool = bool(is_capital)

        field = _vat201_field(source_module, vat_code, is_capital_bool)

        # Capital goods adjustment tracking (Section 16(3)(h))
        # Required for assets > R40,000 excl VAT — 5-year adjustment period
        cap_adj_required = 0
        cap_adj_start = None
        cap_adj_end = None
        if is_capital_bool and excl_amount > 40000:
            from dateutil.relativedelta import relativedelta
            cap_adj_required = 1
            cap_adj_start = str(journal_date)
            cap_adj_end   = str(
                date.fromisoformat(str(journal_date)) + relativedelta(years=5))

        try:
            conn.execute("""
                INSERT INTO vat_transactions
                (journal_id, line_id, source_module, vat_code,
                 vat_direction, vat_period, transaction_date,
                 tax_invoice_no, counterparty_vat_no, counterparty_name,
                 exclusive_amount, vat_amount, inclusive_amount,
                 gl_account_code, is_capital_goods,
                 capital_adj_required, capital_adj_start_date, capital_adj_end_date)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (journal_id, line_id, source_module, vat_code,
                 direction, vat_period, str(journal_date),
                 tax_invoice_no, counterparty_vat_no, counterparty_name,
                 float(excl_amount), float(abs(vat_amount)), float(incl_amount),
                 acc_code, int(is_capital_bool),
                 cap_adj_required, cap_adj_start, cap_adj_end))

            result['stamped'] += 1
            result['total_vat'] += abs(vat_amount)
            result['lines'].append({
                'line_id':    line_id,
                'vat_code':   vat_code,
                'direction':  direction,
                'field':      field,
                'excl':       float(excl_amount),
                'vat':        float(abs(vat_amount)),
                'capital':    is_capital_bool,
                'cap_adj':    bool(cap_adj_required),
            })
        except Exception as e:
            result['errors'].append(f"Line {line_id}: {e}")

    conn.commit()
    conn.close()
    return result


def post_and_stamp(journal_date: date,
                   journal_type: str,
                   description: str,
                   lines: list,
                   source_module: str,
                   source_document: str = None,
                   vat_period: str = None,
                   counterparty_code: str = None,
                   counterparty_name: str = None,
                   counterparty_vat_no: str = None,
                   tax_invoice_no: str = None,
                   posted_by: str = 'SYSTEM',
                   gl_direction_override: str = None) -> dict:
    """
    Combined post + VAT stamp in one call.
    This is the PRIMARY function to use for AR/AP/FA transactions.
    Replaces calling post_journal() + stamp_vat_transactions() separately.

    The vat_period defaults to YYYYMM of journal_date if not supplied.

    Returns combined result dict with both journal and VAT stamp details.
    """
    # Default vat_period from journal date
    if not vat_period:
        vat_period = journal_date.strftime('%Y%m')

    # Step 1: Post the journal
    jnl_result = post_journal(
        journal_date    = journal_date,
        journal_type    = journal_type,
        description     = description,
        lines           = lines,
        source_module   = source_module,
        source_document = source_document,
        posted_by       = posted_by,
        mode            = 'POST',
    )

    if jnl_result['status'] != 'POSTED':
        jnl_result['vat_stamped'] = 0
        jnl_result['vat_errors']  = ['Journal not posted — VAT stamp skipped']
        return jnl_result

    # Step 2: Stamp VAT transactions
    period_id = sqlite3.connect(DB_PATH).execute(
        "SELECT period_id FROM gl_journals WHERE journal_id=?",
        (jnl_result['journal_id'],)).fetchone()[0]

    vat_result = stamp_vat_transactions(
        journal_id            = jnl_result['journal_id'],
        journal_date          = journal_date,
        source_module         = source_module,
        period_id             = period_id,
        vat_period            = vat_period,
        counterparty_code     = counterparty_code,
        counterparty_name     = counterparty_name,
        counterparty_vat_no   = counterparty_vat_no,
        tax_invoice_no        = tax_invoice_no,
        gl_direction_override = gl_direction_override,
    )

    jnl_result['vat_stamped']     = vat_result['stamped']
    jnl_result['vat_total']       = vat_result['total_vat']
    jnl_result['vat_lines']       = vat_result['lines']
    jnl_result['vat_errors']      = vat_result['errors']
    return jnl_result


def vat201_report(vat_period: str) -> dict:
    """
    Generate VAT201 return figures for a given period.
    Returns field-by-field breakdown matching the SARS VAT201 form.

    Args:
        vat_period: YYYYMM e.g. '202602'
    """
    conn = sqlite3.connect(DB_PATH)

    row = conn.execute(
        "SELECT * FROM vw_vat201_summary WHERE vat_period=?",
        (vat_period,)).fetchone()

    if not row:
        conn.close()
        return {'error': f"No VAT transactions found for period {vat_period}"}

    cols = [d[0] for d in conn.execute(
        "SELECT * FROM vw_vat201_summary LIMIT 1").description]
    data = dict(zip(cols, row))

    # Transaction detail for audit support
    detail = conn.execute("""
        SELECT source_module, vat_code, vat_direction,
               counterparty_name, tax_invoice_no,
               exclusive_amount, vat_amount, is_capital_goods
        FROM vat_transactions
        WHERE vat_period = ?
        ORDER BY source_module, vat_direction
    """, (vat_period,)).fetchall()

    conn.close()

    return {
        'vat_period': vat_period,
        'summary':    data,
        'detail':     detail,
        'transaction_count': len(detail),
    }


def print_vat201(report: dict):
    """Print VAT201 return in SARS format."""
    if 'error' in report:
        print(f"  ❌ {report['error']}")
        return

    s = report['summary']
    print()
    print("="*70)
    print(f"  VAT201 RETURN — Period {report['vat_period']}")
    print(f"  Interland Distribution Cape (Pty) Ltd")
    print("="*70)

    # Output section
    print("\n  OUTPUT TAX (Tax charged on supplies made)")
    print("  "+"─"*60)
    fields = [
        ('field1_output_sales_excl',  '1 ', 'Standard rated supplies               (excl VAT)'),
        ('field1_output_sales_vat',   '1 ', 'Standard rated supplies               (VAT)     '),
        ('field1a_output_cn_excl',    '1A', 'Output adjustments / credit notes     (excl VAT)'),
        ('field1a_output_cn_vat',     '1A', 'Output adjustments / credit notes     (VAT)     '),
        ('field4_output_capital_excl','4 ', 'Capital goods supplied / disposals    (excl VAT)'),
        ('field4_output_capital_vat', '4 ', 'Capital goods supplied / disposals    (VAT)     '),
    ]
    total_output = 0
    for key, field, desc in fields:
        val = s.get(key) or 0
        if val:
            print(f"  Field {field}  {desc}  R {val:>14,.2f}")
        if 'vat' in key and key != 'field1_output_sales_excl':
            total_output += val or 0
    total_output += s.get('field1_output_sales_vat') or 0

    # Input section
    print("\n  INPUT TAX (Tax paid on acquisitions)")
    print("  "+"─"*60)
    input_fields = [
        ('field14_input_purchases_vat','14', 'Standard rated purchases              (VAT)'),
        ('field15_input_capital_vat',  '15', 'Capital goods purchased               (VAT)'),
        ('field16_input_imported_vat', '16', 'Imported services                     (VAT)'),
    ]
    total_input = 0
    for key, field, desc in input_fields:
        val = s.get(key) or 0
        if val:
            print(f"  Field {field}  {desc}  R {val:>14,.2f}")
        total_input += val or 0

    # Net
    net = s.get('net_vat_payable') or 0
    print()
    print("  "+"─"*60)
    print(f"  Total output VAT:                              R {total_output:>14,.2f}")
    print(f"  Total input VAT:                               R {total_input:>14,.2f}")
    print()
    if net > 0:
        print(f"  *** NET VAT PAYABLE TO SARS:                   R {net:>14,.2f} ***")
    else:
        print(f"  *** NET VAT REFUNDABLE FROM SARS:              R {abs(net):>14,.2f} ***")
    print("="*70)

    # Transaction detail
    if report['detail']:
        print(f"\n  SUPPORTING TRANSACTIONS ({report['transaction_count']} records)")
        print("  "+"─"*70)
        print(f"  {'Module':<10} {'Code':<10} {'Dir':<8} "
              f"{'Counterparty':<30} {'Excl':>12} {'VAT':>10}")
        print("  "+"─"*70)
        for d in report['detail']:
            cap = ' [CAP]' if d[7] else ''
            print(f"  {d[0]:<10} {d[1]:<10} {d[2]:<8} "
                  f"{str(d[3] or ''):<30} {d[5]:>12,.2f} {d[6]:>10,.2f}{cap}")
    print("="*70)
