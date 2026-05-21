const express = require('express');
const supabase = require('../supabase');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();
router.use(authMiddleware);

// GET pending cost deletions
router.get('/pending-deletions', async (req, res) => {
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
router.get('/', async (req, res) => {
  const { load, summary } = req.query;

  // Return all costs as a load_no -> total map for dashboard
  if (summary === 'true') {
    const { data, error } = await supabase
      .from('lp_costs')
      .select('c_load, c_amount');
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
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST add a cost
router.post('/', async (req, res) => {
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
  if (req.body.c_load) {
    const amount = Number(req.body.c_amount||0).toLocaleString('en-ZA', {minimumFractionDigits:2});
    await supabase.from('lp_comments').insert([{
      c_load: req.body.c_load,
      c_comment: `Cost added: ${req.body.c_code} — R ${amount} (${req.body.c_description || req.body.c_code})`,
      c_logged_by: req.user.username,
    }]);
  }

  res.status(201).json(data);
});

// DELETE a cost
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('lp_costs').delete().eq('c_cost_no', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Deleted' });
});

// PATCH request deletion of a cost (operator requests, needs approval)
router.patch('/:id/request-delete', async (req, res) => {
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
    n_role: 'OPERATIONS',
    n_type: 'COST_DELETE_REQUEST',
    n_title: 'Cost Deletion Approval Required',
    n_message: `${req.user.username} requested deletion of ${cost.c_code} R ${Number(cost.c_amount).toFixed(2)} on load ${cost.c_load}. Reason: ${reason}`,
    n_load_no: cost.c_load,
  }]);

  res.json({ success: true });
});

// PATCH approve or reject cost deletion (operations/manager only)
router.patch('/:id/approve-delete', async (req, res) => {
  const { action, rejection_reason } = req.body;
  const { data: cost } = await supabase.from('lp_costs').select('*').eq('c_cost_no', req.params.id).single();
  if (!cost) return res.status(404).json({ error: 'Cost not found' });

  if (action === 'approve') {
    await supabase.from('lp_costs').update({
      c_deleted: 'Y',
      c_deleted_by: req.user.username,
      c_deleted_at: new Date().toISOString(),
      c_delete_requested: 'N',
    }).eq('c_cost_no', req.params.id);

    await supabase.from('lp_comments').insert([{
      c_load: cost.c_load,
      c_comment: `Cost deletion APPROVED by ${req.user.username}: ${cost.c_code} R ${Number(cost.c_amount).toLocaleString('en-ZA', {minimumFractionDigits:2})}`,
      c_logged_by: req.user.username,
    }]);

    // Notify requestor
    await supabase.from('lp_notifications').insert([{
      n_user: cost.c_delete_requested_by,
      n_type: 'COST_DELETE_APPROVED',
      n_title: 'Cost Deletion Approved',
      n_message: `Your request to delete ${cost.c_code} R ${Number(cost.c_amount).toFixed(2)} on load ${cost.c_load} was approved.`,
      n_load_no: cost.c_load,
    }]);
  } else {
    await supabase.from('lp_costs').update({
      c_delete_requested: 'N',
      c_delete_requested_by: null,
      c_delete_reason: null,
    }).eq('c_cost_no', req.params.id);

    await supabase.from('lp_comments').insert([{
      c_load: cost.c_load,
      c_comment: `Cost deletion REJECTED by ${req.user.username}: ${cost.c_code} R ${Number(cost.c_amount).toLocaleString('en-ZA', {minimumFractionDigits:2})}. Reason: ${rejection_reason || 'No reason given'}`,
      c_logged_by: req.user.username,
    }]);

    await supabase.from('lp_notifications').insert([{
      n_user: cost.c_delete_requested_by,
      n_type: 'COST_DELETE_REJECTED',
      n_title: 'Cost Deletion Rejected',
      n_message: `Your request to delete ${cost.c_code} on load ${cost.c_load} was rejected. Reason: ${rejection_reason || 'No reason given'}`,
      n_load_no: cost.c_load,
    }]);
  }

  res.json({ success: true, action });
});

module.exports = router;
