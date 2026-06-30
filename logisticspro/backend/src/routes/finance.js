/**
 * LP2.0 — Financial Module API
 * ==============================
 * Routes:
 *   GET  /fin/accounts              Chart of Accounts
 *   POST /fin/accounts              Create GL account
 *   GET  /fin/accounts/:code        Single account detail
 *   GET  /fin/periods               All periods with status
 *   GET  /fin/periods/status        Period status dashboard
 *   PATCH /fin/periods/:id/lock     Lock a period
 *   PATCH /fin/periods/:id/unlock   Unlock a period (Admin only)
 *   GET  /fin/journals              Journal list (with filters)
 *   GET  /fin/journals/:id          Journal detail with lines
 *   POST /fin/journals              Post a new GL journal
 *   GET  /fin/trial-balance         Trial balance (current FY)
 *   GET  /fin/vat-types             VAT type reference
 *   GET  /fin/vat201                VAT201 summary by period
 *   GET  /fin/suppliers             Supplier list
 *   POST /fin/suppliers             Create supplier
 *   GET  /fin/suppliers/workshop    Suppliers allowed for Workshop (no fin gate)
 *   GET  /fin/suppliers/:code       Supplier detail
 *   PATCH /fin/suppliers/:code/workshop  Toggle workshop_allowed flag
 *   GET  /fin/ar-customers          AR customer list
 *   POST /fin/ar-customers          Create AR customer
 *   GET  /fin/ar-customers/:code    AR customer detail
 *   PATCH /fin/ar-customers/:code/loads  Toggle loads_allowed + auto-sync to LP
 *   GET  /fin/assets/classes        Asset classes
 *   GET  /fin/assets                Fixed asset register
 *   POST /fin/assets                Create fixed asset
 *   GET  /fin/assets/:code          Asset detail
 *   GET  /fin/aging/debtors         Debtor aging view
 *   GET  /fin/aging/suppliers       Supplier aging view
 *   GET  /fin/cashbook/staging      Cashbook staging entries
 *   GET  /fin/dashboard             Finance dashboard summary
 *   (See route definitions below for full list — file has grown beyond this header)
 */

const express = require('express');
const router  = express.Router();
const supabase = require('../supabase');
const { authMiddleware, requireRole, ROLES, loadUserPermissions, requirePermission } = require('../middleware/auth');

router.use(authMiddleware);
router.use(loadUserPermissions);

// Only ADMIN and FINANCE can access financial module (unless otherwise specified) —
// now DB-aware via requirePermission, so a custom role granted FINANCE.view works too.
const requireFin = requirePermission('FINANCE', 'view');

// ─────────────────────────────────────────────────────────────
// CHART OF ACCOUNTS
// ─────────────────────────────────────────────────────────────

