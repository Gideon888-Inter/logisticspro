const express = require('express');
const supabase = require('../supabase');
const { authMiddleware, requireRole, loadUserPermissions, requirePermission } = require('../middleware/auth');

// ── DRIVERS ──────────────────────────────────────────────────
const driversRouter = express.Router();
driversRouter.use(authMiddleware);
driversRouter.use(loadUserPermissions);

driversRouter.get('/', async (req, res) => {
  const { bus_unit, active } = req.query;
  let q = supabase.from('lp_drivers').select('*').order('d_nickname');
  // bus_unit filter removed — column dropped
  if (active !== undefined) q = q.eq('d_active', active);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

driversRouter.get('/:id', async (req, res) => {
  const { data, error } = await supabase.from('lp_drivers').select('*').eq('d_id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Driver not found' });
  res.json(data);
});

driversRouter.post('/', requirePermission('DRIVERS', 'edit'), async (req, res) => {
  const { data, error } = await supabase.from('lp_drivers').insert([req.body]).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

driversRouter.patch('/:id', requirePermission('DRIVERS', 'edit'), async (req, res) => {
  const { data, error } = await supabase.from('lp_drivers').update(req.body).eq('d_id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ── CUSTOMERS ─────────────────────────────────────────────────
const customersRouter = express.Router();
customersRouter.use(authMiddleware);
customersRouter.use(loadUserPermissions);

customersRouter.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_customers')
    .select('*, lp_customer_contact(*)')
    .eq('c_active', 'Y')
    .order('c_name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

customersRouter.get('/:code', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_customers')
    .select('*, lp_customer_contact(*)')
    .eq('c_code', req.params.code)
    .single();
  if (error) return res.status(404).json({ error: 'Customer not found' });
  res.json(data);
});

customersRouter.post('/', requirePermission('CLIENTS', 'edit'), async (req, res) => {
  const { contacts, ...customer } = req.body;
  const { data, error } = await supabase.from('lp_customers').insert([customer]).select().single();
  if (error) return res.status(400).json({ error: error.message });
  if (contacts?.length) {
    await supabase.from('lp_customer_contact').insert(contacts.map(c => ({ ...c, cc_customer: data.c_code })));
  }
  res.status(201).json(data);
});

customersRouter.patch('/:code', requirePermission('CLIENTS', 'edit'), async (req, res) => {
  const { data, error } = await supabase.from('lp_customers').update(req.body).eq('c_code', req.params.code).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ── MAINTENANCE ───────────────────────────────────────────────
const maintenanceRouter = express.Router();
maintenanceRouter.use(authMiddleware);

maintenanceRouter.get('/', async (req, res) => {
  const { status, vehicle } = req.query;
  let q = supabase.from('lp_maintenance').select('*, lp_vehicles(vh_code, vh_type)').order('ma_date', { ascending: false });
  if (status)  q = q.eq('ma_status', status);
  if (vehicle) q = q.eq('ma_vehicle', vehicle);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

maintenanceRouter.post('/', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_maintenance')
    .insert([{ ...req.body, ma_operator: req.user.username }])
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

maintenanceRouter.patch('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_maintenance').update(req.body).eq('ma_incident_no', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ── ROUTES (freight routes) ───────────────────────────────────
const routesRouter = express.Router();
routesRouter.use(authMiddleware);
routesRouter.use(loadUserPermissions);

routesRouter.get('/', async (req, res) => {
  const { data, error } = await supabase.from('lp_route').select('*').order('rc_code');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

routesRouter.post('/', requirePermission('ROUTES', 'edit'), async (req, res) => {
  const { data, error } = await supabase.from('lp_route').insert([req.body]).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

routesRouter.patch('/:id', requirePermission('ROUTES', 'edit'), async (req, res) => {
  const { data, error } = await supabase.from('lp_route').update(req.body).eq('rc_no', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

module.exports = { driversRouter, customersRouter, maintenanceRouter, routesRouter };


