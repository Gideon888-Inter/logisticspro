const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../supabase');
const { authMiddleware, requireRole } = require('../middleware/auth');
const router = express.Router();
router.use(authMiddleware);

router.get('/', requireRole('ADMIN','MANAGER'), async (req, res) => {
  const { data, error } = await supabase.from('lp_users').select('u_id,u_username,u_name,u_email,u_role,u_bus_unit,u_active').order('u_username');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const updates = { ...req.body };
  if (updates.u_password) { updates.u_password = await bcrypt.hash(updates.u_password, 10); }
  else { delete updates.u_password; }
  const { data, error } = await supabase.from('lp_users').update(updates).eq('u_id', req.params.id).select('u_id,u_username,u_name,u_email,u_role,u_bus_unit,u_active').single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

module.exports = router;