// GET /fin/accounts
router.get('/accounts', requireFin, async (req, res) => {
  const { category, account_type, active, search } = req.query;

  let query = supabase
    .from('fin_gl_accounts')
    .select('*')
    .order('account_code');

  if (active !== undefined) query = query.eq('active', active === 'true');
  if (category)     query = query.eq('category', category);
  if (account_type) query = query.eq('account_type', account_type);
  if (search) {
    query = query.or(`account_code.ilike.%${search}%,account_name.ilike.%${search}%`);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /fin/accounts — create GL account
router.post('/accounts', requireFin, async (req, res) => {
  const { account_code, account_name, category, account_type, vat_treatment, allowed_vat_codes, is_sub_account, parent_account } = req.body;
  if (!account_code?.trim()) return res.status(400).json({ error: 'account_code is required' });
  if (!account_name?.trim()) return res.status(400).json({ error: 'account_name is required' });
  const { data, error } = await supabase.from('fin_gl_accounts').insert({
    account_code:      account_code.trim().toUpperCase(),
    account_name:      account_name.trim(),
    category:          category || 'EXPENSES',
    account_type:      account_type || 'DETAIL',
    vat_treatment:     vat_treatment || 'NONE',
    allowed_vat_codes: allowed_vat_codes || null,
    is_sub_account:    is_sub_account || false,
    parent_code:       parent_account || null,
    active:            true,
    created_by:        req.user.username,
  }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// GET /fin/accounts/:code
router.get('/accounts/:code', requireFin, async (req, res) => {
  const { data, error } = await supabase
    .from('fin_gl_accounts')
    .select('*')
    .eq('account_code', req.params.code)
    .single();
  if (error) return res.status(404).json({ error: 'Account not found' });
  res.json(data);
});

// ─────────────────────────────────────────────────────────────
// PERIODS
// ─────────────────────────────────────────────────────────────

// GET /fin/periods
router.get('/periods', requireFin, async (req, res) => {
  const { data, error } = await supabase
    .from('fin_periods')
    .select('*, fin_financial_years(fy_code, is_current)')
    .order('period_id');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /fin/periods/status — dashboard view
router.get('/periods/status', requireFin, async (req, res) => {
  const { data, error } = await supabase
    .from('fin_vw_period_status')
    .select('*')
    .order('period_id');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH /fin/periods/:id/lock — lock a period
router.patch('/periods/:id/lock', requireFin, async (req, res) => {
  const { reason } = req.body;
  const period_id = parseInt(req.params.id);

  const { data: period } = await supabase
    .from('fin_periods')
    .select('is_closed, period_name')
    .eq('period_id', period_id)
    .single();

  if (!period) return res.status(404).json({ error: 'Period not found' });
  if (period.is_closed) return res.status(400).json({ error: 'Period is already locked' });

  const { error } = await supabase
    .from('fin_periods')
    .update({
      is_closed:  true,
      locked_by:  req.user.username,
      locked_at:  new Date().toISOString(),
    })
    .eq('period_id', period_id);

  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('fin_period_lock_log').insert({
    period_id, period_type: 'GL', action: 'LOCK',
    actioned_by: req.user.username, reason: reason || null,
  });

  res.json({ success: true, message: `Period ${period.period_name} locked` });
});

// PATCH /fin/periods/:id/unlock — unlock a period (Admin only)
router.patch('/periods/:id/unlock', requirePermission('FINANCE', 'delete'), async (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ error: 'Unlock reason is required' });
  const period_id = parseInt(req.params.id);

  const { error } = await supabase
    .from('fin_periods')
    .update({
      is_closed:     false,
      unlocked_by:   req.user.username,
      unlocked_at:   new Date().toISOString(),
      unlock_reason: reason,
    })
    .eq('period_id', period_id);

  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('fin_period_lock_log').insert({
    period_id, period_type: 'GL', action: 'UNLOCK',
    actioned_by: req.user.username, reason,
  });

  res.json({ success: true, message: 'Period unlocked' });
});

// ─────────────────────────────────────────────────────────────
// GL JOURNALS
// ─────────────────────────────────────────────────────────────

// GET /fin/journals
router.get('/journals', requireFin, async (req, res) => {
  const { period_id, journal_type, posted, limit = 100, offset = 0 } = req.query;

  let query = supabase
    .from('fin_gl_journals')
    .select('*')
    .order('journal_date', { ascending: false })
    .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

  if (period_id)    query = query.eq('period_id', period_id);
  if (journal_type) query = query.eq('journal_type', journal_type);
  if (posted !== undefined) query = query.eq('posted', posted === 'true');

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /fin/journals/:id — journal with lines
router.get('/journals/:id', requireFin, async (req, res) => {
  const { data: journal, error } = await supabase
    .from('fin_gl_journals')
    .select('*')
    .eq('journal_id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Journal not found' });

  const { data: lines } = await supabase
    .from('fin_gl_journal_lines')
    .select('*')
    .eq('journal_id', req.params.id)
    .order('line_number');

  const allLines    = lines || [];
  const totalDebit  = allLines.reduce((s, l) => s + (l.debit  || 0), 0);
  const totalCredit = allLines.reduce((s, l) => s + (l.credit || 0), 0);

  res.json({
    ...journal,
    lines:        allLines,
    total_debit:  Math.round(totalDebit  * 100) / 100,
    total_credit: Math.round(totalCredit * 100) / 100,
    balanced:     Math.abs(totalDebit - totalCredit) < 0.01,
  });
});

// POST /fin/journals — post a new GL journal
router.post('/journals', requireFin, async (req, res) => {
  const {
    journal_type, description, period_id, journal_date,
    source_document, source_module, lines,
  } = req.body;

  if (!description?.trim())  return res.status(400).json({ error: 'Description is required' });
  if (!period_id)            return res.status(400).json({ error: 'Period is required' });
  if (!journal_date)         return res.status(400).json({ error: 'Journal date is required' });
  if (!lines?.length)        return res.status(400).json({ error: 'Journal lines are required' });

  // Auto-resolve period from journal_date if period_id not provided
  let resolvedPeriodId = period_id;
  let period = null;
  if (resolvedPeriodId) {
    const { data: p } = await supabase.from('fin_periods').select('is_closed, period_name, period_id').eq('period_id', resolvedPeriodId).single();
    period = p;
  } else {
    const { data: p } = await supabase.from('fin_periods')
      .select('is_closed, period_name, period_id')
      .lte('period_start', journal_date)
      .gte('period_end', journal_date)
      .eq('entity_id', 1)
      .single();
    period = p;
    if (p) resolvedPeriodId = p.period_id;
  }
  if (!period)          return res.status(404).json({ error: `No open period found for date ${journal_date}` });
  if (period.is_closed) return res.status(400).json({ error: `Period ${period.period_name} is locked` });

  const totalDebit  = lines.reduce((s, l) => s + (parseFloat(l.debit)  || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01)
    return res.status(400).json({ error: `Journal is not balanced — DR: ${totalDebit.toFixed(2)}, CR: ${totalCredit.toFixed(2)}` });

  const datePart   = journal_date.replace(/-/g, '').slice(0, 6);
  const typePrefix = (journal_type || 'GL').slice(0, 2).toUpperCase();
  const { count }  = await supabase
    .from('fin_gl_journals')
    .select('*', { count: 'exact', head: true })
    .like('journal_ref', `${typePrefix}-${datePart}-%`);
  const seq         = String((count || 0) + 1).padStart(5, '0');
  const journal_ref = `${typePrefix}-${datePart}-${seq}`;

  const { data: journal, error: jErr } = await supabase
    .from('fin_gl_journals')
    .insert({
      journal_ref, journal_type: journal_type || 'GL', description,
      period_id: resolvedPeriodId, journal_date, source_document, source_module,
      posted: true, posted_at: new Date().toISOString(), posted_by: req.user.username,
      created_by: req.user.username,
    })
    .select()
    .single();

  if (jErr) return res.status(500).json({ error: jErr.message });

  const lineRows = lines.map((l, i) => ({
    journal_id:   journal.journal_id,
    line_number:  i + 1,
    account_code: l.account_code,
    description:  l.description || description,
    debit:        parseFloat(l.debit)  || 0,
    credit:       parseFloat(l.credit) || 0,
    vat_type:     l.vat_type    || null,
    vat_amount:   parseFloat(l.vat_amount) || 0,
    tax_period:   l.tax_period  || null,
    reference:    l.reference   || null,
  }));

  const { error: lErr } = await supabase.from('fin_gl_journal_lines').insert(lineRows);

  if (lErr) {
    await supabase.from('fin_gl_journals').delete().eq('journal_id', journal.journal_id);
    return res.status(500).json({ error: lErr.message });
  }

  // ── Write VAT transactions for any lines with a vat_type ──────────────────
  const vatRows = [];
  for (const l of lineRows) {
    if (!l.vat_type || !l.vat_amount) continue;

    // Determine direction from the VAT type
    const { data: vtData } = await supabase
      .from('fin_vat_types')
      .select('vat_direction, rate_pct')
      .eq('vat_code', l.vat_type)
      .single();

    if (!vtData) continue;

    const grossAmt  = (l.debit || 0) > 0 ? l.debit : l.credit;
    const exclAmt   = grossAmt - l.vat_amount;

    vatRows.push({
      vat_code:          l.vat_type,
      vat_direction:     vtData.vat_direction,
      vat_period:        journal_date.replace(/-/g, '').slice(0, 6),
      transaction_date:  journal_date,
      tax_invoice_no:    source_document || journal_ref,
      counterparty_name: null,
      exclusive_amount:  Math.round(exclAmt  * 100) / 100,
      vat_amount:        Math.round(l.vat_amount * 100) / 100,
      inclusive_amount:  Math.round(grossAmt * 100) / 100,
      gl_account_code:   l.account_code,
      source_module:     'GL',
      journal_id:        journal.journal_id,
      is_capital_goods:  false,
    });
  }

  if (vatRows.length > 0) {
    await supabase.from('fin_vat_transactions').insert(vatRows);
  }

  // ── Sub-ledger posting for AP/AR lines ───────────────────────────────────
  // Journal lines with reference='AP' or 'AR' affect supplier/customer balances.
  // We write an adjustment against the most recent open invoice for that party.
  const apLines = lines.filter(l => l.reference === 'AP');
  const arLines = lines.filter(l => l.reference === 'AR');

  for (const l of apLines) {
    const adjAmt = (parseFloat(l.debit) || 0) - (parseFloat(l.credit) || 0);
    if (!adjAmt || !l.account_code) continue;

    // Find the oldest open AP invoice for this supplier to apply adjustment against
    const { data: openInvs } = await supabase
      .from('fin_ap_invoices')
      .select('invoice_id, balance_due, amount_written_off')
      .eq('supplier_code', l.account_code)
      .gt('balance_due', 0)
      .not('status', 'eq', 'CANCELLED')
      .order('invoice_date', { ascending: true })
      .limit(1);

    if (openInvs?.length) {
      const inv = openInvs[0];
      const apply = Math.min(Math.abs(adjAmt), inv.balance_due);
      const newWriteOff = Number(inv.amount_written_off || 0) + apply;
      const newBalance  = Number(inv.balance_due) - apply;
      await supabase.from('fin_ap_invoices').update({
        amount_written_off: Math.round(newWriteOff * 100) / 100,
        balance_due:        Math.round(newBalance  * 100) / 100,
        status:             newBalance < 0.01 ? 'PAID' : 'PARTIAL',
      }).eq('invoice_id', inv.invoice_id);
    }
  }

  for (const l of arLines) {
    const adjAmt = (parseFloat(l.credit) || 0) - (parseFloat(l.debit) || 0);
    if (!adjAmt || !l.account_code) continue;

    const { data: openInvs } = await supabase
      .from('fin_ar_invoices')
      .select('invoice_id, balance_due, amount_written_off')
      .eq('customer_code', l.account_code)
      .gt('balance_due', 0)
      .not('status', 'eq', 'CANCELLED')
      .order('invoice_date', { ascending: true })
      .limit(1);

    if (openInvs?.length) {
      const inv = openInvs[0];
      const apply = Math.min(Math.abs(adjAmt), inv.balance_due);
      const newWriteOff = Number(inv.amount_written_off || 0) + apply;
      const newBalance  = Number(inv.balance_due) - apply;
      await supabase.from('fin_ar_invoices').update({
        amount_written_off: Math.round(newWriteOff * 100) / 100,
        balance_due:        Math.round(newBalance  * 100) / 100,
        status:             newBalance < 0.01 ? 'PAID' : 'PARTIAL',
      }).eq('invoice_id', inv.invoice_id);
    }
  }

  res.json({ success: true, journal_id: journal.journal_id, journal_ref,
    ap_adjustments: apLines.length, ar_adjustments: arLines.length });
});

// ─────────────────────────────────────────────────────────────
// TRIAL BALANCE
// ─────────────────────────────────────────────────────────────

router.get('/trial-balance', requireFin, async (req, res) => {
  const { data, error } = await supabase
    .from('fin_vw_trial_balance')
    .select('*')
    .order('account_code');
  if (error) return res.status(500).json({ error: error.message });

  const totalDebit  = data.reduce((s, r) => s + (r.total_debit  || 0), 0);
  const totalCredit = data.reduce((s, r) => s + (r.total_credit || 0), 0);

  res.json({
    accounts: data,
    totals: {
      total_debit:  Math.round(totalDebit  * 100) / 100,
      total_credit: Math.round(totalCredit * 100) / 100,
      balanced:     Math.abs(totalDebit - totalCredit) < 0.01,
    },
  });
});

// ─────────────────────────────────────────────────────────────
// VAT
// ─────────────────────────────────────────────────────────────

router.get('/vat-types', requireFin, async (req, res) => {
  const { all } = req.query;
  let q = supabase.from('fin_vat_types').select('*').order('vat_code');
  if (!all) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /fin/vat-types — create a new VAT type (Admin/Finance only)
router.post('/vat-types', requireFin, async (req, res) => {
  const { vat_code, description, rate_pct, vat_direction, vat201_field, is_capital_goods } = req.body;
  if (!vat_code?.trim())    return res.status(400).json({ error: 'vat_code is required' });
  if (!description?.trim()) return res.status(400).json({ error: 'description is required' });
  if (rate_pct == null)     return res.status(400).json({ error: 'rate_pct is required' });
  const { data, error } = await supabase.from('fin_vat_types').insert({
    vat_code:         vat_code.trim().toUpperCase(),
    description:      description.trim(),
    rate_pct:         Number(rate_pct),
    vat_direction:    vat_direction || 'OUTPUT',
    vat201_field:     vat201_field || null,
    is_capital_goods: !!is_capital_goods,
    active:           true,
  }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /fin/vat-types/:code — update VAT type (Admin/Finance only)
router.patch('/vat-types/:code', requireFin, async (req, res) => {
  const allowed = ['description','rate_pct','vat_direction','vat201_field','is_capital_goods','active'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No fields to update' });
  const { data, error } = await supabase.from('fin_vat_types')
    .update(updates).eq('vat_code', req.params.code).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.get('/vat201', requireFin, async (req, res) => {
  const { data, error } = await supabase
    .from('fin_vw_vat201_summary')
    .select('*')
    .order('vat_period');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─────────────────────────────────────────────────────────────
// SUPPLIERS — specific routes BEFORE parameterised /:code
// ─────────────────────────────────────────────────────────────

// GET /fin/suppliers/workshop — suppliers allowed for Workshop (used by PO module)
// No full finance gate — any authenticated user can fetch this list
router.get('/suppliers/workshop', async (req, res) => {
  const { data, error } = await supabase
    .from('fin_suppliers')
    .select('supplier_id,supplier_code,supplier_name,payment_terms_days,telephone,email,vat_number')
    .eq('workshop_allowed', true)
    .eq('active', true)
    .order('supplier_name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /fin/suppliers
router.get('/suppliers', requireFin, async (req, res) => {
  const { search, active, workshop_only } = req.query;
  let query = supabase
    .from('fin_suppliers')
    .select('supplier_id,supplier_code,supplier_name,group_terms,telephone,email,vat_number,payment_terms_days,on_hold,active,gl_control_account,workshop_allowed')
    .order('supplier_name');

  if (active !== undefined) query = query.eq('active', active === 'true');
  if (workshop_only === 'true') query = query.eq('workshop_allowed', true);
  if (search) query = query.or(`supplier_code.ilike.%${search}%,supplier_name.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /fin/suppliers — create supplier
router.post('/suppliers', requireFin, async (req, res) => {
  const { supplier_code, supplier_name, telephone, email, vat_number, vat_enabled, payment_terms_days, credit_limit, supplier_type_id, discount_id } = req.body;
  if (!supplier_code?.trim()) return res.status(400).json({ error: 'supplier_code is required' });
  if (!supplier_name?.trim()) return res.status(400).json({ error: 'supplier_name is required' });
  const { data, error } = await supabase.from('fin_suppliers').insert({
    supplier_code:       supplier_code.trim().toUpperCase(),
    supplier_name:       supplier_name.trim(),
    telephone:           telephone   || null,
    email:               email       || null,
    vat_number:          vat_number  || null,
    vat_enabled:         !!vat_enabled,
    payment_terms_days:  parseInt(payment_terms_days) || 30,
    gl_control_account:  '2000',
    credit_limit:        parseFloat(credit_limit) || null,
    supplier_type_id:    supplier_type_id ? parseInt(supplier_type_id) : null,
    discount_id:         discount_id ? parseInt(discount_id) : null,
    active:              true,
    on_hold:             false,
    workshop_allowed:    false,
    created_by:          req.user.username,
  }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// PATCH /fin/suppliers/:code — edit supplier details
router.patch('/suppliers/:code', requireFin, async (req, res) => {
  const { supplier_name, telephone, email, vat_number, vat_enabled, payment_terms_days, credit_limit, supplier_type_id, discount_id } = req.body;
  const updates = {};
  if (supplier_name      !== undefined) updates.supplier_name      = supplier_name.trim();
  if (telephone          !== undefined) updates.telephone          = telephone || null;
  if (email              !== undefined) updates.email              = email || null;
  if (vat_number         !== undefined) updates.vat_number         = vat_number || null;
  if (vat_enabled        !== undefined) updates.vat_enabled        = !!vat_enabled;
  if (payment_terms_days !== undefined) updates.payment_terms_days = parseInt(payment_terms_days) || 30;
  if (credit_limit       !== undefined) updates.credit_limit       = parseFloat(credit_limit) || null;
  if (supplier_type_id   !== undefined) updates.supplier_type_id   = supplier_type_id ? parseInt(supplier_type_id) : null;
  if (discount_id        !== undefined) updates.discount_id        = discount_id ? parseInt(discount_id) : null;
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No fields to update' });
  const { data, error } = await supabase
    .from('fin_suppliers')
    .update(updates)
    .eq('supplier_code', req.params.code)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// PATCH /fin/suppliers/:code/workshop — toggle workshop_allowed
// Allowed: ADMIN, FINANCE, WORKSHOP_MANAGER
router.patch('/suppliers/:code/workshop', requireRole(ROLES.ADMIN, ROLES.FINANCE, ROLES.WORKSHOP_MANAGER), async (req, res) => {
  const { workshop_allowed } = req.body;
  const { data, error } = await supabase
    .from('fin_suppliers')
    .update({ workshop_allowed: !!workshop_allowed })
    .eq('supplier_code', req.params.code)
    .select('supplier_code,supplier_name,workshop_allowed')
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// GET /fin/suppliers/:code
router.get('/suppliers/:code', requireFin, async (req, res) => {
  const { data, error } = await supabase
    .from('fin_suppliers')
    .select('*')
    .eq('supplier_code', req.params.code)
    .single();
  if (error) return res.status(404).json({ error: 'Supplier not found' });
  res.json(data);
});

// ─────────────────────────────────────────────────────────────
// AR CUSTOMERS — specific routes BEFORE parameterised /:code
// ─────────────────────────────────────────────────────────────

// GET /fin/ar-customers
router.get('/ar-customers', requireFin, async (req, res) => {
  const { search, active } = req.query;
  let query = supabase
    .from('fin_ar_customers')
    .select('customer_id,customer_code,customer_name,category,vat_number,telephone,email,payment_terms_days,on_hold,active,gl_control_account,lp_client_code,loads_allowed,lp_synced')
    .order('customer_name');

  if (active !== undefined) query = query.eq('active', active === 'true');
  if (search) query = query.or(`customer_code.ilike.%${search}%,customer_name.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /fin/ar-customers — create AR customer
router.post('/ar-customers', requireFin, async (req, res) => {
  const { customer_code, customer_name, category, vat_number, telephone, email, payment_terms_days, gl_control_account } = req.body;
  if (!customer_code?.trim()) return res.status(400).json({ error: 'customer_code is required' });
  if (!customer_name?.trim()) return res.status(400).json({ error: 'customer_name is required' });
  const { data, error } = await supabase.from('fin_ar_customers').insert({
    customer_code:      customer_code.trim().toUpperCase(),
    customer_name:      customer_name.trim(),
    category:           category           || null,
    vat_number:         vat_number         || null,
    telephone:          telephone          || null,
    email:              email              || null,
    payment_terms_days: parseInt(payment_terms_days) || 30,
    gl_control_account: gl_control_account || '1200',
    active:             true,
    on_hold:            false,
    loads_allowed:      false,
    lp_synced:          false,
    created_by:         req.user.username,
  }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// PATCH /fin/ar-customers/:code/loads — toggle loads_allowed + auto-sync to lp_customers + blank rate card
router.patch('/ar-customers/:code/loads', requireFin, async (req, res) => {
  const { loads_allowed } = req.body;
  const customerCode = req.params.code;

  const { data: customer, error: fetchErr } = await supabase
    .from('fin_ar_customers')
    .select('*')
    .eq('customer_code', customerCode)
    .single();
  if (fetchErr) return res.status(404).json({ error: 'Customer not found' });

  const { error: updErr } = await supabase
    .from('fin_ar_customers')
    .update({ loads_allowed: !!loads_allowed })
    .eq('customer_code', customerCode);
  if (updErr) return res.status(400).json({ error: updErr.message });

  let syncResult = { synced: false };

  if (loads_allowed && !customer.lp_synced) {
    // Create lp_customers record
    const newCode = customerCode.slice(0, 10); // lp_customers PK is VARCHAR(10)
    const { data: newClient, error: clientErr } = await supabase
      .from('lp_customers')
      .insert({
        c_code:   newCode,
        c_name:   customer.customer_name,
        c_active: 'Y',
      })
      .select('c_code,c_name')
      .single();

    if (!clientErr && newClient) {
      // Update AR customer with LP link
      await supabase.from('fin_ar_customers').update({
        lp_client_code: newClient.c_code,
        lp_synced:      true,
      }).eq('customer_code', customerCode);

      // Auto-create a blank rate card (1 placeholder row)
      await supabase.from('lp_client_rates').insert({
        rc_client_code: newClient.c_code,
        rc_from:        'Origin',
        rc_to:          'Destination',
        rc_kms:         null,
        rc_rate_15m:    null,
        rc_rate_18m:    null,
      });

      syncResult = { synced: true, lp_client_code: newClient.c_code };
    } else if (clientErr) {
      // Code conflict — try to link to existing
      syncResult = { synced: false, error: clientErr.message };
    }
  }

  res.json({ success: true, loads_allowed: !!loads_allowed, ...syncResult });
});

// GET /fin/ar-customers/:code
router.get('/ar-customers/:code', requireFin, async (req, res) => {
  const { data, error } = await supabase
    .from('fin_ar_customers')
    .select('*')
    .eq('customer_code', req.params.code)
    .single();
  if (error) return res.status(404).json({ error: 'Customer not found' });
  res.json(data);
});

// ─────────────────────────────────────────────────────────────
// FIXED ASSETS — specific routes BEFORE parameterised /:code
// ─────────────────────────────────────────────────────────────

// GET /fin/assets/classes
router.get('/assets/classes', requireFin, async (req, res) => {
  const { data, error } = await supabase
    .from('fin_asset_classes')
    .select('*')
    .order('class_code');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /fin/assets
router.get('/assets', requireFin, async (req, res) => {
  const { class_code, active, search } = req.query;
  let query = supabase
    .from('fin_vw_fixed_assets')
    .select('*')
    .order('asset_code');

  if (class_code) query = query.eq('class_code', class_code);
  if (active !== undefined) query = query.eq('is_active', active === 'true');
  if (search) query = query.or(`asset_code.ilike.%${search}%,description.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /fin/assets — create fixed asset
router.post('/assets', requireFin, async (req, res) => {
  const { asset_code, description, class_code, location, purchase_price, purchase_date, depre_start_date, ifrs_useful_life_yr, sars_wt_rate_pct, reg_number } = req.body;
  if (!asset_code?.trim())  return res.status(400).json({ error: 'asset_code is required' });
  if (!description?.trim()) return res.status(400).json({ error: 'description is required' });
  if (!class_code)          return res.status(400).json({ error: 'class_code is required' });
  const price = parseFloat(purchase_price) || 0;
  const { data, error } = await supabase.from('fin_assets').insert({
    asset_code:          asset_code.trim().toUpperCase(),
    description:         description.trim(),
    class_code,
    location:            location            || null,
    purchase_price:      price,
    purchase_date:       purchase_date       || null,
    depre_start_date:    depre_start_date    || null,
    ifrs_useful_life_yr: parseInt(ifrs_useful_life_yr) || null,
    sars_wt_rate_pct:    parseFloat(sars_wt_rate_pct)  || null,
    reg_number:          reg_number          || null,
    book_nbv:            price,
    tax_value:           price,
    is_active:           true,
    fully_depreciated:   false,
    created_by:          req.user.username,
  }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// GET /fin/assets/:code
router.get('/assets/:code', requireFin, async (req, res) => {
  const { data: asset, error } = await supabase
    .from('fin_assets')
    .select('*')
    .eq('asset_code', req.params.code)
    .single();

  if (error) return res.status(404).json({ error: 'Asset not found' });

  const { data: runs } = await supabase
    .from('fin_depreciation_runs')
    .select('*')
    .eq('asset_id', asset.asset_id)
    .order('period_id');

  res.json({ ...asset, depreciation_runs: runs || [] });
});

// ─────────────────────────────────────────────────────────────
// AGING VIEWS
// ─────────────────────────────────────────────────────────────

router.get('/aging/debtors', requireFin, async (req, res) => {
  const { data, error } = await supabase
    .from('fin_vw_debtor_aging')
    .select('*')
    .order('days_overdue', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const summary = { Current: 0, '1-30 Days': 0, '31-60 Days': 0, '61-90 Days': 0, '90+ Days': 0 };
  data.forEach(r => { summary[r.aging_bucket] = (summary[r.aging_bucket] || 0) + (r.balance_due || 0); });

  res.json({ invoices: data, summary, total: data.reduce((s, r) => s + (r.balance_due || 0), 0) });
});

router.get('/aging/suppliers', requireFin, async (req, res) => {
  const { data, error } = await supabase
    .from('fin_vw_supplier_aging')
    .select('*')
    .order('days_overdue', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const summary = { Current: 0, '1-30 Days': 0, '31-60 Days': 0, '61-90 Days': 0, '90+ Days': 0 };
  data.forEach(r => { summary[r.aging_bucket] = (summary[r.aging_bucket] || 0) + (r.balance_due || 0); });

  res.json({ invoices: data, summary, total: data.reduce((s, r) => s + (r.balance_due || 0), 0) });
});

// ─────────────────────────────────────────────────────────────
// CASHBOOK STAGING
// ─────────────────────────────────────────────────────────────

router.get('/cashbook/staging', requireFin, async (req, res) => {
  const { status, batch, bank_account } = req.query;
  let query = supabase
    .from('fin_cb_staging')
    .select('*')
    .order('transaction_date', { ascending: false })
    .limit(500);

  if (status)       query = query.eq('status', status);
  if (batch)        query = query.eq('import_batch', batch);
  if (bank_account) query = query.eq('bank_account', bank_account);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─────────────────────────────────────────────────────────────
// SUMMARY / DASHBOARD
// ─────────────────────────────────────────────────────────────

router.get('/dashboard', requireFin, async (req, res) => {
  const [debtorRes, supplierRes, assetRes, periodRes] = await Promise.all([
    supabase.from('fin_vw_debtor_aging').select('balance_due,aging_bucket'),
    supabase.from('fin_vw_supplier_aging').select('balance_due,aging_bucket'),
    supabase.from('fin_assets').select('asset_id,book_nbv,tax_value,is_active').eq('is_active', true),
    supabase.from('fin_vw_period_status').select('*').order('period_id').limit(12),
  ]);

  const debtorTotal   = (debtorRes.data   || []).reduce((s, r) => s + (r.balance_due || 0), 0);
  const supplierTotal = (supplierRes.data || []).reduce((s, r) => s + (r.balance_due || 0), 0);
  const assetNBV      = (assetRes.data    || []).reduce((s, r) => s + (r.book_nbv    || 0), 0);
  const assetTaxVal   = (assetRes.data    || []).reduce((s, r) => s + (r.tax_value   || 0), 0);

  res.json({
    debtors_outstanding:   Math.round(debtorTotal   * 100) / 100,
    creditors_outstanding: Math.round(supplierTotal * 100) / 100,
    fixed_assets_nbv:      Math.round(assetNBV      * 100) / 100,
    fixed_assets_tax_val:  Math.round(assetTaxVal   * 100) / 100,
    active_assets:         (assetRes.data || []).length,
    period_status:         periodRes.data || [],
  });
});


// ─────────────────────────────────────────────────────────────
// GL ACCOUNT TRANSACTIONS (Account Enquiry / Ledger)
// ─────────────────────────────────────────────────────────────

// GET /fin/account-transactions
// Query params: account_code, date_from, date_to, limit (all optional)
// Returns journal lines joined to journal header, ordered by date desc
router.get('/account-transactions', requireFin, async (req, res) => {
  const { account_code, date_from, date_to, limit = 500 } = req.query;

  // Fetch posted journals in range first (no join shorthand)
  let jQ = supabase
    .from('fin_gl_journals')
    .select('journal_id, journal_ref, journal_date, journal_type, description, source_module, source_document')
    .eq('posted', true)
    .order('journal_date', { ascending: false })
    .limit(parseInt(limit));

  if (date_from) jQ = jQ.gte('journal_date', date_from);
  if (date_to)   jQ = jQ.lte('journal_date', date_to);

  const { data: journals, error } = await jQ;
  if (error) return res.status(500).json({ error: error.message });

  const journalIds = (journals || []).map(j => j.journal_id);
  const jMap = {};
  (journals || []).forEach(j => { jMap[j.journal_id] = j; });

  let linesData = [];
  if (journalIds.length > 0) {
    let lQ = supabase
      .from('fin_gl_journal_lines')
      .select('line_id, journal_id, account_code, description, debit, credit, vat_type, vat_amount, reference')
      .in('journal_id', journalIds);
    if (account_code) lQ = lQ.eq('account_code', account_code);
    const { data: ld } = await lQ;
    linesData = ld || [];
  }

  const rows = linesData
    .map(l => ({
      line_id:         l.line_id,
      account_code:    l.account_code,
      line_desc:       l.description,
      debit:           l.debit || 0,
      credit:          l.credit || 0,
      vat_type:        l.vat_type,
      vat_amount:      l.vat_amount || 0,
      reference:       l.reference,
      journal_id:      jMap[l.journal_id]?.journal_id,
      journal_ref:     jMap[l.journal_id]?.journal_ref,
      journal_date:    jMap[l.journal_id]?.journal_date,
      journal_type:    jMap[l.journal_id]?.journal_type,
      journal_desc:    jMap[l.journal_id]?.description,
      source_module:   jMap[l.journal_id]?.source_module,
      source_document: jMap[l.journal_id]?.source_document,
    }))
    .sort((a, b) => (b.journal_date || '').localeCompare(a.journal_date || ''));

  // Compute running totals
  const totalDebit  = rows.reduce((s, r) => s + r.debit,  0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const netBalance  = totalDebit - totalCredit;

  res.json({
    transactions: rows,
    totals: {
      total_debit:  Math.round(totalDebit  * 100) / 100,
      total_credit: Math.round(totalCredit * 100) / 100,
      net_balance:  Math.round(netBalance  * 100) / 100,
    },
    count: rows.length,
  });
});


// ─────────────────────────────────────────────────────────────
// AP TRANSACTIONS (Supplier Ledger Enquiry)
// ─────────────────────────────────────────────────────────────

// GET /fin/ap-transactions
// Query params: supplier_code (optional), date_from (optional), date_to (optional)
// Returns invoices + payments merged and sorted by date desc
router.get('/ap-transactions', requireFin, async (req, res) => {
  const { supplier_code, date_from, date_to } = req.query;

  // Build shared date filters
  const applyDates = (q, dateCol) => {
    if (date_from) q = q.gte(dateCol, date_from);
    if (date_to)   q = q.lte(dateCol, date_to);
    return q;
  };

  // Invoices
  let invQ = supabase
    .from('fin_ap_invoices')
    .select('invoice_id,invoice_ref,supplier_code,supplier_invoice_no,invoice_date,due_date,status,subtotal_excl_vat,vat_amount,total_incl_vat,amount_paid,balance_due,document_ref')
    .order('invoice_date', { ascending: false })
    .limit(500);
  if (supplier_code) invQ = invQ.eq('supplier_code', supplier_code);
  invQ = applyDates(invQ, 'invoice_date');

  // Payments
  let payQ = supabase
    .from('fin_ap_payments')
    .select('payment_id,payment_ref,supplier_code,payment_date,payment_method,amount,bank_account,notes')
    .order('payment_date', { ascending: false })
    .limit(500);
  if (supplier_code) payQ = payQ.eq('supplier_code', supplier_code);
  payQ = applyDates(payQ, 'payment_date');

  const [invRes, payRes] = await Promise.all([invQ, payQ]);
  if (invRes.error) return res.status(500).json({ error: invRes.error.message });
  if (payRes.error) return res.status(500).json({ error: payRes.error.message });

  // Merge into unified transaction list
  const invoices = (invRes.data || []).map(i => ({
    tx_type:        'INVOICE',
    tx_date:        i.invoice_date,
    tx_ref:         i.invoice_ref,
    supplier_code:  i.supplier_code,
    description:    i.supplier_invoice_no ? `Supplier Inv: ${i.supplier_invoice_no}` : 'Supplier Invoice',
    document_ref:   i.document_ref || null,
    debit:          i.total_incl_vat,   // invoices increase what we owe
    credit:         0,
    vat_amount:     i.vat_amount,
    excl_amount:    i.subtotal_excl_vat,
    status:         i.status,
    balance_due:    i.balance_due,
    due_date:       i.due_date,
  }));

  const payments = (payRes.data || []).map(p => ({
    tx_type:        'PAYMENT',
    tx_date:        p.payment_date,
    tx_ref:         p.payment_ref,
    supplier_code:  p.supplier_code,
    description:    `Payment — ${p.payment_method || 'EFT'}${p.notes ? ': ' + p.notes : ''}`,
    document_ref:   null,
    debit:          0,
    credit:         p.amount,           // payments reduce what we owe
    vat_amount:     0,
    excl_amount:    p.amount,
    status:         'PAID',
    balance_due:    0,
    due_date:       null,
  }));

  const transactions = [...invoices, ...payments].sort((a, b) =>
    b.tx_date.localeCompare(a.tx_date)
  );

  const totalInvoiced = invoices.reduce((s, r) => s + r.debit, 0);
  const totalPaid     = payments.reduce((s, r) => s + r.credit, 0);
  const outstanding   = totalInvoiced - totalPaid;

  res.json({
    transactions,
    totals: {
      total_invoiced: Math.round(totalInvoiced * 100) / 100,
      total_paid:     Math.round(totalPaid     * 100) / 100,
      outstanding:    Math.round(outstanding   * 100) / 100,
    },
    count: transactions.length,
  });
});

// ─────────────────────────────────────────────────────────────
// AR TRANSACTIONS (Customer Ledger Enquiry)
// ─────────────────────────────────────────────────────────────

// GET /fin/ar-transactions
// Query params: customer_code (optional), date_from (optional), date_to (optional)
// Returns invoices + receipts merged and sorted by date desc
router.get('/ar-transactions', requireFin, async (req, res) => {
  const { customer_code, date_from, date_to } = req.query;

  const applyDates = (q, dateCol) => {
    if (date_from) q = q.gte(dateCol, date_from);
    if (date_to)   q = q.lte(dateCol, date_to);
    return q;
  };

  // Invoices
  let invQ = supabase
    .from('fin_ar_invoices')
    .select('invoice_id,invoice_ref,customer_code,customer_invoice_no,invoice_date,due_date,status,subtotal_excl_vat,vat_amount,total_incl_vat,amount_received,balance_due,lp_load_number,document_ref,notes')
    .order('invoice_date', { ascending: false })
    .limit(500);
  if (customer_code) invQ = invQ.eq('customer_code', customer_code);
  invQ = applyDates(invQ, 'invoice_date');

  // Receipts
  let recQ = supabase
    .from('fin_ar_receipts')
    .select('receipt_id,receipt_ref,customer_code,receipt_date,payment_method,amount,bank_account,notes')
    .order('receipt_date', { ascending: false })
    .limit(500);
  if (customer_code) recQ = recQ.eq('customer_code', customer_code);
  recQ = applyDates(recQ, 'receipt_date');

  const [invRes, recRes] = await Promise.all([invQ, recQ]);
  if (invRes.error) return res.status(500).json({ error: invRes.error.message });
  if (recRes.error) return res.status(500).json({ error: recRes.error.message });

  const invoices = (invRes.data || []).map(i => ({
    tx_type:       'INVOICE',
    tx_date:       i.invoice_date,
    tx_ref:        i.invoice_ref,
    customer_code: i.customer_code,
    description:   i.notes || (i.lp_load_number ? `Load: ${i.lp_load_number}` : 'Customer Invoice'),
    document_ref:  i.document_ref || null,
    debit:         i.total_incl_vat,    // invoices increase what customer owes us
    credit:        0,
    vat_amount:    i.vat_amount,
    excl_amount:   i.subtotal_excl_vat,
    status:        i.status,
    balance_due:   i.balance_due,
    due_date:      i.due_date,
    load_number:   i.lp_load_number || null,
  }));

  const receipts = (recRes.data || []).map(r => ({
    tx_type:       'RECEIPT',
    tx_date:       r.receipt_date,
    tx_ref:        r.receipt_ref,
    customer_code: r.customer_code,
    description:   `Receipt — ${r.payment_method || 'EFT'}${r.notes ? ': ' + r.notes : ''}`,
    document_ref:  null,
    debit:         0,
    credit:        r.amount,            // receipts reduce what customer owes
    vat_amount:    0,
    excl_amount:   r.amount,
    status:        'RECEIVED',
    balance_due:   0,
    due_date:      null,
    load_number:   null,
  }));

  const transactions = [...invoices, ...receipts].sort((a, b) =>
    b.tx_date.localeCompare(a.tx_date)
  );

  const totalInvoiced = invoices.reduce((s, r) => s + r.debit, 0);
  const totalReceived = receipts.reduce((s, r) => s + r.credit, 0);
  const outstanding   = totalInvoiced - totalReceived;

  res.json({
    transactions,
    totals: {
      total_invoiced: Math.round(totalInvoiced * 100) / 100,
      total_received: Math.round(totalReceived * 100) / 100,
      outstanding:    Math.round(outstanding   * 100) / 100,
    },
    count: transactions.length,
  });
});


// ─────────────────────────────────────────────────────────────
// FINANCIAL YEARS — for period dropdown in Periods page
// ─────────────────────────────────────────────────────────────

// GET /fin/financial-years — list all financial years
router.get('/financial-years', requireFin, async (req, res) => {
  const { data, error } = await supabase
    .from('fin_financial_years')
    .select('fy_id,fy_code,fy_start,fy_end,is_current')
    .order('fy_start', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /fin/periods-by-year/:fy_id — periods for a specific financial year
router.get('/periods-by-year/:fy_id', requireFin, async (req, res) => {
  const { data, error } = await supabase
    .from('fin_periods')
    .select('*')
    .eq('fy_id', req.params.fy_id)
    .order('period_id');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─────────────────────────────────────────────────────────────
// VAT TRANSACTIONS — detailed ledger by period / direction
// ─────────────────────────────────────────────────────────────

// GET /fin/vat-transactions
// Query params: vat_period (optional), direction OUTPUT|INPUT (optional), date_from, date_to
router.get('/vat-transactions', requireFin, async (req, res) => {
  const { vat_period, direction, date_from, date_to } = req.query;

  let query = supabase
    .from('fin_vat_transactions')
    .select('vat_id, vat_code, vat_direction, vat_period, transaction_date, tax_invoice_no, counterparty_vat_no, counterparty_name, exclusive_amount, vat_amount, inclusive_amount, gl_account_code, source_module, is_capital_goods')
    .order('transaction_date', { ascending: false })
    .limit(1000);

  if (vat_period) query = query.eq('vat_period', vat_period);
  if (direction)  query = query.eq('vat_direction', direction);
  if (date_from)  query = query.gte('transaction_date', date_from);
  if (date_to)    query = query.lte('transaction_date', date_to);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Lookup vat types separately
  const vatCodes = [...new Set((data || []).map(r => r.vat_code).filter(Boolean))];
  let vatTypesMap = {};
  if (vatCodes.length > 0) {
    const { data: vtData } = await supabase
      .from('fin_vat_types')
      .select('vat_code, description, rate_pct, vat201_field')
      .in('vat_code', vatCodes);
    (vtData || []).forEach(v => { vatTypesMap[v.vat_code] = v; });
  }

  // Flatten
  const rows = (data || []).map(r => ({
    vat_id:              r.vat_id,
    vat_code:            r.vat_code,
    vat_description:     vatTypesMap[r.vat_code]?.description,
    rate_pct:            vatTypesMap[r.vat_code]?.rate_pct,
    vat201_field:        vatTypesMap[r.vat_code]?.vat201_field,
    vat_direction:       r.vat_direction,
    vat_period:          r.vat_period,
    transaction_date:    r.transaction_date,
    tax_invoice_no:      r.tax_invoice_no,
    counterparty_vat_no: r.counterparty_vat_no,
    counterparty_name:   r.counterparty_name,
    exclusive_amount:    r.exclusive_amount,
    vat_amount:          r.vat_amount,
    inclusive_amount:    r.inclusive_amount,
    gl_account_code:     r.gl_account_code,
    source_module:       r.source_module,
    is_capital_goods:    r.is_capital_goods,
  }));

  // Totals by direction
  const output = rows.filter(r => r.vat_direction === 'OUTPUT');
  const input  = rows.filter(r => r.vat_direction === 'INPUT');

  res.json({
    transactions: rows,
    totals: {
      output_excl:  Math.round(output.reduce((s,r) => s + r.exclusive_amount, 0) * 100) / 100,
      output_vat:   Math.round(output.reduce((s,r) => s + r.vat_amount, 0)       * 100) / 100,
      input_excl:   Math.round(input.reduce((s,r) => s + r.exclusive_amount, 0)  * 100) / 100,
      input_vat:    Math.round(input.reduce((s,r) => s + r.vat_amount, 0)        * 100) / 100,
      net_vat:      Math.round((output.reduce((s,r) => s + r.vat_amount, 0) - input.reduce((s,r) => s + r.vat_amount, 0)) * 100) / 100,
    },
    count: rows.length,
  });
});

// GET /fin/vat-return/:period — VAT201-format summary for a specific VAT period
router.get('/vat-return/:period', requireFin, async (req, res) => {
  const vat_period = req.params.period; // e.g. '202605'

  const { data, error } = await supabase
    .from('fin_vat_transactions')
    .select('vat_code, vat_direction, exclusive_amount, vat_amount, inclusive_amount, is_capital_goods')
    .eq('vat_period', vat_period);

  if (error) return res.status(500).json({ error: error.message });

  // Lookup vat types for this period separately
  const vatCodesReturn = [...new Set((data || []).map(r => r.vat_code).filter(Boolean))];
  let vatTypesReturnMap = {};
  if (vatCodesReturn.length > 0) {
    const { data: vtRet } = await supabase
      .from('fin_vat_types')
      .select('vat_code, description, rate_pct, vat201_field')
      .in('vat_code', vatCodesReturn);
    (vtRet || []).forEach(v => { vatTypesReturnMap[v.vat_code] = v; });
  }

  const rows = (data || []).map(r => ({ ...r, _vt: vatTypesReturnMap[r.vat_code] || {} }));

  // Helper to sum
  const sum = (arr, field) => arr.reduce((s, r) => s + (r[field] || 0), 0);

  // Output rows
  // Use Number() coercion — Supabase can return numeric as string or float
  const rate = (r) => Number(r._vt?.rate_pct ?? -1);
  const field = (r) => r._vt?.vat201_field;

  const output_std    = rows.filter(r => r.vat_direction === 'OUTPUT' && !r.is_capital_goods && rate(r) > 0);
  const output_cap    = rows.filter(r => r.vat_direction === 'OUTPUT' && r.is_capital_goods);
  const output_zero   = rows.filter(r => r.vat_direction === 'OUTPUT' && rate(r) === 0 && field(r) === '2');
  const output_zeroex = rows.filter(r => r.vat_direction === 'OUTPUT' && rate(r) === 0 && field(r) === '2A');

  // Input rows
  const input_cap     = rows.filter(r => r.vat_direction === 'INPUT' && r.is_capital_goods);
  const input_std     = rows.filter(r => r.vat_direction === 'INPUT' && !r.is_capital_goods);

  const field1   = Math.round(sum(output_std, 'exclusive_amount')  * 100) / 100;
  const field4   = Math.round(sum(output_std, 'vat_amount')        * 100) / 100;
  const field1A  = Math.round(sum(output_cap, 'exclusive_amount')  * 100) / 100;
  const field4A  = Math.round(sum(output_cap, 'vat_amount')        * 100) / 100;
  const field2   = Math.round(sum(output_zero, 'exclusive_amount') * 100) / 100;
  const field2A  = Math.round(sum(output_zeroex, 'exclusive_amount') * 100) / 100;
  const field13  = Math.round((field4 + field4A) * 100) / 100;  // Total Output Tax
  const field14  = Math.round(sum(input_cap, 'exclusive_amount')   * 100) / 100;
  const field14_vat = Math.round(sum(input_cap, 'vat_amount')      * 100) / 100;
  const field15  = Math.round(sum(input_std, 'exclusive_amount')   * 100) / 100;
  const field15_vat = Math.round(sum(input_std, 'vat_amount')      * 100) / 100;
  const field19  = Math.round((field14_vat + field15_vat)          * 100) / 100;  // Total Input Tax
  const field20  = Math.round((field13 - field19)                  * 100) / 100;  // VAT Payable/Refundable

  res.json({
    vat_period,
    fields: {
      field1,  field4,
      field1A, field4A,
      field2,  field2A,
      field13,
      // field14 = INPUT capital VAT amount (what SARS calls field 14)
      // field14_excl = exclusive base (informational only)
      field14:      field14_vat,   // VAT amount — this is what goes on the return
      field14_excl: field14,       // Exclusive base — informational
      field15:      field15_vat,   // VAT amount — this is what goes on the return
      field15_excl: field15,       // Exclusive base — informational
      field19,
      field20,
    },
    totals: {
      output_excl:  Math.round((sum(output_std, 'exclusive_amount') + sum(output_cap, 'exclusive_amount')) * 100) / 100,
      output_vat:   field13,
      input_excl:   Math.round((field14 + field15) * 100) / 100,
      input_vat:    field19,
    },
    payable:    field20 > 0,
    refundable: field20 < 0,
    transaction_count: rows.length,
  });
});


// ─────────────────────────────────────────────────────────────
// ASSET TRANSACTIONS (per-asset depreciation run history)
// ─────────────────────────────────────────────────────────────

// GET /fin/asset-transactions/:asset_code
// Returns all depreciation runs for a specific asset, joined to period names
router.get('/asset-transactions/:asset_code', requireFin, async (req, res) => {
  const { asset_code } = req.params;
  const { date_from, date_to } = req.query;

  // First get the asset to confirm it exists and get asset_id
  const { data: asset, error: assetErr } = await supabase
    .from('fin_assets')
    .select('asset_id, asset_code, description, class_code, purchase_price, purchase_date, depre_start_date, book_nbv, tax_value, book_depre_total, is_active, disposal_date, disposal_proceeds')
    .eq('asset_code', asset_code)
    .single();

  if (assetErr) return res.status(404).json({ error: 'Asset not found' });

  // Get depreciation runs joined to periods
  let runsQ = supabase
    .from('fin_depreciation_runs')
    .select('run_id, run_date, book_depre_amount, tax_depre_amount, book_nbv_after, tax_value_after, timing_difference, deferred_tax, journal_id, period_id')
    .eq('asset_id', asset.asset_id)
    .order('run_date', { ascending: false });

  if (date_from) runsQ = runsQ.gte('run_date', date_from);
  if (date_to)   runsQ = runsQ.lte('run_date', date_to);

  const { data: runs, error: runsErr } = await runsQ;
  if (runsErr) return res.status(500).json({ error: runsErr.message });

  // Lookup period names separately
  const periodIds = [...new Set((runs || []).map(r => r.period_id).filter(Boolean))];
  let periodsMap = {};
  if (periodIds.length > 0) {
    const { data: periods } = await supabase
      .from('fin_periods')
      .select('period_id, period_name, period_start, period_end')
      .in('period_id', periodIds);
    (periods || []).forEach(p => { periodsMap[p.period_id] = p; });
  }

  const rows = (runs || []).map(r => ({
    run_id:            r.run_id,
    run_date:          r.run_date,
    period_name:       periodsMap[r.period_id]?.period_name,
    period_start:      periodsMap[r.period_id]?.period_start,
    period_end:        periodsMap[r.period_id]?.period_end,
    book_depre_amount: r.book_depre_amount,
    tax_depre_amount:  r.tax_depre_amount,
    book_nbv_after:    r.book_nbv_after,
    tax_value_after:   r.tax_value_after,
    timing_difference: r.timing_difference,
    deferred_tax:      r.deferred_tax,
    journal_id:        r.journal_id,
  }));

  const totalBookDepre = rows.reduce((s, r) => s + (r.book_depre_amount || 0), 0);
  const totalTaxDepre  = rows.reduce((s, r) => s + (r.tax_depre_amount  || 0), 0);

  res.json({
    asset,
    transactions: rows,
    totals: {
      total_book_depre: Math.round(totalBookDepre * 100) / 100,
      total_tax_depre:  Math.round(totalTaxDepre  * 100) / 100,
      run_count:        rows.length,
    },
  });
});

// ─────────────────────────────────────────────────────────────
// ASSET REGISTER (summary per asset with period-filtered depreciation)
// ─────────────────────────────────────────────────────────────

// GET /fin/asset-register
// Query params: class_code, asset_code, date_from, date_to, show_additions, show_disposals
router.get('/asset-register', requireFin, async (req, res) => {
  const { class_code, asset_code, date_from, date_to, show_additions, show_disposals } = req.query;

  // Fetch asset classes separately — avoid unreliable PostgREST join shorthand
  const { data: classData } = await supabase
    .from('fin_asset_classes')
    .select('class_code, class_name, gl_cost_account, gl_accum_account, sars_wt_rate_pct, ifrs_useful_life_yr');
  const classMap = {};
  (classData || []).forEach(c => { classMap[c.class_code] = c; });

  // Build asset filter — flat select only
  let assetsQ = supabase
    .from('fin_assets')
    .select('asset_id, asset_code, description, class_code, purchase_date, purchase_price, depre_start_date, book_depre_total, book_depre_prior, book_depre_curr_yr, book_nbv, tax_value, is_active, fully_depreciated, disposal_date, disposal_proceeds, location, reg_number')
    .order('class_code')
    .order('asset_code');

  if (class_code) assetsQ = assetsQ.eq('class_code', class_code);
  if (asset_code) assetsQ = assetsQ.eq('asset_code', asset_code);

  // Filter for new additions during period
  if (show_additions === 'true' && date_from) assetsQ = assetsQ.gte('purchase_date', date_from);
  if (show_additions === 'true' && date_to)   assetsQ = assetsQ.lte('purchase_date', date_to);

  // Filter for disposals during period
  if (show_disposals === 'true') {
    assetsQ = assetsQ.eq('is_active', false).not('disposal_date', 'is', null);
    if (date_from) assetsQ = assetsQ.gte('disposal_date', date_from);
    if (date_to)   assetsQ = assetsQ.lte('disposal_date', date_to);
  }

  const { data: assets, error: aErr } = await assetsQ;
  if (aErr) return res.status(500).json({ error: aErr.message });

  const assetIds = (assets || []).map(a => a.asset_id);

  // Get depreciation runs split into two buckets:
  //   openingDepre = runs BEFORE date_from  (opening accumulated depreciation)
  //   periodDepre  = runs within date_from..date_to (depreciation for the period)
  let openingDepre = {};
  let periodDepre  = {};

  if (assetIds.length > 0) {
    // Opening: all runs before date_from (gives opening accumulated depre at start of period)
    if (date_from) {
      let openQ = supabase
        .from('fin_depreciation_runs')
        .select('asset_id, book_depre_amount, tax_depre_amount')
        .in('asset_id', assetIds)
        .lt('run_date', date_from);
      const { data: openRuns } = await openQ;
      (openRuns || []).forEach(r => {
        if (!openingDepre[r.asset_id]) openingDepre[r.asset_id] = { book: 0, tax: 0 };
        openingDepre[r.asset_id].book += r.book_depre_amount || 0;
        openingDepre[r.asset_id].tax  += r.tax_depre_amount  || 0;
      });
    }

    // Period: runs within date_from..date_to
    if (date_from || date_to) {
      let perQ = supabase
        .from('fin_depreciation_runs')
        .select('asset_id, book_depre_amount, tax_depre_amount')
        .in('asset_id', assetIds);
      if (date_from) perQ = perQ.gte('run_date', date_from);
      if (date_to)   perQ = perQ.lte('run_date', date_to);
      const { data: perRuns } = await perQ;
      (perRuns || []).forEach(r => {
        if (!periodDepre[r.asset_id]) periodDepre[r.asset_id] = { book: 0, tax: 0 };
        periodDepre[r.asset_id].book += r.book_depre_amount || 0;
        periodDepre[r.asset_id].tax  += r.tax_depre_amount  || 0;
      });
    }
  }

  // Build register rows
  const rows = (assets || []).map(a => {
    const pd = periodDepre[a.asset_id] || { book: 0, tax: 0 };
    return {
      asset_id:           a.asset_id,
      asset_code:         a.asset_code,
      description:        a.description,
      class_code:         a.class_code,
      class_name:         classMap[a.class_code]?.class_name,
      gl_cost_account:    classMap[a.class_code]?.gl_cost_account,
      gl_accum_account:   classMap[a.class_code]?.gl_accum_account,
      sars_wt_rate_pct:   classMap[a.class_code]?.sars_wt_rate_pct,
      ifrs_useful_life_yr:classMap[a.class_code]?.ifrs_useful_life_yr,
      purchase_date:      a.purchase_date,
      purchase_price:     a.purchase_price,           // Cost
      depre_start_date:   a.depre_start_date,
      accumulated_depre:  Math.round((a.book_depre_total || 0) * 100) / 100,
      curr_yr_depre:      Math.round((a.book_depre_curr_yr || 0) * 100) / 100,
      opening_depre_book: date_from ? Math.round((openingDepre[a.asset_id]?.book || 0) * 100) / 100 : null,
      opening_depre_tax:  date_from ? Math.round((openingDepre[a.asset_id]?.tax  || 0) * 100) / 100 : null,
      period_depre_book:  Math.round(pd.book * 100) / 100,
      period_depre_tax:   Math.round(pd.tax  * 100) / 100,
      closing_depre_book: date_from ? Math.round(((openingDepre[a.asset_id]?.book || 0) + pd.book) * 100) / 100 : null,
      book_nbv:           a.book_nbv,
      tax_value:          a.tax_value,
      timing_difference:  Math.round(((a.book_nbv || 0) - (a.tax_value || 0)) * 100) / 100,
      deferred_tax_27pct: Math.round(((a.book_nbv || 0) - (a.tax_value || 0)) * 0.27 * 100) / 100,
      location:           a.location,
      reg_number:         a.reg_number,
      is_active:          a.is_active,
      fully_depreciated:  a.fully_depreciated,
      disposal_date:      a.disposal_date,
      disposal_proceeds:  a.disposal_proceeds,
    };
  });

  // Group by class for summary
  const classSummary = {};
  rows.forEach(r => {
    if (!classSummary[r.class_code]) {
      classSummary[r.class_code] = { class_code: r.class_code, class_name: r.class_name, count: 0, cost: 0, accum_depre: 0, curr_yr_depre: 0, opening_depre: 0, period_depre: 0, closing_depre: 0, book_nbv: 0 };
    }
    const cs = classSummary[r.class_code];
    cs.count         += 1;
    cs.cost          += r.purchase_price    || 0;
    cs.accum_depre   += r.accumulated_depre || 0;
    cs.curr_yr_depre += r.curr_yr_depre     || 0;
    cs.opening_depre += r.opening_depre_book|| 0;
    cs.period_depre  += r.period_depre_book || 0;
    cs.closing_depre += r.closing_depre_book|| 0;
    cs.book_nbv      += r.book_nbv          || 0;
  });

  const totals = {
    count:         rows.length,
    total_cost:    Math.round(rows.reduce((s,r) => s + (r.purchase_price    || 0), 0) * 100) / 100,
    total_accum:   Math.round(rows.reduce((s,r) => s + (r.accumulated_depre || 0), 0) * 100) / 100,
    total_curr_yr: Math.round(rows.reduce((s,r) => s + (r.curr_yr_depre      || 0), 0) * 100) / 100,
    total_opening: date_from ? Math.round(rows.reduce((s,r) => s + (r.opening_depre_book || 0), 0) * 100) / 100 : null,
    total_period:  Math.round(rows.reduce((s,r) => s + (r.period_depre_book || 0), 0) * 100) / 100,
    total_closing: date_from ? Math.round(rows.reduce((s,r) => s + (r.closing_depre_book || 0), 0) * 100) / 100 : null,
    total_nbv:     Math.round(rows.reduce((s,r) => s + (r.book_nbv          || 0), 0) * 100) / 100,
  };

  res.json({
    rows,
    class_summary: Object.values(classSummary).map(cs => ({
      ...cs,
      cost:         Math.round(cs.cost         * 100) / 100,
      accum_depre:  Math.round(cs.accum_depre  * 100) / 100,
      curr_yr_depre:Math.round(cs.curr_yr_depre* 100) / 100,
      opening_depre:Math.round(cs.opening_depre* 100) / 100,
      period_depre: Math.round(cs.period_depre * 100) / 100,
      closing_depre:Math.round(cs.closing_depre* 100) / 100,
      book_nbv:     Math.round(cs.book_nbv     * 100) / 100,
    })),
    totals,
    filters: { class_code, asset_code, date_from, date_to, show_additions, show_disposals },
  });
});


// ─────────────────────────────────────────────────────────────
// INCOME STATEMENT
// ─────────────────────────────────────────────────────────────

// GET /fin/income-statement
// Query params: date_from, date_to (required — YYYY-MM-DD)
// Returns: per-account balances grouped by IS section, with monthly columns
// when date range spans multiple periods
router.get('/income-statement', requireFin, async (req, res) => {
  const { date_from, date_to } = req.query;
  if (!date_from || !date_to) {
    return res.status(400).json({ error: 'date_from and date_to are required' });
  }

  // 1. Get all IS accounts (Income Statement only, active)
  const { data: accounts, error: accErr } = await supabase
    .from('fin_gl_accounts')
    .select('account_code, account_name, category, account_type, is_sub_account, parent_code')
    .eq('ifrs_classification', 'Income Statement')
    .eq('active', true)
    .order('account_code');

  if (accErr) return res.status(500).json({ error: accErr.message });

  // 2. Get all periods that fall within the date range
  const { data: periods, error: perErr } = await supabase
    .from('fin_periods')
    .select('period_id, period_name, period_start, period_end')
    .gte('period_end',   date_from)
    .lte('period_start', date_to)
    .order('period_id');

  if (perErr) return res.status(500).json({ error: perErr.message });

  const periodIds = (periods || []).map(p => p.period_id);
  const accountCodes = (accounts || []).map(a => a.account_code);

  // 3. Get journal lines for those periods, for IS accounts
  // Separate queries for current period and prior year
  let lines = [];
  if (periodIds.length > 0 && accountCodes.length > 0) {
    // Get posted journals in the period range first
    const { data: journals } = await supabase
      .from('fin_gl_journals')
      .select('journal_id, period_id')
      .in('period_id', periodIds)
      .eq('posted', true);

    const journalIds = (journals || []).map(j => j.journal_id);
    const journalPeriodMap = {};
    (journals || []).forEach(j => { journalPeriodMap[j.journal_id] = j.period_id; });

    if (journalIds.length > 0) {
      const { data: jLines } = await supabase
        .from('fin_gl_journal_lines')
        .select('account_code, debit, credit, journal_id')
        .in('journal_id', journalIds)
        .in('account_code', accountCodes);

      lines = (jLines || []).map(l => ({
        ...l,
        fin_gl_journals: { period_id: journalPeriodMap[l.journal_id], posted: true }
      }));
    }
  }

  // 4. Separate query for prior year (same period range, 1 year back)
  const priorFrom = new Date(date_from);
  const priorTo   = new Date(date_to);
  priorFrom.setFullYear(priorFrom.getFullYear() - 1);
  priorTo.setFullYear(priorTo.getFullYear() - 1);

  const { data: priorPeriods } = await supabase
    .from('fin_periods')
    .select('period_id, period_name, period_start, period_end')
    .gte('period_end',   priorFrom.toISOString().slice(0,10))
    .lte('period_start', priorTo.toISOString().slice(0,10))
    .order('period_id');

  const priorPeriodIds = (priorPeriods || []).map(p => p.period_id);
  let priorLines = [];
  if (priorPeriodIds.length > 0 && accountCodes.length > 0) {
    const { data: priorJournals } = await supabase
      .from('fin_gl_journals')
      .select('journal_id')
      .in('period_id', priorPeriodIds)
      .eq('posted', true);
    const priorJournalIds = (priorJournals || []).map(j => j.journal_id);
    if (priorJournalIds.length > 0) {
      const { data: pLines } = await supabase
        .from('fin_gl_journal_lines')
        .select('account_code, debit, credit')
        .in('journal_id', priorJournalIds)
        .in('account_code', accountCodes);
      priorLines = pLines || [];
    }
  }

  // 5. Build account balances per period and totals
  // Income accounts: credit = positive, debit = negative
  // Expense accounts: debit = positive, credit = negative

  const isIncomeType = (cat) => ['Income', 'Other Income'].includes(cat);
  const isExpenseType = (cat) => ['Cost of Sales', 'Expenses'].includes(cat);

  const getNet = (debit, credit, category) => {
    if (isIncomeType(category))  return (credit || 0) - (debit || 0);
    if (isExpenseType(category)) return (debit  || 0) - (credit || 0);
    return (credit || 0) - (debit || 0);
  };

  // Build period map: { period_id: { account_code: net } }
  const periodBalances = {};
  (periods || []).forEach(p => { periodBalances[p.period_id] = {}; });

  lines.forEach(l => {
    const pid = l.fin_gl_journals?.period_id;
    const acc = accounts.find(a => a.account_code === l.account_code);
    if (!pid || !acc) return;
    if (!periodBalances[pid]) periodBalances[pid] = {};
    const current = periodBalances[pid][l.account_code] || 0;
    periodBalances[pid][l.account_code] = current + getNet(l.debit, l.credit, acc.category);
  });

  // Build prior year totals per account
  const priorTotals = {};
  priorLines.forEach(l => {
    const acc = accounts.find(a => a.account_code === l.account_code);
    if (!acc) return;
    priorTotals[l.account_code] = (priorTotals[l.account_code] || 0) + getNet(l.debit, l.credit, acc.category);
  });

  // Build YTD per account
  const ytdTotals = {};
  lines.forEach(l => {
    const acc = accounts.find(a => a.account_code === l.account_code);
    if (!acc) return;
    ytdTotals[l.account_code] = (ytdTotals[l.account_code] || 0) + getNet(l.debit, l.credit, acc.category);
  });

  // 6. Assemble rows
  const rows = (accounts || []).map(a => {
    const periodData = {};
    (periods || []).forEach(p => {
      periodData[p.period_id] = Math.round((periodBalances[p.period_id]?.[a.account_code] || 0) * 100) / 100;
    });
    return {
      account_code:   a.account_code,
      account_name:   a.account_name,
      category:       a.category,
      account_type:   a.account_type,
      is_sub_account: a.is_sub_account,
      parent_account: a.parent_code,
      period_data:    periodData,
      ytd:            Math.round((ytdTotals[a.account_code] || 0) * 100) / 100,
      prior_year:     Math.round((priorTotals[a.account_code] || 0) * 100) / 100,
    };
  });

  res.json({
    periods: periods || [],
    rows,
    date_from,
    date_to,
    prior_date_from: priorFrom.toISOString().slice(0,10),
    prior_date_to:   priorTo.toISOString().slice(0,10),
  });
});


// ─────────────────────────────────────────────────────────────
// CASHBOOK
// ─────────────────────────────────────────────────────────────

// GET /fin/cashbook/entries
// All posted cashbook journal lines (actual GL transactions on bank accounts)
router.get('/cashbook/entries', requireFin, async (req, res) => {
  const { bank_account, date_from, date_to, direction } = req.query;

  // Bank account codes: 8400 (Nedbank), 8410 (Call), 8420 (Petty Cash)
  // Get journal lines for bank GL accounts
  const bankAccounts = bank_account
    ? [bank_account]
    : ['8400', '8410', '8420', '8499'];

  // Get posted journals in range
  let jQ = supabase
    .from('fin_gl_journals')
    .select('journal_id, journal_ref, journal_date, journal_type, description, source_module, source_document')
    .eq('posted', true)
    .order('journal_date', { ascending: false })
    .limit(1000);

  if (date_from) jQ = jQ.gte('journal_date', date_from);
  if (date_to)   jQ = jQ.lte('journal_date', date_to);

  const { data: journals, error: jErr } = await jQ;
  if (jErr) return res.status(500).json({ error: jErr.message });

  const journalIds = (journals || []).map(j => j.journal_id);
  const jMap = {};
  (journals || []).forEach(j => { jMap[j.journal_id] = j; });

  if (!journalIds.length) {
    return res.json({ entries: [], totals: { receipts: 0, payments: 0, net: 0 } });
  }

  // Get lines on bank accounts
  const { data: lines, error: lErr } = await supabase
    .from('fin_gl_journal_lines')
    .select('line_id, journal_id, account_code, description, debit, credit')
    .in('journal_id', journalIds)
    .in('account_code', bankAccounts);

  if (lErr) return res.status(500).json({ error: lErr.message });

  // For each bank line, also get the contra account(s) from same journal
  const entries = (lines || []).map(l => {
    const j = jMap[l.journal_id] || {};
    // Bank: debit = receipt (money in), credit = payment (money out)
    const isReceipt = (l.debit || 0) > 0;
    const amount    = isReceipt ? (l.debit || 0) : (l.credit || 0);
    const dir       = isReceipt ? 'RECEIPT' : 'PAYMENT';
    return {
      line_id:       l.line_id,
      journal_id:    l.journal_id,
      journal_ref:   j.journal_ref,
      journal_date:  j.journal_date,
      journal_type:  j.journal_type,
      description:   l.description || j.description,
      bank_account:  l.account_code,
      amount,
      direction:     dir,
      source_module: j.source_module,
    };
  }).filter(e => !direction || e.direction === direction)
    .sort((a, b) => (b.journal_date || '').localeCompare(a.journal_date || ''));

  const receipts = entries.filter(e => e.direction === 'RECEIPT').reduce((s, e) => s + e.amount, 0);
  const payments = entries.filter(e => e.direction === 'PAYMENT').reduce((s, e) => s + e.amount, 0);

  res.json({
    entries,
    totals: {
      receipts: Math.round(receipts * 100) / 100,
      payments: Math.round(payments * 100) / 100,
      net:      Math.round((receipts - payments) * 100) / 100,
    },
  });
});

// GET /fin/cashbook/staging — existing, enhanced with direction filter
// Already exists above, keeping for backwards compat

// POST /fin/cashbook/entry — manual cashbook entry (posts a GL journal)
router.post('/cashbook/entry', requireFin, async (req, res) => {
  const {
    bank_account, contra_account, description, amount,
    direction, transaction_date, period_id, reference, vat_type,
  } = req.body;

  if (!bank_account)     return res.status(400).json({ error: 'bank_account is required' });
  if (!contra_account)   return res.status(400).json({ error: 'contra_account is required' });
  if (!description?.trim()) return res.status(400).json({ error: 'description is required' });
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount must be positive' });
  if (!direction || !['RECEIPT','PAYMENT'].includes(direction)) {
    return res.status(400).json({ error: 'direction must be RECEIPT or PAYMENT' });
  }
  if (!transaction_date) return res.status(400).json({ error: 'transaction_date is required' });
  if (!period_id)        return res.status(400).json({ error: 'period_id is required' });

  // Check period not locked
  const { data: period } = await supabase
    .from('fin_periods')
    .select('is_closed, period_name')
    .eq('period_id', period_id)
    .single();
  if (!period)          return res.status(404).json({ error: 'Period not found' });
  if (period.is_closed) return res.status(400).json({ error: `Period ${period.period_name} is locked` });

  // Generate ref
  const datePart = transaction_date.replace(/-/g, '').slice(0, 6);
  const prefix   = direction === 'RECEIPT' ? 'CB-REC' : 'CB-PAY';
  const { count } = await supabase
    .from('fin_gl_journals')
    .select('*', { count: 'exact', head: true })
    .like('journal_ref', `${prefix}-${datePart}-%`);
  const seq         = String((count || 0) + 1).padStart(5, '0');
  const journal_ref = `${prefix}-${datePart}-${seq}`;

  // Build lines:
  // RECEIPT: DR bank, CR contra
  // PAYMENT: CR bank, DR contra
  let vatAmount = 0;
  if (vat_type && vat_type !== 'NONE') {
    const { data: vtRow } = await supabase
      .from('fin_vat_types').select('rate_pct').eq('vat_code', vat_type).single();
    const rate = vtRow ? Number(vtRow.rate_pct) : 15;
    vatAmount = Math.round((amount - amount / (1 + rate / 100)) * 100) / 100;
  }

  const lines = direction === 'RECEIPT'
    ? [
        { account_code: bank_account,   description, debit: amount, credit: 0, vat_type: null, vat_amount: 0 },
        { account_code: contra_account, description, debit: 0, credit: amount, vat_type: vat_type || null, vat_amount: vatAmount },
      ]
    : [
        { account_code: contra_account, description, debit: amount, credit: 0, vat_type: vat_type || null, vat_amount: vatAmount },
        { account_code: bank_account,   description, debit: 0, credit: amount, vat_type: null, vat_amount: 0 },
      ];

  // Post journal
  const { data: journal, error: jErr } = await supabase
    .from('fin_gl_journals')
    .insert({
      journal_ref,
      journal_type:  direction === 'RECEIPT' ? 'CB_REC' : 'CB_PAY',
      description,
      period_id,
      journal_date:  transaction_date,
      source_module: 'CASHBOOK',
      source_document: reference || null,
      posted:        true,
      posted_at:     new Date().toISOString(),
      posted_by:     req.user.username,
      created_by:    req.user.username,
    })
    .select()
    .single();

  if (jErr) return res.status(500).json({ error: jErr.message });

  const lineRows = lines.map((l, i) => ({
    journal_id:   journal.journal_id,
    line_number:  i + 1,
    account_code: l.account_code,
    description:  l.description,
    debit:        l.debit,
    credit:       l.credit,
    vat_type:     l.vat_type,
    vat_amount:   l.vat_amount,
  }));

  const { error: lErr } = await supabase
    .from('fin_gl_journal_lines')
    .insert(lineRows);

  if (lErr) {
    await supabase.from('fin_gl_journals').delete().eq('journal_id', journal.journal_id);
    return res.status(500).json({ error: lErr.message });
  }

  res.json({ success: true, journal_ref, journal_id: journal.journal_id });
});

// GET /fin/cashbook/bank-accounts — GL accounts classified as bank/cash
router.get('/cashbook/bank-accounts', requireFin, async (req, res) => {
  const { data, error } = await supabase
    .from('fin_gl_accounts')
    .select('account_code, account_name')
    .in('account_code', ['8400', '8410', '8420', '8490', '8495', '8499'])
    .eq('active', true)
    .order('account_code');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});


// ─────────────────────────────────────────────────────────────────────────────
// PATCH /fin/accounts/:id — update an existing GL account (all fields editable)
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/accounts/:id', requireFin, async (req, res) => {
  const { id } = req.params;
  const allowed = [
    'account_code','account_name','category','ifrs_classification',
    'account_type','vat_treatment','allowed_vat_codes','vat_notes',
    'is_sub_account','parent_code','default_vat_type','allow_journals',
    'active','notes',
  ];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No fields to update' });

  const { data, error } = await supabase
    .from('fin_gl_accounts')
    .update(updates)
    .eq('account_id', id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /fin/audit-log — GL audit log export
// ─────────────────────────────────────────────────────────────────────────────
router.get('/audit-log', requireFin, async (req, res) => {
  const { date_from, date_to, table_name, limit = 500 } = req.query;
  let query = supabase
    .from('fin_gl_audit_log')
    .select('*')
    .order('event_time', { ascending: false })
    .limit(Number(limit));
  if (date_from) query = query.gte('event_time', date_from);
  if (date_to)   query = query.lte('event_time', date_to + 'T23:59:59');
  if (table_name) query = query.eq('table_name', table_name);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /fin/cashbook/staging/post-bulk — post all MATCHED entries in a batch
router.post('/cashbook/staging/post-bulk', requireFin, async (req, res) => {
  const { staging_ids } = req.body; // array of IDs, or omit for all MATCHED
  let query = supabase
    .from('fin_cb_staging')
    .select('staging_id')
    .eq('status', 'MATCHED');
  if (staging_ids?.length) query = query.in('staging_id', staging_ids);
  const { data: toPost } = await query;

  const results = { posted: 0, failed: 0, errors: [] };
  for (const entry of (toPost || [])) {
    try {
      const r = await fetch(
        `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/fin/cashbook/staging/${entry.staging_id}/post`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${req.headers.authorization?.split(' ')[1]}`,
          },
        }
      );
      const json = await r.json();
      if (json.error) { results.failed++; results.errors.push(`${entry.staging_id}: ${json.error}`); }
      else results.posted++;
    } catch (e) {
      results.failed++;
      results.errors.push(`${entry.staging_id}: ${e.message}`);
    }
  }
  res.json(results);
});


// POST /fin/cashbook/staging/:id/post — post a staged cashbook entry to GL
// ─────────────────────────────────────────────────────────────────────────────
router.post('/cashbook/staging/:id/post', requireFin, async (req, res) => {
  const { id } = req.params;

  const { data: entry, error: fetchErr } = await supabase
    .from('fin_cb_staging')
    .select('*')
    .eq('staging_id', id)
    .single();

  if (fetchErr || !entry) return res.status(404).json({ error: 'Staging entry not found' });
  if (entry.status === 'POSTED') return res.status(400).json({ error: 'Already posted' });
  if (!entry.gl_account_code) return res.status(400).json({ error: 'GL account must be assigned before posting' });
  if (!entry.entity_id) return res.status(400).json({ error: 'Entity not set on staging entry' });

  // Find the open period for this transaction date
  const { data: period } = await supabase
    .from('fin_periods')
    .select('period_id, period_name, is_closed')
    .lte('period_start', entry.transaction_date)
    .gte('period_end',   entry.transaction_date)
    .eq('entity_id',     entry.entity_id)
    .single();

  if (!period)          return res.status(400).json({ error: `No period found for date ${entry.transaction_date}` });
  if (period.is_closed) return res.status(400).json({ error: `Period ${period.period_name} is locked` });

  // Auto-generate journal ref: CB-YYYYMM-NNNNN
  const datePart = entry.transaction_date.replace(/-/g,'').slice(0,6);
  const { count } = await supabase
    .from('fin_gl_journals')
    .select('*', { count: 'exact', head: true })
    .like('journal_ref', `CB-${datePart}-%`);
  const seq         = String((count || 0) + 1).padStart(5, '0');
  const journal_ref = `CB-${datePart}-${seq}`;

  // Cashbook journal: bank account DR/CR, contra account CR/DR
  const isReceipt = entry.direction === 'RECEIPT' || entry.amount > 0;
  const absAmount = Math.abs(entry.amount);
  const vatAmt    = entry.vat_type && entry.vat_type !== 'NONE' ? absAmount - (absAmount / 1.15) : 0;
  const exclAmt   = absAmount - vatAmt;

  const lines = [
    {
      line_number:  1,
      account_code: entry.bank_account,
      description:  entry.description,
      debit:        isReceipt ? absAmount : 0,
      credit:       isReceipt ? 0 : absAmount,
      vat_type:     null,
      vat_amount:   0,
    },
    {
      line_number:  2,
      account_code: entry.gl_account_code,
      description:  entry.journal_description || entry.description,
      debit:        isReceipt ? 0 : exclAmt,
      credit:       isReceipt ? exclAmt : 0,
      vat_type:     entry.vat_type !== 'NONE' ? entry.vat_type : null,
      vat_amount:   vatAmt,
    },
  ];

  // Add VAT line if applicable
  if (vatAmt > 0) {
    lines.push({
      line_number:  3,
      account_code: '9500', // VAT control account
      description:  `VAT on ${entry.description}`,
      debit:        isReceipt ? 0 : vatAmt,
      credit:       isReceipt ? vatAmt : 0,
      vat_type:     entry.vat_type,
      vat_amount:   vatAmt,
    });
  }

  // Create journal
  const { data: journal, error: jErr } = await supabase
    .from('fin_gl_journals')
    .insert({
      journal_ref,
      journal_type:  'CB',
      description:   entry.description,
      period_id:     period.period_id,
      journal_date:  entry.transaction_date,
      source_module: 'CASHBOOK',
      source_document: entry.import_batch,
      posted:        true,
      posted_at:     new Date().toISOString(),
      posted_by:     req.user.username,
      created_by:    req.user.username,
    })
    .select()
    .single();

  if (jErr) return res.status(500).json({ error: jErr.message });

  await supabase.from('fin_gl_journal_lines').insert(
    lines.map(l => ({ ...l, journal_id: journal.journal_id }))
  );

  // Mark staging entry as POSTED
  await supabase
    .from('fin_cb_staging')
    .update({
      status:     'POSTED',
      journal_id: journal.journal_id,
      journal_ref,
      posted_by:  req.user.username,
      posted_at:  new Date().toISOString(),
    })
    .eq('staging_id', id);

  res.json({ success: true, journal_ref, journal_id: journal.journal_id });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET  /fin/cashbook/bank-recon — list recons for a bank account / period
// POST /fin/cashbook/bank-recon — create or update a bank recon
// ─────────────────────────────────────────────────────────────────────────────
router.get('/cashbook/bank-recon', requireFin, async (req, res) => {
  const { bank_account, period_id } = req.query;
  let query = supabase
    .from('fin_cb_bank_recon')
    .select('*, fin_periods(period_name, period_start, period_end)')
    .order('recon_date', { ascending: false })
    .limit(50);
  if (bank_account) query = query.eq('bank_account', bank_account);
  if (period_id)    query = query.eq('period_id', period_id);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.get('/cashbook/bank-recon/:id', requireFin, async (req, res) => {
  const { data: recon, error } = await supabase
    .from('fin_cb_bank_recon')
    .select('*')
    .eq('recon_id', req.params.id)
    .single();
  if (error) return res.status(404).json({ error: 'Recon not found' });

  const { data: items } = await supabase
    .from('fin_cb_recon_items')
    .select('*')
    .eq('recon_id', req.params.id)
    .order('created_at');

  // Calculate GL closing balance from posted journals
  const { data: period } = await supabase
    .from('fin_periods')
    .select('period_start, period_end')
    .eq('period_id', recon.period_id)
    .single();

  let glBalance = 0;
  if (period) {
    const { data: journals } = await supabase
      .from('fin_gl_journals')
      .select('journal_id')
      .eq('posted', true)
      .lte('journal_date', period.period_end);
    const jIds = (journals || []).map(j => j.journal_id);
    if (jIds.length) {
      const { data: lines } = await supabase
        .from('fin_gl_journal_lines')
        .select('debit, credit')
        .in('journal_id', jIds)
        .eq('account_code', recon.bank_account);
      glBalance = (lines || []).reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0);
    }
  }

  res.json({ recon, items: items || [], gl_balance: glBalance });
});

router.post('/cashbook/bank-recon', requireFin, async (req, res) => {
  const {
    period_id, bank_account, recon_date,
    bank_stmt_opening, bank_stmt_closing, notes, items,
  } = req.body;

  if (!period_id)      return res.status(400).json({ error: 'period_id is required' });
  if (!bank_account)   return res.status(400).json({ error: 'bank_account is required' });
  if (!recon_date)     return res.status(400).json({ error: 'recon_date is required' });

  // Get GL balance for this bank account up to recon_date
  const { data: journals } = await supabase
    .from('fin_gl_journals')
    .select('journal_id')
    .eq('posted', true)
    .lte('journal_date', recon_date);
  const jIds = (journals || []).map(j => j.journal_id);
  let glClosing = 0;
  if (jIds.length) {
    const { data: lines } = await supabase
      .from('fin_gl_journal_lines')
      .select('debit, credit')
      .in('journal_id', jIds)
      .eq('account_code', bank_account);
    glClosing = (lines || []).reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0);
  }

  // Calculate outstanding items totals from provided items
  const itemList = items || [];
  const outDeposits = itemList.filter(i => i.item_type === 'OUTSTANDING_DEPOSIT').reduce((s, i) => s + Number(i.amount || 0), 0);
  const outPayments = itemList.filter(i => i.item_type === 'OUTSTANDING_PAYMENT').reduce((s, i) => s + Number(i.amount || 0), 0);
  const unrecReceipts = itemList.filter(i => i.item_type === 'UNRECORDED_RECEIPT').reduce((s, i) => s + Number(i.amount || 0), 0);
  const unrecPayments = itemList.filter(i => i.item_type === 'UNRECORDED_PAYMENT').reduce((s, i) => s + Number(i.amount || 0), 0);

  const adjBankBal = Number(bank_stmt_closing) + outDeposits - outPayments;
  const adjGlBal   = glClosing + unrecReceipts - unrecPayments;
  const difference = adjBankBal - adjGlBal;
  const status     = Math.abs(difference) < 0.01 ? 'BALANCED' : 'DRAFT';

  // Check if a recon already exists for this period/account
  const { data: existing } = await supabase
    .from('fin_cb_bank_recon')
    .select('recon_id')
    .eq('period_id', period_id)
    .eq('bank_account', bank_account)
    .single();

  let recon;
  const reconData = {
    period_id, bank_account, recon_date,
    bank_stmt_opening: Number(bank_stmt_opening || 0),
    bank_stmt_closing: Number(bank_stmt_closing || 0),
    gl_closing: glClosing,
    outstanding_deposits: outDeposits,
    outstanding_payments: outPayments,
    unrecorded_receipts: unrecReceipts,
    unrecorded_payments: unrecPayments,
    adjusted_bank_balance: adjBankBal,
    adjusted_gl_balance:   adjGlBal,
    difference, status, notes: notes || null,
    created_by: req.user.username,
  };

  if (existing?.recon_id) {
    const { data: updated, error } = await supabase
      .from('fin_cb_bank_recon')
      .update(reconData)
      .eq('recon_id', existing.recon_id)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    recon = updated;
    // Delete old items and reinsert
    await supabase.from('fin_cb_recon_items').delete().eq('recon_id', recon.recon_id);
  } else {
    const { data: created, error } = await supabase
      .from('fin_cb_bank_recon')
      .insert({ ...reconData, entity_id: 1 })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    recon = created;
  }

  // Insert recon items
  if (itemList.length) {
    await supabase.from('fin_cb_recon_items').insert(
      itemList.map(i => ({
        recon_id:         recon.recon_id,
        item_type:        i.item_type,
        description:      i.description,
        amount:           Number(i.amount || 0),
        transaction_date: i.transaction_date || null,
        bank_reference:   i.bank_reference || null,
        gl_journal_ref:   i.gl_journal_ref || null,
        resolved:         false,
      }))
    );
  }

  res.json({ success: true, recon_id: recon.recon_id, status, difference, gl_closing: glClosing });
});

// PATCH /fin/cashbook/bank-recon/:id/lock — lock a balanced recon
router.patch('/cashbook/bank-recon/:id/lock', requireFin, async (req, res) => {
  const { data: recon } = await supabase
    .from('fin_cb_bank_recon')
    .select('status, difference')
    .eq('recon_id', req.params.id)
    .single();
  if (!recon) return res.status(404).json({ error: 'Recon not found' });
  if (recon.status === 'LOCKED') return res.status(400).json({ error: 'Already locked' });
  if (Math.abs(recon.difference || 0) >= 0.01)
    return res.status(400).json({ error: 'Cannot lock — recon is not balanced (difference ≠ 0)' });

  const { data, error } = await supabase
    .from('fin_cb_bank_recon')
    .update({ status: 'LOCKED', locked_by: req.user.username, locked_at: new Date().toISOString() })
    .eq('recon_id', req.params.id)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, recon: data });
});

// ─────────────────────────────────────────────────────────────────────────────
// AP SUPPLIER INVOICES
// GET  /fin/ap/invoices — list supplier invoices
// POST /fin/ap/invoices — create supplier invoice (optionally from PO)
// PATCH /fin/ap/invoices/:id — update invoice status
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// SUPPLIER CATEGORIES
// ─────────────────────────────────────────────────────────────

// GET /fin/supplier-categories
router.get('/supplier-categories', requireFin, async (req, res) => {
  const { data, error } = await supabase
    .from('fin_supplier_categories')
    .select('*')
    .order('category_type').order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST /fin/supplier-categories
router.post('/supplier-categories', requireFin, async (req, res) => {
  const { name, category_type } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (!['SUPPLIER_TYPE','DISCOUNT'].includes(category_type)) {
    return res.status(400).json({ error: "category_type must be 'SUPPLIER_TYPE' or 'DISCOUNT'" });
  }
  const { data, error } = await supabase
    .from('fin_supplier_categories')
    .insert({ name: name.trim(), category_type, created_by: req.user.username })
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// PATCH /fin/supplier-categories/:id
router.patch('/supplier-categories/:id', requireFin, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const { data, error } = await supabase
    .from('fin_supplier_categories')
    .update({ name: name.trim() })
    .eq('id', req.params.id)
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// DELETE /fin/supplier-categories/:id
router.delete('/supplier-categories/:id', requirePermission('FINANCE', 'edit'), async (req, res) => {
  const { error } = await supabase
    .from('fin_supplier_categories')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// GET /fin/ap/invoices/pending-pos — POs in PENDING_FINANCIAL awaiting invoice capture
// Includes line items so the UI can show Category/Item/Description exactly like the PO card
// NOTE: Must be registered BEFORE /ap/invoices GET to avoid Express treating
//       "pending-pos" as a query against fin_ap_invoices with no match.
router.get('/ap/invoices/pending-pos', requireFin, async (req, res) => {
  const { data: pos, error } = await supabase
    .from('lp_purchase_orders')
    .select('po_id, po_number, supplier_code, supplier_name, po_description, total_incl_vat, subtotal_excl_vat, vat_amount, supplier_invoice_no, created_by, submitted_at, attachment_filename, onedrive_url')
    .eq('status', 'PENDING_FINANCIAL')
    .order('submitted_at');
  if (error) return res.status(500).json({ error: error.message });
  if (!pos || !pos.length) return res.json([]);

  // Fetch lines for all pending POs in one query
  const poIds = pos.map(p => p.po_id);
  const { data: lines } = await supabase
    .from('lp_po_lines')
    .select('po_id, line_number, line_type, item_code, item_name, description, line_total_excl, vat_amount, line_total_incl')
    .in('po_id', poIds)
    .order('line_number');

  // Attach lines to each PO
  const linesByPo = {};
  (lines || []).forEach(l => {
    if (!linesByPo[l.po_id]) linesByPo[l.po_id] = [];
    linesByPo[l.po_id].push(l);
  });

  res.json(pos.map(p => ({ ...p, lines: linesByPo[p.po_id] || [] })));
});

router.get('/ap/invoices', requireFin, async (req, res) => {
  const { supplier_code, status, period_id } = req.query;
  let query = supabase
    .from('fin_ap_invoices')
    .select('*, fin_suppliers(supplier_name, payment_terms_days)')
    .order('invoice_date', { ascending: false })
    .limit(200);
  if (supplier_code) query = query.eq('supplier_code', supplier_code);
  if (status)        query = query.eq('status', status);
  if (period_id)     query = query.eq('period_id', period_id);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post('/ap/invoices', requireFin, async (req, res) => {
  const {
    supplier_code, supplier_invoice_no, invoice_date, due_date,
    period_id, subtotal_excl_vat, vat_amount, total_incl_vat,
    document_ref, po_id,
  } = req.body;

  if (!supplier_code)       return res.status(400).json({ error: 'supplier_code is required' });
  if (!supplier_invoice_no) return res.status(400).json({ error: 'Supplier invoice number is required' });
  if (!invoice_date)        return res.status(400).json({ error: 'invoice_date is required' });
  // period_id is auto-resolved from invoice_date if not supplied (PO capture flow)
  let resolvedPeriodId = period_id;
  if (!resolvedPeriodId && invoice_date) {
    const invoiceYM = invoice_date.slice(0, 7); // "YYYY-MM"
    const { data: matchedPeriod } = await supabase
      .from('fin_periods')
      .select('period_id')
      .lte('start_date', invoice_date)
      .gte('end_date', invoice_date)
      .eq('is_closed', false)
      .limit(1)
      .single();
    if (matchedPeriod) resolvedPeriodId = matchedPeriod.period_id;
  }
  if (!resolvedPeriodId) return res.status(400).json({ error: 'No open GL period found for this invoice date. Please select a period manually.' });
  if (!total_incl_vat)      return res.status(400).json({ error: 'total_incl_vat is required' });

  // Duplicate supplier invoice number check
  if (supplier_invoice_no) {
    const { data: dupCheck } = await supabase
      .from('fin_ap_invoices')
      .select('invoice_ref, supplier_code')
      .eq('supplier_code', supplier_code)
      .eq('supplier_invoice_no', supplier_invoice_no)
      .not('status', 'in', '(CANCELLED)')
      .limit(1);
    if (dupCheck && dupCheck.length > 0) {
      return res.status(400).json({
        error: `Duplicate: supplier invoice ${supplier_invoice_no} has already been processed as ${dupCheck[0].invoice_ref}.`
      });
    }
  }

  // Auto-generate invoice ref: API-YYYYMM-NNNNN
  const datePart = invoice_date.replace(/-/g,'').slice(0,6);
  const { count } = await supabase
    .from('fin_ap_invoices')
    .select('*', { count: 'exact', head: true })
    .like('invoice_ref', `API-${datePart}-%`);
  const seq         = String((count || 0) + 1).padStart(5, '0');
  const invoice_ref = `API-${datePart}-${seq}`;

  const { data: supplier } = await supabase
    .from('fin_suppliers')
    .select('payment_terms_days')
    .eq('supplier_code', supplier_code)
    .single();

  const effectiveDueDate = due_date || (() => {
    const d = new Date(invoice_date);
    d.setDate(d.getDate() + (supplier?.payment_terms_days || 30));
    return d.toISOString().slice(0,10);
  })();

  const { data: invoice, error } = await supabase
    .from('fin_ap_invoices')
    .insert({
      invoice_ref,
      supplier_code,
      supplier_invoice_no: supplier_invoice_no || null,
      invoice_date,
      due_date:          effectiveDueDate,
      period_id:         Number(resolvedPeriodId),
      status:            'UNPOSTED',
      subtotal_excl_vat: Number(subtotal_excl_vat || 0),
      vat_amount:        Number(vat_amount || 0),
      total_incl_vat:    Number(total_incl_vat),
      amount_paid:       0,
      balance_due:       Number(total_incl_vat),
      document_ref:      document_ref || null,
      entity_id:         1,
    })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });

  // ── Write VAT transaction for AP invoice if VAT amount > 0 ─────────────────
  if (Number(vat_amount) > 0) {
    const vatPeriod = invoice_date.replace(/-/g, '').slice(0, 6);
    // Look up supplier VAT number and default vat type
    const { data: supData } = await supabase
      .from('fin_suppliers')
      .select('vat_number, supplier_name, default_vat_type')
      .eq('supplier_code', supplier_code)
      .single();

    const apVatCode = supData?.default_vat_type || 'IN_STD';

    // journal_id and line_id are NOT NULL in fin_vat_transactions schema.
    // AP invoices are UNPOSTED until approved — no GL journal yet.
    // Run migration_vat_nullable.sql to make these columns nullable.
    // Until then, use 0 as a sentinel value.
    const { error: apVatErr } = await supabase.from('fin_vat_transactions').insert({
      vat_code:            apVatCode,
      vat_direction:       'INPUT',
      vat_period:          vatPeriod,
      transaction_date:    invoice_date,
      tax_invoice_no:      supplier_invoice_no || invoice_ref,
      counterparty_vat_no: supData?.vat_number || null,
      counterparty_name:   supData?.supplier_name || supplier_code,
      exclusive_amount:    Math.round(Number(subtotal_excl_vat || 0) * 100) / 100,
      vat_amount:          Math.round(Number(vat_amount) * 100) / 100,
      inclusive_amount:    Math.round(Number(total_incl_vat) * 100) / 100,
      gl_account_code:     '9500',
      source_module:       'AP',
      is_capital_goods:    false,
      journal_id:          invoice.journal_id || null,
      line_id:             null,
    });
    if (apVatErr) console.warn('[AP VAT] insert failed:', apVatErr.message,
      '— run migration_vat_nullable.sql in Supabase to allow nullable journal_id/line_id');
  }

  // If linked to a PO — approve the PO and link the invoice
  if (po_id) {
    const now = new Date().toISOString();
    await supabase
      .from('lp_purchase_orders')
      .update({
        status:               'APPROVED',
        financial_approver:   req.user.username,
        financial_approved_at: now,
        ap_invoice_ref:       invoice_ref,
        ap_invoice_id:        invoice.invoice_id,
        updated_at:           now,
      })
      .eq('po_id', po_id);

    // Log the PO approval action
    const { data: po } = await supabase
      .from('lp_purchase_orders')
      .select('po_number')
      .eq('po_id', po_id)
      .single();

    if (po) {
      await supabase.from('lp_po_approval_log').insert({
        po_id,
        po_number:   po.po_number,
        action:      'FINANCIAL_APPROVED',
        actioned_by: req.user.username,
        from_status: 'PENDING_FINANCIAL',
        to_status:   'APPROVED',
        notes:       `Approved via supplier invoice capture — ${invoice_ref}`,
      });
    }
  }

  res.status(201).json(invoice);
});

router.patch('/ap/invoices/:id', requireFin, async (req, res) => {
  const allowed = ['status','supplier_invoice_no','due_date','document_ref','amount_paid','balance_due'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No fields to update' });

  const { data, error } = await supabase
    .from('fin_ap_invoices')
    .update(updates)
    .eq('invoice_id', req.params.id)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─────────────────────────────────────────────────────────────────────────────
// DEPRECIATION
// GET  /fin/depreciation/preview?period_id=X — calculate per-asset depre
// POST /fin/depreciation/run — create journal + update asset records
// ─────────────────────────────────────────────────────────────────────────────
router.get('/depreciation/preview', requireFin, async (req, res) => {
  const { period_id } = req.query;
  if (!period_id) return res.status(400).json({ error: 'period_id is required' });

  // Check period exists and is open
  const { data: period } = await supabase
    .from('fin_periods')
    .select('period_id, period_name, is_closed')
    .eq('period_id', period_id)
    .single();
  if (!period) return res.status(404).json({ error: 'Period not found' });
  if (period.is_closed) return res.status(400).json({ error: `Period ${period.period_name} is locked` });

  // Check if already run for this period
  const { data: existingRun } = await supabase
    .from('fin_depreciation_runs')
    .select('run_id')
    .eq('period_id', period_id)
    .limit(1);
  if (existingRun?.length) {
    return res.status(400).json({ error: `Depreciation has already been run for ${period.period_name}` });
  }

  // Get all active, not-fully-depreciated assets with their classes
  const { data: assets, error: aErr } = await supabase
    .from('fin_assets')
    .select('*, fin_asset_classes(class_code, class_name, gl_cost_account, gl_accum_account, gl_depre_account, ifrs_useful_life_yr, sars_wt_rate_pct)')
    .eq('is_active', true)
    .eq('fully_depreciated', false);

  if (aErr) return res.status(500).json({ error: aErr.message });

  const lines = [];
  for (const asset of (assets || [])) {
    const cls = asset.fin_asset_classes;
    if (!cls) continue;

    const usefulLife = cls.ifrs_useful_life_yr || 5;
    const cost       = Number(asset.purchase_price || 0);
    const monthlyDepre = cost / usefulLife / 12;

    // Don't depreciate below zero
    const currentNBV   = Number(asset.book_nbv || 0);
    const depreAmount  = Math.min(monthlyDepre, currentNBV);
    if (depreAmount <= 0) continue;

    const nbvAfter = currentNBV - depreAmount;

    // SARS tax depreciation (W&T)
    const sarsRate   = Number(cls.sars_wt_rate_pct || 20) / 100;
    const taxMonthly = Number(asset.purchase_price || 0) * sarsRate / 12;
    const currentTaxVal = Number(asset.tax_value || 0);
    const taxDepreAmount = Math.min(taxMonthly, currentTaxVal);
    const taxValAfter    = currentTaxVal - taxDepreAmount;

    lines.push({
      asset_id:         asset.asset_id,
      asset_code:       asset.asset_code,
      description:      asset.description,
      class_code:       asset.class_code,
      class_name:       cls.class_name,
      gl_depre_account: cls.gl_depre_account,
      gl_accum_account: cls.gl_accum_account,
      purchase_price:   cost,
      book_nbv_before:  currentNBV,
      book_depre_amount: Math.round(depreAmount * 100) / 100,
      book_nbv_after:   Math.round(nbvAfter * 100) / 100,
      tax_depre_amount: Math.round(taxDepreAmount * 100) / 100,
      tax_value_before: currentTaxVal,
      tax_value_after:  Math.round(taxValAfter * 100) / 100,
      fully_depreciated_after: nbvAfter < 0.01,
    });
  }

  // Group by asset class for journal summary
  const byClass = {};
  for (const l of lines) {
    if (!byClass[l.class_code]) {
      byClass[l.class_code] = {
        class_code: l.class_code, class_name: l.class_name,
        gl_depre_account: l.gl_depre_account,
        gl_accum_account: l.gl_accum_account,
        total_depre: 0, asset_count: 0,
      };
    }
    byClass[l.class_code].total_depre  += l.book_depre_amount;
    byClass[l.class_code].asset_count  += 1;
  }

  const journalLines = [];
  for (const cls of Object.values(byClass)) {
    const amt = Math.round(cls.total_depre * 100) / 100;
    // DR Depreciation expense
    journalLines.push({ account_code: cls.gl_depre_account, description: `Depreciation — ${cls.class_name}`, debit: amt, credit: 0 });
    // CR Accumulated depreciation
    journalLines.push({ account_code: cls.gl_accum_account, description: `Accum depre — ${cls.class_name}`, debit: 0, credit: amt });
  }

  const totalDepre = lines.reduce((s, l) => s + l.book_depre_amount, 0);

  res.json({
    period_id:     Number(period_id),
    period_name:   period.period_name,
    asset_lines:   lines,
    journal_lines: journalLines,
    total_depre:   Math.round(totalDepre * 100) / 100,
    asset_count:   lines.length,
  });
});

router.post('/depreciation/run', requireFin, async (req, res) => {
  const { period_id } = req.body;
  if (!period_id) return res.status(400).json({ error: 'period_id is required' });

  try {
    // Re-run preview to get fresh numbers
    const previewRes = await fetch(
      `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/fin/depreciation/preview?period_id=${period_id}`,
      { headers: { 'Authorization': req.headers.authorization } }
    );
    const preview = await previewRes.json();
    if (preview.error) return res.status(400).json({ error: preview.error });
    if (!preview.asset_lines?.length) return res.status(400).json({ error: 'No assets to depreciate' });

    // Validate journal is balanced
    const totalDR = preview.journal_lines.reduce((s, l) => s + (l.debit  || 0), 0);
    const totalCR = preview.journal_lines.reduce((s, l) => s + (l.credit || 0), 0);
    if (Math.abs(totalDR - totalCR) > 0.01) {
      return res.status(500).json({ error: 'Depreciation journal does not balance — contact support' });
    }

    // Get period date for journal
    const { data: period } = await supabase
      .from('fin_periods')
      .select('period_end, period_name')
      .eq('period_id', period_id)
      .single();

    if (!period) return res.status(404).json({ error: 'Period not found' });

    // Create depreciation journal
    const datePart   = period.period_end.replace(/-/g,'').slice(0,6);
    const { count }  = await supabase
      .from('fin_gl_journals')
      .select('*', { count: 'exact', head: true })
      .like('journal_ref', `DA-${datePart}-%`);
    const seq         = String((count || 0) + 1).padStart(5, '0');
    const journal_ref = `DA-${datePart}-${seq}`;

    const { data: journal, error: jErr } = await supabase
      .from('fin_gl_journals')
      .insert({
        journal_ref,
        journal_type:  'DA',
        description:   `Depreciation — ${period.period_name}`,
        period_id:     Number(period_id),
        journal_date:  period.period_end,
        source_module: 'ASSETS',
        posted:        false, // Leave unposted — user reviews and posts manually
        created_by:    req.user.username,
      })
      .select().single();

    if (jErr) return res.status(500).json({ error: jErr.message });

    await supabase.from('fin_gl_journal_lines').insert(
      preview.journal_lines.map((l, i) => ({
        journal_id:  journal.journal_id,
        line_number: i + 1,
        account_code: l.account_code,
        description:  l.description,
        debit:        l.debit || 0,
        credit:       l.credit || 0,
        vat_type:     null,
        vat_amount:   0,
      }))
    );

    // Update each asset and create depreciation run records
    const runRecords = [];
    for (const line of preview.asset_lines) {
      await supabase.from('fin_assets').update({
        book_depre_period:  line.book_depre_amount,
        book_depre_curr_yr: line.book_depre_amount, // TODO: accumulate across periods in a future update
        book_nbv:           line.book_nbv_after,
        tax_depre_period:   line.tax_depre_amount,
        tax_value:          line.tax_value_after,
        fully_depreciated:  line.fully_depreciated_after,
        book_report_date:   period.period_end,
      }).eq('asset_id', line.asset_id);

      runRecords.push({
        asset_id:          line.asset_id,
        period_id:         Number(period_id),
        run_date:          period.period_end,
        book_depre_amount: line.book_depre_amount,
        tax_depre_amount:  line.tax_depre_amount,
        book_nbv_after:    line.book_nbv_after,
        tax_value_after:   line.tax_value_after,
        journal_id:        journal.journal_id,
      });
    }

    await supabase.from('fin_depreciation_runs').insert(runRecords);

    res.json({
      success:       true,
      journal_ref,
      journal_id:    journal.journal_id,
      assets_run:    preview.asset_lines.length,
      total_depre:   preview.total_depre,
      note:          'Journal created as UNPOSTED — review and post manually in GL Journals',
    });
  } catch (err) {
    console.error('[depreciation/run]', err);
    res.status(500).json({ error: 'Depreciation run failed: ' + err.message });
  }
});


module.exports = router;





