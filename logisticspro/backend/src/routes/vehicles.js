const express = require('express');
const supabase = require('../supabase');
const { authMiddleware, loadUserPermissions, requirePermission } = require('../middleware/auth');
const { getPulsitVehicles, mapVehicle } = require('../lib/pulsit');
const { normalizeVehicleKey, buildVehicleKeyMap } = require('../lib/vehicleCode');
const { fetchChunked } = require('../lib/supabasePaging');
const { distanceKm, matchAddress, nearestAddress } = require('../lib/geo');

const router = express.Router();
router.use(authMiddleware);
router.use(loadUserPermissions);

// Most recent non-deleted load per truck (one row per raw m_truck value).
// Prefers a single indexed DISTINCT ON query computed in Postgres — see
// migration_latest_load_per_truck_perf.sql. Falls back to the old full
// chunked table scan only if that migration hasn't been run yet, so this
// degrades gracefully rather than breaking during rollout. The RPC path
// is the fix for the Fleet dashboard's intermittent timeouts: lp_movement
// has ~31k historic rows, and pulling all of them on every 20-second poll
// (the old behaviour) was the actual cause, not a real "crash".
async function getLatestLoadPerTruck() {
  try {
    const { data, error } = await supabase.rpc('get_latest_load_per_truck');
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error(
      '[getLatestLoadPerTruck] RPC unavailable, falling back to full table scan — ' +
      'run database/migration_latest_load_per_truck_perf.sql to fix this:', e.message
    );
    const buildLoadsQuery = () => supabase
      .from('lp_movement')
      .select('*')
      .not('m_truck', 'is', null)
      .neq('m_status', 'DELETED')
      .order('m_date', { ascending: false })
      .order('m_load_no', { ascending: false });
    const { rows } = await fetchChunked(buildLoadsQuery, 0, Number.MAX_SAFE_INTEGER);
    const seen = new Set();
    const result = [];
    for (const r of rows) {
      if (seen.has(r.m_truck)) continue;
      seen.add(r.m_truck);
      result.push(r);
    }
    return result;
  }
}

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
  //
  // Also chunk-fetched (lib/supabasePaging) rather than one plain select —
  // Supabase/PostgREST silently caps any single unranged response at the
  // project's "max rows" setting (commonly 1000), and lp_movement already
  // has well over that many rows. A plain select here would silently miss
  // older loads, which is exactly the kind of bug this normalized-key join
  // was added to prevent in the first place.
  const codes = (data || []).map(v => v.vh_code);
  const codeKeyMap = buildVehicleKeyMap(data); // normalizedKey -> vh_code
  let loadMap = {};
  if (codes.length > 0) {
    const loads = await getLatestLoadPerTruck();
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
// the truck's most recent load (trailer pairing, client, load number — shown
// regardless of whether that load is still actively being hauled), live
// Pulsit tracking (ignition + position), trailer-link confirmation against
// Pulsit, and friendly location naming via lp_addresses.
// MUST be registered before /:code or Express treats "fleet-overview" as a
// vehicle code parameter.
const ACTIVE_LOAD_STATUSES = ['PRELOAD', 'EN_ROUTE']; // before/at OFFLOADED = no longer "active"
const TRAILER_CONFIRM_RADIUS_KM = 2; // horse/trailer within this distance = link confirmed

router.get('/fleet-overview', requirePermission('FLEET', 'view'), async (req, res) => {
  try {
    // All active vehicles (not just horses) — needed so trailer codes
    // referenced on a load can be resolved to their registration (for
    // Pulsit matching) the same way horses are.
    const { data: allVehicles, error: vErr } = await supabase
      .from('lp_vehicles')
      .select('vh_code, vh_type, vh_make, vh_model, vh_registration')
      .eq('vh_active', 'Y')
      .order('vh_code');
    if (vErr) throw vErr;

    const horses = (allVehicles || []).filter(v => v.vh_type === 'Horse');
    const codeKeyMap = buildVehicleKeyMap(allVehicles); // normalizedKey -> vh_code
    const vehicleByCode = new Map((allVehicles || []).map(v => [v.vh_code, v]));
    const codes = horses.map(h => h.vh_code);

    // Most recent non-deleted load per horse — ANY status, not just active
    // hauling statuses, so trailers/client/load-no still show for a truck
    // that's idle between loads. Matched by normalized key (lib/vehicleCode)
    // and chunk-fetched (lib/supabasePaging) — see GET / above for why.
    let loadMap = {};
    if (codes.length > 0) {
      const loads = await getLatestLoadPerTruck();
      (loads || []).forEach(l => {
        const canonical = codeKeyMap.get(normalizeVehicleKey(l.m_truck));
        if (canonical && !loadMap[canonical]) loadMap[canonical] = l;
      });
    }

    // Client names for the "Client" column
    const { data: customers } = await supabase.from('lp_customers').select('c_code, c_name');
    const customerMap = new Map((customers || []).map(c => [c.c_code, c.c_name]));

    // Named addresses (home bases + client sites/depots) for friendly
    // location naming and the Home Base filter.
    const { data: addresses } = await supabase.from('lp_addresses').select('*').eq('a_active', 'Y');
    const homeBaseAddresses = (addresses || []).filter(a => a.a_type === 'HOME_BASE');

    // Live tracking — non-fatal if Pulsit is unreachable; fleet data still useful without it
    let posByCode = {};
    let pulsitError = null;
    try {
      const list = await getPulsitVehicles();
      list.map(mapVehicle).forEach(p => {
        if (p.code) posByCode[p.code] = p;
        if (p.regNo) posByCode[p.regNo] = posByCode[p.regNo] || p;
      });
    } catch (e) {
      pulsitError = e.message;
      console.error('[fleet-overview] tracking unavailable:', e.message);
    }
    const findPos = (code) => {
      if (!code) return null;
      if (posByCode[code]) return posByCode[code];
      const reg = vehicleByCode.get(code)?.vh_registration;
      return reg ? (posByCode[reg] || null) : null;
    };

    const result = (horses || []).map(h => {
      const load = loadMap[h.vh_code];
      const isActive = !!load && ACTIVE_LOAD_STATUSES.includes(load.m_status);
      const pos = findPos(h.vh_code) || (h.vh_registration ? posByCode[h.vh_registration] : null);

      // Trailers — always from the truck's last known load, resolved to
      // canonical vh_code (handles historic code-padding mismatches), and
      // cross-checked against Pulsit if that trailer reports its own
      // position. A trailer with no GPS unit fitted shows as "not tracked"
      // rather than being treated as a mismatch.
      const trailerCodes = load ? [load.m_trailer1, load.m_trailer2].filter(Boolean) : [];
      const trailers = trailerCodes.map(rawCode => {
        const code = codeKeyMap.get(normalizeVehicleKey(rawCode)) || rawCode;
        const trailerPos = findPos(code);
        const trailerRecord = vehicleByCode.get(code);
        let confirmed = null; // null = can't confirm (no GPS on trailer or horse)
        let distance_km = null;
        if (trailerPos && pos && pos.lat != null && pos.lng != null) {
          distance_km = distanceKm(pos.lat, pos.lng, trailerPos.lat, trailerPos.lng);
          confirmed = distance_km != null && distance_km <= TRAILER_CONFIRM_RADIUS_KM;
        }
        return {
          code,
          make: trailerRecord?.vh_make || null,
          model: trailerRecord?.vh_model || null,
          registration: trailerRecord?.vh_registration || null,
          tracked: !!trailerPos,
          confirmed,
          distance_km: distance_km != null ? Number(distance_km.toFixed(2)) : null,
        };
      });

      // Friendly location name — nearest configured address (any type)
      // within its radius; falls back to Pulsit's raw reverse-geocoded
      // string if nothing matches.
      const matchedAddress = pos ? matchAddress(pos.lat, pos.lng, addresses) : null;
      const homeBase = pos ? matchAddress(pos.lat, pos.lng, homeBaseAddresses) : null;
      // Diagnostic only — populated when a position exists but didn't match
      // any home base geofence, so we can tell from the UI whether it's a
      // too-tight radius (small distance) or a wrong geofence pin (large
      // distance) instead of guessing blind.
      const homeBaseNearest = (pos && !homeBase) ? nearestAddress(pos.lat, pos.lng, homeBaseAddresses) : null;

      return {
        vh_code:      h.vh_code,
        vh_make:      h.vh_make,
        vh_model:     h.vh_model,
        trailers,
        client:       load?.m_customer || null,
        client_name:  load?.m_customer ? (customerMap.get(load.m_customer) || load.m_customer) : null,
        load_no:      load?.m_load_no || null,
        load_status:  load?.m_status || null,
        load_to:      load?.m_to || null,
        is_active:    isActive,
        ignition:     pos ? pos.ignition : null,    // 1 = on, 0 = off, null = unknown
        location:     matchedAddress ? matchedAddress.a_name : (pos ? pos.location : null),
        home_base:    homeBase ? homeBase.a_name : null,
        home_base_nearest: homeBaseNearest ? { name: homeBaseNearest.a_name, distance_km: homeBaseNearest.distance_km } : null,
        lat:          pos ? pos.lat : null,
        lng:          pos ? pos.lng : null,
        lastUpdate:   pos ? pos.lastUpdate : null,
      };
    });

    res.json({ vehicles: result, pulsit_unavailable: !!pulsitError });
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
