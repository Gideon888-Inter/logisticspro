const express = require('express');
const supabase = require('../supabase');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ── Service card statuses ──────────────────────────────────────────────────────
const STATUSES = ['PENDING_SERVICE', 'SERVICE_ACCEPTED', 'WAITING_FOR_PART', 'COMPLETE'];

// ── Statuses that block vehicle from loads ────────────────────────────────────
const BLOCKING_STATUSES = ['SERVICE_ACCEPTED', 'WAITING_FOR_PART'];

// ── Write audit entry ─────────────────────────────────────────────────────────
async function writeAudit(serviceNo, action, detail, operator) {
  await supabase.from('lp_service_audit').insert([{
    sa_service_no: serviceNo,
    sa_action:     action,
    sa_detail:     detail,
    sa_operator:   operator,
  }]);
}

// ── Auto-generate service card number: S + 6 digits sequential ───────────────
async function generateServiceNo() {
  const { data, error } = await supabase
    .from('lp_service_cards')
    .select('sc_no')
    .like('sc_no', 'S%')
    .order('sc_no', { ascending: false })
    .limit(1);

  let next = 100001;
  if (!error && data && data.length > 0) {
    const n = parseInt(data[0].sc_no.replace('S', ''), 10);
    if (!isNaN(n)) next = n + 1;
  }
  return 'S' + String(next).padStart(6, '0');
}

// ── GET /api/service — list all service cards ─────────────────────────────────
router.get('/', async (req, res) => {
  const { status, vehicle, page = 1, limit = 100 } = req.query;
  const offset = (page - 1) * limit;

  let q = supabase
    .from('lp_service_cards')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + Number(limit) - 1);

  if (status)  q = q.eq('sc_status', status);
  if (vehicle) q = q.eq('sc_vehicle', vehicle);

  const { data, error, count } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: data || [], total: count, page: Number(page), limit: Number(limit) });
});

// ── GET /api/service/stats ─────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_service_cards')
    .select('sc_status');
  if (error) return res.status(500).json({ error: error.message });

  const stats = {
    total:            data.length,
    pending:          data.filter(r => r.sc_status === 'PENDING_SERVICE').length,
    accepted:         data.filter(r => r.sc_status === 'SERVICE_ACCEPTED').length,
    waiting_for_part: data.filter(r => r.sc_status === 'WAITING_FOR_PART').length,
    complete:         data.filter(r => r.sc_status === 'COMPLETE').length,
  };
  res.json(stats);
});

// ── GET /api/service/:no ───────────────────────────────────────────────────────
router.get('/:no', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_service_cards')
    .select('*')
    .eq('sc_no', req.params.no)
    .single();
  if (error) return res.status(404).json({ error: 'Service card not found' });
  res.json(data);
});

