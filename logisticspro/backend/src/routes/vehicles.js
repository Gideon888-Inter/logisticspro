const express = require('express');
const supabase = require('../supabase');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/vehicles
router.get('/', async (req, res) => {
  const { type, bus_unit, active = 'Y' } = req.query;
  let q = supabase.from('lp_vehicles').select('*').order('vh_code');
  if (active !== 'all') q = q.eq('vh_active', active);
  if (type)     q = q.eq('vh_type', type);
  if (bus_unit) q = q.eq('vh_bus_unit', bus_unit);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/vehicles/:code
router.get('/:code', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_vehicles').select('*').eq('vh_code', req.params.code).single();
  if (error) return res.status(404).json({ error: 'Vehicle not found' });
  res.json(data);
});

// POST /api/vehicles
router.post('/', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { data, error } = await supabase.from('lp_vehicles').insert([req.body]).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /api/vehicles/:code
router.patch('/:code', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { data, error } = await supabase
    .from('lp_vehicles').update(req.body).eq('vh_code', req.params.code).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// GET /api/vehicles/:code/maintenance
router.get('/:code/maintenance', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_maintenance').select('*').eq('ma_vehicle', req.params.code).order('ma_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
