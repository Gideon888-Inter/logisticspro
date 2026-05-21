const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../supabase');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

// ============================================================
// POST /api/auth/login
// ============================================================
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });

  const { data: user, error } = await supabase
    .from('lp_users')
    .select('*')
    .eq('u_username', username)
    .eq('u_active', 'Y')
    .single();

  if (error || !user)
    return res.status(401).json({ error: 'Invalid username or password' });

  const valid = await bcrypt.compare(password, user.u_password);
  if (!valid)
    return res.status(401).json({ error: 'Invalid username or password' });

  const token = jwt.sign(
    {
      id:       user.u_id,
      username: user.u_username,
      role:     user.u_role,
      name:     user.u_name,
      region:   user.u_region,
    },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({
    token,
    user: {
      id:          user.u_id,
      username:    user.u_username,
      name:        user.u_name,
      role:        user.u_role,
      region:      user.u_region,
      bus_unit:    user.u_bus_unit,
      first_login: user.u_first_login === 'Y',
    },
  });
});


// ============================================================
// POST /api/auth/register  — Create a new user (ADMIN/MANAGER only)
// ============================================================
router.post('/register', authMiddleware, requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  const { u_username, u_password, u_name, u_email, u_role, u_bus_unit, u_region, u_active } = req.body;

  if (!u_username || !u_username.trim())
    return res.status(400).json({ error: 'Username is required' });

  if (!u_password || u_password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });

  // Check username is not already taken
  const { data: existing } = await supabase
    .from('lp_users')
    .select('u_id')
    .eq('u_username', u_username.trim())
    .single();

  if (existing)
    return res.status(409).json({ error: 'Username already exists' });

  const hashed = await bcrypt.hash(u_password, 10);

  const { data, error } = await supabase
    .from('lp_users')
    .insert([{
      u_username:   u_username.trim(),
      u_password:   hashed,
      u_name:       u_name || '',
      u_email:      u_email || '',
      u_role:       u_role || 'OPERATOR',
      u_bus_unit:   u_bus_unit || null,
      u_region:     u_region || null,
      u_active:     u_active || 'Y',
      u_first_login: 'Y',
    }])
    .select('u_id, u_username, u_name, u_role, u_bus_unit, u_region, u_active')
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.status(201).json(data);
});


// ============================================================
// POST /api/auth/change-password
// ============================================================
router.post('/change-password', authMiddleware, async (req, res) => {
  const { current_password, new_password } = req.body;

  if (!new_password || new_password.length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters' });

  const { data: user } = await supabase
    .from('lp_users')
    .select('u_password')
    .eq('u_username', req.user.username)
    .single();

  if (!user) return res.status(404).json({ error: 'User not found' });

  // If not first login, verify current password
  if (current_password) {
    const valid = await bcrypt.compare(current_password, user.u_password);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const hashed = await bcrypt.hash(new_password, 10);

  await supabase
    .from('lp_users')
    .update({
      u_password:          hashed,
      u_first_login:       'N',
      u_reset_token:       null,
      u_reset_token_expiry: null,
    })
    .eq('u_username', req.user.username);

  res.json({ success: true, message: 'Password changed successfully' });
});


// ============================================================
// POST /api/auth/forgot-password
// ============================================================
router.post('/forgot-password', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });

  const { data: user } = await supabase
    .from('lp_users')
    .select('*')
    .eq('u_username', username)
    .eq('u_active', 'Y')
    .single();

  // Always return success to prevent username guessing
  if (!user)
    return res.json({ success: true, message: 'If the username exists, a new password has been sent' });

  // Generate a random 10-character temporary password
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
  let tempPassword = '';
  for (let i = 0; i < 10; i++)
    tempPassword += chars[Math.floor(Math.random() * chars.length)];

  const hashed = await bcrypt.hash(tempPassword, 10);
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await supabase
    .from('lp_users')
    .update({
      u_password:          hashed,
      u_first_login:       'Y',
      u_reset_token:       tempPassword,
      u_reset_token_expiry: expiry,
    })
    .eq('u_username', username);

  console.log(`[PASSWORD RESET] User: ${username}, Temp password: ${tempPassword}`);

  // NOTE: Remove temp_password from response once email is configured
  res.json({
    success:       true,
    message:       'Temporary password generated',
    temp_password: tempPassword,
    note:          'You will be prompted to change this on first login',
  });
});


// ============================================================
// GET /api/auth/me
// ============================================================
router.get('/me', authMiddleware, async (req, res) => {
  const { data: user } = await supabase
    .from('lp_users')
    .select('u_username, u_name, u_role, u_region, u_bus_unit, u_first_login')
    .eq('u_username', req.user.username)
    .single();

  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({ ...user, first_login: user.u_first_login === 'Y' });
});


module.exports = router;
