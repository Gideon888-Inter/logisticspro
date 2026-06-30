const express = require('express');
const supabase = require('../supabase');
const { authMiddleware, loadUserPermissions, requirePermission } = require('../middleware/auth');
const { getPulsitVehicles, mapVehicle } = require('../lib/pulsit');
const { normalizeVehicleKey } = require('../lib/vehicleCode');
const router = express.Router();
router.use(authMiddleware);
router.use(loadUserPermissions);

const DEAD_KM_THRESHOLD = 500;

// ── Shared: apply a closing KM value to a load (used by both the Pulsit-
// driven auto-confirm endpoint and the manual fallback below) ──────────────
async function applyClosingKm(loadNo, closing, loggedBy, source) {
  const { data: load, error: loadErr } = await supabase
    .from('lp_movement')
    .select('*')
    .eq('m_load_no', loadNo)
    .single();

  if (loadErr || !load) return { error: 'Load not found', status: 404 };

  const opening = Number(load.m_opening_km || 0);

  if (closing < opening) {
    return {
      status: 400,
      error: `Closing KM (${closing.toLocaleString()}) cannot be less than opening KM (${opening.toLocaleString()})`,
      code: 'CLOSING_LESS_THAN_OPENING',
    };
  }

  const { data: rateRow } = await supabase
    .from('lp_client_rates')
    .select('rc_kms')
    .eq('rc_client_code', load.m_customer)
    .eq('rc_from', load.m_from)
    .eq('rc_to', load.m_to)
    .single();

  const routeKm = rateRow?.rc_kms || 0;
  const maxAllowed = opening + routeKm + DEAD_KM_THRESHOLD;

  if (routeKm > 0 && closing > maxAllowed) {
    return {
      status: 400,
      error: `Closing KM (${closing.toLocaleString()}) exceeds maximum allowed (${maxAllowed.toLocaleString()} = opening ${opening.toLocaleString()} + route ${routeKm.toLocaleString()} km + 500 km tolerance)`,
      code: 'CLOSING_EXCEEDS_MAX',
      max_allowed: maxAllowed,
      route_km: routeKm,
    };
  }

  const actual_km = closing - opening;

  const { data: updated, error: updateErr } = await supabase
    .from('lp_movement')
    .update({
      m_closing_km: closing,
      m_actual_km: actual_km,
      m_status: 'OFFLOADED',
      updated_at: new Date().toISOString(),
    })
    .eq('m_load_no', loadNo)
    .select()
    .single();

  if (updateErr) return { status: 400, error: updateErr.message };

  await supabase.from('lp_vehicles').update({ vh_odometer: closing }).eq('vh_code', load.m_truck);

  const sourceTxt = source === 'pulsit' ? ' (auto-read from Pulsit GPS)' : '';
  await supabase.from('lp_comments').insert([{
    c_load: loadNo,
    c_comment: `Load offloaded. Opening KM: ${opening.toLocaleString()} | Closing KM: ${closing.toLocaleString()}${sourceTxt} | Distance: ${actual_km.toLocaleString()} km`,
    c_logged_by: loggedBy,
  }]);

  return { data: { ...updated, actual_km, route_km: routeKm } };
}

// GET live Pulsit odometer reading for a truck — used by the load-card
// "Confirm Offload" flow to auto-fill the closing KM instead of manual
// entry. Pulsit only exposes a CURRENT/live odometer snapshot (no
// as-of-timestamp history endpoint is integrated), so this reflects the
// truck's odometer at the moment it's called — accurate as long as the
// operator confirms reasonably close to when the load actually finished,
// same assumption the old manual-entry step relied on.
router.get('/pulsit-reading/:truck', requirePermission('KM', 'view'), async (req, res) => {
  const { truck } = req.params;
  try {
    const { data: veh } = await supabase
      .from('lp_vehicles').select('vh_code, vh_registration').eq('vh_code', truck).single();

    const list = await getPulsitVehicles();
    const key = normalizeVehicleKey(truck);
    const match = list.map(mapVehicle).find(p =>
      (p.code && normalizeVehicleKey(p.code) === key) ||
      (veh?.vh_registration && p.regNo && normalizeVehicleKey(p.regNo) === normalizeVehicleKey(veh.vh_registration))
    );

    if (!match || match.odometer == null) {
      return res.status(404).json({ error: `No live Pulsit odometer reading found for ${truck}. Enter the closing KM manually instead.` });
    }

    res.json({ odometer: Math.round(Number(match.odometer)), lastUpdate: match.lastUpdate, source: 'pulsit' });
  } catch (e) {
    res.status(502).json({ error: `Pulsit tracking unavailable (${e.message}). Enter the closing KM manually instead.` });
  }
});

