/**
 * LP2.0 — Role & Permission Management Route
 * ============================================
 * Admin-only. Provides full CRUD for custom roles and their per-module
 * permission assignments (view / edit / delete / approve).
 *
 * Built-in roles (ADMIN, MANAGER etc.) are read-only — can be viewed
 * for reference but their permissions cannot be changed here.
 * Their enforcement is hardcoded in auth.js.
 *
 * Endpoints
 * ─────────
 * GET  /roles/modules              List all modules (reference)
 * GET  /roles                      List all roles (built-in + custom)
 * GET  /roles/:key                 Role detail + full permission matrix
 * POST /roles                      Create new custom role
 * PATCH /roles/:key                Update custom role metadata
 * DELETE /roles/:key               Deactivate (soft delete) a custom role
 * GET  /roles/:key/permissions     Permission matrix for a role
 * PUT  /roles/:key/permissions     Replace entire permission matrix for a role
 * PATCH /roles/:key/permissions/:module  Update a single module's permissions
 */

const express = require('express');
const router  = express.Router();
const { createClient } = require('@supabase/supabase-js');
const {
  authMiddleware, requireRole, ROLES, BUILTIN_ROLES,
} = require('../middleware/auth');

let _supabase = null;
function supabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _supabase;
}

router.use(authMiddleware);
router.use(requireRole(ROLES.ADMIN));  // All role management is Admin-only

// ─────────────────────────────────────────────────────────────────────────────
// MODULES (reference)
// ─────────────────────────────────────────────────────────────────────────────

