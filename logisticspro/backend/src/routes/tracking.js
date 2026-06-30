/**
 * LP2.0 Tracking Integration — Pulsit (BIS.MST.Services-PULS) GPS API
 * =====================================================================
 * Provider docs: https://mstsvc-rpuls.mstrack.com/api (Swagger)
 *
 * AUTH NOTE: Pulsit's documented flow is bearer-token-via-login, not a raw
 * API key in the header. We were only given a single API key string with
 * no sample login payload, so loginPulsit() tries several common body
 * shapes against POST /Auth/login until one returns a token. Once we see
 * the real response (via GET /api/tracking/debug as Admin), trim
 * LOGIN_ATTEMPTS down to the one that actually works.
 *
 * Token is cached in memory (per Render instance) and refreshed on 401
 * or after ~25 minutes, whichever comes first.
 */
const express = require('express');
const { authMiddleware, loadUserPermissions, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
router.use(loadUserPermissions);

const PULSIT_BASE = 'https://mstsvc-rpuls.mstrack.com/api';
const PULSIT_KEY = process.env.PULSIT_API_KEY;

let cachedToken = null;
let tokenExpiresAt = 0;

// ── Candidate login body shapes — first one that returns a token wins ──────
const LOGIN_ATTEMPTS = [
  () => ({ apiKey: PULSIT_KEY }),
  () => ({ ApiKey: PULSIT_KEY }),
  () => ({ key: PULSIT_KEY }),
  () => ({ token: PULSIT_KEY }),
  () => ({ username: PULSIT_KEY, password: PULSIT_KEY }),
];

function extractToken(data) {
  if (!data || typeof data !== 'object') return null;
  return data.token || data.Token || data.accessToken || data.access_token || data.jwt || null;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await r.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: r.ok, status: r.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function loginPulsit() {
  if (!PULSIT_KEY) {
    const err = new Error('PULSIT_API_KEY is not set on the server');
    throw err;
  }

  const attempts = [];
  for (const buildBody of LOGIN_ATTEMPTS) {
    const body = buildBody();
    const result = await fetchWithTimeout(`${PULSIT_BASE}/Auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    attempts.push({ bodyUsed: Object.keys(body), status: result.status, response: result.data });

    if (result.ok) {
      const token = extractToken(result.data);
      if (token) return { token, bodyUsed: body, raw: result.data, attempts };
    }
  }

  const err = new Error('Pulsit login failed — none of the known body shapes worked');
  err.attempts = attempts;
  throw err;
}

async function getToken(forceRefresh = false) {
  if (!forceRefresh && cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const { token } = await loginPulsit();
  cachedToken = token;
  tokenExpiresAt = Date.now() + 25 * 60 * 1000; // conservative 25 min refresh window
  return cachedToken;
}

async function pulsitGet(path, retryOn401 = true) {
  const token = await getToken();
  const result = await fetchWithTimeout(`${PULSIT_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (result.status === 401 && retryOn401) {
    cachedToken = null; // token expired/invalid — force a fresh login and try once more
    return pulsitGet(path, false);
  }

  if (!result.ok) {
    const err = new Error(`Pulsit API error ${result.status} on ${path}`);
    err.details = result.data;
    throw err;
  }
  return result.data;
}

// ── Vehicle (device id → registration) lookup ───────────────────────────────
// Pulsit's gpsfeed only returns a device "id" — no registration number — so
// we resolve it against GET /api/Vehicles, which carries both. Cached for
// 10 minutes since the fleet roster doesn't change minute-to-minute.
let vehicleMapCache = null;
let vehicleMapExpiresAt = 0;

function extractDeviceId(v) {
  const val = v.id ?? v.Id ?? v.ID ?? v.unitId ?? v.deviceId ?? null;
  return val != null ? String(val) : null;
}
function extractRegNo(v) {
  return v.regNo ?? v.RegNo ?? v.registration ?? v.Registration ?? v.plate ?? v.Plate ?? null;
}

async function getVehicleMap(forceRefresh = false) {
  if (!forceRefresh && vehicleMapCache && Date.now() < vehicleMapExpiresAt) return vehicleMapCache;
  const data = await pulsitGet('/Vehicles');
  const list = Array.isArray(data) ? data : (data?.items || data?.data || []);
  const map = {};
  list.forEach(v => {
    const id = extractDeviceId(v);
    const regNo = extractRegNo(v);
    if (id && regNo) map[id] = regNo;
  });
  vehicleMapCache = map;
  vehicleMapExpiresAt = Date.now() + 10 * 60 * 1000;
  return map;
}

// ── GET /api/tracking/positions ─────────────────────────────────────────────
// Returns current GPS positions in a normalised shape:
// [{ regNo, lat, lng, heading, speed, lastUpdate }]
router.get('/positions', requirePermission('FLEET', 'view'), async (req, res) => {
  try {
    const [feed, vehicleMap] = await Promise.all([
      pulsitGet('/Vehicles/gpsfeed'),
      getVehicleMap(),
    ]);
    const list = Array.isArray(feed) ? feed : (feed?.items || feed?.data || []);
    const positions = list.map(v => {
      const id = extractDeviceId(v);
      return {
        regNo:      id ? (vehicleMap[id] || null) : null,
        lat:        v.gpsLat ?? v.lat ?? v.latitude ?? null,
        lng:        v.gpsLong ?? v.lng ?? v.lon ?? v.longitude ?? null,
        heading:    v.heading ?? v.course ?? null,
        speed:      v.speed ?? null,
        lastUpdate: v.gpsDate ?? v.timestamp ?? v.lastUpdate ?? null,
      };
    }).filter(p => p.regNo && p.lat != null && p.lng != null);
    res.json(positions);
  } catch (e) {
    console.error('[tracking/positions]', e.message, e.details || e.attempts || '');
    res.status(502).json({ error: e.message, details: e.details || e.attempts });
  }
});

// ── GET /api/tracking/debug ──────────────────────────────────────────────────
// Admin-only. Shows exactly what Pulsit sent back for login + gpsfeed + the
// vehicle list, plus the final resolved positions, so field-name mismatches
// can be diagnosed without redeploying blind.
router.get('/debug', async (req, res) => {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Admin only' });
  try {
    const loginResult = await loginPulsit();

    let feedSample = null, feedError = null;
    try {
      const feed = await pulsitGet('/Vehicles/gpsfeed');
      feedSample = Array.isArray(feed) ? feed.slice(0, 3) : feed;
    } catch (e) {
      feedError = { message: e.message, details: e.details };
    }

    let vehiclesSample = null, vehiclesError = null, vehicleMapSize = 0;
    try {
      const vehicles = await pulsitGet('/Vehicles');
      const list = Array.isArray(vehicles) ? vehicles : (vehicles?.items || vehicles?.data || []);
      vehiclesSample = list.slice(0, 3);
      const map = await getVehicleMap(true);
      vehicleMapSize = Object.keys(map).length;
    } catch (e) {
      vehiclesError = { message: e.message, details: e.details };
    }

    let resolvedPositionsSample = null, positionsError = null;
    try {
      const [feed, vehicleMap] = await Promise.all([pulsitGet('/Vehicles/gpsfeed'), getVehicleMap()]);
      const list = Array.isArray(feed) ? feed : (feed?.items || feed?.data || []);
      resolvedPositionsSample = list.slice(0, 5).map(v => {
        const id = extractDeviceId(v);
        return {
          deviceId: id,
          resolvedRegNo: id ? (vehicleMap[id] || null) : null,
          lat: v.gpsLat ?? v.lat ?? null,
          lng: v.gpsLong ?? v.lng ?? null,
          lastUpdate: v.gpsDate ?? v.timestamp ?? null,
        };
      });
    } catch (e) {
      positionsError = { message: e.message, details: e.details };
    }

    res.json({
      loginSucceededWith: Object.keys(loginResult.bodyUsed),
      feedSample,
      feedError,
      vehiclesSample,
      vehiclesError,
      vehicleMapSize,
      resolvedPositionsSample,
      positionsError,
    });
  } catch (e) {
    res.status(502).json({ error: e.message, attempts: e.attempts });
  }
});

module.exports = router;
