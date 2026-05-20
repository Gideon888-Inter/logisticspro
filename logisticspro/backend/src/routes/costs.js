const express = require('express');
const supabase = require('../supabase');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();
router.use(authMiddleware);

// GET costs for a load
router.get('/', async (req, res) => {
  const { load } = req.query;
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
  res.status(201).json(data);
});

// DELETE a cost
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('lp_costs').delete().eq('c_cost_no', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Deleted' });
});

module.exports = router;
