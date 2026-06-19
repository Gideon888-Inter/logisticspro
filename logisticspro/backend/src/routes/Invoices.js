const express = require('express');
const supabase = require('../supabase');
const {
  authMiddleware, requireRole,
  ROLES,
  CAN_VIEW_LOADS,
  CAN_MANAGE_INVOICES,
  CAN_CREATE_CREDIT_NOTE,
} = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const VAT_RATE = 0.15;

// ── Helper: generate next invoice number via DB function ──────
async function getNextInvoiceNumber() {
  const { data, error } = await supabase.rpc('next_invoice_number');
  if (error) throw new Error('Could not generate invoice number: ' + error.message);
  return data;
}

async function getNextCreditNoteNumber() {
  const { data, error } = await supabase.rpc('next_credit_note_number');
  if (error) throw new Error('Could not generate credit note number: ' + error.message);
  return data;
}

// ============================================================
// GET /api/invoices — list all invoices (with optional filters)
// ============================================================
router.get('/', requireRole(...CAN_MANAGE_INVOICES), async (req, res) => {
  const { status, customer, date_from, date_to } = req.query;

  let query = supabase
    .from('lp_invoices')
    .select(`
      *,
      lp_customers(c_name),
      lp_credit_notes(id, cn_number, cn_amount_incl, cn_date, cn_status:cn_approved_at)
    `)
    .order('created_at', { ascending: false });

  if (status)    query = query.eq('inv_status', status);
  if (customer)  query = query.eq('inv_customer', customer);
  if (date_from) query = query.gte('inv_date', date_from);
  if (date_to)   query = query.lte('inv_date', date_to);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});


// ============================================================
// GET /api/invoices/drafts — loads in WAIT_INVOICE_NO with no invoice yet
// These are shown on the Invoices page as "ready to invoice"
// ============================================================
router.get('/drafts', requireRole(...CAN_MANAGE_INVOICES), async (req, res) => {
  // Get loads awaiting invoice
  const { data: loads, error: loadErr } = await supabase
    .from('lp_movement')
    .select(
      'm_load_no, m_date, m_customer, m_from, m_to, m_rate, m_extras, ' +
      'm_load_total, m_order_no, m_invoice, m_bus_unit, ' +
      'lp_customers(c_name, c_code)'
    )
    .eq('m_status', 'WAIT_INVOICE_NO')
    .order('m_date', { ascending: false });

  if (loadErr) return res.status(500).json({ error: loadErr.message });

  // Get already-created draft invoices so we can show their status
  const loadNos = (loads || []).map(l => l.m_load_no);
  let draftInvoices = [];
  if (loadNos.length > 0) {
    const { data } = await supabase
      .from('lp_invoices')
      .select('inv_load_no, inv_number, inv_status, inv_amount_incl')
      .in('inv_load_no', loadNos);
    draftInvoices = data || [];
  }

  // Merge: mark which loads already have a draft
  const invoiceMap = {};
  for (const inv of draftInvoices) invoiceMap[inv.inv_load_no] = inv;

  const result = (loads || []).map(load => ({
    ...load,
    existing_invoice: invoiceMap[load.m_load_no] || null,
  }));

  res.json(result);
});


// ============================================================
// POST /api/invoices — create a DRAFT invoice from a load
// ============================================================
router.post('/', requireRole(...CAN_MANAGE_INVOICES), async (req, res) => {
  const { load_no, description, amount_excl } = req.body;

  if (!load_no) return res.status(400).json({ error: 'load_no is required' });

  // Verify load is in WAIT_INVOICE_NO
  const { data: load } = await supabase
    .from('lp_movement')
    .select('m_load_no, m_status, m_customer, m_rate, m_load_total, m_order_no')
    .eq('m_load_no', load_no)
    .single();

  if (!load) return res.status(404).json({ error: 'Load not found' });
  if (load.m_status !== 'WAIT_INVOICE_NO')
    return res.status(400).json({ error: 'Load must be in WAIT_INVOICE_NO status to create an invoice' });

  // Check no FINAL invoice already exists for this load
  const { data: existing } = await supabase
    .from('lp_invoices')
    .select('id, inv_status')
    .eq('inv_load_no', load_no)
    .eq('inv_status', 'FINAL')
    .single();

  if (existing)
    return res.status(400).json({ error: 'A final invoice already exists for this load' });

  // Get VAT rate from config
  const { data: vatCfg } = await supabase
    .from('lp_config')
    .select('cfg_value')
    .eq('cfg_key', 'vat_rate')
    .single();
  const vatRate = parseFloat(vatCfg?.cfg_value || '0.15');

  const excl = parseFloat(amount_excl || load.m_load_total || load.m_rate || 0);
  const vat  = Math.round(excl * vatRate * 100) / 100;
  const incl = Math.round((excl + vat) * 100) / 100;

  const inv_number = await getNextInvoiceNumber();

  const { data: invoice, error } = await supabase
    .from('lp_invoices')
    .insert([{
      inv_number,
      inv_load_no:     load_no,
      inv_customer:    load.m_customer,
      inv_date:        new Date().toISOString().split('T')[0],
      inv_description: description || 'TRANSPORT SERVICES',
      inv_amount_excl: excl,
      inv_vat:         vat,
      inv_amount_incl: incl,
      inv_order_no:    load.m_order_no || null,
      inv_status:      'DRAFT',
      inv_created_by:  req.user.username,
    }])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Update load with draft invoice number
  await supabase.from('lp_movement')
    .update({ m_invoice: inv_number, updated_at: new Date().toISOString() })
    .eq('m_load_no', load_no);

  res.status(201).json(invoice);
});


