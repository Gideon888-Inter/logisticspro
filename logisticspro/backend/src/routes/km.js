const express = require('express');
const supabase = require('../supabase');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();
router.use(authMiddleware);

const DEAD_KM_THRESHOLD = 500;

// GET last closing KM for a truck
router.get('/last-closing/:truck', async (req, res) => {
  const { truck } = req.params;
  // Get last completed load with a closing KM for this truck
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

  // No previous load — get from vehicle odometer
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

// POST save closing KM when load is offloaded
router.post('/closing/:loadNo', async (req, res) => {
  const { loadNo } = req.params;
  const { closing_km } = req.body;

  // Get the load
  const { data: load, error: loadErr } = await supabase
    .from('lp_movement')
    .select('*')
    .eq('m_load_no', loadNo)
    .single();

  if (loadErr || !load) return res.status(404).json({ error: 'Load not found' });

  const opening = Number(load.m_opening_km || 0);
  const closing = Number(closing_km);

  // Validation 1: closing cannot be less than opening
  if (closing < opening) {
    return res.status(400).json({
      error: `Closing KM (${closing.toLocaleString()}) cannot be less than opening KM (${opening.toLocaleString()})`,
      code: 'CLOSING_LESS_THAN_OPENING'
    });
  }

  // Get route KM from rate card
  const { data: rateRow } = await supabase
    .from('lp_client_rates')
    .select('rc_kms')
    .eq('rc_client_code', load.m_customer)
    .eq('rc_from', load.m_from)
    .eq('rc_to', load.m_to)
    .single();

  const routeKm = rateRow?.rc_kms || 0;
  const maxAllowed = opening + routeKm + DEAD_KM_THRESHOLD;

  // Validation 2: closing cannot exceed opening + route km + 500
  if (routeKm > 0 && closing > maxAllowed) {
    return res.status(400).json({
      error: `Closing KM (${closing.toLocaleString()}) exceeds maximum allowed (${maxAllowed.toLocaleString()} = opening ${opening.toLocaleString()} + route ${routeKm.toLocaleString()} km + 500 km tolerance)`,
      code: 'CLOSING_EXCEEDS_MAX',
      max_allowed: maxAllowed,
      route_km: routeKm
    });
  }

  const actual_km = closing - opening;

  // Update the load with closing KM
  const { data: updated, error: updateErr } = await supabase
    .from('lp_movement')
    .update({
      m_closing_km: closing,
      m_actual_km: actual_km,
      m_status: 'OFFLOADED',
      updated_at: new Date().toISOString()
    })
    .eq('m_load_no', loadNo)
    .select()
    .single();

  if (updateErr) return res.status(400).json({ error: updateErr.message });

  // Auto-update vehicle odometer
  await supabase
    .from('lp_vehicles')
    .update({ vh_odometer: closing })
    .eq('vh_code', load.m_truck);

  // Add audit comment
  await supabase.from('lp_comments').insert([{
    c_load: loadNo,
    c_comment: `Load offloaded. Opening KM: ${opening.toLocaleString()} | Closing KM: ${closing.toLocaleString()} | Distance: ${actual_km.toLocaleString()} km`,
    c_logged_by: req.user.username
  }]);

  res.json({ ...updated, actual_km, route_km: routeKm });
});

// POST validate opening KM on new load (check for dead KM anomaly)
router.post('/validate-opening', async (req, res) => {
  const { truck, opening_km } = req.body;

  // Get last closing KM
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
router.get('/anomalies', async (req, res) => {
  const { status } = req.query;
  let q = supabase.from('lp_anomalies').select('*').order('created_at', { ascending: false });
  if (status) q = q.eq('a_status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// PATCH approve/reject anomaly
router.patch('/anomalies/:id', async (req, res) => {
  const { action, rejection_reason } = req.body;
  const { id } = req.params;

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
    // Move load to PRELOAD
    await supabase.from('lp_movement')
      .update({ m_status: 'PRELOAD', updated_at: new Date().toISOString() })
      .eq('m_load_no', anomaly.a_load_no);

    // Notify the operator
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
    // Move load back to needs correction
    await supabase.from('lp_movement')
      .update({ m_status: 'KM_CORRECTION_NEEDED', updated_at: new Date().toISOString() })
      .eq('m_load_no', anomaly.a_load_no);

    // Notify operator of rejection
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
router.post('/notifications', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_notifications')
    .insert([{ ...req.body }])
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// POST create anomaly
router.post('/anomalies', async (req, res) => {
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

// PATCH mark notification as read
router.patch('/notifications/:id/read', async (req, res) => {
  await supabase.from('lp_notifications').update({ n_read: 'Y' }).eq('id', req.params.id);
  res.json({ success: true });
});

// PATCH mark all notifications as read
router.patch('/notifications/read-all', async (req, res) => {
  await supabase.from('lp_notifications')
    .update({ n_read: 'Y' })
    .or(`n_user.eq.${req.user.username},n_role.eq.${req.user.role}`);
  res.json({ success: true });
});

module.exports = router;
