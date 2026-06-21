"""
LP2.0 Customer Statement Engine
=================================
Generates debtor statements as PDF files.

Statement content:
  - Company header (Interland Distribution Cape)
  - Customer name, address, VAT number
  - Statement date and period
  - Transaction listing: invoices, credit notes, receipts
  - Aging summary: Current / 30 / 60 / 90 / 90+ days
  - Balance due
  - Banking details for payment

Output modes:
  - Single customer PDF
  - Batch: all customers with outstanding balances
  - Preview: returns data dict without generating PDF

Usage:
  from statement_engine import generate_statement, batch_statements
  generate_statement('AFR001', statement_date=date(2026,6,20))
  batch_statements(statement_date=date(2026,6,20), output_dir='/path/to/output')
"""

import sqlite3
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                 TableStyle, HRFlowable, KeepTogether)
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER

DB_PATH = 'lp2_validation.db'

# ── Company details ───────────────────────────────────────────────────────────
COMPANY = {
    'name':       'Interland Distribution Cape (Pty) Ltd',
    'reg':        'Reg No: 2003/023456/07',
    'vat':        'VAT Reg No: 4560098765',
    'addr1':      'PO Box 1234',
    'addr2':      'Honeydew, Johannesburg, 2170',
    'tel':        'Tel: 011 795 XXXX',
    'email':      'accounts@interlandsa.co.za',
    'bank_name':  'Nedbank Business Banking',
    'bank_branch': 'Honeydew',
    'bank_code':  '198765',
    'account_no': '1234 567 890',
    'acc_type':   'Cheque / Current',
    'swift':      'NEDSZAJJ',
}

# ── Colour palette ────────────────────────────────────────────────────────────
NAVY    = colors.HexColor('#1F3864')
BLUE    = colors.HexColor('#2E74B5')
LBLUE   = colors.HexColor('#DEEAF1')
ORANGE  = colors.HexColor('#C55A11')
WHITE   = colors.white
LGREY   = colors.HexColor('#F2F2F2')
DGREY   = colors.HexColor('#595959')


# ─────────────────────────────────────────────────────────────────────────────
# DATA FETCHING
# ─────────────────────────────────────────────────────────────────────────────

