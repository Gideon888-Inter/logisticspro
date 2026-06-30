/**
 * LP2.0 Tracking Integration — Pulsit (BIS.MST.Services-PULS) GPS API
 * =====================================================================
 * Core Pulsit auth/fetch/caching logic lives in lib/pulsit.js (shared
 * with vehicles.js fleet-overview). This file just exposes it via routes.
 */
const express = require('express');
const { authMiddleware, loadUserPermissions, requirePermission } = require('../middleware/auth');
const { getPulsitVehicles, mapVehicle } = require('../lib/pulsit');

const router = express.Router();
router.use(authMiddleware);
router.use(loadUserPermissions);

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
