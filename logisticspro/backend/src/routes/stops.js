/**
 * LP2.0 — Load Stops Route ("Extra Stop" on a load card)
 * =========================================================
 * Mirrors lp_costs's add / request-delete / approve-delete pattern: no
 * hard deletion, deletions go through an approval step.
 *
 * A stop optionally carries its own cost (s_amount) — kept separate from
 * lp_costs so a stop's location and its cost travel together and can be
 * removed as one unit, but it still rolls into the load's grand total the
 * same way additional costs do (see Loads.jsx ExpandedRow totals).
 */
const express = require('express');
const supabase = require('../supabase');
const { authMiddleware, loadUserPermissions, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
router.use(loadUserPermissions);

// Statuses after which no new stops can be added — mirrors COST_LOCKED_STATUSES
const STOP_LOCKED_STATUSES = [
  'WAIT_APPROVAL', 'WAIT_RATE_CHECK', 'WAIT_INVOICE_NO', 'LOAD_INVOICED', 'REJECTED', 'DELETED',
];

// ── GET /api/stops?load=A123456 ──────────────────────────────────────────────
router.get('/', requirePermission('LOADS', 'view'), async (req, res) => {
  const { load } = req.query;
  if (!load) return res.json([]);
  const { data, error } = await supabase
    .from('lp_load_stops')
    .select('*')
    .eq('s_load', load)
    .neq('s_deleted', 'Y')
    .order('s_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── GET /api/stops/pending-deletions ─────────────────────────────────────────
router.get('/pending-deletions', requirePermission('COSTS', 'approve'), async (req, res) => {
  const { data, error } = await supabase
    .from('lp_load_stops')
    .select('*')
    .eq('s_delete_requested', 'Y')
    .eq('s_deleted', 'N')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── POST /api/stops — add an extra stop ──────────────────────────────────────
router.post('/', requirePermission('COSTS', 'edit'), async (req, res) => {
  const { s_load, s_address } = req.body;
  if (!s_load) return res.status(400).json({ error: 'A load number is required' });
  if (!s_address?.trim()) return res.status(400).json({ error: 'A dropoff address is required' });

  const { data: load } = await supabase
    .from('lp_movement').select('m_status').eq('m_load_no', s_load).single();
  if (load && STOP_LOCKED_STATUSES.includes(load.m_status)) {
    return res.status(403).json({
      error: `Stops cannot be added once a load has reached ${load.m_status} status. Please contact your operator.`,
    });
  }

  const { data: existing } = await supabase
    .from('lp_load_stops').select('s_order').eq('s_load', s_load).order('s_order', { ascending: false }).limit(1);
  const nextOrder = (existing?.[0]?.s_order ?? -1) + 1;

  const payload = {
    s_load,
    s_order:      nextOrder,
    s_address:    s_address.trim(),
    s_latitude:   req.body.s_latitude ?? null,
    s_longitude:  req.body.s_longitude ?? null,
    s_amount:     Number(req.body.s_amount || 0),
    s_description: req.body.s_description || null,
    s_operator:   req.user.username,
  };

  const { data, error } = await supabase.from('lp_load_stops').insert([payload]).select().single();
  if (error) return res.status(400).json({ error: error.message });

  const amountTxt = payload.s_amount > 0
    ? ` (R ${payload.s_amount.toLocaleString('en-ZA', { minimumFractionDigits: 2 })})`
    : '';
  await supabase.from('lp_comments').insert([{
    c_load:      s_load,
    c_comment:   `Extra stop added: ${payload.s_address}${amountTxt}`,
    c_logged_by: req.user.username,
  }]);

  res.status(201).json(data);
});

// ── PATCH /api/stops/:id/request-delete ──────────────────────────────────────
router.patch('/:id/request-delete', requirePermission('COSTS', 'edit'), async (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ error: 'Please provide a reason for removing this stop' });

  const { data: stop } = await supabase.from('lp_load_stops').select('*').eq('stop_no', req.params.id).single();
  if (!stop) return res.status(404).json({ error: 'Stop not found' });
  if (stop.s_deleted === 'Y') return res.status(400).json({ error: 'Stop already removed' });
  if (stop.s_delete_requested === 'Y') return res.status(400).json({ error: 'Removal already requested' });

  await supabase.from('lp_load_stops').update({
    s_delete_requested: 'Y',
    s_delete_requested_by: req.user.username,
    s_delete_reason: reason,
  }).eq('stop_no', req.params.id);

  await supabase.from('lp_comments').insert([{
    c_load:      stop.s_load,
    c_comment:   `Extra stop removal requested: ${stop.s_address} — Reason: ${reason}`,
    c_logged_by: req.user.username,
  }]);

  await supabase.from('lp_notifications').insert([{
    n_role:    'OPERATOR',
    n_type:    'STOP_DELETE_REQUEST',
    n_title:   'Stop Removal Approval Required',
    n_message: `${req.user.username} requested removal of stop "${stop.s_address}" on load ${stop.s_load}. Reason: ${reason}`,
    n_load_no: stop.s_load,
  }]);

  res.json({ success: true });
});

// ── PATCH /api/stops/:id/approve-delete ──────────────────────────────────────
router.patch('/:id/approve-delete', requirePermission('COSTS', 'approve'), async (req, res) => {
  const { action, rejection_reason } = req.body;
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Action must be approve or reject' });

  const { data: stop } = await supabase.from('lp_load_stops').select('*').eq('stop_no', req.params.id).single();
  if (!stop) return res.status(404).json({ error: 'Stop not found' });

  if (action === 'approve') {
    await supabase.from('lp_load_stops').update({ s_deleted: 'Y', s_delete_requested: 'N' }).eq('stop_no', req.params.id);
    await supabase.from('lp_comments').insert([{
      c_load:      stop.s_load,
      c_comment:   `Extra stop removal approved by ${req.user.username}: ${stop.s_address}`,
      c_logged_by: req.user.username,
    }]);
  } else {
    if (!rejection_reason?.trim()) return res.status(400).json({ error: 'A rejection reason is required' });
    await supabase.from('lp_load_stops').update({ s_delete_requested: 'N' }).eq('stop_no', req.params.id);
    await supabase.from('lp_comments').insert([{
      c_load:      stop.s_load,
      c_comment:   `Extra stop removal rejected by ${req.user.username}: ${stop.s_address} — Reason: ${rejection_reason}`,
      c_logged_by: req.user.username,
    }]);
  }

  res.json({ success: true, action });
});

// ── DELETE /api/stops/:id — direct hard delete (approve-tier only, e.g. data fix) ──
router.delete('/:id', requirePermission('COSTS', 'approve'), async (req, res) => {
  const { error } = await supabase.from('lp_load_stops').delete().eq('stop_no', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Deleted' });
});

module.exports = router;
