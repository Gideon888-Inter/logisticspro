const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../supabase');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const { data: user, error } = await supabase
    .from('lp_users')
    .select('*')
    .eq('u_username', username.trim())
    .eq('u_active', 'Y')
    .single();

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.u_password);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    {
      id: user.u_id,
      username: user.u_username,
      name: user.u_name,
      role: user.u_role,
      bus_unit: user.u_bus_unit,
    },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({
    token,
    user: {
      id: user.u_id,
      username: user.u_username,
      name: user.u_name,
      role: user.u_role,
      bus_unit: user.u_bus_unit,
    },
  });
});

// POST /api/auth/register  (ADMIN only — call this once to create first admin)
router.post('/register', async (req, res) => {
  const { username, password, name, email, role, bus_unit } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from('lp_users')
    .insert([{ u_username: username, u_password: hash, u_name: name, u_email: email, u_role: role || 'OPERATOR', u_bus_unit: bus_unit }])
    .select('u_id, u_username, u_name, u_role')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

module.exports = router;
