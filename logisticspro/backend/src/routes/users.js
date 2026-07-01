const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../supabase');
const {
  authMiddleware, loadUserPermissions, requirePermission, requireRole,
  ROLES, BUILTIN_ROLES, BUILTIN_PERMISSION_MAP, ACCESS_GROUPS, isStrongPassword,
} = require('../middleware/auth');
const router = express.Router();
router.use(authMiddleware);
router.use(loadUserPermissions);

// Roles a non-Admin editor must never be able to grant or touch via the
// generic PATCH /:id / reset-password routes — see the guards below.
const PRIVILEGED_ROLES = [ROLES.ADMIN, ROLES.FINANCE];

// ── Helper: log a sensitive user-account action ─────────────────────────────
async function logUserAudit(username, action, detail, operator) {
  try {
    await supabase.from('lp_user_audit').insert([{
      aud_username: username,
      aud_action:   action,
      aud_detail:   detail || null,
      aud_operator: operator,
    }]);
  } catch (e) { console.error('[user audit log failed]', e.message); }
}

// ── Helper: compute a role's full effective permission matrix ───────────────
// Mirrors loadUserPermissions() in middleware/auth.js but works off a role
// key directly (no req/res), so it can be reused both for reporting current
// state and as the starting point before applying edits.
async function getEffectivePermissions(roleKey) {
  const result = {};
  for (const module of Object.keys(BUILTIN_PERMISSION_MAP)) {
    result[module] = { view: false, edit: false, delete: false, approve: false };
  }

  if (roleKey === ROLES.ADMIN) {
    for (const module of Object.keys(BUILTIN_PERMISSION_MAP)) {
      result[module] = { view: true, edit: true, delete: true, approve: true };
    }
    return result;
  }

  if (BUILTIN_ROLES.has(roleKey)) {
    for (const [module, actions] of Object.entries(BUILTIN_PERMISSION_MAP)) {
      result[module] = {
        view:    actions.view.includes(roleKey),
        edit:    actions.edit.includes(roleKey),
        delete:  (actions.delete || []).includes(roleKey),
        approve: (actions.approve || []).includes(roleKey),
      };
    }
  } else {
    const { data: customRole } = await supabase
      .from('lp_custom_roles')
      .select('base_role')
      .eq('role_key', roleKey)
      .single();
    if (customRole?.base_role && BUILTIN_ROLES.has(customRole.base_role)) {
      for (const [module, actions] of Object.entries(BUILTIN_PERMISSION_MAP)) {
        result[module] = {
          view:    actions.view.includes(customRole.base_role),
          edit:    actions.edit.includes(customRole.base_role),
          delete:  (actions.delete || []).includes(customRole.base_role),
          approve: (actions.approve || []).includes(customRole.base_role),
        };
      }
    }
  }

  const { data: overrides } = await supabase
    .from('lp_role_permissions')
    .select('module_key, can_view, can_edit, can_delete, can_approve')
    .eq('role_key', roleKey);
  for (const o of (overrides || [])) {
    result[o.module_key] = {
      view: o.can_view, edit: o.can_edit, delete: o.can_delete, approve: o.can_approve,
    };
  }

  return result;
}

