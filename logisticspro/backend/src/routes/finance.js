/**
 * LP2.0 — Financial Module API
 * ==============================
 * Endpoints for the financial engine integrated into Supabase.
 *
 * Routes:
 *   GET  /fin/accounts              Chart of Accounts
 *   GET  /fin/accounts/:code        Single account detail
 *   GET  /fin/periods               All periods with status
 *   GET  /fin/journals              Journal list (with filters)
 *   GET  /fin/journals/:id          Journal detail with lines
 *   POST /fin/journals              Post a new GL journal
 *   GET  /fin/trial-balance         Trial balance (current FY)
 *   GET  /fin/vat-types             VAT type reference
 *   GET  /fin/suppliers             Supplier list
 *   GET  /fin/suppliers/:code       Supplier detail
 *   GET  /fin/ar-customers          AR customer list
 *   GET  /fin/ar-customers/:code    AR customer detail
 *   GET  /fin/assets                Fixed asset register
 *   GET  /fin/assets/classes        Asset classes
 *   GET  /fin/aging/debtors         Debtor aging view
 *   GET  /fin/aging/suppliers       Supplier aging view
 *   GET  /fin/vat201                VAT201 summary by period
 *   GET  /fin/cashbook/staging      Cashbook staging entries
 *   GET  /fin/periods/status        Period status dashboard
 */

const express = require('express');
const router  = express.Router();
const supabase = require('../supabase');
const { authMiddleware, requireRole, ROLES } = require('../middleware/auth');

router.use(authMiddleware);

// Only ADMIN and FINANCE can access financial module
const requireFin = requireRole(ROLES.ADMIN, ROLES.FINANCE);

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
      is_closed: true,
      locked_by: req.user.username,
      locked_at: new Date().toISOString(),
    })
    .eq('period_id', period_id);

  if (error) return res.status(500).json({ error: error.message });

  // Audit log
  await supabase.from('fin_period_lock_log').insert({
    period_id, period_type: 'GL', action: 'LOCK',
    actioned_by: req.user.username, reason: reason || null,
  });

  res.json({ success: true, message: `Period ${period.period_name} locked` });
});

