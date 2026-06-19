const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../supabase');
const { authMiddleware, requireRole, ROLES, CAN_MANAGE_USERS } = require('../middleware/auth');

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
// POST /api/auth/register — Create or request a new user
//
// ADMIN        → creates any user immediately, no approval needed
// MANAGER      → creates user OR submits for approval depending on role:
//   • OPERATOR / OPS_ASSISTANT / CONTROL_ROOM → approval by Sharon Mitchell
//   • WORKSHOP                                 → approval by Workshop Manager
//   • MANAGER                                  → approval by any ADMIN
//   • ADMIN                                    → forbidden (Admin only)
//   • ACCOUNTING / READONLY                    → created directly (no approval)
// ============================================================
router.post('/register', authMiddleware, requireRole(...CAN_MANAGE_USERS), async (req, res) => {
  const { u_username, u_password, u_name, u_email, u_role, u_bus_unit, u_region, u_active } = req.body;

  if (!u_username?.trim())
    return res.status(400).json({ error: 'Username is required' });

  if (!u_password || u_password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });

  // Manager cannot create Admin users
  if (req.user.role === ROLES.MANAGER && u_role === ROLES.ADMIN)
    return res.status(403).json({ error: 'Only Administrators can create Admin users' });

  // Check username not already taken (also check pending approvals)
  const { data: existing } = await supabase
    .from('lp_users')
    .select('u_id')
    .eq('u_username', u_username.trim())
    .single();

  if (existing)
    return res.status(409).json({ error: 'Username already exists' });

  const { data: pendingExisting } = await supabase
    .from('lp_user_approvals')
    .select('id')
    .eq('ua_username', u_username.trim())
    .eq('ua_status', 'PENDING')
    .single();

  if (pendingExisting)
    return res.status(409).json({ error: 'A pending request for this username already exists' });

  const hashed = await bcrypt.hash(u_password, 10);

  // Determine if approval is required
  const NEEDS_APPROVAL_ROLES = [ROLES.OPERATOR, ROLES.OPS_ASSISTANT, ROLES.CONTROL_ROOM, ROLES.WORKSHOP, ROLES.MANAGER];
  const needsApproval = req.user.role === ROLES.MANAGER && NEEDS_APPROVAL_ROLES.includes(u_role);

  if (!needsApproval) {
    // Admin, or Manager creating ACCOUNTING/READONLY — create directly
    const { data, error } = await supabase
      .from('lp_users')
      .insert([{
        u_username:    u_username.trim(),
        u_password:    hashed,
        u_name:        u_name || '',
        u_email:       u_email || '',
        u_role:        u_role || ROLES.OPERATOR,
        u_bus_unit:    u_bus_unit || null,
        u_region:      u_region || null,
        u_active:      u_active || 'Y',
        u_first_login: 'Y',
      }])
      .select('u_id, u_username, u_name, u_role, u_bus_unit, u_region, u_active')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ ...data, pending: false });
  }

  // Determine the correct approver from config
  let approverKey = 'approver_ops_users';
  if (u_role === ROLES.WORKSHOP)  approverKey = 'approver_workshop_users';
  if (u_role === ROLES.MANAGER)   approverKey = null; // goes to any Admin

  let approverUsername;
  if (approverKey) {
    const { data: cfg } = await supabase
      .from('lp_config')
      .select('cfg_value')
      .eq('cfg_key', approverKey)
      .single();
    approverUsername = cfg?.cfg_value;
  } else {
    // Manager user → find first active Admin
    const { data: admins } = await supabase
      .from('lp_users')
      .select('u_username')
      .eq('u_role', ROLES.ADMIN)
      .eq('u_active', 'Y')
      .limit(1);
    approverUsername = admins?.[0]?.u_username;
  }

  if (!approverUsername)
    return res.status(500).json({ error: 'No approver configured. Please contact system administrator.' });

  // Insert pending approval record
  const { data: approval, error: approvalError } = await supabase
    .from('lp_user_approvals')
    .insert([{
      ua_username:      u_username.trim(),
      ua_password_hash: hashed,
      ua_name:          u_name || '',
      ua_email:         u_email || '',
      ua_role:          u_role,
      ua_bus_unit:      u_bus_unit || null,
      ua_region:        u_region || null,
      ua_requested_by:  req.user.username,
      ua_approver:      approverUsername,
      ua_status:        'PENDING',
    }])
    .select()
    .single();

  if (approvalError) return res.status(400).json({ error: approvalError.message });

  // Notify the approver
  await supabase.from('lp_notifications').insert([{
    n_user:    approverUsername,
    n_type:    'USER_APPROVAL_REQUIRED',
    n_title:   'New User Approval Required',
    n_message: `${req.user.name || req.user.username} has requested a new ${u_role} user: ${u_name || u_username} (${u_username}). Please review in the Users section.`,
    n_ref_id:  approval.id,
  }]);

  res.status(202).json({
    pending:   true,
    message:   `User creation request submitted. Awaiting approval from ${approverUsername}.`,
    approver:  approverUsername,
    requestId: approval.id,
  });
});