def get_statement_data(customer_code: str,
                       statement_date: date,
                       from_date: date = None) -> dict:
    """
    Fetch all data required for a customer statement.

    Args:
        customer_code:  Evolution customer code e.g. 'AFR001'
        statement_date: date of statement (typically month-end)
        from_date:      start of statement period (default: 90 days prior)

    Returns dict with customer, transactions, aging, totals.
    """
    conn = sqlite3.connect(DB_PATH)

    # Customer
    cust = conn.execute("""
        SELECT customer_code, customer_name, vat_number,
               contact_name, email, telephone,
               postal_addr_1, postal_addr_2, postal_addr_3, postal_code,
               credit_limit, payment_terms_days
        FROM ar_customers WHERE customer_code=? AND active=1
    """, (customer_code,)).fetchone()

    if not cust:
        conn.close()
        return {'error': f"Customer '{customer_code}' not found or inactive"}

    # All transactions up to statement_date (invoices, credit notes, receipts)
    invoices = conn.execute("""
        SELECT invoice_ref, invoice_date, due_date,
               customer_invoice_no, lp_load_number,
               subtotal_excl_vat, vat_amount, total_incl_vat,
               amount_received, balance_due, status
        FROM ar_invoices
        WHERE customer_code=?
          AND invoice_date <= ?
        ORDER BY invoice_date, invoice_ref
    """, (customer_code, str(statement_date))).fetchall()

    credit_notes = conn.execute("""
        SELECT cn_ref, cn_date, reason,
               subtotal_excl_vat, vat_amount, total_incl_vat, status
        FROM ar_credit_notes
        WHERE customer_code=?
          AND cn_date <= ?
        ORDER BY cn_date
    """, (customer_code, str(statement_date))).fetchall()

    receipts = conn.execute("""
        SELECT r.receipt_ref, r.receipt_date, r.amount,
               GROUP_CONCAT(a.invoice_id) as applied_invoices
        FROM ar_receipts r
        LEFT JOIN ar_receipt_allocations a ON r.receipt_id = a.receipt_id
        WHERE r.customer_code=?
          AND r.receipt_date <= ?
        GROUP BY r.receipt_id
        ORDER BY r.receipt_date
    """, (customer_code, str(statement_date))).fetchall()

    # Aging buckets for outstanding invoices
    aging = conn.execute("""
        SELECT aging_bucket,
               COUNT(*) as inv_count,
               SUM(balance_due) as bucket_total
        FROM vw_debtor_aging
        WHERE customer_code=?
        GROUP BY aging_bucket
        ORDER BY CASE aging_bucket
            WHEN 'Current'    THEN 1
            WHEN '1-30 Days'  THEN 2
            WHEN '31-60 Days' THEN 3
            WHEN '61-90 Days' THEN 4
            WHEN '90+ Days'   THEN 5
        END
    """, (customer_code,)).fetchall()

    conn.close()

    # Totals
    total_invoiced  = sum(r[7] for r in invoices)
    total_received  = sum(r[8] for r in invoices)
    total_cn        = sum(r[5] for r in credit_notes)
    balance_due     = sum(r[9] for r in invoices if r[9] > 0)
    aging_dict      = {r[0]: r[2] for r in aging}

    return {
        'customer_code':   cust[0],
        'customer_name':   cust[1],
        'vat_number':      cust[2],
        'contact_name':    cust[3],
        'email':           cust[4],
        'telephone':       cust[5],
        'address':         [x for x in [cust[6],cust[7],cust[8],cust[9]] if x],
        'credit_limit':    cust[10],
        'payment_terms':   cust[11],
        'statement_date':  str(statement_date),
        'invoices':        invoices,
        'credit_notes':    credit_notes,
        'receipts':        receipts,
        'aging':           aging_dict,
        'total_invoiced':  total_invoiced,
        'total_received':  total_received,
        'total_cn':        total_cn,
        'balance_due':     balance_due,
    }


# ─────────────────────────────────────────────────────────────────────────────
# PDF GENERATION
# ─────────────────────────────────────────────────────────────────────────────

def _styles():
    """Return custom paragraph styles."""
    base = getSampleStyleSheet()
    return {
        'co_name': ParagraphStyle('CoName', parent=base['Normal'],
                    fontSize=14, fontName='Helvetica-Bold',
                    textColor=NAVY, spaceAfter=2),
        'co_detail': ParagraphStyle('CoDetail', parent=base['Normal'],
                    fontSize=8, fontName='Helvetica',
                    textColor=DGREY, leading=11),
        'heading':  ParagraphStyle('Heading', parent=base['Normal'],
                    fontSize=18, fontName='Helvetica-Bold',
                    textColor=NAVY, spaceAfter=4),
        'label':    ParagraphStyle('Label', parent=base['Normal'],
                    fontSize=8, fontName='Helvetica-Bold',
                    textColor=DGREY),
        'value':    ParagraphStyle('Value', parent=base['Normal'],
                    fontSize=9, fontName='Helvetica',
                    textColor=colors.black),
        'small':    ParagraphStyle('Small', parent=base['Normal'],
                    fontSize=7.5, fontName='Helvetica',
                    textColor=DGREY),
        'bold_sm':  ParagraphStyle('BoldSm', parent=base['Normal'],
                    fontSize=8, fontName='Helvetica-Bold'),
        'footer':   ParagraphStyle('Footer', parent=base['Normal'],
                    fontSize=7, fontName='Helvetica',
                    textColor=DGREY, alignment=TA_CENTER),
        'balance':  ParagraphStyle('Balance', parent=base['Normal'],
                    fontSize=11, fontName='Helvetica-Bold',
                    textColor=NAVY, alignment=TA_RIGHT),
    }


