/**
 * LP2.0 — Addresses Route
 * ========================
 * Named locations (client sites, depots, and "Home Base" geofences) used by:
 *   - Clients.jsx → Addresses tab (CRUD)
 *   - Dashboard.jsx FleetTab → resolves a vehicle's live GPS position to a
 *     friendly name instead of a raw Pulsit reverse-geocoded string, and
 *     powers the "Home Base" filter
 *
 * No hard deletion — deactivating sets a_active = 'N' rather than removing
 * the row, consistent with the rest of the app.
 */
const express = require('express');
const supabase = require('../supabase');
const { authMiddleware, loadUserPermissions, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
router.use(loadUserPermissions);

// ── GET /api/addresses ──────────────────────────────────────────────────────
// ?type=HOME_BASE | CLIENT | DEPOT | OTHER, ?client_code=, ?active=Y|N|all (default Y)
router.get('/', async (req, res) => {
  const { type, client_code, active = 'Y' } = req.query;
  let q = supabase.from('lp_addresses').select('*').order('a_name');
  if (active !== 'all') q = q.eq('a_active', active);
  if (type) q = q.eq('a_type', type);
  if (client_code) q = q.eq('a_client_code', client_code);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── GET /api/addresses/:id ───────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_addresses').select('*').eq('address_id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Address not found' });
  res.json(data);
});

// ── POST /api/addresses ──────────────────────────────────────────────────────
router.post('/', requirePermission('CLIENTS', 'edit'), async (req, res) => {
  const { a_name, a_latitude, a_longitude } = req.body;
  if (!a_name?.trim()) return res.status(400).json({ error: 'Name is required' });
  if (a_latitude == null || a_longitude == null) {
    return res.status(400).json({ error: 'Please pick a location on the map (latitude/longitude required)' });
  }

  const payload = {
    a_name:        a_name.trim(),
    a_address:     req.body.a_address || null,
    a_latitude:    Number(a_latitude),
    a_longitude:   Number(a_longitude),
    a_radius_km:   req.body.a_radius_km != null ? Number(req.body.a_radius_km) : 2,
    a_type:        req.body.a_type || 'CLIENT',
    a_client_code: req.body.a_client_code || null,
    created_by:    req.user.username,
  };

  const { data, error } = await supabase.from('lp_addresses').insert([payload]).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// ── PATCH /api/addresses/:id ─────────────────────────────────────────────────
router.patch('/:id', requirePermission('CLIENTS', 'edit'), async (req, res) => {
  const allowed = ['a_name', 'a_address', 'a_latitude', 'a_longitude', 'a_radius_km', 'a_type', 'a_client_code', 'a_active'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No editable fields provided' });

  const { data, error } = await supabase
    .from('lp_addresses').update(updates).eq('address_id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ── DELETE /api/addresses/:id — soft delete (deactivate) ────────────────────
router.delete('/:id', requirePermission('CLIENTS', 'edit'), async (req, res) => {
  const { data, error } = await supabase
    .from('lp_addresses').update({ a_active: 'N' }).eq('address_id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

module.exports = router;
