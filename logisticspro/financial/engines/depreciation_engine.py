"""
LP2.0 Depreciation Run Engine
==============================
Calculates monthly depreciation for all active assets.
Produces both:
  - IFRS book depreciation (IAS 16 straight-line)
  - SARS tax depreciation (wear & tear per asset class)

Company policy — depreciation start date:
  Purchased on or before 10th of month → depreciation from 1st of that month
  Purchased after the 10th             → depreciation from 1st of next month
  Applies to both IFRS and SARS calculations.

Confirmation workflow:
  1. preview_start_dates()        — review calculated start dates per asset
  2. confirm_and_apply_start_dates() — commit dates (with optional overrides)
  3. run_depreciation(mode=PREVIEW) — review the run before posting
  4. run_depreciation(mode=POST)    — commit to DB and generate GL journal
"""

import sqlite3
from datetime import date
from dateutil.relativedelta import relativedelta
from decimal import Decimal, ROUND_HALF_UP

DB_PATH = 'lp2_validation.db'
DEFERRED_TAX_RATE = Decimal('0.27')


# ─────────────────────────────────────────────────────────────────────────────
# POLICY: DEPRECIATION START DATE
# ─────────────────────────────────────────────────────────────────────────────

def calc_depre_start_date(purchase_date: date) -> tuple:
    """
    Company policy:
      Purchased on or before 10th → 1st of purchase month
      Purchased after 10th        → 1st of following month

    Validated against Evolution PDF data:
      MH187 purchased 31/08/2024 → Sep 2024 start
      18 months × R43,006.34 = R774,114 matches PDF exactly.

    Returns: (depre_start_date, rule_description)
    """
    if purchase_date.day <= 10:
        start = purchase_date.replace(day=1)
        rule  = f"<=10th: starts 1 {start.strftime('%b %Y')}"
    else:
        start = purchase_date.replace(day=1) + relativedelta(months=1)
        rule  = f">10th: starts 1 {start.strftime('%b %Y')}"
    return start, rule


# ─────────────────────────────────────────────────────────────────────────────
# CALCULATION FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────

def calc_ifrs_monthly(cost: Decimal, useful_life_years: int) -> Decimal:
    """IAS 16 straight-line. Monthly = cost / (life_years × 12)."""
    return (cost / Decimal(useful_life_years * 12)).quantize(
        Decimal('0.01'), rounding=ROUND_HALF_UP)


def calc_sars_monthly(cost: Decimal, wt_rate_pct: Decimal) -> Decimal:
    """
    SARS W&T straight-line monthly.
    Annual = cost × rate / 100. Monthly = annual / 12.
    Section 12B solar: 100% rate = full cost over 12 months.
    """
    annual = (cost * wt_rate_pct / Decimal('100')).quantize(
        Decimal('0.01'), rounding=ROUND_HALF_UP)
    return (annual / Decimal('12')).quantize(
        Decimal('0.01'), rounding=ROUND_HALF_UP)


def months_active(depre_start: date, run_date: date) -> int:
    """
    Whole months from depre_start up to and including run_date month.
    Used to verify accumulated depreciation, not for monthly charge.
    """
    delta = relativedelta(run_date, depre_start)
    return delta.years * 12 + delta.months + 1


# ─────────────────────────────────────────────────────────────────────────────
# STEP 1: PREVIEW START DATES — confirm before any run
# ─────────────────────────────────────────────────────────────────────────────