// POST confirm offload using the live Pulsit odometer reading — the
// primary closing-KM workflow. Re-fetches Pulsit server-side rather than
// trusting a client-supplied number, for integrity.
router.post('/closing-auto/:loadNo', requirePermission('KM', 'edit'), async (req, res) => {
  const { loadNo } = req.params;

  const { data: load, error: loadErr } = await supabase
    .from('lp_movement').select('m_truck').eq('m_load_no', loadNo).single();
  if (loadErr || !load) return res.status(404).json({ error: 'Load not found' });
  if (!load.m_truck) return res.status(400).json({ error: 'This load has no truck assigned' });

  const { data: veh } = await supabase
    .from('lp_vehicles').select('vh_registration').eq('vh_code', load.m_truck).single();

  let odometer;
  try {
    const list = await getPulsitVehicles();
    const key = normalizeVehicleKey(load.m_truck);
    const match = list.map(mapVehicle).find(p =>
      (p.code && normalizeVehicleKey(p.code) === key) ||
      (veh?.vh_registration && p.regNo && normalizeVehicleKey(p.regNo) === normalizeVehicleKey(veh.vh_registration))
    );
    if (!match || match.odometer == null) {
      return res.status(404).json({
        error: `No live Pulsit odometer reading found for ${load.m_truck}. Use manual entry instead.`,
        code: 'PULSIT_NO_READING',
      });
    }
    odometer = Math.round(Number(match.odometer));
  } catch (e) {
    return res.status(502).json({
      error: `Pulsit tracking unavailable (${e.message}). Use manual entry instead.`,
      code: 'PULSIT_UNAVAILABLE',
    });
  }

  const result = await applyClosingKm(loadNo, odometer, req.user.username, 'pulsit');
  if (result.error) return res.status(result.status || 400).json(result);
  res.json(result.data);
});

