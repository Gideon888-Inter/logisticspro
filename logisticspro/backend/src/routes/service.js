const express = require('express');
const supabase = require('../supabase');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ── Service card statuses ──────────────────────────────────────────────────────
const BLOCKING_STATUSES = ['SERVICE_ACCEPTED', 'WAITING_FOR_PART'];
const SERVICE_INTERVAL  = 40000;
const WARN_KM           = 5000;

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

// ============================================================
// GET /api/service — list all service cards
// ============================================================
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

// ============================================================
// GET /api/service/stats  ← MUST be before /:no
// ============================================================
router.get('/stats', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_service_cards')
    .select('sc_status');
  if (error) return res.status(500).json({ error: error.message });

  res.json({
    total:            data.length,
    pending:          data.filter(r => r.sc_status === 'PENDING_SERVICE').length,
    accepted:         data.filter(r => r.sc_status === 'SERVICE_ACCEPTED').length,
    waiting_for_part: data.filter(r => r.sc_status === 'WAITING_FOR_PART').length,
    complete:         data.filter(r => r.sc_status === 'COMPLETE').length,
  });
});

// ============================================================
// POST /api/service/auto-create  ← MUST be before /:no
// Idempotent — skips vehicles that already have an open card
// ============================================================
router.post('/auto-create', async (req, res) => {
  try {
    const { data: vehicles, error: vErr } = await supabase
      .from('lp_vehicles')
      .select('*')
      .eq('vh_active', 'Y');
    if (vErr) return res.status(500).json({ error: vErr.message });

    const codes = vehicles.map(v => v.vh_code);

    // Live odometer from last load
    const { data: loads } = await supabase
      .from('lp_movement')
      .select('m_truck, m_closing_km, m_opening_km, created_at')
      .in('m_truck', codes)
      .neq('m_status', 'DELETED')
      .order('created_at', { ascending: false });

    const loadMap = {};
    (loads || []).forEach(l => { if (!loadMap[l.m_truck]) loadMap[l.m_truck] = l; });

    // Last maintenance per vehicle
    const { data: maints } = await supabase
      .from('lp_maintenance')
      .select('ma_vehicle, ma_km, ma_service_type, created_at')
      .in('ma_vehicle', codes)
      .order('created_at', { ascending: false });

    const maintMap = {};
    (maints || []).forEach(m => {
      if (!maintMap[m.ma_vehicle]) maintMap[m.ma_vehicle] = { service: null, wheel: null };
      const isWheel = /wheel|align/i.test(m.ma_service_type || '');
      const e = maintMap[m.ma_vehicle];
      if (isWheel && !e.wheel) e.wheel = m;
      else if (!isWheel && !e.service) e.service = m;
    });

    // Existing open service cards
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

    for (const v of vehicles) {
      const lastLoad = loadMap[v.vh_code];
      const odo = lastLoad
        ? (Number(lastLoad.m_closing_km) || Number(lastLoad.m_opening_km) || Number(v.vh_odometer) || 0)
        : (Number(v.vh_odometer) || 0);

      const lm = maintMap[v.vh_code] || {};
      const nextSvc = lm.service ? Number(lm.service.ma_km) + SERVICE_INTERVAL : (Number(v.vh_next_service) || 0);
      const nextWhl = lm.wheel   ? Number(lm.wheel.ma_km)   + SERVICE_INTERVAL : (Number(v.vh_next_wheel)   || 0);

      const svcRem = nextSvc > 0 ? nextSvc - odo : null;
      const whlRem = nextWhl > 0 ? nextWhl - odo : null;
      const existing = openByVehicle[v.vh_code] || [];

      // Service due/overdue
      if (svcRem !== null && svcRem <= WARN_KM) {
        if (!existing.some(t => /SERVICE/i.test(t) && !/ALIGNMENT|WHEEL/i.test(t))) {
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
          await writeAudit(sc_no, 'AUTO_CREATED', `Auto-created: ${trigger}`, 'SYSTEM');
          existing.push(trigger);
          created.push({ sc_no, vehicle: v.vh_code, type: 'SERVICE', trigger });
        } else {
          skipped.push({ vehicle: v.vh_code, type: 'SERVICE', reason: 'open card exists' });
        }
      }

      // Wheel alignment due/overdue
      if (whlRem !== null && whlRem <= WARN_KM) {
        if (!existing.some(t => /ALIGNMENT|WHEEL/i.test(t))) {
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
          await writeAudit(sc_no, 'AUTO_CREATED', `Auto-created: ${trigger}`, 'SYSTEM');
          existing.push(trigger);
          created.push({ sc_no, vehicle: v.vh_code, type: 'ALIGNMENT', trigger });
        } else {
          skipped.push({ vehicle: v.vh_code, type: 'ALIGNMENT', reason: 'open card exists' });
        }
      }
    }

    res.json({ created: created.length, skipped: skipped.length, details: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/service/:no
// ============================================================
router.get('/:no', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_service_cards')
    .select('*')
    .eq('sc_no', req.params.no)
    .single();
  if (error) return res.status(404).json({ error: 'Service card not found' });
  res.json(data);
});

// ============================================================
// GET /api/service/:no/audit
// ============================================================
router.get('/:no/audit', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_service_audit')
    .select('*')
    .eq('sa_service_no', req.params.no)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ============================================================
// GET /api/service/:no/checklist
// ============================================================
router.get('/:no/checklist', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_service_checklist')
    .select('*')
    .eq('sl_service_no', req.params.no)
    .order('sl_order', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ============================================================
// GET /api/service/:no/comments
// ============================================================
router.get('/:no/comments', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_service_comments')
    .select('*')
    .eq('sm_service_no', req.params.no)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ============================================================
// POST /api/service — create new service card
// ============================================================
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

// ============================================================
// PATCH /api/service/:no — update status / notes
// ============================================================
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

  if (newStatus) {
    await writeAudit(req.params.no, 'STATUS_CHANGED',
      `Status changed to: ${newStatus}`, req.user.username);

    if (BLOCKING_STATUSES.includes(newStatus)) {
      await supabase.from('lp_vehicles')
        .update({ vh_in_service: 'Y' })
        .eq('vh_code', data.sc_vehicle);
    }
    if (newStatus === 'COMPLETE') {
      await supabase.from('lp_vehicles')
        .update({ vh_in_service: 'N' })
        .eq('vh_code', data.sc_vehicle);
      await writeAudit(req.params.no, 'COMPLETED',
        `Service completed. Vehicle ${data.sc_vehicle} returned to service.`, req.user.username);
    }
  }
  res.json(data);
});

// ============================================================
// POST /api/service/:no/comments
// ============================================================
router.post('/:no/comments', async (req, res) => {
  const { comment } = req.body;
  if (!comment?.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });

  const { data, error } = await supabase
    .from('lp_service_comments')
    .insert([{ sm_service_no: req.params.no, sm_comment: comment.trim(), sm_operator: req.user.username }])
    .select().single();
  if (error) return res.status(400).json({ error: error.message });

  await writeAudit(req.params.no, 'COMMENT_ADDED',
    `Comment: "${comment.trim().substring(0, 80)}${comment.length > 80 ? '…' : ''}"`,
    req.user.username);
  res.status(201).json(data);
});

// ============================================================
// POST /api/service/:no/checklist — add item
// ============================================================
router.post('/:no/checklist', async (req, res) => {
  const { item_label, sl_order } = req.body;
  if (!item_label?.trim()) return res.status(400).json({ error: 'Item label required' });

  const { data, error } = await supabase
    .from('lp_service_checklist')
    .insert([{
      sl_service_no: req.params.no, sl_label: item_label.trim(),
      sl_checked: false, sl_order: sl_order || 0, sl_operator: req.user.username,
    }])
    .select().single();
  if (error) return res.status(400).json({ error: error.message });

  await writeAudit(req.params.no, 'CHECKLIST_ITEM_ADDED',
    `Checklist item added: "${item_label.trim()}"`, req.user.username);
  res.status(201).json(data);
});

// ============================================================
// PATCH /api/service/:no/checklist/:id — toggle item
// ============================================================
router.patch('/:no/checklist/:id', async (req, res) => {
  const { sl_checked } = req.body;
  const { data, error } = await supabase
    .from('lp_service_checklist')
    .update({
      sl_checked,
      sl_checked_by: sl_checked ? req.user.username : null,
      sl_checked_at: sl_checked ? new Date().toISOString() : null,
    })
    .eq('id', req.params.id)
    .eq('sl_service_no', req.params.no)
    .select().single();
  if (error) return res.status(400).json({ error: error.message });

  await writeAudit(req.params.no, sl_checked ? 'CHECKLIST_CHECKED' : 'CHECKLIST_UNCHECKED',
    `"${data.sl_label}" ${sl_checked ? 'checked' : 'unchecked'}`, req.user.username);
  res.json(data);
});

// ============================================================
// DELETE /api/service/:no/checklist/:id
// ============================================================
router.delete('/:no/checklist/:id', async (req, res) => {
  const { data: item } = await supabase
    .from('lp_service_checklist').select('sl_label').eq('id', req.params.id).single();

  const { error } = await supabase
    .from('lp_service_checklist')
    .delete().eq('id', req.params.id).eq('sl_service_no', req.params.no);
  if (error) return res.status(400).json({ error: error.message });

  await writeAudit(req.params.no, 'CHECKLIST_ITEM_REMOVED',
    `Item removed: "${item?.sl_label || '?'}"`, req.user.username);
  res.json({ success: true });
});


// ============================================================
// POST /api/service/:no/reject — reject a pending service card
// ============================================================
router.post('/:no/reject', async (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ error: 'Rejection reason is required' });

  const { data, error } = await supabase
    .from('lp_service_cards')
    .update({
      sc_status:          'REJECTED',
      sc_rejected_reason: reason.trim(),
      updated_at:         new Date().toISOString(),
    })
    .eq('sc_no', req.params.no)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await writeAudit(req.params.no, 'REJECTED',
    `Service rejected. Reason: "${reason.trim()}"`, req.user.username);

  // Unblock vehicle (rejection means no service needed right now)
  await supabase.from('lp_vehicles')
    .update({ vh_in_service: 'N' })
    .eq('vh_code', data.sc_vehicle);

  res.json(data);
});

// ============================================================
// POST /api/service/:no/complete — complete service with KMs
// Updates vehicle odometer + unblocks it
// ============================================================
router.post('/:no/complete', async (req, res) => {
  const { completion_km } = req.body;
  const km = parseInt(completion_km, 10);
  if (!km || isNaN(km) || km <= 0)
    return res.status(400).json({ error: 'A valid completion odometer reading (km) is required' });

  // Must be SERVICE_ACCEPTED or WAITING_FOR_PART to complete
  const { data: existing } = await supabase
    .from('lp_service_cards').select('*').eq('sc_no', req.params.no).single();
  if (!existing) return res.status(404).json({ error: 'Service card not found' });
  if (!['SERVICE_ACCEPTED', 'WAITING_FOR_PART'].includes(existing.sc_status))
    return res.status(400).json({ error: 'Only accepted services can be completed' });

  // Update the service card
  const { data, error } = await supabase
    .from('lp_service_cards')
    .update({
      sc_status:        'COMPLETE',
      sc_completion_km: km,
      updated_at:       new Date().toISOString(),
    })
    .eq('sc_no', req.params.no)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Update vehicle: new odometer + unblock + record maintenance
  await supabase.from('lp_vehicles')
    .update({ vh_odometer: km, vh_in_service: 'N' })
    .eq('vh_code', data.sc_vehicle);

  // Write maintenance record so next-service interval recalculates correctly
  const isAlignment = /ALIGNMENT|WHEEL/i.test(existing.sc_trigger || '');
  await supabase.from('lp_maintenance').insert([{
    ma_vehicle:      data.sc_vehicle,
    ma_date:         new Date().toISOString().split('T')[0],
    ma_service_type: isAlignment ? 'Wheel Alignment' : 'Full Service',
    ma_km:           km,
    ma_next_service: km + 40000,
    ma_status:       'COMPLETE',
    ma_operator:     req.user.username,
  }]);

  await writeAudit(req.params.no, 'COMPLETED',
    `Service completed at ${km.toLocaleString('en-ZA')} km. Vehicle ${data.sc_vehicle} odometer updated and unblocked.`,
    req.user.username);

  res.json(data);
});

module.exports = router;