// ── Helper: clone-on-write — find or create this user's personal role ──────
// Naming follows Gideon's own suggestion: "{base role} {username}" — e.g.
// OPERATOR_JSMITH. Repeated edits reuse the SAME personal role rather than
// spawning a new one each time; only the first customization clones it.
async function getOrCreatePersonalRole(target, operator) {
  if (!BUILTIN_ROLES.has(target.u_role)) {
    const { data: existing } = await supabase
      .from('lp_custom_roles')
      .select('role_key, is_personal')
      .eq('role_key', target.u_role)
      .eq('is_active', true)
      .single();
    if (existing?.is_personal) return existing.role_key;
    // It's a shared (Admin-authored) custom role, not a personal one —
    // customizing this individual user still needs its own clone, falling
    // through to the creation path below.
  }

  // lp_custom_roles.base_role must always be a built-in role key (see the
  // validation in roles_admin.js POST /roles) — resolve the ultimate
  // built-in ancestor so a clone made from a shared custom role doesn't
  // try to point base_role at another custom role.
  let ancestorBuiltin = target.u_role;
  if (!BUILTIN_ROLES.has(ancestorBuiltin)) {
    const { data: sharedRole } = await supabase
      .from('lp_custom_roles')
      .select('base_role')
      .eq('role_key', target.u_role)
      .single();
    ancestorBuiltin = (sharedRole?.base_role && BUILTIN_ROLES.has(sharedRole.base_role))
      ? sharedRole.base_role
      : ROLES.READONLY; // safest possible fallback if ancestry can't be resolved
  }

  const safeUsername = target.u_username.replace(/[^A-Za-z0-9]/g, '_').toUpperCase().slice(0, 30);
  const roleKey = `${target.u_role}_${safeUsername}`.slice(0, 50);

  const { data: alreadyExists } = await supabase
    .from('lp_custom_roles')
    .select('role_key')
    .eq('role_key', roleKey)
    .single();

  if (!alreadyExists) {
    const basePerms = await getEffectivePermissions(target.u_role);
    const { error: roleErr } = await supabase.from('lp_custom_roles').insert([{
      role_key:          roleKey,
      role_label:        `${target.u_role} — ${target.u_username} (Custom)`,
      role_group:        'Custom',
      badge_color:       'badge-gray',
      description:       `Individual access override for ${target.u_username}, cloned from ${target.u_role}.`,
      base_role:         ancestorBuiltin,
      is_personal:       true,
      personal_for_user: target.u_username,
      created_by:        operator,
    }]);
    if (roleErr) throw roleErr;

    const permRows = Object.entries(basePerms).map(([module_key, p]) => ({
      role_key: roleKey, module_key,
      can_view: p.view, can_edit: p.edit, can_delete: p.delete, can_approve: p.approve,
      updated_by: operator,
    }));
    if (permRows.length) {
      const { error: permErr } = await supabase.from('lp_role_permissions').insert(permRows);
      if (permErr) throw permErr;
    }
  }

  return roleKey;
}

