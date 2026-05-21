const express = require('express');
const supabase = require('../supabase');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/loads — list with filters
router.get('/', async (req, res) => {
  const { status, bus_unit, customer, truck, date_from, date_to, search, page = 1, limit = 100 } = req.query;
  const offset = (page - 1) * limit;
  let query = supabase
    .from('lp_movement')
    .select('m_load_no, m_date, m_customer, m_truck, m_driver_id, m_from, m_to, m_rate, m_status, m_invoice, m_opening_km, m_closing_km, m_trailer1, m_trailer2, m_responsible_operator, m_bus_unit, m_order_no, m_order_no_pending, m_order_no_requested_by, m_loading_address, m_offloading_address', { count: 'exact' })
    .neq('m_status', 'DELETED')
    .order('m_date', { ascending: false })
    .range(offset, offset + Number(limit) - 1);
  if (status)   query = query.eq('m_status', status);
  if (bus_unit) query = query.eq('m_bus_unit', bus_unit);
  if (customer) query = query.eq('m_customer', customer);
  if (truck)    query = query.eq('m_truck', truck);
  if (date_from) query = query.gte('m_date', date_from);
  if (date_to)   query = query.lte('m_date', date_to);
  if (search) {
    query = query.or(`m_load_no.ilike.%${search}%,m_truck.ilike.%${search}%,m_customer.ilike.%${search}%,m_from.ilike.%${search}%,m_to.ilike.%${search}%,m_driver_id.ilike.%${search}%`);
  }
  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data, total: count, page: Number(page), limit: Number(limit) });
});