// ============================================================
// GET /api/auth/pending-users — list pending user approvals
// ============================================================
router.get('/pending-users', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('lp_user_approvals')
    .select('*')
    .eq('ua_approver', req.user.username)
    .eq('ua_status', 'PENDING')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});


// ============================================================
// PATCH /api/auth/pending-users/:id — approve or reject
// ============================================================
router.patch('/pending-users/:id', authMiddleware, async (req, res) => {
  const { action, rejection_reason } = req.body;
  if (!['approve', 'reject'].includes(action))
    return res.status(400).json({ error: 'Action must be approve or reject' });

  const { data: approval, error: fetchErr } = await supabase
    .from('lp_user_approvals')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (fetchErr || !approval)
    return res.status(404).json({ error: 'Approval request not found' });

  if (approval.ua_approver !== req.user.username && req.user.role !== ROLES.ADMIN)
    return res.status(403).json({ error: 'You are not the designated approver for this request' });

  if (approval.ua_status !== 'PENDING')
    return res.status(400).json({ error: 'This request has already been actioned' });

  if (action === 'approve') {
    // Create the user
    const { error: createErr } = await supabase
      .from('lp_users')
      .insert([{
        u_username:    approval.ua_username,
        u_password:    approval.ua_password_hash,
        u_name:        approval.ua_name,
        u_email:       approval.ua_email,
        u_role:        approval.ua_role,
        u_bus_unit:    approval.ua_bus_unit,
        u_region:      approval.ua_region,
        u_active:      'Y',
        u_first_login: 'Y',
      }]);

    if (createErr) return res.status(400).json({ error: createErr.message });

    await supabase.from('lp_user_approvals').update({
      ua_status:      'APPROVED',
      ua_actioned_by: req.user.username,
      ua_actioned_at: new Date().toISOString(),
    }).eq('id', req.params.id);

    // Notify the requester
    await supabase.from('lp_notifications').insert([{
      n_user:    approval.ua_requested_by,
      n_type:    'USER_APPROVED',
      n_title:   'User Creation Approved',
      n_message: `Your request to create user "${approval.ua_username}" (${approval.ua_role}) has been approved by ${req.user.name || req.user.username}.`,
    }]);

    return res.json({ success: true, action: 'approved' });
  }

  // Reject
  if (!rejection_reason?.trim())
    return res.status(400).json({ error: 'A rejection reason is required' });

  await supabase.from('lp_user_approvals').update({
    ua_status:           'REJECTED',
    ua_rejection_reason: rejection_reason,
    ua_actioned_by:      req.user.username,
    ua_actioned_at:      new Date().toISOString(),
  }).eq('id', req.params.id);

  await supabase.from('lp_notifications').insert([{
    n_user:    approval.ua_requested_by,
    n_type:    'USER_REJECTED',
    n_title:   'User Creation Rejected',
    n_message: `Your request to create user "${approval.ua_username}" was rejected by ${req.user.name || req.user.username}. Reason: ${rejection_reason}`,
  }]);

  res.json({ success: true, action: 'rejected' });
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

  if (!user)
    return res.json({ success: true, message: 'If the username exists, a new password has been sent' });

  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
  let tempPassword = '';
  for (let i = 0; i < 10; i++)
    tempPassword += chars[Math.floor(Math.random() * chars.length)];

  const hashed = await bcrypt.hash(tempPassword, 10);
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await supabase
    .from('lp_users')
    .update({
      u_password:           hashed,
      u_first_login:        'Y',
      u_reset_token:        tempPassword,
      u_reset_token_expiry: expiry,
    })
    .eq('u_username', username);

 console.log(`[PASSWORD RESET] User: ${username}, Temp password: ${tempPassword}`);

  res.json({
    success: true,
    message: 'A temporary password has been set. Please contact your administrator to retrieve it.',
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
