const express = require('express');
const supabase = require('../supabase');
const { authMiddleware, loadUserPermissions, requirePermission } = require('../middleware/auth');
const router = express.Router();
router.use(authMiddleware);
router.use(loadUserPermissions);

// Statuses after which no new costs can be added
const COST_LOCKED_STATUSES = [
  'WAIT_APPROVAL', 'WAIT_RATE_CHECK', 'WAIT_INVOICE_NO', 'LOAD_INVOICED', 'REJECTED', 'DELETED',
];

// GET pending cost deletions
router.get('/pending-deletions', requirePermission('COSTS', 'approve'), async (req, res) => {
  const { data, error } = await supabase
    .from('lp_costs')
    .select('*')
    .eq('c_delete_requested', 'Y')
    .eq('c_deleted', 'N')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// GET costs — single load or all loads summary
router.get('/', requirePermission('COSTS', 'view'), async (req, res) => {
  const { load, summary } = req.query;

  // Return all costs as a load_no -> total map for dashboard
  if (summary === 'true') {
    const { data, error } = await supabase
      .from('lp_costs')
      .select('c_load, c_amount')
      .neq('c_deleted', 'Y');
    if (error) return res.status(500).json({ error: error.message });
    const map = {};
    (data || []).forEach(c => {
      map[c.c_load] = (map[c.c_load] || 0) + Number(c.c_amount || 0);
    });
    return res.json(map);
  }

  if (!load) return res.json([]);
  const { data, error } = await supabase
    .from('lp_costs')
    .select('*')
    .eq('c_load', load)
    .neq('c_deleted', 'Y')
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST add a cost — blocked after WAIT_APPROVAL
router.post('/', requirePermission('COSTS', 'edit'), async (req, res) => {
  const { c_load } = req.body;

  // ── Status guard: no costs after WAIT_APPROVAL ──
  if (c_load) {
    const { data: load } = await supabase
      .from('lp_movement')
      .select('m_status')
      .eq('m_load_no', c_load)
      .single();

    if (load && COST_LOCKED_STATUSES.includes(load.m_status)) {
      return res.status(403).json({
        error: `Costs cannot be added once a load has reached ${load.m_status} status. Please contact your operator.`,
      });
    }
  }

  const payload = {
    ...req.body,
    c_operator: req.user.username,
    c_description: req.body.c_description || req.body.c_code,
  };
  const { data, error } = await supabase
    .from('lp_costs')
    .insert([payload])
    .select().single();
  if (error) return res.status(400).json({ error: error.message });

  // Add audit trail comment
  if (c_load) {
    const amount = Number(req.body.c_amount||0).toLocaleString('en-ZA', {minimumFractionDigits:2});
    await supabase.from('lp_comments').insert([{
      c_load,
      c_comment: `Cost added: ${req.body.c_code} — R ${amount} (${req.body.c_description || req.body.c_code})`,
      c_logged_by: req.user.username,
    }]);
  }

  res.status(201).json(data);
});

// DELETE a cost
router.delete('/:id', requirePermission('COSTS', 'approve'), async (req, res) => {
  const { error } = await supabase.from('lp_costs').delete().eq('c_cost_no', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Deleted' });
});

// PATCH request deletion of a cost (operator requests, needs approval)
router.patch('/:id/request-delete', requirePermission('COSTS', 'edit'), async (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ error: 'Please provide a reason for deletion' });

  const { data: cost } = await supabase.from('lp_costs').select('*').eq('c_cost_no', req.params.id).single();
  if (!cost) return res.status(404).json({ error: 'Cost not found' });
  if (cost.c_deleted === 'Y') return res.status(400).json({ error: 'Cost already deleted' });
  if (cost.c_delete_requested === 'Y') return res.status(400).json({ error: 'Deletion already requested' });

  await supabase.from('lp_costs').update({
    c_delete_requested: 'Y',
    c_delete_requested_by: req.user.username,
    c_delete_reason: reason,
  }).eq('c_cost_no', req.params.id);

  // Add audit comment
  await supabase.from('lp_comments').insert([{
    c_load: cost.c_load,
    c_comment: `Cost deletion requested: ${cost.c_code} R ${Number(cost.c_amount).toLocaleString('en-ZA', {minimumFractionDigits:2})} — Reason: ${reason}`,
    c_logged_by: req.user.username,
  }]);

  // Notify operations/managers
  await supabase.from('lp_notifications').insert([{
    n_role: 'OPERATOR',
    n_type: 'COST_DELETE_REQUEST',
    n_title: 'Cost Deletion Approval Required',
    n_message: `${req.user.username} requested deletion of ${cost.c_code} R ${Number(cost.c_amount).toFixed(2)} on load ${cost.c_load}. Reason: ${reason}`,
    n_load_no: cost.c_load,
  }]);

  res.json({ success: true });
});

// PATCH approve or reject cost deletion (operations/manager only)
router.patch('/:id/approve-delete', requirePermission('COSTS', 'approve'), async (req, res) => {
  const { action, rejection_reason } = req.body;
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Action must be approve or reject' });

  const { data: cost } = await supabase.from('lp_costs').select('*').eq('c_cost_no', req.params.id).single();
  if (!cost) return res.status(404).json({ error: 'Cost not found' });

  if (action === 'approve') {
    await supabase.from('lp_costs').update({ c_deleted: 'Y', c_delete_requested: 'N' }).eq('c_cost_no', req.params.id);
    await supabase.from('lp_comments').insert([{
      c_load: cost.c_load,
      c_comment: `Cost deletion approved by ${req.user.username}: ${cost.c_code} R ${Number(cost.c_amount).toFixed(2)}`,
      c_logged_by: req.user.username,
    }]);
  } else {
    if (!rejection_reason?.trim()) return res.status(400).json({ error: 'A rejection reason is required' });
    await supabase.from('lp_costs').update({ c_delete_requested: 'N' }).eq('c_cost_no', req.params.id);
    await supabase.from('lp_comments').insert([{
      c_load: cost.c_load,
      c_comment: `Cost deletion rejected by ${req.user.username}: ${cost.c_code} — Reason: ${rejection_reason}`,
      c_logged_by: req.user.username,
    }]);
  }

  res.json({ success: true, action });
});

module.exports = router;