def preview_start_dates(asset_codes: list = None,
                        asset_class: str = None) -> list:
    """
    Shows calculated depreciation start dates for review BEFORE any run.
    Flags assets where stored start date differs from policy calculation.

    Args:
        asset_codes:  specific codes to check e.g. ['MH195', 'BT29']
        asset_class:  filter by class e.g. 'FH'

    Returns:
        list of dicts — one per asset — for review and confirmation.
    """
    conn = sqlite3.connect(DB_PATH)

    sql = """
        SELECT a.asset_id, a.asset_code, a.description, a.class_code,
               a.purchase_date, a.depre_start_date, a.purchase_price,
               c.class_name, c.sars_wt_rate_pct, c.ifrs_useful_life_yr,
               a.location
        FROM fa_assets a
        JOIN fa_asset_classes c ON a.class_code = c.class_code
        WHERE a.is_active = 1 AND a.disposal_date IS NULL
    """
    params = []
    if asset_class:
        sql += " AND a.class_code = ?"
        params.append(asset_class)
    if asset_codes:
        placeholders = ','.join('?' * len(asset_codes))
        sql += f" AND a.asset_code IN ({placeholders})"
        params.extend(asset_codes)
    sql += " ORDER BY a.class_code, a.asset_code"

    assets = conn.execute(sql, params).fetchall()
    conn.close()

    preview = []
    for a in assets:
        (asset_id, code, desc, cls, pdate_str, stored_start, price,
         class_name, sars_rate, ifrs_life, location) = a

        pdate       = date.fromisoformat(pdate_str)
        policy_start, rule = calc_depre_start_date(pdate)
        cost        = Decimal(str(price))

        monthly_book = calc_ifrs_monthly(cost, ifrs_life)
        monthly_tax  = calc_sars_monthly(cost, Decimal(str(sars_rate)))

        stored = date.fromisoformat(stored_start) if stored_start else None
        mismatch = stored is not None and stored != policy_start

        preview.append({
            'asset_id':       asset_id,
            'asset_code':     code,
            'description':    desc,
            'class_code':     cls,
            'class_name':     class_name,
            'location':       location or '',
            'purchase_date':  str(pdate),
            'purchase_day':   pdate.day,
            'policy_start':   str(policy_start),
            'stored_start':   str(stored) if stored else 'NOT SET',
            'start_mismatch': mismatch,
            'rule_applied':   rule,
            'monthly_book':   float(monthly_book),
            'monthly_tax':    float(monthly_tax),
            'sars_rate_pct':  float(sars_rate),
            'ifrs_life_yr':   ifrs_life,
        })

    return preview


def print_start_date_preview(preview: list):
    """Print the start date preview in a readable format for confirmation."""
    print()
    print("="*90)
    print("  DEPRECIATION START DATE PREVIEW — CONFIRM BEFORE RUNNING")
    print("="*90)
    print(f"  Policy: purchased <=10th → 1st of purchase month")
    print(f"          purchased  >10th → 1st of following month")
    print()

    cur_class = None
    mismatches = []
    not_set = []

    print(f"  {'Asset':<15} {'Day':>4} {'Purchase Date':<13} "
          f"{'Policy Start':<13} {'Stored Start':<13} {'Status':<10} "
          f"{'Bk/mo (R)':>12} {'Tx/mo (R)':>12}")
    print("  "+"─"*92)

    for item in preview:
        if item['class_code'] != cur_class:
            cur_class = item['class_code']
            print(f"  ▸  {item['class_name'].upper()}")

        if item['stored_start'] == 'NOT SET':
            status = '⚠ NOT SET'
            not_set.append(item['asset_code'])
        elif item['start_mismatch']:
            status = '≠ MISMATCH'
            mismatches.append(item['asset_code'])
        else:
            status = '✅ OK'

        print(f"  {item['asset_code']:<15} {item['purchase_day']:>4}  "
              f"{item['purchase_date']:<13} {item['policy_start']:<13} "
              f"{item['stored_start']:<13} {status:<10} "
              f"{item['monthly_book']:>12,.2f} {item['monthly_tax']:>12,.2f}")

    print()
    print(f"  Total assets reviewed: {len(preview)}")
    if not_set:
        print(f"  ⚠  Start date NOT SET ({len(not_set)}): "
              f"{', '.join(not_set[:5])}{'...' if len(not_set)>5 else ''}")
        print(f"     → Run confirm_and_apply_start_dates() to set them")
    if mismatches:
        print(f"  ≠  Stored date differs from policy ({len(mismatches)}): "
              f"{', '.join(mismatches[:5])}{'...' if len(mismatches)>5 else ''}")
        print(f"     → Review and pass overrides dict if different start intended")
    if not not_set and not mismatches:
        print(f"  ✅ All start dates confirmed — safe to run depreciation")
    print("="*90)
    return {'not_set': not_set, 'mismatches': mismatches}


# ─────────────────────────────────────────────────────────────────────────────
# STEP 2: CONFIRM AND APPLY START DATES
# ─────────────────────────────────────────────────────────────────────────────

