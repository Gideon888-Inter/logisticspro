const express = require('express');
const supabase = require('../supabase');
const {
  authMiddleware, loadUserPermissions, requirePermission,
  CAN_MANAGE_INVOICES, CAN_CREATE_CREDIT_NOTE,
} = require('../middleware/auth');
const { sendMail, listFolderFiles, downloadFileAsBase64, SP_POD_FOLDER } = require('../lib/msgraph');
const { generateInvoicePdfBuffer } = require('../lib/invoicePdf');

const router = express.Router();
router.use(authMiddleware);
router.use(loadUserPermissions);

const VAT_RATE = 0.15;

// ── Helper: generate next invoice number ─────────────────────
async function genInvoiceNo() {
  const { data } = await supabase.rpc('next_invoice_number');
  if (data) return data;
  // Fallback if function not available
  const { data: last } = await supabase
    .from('lp_invoices').select('inv_number').order('id', { ascending: false }).limit(1);
  const n = last?.[0]?.inv_number?.replace('IN', '') || '100000';
  return 'IN' + String(parseInt(n) + 1).padStart(6, '0');
}

// ── Helper: generate next credit note number ─────────────────
async function genCreditNoteNo() {
  const { data } = await supabase.rpc('next_credit_note_number');
  if (data) return data;
  const { data: last } = await supabase
    .from('lp_credit_notes').select('cn_number').order('id', { ascending: false }).limit(1);
  const n = last?.[0]?.cn_number?.replace('IC', '') || '100000';
  return 'IC' + String(parseInt(n) + 1).padStart(6, '0');
}


