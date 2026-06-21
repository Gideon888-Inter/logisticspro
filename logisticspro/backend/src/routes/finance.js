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


// ─────────────────────────────────────────────────────────────
// GL ACCOUNT TRANSACTIONS (Account Enquiry / Ledger)
// ─────────────────────────────────────────────────────────────

// GET /fin/account-transactions
// Query params: account_code, date_from, date_to, limit (all optional)
// Returns journal lines joined to journal header, ordered by date desc
router.get('/account-transactions', requireFin, async (req, res) => {
  const { account_code, date_from, date_to, limit = 500 } = req.query;

  // Fetch journal lines with journal header data
  let query = supabase
    .from('fin_gl_journal_lines')
    .select(`
      line_id,
      line_number,
      account_code,
      description,
      debit,
      credit,
      vat_type,
      vat_amount,
      reference,
      fin_gl_journals!inner (
        journal_id,
        journal_ref,
        journal_date,
        journal_type,
        description,
        posted,
        source_module,
        source_document
      )
    `)
    .eq('fin_gl_journals.posted', true)
    .order('fin_gl_journals(journal_date)', { ascending: false })
    .limit(parseInt(limit));

  if (account_code) {
    query = query.eq('account_code', account_code);
  }
  if (date_from) {
    query = query.gte('fin_gl_journals.journal_date', date_from);
  }
  if (date_to) {
    query = query.lte('fin_gl_journals.journal_date', date_to);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Flatten the nested join for easy frontend consumption
  const rows = (data || []).map(l => ({
    line_id:         l.line_id,
    account_code:    l.account_code,
    line_desc:       l.description,
    debit:           l.debit || 0,
    credit:          l.credit || 0,
    vat_type:        l.vat_type,
    vat_amount:      l.vat_amount || 0,
    reference:       l.reference,
    journal_id:      l.fin_gl_journals?.journal_id,
    journal_ref:     l.fin_gl_journals?.journal_ref,
    journal_date:    l.fin_gl_journals?.journal_date,
    journal_type:    l.fin_gl_journals?.journal_type,
    journal_desc:    l.fin_gl_journals?.description,
    source_module:   l.fin_gl_journals?.source_module,
    source_document: l.fin_gl_journals?.source_document,
  }));

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
  const output_std    = rows.filter(r => r.vat_direction === 'OUTPUT' && !r.is_capital_goods && r._vt.rate_pct === 15);
  const output_cap    = rows.filter(r => r.vat_direction === 'OUTPUT' && r.is_capital_goods);
  const output_zero   = rows.filter(r => r.vat_direction === 'OUTPUT' && r._vt.rate_pct === 0 && r._vt.vat201_field === '2');
  const output_zeroex = rows.filter(r => r.vat_direction === 'OUTPUT' && r._vt.rate_pct === 0 && r._vt.vat201_field === '2A');

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
      field14, field14_vat,
      field15, field15_vat,
      field19,
      field20,
    },
    payable:    field20 > 0,
    refundable: field20 < 0,
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
      classSummary[r.class_code] = { class_code: r.class_code, class_name: r.class_name, count: 0, cost: 0, accum_depre: 0, opening_depre: 0, period_depre: 0, closing_depre: 0, book_nbv: 0 };
    }
    const cs = classSummary[r.class_code];
    cs.count         += 1;
    cs.cost          += r.purchase_price    || 0;
    cs.accum_depre   += r.accumulated_depre || 0;
    cs.opening_depre += r.opening_depre_book|| 0;
    cs.period_depre  += r.period_depre_book || 0;
    cs.closing_depre += r.closing_depre_book|| 0;
    cs.book_nbv      += r.book_nbv          || 0;
  });

  const totals = {
    count:         rows.length,
    total_cost:    Math.round(rows.reduce((s,r) => s + (r.purchase_price    || 0), 0) * 100) / 100,
    total_accum:   Math.round(rows.reduce((s,r) => s + (r.accumulated_depre || 0), 0) * 100) / 100,
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
      opening_depre:Math.round(cs.opening_depre* 100) / 100,
      period_depre: Math.round(cs.period_depre * 100) / 100,
      closing_depre:Math.round(cs.closing_depre* 100) / 100,
      book_nbv:     Math.round(cs.book_nbv     * 100) / 100,
    })),
    totals,
    filters: { class_code, asset_code, date_from, date_to, show_additions, show_disposals },
  });
});

module.exports = router;