// PATCH /fin/periods/:id/unlock — unlock a period (Admin only)
router.patch('/periods/:id/unlock', requireRole(ROLES.ADMIN), async (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ error: 'Unlock reason is required' });
  const period_id = parseInt(req.params.id);

  const { error } = await supabase
    .from('fin_periods')
    .update({
      is_closed: false,
      unlocked_by: req.user.username,
      unlocked_at: new Date().toISOString(),
      unlock_reason: reason,
      reopen_count: supabase.rpc ? undefined : undefined, // incremented via raw update
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
  const [journalRes, linesRes] = await Promise.all([
    supabase.from('fin_gl_journals').select('*').eq('journal_id', req.params.id).single(),
    supabase.from('fin_gl_journal_lines').select('*').eq('journal_id', req.params.id).order('line_number'),
  ]);

  if (journalRes.error) return res.status(404).json({ error: 'Journal not found' });

  // Calculate totals
  const lines = linesRes.data || [];
  const totalDebit  = lines.reduce((s, l) => s + (l.debit  || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);

  res.json({
    ...journalRes.data,
    lines,
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

  // Check period is not locked
  const { data: period } = await supabase
    .from('fin_periods')
    .select('is_closed, period_name')
    .eq('period_id', period_id)
    .single();

  if (!period)          return res.status(404).json({ error: 'Period not found' });
  if (period.is_closed) return res.status(400).json({ error: `Period ${period.period_name} is locked` });

  // Validate balance
  const totalDebit  = lines.reduce((s, l) => s + (parseFloat(l.debit)  || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01)
    return res.status(400).json({ error: `Journal is not balanced — DR: ${totalDebit.toFixed(2)}, CR: ${totalCredit.toFixed(2)}` });

  // Generate journal ref
  const datePart = journal_date.replace(/-/g, '').slice(0, 6);
  const type_prefix = (journal_type || 'GL').slice(0, 2).toUpperCase();
  const { count } = await supabase
    .from('fin_gl_journals')
    .select('*', { count: 'exact', head: true })
    .like('journal_ref', `${type_prefix}-${datePart}-%`);
  const seq = String((count || 0) + 1).padStart(5, '0');
  const journal_ref = `${type_prefix}-${datePart}-${seq}`;

  // Insert journal header
  const { data: journal, error: jErr } = await supabase
    .from('fin_gl_journals')
    .insert({
      journal_ref, journal_type: journal_type || 'GL', description,
      period_id, journal_date, source_document, source_module,
      posted: true, posted_at: new Date().toISOString(), posted_by: req.user.username,
      created_by: req.user.username,
    })
    .select()
    .single();

  if (jErr) return res.status(500).json({ error: jErr.message });

  // Insert lines
  const lineRows = lines.map((l, i) => ({
    journal_id:   journal.journal_id,
    line_number:  i + 1,
    account_code: l.account_code,
    description:  l.description || description,
    debit:        parseFloat(l.debit)  || 0,
    credit:       parseFloat(l.credit) || 0,
    vat_type:     l.vat_type || null,
    vat_amount:   parseFloat(l.vat_amount) || 0,
    tax_period:   l.tax_period || null,
    reference:    l.reference || null,
  }));

  const { error: lErr } = await supabase
    .from('fin_gl_journal_lines')
    .insert(lineRows);

  if (lErr) {
    // Rollback journal header
    await supabase.from('fin_gl_journals').delete().eq('journal_id', journal.journal_id);
    return res.status(500).json({ error: lErr.message });
  }

  res.json({ success: true, journal_id: journal.journal_id, journal_ref });
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
  const { data, error } = await supabase
    .from('fin_vat_types')
    .select('*')
    .eq('active', true)
    .order('vat_code');
  if (error) return res.status(500).json({ error: error.message });
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
// SUPPLIERS
// ─────────────────────────────────────────────────────────────

router.get('/suppliers', requireFin, async (req, res) => {
  const { search, active } = req.query;
  let query = supabase
    .from('fin_suppliers')
    .select('supplier_id,supplier_code,supplier_name,group_terms,telephone,email,vat_number,payment_terms_days,on_hold,active,gl_control_account')
    .order('supplier_name');

  if (active !== undefined) query = query.eq('active', active === 'true');
  if (search) query = query.or(`supplier_code.ilike.%${search}%,supplier_name.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

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
// AR CUSTOMERS
// ─────────────────────────────────────────────────────────────

router.get('/ar-customers', requireFin, async (req, res) => {
  const { search, active } = req.query;
  let query = supabase
    .from('fin_ar_customers')
    .select('customer_id,customer_code,customer_name,category,vat_number,telephone,email,payment_terms_days,on_hold,active,gl_control_account,lp_client_code')
    .order('customer_name');

  if (active !== undefined) query = query.eq('active', active === 'true');
  if (search) query = query.or(`customer_code.ilike.%${search}%,customer_name.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

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
// FIXED ASSETS
// ─────────────────────────────────────────────────────────────

router.get('/assets/classes', requireFin, async (req, res) => {
  const { data, error } = await supabase
    .from('fin_asset_classes')
    .select('*')
    .order('class_code');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

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

router.get('/assets/:code', requireFin, async (req, res) => {
  const [assetRes, runsRes] = await Promise.all([
    supabase.from('fin_assets').select('*').eq('asset_code', req.params.code).single(),
    supabase.from('fin_depreciation_runs')
      .select('*, fin_periods(period_name)')
      .eq('asset_id', supabase.from ? undefined : undefined) // handled below
  ]);

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

  // Summarise by bucket
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
  const [tbRes, debtorRes, supplierRes, assetRes, periodRes] = await Promise.all([
    supabase.from('fin_vw_trial_balance').select('account_code,account_name,ifrs_classification,balance'),
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

module.exports = router;
