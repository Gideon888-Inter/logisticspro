/**
 * LP2.0 Tracking Integration — Pulsit (BIS.MST.Services-PULS) GPS API
 * =====================================================================
 * Provider docs: https://mstsvc-rpuls.mstrack.com/api (Swagger)
 *
 * GET /api/Vehicles turned out to be the right data source — it already
 * carries live position (latitude/longitude), speed, heading, odometer,
 * ignition status, vehicleType, registrationNumber, and a vehicleDescription
 * field that matches our internal fleet codes (MH173, MH191, ST83, etc).
 * The separate /Vehicles/gpsfeed endpoint returns a different, sparser
 * dataset keyed by an opaque device id with no usable vehicle reference —
 * not used here.
 *
 * AUTH: confirmed working — POST /Auth/login with { apiKey } returns a
 * long-lived bearer token. Cached in memory, refreshed on 401.
 *
 * RATE LIMITING: Pulsit returns 429 if /Vehicles is hit too frequently.
 * Results are cached server-side for POSITIONS_CACHE_MS regardless of how
 * many LP2.0 users are polling — only one upstream call per cache window.
 */
const express = require('express');
const { authMiddleware, loadUserPermissions, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
router.use(loadUserPermissions);

const PULSIT_BASE = 'https://mstsvc-rpuls.mstrack.com/api';
const PULSIT_KEY = process.env.PULSIT_API_KEY;
const POSITIONS_CACHE_MS = 15000; // floor on how often we hit Pulsit's /Vehicles

let cachedToken = null;
let tokenExpiresAt = 0;

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
  if (!PULSIT_KEY) throw new Error('PULSIT_API_KEY is not set on the server');
  const result = await fetchWithTimeout(`${PULSIT_BASE}/Auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: PULSIT_KEY }),
  });
  const token = result.ok ? (result.data?.token || result.data?.Token) : null;
  if (!token) {
    const err = new Error('Pulsit login failed');
    err.details = { status: result.status, response: result.data };
    throw err;
  }
  return token;
}

async function getToken(forceRefresh = false) {
  if (!forceRefresh && cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  cachedToken = await loginPulsit();
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
  if (result.status === 429) {
    const err = new Error('Pulsit rate limit hit (429) — please wait a moment');
    err.details = result.data;
    throw err;
  }
  if (!result.ok) {
    const err = new Error(`Pulsit API error ${result.status} on ${path}`);
    err.details = result.data;
    throw err;
  }
  return result.data;
}

// ── Cached vehicle list — single upstream call shared by all pollers ───────
let vehiclesCache = null;
let vehiclesCacheAt = 0;

async function getPulsitVehicles(forceRefresh = false) {
  if (!forceRefresh && vehiclesCache && (Date.now() - vehiclesCacheAt) < POSITIONS_CACHE_MS) {
    return vehiclesCache;
  }
  const data = await pulsitGet('/Vehicles');
  const list = Array.isArray(data) ? data : (data?.items || data?.data || []);
  vehiclesCache = list;
  vehiclesCacheAt = Date.now();
  return list;
}

function mapVehicle(v) {
  return {
    code:       v.vehicleDescription || null,   // matches our vh_code (e.g. MH173, ST83)
    regNo:      v.registrationNumber || null,
    lat:        v.latitude ?? null,
    lng:        v.longitude ?? null,
    heading:    v.heading != null ? Number(v.heading) : null,
    speed:      v.speed ?? null,
    odometer:   v.odometer ?? null,
    ignition:   v.ignitionStatus ?? null,
    vehicleType: v.vehicleType || null,
    location:   v.geoLocation || null,
    lastUpdate: v.transactionDate ?? null,
  };
}

// ── GET /api/tracking/positions ─────────────────────────────────────────────
router.get('/positions', requirePermission('FLEET', 'view'), async (req, res) => {
  try {
    const list = await getPulsitVehicles();
    const positions = list
      .map(mapVehicle)
      .filter(p => (p.code || p.regNo) && p.lat != null && p.lng != null);
    res.json(positions);
  } catch (e) {
    console.error('[tracking/positions]', e.message, e.details || '');
    res.status(502).json({ error: e.message, details: e.details });
  }
});

// ── GET /api/tracking/debug ──────────────────────────────────────────────────
// Admin-only. Single Pulsit call (avoids tripping the rate limit) showing
// both the raw response and our mapped/filtered result.
router.get('/debug', async (req, res) => {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Admin only' });
  try {
    const list = await getPulsitVehicles(true);
    const mapped = list.map(mapVehicle).filter(p => (p.code || p.regNo) && p.lat != null && p.lng != null);
    res.json({
      totalFromPulsit: list.length,
      totalResolved: mapped.length,
      rawSample: list.slice(0, 3),
      mappedSample: mapped.slice(0, 5),
    });
  } catch (e) {
    res.status(502).json({ error: e.message, details: e.details });
  }
});

module.exports = router;