def confirm_and_apply_start_dates(preview: list,
                                  overrides: dict = None,
                                  confirmed_by: str = 'SYSTEM') -> dict:
    """
    Applies policy-calculated start dates to fa_assets.depre_start_date.
    Call after reviewing preview_start_dates() output.

    Args:
        preview:       list from preview_start_dates()
        overrides:     {'asset_code': 'YYYY-MM-DD'} for manual exceptions
                       e.g. {'MH195': '2025-06-01'} if purchased 30 Jun
                       but you want to start Jun rather than Jul
        confirmed_by:  name/user for audit trail

    Returns:
        summary dict
    """
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")

    applied = overridden = 0

    for item in preview:
        code = item['asset_code']

        if overrides and code in overrides:
            start_date = overrides[code]
            source = 'MANUAL_OVERRIDE'
            overridden += 1
        else:
            start_date = item['policy_start']
            source = 'POLICY'
            applied += 1

        conn.execute(
            "UPDATE fa_assets SET depre_start_date=? WHERE asset_id=?",
            (start_date, item['asset_id']))

        conn.execute("""
            INSERT INTO gl_audit_log
            (table_name, record_id, action, changed_by, new_values)
            VALUES ('fa_assets', ?, 'SET_DEPRE_START', ?, ?)""",
            (item['asset_id'], confirmed_by,
             f"code={code} start={start_date} source={source}"))

    conn.commit()
    conn.close()

    total = applied + overridden
    result = {
        'total': total, 'policy_applied': applied,
        'overridden': overridden,
        'message': (f"Start dates set for {total} assets. "
                    f"{applied} by policy, {overridden} manual overrides."),
    }
    print(f"  ✅ {result['message']}")
    return result


# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 & 4: DEPRECIATION RUN
# ─────────────────────────────────────────────────────────────────────────────

