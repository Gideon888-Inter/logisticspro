const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const supabase = require('../supabase');
const { authMiddleware, loadUserPermissions, requirePermission, requireRole, ROLES } = require('../middleware/auth');
const { getPulsitVehicles, mapVehicle } = require('../lib/pulsit');
const { normalizeVehicleKey, buildVehicleKeyMap, resolveVehicleCode } = require('../lib/vehicleCode');
const { fetchChunked } = require('../lib/supabasePaging');
const { distanceKm, matchAddress, nearestAddress } = require('../lib/geo');

const router = express.Router();
router.use(authMiddleware);
router.use(loadUserPermissions);

// ── Multer: temp disk storage for trip-report imports (mirrors the
// attachment-upload pattern in routes/inventory.js) ─────────────────────────
const TRIP_UPLOAD_DIR = path.join(__dirname, '../../temp_attachments');
if (!fs.existsSync(TRIP_UPLOAD_DIR)) fs.mkdirSync(TRIP_UPLOAD_DIR, { recursive: true });

const tripUpload = multer({
  storage: multer.diskStorage({
    destination: TRIP_UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ts = Date.now();
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `trip_${ts}_${safe}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ['.xlsx', '.xls', '.csv'].includes(ext));
  },
});

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
router.get('/', requirePermission('FLEET', 'view'), async (req, res) => {
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

// ============================================================
// POST /api/vehicles/import-trips
// Admin only. Accepts a Pulsit "Trip Report" export (.xlsx/.xls/.csv) and
// loads it into lp_vehicle_trips — see migration_vehicle_trips.sql.
//
// Column matching is name-based and case/spacing-insensitive (Pulsit's
// exact header text can vary slightly between report runs), matched
// against the confirmed sample: Company, Fleet, Vehicle No, Description,
// Driver, Start Time, Start Location, End Time, End Location,
// Elapsed Time(Mins), Distance(Kms), Ave Speed, Max Speed, Cost.
//
// "Description" carries the actual fleet code (e.g. MH196) — "Vehicle No"
// is Pulsit's own internal device ID and is kept only for traceability.
// Vehicle codes are resolved the same way as everywhere else in the app
// (lib/vehicleCode.js), so a Pulsit export reading "MH19" still matches
// our "MH019". Rows whose vehicle code doesn't resolve to anything in
// lp_vehicles are skipped (not inserted with a null vehicle), and listed
// back in the response so they can be fixed and the same file re-uploaded
// — already-imported rows are protected by the (vh_code, start_time,
// end_time) unique constraint, so re-running an import is always safe.
// ============================================================
const TRIP_COLUMN_ALIASES = {
  vehicleno:        'pulsit_vehicle_no',
  description:      'pulsit_description',
  driver:           'driver',
  starttime:        'start_time',
  startlocation:    'start_location',
  endtime:          'end_time',
  endlocation:      'end_location',
  elapsedtimemins:  'elapsed_minutes',
  distancekms:      'distance_km',
  avespeed:         'avg_speed',
  averagespeed:     'avg_speed',
  maxspeed:         'max_speed',
  cost:             'cost',
};

function normalizeHeader(h) {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// xlsx.js returns Date objects where the UTC digits match exactly what's
// displayed in the spreadsheet cell (e.g. cell shows 04:56:37 →
// date.toISOString() also shows 04:56:37, regardless of what timezone
// that wall-clock time actually represents). Pulsit's trip times are
// South African local time (SAST, UTC+2 — South Africa doesn't observe
// DST, so this offset is constant year-round), so naively trusting that
// "UTC" label would store every trip 2 hours off from its true UTC time.
// This corrects for that before storing.
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
function sastCellToUtcIso(d) {
  return new Date(new Date(d).getTime() - SAST_OFFSET_MS).toISOString();
}

router.post('/import-trips', requireRole(ROLES.ADMIN), tripUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (expected .xlsx, .xls, or .csv)' });

  try {
    const wb = XLSX.readFile(req.file.path, { cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null });

    if (rawRows.length === 0) {
      return res.status(400).json({ error: 'No data rows found in the first sheet of this file' });
    }

    // Map whatever headers this export actually used to our column names
    const headerMap = {};
    for (const key of Object.keys(rawRows[0])) {
      const norm = normalizeHeader(key);
      if (TRIP_COLUMN_ALIASES[norm]) headerMap[key] = TRIP_COLUMN_ALIASES[norm];
    }

    const { data: vehicles } = await supabase.from('lp_vehicles').select('vh_code');
    const keyMap = buildVehicleKeyMap(vehicles || []);

    const unresolvedCodes = new Set();
    const rows = [];
    let skippedMissingFields = 0;

    for (const raw of rawRows) {
      const r = {};
      for (const [origKey, mapped] of Object.entries(headerMap)) r[mapped] = raw[origKey];

      if (!r.pulsit_description || !r.start_time || !r.end_time) { skippedMissingFields++; continue; }

      const resolved = resolveVehicleCode(r.pulsit_description, keyMap);
      const key = normalizeVehicleKey(resolved);
      if (!keyMap.has(key)) { unresolvedCodes.add(String(r.pulsit_description)); continue; }

      rows.push({
        vh_code:            resolved,
        pulsit_vehicle_no:  r.pulsit_vehicle_no != null ? String(r.pulsit_vehicle_no) : null,
        pulsit_description: String(r.pulsit_description),
        driver:             r.driver ? String(r.driver) : null,
        start_time:         sastCellToUtcIso(r.start_time),
        start_location:     r.start_location || null,
        end_time:           sastCellToUtcIso(r.end_time),
        end_location:       r.end_location || null,
        elapsed_minutes:    r.elapsed_minutes != null ? Number(r.elapsed_minutes) : null,
        distance_km:        Number(r.distance_km) || 0,
        avg_speed:          r.avg_speed != null ? Number(r.avg_speed) : null,
        max_speed:          r.max_speed != null ? Number(r.max_speed) : null,
        cost:               Number(r.cost) || 0,
        source_file:        req.file.originalname,
        imported_by:        req.user.username,
      });
    }

    let inserted = 0;
    if (rows.length > 0) {
      // Chunk the insert — a full historical export could be thousands of
      // rows, well past a single request's comfortable payload size.
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error, count } = await supabase
          .from('lp_vehicle_trips')
          .upsert(rows.slice(i, i + CHUNK), { onConflict: 'vh_code,start_time,end_time', ignoreDuplicates: true, count: 'exact' });
        if (error) throw error;
        inserted += rows.length; // upsert count isn't reliable with ignoreDuplicates across PostgREST versions — report attempted rows
      }
    }

    res.json({
      success:              true,
      rows_in_file:         rawRows.length,
      rows_processed:       rows.length,
      rows_skipped_missing_fields: skippedMissingFields,
      unresolved_vehicle_codes: [...unresolvedCodes],
      note: unresolvedCodes.size > 0
        ? 'Some vehicle codes in this file did not match any vehicle in Fleet — add/fix them and re-upload the same file; already-matched rows will not be duplicated.'
        : undefined,
    });
  } catch (e) {
    console.error('[vehicles/import-trips]', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

// ── GET /api/vehicles/:code ───────────────────────────────────────────────────
router.get('/:code', requirePermission('FLEET', 'view'), async (req, res) => {
  const { data, error } = await supabase
    .from('lp_vehicles').select('*').eq('vh_code', req.params.code).single();
  if (error) return res.status(404).json({ error: 'Vehicle not found' });
  res.json(data);
});

// ── GET /api/vehicles/:code/audit ─────────────────────────────────────────────
router.get('/:code/audit', requirePermission('FLEET', 'view'), async (req, res) => {
  const { data, error } = await supabase
    .from('lp_vehicle_audit')
    .select('*')
    .eq('va_vehicle', req.params.code)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── GET /api/vehicles/:code/trips ─────────────────────────────────────────────
// Pulsit Trip Report history for one vehicle — powers the Fleet card's
// Tracking History tab (grouped/collapsed by year and month client-side).
// Capped at 5000 most recent trips: even a vehicle running several trips a
// day stays well under that across a few years, and this is an
// on-demand detail view rather than something polled.
router.get('/:code/trips', requirePermission('FLEET', 'view'), async (req, res) => {
  const { data, error } = await supabase
    .from('lp_vehicle_trips')
    .select('start_time, end_time, start_location, end_location, elapsed_minutes, distance_km, avg_speed, max_speed')
    .eq('vh_code', req.params.code)
    .order('start_time', { ascending: false })
    .limit(5000);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── GET /api/vehicles/:code/maintenance ───────────────────────────────────────
router.get('/:code/maintenance', requirePermission('FLEET', 'view'), async (req, res) => {
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
