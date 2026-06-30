/**
 * LP2.0 — Tracking History Ingestion
 * =====================================================================
 * Logs Pulsit GPS/odometer snapshots into lp_vehicle_tracking_history so
 * future reports (monthly vehicle KM report, fuel-vs-distance, tracking
 * history on the Fleet card) can query our own database instead of
 * re-hitting Pulsit every time — see migration_vehicle_tracking_history.sql.
 *
 * This is hit by an EXTERNAL SCHEDULER (e.g. cron-job.org), not a logged-in
 * browser session, so it deliberately does NOT use the normal JWT
 * authMiddleware — it's mounted separately in index.js, ahead of/outside
 * the regular authenticated route group, and gated by a shared secret
 * instead (TRACKING_INGEST_SECRET).
 *
 * SETUP (once TRACKING_INGEST_SECRET is set in Render's environment):
 *   Point an external scheduler at:
 *     POST https://logisticspro-agks.onrender.com/api/tracking/ingest-snapshot
 *     Header: x-ingest-key: <TRACKING_INGEST_SECRET>
 *   Every 15 minutes is a reasonable starting interval — frequent enough
 *   for a useful KM/location history, infrequent enough to stay well
 *   under Pulsit's rate limit (lib/pulsit.js already caches/shares calls
 *   across consumers, but this adds one more consumer to that budget).
 *   The hit itself also wakes the Render free-tier dyno if it had spun
 *   down, so this doubles as an additional keepalive.
 */
const express = require('express');
const supabase = require('../supabase');
const { getPulsitVehicles, mapVehicle } = require('../lib/pulsit');
const { normalizeVehicleKey, buildVehicleKeyMap, resolveVehicleCode } = require('../lib/vehicleCode');

const router = express.Router();

function requireIngestSecret(req, res, next) {
  const expected = process.env.TRACKING_INGEST_SECRET;
  if (!expected) return res.status(503).json({ error: 'TRACKING_INGEST_SECRET is not configured on the server' });
  if (req.headers['x-ingest-key'] !== expected) return res.status(401).json({ error: 'Invalid or missing ingest key' });
  next();
}

// ============================================================
// POST /api/tracking/ingest-snapshot
// ============================================================
router.post('/ingest-snapshot', requireIngestSecret, async (req, res) => {
  try {
    const [list, vehiclesRes] = await Promise.all([
      getPulsitVehicles(true),
      supabase.from('lp_vehicles').select('vh_code'),
    ]);

    const mapped = list.map(mapVehicle).filter(p => p.code);
    const keyMap = buildVehicleKeyMap(vehiclesRes.data || []);
    const recordedAt = new Date().toISOString();

    const rows = mapped
      .map(p => ({ ...p, resolvedCode: resolveVehicleCode(p.code, keyMap) }))
      .filter(p => keyMap.has(normalizeVehicleKey(p.resolvedCode))) // drop anything that didn't resolve to a real vehicle
      .map(p => ({
        vh_code:     p.resolvedCode,
        recorded_at: recordedAt,
        latitude:    p.lat,
        longitude:   p.lng,
        speed:       p.speed,
        heading:     p.heading,
        odometer:    p.odometer,
        ignition:    p.ignition,
        source:      'LIVE_POLL',
      }));

    if (rows.length === 0) {
      return res.json({ success: true, inserted: 0, message: 'No Pulsit vehicle codes resolved to a known vehicle this poll' });
    }

    const { error } = await supabase
      .from('lp_vehicle_tracking_history')
      .upsert(rows, { onConflict: 'vh_code,recorded_at', ignoreDuplicates: true });

    if (error) throw error;

    res.json({ success: true, inserted: rows.length, recorded_at: recordedAt });
  } catch (e) {
    console.error('[tracking/ingest-snapshot]', e.message, e.details || '');
    res.status(502).json({ error: e.message, details: e.details });
  }
});

module.exports = router;