// ── GET /api/service/:no/audit ────────────────────────────────────────────────
router.get('/:no/audit', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_service_audit')
    .select('*')
    .eq('sa_service_no', req.params.no)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── GET /api/service/:no/checklist ───────────────────────────────────────────
router.get('/:no/checklist', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_service_checklist')
    .select('*')
    .eq('sl_service_no', req.params.no)
    .order('sl_order', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── GET /api/service/:no/comments ────────────────────────────────────────────
router.get('/:no/comments', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_service_comments')
    .select('*')
    .eq('sm_service_no', req.params.no)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── POST /api/service — create new service card ───────────────────────────────
router.post('/', async (req, res) => {
  try {
    const sc_no = await generateServiceNo();

    const card = {
      ...req.body,
      sc_no,
      sc_status:   'PENDING_SERVICE',
      sc_operator: req.user.username,
      sc_date:     new Date().toISOString().split('T')[0],
    };

    const { data, error } = await supabase
      .from('lp_service_cards')
      .insert([card])
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await writeAudit(sc_no, 'CREATED',
      `Service card created for vehicle ${card.sc_vehicle}. Triggered by: ${card.sc_trigger || 'Manual'}.`,
      req.user.username);

    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/service/:no — update card (status, notes, etc.) ───────────────
router.patch('/:no', async (req, res) => {
  const updates = { ...req.body, updated_at: new Date().toISOString() };
  const newStatus = updates.sc_status;

  const { data, error } = await supabase
    .from('lp_service_cards')
    .update(updates)
    .eq('sc_no', req.params.no)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Log status change
  if (newStatus) {
    await writeAudit(req.params.no, 'STATUS_CHANGED',
      `Status changed to: ${newStatus}`,
      req.user.username);

    // When SERVICE_ACCEPTED or WAITING_FOR_PART: block vehicle from load cards
    if (BLOCKING_STATUSES.includes(newStatus)) {
      await supabase
        .from('lp_vehicles')
        .update({ vh_in_service: 'Y' })
        .eq('vh_code', data.sc_vehicle);
    }

    // When COMPLETE: unblock vehicle
    if (newStatus === 'COMPLETE') {
      await supabase
        .from('lp_vehicles')
        .update({ vh_in_service: 'N' })
        .eq('vh_code', data.sc_vehicle);

      await writeAudit(req.params.no, 'COMPLETED',
        `Service completed. Vehicle ${data.sc_vehicle} returned to service.`,
        req.user.username);
    }
  }

  res.json(data);
});

// ── POST /api/service/:no/comments — add comment ─────────────────────────────
router.post('/:no/comments', async (req, res) => {
  const { comment } = req.body;
  if (!comment?.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });

  const { data, error } = await supabase
    .from('lp_service_comments')
    .insert([{
      sm_service_no: req.params.no,
      sm_comment:    comment.trim(),
      sm_operator:   req.user.username,
    }])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await writeAudit(req.params.no, 'COMMENT_ADDED',
    `Comment added: "${comment.trim().substring(0, 80)}${comment.length > 80 ? '…' : ''}"`,
    req.user.username);

  res.status(201).json(data);
});

// ── POST /api/service/:no/checklist — add checklist item ─────────────────────
router.post('/:no/checklist', async (req, res) => {
  const { item_label, sl_order } = req.body;
  if (!item_label?.trim()) return res.status(400).json({ error: 'Item label required' });

  const { data, error } = await supabase
    .from('lp_service_checklist')
    .insert([{
      sl_service_no: req.params.no,
      sl_label:      item_label.trim(),
      sl_checked:    false,
      sl_order:      sl_order || 0,
      sl_operator:   req.user.username,
    }])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await writeAudit(req.params.no, 'CHECKLIST_ITEM_ADDED',
    `Checklist item added: "${item_label.trim()}"`,
    req.user.username);

  res.status(201).json(data);
});

// ── PATCH /api/service/:no/checklist/:id — toggle checklist item ─────────────
router.patch('/:no/checklist/:id', async (req, res) => {
  const { sl_checked, sl_checked_by } = req.body;

  const { data, error } = await supabase
    .from('lp_service_checklist')
    .update({
      sl_checked:    sl_checked,
      sl_checked_by: sl_checked ? (sl_checked_by || req.user.username) : null,
      sl_checked_at: sl_checked ? new Date().toISOString() : null,
    })
    .eq('id', req.params.id)
    .eq('sl_service_no', req.params.no)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await writeAudit(req.params.no, sl_checked ? 'CHECKLIST_CHECKED' : 'CHECKLIST_UNCHECKED',
    `"${data.sl_label}" ${sl_checked ? 'checked' : 'unchecked'} by ${req.user.username}`,
    req.user.username);

  res.json(data);
});

// ── DELETE /api/service/:no/checklist/:id ────────────────────────────────────
router.delete('/:no/checklist/:id', async (req, res) => {
  const { data: item } = await supabase
    .from('lp_service_checklist')
    .select('sl_label')
    .eq('id', req.params.id)
    .single();

  const { error } = await supabase
    .from('lp_service_checklist')
    .delete()
    .eq('id', req.params.id)
    .eq('sl_service_no', req.params.no);

  if (error) return res.status(400).json({ error: error.message });

  await writeAudit(req.params.no, 'CHECKLIST_ITEM_REMOVED',
    `Checklist item removed: "${item?.sl_label || 'Unknown'}"`,
    req.user.username);

  res.json({ success: true });
});

module.exports = router;
