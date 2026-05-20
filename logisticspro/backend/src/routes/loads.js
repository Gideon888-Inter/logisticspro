const express = require('express');
const supabase = require('../supabase');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/loads  — list with filters
router.get('/', async (req, res) => {
  const { status, bus_unit, customer, truck, from, to, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('lp_movement')
    .select('*, lp_customers(c_name)', { count: 'exact' })
    .neq('m_status', 'DELETED')
    .order('m_date', { ascending: false })
    .range(offset, offset + Number(limit) - 1);

  if (status)   query = query.eq('m_status', status);
  if (bus_unit) query = query.eq('m_bus_unit', bus_unit);
  if (customer) query = query.eq('m_customer', customer);
  if (truck)    query = query.eq('m_truck', truck);
  if (from)     query = query.gte('m_date', from);
  if (to)       query = query.lte('m_date', to);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data, total: count, page: Number(page), limit: Number(limit) });
});

// GET /api/loads/:id
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_movement')
    .select('*, lp_customers(c_name), lp_vehicles(vh_type)')
    .eq('m_load_no', req.params.id)
    .single();
  if (error) return res.status(404).json({ error: 'Load not found' });
  res.json(data);
});

// GET /api/loads/:id/comments
router.get('/:id/comments', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_comments')
    .select('*')
    .eq('c_load', req.params.id)
    .order('c_time', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/loads/:id/comments
router.post('/:id/comments', async (req, res) => {
  const { comment } = req.body;
  const { data, error } = await supabase
    .from('lp_comments')
    .insert([{ c_load: req.params.id, c_comment: comment, c_logged_by: req.user.username }])
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// POST /api/loads  — create new load
router.post('/', async (req, res) => {
  // Auto-generate load number: A + 6 digits, sequential
  const { data: last } = await supabase
    .from('lp_movement')
    .select('m_load_no')
    .like('m_load_no', 'A%')
    .order('m_load_no', { ascending: false })
    .limit(1);

  let nextNum = 100001;
  if (last && last.length > 0) {
    const lastNum = parseInt(last[0].m_load_no.replace('A', ''), 10);
    if (!isNaN(lastNum)) nextNum = lastNum + 1;
  }
  const m_load_no = 'A' + String(nextNum).padStart(6, '0');

  const load = {
    ...req.body,
    m_load_no,
    m_operator: req.user.username,
    m_status: req.body.m_status || 'PRELOAD',
    m_app_time: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('lp_movement')
    .insert([load])
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /api/loads/:id  — update status or fields
router.patch('/:id', async (req, res) => {
  const updates = { ...req.body, updated_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from('lp_movement')
    .update(updates)
    .eq('m_load_no', req.params.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });

  // Auto-add audit comment when status changes
  if (req.body.m_status) {
    await supabase.from('lp_comments').insert([{
      c_load: req.params.id,
      c_comment: `Status changed to ${req.body.m_status} by ${req.user.username}`,
      c_logged_by: req.user.username,
    }]);
  }

  res.json(data);
});

// DELETE /api/loads/:id  — soft delete
router.delete('/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { error } = await supabase
    .from('lp_movement')
    .update({ m_status: 'DELETED', updated_at: new Date().toISOString() })
    .eq('m_load_no', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Load deleted' });
});

// GET /api/loads/stats/summary  — dashboard stats
router.get('/stats/summary', async (req, res) => {
  const { bus_unit } = req.query;

  let q = supabase.from('lp_movement').select('m_status, m_load_total').neq('m_status', 'DELETED');
  if (bus_unit) q = q.eq('m_bus_unit', bus_unit);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const stats = {
    total: data.length,
    en_route: data.filter(r => r.m_status === 'EN_ROUTE').length,
    wait_approval: data.filter(r => r.m_status === 'WAIT_APPROVAL').length,
    invoiced: data.filter(r => r.m_status === 'LOAD_INVOICED').length,
    total_value: data.reduce((s, r) => s + Number(r.m_load_total || 0), 0),
  };
  res.json(stats);
});

module.exports = router;
