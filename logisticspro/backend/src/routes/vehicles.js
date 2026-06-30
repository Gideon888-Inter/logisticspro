const express = require('express');
const supabase = require('../supabase');
const { authMiddleware, loadUserPermissions, requirePermission } = require('../middleware/auth');
const { getPulsitVehicles, mapVehicle } = require('../lib/pulsit');

const router = express.Router();
router.use(authMiddleware);
router.use(loadUserPermissions);

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

// ── GET /api/vehicles/fleet-overview ──────────────────────────────────────────
// Dashboard "Fleet" tab: per-horse live status combining vehicle master data,
// the truck's current/latest load (for trailer + load-number context), and
// live Pulsit tracking (ignition + last known location).
// MUST be registered before /:code or Express treats "fleet-overview" as a
// vehicle code parameter.
const ACTIVE_LOAD_STATUSES = ['PRELOAD', 'EN_ROUTE']; // before/at OFFLOADED = no longer "active"

router.get('/fleet-overview', requirePermission('FLEET', 'view'), async (req, res) => {
  try {
    const { data: horses, error: vErr } = await supabase
      .from('lp_vehicles')
      .select('vh_code, vh_make, vh_model, vh_registration')
      .eq('vh_type', 'Horse')
      .eq('vh_active', 'Y')
      .order('vh_code');
    if (vErr) throw vErr;

    const codes = (horses || []).map(h => h.vh_code);

    // Latest non-deleted load per horse, to determine "active" + trailers
    let loadMap = {};
    if (codes.length > 0) {
      const { data: loads, error: lErr } = await supabase
        .from('lp_movement')
        .select('m_truck, m_load_no, m_status, m_trailer1, m_trailer2, m_date, created_at')
        .in('m_truck', codes)
        .neq('m_status', 'DELETED')
        .order('m_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (lErr) throw lErr;
      (loads || []).forEach(l => {
        if (!loadMap[l.m_truck]) loadMap[l.m_truck] = l;
      });
    }

    // Live tracking — non-fatal if Pulsit is unreachable; fleet data still useful without it
    let posByCode = {};
    try {
      const list = await getPulsitVehicles();
      list.map(mapVehicle).forEach(p => {
        if (p.code) posByCode[p.code] = p;
        if (p.regNo) posByCode[p.regNo] = posByCode[p.regNo] || p;
      });
    } catch (e) {
      console.error('[fleet-overview] tracking unavailable:', e.message);
    }

    const result = (horses || []).map(h => {
      const load = loadMap[h.vh_code];
      const isActive = !!load && ACTIVE_LOAD_STATUSES.includes(load.m_status);
      const pos = posByCode[h.vh_code] || posByCode[h.vh_registration] || null;

      return {
        vh_code:     h.vh_code,
        vh_make:     h.vh_make,
        vh_model:    h.vh_model,
        trailers:    isActive ? [load.m_trailer1, load.m_trailer2].filter(Boolean) : [],
        load_no:     isActive ? load.m_load_no : null,
        load_status: isActive ? load.m_status : null,
        ignition:    pos ? pos.ignition : null,    // 1 = on, 0 = off, null = unknown
        location:    pos ? pos.location : null,
        lat:         pos ? pos.lat : null,
        lng:         pos ? pos.lng : null,
        lastUpdate:  pos ? pos.lastUpdate : null,
      };
    });

    res.json(result);
  } catch (e) {
    console.error('[vehicles/fleet-overview]', e.message);
    res.status(500).json({ error: e.message });
  }
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
router.post('/', requirePermission('FLEET', 'approve'), async (req, res) => {
  const { data, error } = await supabase.from('lp_vehicles').insert([req.body]).select().single();
  if (error) return res.status(400).json({ error: error.message });

  await writeAudit(data.vh_code, 'CREATED', req.body, req.user.username);
  res.status(201).json(data);
});

// ── PATCH /api/vehicles/:code ─────────────────────────────────────────────────
router.patch('/:code', requirePermission('FLEET', 'approve'), async (req, res) => {
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