// ============================================================
// GET /api/users
// ============================================================
router.get('/', requirePermission('USERS', 'view'), async (req, res) => {
  const { data, error } = await supabase
    .from('lp_users')
    .select('u_id,u_username,u_name,u_email,u_role,u_active,u_region')
    .order('u_username');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ============================================================
// PATCH /api/users/:id — edit profile fields and/or reassign to a
// different role via the normal role dropdown. Does NOT accept password
// changes (see POST /:id/reset-password) — keeping password changes on
// their own dedicated, role-gated, audited endpoint means this generic
// edit can never accidentally slip an unvalidated password through.
// ============================================================
router.patch('/:id', requirePermission('USERS', 'edit'), async (req, res) => {
  // Whitelist — previously this spread the entire request body (minus
  // u_bus_unit/u_password) straight into the update, so any column on
  // lp_users sent in the body would be written, including ones that should
  // only ever change via a dedicated flow. Only these profile/role fields
  // are editable from this generic route.
  const ALLOWED_FIELDS = ['u_name', 'u_email', 'u_role', 'u_active', 'u_region'];
  const updates = {};
  for (const key of ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) updates[key] = req.body[key];
  }

  const requesterIsAdmin = req.user?.role === ROLES.ADMIN;

  // Role-escalation guard: only Admin may grant a privileged role (Admin/
  // Finance) to anyone, and only Admin may edit a user who currently holds
  // a privileged role — a Manager with USERS.edit access (e.g. via the
  // Management access-group toggle) should never be able to promote
  // someone to Admin/Finance or modify an existing Admin/Finance account.
  if (!requesterIsAdmin) {
    if (updates.u_role && PRIVILEGED_ROLES.includes(updates.u_role)) {
      return res.status(403).json({ error: 'Only an Admin can assign that role' });
    }
    const { data: target, error: targetErr } = await supabase
      .from('lp_users')
      .select('u_role')
      .eq('u_id', req.params.id)
      .single();
    if (targetErr) return res.status(400).json({ error: targetErr.message });
    if (target && PRIVILEGED_ROLES.includes(target.u_role)) {
      return res.status(403).json({ error: 'Only an Admin can modify this user' });
    }
  }

  const { data, error } = await supabase
    .from('lp_users')
    .update(updates)
    .eq('u_id', req.params.id)
    .select('u_id,u_username,u_name,u_email,u_role,u_active,u_region')
    .single();
  if (error) return res.status(400).json({ error: error.message });
  await logUserAudit(data.u_username, 'PROFILE_UPDATE', `Updated by ${req.user.username}: ${Object.keys(updates).join(', ')}`, req.user.username);
  res.json(data);
});

// ============================================================
// POST /api/users/:id/reset-password
// Admin/Manager only — sets another user's password directly. Combined
// with the same gate now on /auth/change-password, this is the ONLY way
// a password gets changed anywhere in the app.
// ============================================================
router.post('/:id/reset-password', requireRole(ROLES.ADMIN, ROLES.MANAGER), async (req, res) => {
  const { new_password } = req.body;
  const check = isStrongPassword(new_password);
  if (!check.valid) return res.status(400).json({ error: check.error });

  const { data: target, error: findErr } = await supabase
    .from('lp_users')
    .select('u_username, u_role')
    .eq('u_id', req.params.id)
    .single();
  if (findErr || !target) return res.status(404).json({ error: 'User not found' });

  // Manager may reset most passwords, but never an Admin's or Finance
  // user's — those stay Admin-only, matching the role-escalation guard on
  // PATCH /:id above.
  if (req.user?.role !== ROLES.ADMIN && PRIVILEGED_ROLES.includes(target.u_role)) {
    return res.status(403).json({ error: 'Only an Admin can reset this user\u2019s password' });
  }

  const hashed = await bcrypt.hash(new_password, 10);
  const { error } = await supabase
    .from('lp_users')
    .update({
      u_password:           hashed,
      u_reset_token:        null,
      u_reset_token_expiry: null,
      u_reset_used:         false,
      u_password_set_by:    req.user.username,
      u_password_set_at:    new Date().toISOString(),
    })
    .eq('u_id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });

  await logUserAudit(target.u_username, 'PASSWORD_RESET', `Password reset by ${req.user.username}`, req.user.username);
  res.json({ success: true, message: `Password updated for ${target.u_username}` });
});

// ============================================================
// GET /api/users/:id/access
// Returns the user's current effective permission matrix plus the
// derived on/off state of each access group, so the Users page can show
// the simplified group toggles alongside the detailed matrix.
// ============================================================
router.get('/:id/access', requirePermission('USERS', 'view'), async (req, res) => {
  const { data: target, error } = await supabase
    .from('lp_users')
    .select('u_id, u_username, u_role')
    .eq('u_id', req.params.id)
    .single();
  if (error || !target) return res.status(404).json({ error: 'User not found' });

  const effective = await getEffectivePermissions(target.u_role);
  const isCustom = !BUILTIN_ROLES.has(target.u_role);

  let baseRole = target.u_role;
  let hasPersonalRole = false;
  if (isCustom) {
    const { data: customRole } = await supabase
      .from('lp_custom_roles')
      .select('base_role, is_personal')
      .eq('role_key', target.u_role)
      .single();
    if (customRole) {
      baseRole = customRole.base_role || target.u_role;
      hasPersonalRole = !!customRole.is_personal;
    }
  }

  const groups = {};
  for (const [groupKey, group] of Object.entries(ACCESS_GROUPS)) {
    groups[groupKey] = group.modules.every(m => effective[m]?.view === true);
  }

  res.json({
    user_id:           target.u_id,
    username:          target.u_username,
    current_role:      target.u_role,
    base_role:         baseRole,
    is_admin:          target.u_role === ROLES.ADMIN,
    has_personal_role: hasPersonalRole,
    groups,
    permissions:       effective,
  });
});

// ============================================================
// PATCH /api/users/:id/access
// The "individually editable user access" feature. Edits here never
// mutate the underlying Role — the first customization for a user
// clones their current base role into a personal custom role
// (reused on subsequent edits), applies the requested group/module
// changes to that clone, and points the user's u_role at it.
//
// LOCKOUT SAFEGUARD: Admin users can never be individually customized
// here — rejected outright before anything is cloned or touched.
// ============================================================
router.patch('/:id/access', requireRole(ROLES.ADMIN, ROLES.MANAGER), async (req, res) => {
  const { groups, modules } = req.body;
  // groups:  { GROUP_KEY: boolean }            — quick-toggle layer
  // modules: [{ module_key, can_view, can_edit, can_delete, can_approve }] — optional fine-tuning

  const { data: target, error: findErr } = await supabase
    .from('lp_users')
    .select('u_id, u_username, u_role')
    .eq('u_id', req.params.id)
    .single();
  if (findErr || !target) return res.status(404).json({ error: 'User not found' });

  if (target.u_role === ROLES.ADMIN) {
    return res.status(400).json({
      error: 'Admin users cannot have individual access overrides — Admin always retains full access by design.',
    });
  }

  try {
    const roleKey = await getOrCreatePersonalRole(target, req.user.username);

    // Start from the role's current full matrix (built-in defaults + any
    // existing overrides), then layer the requested changes on top — an
    // edit to one group/module should never wipe out others.
    const current = await getEffectivePermissions(roleKey);

    if (groups && typeof groups === 'object') {
      for (const [groupKey, enabled] of Object.entries(groups)) {
        const group = ACCESS_GROUPS[groupKey];
        if (!group) continue;
        for (const moduleKey of group.modules) {
          current[moduleKey] = current[moduleKey] || { view: false, edit: false, delete: false, approve: false };
          current[moduleKey].view = !!enabled;
          // Turning a group off also clears edit/delete/approve on its
          // modules. Turning it on only guarantees view — edit/delete/
          // approve stay as they were, so a toggle never silently hands
          // out more than "can see this section".
          if (!enabled) {
            current[moduleKey].edit = false;
            current[moduleKey].delete = false;
            current[moduleKey].approve = false;
          }
        }
      }
    }

    if (Array.isArray(modules)) {
      for (const m of modules) {
        if (!m?.module_key) continue;
        current[m.module_key] = {
          view:    !!m.can_view,
          edit:    !!m.can_edit,
          delete:  !!m.can_delete,
          approve: !!m.can_approve,
        };
      }
    }

    const rows = Object.entries(current).map(([module_key, p]) => ({
      role_key:    roleKey,
      module_key,
      can_view:    !!p.view,
      can_edit:    !!p.edit,
      can_delete:  !!p.delete,
      can_approve: !!p.approve,
      updated_by:  req.user.username,
      updated_at:  new Date().toISOString(),
    }));

    await supabase.from('lp_role_permissions').delete().eq('role_key', roleKey);
    if (rows.length) {
      const { error: permErr } = await supabase.from('lp_role_permissions').insert(rows);
      if (permErr) throw permErr;
    }

    if (target.u_role !== roleKey) {
      const { error: roleErr } = await supabase
        .from('lp_users')
        .update({ u_role: roleKey })
        .eq('u_id', target.u_id);
      if (roleErr) throw roleErr;
    }

    await logUserAudit(target.u_username, 'ACCESS_CHANGED',
      `Access updated by ${req.user.username} (role: ${roleKey})`, req.user.username);

    res.json({ success: true, role_key: roleKey });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ============================================================
// POST /api/users/:id/revert-role
// Drops a user back onto a plain built-in role, away from any personal
// custom role. The personal role itself is deactivated, not deleted —
// no hard deletion — in case the change needs to be undone.
// ============================================================
router.post('/:id/revert-role', requireRole(ROLES.ADMIN, ROLES.MANAGER), async (req, res) => {
  const { base_role } = req.body;
  if (!BUILTIN_ROLES.has(base_role))
    return res.status(400).json({ error: 'base_role must be a built-in role' });

  const { data: target, error: findErr } = await supabase
    .from('lp_users')
    .select('u_id, u_username, u_role')
    .eq('u_id', req.params.id)
    .single();
  if (findErr || !target) return res.status(404).json({ error: 'User not found' });

  const previousRole = target.u_role;
  const { error } = await supabase
    .from('lp_users')
    .update({ u_role: base_role })
    .eq('u_id', target.u_id);
  if (error) return res.status(400).json({ error: error.message });

  if (!BUILTIN_ROLES.has(previousRole)) {
    await supabase.from('lp_custom_roles').update({ is_active: false }).eq('role_key', previousRole);
  }

  await logUserAudit(target.u_username, 'ROLE_REVERTED',
    `Reverted from ${previousRole} to ${base_role} by ${req.user.username}`, req.user.username);

  res.json({ success: true, role: base_role });
});

module.exports = router;
