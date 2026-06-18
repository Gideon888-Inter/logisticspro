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

// ── POST /api/service/auto-create — create cards for all due/overdue vehicles ──
// Called from the frontend Service page on load. Idempotent — skips vehicles
// that already have an open (non-COMPLETE) service card.
router.post('/auto-create', async (req, res) => {
  try {
    const WARN_KM = 5000;

    // Get all active vehicles with enriched odometer/next-service from vehicles route
    // (we call Supabase directly here for speed)
    const { data: vehicles, error: vErr } = await supabase
      .from('lp_vehicles')
      .select('*')
      .eq('vh_active', 'Y');
    if (vErr) return res.status(500).json({ error: vErr.message });

    // Get last load per vehicle for live odometer
    const codes = vehicles.map(v => v.vh_code);
    const { data: loads } = await supabase
      .from('lp_movement')
      .select('m_truck, m_closing_km, m_opening_km, created_at')
      .in('m_truck', codes)
      .neq('m_status', 'DELETED')
      .order('created_at', { ascending: false });

    const loadMap = {};
    (loads || []).forEach(l => {
      if (!loadMap[l.m_truck]) loadMap[l.m_truck] = l;
    });

    // Get last maintenance per vehicle
    const { data: maints } = await supabase
      .from('lp_maintenance')
      .select('ma_vehicle, ma_km, ma_service_type, created_at')
      .in('ma_vehicle', codes)
      .order('created_at', { ascending: false });

    const maintMap = {};
    (maints || []).forEach(m => {
      if (!maintMap[m.ma_vehicle]) maintMap[m.ma_vehicle] = { service: null, wheel: null };
      const isWheel = /wheel|align/i.test(m.ma_service_type || '');
      const entry = maintMap[m.ma_vehicle];
      if (isWheel && !entry.wheel) entry.wheel = m;
      else if (!isWheel && !entry.service) entry.service = m;
    });

    // Get existing OPEN service cards so we don't duplicate
    const { data: openCards } = await supabase
      .from('lp_service_cards')
      .select('sc_vehicle, sc_trigger')
      .neq('sc_status', 'COMPLETE');

    const openByVehicle = {};
    (openCards || []).forEach(c => {
      if (!openByVehicle[c.sc_vehicle]) openByVehicle[c.sc_vehicle] = [];
      openByVehicle[c.sc_vehicle].push(c.sc_trigger || '');
    });

    const created = [];
    const skipped = [];
    const SERVICE_INTERVAL = 40000;

    for (const v of vehicles) {
      const lastLoad = loadMap[v.vh_code];
      const odo = lastLoad
        ? (Number(lastLoad.m_closing_km) || Number(lastLoad.m_opening_km) || Number(v.vh_odometer) || 0)
        : (Number(v.vh_odometer) || 0);

      const lastMaint = maintMap[v.vh_code] || {};
      const nextService = lastMaint.service
        ? Number(lastMaint.service.ma_km) + SERVICE_INTERVAL
        : (Number(v.vh_next_service) || 0);
      const nextWheel = lastMaint.wheel
        ? Number(lastMaint.wheel.ma_km) + SERVICE_INTERVAL
        : (Number(v.vh_next_wheel) || 0);

      const svcRem = nextService > 0 ? nextService - odo : null;
      const whlRem = nextWheel > 0  ? nextWheel - odo   : null;

      const existingTriggers = openByVehicle[v.vh_code] || [];

      // Create service card if due/overdue and no open SERVICE card yet
      if (svcRem !== null && svcRem <= WARN_KM) {
        const alreadyOpen = existingTriggers.some(t => t.includes('SERVICE'));
        if (!alreadyOpen) {
          const sc_no = await generateServiceNo();
          const trigger = svcRem <= 0
            ? `Service OVERDUE by ${Math.abs(svcRem).toLocaleString('en-ZA')} km`
            : `Service due: ${svcRem.toLocaleString('en-ZA')} km remaining`;

          await supabase.from('lp_service_cards').insert([{
            sc_no, sc_vehicle: v.vh_code, sc_status: 'PENDING_SERVICE',
            sc_trigger: trigger, sc_odometer: odo,
            sc_operator: req.user.username,
            sc_date: new Date().toISOString().split('T')[0],
          }]);
          await supabase.from('lp_service_audit').insert([{
            sa_service_no: sc_no, sa_action: 'AUTO_CREATED',
            sa_detail: `Auto-created: ${trigger}`,
            sa_operator: 'SYSTEM',
          }]);
          if (!openByVehicle[v.vh_code]) openByVehicle[v.vh_code] = [];
          openByVehicle[v.vh_code].push(trigger);
          created.push({ sc_no, vehicle: v.vh_code, type: 'SERVICE', trigger });
        } else {
          skipped.push({ vehicle: v.vh_code, type: 'SERVICE', reason: 'open card exists' });
        }
      }

      // Create service card if wheel alignment due/overdue and no open ALIGNMENT card yet
      if (whlRem !== null && whlRem <= WARN_KM) {
        const alreadyOpen = existingTriggers.some(t => t.includes('Alignment') || t.includes('ALIGNMENT'));
        if (!alreadyOpen) {
          const sc_no = await generateServiceNo();
          const trigger = whlRem <= 0
            ? `Wheel Alignment OVERDUE by ${Math.abs(whlRem).toLocaleString('en-ZA')} km`
            : `Wheel Alignment due: ${whlRem.toLocaleString('en-ZA')} km remaining`;

          await supabase.from('lp_service_cards').insert([{
            sc_no, sc_vehicle: v.vh_code, sc_status: 'PENDING_SERVICE',
            sc_trigger: trigger, sc_odometer: odo,
            sc_operator: req.user.username,
            sc_date: new Date().toISOString().split('T')[0],
          }]);
          await supabase.from('lp_service_audit').insert([{
            sa_service_no: sc_no, sa_action: 'AUTO_CREATED',
            sa_detail: `Auto-created: ${trigger}`,
            sa_operator: 'SYSTEM',
          }]);
          if (!openByVehicle[v.vh_code]) openByVehicle[v.vh_code] = [];
          openByVehicle[v.vh_code].push(trigger);
          created.push({ sc_no, vehicle: v.vh_code, type: 'ALIGNMENT', trigger });
        } else {
          skipped.push({ vehicle: v.vh_code, type: 'ALIGNMENT', reason: 'open card exists' });
        }
      }
    }

    res.json({
      created: created.length,
      skipped: skipped.length,
      details: created,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