// GET /api/loads/stats/summary — dashboard stats (MUST be before /:id)
router.get('/stats/summary', async (req, res) => {
  const { bus_unit } = req.query;
  let q = supabase.from('lp_movement').select('m_status, m_load_total, m_rate').neq('m_status', 'DELETED');
  if (bus_unit) q = q.eq('m_bus_unit', bus_unit);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const stats = {
    total: data.length,
    en_route: data.filter(r => r.m_status === 'EN_ROUTE').length,
    wait_approval: data.filter(r => r.m_status === 'WAIT_APPROVAL').length,
    invoiced: data.filter(r => r.m_status === 'LOAD_INVOICED').length,
    total_value: data.reduce((s, r) => s + Number(r.m_rate || 0), 0),
  };
  res.json(stats);
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

// POST /api/loads — create new load with auto-generated load number
router.post('/', async (req, res) => {
  try {
    // Auto-generate load number: A + 6 digits, sequential
    const { data: last, error: lastErr } = await supabase
      .from('lp_movement')
      .select('m_load_no')
      .like('m_load_no', 'A%')
      .order('m_load_no', { ascending: false })
      .limit(1);

    let nextNum = 100001;
    if (!lastErr && last && last.length > 0) {
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
      m_date: new Date().toISOString().split('T')[0],
    };

    const { data, error } = await supabase
      .from('lp_movement')
      .insert([load])
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Audit trail - load created
    await supabase.from('lp_comments').insert([{
      c_load: data.m_load_no,
      c_comment: `Load created by ${req.user.username}. Truck: ${load.m_truck}, Customer: ${load.m_customer}, Route: ${load.m_from} → ${load.m_to}, Rate: R ${Number(load.m_rate||0).toLocaleString('en-ZA')}`,
      c_logged_by: req.user.username,
    }]);

    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/loads/:id — update status or fields
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

// DELETE /api/loads/:id — soft delete
router.delete('/:id', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { error } = await supabase
    .from('lp_movement')
    .update({ m_status: 'DELETED', updated_at: new Date().toISOString() })
    .eq('m_load_no', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Load deleted' });
});

// POST request order number change
router.post('/:id/request-order-no', async (req, res) => {
  const { order_no } = req.body;
  if (!order_no?.trim()) return res.status(400).json({ error: 'Please provide an order number' });

  const { data: load } = await supabase
    .from('lp_movement').select('m_order_no, m_order_no_pending').eq('m_load_no', req.params.id).single();
  if (!load) return res.status(404).json({ error: 'Load not found' });

  // If no existing order number, save directly
  if (!load.m_order_no || load.m_order_no.trim() === '' || load.m_order_no === '0') {
    await supabase.from('lp_movement').update({
      m_order_no: order_no,
      updated_at: new Date().toISOString(),
    }).eq('m_load_no', req.params.id);

    await supabase.from('lp_comments').insert([{
      c_load: req.params.id,
      c_comment: `Order number set to: ${order_no}`,
      c_logged_by: req.user.username,
    }]);
    return res.json({ saved: true, message: 'Order number saved' });
  }

  // Existing order number — requires approval
  await supabase.from('lp_movement').update({
    m_order_no_pending: order_no,
    m_order_no_requested_by: req.user.username,
    m_order_no_request_time: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('m_load_no', req.params.id);

  await supabase.from('lp_comments').insert([{
    c_load: req.params.id,
    c_comment: `Order number change requested: "${load.m_order_no}" → "${order_no}" — awaiting approval`,
    c_logged_by: req.user.username,
  }]);

  await supabase.from('lp_notifications').insert([{
    n_role: 'OPERATIONS',
    n_type: 'ORDER_NO_CHANGE',
    n_title: 'Order Number Change Approval Required',
    n_message: `${req.user.username} requested order number change on load ${req.params.id}: "${load.m_order_no}" → "${order_no}"`,
    n_load_no: req.params.id,
  }]);

  res.json({ saved: false, pending: true, message: 'Change submitted for approval' });
});

// PATCH approve or reject order number change
router.patch('/:id/approve-order-no', async (req, res) => {
  const { action, rejection_reason } = req.body;

  const { data: load } = await supabase
    .from('lp_movement').select('m_order_no, m_order_no_pending, m_order_no_requested_by').eq('m_load_no', req.params.id).single();
  if (!load) return res.status(404).json({ error: 'Load not found' });

  if (action === 'approve') {
    await supabase.from('lp_movement').update({
      m_order_no: load.m_order_no_pending,
      m_order_no_pending: null,
      m_order_no_requested_by: null,
      m_order_no_request_time: null,
      updated_at: new Date().toISOString(),
    }).eq('m_load_no', req.params.id);

    await supabase.from('lp_comments').insert([{
      c_load: req.params.id,
      c_comment: `Order number change APPROVED by ${req.user.username}: "${load.m_order_no}" → "${load.m_order_no_pending}"`,
      c_logged_by: req.user.username,
    }]);

    await supabase.from('lp_notifications').insert([{
      n_user: load.m_order_no_requested_by,
      n_type: 'ORDER_NO_APPROVED',
      n_title: 'Order Number Change Approved',
      n_message: `Your order number change on load ${req.params.id} was approved: "${load.m_order_no_pending}"`,
      n_load_no: req.params.id,
    }]);
  } else {
    await supabase.from('lp_movement').update({
      m_order_no_pending: null,
      m_order_no_requested_by: null,
      m_order_no_request_time: null,
      updated_at: new Date().toISOString(),
    }).eq('m_load_no', req.params.id);

    await supabase.from('lp_comments').insert([{
      c_load: req.params.id,
      c_comment: `Order number change REJECTED by ${req.user.username}. Reason: ${rejection_reason || 'No reason given'}`,
      c_logged_by: req.user.username,
    }]);

    await supabase.from('lp_notifications').insert([{
      n_user: load.m_order_no_requested_by,
      n_type: 'ORDER_NO_REJECTED',
      n_title: 'Order Number Change Rejected',
      n_message: `Your order number change on load ${req.params.id} was rejected. Reason: ${rejection_reason || 'No reason given'}`,
      n_load_no: req.params.id,
    }]);
  }

  res.json({ success: true, action });
});

// GET pending order number changes
router.get('/pending-order-nos', async (req, res) => {
  const { data, error } = await supabase
    .from('lp_movement')
    .select('m_load_no, m_date, m_customer, m_truck, m_order_no, m_order_no_pending, m_order_no_requested_by, m_order_no_request_time')
    .not('m_order_no_pending', 'is', null)
    .order('m_order_no_request_time', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

module.exports = router;
