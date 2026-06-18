const express = require('express');
const supabase = require('../supabase');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const SERVICE_INTERVAL = 40000; // km

// ── Fields that must NEVER be updated via PATCH ─────────────────────────────
const READ_ONLY = ['vh_code', 'vh_type', 'vh_year', 'vh_make', 'vh_model',
                   'vh_registration', 'vh_vin', 'vh_odometer',
                   'vh_next_service', 'vh_next_wheel', 'vh_status'];

// ── Helper: write an audit entry ─────────────────────────────────────────────
async function writeAudit(vehicleCode, action, changedFields, operator) {
  await supabase.from('lp_vehicle_audit').insert([{
    va_vehicle:  vehicleCode,
    va_action:   action,
    va_fields:   JSON.stringify(changedFields),
    va_operator: operator,
  }]).select();
}

// ── GET /api/vehicles ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { type, active = 'Y' } = req.query;
  let q = supabase.from('lp_vehicles').select('*').order('vh_code');
  if (active !== 'all') q = q.eq('vh_active', active);
  if (type) q = q.eq('vh_type', type);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // For each vehicle, pull current odometer + status from last load card
  const codes = (data || []).map(v => v.vh_code);
  let loadMap = {};
  if (codes.length > 0) {
    const { data: loads } = await supabase
      .from('lp_movement')
      .select('m_truck, m_closing_km, m_opening_km, m_status, m_date')
      .in('m_truck', codes)
      .neq('m_status', 'DELETED')
      .order('m_date', { ascending: false })
      .order('created_at', { ascending: false });

    // Keep only the most recent load per truck
    (loads || []).forEach(l => {
      if (!loadMap[l.m_truck]) loadMap[l.m_truck] = l;
    });
  }

  // Pull last maintenance per vehicle for next service calc
  let maintMap = {};
  if (codes.length > 0) {
    const { data: maints } = await supabase
      .from('lp_maintenance')
      .select('ma_vehicle, ma_km, ma_service_type, created_at')
      .in('ma_vehicle', codes)
      .order('created_at', { ascending: false });

    (maints || []).forEach(m => {
      if (!maintMap[m.ma_vehicle]) maintMap[m.ma_vehicle] = { service: null, wheel: null };
      const entry = maintMap[m.ma_vehicle];
      const isWheel = (m.ma_service_type || '').toLowerCase().includes('wheel') ||
                      (m.ma_service_type || '').toLowerCase().includes('align');
      if (isWheel && !entry.wheel) entry.wheel = m;
      else if (!isWheel && !entry.service) entry.service = m;
    });
  }

  const enriched = (data || []).map(v => {
    const lastLoad  = loadMap[v.vh_code];
    const lastMaint = maintMap[v.vh_code] || {};

    const odo = lastLoad ? (Number(lastLoad.m_closing_km) || Number(lastLoad.m_opening_km) || v.vh_odometer) : v.vh_odometer;

    // Next service = last service km + 40,000
    const nextService = lastMaint.service
      ? (Number(lastMaint.service.ma_km) + SERVICE_INTERVAL)
      : v.vh_next_service || 0;

    // Next wheel alignment = last alignment km + 40,000
    const nextWheel = lastMaint.wheel
      ? (Number(lastMaint.wheel.ma_km) + SERVICE_INTERVAL)
      : v.vh_next_wheel || 0;

    // Status from last load card
    const status = lastLoad ? lastLoad.m_status : (v.vh_status || 'AVAILABLE');

    return {
      ...v,
      vh_odometer:    odo,
      vh_next_service: nextService,
      vh_next_wheel:  nextWheel,
      vh_status:      status,
    };
  });

  res.json(enriched);
});

// ── GET /api/vehicles/:code ───────────────────────────────────────────────────
router.get('/:code', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_vehicles').select('*').eq('vh_code', req.params.code).single();
  if (error) return res.status(404).json({ error: 'Vehicle not found' });
  res.json(data);
});

// ── GET /api/vehicles/:code/audit ─────────────────────────────────────────────
router.get('/:code/audit', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_vehicle_audit')
    .select('*')
    .eq('va_vehicle', req.params.code)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── GET /api/vehicles/:code/maintenance ───────────────────────────────────────
router.get('/:code/maintenance', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_maintenance').select('*').eq('ma_vehicle', req.params.code)
    .order('ma_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── POST /api/vehicles ────────────────────────────────────────────────────────
router.post('/', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { data, error } = await supabase.from('lp_vehicles').insert([req.body]).select().single();
  if (error) return res.status(400).json({ error: error.message });

  await writeAudit(data.vh_code, 'CREATED', req.body, req.user.username);
  res.status(201).json(data);
});

// ── PATCH /api/vehicles/:code ─────────────────────────────────────────────────
router.patch('/:code', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  // Strip any read-only fields the client may have sent
  const updates = { ...req.body };
  READ_ONLY.forEach(f => delete updates[f]);

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No editable fields provided' });
  }

  const { data, error } = await supabase
    .from('lp_vehicles').update(updates).eq('vh_code', req.params.code).select().single();
  if (error) return res.status(400).json({ error: error.message });

  await writeAudit(req.params.code, 'UPDATED', updates, req.user.username);
  res.json(data);
});

module.exports = router;