// GET last closing KM for a truck
router.get('/last-closing/:truck', requirePermission('KM', 'view'), async (req, res) => {
  const { truck } = req.params;
  const { data, error } = await supabase
    .from('lp_movement')
    .select('m_load_no, m_closing_km, m_date')
    .eq('m_truck', truck)
    .gt('m_closing_km', 0)
    .not('m_status', 'eq', 'DELETED')
    .order('m_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) return res.status(500).json({ error: error.message });

  if (data && data.length > 0) {
    return res.json({ last_closing_km: data[0].m_closing_km, load_no: data[0].m_load_no });
  }

  const { data: veh } = await supabase
    .from('lp_vehicles')
    .select('vh_odometer')
    .eq('vh_code', truck)
    .single();

  res.json({
    last_closing_km: veh?.vh_odometer || 0,
    load_no: null,
    source: 'vehicle_odometer'
  });
});

// POST save closing KM when load is offloaded — MANUAL FALLBACK ONLY.
// The primary path is POST /closing-auto/:loadNo (Pulsit-driven, above);
// this stays available for the rare case Pulsit has no reading for a
// given truck (no tracker fitted, hardware fault, etc).
router.post('/closing/:loadNo', requirePermission('KM', 'edit'), async (req, res) => {
  const { loadNo } = req.params;
  const { closing_km } = req.body;
  const closing = Number(closing_km);
  if (!closing_km || isNaN(closing)) return res.status(400).json({ error: 'A valid closing KM is required' });

  const result = await applyClosingKm(loadNo, closing, req.user.username, 'manual');
  if (result.error) return res.status(result.status || 400).json(result);
  res.json(result.data);
});

// POST validate opening KM on new load
router.post('/validate-opening', requirePermission('KM', 'view'), async (req, res) => {
  const { truck, opening_km } = req.body;

  const { data: last } = await supabase
    .from('lp_movement')
    .select('m_load_no, m_closing_km')
    .eq('m_truck', truck)
    .gt('m_closing_km', 0)
    .not('m_status', 'eq', 'DELETED')
    .order('created_at', { ascending: false })
    .limit(1);

  const lastClosing = last?.[0]?.m_closing_km || 0;
  const opening = Number(opening_km);
  const deadKm = opening - lastClosing;

  if (lastClosing > 0 && opening < lastClosing) {
    return res.json({
      valid: false,
      error: `Opening KM (${opening.toLocaleString()}) cannot be less than last recorded KM (${lastClosing.toLocaleString()})`,
      code: 'OPENING_LESS_THAN_LAST',
      last_closing_km: lastClosing,
      dead_km: 0
    });
  }

  const anomaly = deadKm > DEAD_KM_THRESHOLD;

  res.json({
    valid: true,
    last_closing_km: lastClosing,
    dead_km: deadKm,
    anomaly,
    anomaly_threshold: DEAD_KM_THRESHOLD,
    warning: anomaly ? `Dead KM of ${deadKm.toLocaleString()} km exceeds ${DEAD_KM_THRESHOLD} km threshold — approval required` : null
  });
});

// GET anomalies
router.get('/anomalies', requirePermission('KM', 'approve'), async (req, res) => {
  const { status } = req.query;
  let q = supabase.from('lp_anomalies').select('*').order('created_at', { ascending: false });
  if (status) q = q.eq('a_status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// PATCH approve/reject anomaly
router.patch('/anomalies/:id', requirePermission('KM', 'approve'), async (req, res) => {
  const { action, rejection_reason } = req.body;
  const { id } = req.params;
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Action must be approve or reject' });

  const { data: anomaly } = await supabase
    .from('lp_anomalies').select('*').eq('id', id).single();

  if (!anomaly) return res.status(404).json({ error: 'Anomaly not found' });

  const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';

  await supabase.from('lp_anomalies').update({
    a_status: newStatus,
    a_reviewed_by: req.user.username,
    a_reviewed_at: new Date().toISOString(),
    a_rejection_reason: rejection_reason || null
  }).eq('id', id);

  if (action === 'approve') {
    await supabase.from('lp_movement')
      .update({ m_status: 'PRELOAD', updated_at: new Date().toISOString() })
      .eq('m_load_no', anomaly.a_load_no);

    await supabase.from('lp_notifications').insert([{
      n_user: anomaly.a_operator,
      n_type: 'ANOMALY_APPROVED',
      n_title: 'KM Anomaly Approved',
      n_message: `Dead KM anomaly for load ${anomaly.a_load_no} (${anomaly.a_dead_km} km) has been approved.`,
      n_load_no: anomaly.a_load_no
    }]);

    await supabase.from('lp_comments').insert([{
      c_load: anomaly.a_load_no,
      c_comment: `KM anomaly approved by ${req.user.username}. Dead KM: ${anomaly.a_dead_km} km`,
      c_logged_by: req.user.username
    }]);
  } else {
    await supabase.from('lp_movement')
      .update({ m_status: 'KM_CORRECTION_NEEDED', updated_at: new Date().toISOString() })
      .eq('m_load_no', anomaly.a_load_no);

    await supabase.from('lp_notifications').insert([{
      n_user: anomaly.a_operator,
      n_type: 'ANOMALY_REJECTED',
      n_title: 'KM Anomaly Rejected',
      n_message: `Dead KM for load ${anomaly.a_load_no} was rejected. Reason: ${rejection_reason || 'No reason given'}. Please correct the opening KM.`,
      n_load_no: anomaly.a_load_no
    }]);

    await supabase.from('lp_comments').insert([{
      c_load: anomaly.a_load_no,
      c_comment: `KM anomaly REJECTED by ${req.user.username}. Reason: ${rejection_reason || 'No reason given'}`,
      c_logged_by: req.user.username
    }]);
  }

  res.json({ success: true, status: newStatus });
});

// POST create notification
router.post('/notifications', requirePermission('KM', 'approve'), async (req, res) => {
  const { data, error } = await supabase
    .from('lp_notifications')
    .insert([{ ...req.body }])
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// POST create anomaly
router.post('/anomalies', requirePermission('KM', 'approve'), async (req, res) => {
  const { data, error } = await supabase
    .from('lp_anomalies')
    .insert([{ ...req.body }])
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// GET notifications for current user
router.get('/notifications', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_notifications')
    .select('*')
    .or(`n_user.eq.${req.user.username},n_role.eq.${req.user.role}`)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── IMPORTANT: specific routes MUST come before parameterised routes ──────────
// PATCH mark ALL notifications as read — must be before /:id/read
router.patch('/notifications/read-all', async (req, res) => {
  await supabase.from('lp_notifications')
    .update({ n_read: 'Y' })
    .or(`n_user.eq.${req.user.username},n_role.eq.${req.user.role}`);
  res.json({ success: true });
});

// PATCH mark single notification as read
router.patch('/notifications/:id/read', async (req, res) => {
  await supabase.from('lp_notifications').update({ n_read: 'Y' }).eq('id', req.params.id);
  res.json({ success: true });
});

module.exports = router;