def run_depreciation(period_id: int, run_date: date,
                     mode: str = 'PREVIEW',
                     asset_class_filter: str = None,
                     asset_code_filter: str = None,
                     posted_by: str = 'SYSTEM') -> dict:
    """
    Main depreciation run. Requires start dates to be set first.

    Args:
        period_id:           sys_periods.period_id
        run_date:            date of run (typically period end date)
        mode:                PREVIEW / POST / REVERSE
        asset_class_filter:  e.g. 'FH' for fleet horses only
        asset_code_filter:   e.g. 'MH195' for single asset
        posted_by:           user name for audit trail
    """
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")

    results = {
        'mode': mode, 'period_id': period_id,
        'run_date': str(run_date),
        'assets_processed': 0, 'assets_skipped': 0,
        'assets_fully_depreciated': 0, 'assets_start_not_set': 0,
        'total_book_depre': Decimal('0'),
        'total_tax_depre':  Decimal('0'),
        'total_timing_diff': Decimal('0'),
        'total_deferred_tax': Decimal('0'),
        'lines': [], 'journal_lines': [],
        'errors': [], 'warnings': [],
    }

    # Validate period
    period = conn.execute("""
        SELECT p.period_id, p.period_name, p.period_start, p.period_end,
               p.is_closed, f.fy_code
        FROM sys_periods p JOIN sys_financial_years f ON p.fy_id=f.fy_id
        WHERE p.period_id=?""", (period_id,)).fetchone()

    if not period:
        results['errors'].append(f"Period {period_id} not found")
        return results
    if period[4] == 1 and mode == 'POST':
        results['errors'].append(f"Period {period[1]} is closed")
        return results

    period_name = period[1]
    period_end  = date.fromisoformat(period[3])

    # Block double-post
    if mode == 'POST':
        existing = conn.execute(
            "SELECT COUNT(*) FROM fa_depreciation_runs WHERE period_id=?",
            (period_id,)).fetchone()[0]
        if existing > 0:
            results['errors'].append(
                f"Depreciation already posted for {period_name}. "
                f"Use REVERSE first.")
            return results

    # Fetch active assets
    sql = """
        SELECT a.asset_id, a.asset_code, a.description, a.class_code,
               a.purchase_date, a.depre_start_date, a.purchase_price,
               a.tax_value, a.book_nbv, a.fully_depreciated, a.location,
               c.class_name, c.sars_wt_rate_pct, c.ifrs_useful_life_yr,
               c.gl_depre_account, c.gl_accum_account
        FROM fa_assets a
        JOIN fa_asset_classes c ON a.class_code=c.class_code
        WHERE a.is_active=1 AND a.disposal_date IS NULL
    """
    params = []
    if asset_class_filter:
        sql += " AND a.class_code=?"; params.append(asset_class_filter)
    if asset_code_filter:
        sql += " AND a.asset_code=?"; params.append(asset_code_filter)
    sql += " ORDER BY a.class_code, a.asset_code"

    assets = conn.execute(sql, params).fetchall()
    journal_summary = {}

    for asset in assets:
        (asset_id, asset_code, description, class_code,
         purchase_date_str, depre_start_str, purchase_price,
         tax_value, book_nbv, fully_depreciated, location,
         class_name, sars_rate_pct, ifrs_life_yr,
         gl_depre_acc, gl_accum_acc) = asset

        purchase_date = date.fromisoformat(purchase_date_str)
        cost          = Decimal(str(purchase_price))
        cur_tax_val   = Decimal(str(tax_value))
        cur_book_nbv  = Decimal(str(book_nbv))

        # Start date must be confirmed before running
        if not depre_start_str:
            results['assets_start_not_set'] += 1
            results['warnings'].append(
                f"{asset_code}: depre_start_date not set — "
                f"run preview_start_dates() and confirm_and_apply_start_dates() first")
            continue

        depre_start = date.fromisoformat(depre_start_str)

        # Asset not yet active
        if depre_start > run_date:
            results['assets_skipped'] += 1
            results['warnings'].append(
                f"{asset_code}: depreciation starts {depre_start} "
                f"after run date {run_date} — skipped")
            continue

        # Both depreciation streams exhausted
        if fully_depreciated and cur_book_nbv <= 0 and cur_tax_val <= 0:
            results['assets_fully_depreciated'] += 1
            continue

        # Monthly charges
        monthly_book = calc_ifrs_monthly(cost, ifrs_life_yr)
        monthly_tax  = calc_sars_monthly(cost, Decimal(str(sars_rate_pct)))

        # Cap at remaining value
        book_charge = min(monthly_book, cur_book_nbv)
        tax_charge  = min(monthly_tax, cur_tax_val)

        new_book_nbv  = (cur_book_nbv - book_charge).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP)
        new_tax_value = (cur_tax_val - tax_charge).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP)

        timing_diff  = (new_book_nbv - new_tax_value).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP)
        deferred_tax = (timing_diff * DEFERRED_TAX_RATE).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP)

        lp_aligned = class_code in ('FH', 'FT')

        line = {
            'asset_id':     asset_id,
            'asset_code':   asset_code,
            'description':  description,
            'class_code':   class_code,
            'class_name':   class_name,
            'location':     location or '',
            'lp_aligned':   lp_aligned,
            'purchase_date': str(purchase_date),
            'depre_start':  str(depre_start),
            'cost':         float(cost),
            'book_charge':  float(book_charge),
            'tax_charge':   float(tax_charge),
            'new_book_nbv': float(new_book_nbv),
            'new_tax_value':float(new_tax_value),
            'timing_diff':  float(timing_diff),
            'deferred_tax': float(deferred_tax),
            'gl_depre_acc': gl_depre_acc,
            'gl_accum_acc': gl_accum_acc,
        }
        results['lines'].append(line)

        results['total_book_depre']  += book_charge
        results['total_tax_depre']   += tax_charge
        results['total_timing_diff'] += timing_diff
        results['total_deferred_tax'] += deferred_tax
        results['assets_processed']  += 1

        key = (gl_depre_acc, gl_accum_acc, class_code)
        if key not in journal_summary:
            journal_summary[key] = {'book': Decimal('0'), 'count': 0}
        journal_summary[key]['book'] += book_charge
        journal_summary[key]['count'] += 1

        if mode == 'POST':
            conn.execute("""
                INSERT OR IGNORE INTO fa_depreciation_runs
                (asset_id, period_id, run_date,
                 book_depre_amount, tax_depre_amount,
                 book_nbv_after, tax_value_after,
                 timing_difference, deferred_tax)
                VALUES (?,?,?,?,?,?,?,?,?)""",
                (asset_id, period_id, str(run_date),
                 float(book_charge), float(tax_charge),
                 float(new_book_nbv), float(new_tax_value),
                 float(timing_diff), float(deferred_tax)))

            conn.execute("""
                UPDATE fa_assets SET
                    book_depre_curr_yr = book_depre_curr_yr + ?,
                    book_depre_period  = ?,
                    book_nbv           = ?,
                    tax_depre_curr_yr  = tax_depre_curr_yr + ?,
                    tax_depre_period   = ?,
                    tax_value          = ?,
                    fully_depreciated  = CASE
                        WHEN ? <= 0 AND ? <= 0 THEN 1 ELSE 0 END
                WHERE asset_id=?""",
                (float(book_charge), float(book_charge), float(new_book_nbv),
                 float(tax_charge),  float(tax_charge),  float(new_tax_value),
                 float(new_book_nbv), float(new_tax_value), asset_id))

    # Build journal lines
    jnl_lines = []
    line_num = 1
    for (depre_acc, accum_acc, cls), totals in sorted(journal_summary.items()):
        amt = float(totals['book'].quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP))
        label = 'Fleet' if cls in ('FH', 'FT') else cls
        jnl_lines.append({
            'line_number':  line_num,
            'account_code': depre_acc,
            'description':  f'Depreciation {label} — {period_name}',
            'debit': amt, 'credit': 0, 'assets': totals['count'],
        })
        line_num += 1
        jnl_lines.append({
            'line_number':  line_num,
            'account_code': accum_acc,
            'description':  f'Accum Depre {label} — {period_name}',
            'debit': 0, 'credit': amt, 'assets': totals['count'],
        })
        line_num += 1

    results['journal_lines'] = jnl_lines
    total_dr = sum(l['debit'] for l in jnl_lines)
    total_cr = sum(l['credit'] for l in jnl_lines)
    results['journal_balanced'] = abs(total_dr - total_cr) < 0.01
    results['journal_total']    = total_dr

    if mode == 'POST':
        conn.execute("""
            INSERT INTO gl_audit_log
            (table_name, record_id, action, changed_by, new_values)
            VALUES ('fa_depreciation_runs', ?, 'DEPRECIATION_RUN', ?, ?)""",
            (period_id, posted_by,
             f'period={period_name}, assets={results["assets_processed"]}, '
             f'book_total={float(results["total_book_depre"]):.2f}'))
        conn.commit()

    conn.close()

    # Convert Decimals to float
    for key in ('total_book_depre','total_tax_depre',
                'total_timing_diff','total_deferred_tax'):
        results[key] = float(results[key])

    return results