// GET /roles/modules — list all modules with their groups
router.get('/modules', async (req, res) => {
  const { data, error } = await supabase()
    .from('lp_modules')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─────────────────────────────────────────────────────────────────────────────
// ROLES
// ─────────────────────────────────────────────────────────────────────────────

// GET /roles — list all roles: built-in (from constant) + custom (from DB)
router.get('/', async (req, res) => {
  const { data: customRoles, error } = await supabase()
    .from('lp_custom_roles')
    .select('*')
    .order('role_label');
  if (error) return res.status(500).json({ error: error.message });

  // Built-in roles as static objects
  const builtinRoleList = [
    { role_key: 'ADMIN',               role_label: 'Admin',               role_group: 'Built-in', is_builtin: true, badge_color: 'badge-red',    description: 'Full access to everything' },
    { role_key: 'MANAGER',             role_label: 'Manager',             role_group: 'Built-in', is_builtin: true, badge_color: 'badge-amber',  description: 'Management view + rate/user/client control' },
    { role_key: 'OPERATOR',            role_label: 'Operator',            role_group: 'Built-in', is_builtin: true, badge_color: 'badge-blue',   description: 'Full load management, fleet, drivers, clients' },
    { role_key: 'OPS_ASSISTANT',       role_label: 'Ops Assistant',       role_group: 'Built-in', is_builtin: true, badge_color: 'badge-blue',   description: 'Same as Operator but changes queue for approval' },
    { role_key: 'CONTROL_ROOM',        role_label: 'Control Room',        role_group: 'Built-in', is_builtin: true, badge_color: 'badge-gray',   description: 'Create loads, advance to OFFLOADED only' },
    { role_key: 'FINANCE',             role_label: 'Finance',             role_group: 'Built-in', is_builtin: true, badge_color: 'badge-green',  description: 'Invoices, AP/AR, GL journals — no operational edits' },
    { role_key: 'WORKSHOP_MANAGER',    role_label: 'Workshop Manager',    role_group: 'Built-in', is_builtin: true, badge_color: 'badge-purple', description: 'L3 PO approver, creates inventory items, full workshop' },
    { role_key: 'WORKSHOP_ASSISTANT',  role_label: 'Workshop Assistant',  role_group: 'Built-in', is_builtin: true, badge_color: 'badge-purple', description: 'L2 PO approver, approves inventory items' },
    { role_key: 'STOCK_CONTROLLER',    role_label: 'Stock Controller',    role_group: 'Built-in', is_builtin: true, badge_color: 'badge-purple', description: 'L1 PO approver, manages stock levels' },
    { role_key: 'WORKSHOP',            role_label: 'Workshop',            role_group: 'Built-in', is_builtin: true, badge_color: 'badge-gray',   description: 'General workshop staff — view and service cards' },
    { role_key: 'READONLY',            role_label: 'Read Only',           role_group: 'Built-in', is_builtin: true, badge_color: 'badge-gray',   description: 'View loads only, no changes anywhere' },
  ];

  res.json({
    builtin: builtinRoleList,
    custom:  (customRoles || []).map(r => ({ ...r, is_builtin: false })),
  });
});

// GET /roles/:key — full detail: role metadata + permission matrix
router.get('/:key', async (req, res) => {
  const { key } = req.params;
  const isBuiltin = BUILTIN_ROLES.has(key);

  let roleData = null;
  if (isBuiltin) {
    // Return synthetic object for built-in roles
    roleData = { role_key: key, is_builtin: true, base_role: null };
  } else {
    const { data, error } = await supabase()
      .from('lp_custom_roles')
      .select('*')
      .eq('role_key', key)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Role not found' });
    roleData = { ...data, is_builtin: false };
  }

  // Get permission matrix — two separate queries (join shorthand unreliable)
  const { data: perms } = await supabase()
    .from('lp_role_permissions')
    .select('*')
    .eq('role_key', key);

  // Get all modules so we can show 0-permission rows too
  const { data: allModules } = await supabase()
    .from('lp_modules')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');

  const permMap = {};
  for (const p of (perms || [])) {
    permMap[p.module_key] = p;
  }

  const matrix = (allModules || []).map(mod => ({
    module_key:   mod.module_key,
    module_label: mod.module_label,
    module_group: mod.module_group,
    sort_order:   mod.sort_order,
    can_view:     permMap[mod.module_key]?.can_view    ?? false,
    can_edit:     permMap[mod.module_key]?.can_edit    ?? false,
    can_delete:   permMap[mod.module_key]?.can_delete  ?? false,
    can_approve:  permMap[mod.module_key]?.can_approve ?? false,
    extra_flags:  permMap[mod.module_key]?.extra_flags ?? {},
    is_seeded:    isBuiltin || (permMap[mod.module_key] !== undefined),
  }));

  res.json({ role: roleData, permissions: matrix });
});

// POST /roles — create a new custom role
router.post('/', async (req, res) => {
  const {
    role_key, role_label, role_group, badge_color,
    description, base_role, permissions,
  } = req.body;

  if (!role_key || !role_label)
    return res.status(400).json({ error: 'role_key and role_label are required' });

  // Validate role_key: uppercase, underscores only, not a built-in
  const validKey = /^[A-Z][A-Z0-9_]{1,48}$/.test(role_key);
  if (!validKey)
    return res.status(400).json({ error: 'role_key must be uppercase letters, digits and underscores, 2–50 chars' });
  if (BUILTIN_ROLES.has(role_key))
    return res.status(400).json({ error: `${role_key} is a reserved built-in role name` });
  if (base_role && !BUILTIN_ROLES.has(base_role))
    return res.status(400).json({ error: `base_role must be a valid built-in role` });

  // Create role
  const { data: newRole, error: roleErr } = await supabase()
    .from('lp_custom_roles')
    .insert({
      role_key,
      role_label,
      role_group:   role_group   || 'Custom',
      badge_color:  badge_color  || 'badge-gray',
      description:  description  || null,
      base_role:    base_role    || null,
      created_by:   req.user.username,
    })
    .select()
    .single();

  if (roleErr) return res.status(400).json({ error: roleErr.message });

  // Seed permissions if provided
  if (permissions?.length) {
    const permRows = permissions.map(p => ({
      role_key,
      module_key:  p.module_key,
      can_view:    !!p.can_view,
      can_edit:    !!p.can_edit,
      can_delete:  !!p.can_delete,
      can_approve: !!p.can_approve,
      extra_flags: p.extra_flags || null,
      updated_by:  req.user.username,
    }));
    const { error: permErr } = await supabase()
      .from('lp_role_permissions')
      .upsert(permRows, { onConflict: 'role_key,module_key' });
    if (permErr) return res.status(400).json({ error: permErr.message });
  }

  // Also add a row in lp_users CHECK constraint isn't violated — note:
  // The Supabase constraint must be updated to include new custom role keys.
  // We handle this by generating a migration snippet the Admin can run.
  const constraintNote = `To allow users to be assigned this role, run in Supabase SQL Editor:\n` +
    `ALTER TABLE lp_users DROP CONSTRAINT IF EXISTS lp_users_u_role_check;\n` +
    `-- Then re-add with '${role_key}' included in the list.\n` +
    `-- Or use migration_005_add_role.sql (auto-generated).`;

  res.status(201).json({ role: newRole, constraint_note: constraintNote });
});

// PATCH /roles/:key — update custom role metadata
router.patch('/:key', async (req, res) => {
  const { key } = req.params;
  if (BUILTIN_ROLES.has(key))
    return res.status(403).json({ error: 'Built-in roles cannot be modified' });

  const allowed = ['role_label', 'role_group', 'badge_color', 'description', 'base_role', 'is_active'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase()
    .from('lp_custom_roles')
    .update(updates)
    .eq('role_key', key)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// DELETE /roles/:key — soft-deactivate a custom role
router.delete('/:key', async (req, res) => {
  const { key } = req.params;
  if (BUILTIN_ROLES.has(key))
    return res.status(403).json({ error: 'Built-in roles cannot be deleted' });

  // Check if any active users have this role
  const { data: users } = await supabase()
    .from('lp_users')
    .select('u_id, u_username')
    .eq('u_role', key)
    .eq('u_active', 'Y');

  if (users?.length) {
    return res.status(409).json({
      error: `Cannot deactivate — ${users.length} active user(s) have this role`,
      users: users.map(u => u.u_username),
    });
  }

  const { error } = await supabase()
    .from('lp_custom_roles')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('role_key', key);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, message: `Role ${key} deactivated` });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERMISSIONS
// ─────────────────────────────────────────────────────────────────────────────

// GET /roles/:key/permissions — get permission matrix
router.get('/:key/permissions', async (req, res) => {
  const { data, error } = await supabase()
    .from('lp_role_permissions')
    .select('*, lp_modules(module_label, module_group, sort_order)')
    .eq('role_key', req.params.key)
    .order('lp_modules(sort_order)');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// PUT /roles/:key/permissions — replace entire permission matrix
router.put('/:key/permissions', async (req, res) => {
  const { key } = req.params;
  if (BUILTIN_ROLES.has(key))
    return res.status(403).json({ error: 'Built-in role permissions are managed in auth.js and cannot be changed here' });

  const { permissions } = req.body;
  if (!Array.isArray(permissions))
    return res.status(400).json({ error: 'permissions must be an array' });

  const rows = permissions.map(p => ({
    role_key:    key,
    module_key:  p.module_key,
    can_view:    !!p.can_view,
    can_edit:    !!p.can_edit,
    can_delete:  !!p.can_delete,
    can_approve: !!p.can_approve,
    extra_flags: p.extra_flags || null,
    updated_by:  req.user.username,
    updated_at:  new Date().toISOString(),
  }));

  // Delete existing and reinsert
  await supabase().from('lp_role_permissions').delete().eq('role_key', key);
  const { data, error } = await supabase().from('lp_role_permissions').insert(rows).select();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, updated: data?.length });
});

// PATCH /roles/:key/permissions/:module — update a single module
router.patch('/:key/permissions/:module', async (req, res) => {
  const { key, module } = req.params;
  if (BUILTIN_ROLES.has(key))
    return res.status(403).json({ error: 'Built-in role permissions cannot be changed here' });

  const { can_view, can_edit, can_delete, can_approve, extra_flags } = req.body;
  const updates = {
    role_key:    key,
    module_key:  module,
    can_view:    can_view    ?? false,
    can_edit:    can_edit    ?? false,
    can_delete:  can_delete  ?? false,
    can_approve: can_approve ?? false,
    updated_by:  req.user.username,
    updated_at:  new Date().toISOString(),
  };
  if (extra_flags !== undefined) updates.extra_flags = extra_flags;

  const { data, error } = await supabase()
    .from('lp_role_permissions')
    .upsert(updates, { onConflict: 'role_key,module_key' })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// POST /roles/:key/generate-migration — generate SQL to add role to lp_users constraint
// This lets Admin download and run a safe migration without manual SQL editing
router.post('/:key/generate-migration', async (req, res) => {
  const { key } = req.params;

  const { data: customRoles } = await supabase()
    .from('lp_custom_roles')
    .select('role_key')
    .eq('is_active', true);

  const allCustomKeys = (customRoles || []).map(r => `'${r.role_key}'`);
  const allBuiltin = [
    "'ADMIN'","'MANAGER'","'OPERATOR'","'OPS_ASSISTANT'","'CONTROL_ROOM'",
    "'FINANCE'","'WORKSHOP_MANAGER'","'WORKSHOP_ASSISTANT'","'STOCK_CONTROLLER'",
    "'WORKSHOP'","'READONLY'"
  ];
  const allKeys = [...allBuiltin, ...allCustomKeys].join(',\n    ');

  const sql = `-- Auto-generated migration: add custom roles to lp_users constraint
-- Generated: ${new Date().toISOString()}
-- Run in Supabase SQL Editor

ALTER TABLE lp_users
  DROP CONSTRAINT IF EXISTS lp_users_u_role_check;

ALTER TABLE lp_users
  ADD CONSTRAINT lp_users_u_role_check
  CHECK (u_role IN (
    ${allKeys}
  ));

-- Also update lp_user_approvals constraint
ALTER TABLE lp_user_approvals
  DROP CONSTRAINT IF EXISTS lp_user_approvals_ua_role_check;

ALTER TABLE lp_user_approvals
  ADD CONSTRAINT lp_user_approvals_ua_role_check
  CHECK (ua_role IN (
    ${allKeys}
  ));
`;

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="migration_add_roles_${Date.now()}.sql"`);
  res.send(sql);
});

module.exports = router;


