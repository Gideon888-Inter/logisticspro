const express = require('express');
const supabase = require('../supabase');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();
router.use(authMiddleware);

// GET costs — single load or all loads summary
router.get('/', async (req, res) => {
  const { load, summary } = req.query;

  // Return all costs as a load_no -> total map for dashboard
  if (summary === 'true') {
    const { data, error } = await supabase
      .from('lp_costs')
      .select('c_load, c_amount');
    if (error) return res.status(500).json({ error: error.message });
    const map = {};
    (data || []).forEach(c => {
      map[c.c_load] = (map[c.c_load] || 0) + Number(c.c_amount || 0);
    });
    return res.json(map);
  }

  if (!load) return res.json([]);
  const { data, error } = await supabase
    .from('lp_costs')
    .select('*')
    .eq('c_load', load)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST add a cost
router.post('/', async (req, res) => {
  const payload = {
    ...req.body,
    c_operator: req.user.username,
    c_description: req.body.c_description || req.body.c_code,
  };
  const { data, error } = await supabase
    .from('lp_costs')
    .insert([payload])
    .select().single();
  if (error) return res.status(400).json({ error: error.message });

  // Add audit trail comment
  if (req.body.c_load) {
    const amount = Number(req.body.c_amount||0).toLocaleString('en-ZA', {minimumFractionDigits:2});
    await supabase.from('lp_comments').insert([{
      c_load: req.body.c_load,
      c_comment: `Cost added: ${req.body.c_code} — R ${amount} (${req.body.c_description || req.body.c_code})`,
      c_logged_by: req.user.username,
    }]);
  }

  res.status(201).json(data);
});

// DELETE a cost
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('lp_costs').delete().eq('c_cost_no', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Deleted' });
});

module.exports = router;