def generate_statement(customer_code: str,
                       statement_date: date = None,
                       output_path: str = None,
                       preview_only: bool = False) -> dict:
    """
    Generate a customer statement PDF.

    Args:
        customer_code: Evolution customer code e.g. 'AFR001'
        statement_date: date of statement (default: today)
        output_path:   file path for PDF (default: auto-named)
        preview_only:  return data dict without generating PDF

    Returns dict with status, output_path, data.
    """
    if not statement_date:
        statement_date = date.today()

    data = get_statement_data(customer_code, statement_date)

    if 'error' in data:
        return {'status': 'FAILED', 'error': data['error']}

    if preview_only:
        return {'status': 'PREVIEW', 'data': data}

    if not output_path:
        safe_name = customer_code.replace('/', '_')
        output_path = (f'/mnt/user-data/outputs/'
                       f'Statement_{safe_name}_'
                       f'{str(statement_date).replace("-","")}.pdf')

    st = _styles()
    W, H = A4
    doc = SimpleDocTemplate(
        output_path, pagesize=A4,
        leftMargin=15*mm, rightMargin=15*mm,
        topMargin=12*mm, bottomMargin=15*mm,
    )

    story = []

    # ── HEADER: company left, STATEMENT right ─────────────────────────────────
    header_data = [[
        # Left: company details
        [Paragraph(COMPANY['name'], st['co_name']),
         Paragraph(COMPANY['reg'], st['co_detail']),
         Paragraph(COMPANY['vat'], st['co_detail']),
         Paragraph(COMPANY['addr1'], st['co_detail']),
         Paragraph(COMPANY['addr2'], st['co_detail']),
         Paragraph(f"{COMPANY['tel']}  |  {COMPANY['email']}", st['co_detail']),
        ],
        # Right: STATEMENT heading + date
        [Paragraph('STATEMENT', st['heading']),
         Spacer(1, 3*mm),
         Paragraph(f"Statement Date:", st['label']),
         Paragraph(statement_date.strftime('%d %B %Y'), st['value']),
         Spacer(1, 2*mm),
         Paragraph(f"Account:", st['label']),
         Paragraph(data['customer_code'], st['value']),
        ],
    ]]
    header_tbl = Table(header_data, colWidths=[100*mm, 75*mm])
    header_tbl.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('ALIGN',  (1,0), (1,0), 'RIGHT'),
    ]))
    story.append(header_tbl)
    story.append(HRFlowable(width='100%', thickness=2, color=NAVY,
                             spaceAfter=4*mm))

    # ── CUSTOMER DETAILS ──────────────────────────────────────────────────────
    addr_lines = '\n'.join(data['address']) if data['address'] else ''
    cust_info = [
        [Paragraph('TO:', st['label']),
         Paragraph(f"Payment Terms:", st['label']),
         Paragraph(f"VAT Number:", st['label']),
        ],
        [Paragraph(f"<b>{data['customer_name']}</b>", st['value']),
         Paragraph(f"{data['payment_terms']} days", st['value']),
         Paragraph(data['vat_number'] or '—', st['value']),
        ],
        [Paragraph(addr_lines.replace('\n','<br/>'), st['small']),
         Paragraph(''),
         Paragraph(''),
        ],
    ]
    cust_tbl = Table(cust_info, colWidths=[90*mm, 55*mm, 30*mm])
    cust_tbl.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BACKGROUND', (0,0), (-1,0), LGREY),
        ('TOPPADDING', (0,0), (-1,-1), 2),
        ('BOTTOMPADDING', (0,0), (-1,-1), 2),
    ]))
    story.append(cust_tbl)
    story.append(Spacer(1, 5*mm))

    # ── TRANSACTION TABLE ─────────────────────────────────────────────────────
    col_hdr = ['Date', 'Reference', 'Load / Description',
               'Invoiced', 'Received', 'Balance']
    col_w   = [20*mm, 38*mm, 55*mm, 25*mm, 25*mm, 25*mm]

    tx_data = [col_hdr]

    # Invoices
    for inv in data['invoices']:
        (ref, inv_date, due_date, cust_inv_no, load_no,
         excl, vat, total, received, balance, status) = inv

        desc = load_no or cust_inv_no or '—'
        if status == 'PAID':
            bal_str = '—'
        else:
            bal_str = f"R {balance:,.2f}"

        row = [
            inv_date,
            ref,
            f"Invoice — {desc}",
            f"R {total:,.2f}",
            f"R {received:,.2f}" if received else '—',
            bal_str,
        ]
        tx_data.append(row)

    # Credit notes
    for cn in data['credit_notes']:
        (ref, cn_date, reason, excl, vat, total, status) = cn
        tx_data.append([
            cn_date, ref,
            f"Credit Note — {reason or ''}",
            f"(R {total:,.2f})", '—', '—'
        ])

    # Receipts
    for rec in data['receipts']:
        (ref, rec_date, amount, applied) = rec
        tx_data.append([
            rec_date, ref,
            'Payment received — thank you',
            '—', f"R {amount:,.2f}", '—'
        ])

    # Build stripe colours
    tx_style = [
        # Header
        ('BACKGROUND',  (0,0), (-1,0), NAVY),
        ('TEXTCOLOR',   (0,0), (-1,0), WHITE),
        ('FONTNAME',    (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE',    (0,0), (-1,-1), 8),
        ('FONTNAME',    (0,1), (-1,-1), 'Helvetica'),
        ('ALIGN',       (3,0), (-1,-1), 'RIGHT'),
        ('ALIGN',       (0,0), (2,-1), 'LEFT'),
        ('VALIGN',      (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING',  (0,0), (-1,-1), 3),
        ('BOTTOMPADDING',(0,0),(-1,-1), 3),
        ('GRID',        (0,0), (-1,-1), 0.25, colors.HexColor('#BFBFBF')),
    ]
    for i in range(1, len(tx_data)):
        if i % 2 == 0:
            tx_style.append(('BACKGROUND', (0,i), (-1,i), LGREY))

    tx_tbl = Table(tx_data, colWidths=col_w, repeatRows=1)
    tx_tbl.setStyle(TableStyle(tx_style))
    story.append(tx_tbl)
    story.append(Spacer(1, 6*mm))

    # ── AGING SUMMARY + BALANCE ───────────────────────────────────────────────
    buckets  = ['Current','1-30 Days','31-60 Days','61-90 Days','90+ Days']
    age_vals = [data['aging'].get(b, 0) for b in buckets]

    aging_hdr  = [Paragraph(b, st['bold_sm']) for b in buckets]
    aging_vals = [Paragraph(f"R {v:,.2f}" if v else '—', st['small'])
                  for v in age_vals]

    aging_data = [aging_hdr, aging_vals]
    aging_tbl = Table(aging_data, colWidths=[35*mm]*5)
    aging_tbl.setStyle(TableStyle([
        ('BACKGROUND',   (0,0), (-1,0), BLUE),
        ('TEXTCOLOR',    (0,0), (-1,0), WHITE),
        ('FONTSIZE',     (0,0), (-1,-1), 8),
        ('ALIGN',        (0,0), (-1,-1), 'CENTER'),
        ('GRID',         (0,0), (-1,-1), 0.25, WHITE),
        ('TOPPADDING',   (0,0), (-1,-1), 3),
        ('BOTTOMPADDING',(0,0), (-1,-1), 3),
        # Highlight overdue
        ('BACKGROUND',   (2,1), (-1,1),
         colors.HexColor('#FCE4D6') if any(age_vals[2:]) else LGREY),
    ]))

    balance_tbl = Table([
        [Paragraph('AMOUNT DUE:', st['label']),
         Paragraph(f"R {data['balance_due']:,.2f}", st['balance'])],
    ], colWidths=[100*mm, 75*mm])
    balance_tbl.setStyle(TableStyle([
        ('ALIGN',  (1,0), (1,0), 'RIGHT'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 4),
    ]))

    story.append(KeepTogether([
        Paragraph('AGING ANALYSIS', st['bold_sm']),
        Spacer(1, 2*mm),
        aging_tbl,
        Spacer(1, 4*mm),
        HRFlowable(width='100%', thickness=1.5, color=NAVY),
        Spacer(1, 2*mm),
        balance_tbl,
    ]))

    story.append(Spacer(1, 6*mm))

    # ── BANKING DETAILS ───────────────────────────────────────────────────────
    bank_data = [
        [Paragraph('BANKING DETAILS', st['bold_sm']), ''],
        [Paragraph('Bank:', st['label']),
         Paragraph(COMPANY['bank_name'], st['value'])],
        [Paragraph('Branch:', st['label']),
         Paragraph(f"{COMPANY['bank_branch']}  ({COMPANY['bank_code']})", st['value'])],
        [Paragraph('Account No:', st['label']),
         Paragraph(COMPANY['account_no'], st['value'])],
        [Paragraph('Account Type:', st['label']),
         Paragraph(COMPANY['acc_type'], st['value'])],
        [Paragraph('Reference:', st['label']),
         Paragraph(f"Your account code: {data['customer_code']}", st['value'])],
    ]
    bank_tbl = Table(bank_data, colWidths=[28*mm, 80*mm])
    bank_tbl.setStyle(TableStyle([
        ('BACKGROUND',  (0,0), (-1,0), LGREY),
        ('SPAN',        (0,0), (1,0)),
        ('FONTSIZE',    (0,0), (-1,-1), 8),
        ('TOPPADDING',  (0,0), (-1,-1), 2),
        ('BOTTOMPADDING',(0,0),(-1,-1), 2),
        ('VALIGN',      (0,0), (-1,-1), 'MIDDLE'),
        ('BOX',         (0,0), (-1,-1), 0.5, BLUE),
        ('INNERGRID',   (0,0), (-1,-1), 0.25, colors.HexColor('#BFBFBF')),
    ]))

    story.append(KeepTogether([
        bank_tbl,
        Spacer(1, 5*mm),
        Paragraph(
            'Queries: Please contact our accounts department on '
            f"{COMPANY['tel']} or email {COMPANY['email']}",
            st['footer']),
        Paragraph(
            'This statement is computer generated. '
            'E&OE — Errors and omissions excepted.',
            st['footer']),
    ]))

    doc.build(story)

    return {
        'status':        'GENERATED',
        'output_path':   output_path,
        'customer_code': customer_code,
        'customer_name': data['customer_name'],
        'statement_date': str(statement_date),
        'balance_due':   data['balance_due'],
        'invoice_count': len(data['invoices']),
    }


def batch_statements(statement_date: date = None,
                     output_dir: str = '/mnt/user-data/outputs/',
                     outstanding_only: bool = True) -> list:
    """
    Generate statements for all customers with outstanding balances.

    Args:
        statement_date:   date of statements (default: today)
        output_dir:       directory for PDF output
        outstanding_only: only generate for customers with balance > 0

    Returns list of result dicts, one per customer.
    """
    if not statement_date:
        statement_date = date.today()

    conn = sqlite3.connect(DB_PATH)

    if outstanding_only:
        customers = conn.execute("""
            SELECT DISTINCT customer_code
            FROM vw_debtor_aging
            ORDER BY customer_code
        """).fetchall()
    else:
        customers = conn.execute("""
            SELECT customer_code FROM ar_customers
            WHERE active=1 ORDER BY customer_code
        """).fetchall()

    conn.close()

    results = []
    for (code,) in customers:
        import os
        safe = code.replace('/', '_')
        path = os.path.join(output_dir,
               f"Statement_{safe}_{str(statement_date).replace('-','')}.pdf")
        result = generate_statement(code, statement_date, path)
        results.append(result)
        status = result.get('status','?')
        bal    = result.get('balance_due', 0)
        print(f"  {'✅' if status=='GENERATED' else '❌'} "
              f"{code:<12} {result.get('customer_name','?')[:35]:<35} "
              f"Balance: R {bal:>12,.2f}")

    return results
