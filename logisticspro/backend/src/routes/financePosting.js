/**
 * LP2 Finance posting routes
 *
 * Drop-in target:
 *   logisticspro/backend/src/routes/financePosting.js
 *
 * Register in backend/src/index.js:
 *   app.use('/api/fin/posting', require('./routes/financePosting'));
 *
 * These routes intentionally do not create journals line-by-line in Express.
 * They call Postgres RPC functions from sql/001_finance_posting_core.sql so the
 * whole posting operation commits or fails as one database transaction.
 */

const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const {
  authMiddleware,
  loadUserPermissions,
  requirePermission,
} = require('../middleware/auth');

router.use(authMiddleware);
router.use(loadUserPermissions);

const requireFinanceApprove = requirePermission('FINANCE', 'approve');
const requireFinanceEdit = requirePermission('FINANCE', 'edit');

function username(req) {
  return req.user?.username || req.user?.email || 'system';
}

async function callFinanceRpc(res, fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    return res.status(400).json({
      error: error.message,
      code: error.code,
      details: error.details || null,
      hint: error.hint || null,
    });
  }
  return res.json(data);
}

// POST /api/fin/posting/lp-invoices/:id
// Finalises/posts an LP operational invoice into AR, GL and VAT.
router.post('/lp-invoices/:id', requireFinanceApprove, async (req, res) => {
  return callFinanceRpc(res, 'fin_post_lp_invoice', {
    p_lp_invoice_id: Number(req.params.id),
    p_posted_by: username(req),
    p_revenue_account: req.body?.revenue_account || null,
    p_vat_code: req.body?.vat_code || null,
    p_entity_id: Number(req.body?.entity_id || 1),
  });
});

// POST /api/fin/posting/lp-credit-notes/:id
// Posts an LP credit note as AR credit note, GL reversal and VAT reversal.
router.post('/lp-credit-notes/:id', requireFinanceApprove, async (req, res) => {
  return callFinanceRpc(res, 'fin_post_lp_credit_note', {
    p_lp_credit_note_id: Number(req.params.id),
    p_posted_by: username(req),
    p_revenue_account: req.body?.revenue_account || null,
    p_vat_code: req.body?.vat_code || null,
    p_entity_id: Number(req.body?.entity_id || 1),
  });
});

// POST /api/fin/posting/ap-invoices/:id
// Posts a captured supplier invoice into AP, GL and VAT.
// Until AP invoice line-level GL accounts exist, expense_account is required.
router.post('/ap-invoices/:id', requireFinanceApprove, async (req, res) => {
  if (!req.body?.expense_account) {
    return res.status(400).json({
      error: 'expense_account is required until AP invoice line accounts are implemented',
    });
  }

  return callFinanceRpc(res, 'fin_post_ap_invoice', {
    p_ap_invoice_id: Number(req.params.id),
    p_posted_by: username(req),
    p_expense_account: req.body.expense_account,
    p_vat_code: req.body?.vat_code || null,
    p_entity_id: Number(req.body?.entity_id || 1),
  });
});

// POST /api/fin/posting/cashbook-staging/:id
// Posts a matched cashbook staging row into GL/VAT and marks it POSTED.
router.post('/cashbook-staging/:id', requireFinanceApprove, async (req, res) => {
  return callFinanceRpc(res, 'fin_post_cashbook_staging', {
    p_staging_id: Number(req.params.id),
    p_posted_by: username(req),
    p_entity_id: req.body?.entity_id ? Number(req.body.entity_id) : null,
  });
});

// POST /api/fin/posting/ar-allocations
// Body: { receipt_id, invoice_id, amount, note }
router.post('/ar-allocations', requireFinanceEdit, async (req, res) => {
  const { receipt_id, invoice_id, amount, note } = req.body || {};
  if (!receipt_id || !invoice_id || !amount) {
    return res.status(400).json({ error: 'receipt_id, invoice_id and amount are required' });
  }

  return callFinanceRpc(res, 'fin_allocate_ar_receipt', {
    p_receipt_id: Number(receipt_id),
    p_invoice_id: Number(invoice_id),
    p_amount: Number(amount),
    p_created_by: username(req),
    p_note: note || null,
  });
});

// POST /api/fin/posting/ap-allocations
// Body: { payment_id, invoice_id, amount, note }
router.post('/ap-allocations', requireFinanceEdit, async (req, res) => {
  const { payment_id, invoice_id, amount, note } = req.body || {};
  if (!payment_id || !invoice_id || !amount) {
    return res.status(400).json({ error: 'payment_id, invoice_id and amount are required' });
  }

  return callFinanceRpc(res, 'fin_allocate_ap_payment', {
    p_payment_id: Number(payment_id),
    p_invoice_id: Number(invoice_id),
    p_amount: Number(amount),
    p_created_by: username(req),
    p_note: note || null,
  });
});

module.exports = router;
