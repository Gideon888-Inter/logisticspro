const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../supabase');
const { authMiddleware, loadUserPermissions, requirePermission } = require('../middleware/auth');
const router = express.Router();
router.use(authMiddleware);
router.use(loadUserPermissions);

router.get('/', requirePermission('USERS', 'view'), async (req, res) => {
  const { data, error } = await supabase
    .from('lp_users')
    .select('u_id,u_username,u_name,u_email,u_role,u_active,u_region')
    .order('u_username');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.patch('/:id', requirePermission('USERS', 'edit'), async (req, res) => {
  const updates = { ...req.body };
  delete updates.u_bus_unit; // removed from schema
  if (updates.u_password) { updates.u_password = await bcrypt.hash(updates.u_password, 10); }
  else { delete updates.u_password; }
  const { data, error } = await supabase
    .from('lp_users')
    .update(updates)
    .eq('u_id', req.params.id)
    .select('u_id,u_username,u_name,u_email,u_role,u_active,u_region')
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

module.exports = router;
