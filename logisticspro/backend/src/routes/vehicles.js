const express = require('express');
const supabase = require('../supabase');
const { authMiddleware, loadUserPermissions, requirePermission } = require('../middleware/auth');
const { getPulsitVehicles, mapVehicle } = require('../lib/pulsit');
const { normalizeVehicleKey, buildVehicleKeyMap } = require('../lib/vehicleCode');

const router = express.Router();
router.use(authMiddleware);
router.use(loadUserPermissions);

const SERVICE_INTERVAL = 40000; // km

// ── Fields that must NEVER be updated via PATCH ─────────────────────────────
const READ_ONLY = ['vh_code', 'vh_type', 'vh_year', 'vh_make', 'vh_model',
                   'vh_registration', 'vh_vin', 'vh_odometer',
                   'vh_next_service', 'vh_next_wheel', 'vh_status'];

// ── Trailer-link fields: editable, but ONLY via the dedicated
// PATCH /:code/link endpoint below — never via the generic PATCH /:code.
// The generic route accepts arbitrary fields, which makes it the wrong
// place to enforce the link invariants (no self-link, both-must-be-trailer,
// one rear per front, clearing the paired-trailer's own link state).
const LINK_FIELDS = ['vh_is_link', 'vh_link_pair'];

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

  // For each vehicle, pull current odometer + status from last load card.
  // NOTE: matched by normalized key (not exact .in()) because historic /
  // imported load rows can carry a differently zero-padded truck code than
  // the canonical lp_vehicles.vh_code (e.g. "BT01" vs "BT001") — an exact
  // match would silently miss those rows. See lib/vehicleCode.js.
  const codes = (data || []).map(v => v.vh_code);
  const codeKeyMap = buildVehicleKeyMap(data); // normalizedKey -> vh_code
  let loadMap = {};
  if (codes.length > 0) {
    const { data: loads } = await supabase
      .from('lp_movement')
      .select('m_truck, m_closing_km, m_opening_km, m_status, m_date')
      .not('m_truck', 'is', null)
      .neq('m_status', 'DELETED')
      .order('m_date', { ascending: false })
      .order('created_at', { ascending: false });

    // Keep only the most recent load per truck, resolved to the
    // canonical vh_code via normalized key.
    (loads || []).forEach(l => {
      const canonical = codeKeyMap.get(normalizeVehicleKey(l.m_truck));
      if (canonical && !loadMap[canonical]) loadMap[canonical] = l;
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
    const codeKeyMap = buildVehicleKeyMap(horses); // normalizedKey -> vh_code

    // Latest non-deleted load per horse, to determine "active" + trailers.
    // Matched by normalized key — see lib/vehicleCode.js.
    let loadMap = {};
    if (codes.length > 0) {
      const { data: loads, error: lErr } = await supabase
        .from('lp_movement')
        .select('m_truck, m_load_no, m_status, m_trailer1, m_trailer2, m_date, created_at')
        .not('m_truck', 'is', null)
        .neq('m_status', 'DELETED')
        .order('m_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (lErr) throw lErr;
      (loads || []).forEach(l => {
        const canonical = codeKeyMap.get(normalizeVehicleKey(l.m_truck));
        if (canonical && !loadMap[canonical]) loadMap[canonical] = l;
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
  // Trailer-link fields are handled exclusively by PATCH /:code/link, which
  // enforces the link invariants — never let them slip through here.
  LINK_FIELDS.forEach(f => delete updates[f]);

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No editable fields provided' });
  }

  const { data, error } = await supabase
    .from('lp_vehicles').update(updates).eq('vh_code', req.params.code).select().single();
  if (error) return res.status(400).json({ error: error.message });

  await writeAudit(req.params.code, 'UPDATED', updates, req.user.username);
  res.json(data);
});

// ── PATCH /api/vehicles/:code/link ────────────────────────────────────────────
// Dedicated endpoint for trailer-link pairing. Enforces server-side:
//   • no self-link (a trailer cannot be paired with itself)
//   • both vehicles in the pair must be type 'Trailer'
//   • one rear trailer cannot be assigned to multiple fronts
//   • the rear trailer's own link fields are cleared so it can't
//     simultaneously appear as the front of a different pair
// MUST be registered before /:code/audit etc. order doesn't matter here
// since the suffix is distinct, but keep it directly after the generic
// PATCH for readability.
router.patch('/:code/link', requirePermission('FLEET', 'approve'), async (req, res) => {
  const code = req.params.code;
  const vh_is_link = req.body.vh_is_link === 'Y' ? 'Y' : 'N';
  const vh_link_pair = (req.body.vh_link_pair || '').trim() || null;

  const { data: self, error: selfErr } = await supabase
    .from('lp_vehicles').select('vh_code, vh_type, vh_is_link, vh_link_pair')
    .eq('vh_code', code).single();
  if (selfErr || !self) return res.status(404).json({ error: 'Vehicle not found' });
  if (self.vh_type !== 'Trailer')
    return res.status(400).json({ error: 'Only trailers can be link-paired' });

  // ── Unlinking ────────────────────────────────────────────────────────────
  if (vh_is_link === 'N') {
    const { data, error } = await supabase
      .from('lp_vehicles')
      .update({ vh_is_link: 'N', vh_link_pair: null })
      .eq('vh_code', code).select().single();
    if (error) return res.status(400).json({ error: error.message });
    await writeAudit(code, 'LINK_CLEARED', { vh_is_link: 'N', vh_link_pair: null }, req.user.username);
    return res.json(data);
  }

  // ── Linking ──────────────────────────────────────────────────────────────
  if (!vh_link_pair)
    return res.status(400).json({ error: 'Select a paired trailer' });
  if (vh_link_pair === code)
    return res.status(400).json({ error: 'A trailer cannot be paired with itself' });

  const { data: pair, error: pairErr } = await supabase
    .from('lp_vehicles').select('vh_code, vh_type, vh_is_link, vh_link_pair')
    .eq('vh_code', vh_link_pair).single();
  if (pairErr || !pair) return res.status(404).json({ error: 'Paired trailer not found' });
  if (pair.vh_type !== 'Trailer')
    return res.status(400).json({ error: 'Paired vehicle must also be a trailer' });

  // One rear cannot be assigned to multiple fronts — check no OTHER trailer
  // already has this vh_link_pair as its rear.
  const { data: conflicts, error: confErr } = await supabase
    .from('lp_vehicles')
    .select('vh_code')
    .eq('vh_is_link', 'Y')
    .eq('vh_link_pair', vh_link_pair)
    .neq('vh_code', code);
  if (confErr) return res.status(500).json({ error: confErr.message });
  if (conflicts && conflicts.length > 0) {
    return res.status(409).json({
      error: `${vh_link_pair} is already paired as the rear trailer of ${conflicts[0].vh_code}`,
    });
  }

  const { data, error } = await supabase
    .from('lp_vehicles')
    .update({ vh_is_link: 'Y', vh_link_pair })
    .eq('vh_code', code).select().single();
  if (error) return res.status(400).json({ error: error.message });
  await writeAudit(code, 'LINK_UPDATED', { vh_is_link: 'Y', vh_link_pair }, req.user.username);

  // Clear the rear trailer's own link fields — it is a passive partner in
  // this pair and must not simultaneously be the front of another pair.
  if (pair.vh_is_link === 'Y' || pair.vh_link_pair) {
    await supabase
      .from('lp_vehicles')
      .update({ vh_is_link: 'N', vh_link_pair: null })
      .eq('vh_code', vh_link_pair);
    await writeAudit(vh_link_pair, 'LINK_CLEARED', { reason: `cleared — now rear partner of ${code}` }, req.user.username);
  }

  res.json(data);
});

module.exports = router;