def print_run_report(results: dict, detail: bool = True):
    """Print formatted depreciation run report."""
    print()
    print("="*85)
    print(f"  DEPRECIATION RUN — {results['run_date']}  [{results['mode']}]")
    print("="*85)
    print(f"  Period:               {results['period_id']}")
    print(f"  Assets processed:     {results['assets_processed']}")
    print(f"  Start date not set:   {results['assets_start_not_set']}")
    print(f"  Skipped (future):     {results['assets_skipped']}")
    print(f"  Fully depreciated:    {results['assets_fully_depreciated']}")
    print()
    print(f"  BOOK (IFRS IAS 16):   R {results['total_book_depre']:>15,.2f}")
    print(f"  TAX  (SARS W&T):      R {results['total_tax_depre']:>15,.2f}")
    print(f"  Timing difference:    R {results['total_timing_diff']:>15,.2f}")
    print(f"  Deferred tax @27%:    R {results['total_deferred_tax']:>15,.2f}")

    for w in results.get('warnings', []):
        print(f"  ⚠  {w}")
    for e in results.get('errors', []):
        print(f"  ❌ {e}")

    if results['errors']: return

    if detail and results['lines']:
        print()
        print("─"*85)
        print(f"  {'Asset':<15} {'Cls':<5} {'Loc':<4} {'Strt':<4} {'LP':>3}  "
              f"{'Book Depre':>11} {'Tax Depre':>11} "
              f"{'Book NBV':>14} {'Tax Value':>13} {'Timing Diff':>12}")
        print("  "+"─"*82)
        cur_class = None
        for ln in sorted(results['lines'],
                          key=lambda x: (x['class_code'], x['asset_code'])):
            if ln['class_code'] != cur_class:
                cur_class = ln['class_code']
                print(f"  ▸  {ln['class_name'].upper()}")
            pday = int(ln['purchase_date'][8:10])
            strt = ln['depre_start'][5:7]+'/'+ln['depre_start'][2:4]
            lp   = '✓' if ln['lp_aligned'] else ' '
            print(f"  {ln['asset_code']:<15} {ln['class_code']:<5} "
                  f"{ln['location']:<4} {strt:<4} {lp:>3}  "
                  f"{ln['book_charge']:>11,.2f} {ln['tax_charge']:>11,.2f} "
                  f"{ln['new_book_nbv']:>14,.2f} {ln['new_tax_value']:>13,.2f} "
                  f"{ln['timing_diff']:>12,.2f}")

    print()
    print("─"*85)
    print("  GL JOURNAL")
    print(f"  {'#':<4} {'Account':<12} {'Description':<38} {'Debit':>14} {'Credit':>14}")
    print("  "+"─"*82)
    for jl in results['journal_lines']:
        dr = f"R {jl['debit']:>11,.2f}" if jl['debit'] else ''
        cr = f"R {jl['credit']:>11,.2f}" if jl['credit'] else ''
        print(f"  {jl['line_number']:<4} {jl['account_code']:<12} "
              f"{jl['description']:<38} {dr:>14} {cr:>14}")
    balanced = results.get('journal_balanced', False)
    print(f"\n  {'✅ BALANCED' if balanced else '❌ OUT OF BALANCE'}"
          f"  Total: R {results.get('journal_total', 0):,.2f}")
    print("="*85)