// ============================================================
// PATCH /api/invoices/:id — update a DRAFT invoice (amounts/description)
// Cannot edit FINAL invoices
// ============================================================
router.patch('/:id', requireRole(...CAN_MANAGE_INVOICES), async (req, res) => {
  const { data: invoice } = await supabase
    .from('lp_invoices')
    .select('inv_status')
    .eq('id', req.params.id)
    .single();

  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.inv_status === 'FINAL')
    return res.status(400).json({ error: 'Final invoices cannot be edited' });

  // Recalculate VAT if amount changed
  const updates = { ...req.body, updated_at: new Date().toISOString() };
  if (updates.inv_amount_excl) {
    const { data: vatCfg } = await supabase
      .from('lp_config')
      .select('cfg_value')
      .eq('cfg_key', 'vat_rate')
      .single();
    const vatRate = parseFloat(vatCfg?.cfg_value || '0.15');
    const excl = parseFloat(updates.inv_amount_excl);
    updates.inv_vat         = Math.round(excl * vatRate * 100) / 100;
    updates.inv_amount_incl = Math.round((excl + updates.inv_vat) * 100) / 100;
  }

  const { data, error } = await supabase
    .from('lp_invoices')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});


// ============================================================
// POST /api/invoices/:id/approve — finalise a DRAFT invoice
// Allowed: Admin, Manager, Accounting
// ============================================================
router.post('/:id/approve', requireRole(...CAN_MANAGE_INVOICES), async (req, res) => {
  const { data: invoice } = await supabase
    .from('lp_invoices')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.inv_status !== 'DRAFT')
    return res.status(400).json({ error: 'Only DRAFT invoices can be approved' });

  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('lp_invoices')
    .update({
      inv_status:      'FINAL',
      inv_approved_by: req.user.username,
      inv_approved_at: now,
      updated_at:      now,
    })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Advance the load to LOAD_INVOICED
  await supabase.from('lp_movement')
    .update({ m_status: 'LOAD_INVOICED', updated_at: now })
    .eq('m_load_no', invoice.inv_load_no);

  await supabase.from('lp_comments').insert([{
    c_load:      invoice.inv_load_no,
    c_comment:   `Invoice ${invoice.inv_number} finalised by ${req.user.username}. Amount: R ${invoice.inv_amount_incl.toLocaleString('en-ZA')} (incl. VAT)`,
    c_logged_by: req.user.username,
  }]);

  res.json(data);
});


// ============================================================
// POST /api/invoices/:id/credit-note — raise a credit note
// Allowed: Admin and Manager only
// The value can be changed; reason is mandatory
// ============================================================
router.post('/:id/credit-note', requireRole(...CAN_CREATE_CREDIT_NOTE), async (req, res) => {
  const { reason, amount_excl } = req.body;

  if (!reason?.trim())
    return res.status(400).json({ error: 'A reason for the credit note is required' });

  const { data: invoice } = await supabase
    .from('lp_invoices')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.inv_status !== 'FINAL')
    return res.status(400).json({ error: 'Credit notes can only be raised against FINAL invoices' });

  // Check no credit note already exists for this invoice
  const { data: existingCN } = await supabase
    .from('lp_credit_notes')
    .select('id')
    .eq('cn_invoice_id', invoice.id)
    .single();

  if (existingCN)
    return res.status(400).json({ error: 'A credit note already exists for this invoice' });

  // Get VAT rate
  const { data: vatCfg } = await supabase
    .from('lp_config')
    .select('cfg_value')
    .eq('cfg_key', 'vat_rate')
    .single();
  const vatRate = parseFloat(vatCfg?.cfg_value || '0.15');

  // Default credit amount = original invoice amount (can be overridden)
  const excl = parseFloat(amount_excl || invoice.inv_amount_excl);
  const vat  = Math.round(excl * vatRate * 100) / 100;
  const incl = Math.round((excl + vat) * 100) / 100;

  const cn_number = await getNextCreditNoteNumber();

  const { data: creditNote, error } = await supabase
    .from('lp_credit_notes')
    .insert([{
      cn_number,
      cn_invoice_id:  invoice.id,
      cn_invoice_no:  invoice.inv_number,
      cn_load_no:     invoice.inv_load_no,
      cn_customer:    invoice.inv_customer,
      cn_date:        new Date().toISOString().split('T')[0],
      cn_description: invoice.inv_description,
      cn_amount_excl: excl,
      cn_vat:         vat,
      cn_amount_incl: incl,
      cn_reason:      reason,
      cn_created_by:  req.user.username,
      cn_approved_by: req.user.username,  // Creator approves immediately (Admin/Manager)
      cn_approved_at: new Date().toISOString(),
    }])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Mark the invoice as CREDITED
  await supabase.from('lp_invoices')
    .update({ inv_status: 'CREDITED', updated_at: new Date().toISOString() })
    .eq('id', invoice.id);

  await supabase.from('lp_comments').insert([{
    c_load:      invoice.inv_load_no,
    c_comment:   `Credit note ${cn_number} raised by ${req.user.username} against invoice ${invoice.inv_number}. Amount: R ${incl.toLocaleString('en-ZA')}. Reason: ${reason}`,
    c_logged_by: req.user.username,
  }]);

  res.status(201).json(creditNote);
});


// ============================================================
// GET /api/invoices/credit-notes — list all credit notes
// ============================================================
router.get('/credit-notes', requireRole(...CAN_MANAGE_INVOICES), async (req, res) => {
  const { data, error } = await supabase
    .from('lp_credit_notes')
    .select('*, lp_customers(c_name)')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});


module.exports = router;
