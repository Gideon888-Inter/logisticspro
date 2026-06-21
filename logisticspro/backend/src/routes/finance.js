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
 *   GET  /fin/vat201                VAT201 summary by period
 *   GET  /fin/cashbook/staging      Cashbook staging entries
 *   GET  /fin/periods/status        Period status dashboard
 *   GET  /fin/dashboard             Finance dashboard summary
 */

const express = require('express');
const router  = express.Router();
const supabase = require('../supabase');
const { authMiddleware, requireRole, ROLES } = require('../middleware/auth');

router.use(authMiddleware);

// Only ADMIN and FINANCE can access financial module (unless otherwise specified)
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
    parent_account:    parent_account || null,
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
router.patch('/periods/:id/unlock', requireRole(ROLES.ADMIN), async (req, res) => {
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

  const { data: period } = await supabase
    .from('fin_periods')
    .select('is_closed, period_name')
    .eq('period_id', period_id)
    .single();

  if (!period)          return res.status(404).json({ error: 'Period not found' });
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
      period_id, journal_date, source_document, source_module,
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
// SUPPLIERS — specific routes BEFORE parameterised /:code
// ─────────────────────────────────────────────────────────────

// GET /fin/suppliers/workshop — suppliers allowed for Workshop (used by PO module)
// No full finance gate — any authenticated user can fetch this list
router.get('/suppliers/workshop', async (req, res) => {
  const { data, error } = await supabase
    .from('fin_suppliers')
    .select('supplier_id,supplier_code,supplier_name,payment_terms_days,telephone,email')
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
  const { supplier_code, supplier_name, group_terms, telephone, email, vat_number, payment_terms_days, gl_control_account, city } = req.body;
  if (!supplier_code?.trim()) return res.status(400).json({ error: 'supplier_code is required' });
  if (!supplier_name?.trim()) return res.status(400).json({ error: 'supplier_name is required' });
  const { data, error } = await supabase.from('fin_suppliers').insert({
    supplier_code:       supplier_code.trim().toUpperCase(),
    supplier_name:       supplier_name.trim(),
    group_terms:         group_terms || null,
    telephone:           telephone   || null,
    email:               email       || null,
    vat_number:          vat_number  || null,
    payment_terms_days:  parseInt(payment_terms_days) || 30,
    gl_control_account:  gl_control_account || '2000',
    city:                city        || null,
    active:              true,
    on_hold:             false,
    workshop_allowed:    false,
    created_by:          req.user.username,
  }).select().single();
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

module.exports = router;