// ============================================================
// GET /api/invoices/drafts
// Loads sitting in WAIT_INVOICE_NO — ready to be invoiced.
// Also attaches any existing draft invoice so the UI can show it.
// ============================================================
router.get('/drafts', requirePermission('INVOICES', 'view'), async (req, res) => {
  try {
    const { data: loads, error: loadErr } = await supabase
      .from('lp_movement')
      .select('m_load_no, m_date, m_customer, m_from, m_to, m_rate, m_load_total, m_order_no')
      .eq('m_status', 'WAIT_INVOICE_NO')
      .order('m_date', { ascending: false });

    if (loadErr) return res.status(500).json({ error: loadErr.message });
    if (!loads || loads.length === 0) return res.json([]);

    // Fetch customer names separately
    const customerCodes = [...new Set(loads.map(l => l.m_customer).filter(Boolean))];
    const { data: customers } = await supabase
      .from('lp_customers')
      .select('c_code, c_name')
      .in('c_code', customerCodes);

    const custMap = {};
    (customers || []).forEach(c => { custMap[c.c_code] = c.c_name; });

    // Attach any existing invoice for each load
    const loadNos = loads.map(l => l.m_load_no);
    const { data: existingInvs } = await supabase
      .from('lp_invoices')
      .select('inv_load_no, inv_number, inv_status, id')
      .in('inv_load_no', loadNos)
      .neq('inv_status', 'CREDITED');

    const invMap = {};
    (existingInvs || []).forEach(inv => { invMap[inv.inv_load_no] = inv; });

    const result = loads.map(l => ({
      ...l,
      lp_customers: { c_name: custMap[l.m_customer] || l.m_customer },
      existing_invoice: invMap[l.m_load_no] || null,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
// GET /api/invoices
// All invoices, optionally filtered by status.
// ============================================================
router.get('/', requirePermission('INVOICES', 'view'), async (req, res) => {
  try {
    const { status } = req.query;
    let q = supabase
      .from('lp_invoices')
      .select('*, lp_credit_notes(cn_number, cn_amount_incl)')
      .order('created_at', { ascending: false });

    if (status) q = q.eq('inv_status', status);

    const { data: invoices, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    // Fetch customer names separately
    const codes = [...new Set((invoices || []).map(i => i.inv_customer).filter(Boolean))];
    let custMap = {};
    if (codes.length > 0) {
      const { data: customers } = await supabase
        .from('lp_customers').select('c_code, c_name').in('c_code', codes);
      (customers || []).forEach(c => { custMap[c.c_code] = c.c_name; });
    }

    const result = (invoices || []).map(inv => ({
      ...inv,
      lp_customers: { c_name: custMap[inv.inv_customer] || inv.inv_customer },
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
// GET /api/invoices/:id
// Single invoice by id.
// ============================================================
router.get('/:id', requirePermission('INVOICES', 'view'), async (req, res) => {
  try {
    const { data: inv, error } = await supabase
      .from('lp_invoices')
      .select('*, lp_credit_notes(*)')
      .eq('id', req.params.id)
      .single();
    if (error) return res.status(404).json({ error: 'Invoice not found' });

    // Fetch customer name separately
    let c_name = inv.inv_customer;
    if (inv.inv_customer) {
      const { data: cust } = await supabase
        .from('lp_customers').select('c_name').eq('c_code', inv.inv_customer).single();
      if (cust) c_name = cust.c_name;
    }

    res.json({ ...inv, lp_customers: { c_name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
// POST /api/invoices
// Create a draft invoice for a load in WAIT_INVOICE_NO.
// ============================================================
router.post('/', requirePermission('INVOICES', 'edit'), async (req, res) => {
  try {
    const { load_no } = req.body;
    if (!load_no) return res.status(400).json({ error: 'load_no is required' });

    // Fetch load details
    const { data: load, error: loadErr } = await supabase
      .from('lp_movement')
      .select('*')
      .eq('m_load_no', load_no)
      .single();

    if (loadErr || !load) return res.status(404).json({ error: 'Load not found' });
    if (load.m_status !== 'WAIT_INVOICE_NO')
      return res.status(400).json({ error: `Load is in ${load.m_status} — only WAIT_INVOICE_NO loads can be invoiced` });

    // Check no active invoice already exists
    const { data: existing } = await supabase
      .from('lp_invoices')
      .select('id, inv_number, inv_status')
      .eq('inv_load_no', load_no)
      .neq('inv_status', 'CREDITED')
      .single();

    if (existing)
      return res.status(409).json({ error: `Invoice ${existing.inv_number} already exists for this load (${existing.inv_status})` });

    // Calculate amounts
    const amountExcl = Number(load.m_load_total || load.m_rate || 0);
    const vat        = Math.round(amountExcl * VAT_RATE * 100) / 100;
    const amountIncl = Math.round((amountExcl + vat) * 100) / 100;

    const inv_number = await genInvoiceNo();

    const { data: invoice, error: invErr } = await supabase
      .from('lp_invoices')
      .insert([{
        inv_number,
        inv_load_no:     load_no,
        inv_customer:    load.m_customer,
        inv_date:        new Date().toISOString().split('T')[0],
        inv_description: 'TRANSPORT SERVICES',
        inv_amount_excl: amountExcl,
        inv_vat:         vat,
        inv_amount_incl: amountIncl,
        inv_order_no:    load.m_order_no || null,
        inv_status:      'DRAFT',
        inv_created_by:  req.user.username,
      }])
      .select()
      .single();

    if (invErr) return res.status(500).json({ error: invErr.message });

    // Audit comment on load
    await supabase.from('lp_comments').insert([{
      c_load:      load_no,
      c_comment:   `Draft invoice ${inv_number} created by ${req.user.username}. Amount: R ${amountIncl.toLocaleString('en-ZA', { minimumFractionDigits: 2 })} (incl. VAT)`,
      c_logged_by: req.user.username,
    }]);

    res.status(201).json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
// POST /api/invoices/:id/approve
// Finalise a draft invoice → sets load to LOAD_INVOICED.
// ============================================================
router.post('/:id/approve', requirePermission('INVOICES', 'approve'), async (req, res) => {
  try {
    const { data: inv, error: fetchErr } = await supabase
      .from('lp_invoices').select('*').eq('id', req.params.id).single();

    if (fetchErr || !inv) return res.status(404).json({ error: 'Invoice not found' });
    if (inv.inv_status !== 'DRAFT')
      return res.status(400).json({ error: 'Only DRAFT invoices can be finalised' });

    // Atomic finance post: creates AR invoice, GL journal (Dr Debtors / Cr Revenue + VAT),
    // and VAT transaction — all in one DB transaction. Also sets lp_invoices.inv_status = FINAL
    // and the fin_* link columns. Uses fin_posting_config for revenue account (1000) and VAT code.
    const { data: posted, error: postErr } = await supabase.rpc('fin_post_lp_invoice', {
      p_lp_invoice_id: Number(req.params.id),
      p_posted_by:     req.user.username,
      p_revenue_account: null,  // resolved from fin_posting_config.transport_revenue_account
      p_vat_code:      null,    // resolved from fin_posting_config.default_output_vat_code
      p_entity_id:     1,
    });
    if (postErr) return res.status(400).json({ error: postErr.message });

    // Advance load to LOAD_INVOICED
    await supabase.from('lp_movement')
      .update({
        m_status:   'LOAD_INVOICED',
        m_invoice:  inv.inv_number,
        updated_at: new Date().toISOString(),
      })
      .eq('m_load_no', inv.inv_load_no);

    // Audit comment
    await supabase.from('lp_comments').insert([{
      c_load:      inv.inv_load_no,
      c_comment:   `Invoice ${inv.inv_number} finalised and posted to AR/GL by ${req.user.username}. Journal: ${posted?.journal_ref || 'see fin_gl_journals'}.`,
      c_logged_by: req.user.username,
    }]);

    res.json({ success: true, inv_number: inv.inv_number, ...(posted || {}) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
// POST /api/invoices/:id/credit-note
// Raise a credit note against a FINAL invoice.
// ============================================================
router.post('/:id/credit-note', requirePermission('INVOICES', 'edit'), async (req, res) => {
  try {
    const { reason, amount_excl } = req.body;
    if (!reason?.trim()) return res.status(400).json({ error: 'A reason is required for a credit note' });

    const { data: inv, error: fetchErr } = await supabase
      .from('lp_invoices').select('*').eq('id', req.params.id).single();

    if (fetchErr || !inv) return res.status(404).json({ error: 'Invoice not found' });
    if (inv.inv_status !== 'FINAL')
      return res.status(400).json({ error: 'Credit notes can only be raised against FINAL invoices' });

    // Finance guard: original invoice must be posted to AR before it can be credited.
    // Invoices approved before the finance posting migration was applied need to be
    // backfilled first (run migration_finance_posting_backfill.sql in Supabase).
    if (!inv.fin_ar_invoice_id) {
      return res.status(400).json({
        error: `Invoice ${inv.inv_number} has not been posted to the finance ledger. Ask Finance to post it first (run the backfill migration or re-approve it).`,
      });
    }

    const cnAmountExcl = amount_excl ? Number(amount_excl) : Number(inv.inv_amount_excl);
    const cnVat        = Math.round(cnAmountExcl * VAT_RATE * 100) / 100;
    const cnAmountIncl = Math.round((cnAmountExcl + cnVat) * 100) / 100;

    const cn_number = await genCreditNoteNo();

    // Step 1: create the LP credit note record
    const { data: cn, error: cnErr } = await supabase
      .from('lp_credit_notes')
      .insert([{
        cn_number,
        cn_invoice_id:   inv.id,
        cn_invoice_no:   inv.inv_number,
        cn_load_no:      inv.inv_load_no,
        cn_customer:     inv.inv_customer,
        cn_date:         new Date().toISOString().split('T')[0],
        cn_description:  'TRANSPORT SERVICES',
        cn_amount_excl:  cnAmountExcl,
        cn_vat:          cnVat,
        cn_amount_incl:  cnAmountIncl,
        cn_reason:       reason.trim(),
        cn_created_by:   req.user.username,
      }])
      .select()
      .single();

    if (cnErr) return res.status(500).json({ error: cnErr.message });

    // Step 2: atomic finance post — AR credit note, GL reversal, VAT reversal;
    // also sets lp_invoices.inv_status = CREDITED and lp_credit_notes fin_* columns.
    const { data: posted, error: postErr } = await supabase.rpc('fin_post_lp_credit_note', {
      p_lp_credit_note_id: cn.id,
      p_posted_by:         req.user.username,
      p_revenue_account:   null,
      p_vat_code:          null,
      p_entity_id:         1,
    });
    if (postErr) {
      // Finance post failed — CN record exists but is unposted (fin_ar_credit_note_id is null).
      // lp_invoices remains FINAL. Finance team must investigate before re-attempting.
      console.error('[invoices/credit-note] fin_post_lp_credit_note failed:', postErr.message);
      return res.status(400).json({
        error: `Credit note ${cn_number} was created but finance posting failed: ${postErr.message}. Contact Finance.`,
        cn_id: cn.id,
        cn_number,
      });
    }

    // Audit comment (lp_invoices.inv_status = CREDITED already set by RPC)
    await supabase.from('lp_comments').insert([{
      c_load:      inv.inv_load_no,
      c_comment:   `Credit note ${cn_number} raised by ${req.user.username} against ${inv.inv_number}. Reason: ${reason.trim()}. Amount: R ${cnAmountIncl.toLocaleString('en-ZA', { minimumFractionDigits: 2 })} incl. VAT. Journal: ${posted?.journal_ref || 'see fin_gl_journals'}.`,
      c_logged_by: req.user.username,
    }]);

    res.status(201).json({ ...cn, ...(posted || {}) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
// POST /api/invoices/:id/send-to-client
// Email the POD and/or invoice PDF to the client's configured
// addresses (lp_customers.c_pod_email / c_invoice_email), gated by
// c_send_pod / c_send_invoice. Only FINAL invoices can be sent.
// Requires Microsoft Graph to be configured (GRAPH_* env vars) —
// see lib/msgraph.js for setup details.
// ============================================================
router.post('/:id/send-to-client', requirePermission('INVOICES', 'approve'), async (req, res) => {
  try {
    const { data: inv, error: fetchErr } = await supabase
      .from('lp_invoices').select('*').eq('id', req.params.id).single();
    if (fetchErr || !inv) return res.status(404).json({ error: 'Invoice not found' });
    if (inv.inv_status !== 'FINAL')
      return res.status(400).json({ error: 'Only FINAL invoices can be emailed to the client' });

    const { data: customer } = await supabase
      .from('lp_customers').select('*').eq('c_code', inv.inv_customer).single();
    if (!customer) return res.status(404).json({ error: 'Customer record not found for this invoice' });

    const { data: load } = await supabase
      .from('lp_movement').select('m_from, m_to, m_date').eq('m_load_no', inv.inv_load_no).single();

    const wantInvoice = customer.c_send_invoice === 'Y' && customer.c_invoice_email?.trim();
    const wantPod     = customer.c_send_pod === 'Y' && customer.c_pod_email?.trim();

    if (!wantInvoice && !wantPod) {
      return res.status(400).json({
        error: 'This client has no Send POD / Send Invoice email address configured — set one on the Clients page first.',
      });
    }

    const sent = [];

    // ── Invoice email ───────────────────────────────────────
    if (wantInvoice) {
      const pdfBuffer = await generateInvoicePdfBuffer(inv, load, customer.c_name);
      await sendMail({
        to: customer.c_invoice_email,
        subject: `Invoice ${inv.inv_number} — ${customer.c_name}`,
        htmlBody: `<p>Dear ${customer.c_name},</p>
          <p>Please find attached invoice <strong>${inv.inv_number}</strong> for load ${inv.inv_load_no}, amounting to R ${Number(inv.inv_amount_incl).toLocaleString('en-ZA', { minimumFractionDigits: 2 })} (incl. VAT).</p>
          <p>Kind regards,<br/>${process.env.COMPANY_NAME || 'Interland Distribution Cape (Pty) Ltd'}</p>`,
        attachments: [{
          name: `Invoice_${inv.inv_number}.pdf`,
          contentType: 'application/pdf',
          contentBytes: pdfBuffer.toString('base64'),
        }],
      });
      sent.push({ type: 'invoice', to: customer.c_invoice_email });
    }

    // ── POD email ───────────────────────────────────────────
    if (wantPod) {
      const files = await listFolderFiles(`${SP_POD_FOLDER}/A${inv.inv_load_no}`);
      if (files.length === 0) {
        sent.push({ type: 'pod', to: customer.c_pod_email, skipped: 'No POD files found in SharePoint for this load' });
      } else {
        const attachments = [];
        for (const f of files.slice(0, 6)) { // cap attachments per email
          const contentBytes = await downloadFileAsBase64(f.id);
          attachments.push({ name: f.name, contentType: f.file.mimeType || 'application/octet-stream', contentBytes });
        }
        await sendMail({
          to: customer.c_pod_email,
          subject: `POD — Load ${inv.inv_load_no} — ${customer.c_name}`,
          htmlBody: `<p>Dear ${customer.c_name},</p>
            <p>Please find attached the proof of delivery for load <strong>${inv.inv_load_no}</strong>.</p>
            <p>Kind regards,<br/>${process.env.COMPANY_NAME || 'Interland Distribution Cape (Pty) Ltd'}</p>`,
          attachments,
        });
        sent.push({ type: 'pod', to: customer.c_pod_email, files: attachments.length });
      }
    }

    await supabase.from('lp_comments').insert([{
      c_load:      inv.inv_load_no,
      c_comment:   `Emailed to client by ${req.user.username}: ${sent.map(s => `${s.type}${s.skipped ? ' (skipped: ' + s.skipped + ')' : ' -> ' + s.to}`).join(', ')}.`,
      c_logged_by: req.user.username,
    }]);

    res.json({ success: true, sent });
  } catch (err) {
    if (err.notConfigured) return res.status(503).json({ error: err.message });
    console.error('[invoices/send-to-client]', err.message, err.details || '');
    res.status(500).json({ error: err.message });
  }
});



module.exports = router;
