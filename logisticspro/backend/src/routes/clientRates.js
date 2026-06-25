const express = require('express');
const supabase = require('../supabase');
const { authMiddleware, requireRole, ROLES, CAN_VIEW_RATES } = require('../middleware/auth');
const router = express.Router();
router.use(authMiddleware);

const CAN_MANAGE_RATES = [ROLES.ADMIN, ROLES.MANAGER];

router.get('/', requireRole(...CAN_VIEW_RATES), async (req, res) => {
  const { client_code } = req.query;
  let q = supabase.from('lp_client_rates').select('*').order('rc_client_code').order('rc_from');
  if (client_code) q = q.eq('rc_client_code', client_code);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/', requireRole(...CAN_MANAGE_RATES), async (req, res) => {
  const { client_code, routes } = req.body;
  if (!client_code || !routes?.length) return res.status(400).json({ error: 'client_code and routes required' });
  const rows = routes.map(r => ({
    rc_client_code: client_code,
    rc_from: r.from_loc,
    rc_to: r.to_loc,
    rc_kms: r.kms ? Number(r.kms) : null,
    rc_rate_15m: r.rate_15m ? Number(r.rate_15m) : null,
    rc_rate_18m: r.rate_18m ? Number(r.rate_18m) : null,
  }));
  const { data, error } = await supabase.from('lp_client_rates').insert(rows).select();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.patch('/:id', requireRole(...CAN_MANAGE_RATES), async (req, res) => {
  const { data, error } = await supabase.from('lp_client_rates').update({
    rc_from: req.body.rc_from, rc_to: req.body.rc_to,
    rc_kms: req.body.rc_kms, rc_rate_15m: req.body.rc_rate_15m, rc_rate_18m: req.body.rc_rate_18m,
  }).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', requireRole(...CAN_MANAGE_RATES), async (req, res) => {
  const { error } = await supabase.from('lp_client_rates').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Deleted' });
});

module.exports = router;
