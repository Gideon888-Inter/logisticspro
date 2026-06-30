/**
 * LP2.0 Auth Middleware — Single source of truth for roles and permissions
 * =========================================================================
 *
 * TWO-TIER PERMISSION SYSTEM
 * ──────────────────────────
 * Tier 1 — Built-in roles (this file, hardcoded):
 *   ADMIN, MANAGER, OPERATOR, OPS_ASSISTANT, CONTROL_ROOM,
 *   FINANCE, WORKSHOP_MANAGER, WORKSHOP_ASSISTANT, STOCK_CONTROLLER,
 *   WORKSHOP, READONLY
 *   → Enforced via requireRole() and CAN_* arrays
 *   → Cannot be deleted or permission-stripped by any user
 *
 * Tier 2 — Custom roles (DB-driven via lp_custom_roles + lp_role_permissions):
 *   → Created by Admin in the Role Manager UI
 *   → Permissions checked at runtime via requirePermission()
 *   → Can optionally inherit a built-in base role
 *   → Additive: custom permissions stack on top of base role
 *
 * MIDDLEWARE FUNCTIONS
 * ────────────────────
 * authMiddleware(req,res,next)               — verify JWT, attach req.user
 * requireRole(...roles)                      — must be one of these role keys
 * requirePermission(module, action)          — checks DB for custom roles;
 *                                             falls through to built-in CAN_* for known roles
 * loadUserPermissions(req,res,next)          — preloads permission map onto req.permissions
 *                                             (call once per request on routes that need it)
 */

const jwt       = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

// Lazy supabase client (avoids circular dependency at startup)
let _supabase = null;
function supabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
    );
  }
  return _supabase;
}

// ─────────────────────────────────────────────────────────────
// ROLE DEFINITIONS
// ─────────────────────────────────────────────────────────────
const ROLES = {
  ADMIN:               'ADMIN',
  MANAGER:             'MANAGER',
  OPERATOR:            'OPERATOR',
  OPS_ASSISTANT:       'OPS_ASSISTANT',
  CONTROL_ROOM:        'CONTROL_ROOM',
  FINANCE:             'FINANCE',
  WORKSHOP_MANAGER:    'WORKSHOP_MANAGER',
  WORKSHOP_ASSISTANT:  'WORKSHOP_ASSISTANT',
  STOCK_CONTROLLER:    'STOCK_CONTROLLER',
  WORKSHOP:            'WORKSHOP',
  READONLY:            'READONLY',
};

// All 11 built-in role keys — anything else is a custom role
const BUILTIN_ROLES = new Set(Object.values(ROLES));

// ─────────────────────────────────────────────────────────────
// BUILT-IN PERMISSION ARRAYS
// Used with requireRole() and as fallback in requirePermission()
// ─────────────────────────────────────────────────────────────

const CAN_VIEW_LOADS = [
  ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR, ROLES.OPS_ASSISTANT,
  ROLES.CONTROL_ROOM, ROLES.FINANCE,
  ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT,
  ROLES.STOCK_CONTROLLER, ROLES.WORKSHOP,
  ROLES.READONLY, // READONLY role exists solely to view loads
];
const CAN_CREATE_LOAD           = [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT, ROLES.CONTROL_ROOM];
const CAN_ADVANCE_TO_EN_ROUTE   = [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT, ROLES.CONTROL_ROOM];
const CAN_ADVANCE_TO_OFFLOADED  = [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT, ROLES.CONTROL_ROOM];
const CAN_ADVANCE_PAST_OFFLOADED= [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT];
const CAN_APPROVE_FOR_POD       = [ROLES.ADMIN, ROLES.OPERATOR];
const CAN_APPROVE_INVOICE       = [ROLES.ADMIN, ROLES.FINANCE];
const CAN_REJECT_LOAD           = [ROLES.ADMIN, ROLES.OPERATOR, ROLES.FINANCE];
const CAN_DELETE_LOAD           = [ROLES.ADMIN, ROLES.OPERATOR];
const CAN_APPROVE_KM            = [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT];
const CAN_ADD_COSTS             = [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT, ROLES.CONTROL_ROOM];
const CAN_VIEW_WORKSHOP         = [
  ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR, ROLES.OPS_ASSISTANT,
  ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT, ROLES.STOCK_CONTROLLER, ROLES.WORKSHOP,
];
const CAN_EDIT_WORKSHOP         = [ROLES.ADMIN, ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT, ROLES.WORKSHOP];
const CAN_MANAGE_CLIENTS        = [ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR, ROLES.OPS_ASSISTANT];
const CAN_VIEW_RATES            = [ROLES.ADMIN, ROLES.MANAGER];
const CAN_MANAGE_USERS          = [ROLES.ADMIN, ROLES.MANAGER];
const CAN_VIEW_FLEET            = [ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR, ROLES.OPS_ASSISTANT, ROLES.WORKSHOP_MANAGER];
const CAN_EDIT_FLEET            = [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT];
const CAN_MANAGE_INVOICES       = [ROLES.ADMIN, ROLES.FINANCE];
const CAN_CREATE_CREDIT_NOTE    = [ROLES.ADMIN, ROLES.FINANCE];
const CAN_POST_GL_JOURNALS      = [ROLES.ADMIN, ROLES.FINANCE];
const CAN_CREATE_PO             = [ROLES.ADMIN, ROLES.FINANCE, ROLES.CONTROL_ROOM, ROLES.STOCK_CONTROLLER, ROLES.WORKSHOP_ASSISTANT, ROLES.WORKSHOP_MANAGER];
const CAN_SELECT_INVENTORY_PO   = [ROLES.ADMIN, ROLES.FINANCE, ROLES.WORKSHOP_ASSISTANT, ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP];
const CAN_VIEW_INVENTORY        = [ROLES.ADMIN, ROLES.MANAGER, ROLES.FINANCE, ROLES.OPERATOR, ROLES.OPS_ASSISTANT, ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT, ROLES.STOCK_CONTROLLER, ROLES.WORKSHOP];
const CAN_CREATE_INVENTORY_ITEMS= [ROLES.ADMIN, ROLES.WORKSHOP_MANAGER];
const CAN_APPROVE_INVENTORY_ITEMS=[ROLES.ADMIN, ROLES.WORKSHOP_ASSISTANT];
const CAN_APPROVE_PO_L1         = [ROLES.ADMIN, ROLES.STOCK_CONTROLLER];
const CAN_APPROVE_PO_L2         = [ROLES.ADMIN, ROLES.WORKSHOP_ASSISTANT];
const CAN_APPROVE_PO_L3         = [ROLES.ADMIN, ROLES.WORKSHOP_MANAGER];
const CAN_APPROVE_PO_FINANCIAL  = [ROLES.ADMIN, ROLES.FINANCE];
const CAN_MARK_POD              = [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT];
const CAN_MANAGE_ROLES          = [ROLES.ADMIN];

// Built-in permission map for requirePermission() fallback
// module → action → roles[]
const BUILTIN_PERMISSION_MAP = {
  LOADS:           { view: CAN_VIEW_LOADS,   edit: [...CAN_CREATE_LOAD],        delete: CAN_DELETE_LOAD, approve: CAN_APPROVE_FOR_POD },
  PODS:            { view: CAN_VIEW_LOADS,   edit: CAN_MARK_POD,               delete: [], approve: CAN_MARK_POD },
  COSTS:           { view: CAN_VIEW_LOADS,   edit: CAN_ADD_COSTS,              delete: [ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR], approve: [ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR] },
  // FLEET.edit = operational fleet actions (assignments, KM, etc). FLEET.approve
  // is reused here for vehicle MASTER RECORD management (create/edit vehicle in
  // the register) — a separate, stricter concern, matching vehicles.js.
  FLEET:           { view: CAN_VIEW_FLEET,   edit: CAN_EDIT_FLEET,             delete: [ROLES.ADMIN], approve: [ROLES.ADMIN, ROLES.MANAGER] },
  DRIVERS:         { view: CAN_MANAGE_CLIENTS, edit: [ROLES.ADMIN, ROLES.MANAGER], delete: [ROLES.ADMIN], approve: [] },
  CLIENTS:         { view: CAN_MANAGE_CLIENTS, edit: [ROLES.ADMIN, ROLES.MANAGER], delete: [ROLES.ADMIN], approve: [] },
  ROUTES:          { view: CAN_VIEW_LOADS,     edit: [ROLES.ADMIN, ROLES.MANAGER], delete: [ROLES.ADMIN], approve: [] },
  RATES:           { view: CAN_VIEW_RATES,   edit: CAN_VIEW_RATES,             delete: [ROLES.ADMIN, ROLES.MANAGER], approve: [] },
  WORKSHOP:        { view: CAN_VIEW_WORKSHOP, edit: CAN_EDIT_WORKSHOP,         delete: [ROLES.ADMIN, ROLES.WORKSHOP_MANAGER], approve: CAN_EDIT_WORKSHOP },
  INVENTORY:       { view: CAN_VIEW_INVENTORY, edit: CAN_CREATE_INVENTORY_ITEMS, delete: [ROLES.ADMIN, ROLES.WORKSHOP_MANAGER], approve: CAN_APPROVE_INVENTORY_ITEMS },
  PURCHASE_ORDERS: { view: CAN_VIEW_INVENTORY, edit: CAN_CREATE_PO,           delete: [ROLES.ADMIN], approve: CAN_APPROVE_PO_FINANCIAL },
  INVOICES:        { view: CAN_MANAGE_INVOICES, edit: CAN_MANAGE_INVOICES,     delete: [ROLES.ADMIN], approve: CAN_APPROVE_INVOICE },
  FINANCE:         { view: CAN_MANAGE_INVOICES, edit: CAN_POST_GL_JOURNALS,    delete: [ROLES.ADMIN], approve: CAN_POST_GL_JOURNALS },
  APPROVALS:       { view: [ROLES.ADMIN, ROLES.OPERATOR, ROLES.FINANCE], edit: [ROLES.ADMIN, ROLES.OPERATOR, ROLES.FINANCE], delete: [], approve: [ROLES.ADMIN, ROLES.OPERATOR, ROLES.FINANCE] },
  USERS:           { view: CAN_MANAGE_USERS, edit: [ROLES.ADMIN],             delete: [ROLES.ADMIN], approve: CAN_MANAGE_USERS },
  ROLES:           { view: CAN_MANAGE_ROLES, edit: CAN_MANAGE_ROLES,          delete: CAN_MANAGE_ROLES, approve: [] },
  REPORTS:         { view: CAN_VIEW_LOADS,   edit: [ROLES.ADMIN],             delete: [ROLES.ADMIN], approve: [] },
  KM:              { view: CAN_VIEW_LOADS,   edit: CAN_APPROVE_KM,             delete: [ROLES.ADMIN], approve: [...CAN_APPROVE_KM, ROLES.MANAGER] },
  // Admin-only by default — exposes raw Pulsit API responses, not something
  // any role should see day-to-day. Kept as a normal DB-driven permission
  // (rather than a hardcoded role check) so it can be granted to another
  // role later purely via User Roles, with no code/deploy needed.
  TRACKING_DEBUG:  { view: [ROLES.ADMIN],    edit: [ROLES.ADMIN],              delete: [], approve: [] },
  // Reserved for Director-tier dashboard sections (cross-department KPIs)
  // — Home itself has no permission gate today, so this doesn't restrict
  // anything yet. It exists so the "Director" access-group toggle has a
  // real flag to set, ready for Dashboard.jsx to check once that's built.
  DASHBOARD:       { view: [ROLES.ADMIN, ROLES.MANAGER], edit: [ROLES.ADMIN], delete: [], approve: [] },
};

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────────────────────

/** Verify JWT and attach decoded payload to req.user */
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Missing or invalid token' });
  try {
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token expired or invalid' });
  }
}

/**
 * requireRole(...roleKeys)
 * Hard gate on built-in role membership. Fast — no DB query.
 * Use for routes where only specific built-in roles should ever get in.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role))
      return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

/**
 * loadUserPermissions(req, res, next)
 * Preloads a permission map onto req.permissions for the current user.
 * For built-in roles: uses BUILTIN_PERMISSION_MAP.
 * For custom roles: fetches from lp_role_permissions, merging base role if set.
 *
 * req.permissions = { MODULE: { view, edit, delete, approve, extra_flags } }
 *
 * Call this middleware ONCE on any route group that uses requirePermission().
 * Do not call on every individual route — call on the router level.
 */
async function loadUserPermissions(req, res, next) {
  const role = req.user?.role;
  if (!role) return res.status(401).json({ error: 'Not authenticated' });

  // ADMIN always gets everything — no DB query needed
  if (role === ROLES.ADMIN) {
    req.permissions = Object.fromEntries(
      Object.keys(BUILTIN_PERMISSION_MAP).map(m => [m, { view: true, edit: true, delete: true, approve: true }])
    );
    return next();
  }

  // Built-in roles: start from hardcoded map, then apply any DB overrides set by Admin
  if (BUILTIN_ROLES.has(role)) {
    // Start with hardcoded defaults
    req.permissions = {};
    for (const [module, actions] of Object.entries(BUILTIN_PERMISSION_MAP)) {
      req.permissions[module] = {
        view:    actions.view.includes(role),
        edit:    actions.edit.includes(role),
        delete:  (actions.delete || []).includes(role),
        approve: (actions.approve || []).includes(role),
      };
    }
    // Apply any Admin overrides stored in lp_role_permissions
    try {
      const { data: overrides } = await supabase()
        .from('lp_role_permissions')
        .select('module_key, can_view, can_edit, can_delete, can_approve, extra_flags')
        .eq('role_key', role);
      for (const p of (overrides || [])) {
        req.permissions[p.module_key] = {
          view:        p.can_view,
          edit:        p.can_edit,
          delete:      p.can_delete,
          approve:     p.can_approve,
          extra_flags: p.extra_flags || {},
        };
      }
    } catch (_) {
      // If DB check fails, hardcoded defaults remain — safe fallback
    }
    return next();
  }

  // Custom role: fetch from DB
  try {
    // Get custom role record (may have a base_role)
    const { data: customRole } = await supabase()
      .from('lp_custom_roles')
      .select('role_key, base_role, is_active')
      .eq('role_key', role)
      .single();

    if (!customRole || !customRole.is_active)
      return res.status(403).json({ error: 'Role not found or inactive' });

    // Start with base role permissions if set
    const basePerms = {};
    if (customRole.base_role && BUILTIN_ROLES.has(customRole.base_role)) {
      for (const [module, actions] of Object.entries(BUILTIN_PERMISSION_MAP)) {
        basePerms[module] = {
          view:    actions.view.includes(customRole.base_role),
          edit:    actions.edit.includes(customRole.base_role),
          delete:  (actions.delete || []).includes(customRole.base_role),
          approve: (actions.approve || []).includes(customRole.base_role),
        };
      }
    }

    // Fetch custom permissions (additive)
    const { data: perms } = await supabase()
      .from('lp_role_permissions')
      .select('module_key, can_view, can_edit, can_delete, can_approve, extra_flags')
      .eq('role_key', role);

    req.permissions = { ...basePerms };
    for (const p of (perms || [])) {
      req.permissions[p.module_key] = {
        view:        (basePerms[p.module_key]?.view    || false) || p.can_view,
        edit:        (basePerms[p.module_key]?.edit    || false) || p.can_edit,
        delete:      (basePerms[p.module_key]?.delete  || false) || p.can_delete,
        approve:     (basePerms[p.module_key]?.approve || false) || p.can_approve,
        extra_flags: p.extra_flags || {},
      };
    }
    next();
  } catch (e) {
    console.error('loadUserPermissions error:', e);
    res.status(500).json({ error: 'Permission check failed' });
  }
}

/**
 * requirePermission(module, action)
 * Checks req.permissions (populated by loadUserPermissions).
 * action: 'view' | 'edit' | 'delete' | 'approve'
 *
 * Always call loadUserPermissions before requirePermission on the same route.
 */
function requirePermission(module, action = 'view') {
  return (req, res, next) => {
    if (!req.permissions) {
      // Fallback: check built-in map directly (slower but safe)
      const role = req.user?.role;
      if (role === ROLES.ADMIN) return next();
      const modulePerms = BUILTIN_PERMISSION_MAP[module];
      if (!modulePerms) return res.status(403).json({ error: `Unknown module: ${module}` });
      const allowed = modulePerms[action] || [];
      if (!allowed.includes(role))
        return res.status(403).json({ error: `No ${action} permission on ${module}` });
      return next();
    }
    const modulePerm = req.permissions[module];
    if (!modulePerm?.[action])
      return res.status(403).json({ error: `No ${action} permission on ${module}` });
    next();
  };
}

/**
 * hasPermission(permissions, module, action)
 * Synchronous helper for inline checks inside route handlers.
 * e.g. if (!hasPermission(req.permissions, 'RATES', 'view')) return ...
 */
function hasPermission(permissions, module, action = 'view') {
  return permissions?.[module]?.[action] === true;
}

// ─────────────────────────────────────────────────────────────
// ACCESS GROUPS — simplified quick-toggle layer
// ─────────────────────────────────────────────────────────────
// Sits ALONGSIDE the detailed module permission matrix above, not instead
// of it. Each group bundles the modules behind one section of the app, so
// a user's card can show 7 simple on/off switches (Basic, Operational,
// Fleet, Workshop, Finance, Management, Director) instead of the full
// per-module view/edit/delete/approve grid. Toggling a group on grants
// `view` (and, where it makes operational sense, `edit`) on every module
// in it; toggling off removes them. The detailed matrix is still there
// underneath for anyone who needs to fine-tune beyond what a group
// toggle gives them — see PATCH /users/:id/access.
const ACCESS_GROUPS = {
  BASIC:       { label: 'Basic',       modules: ['APPROVALS'] },
  OPERATIONAL: { label: 'Operational', modules: ['LOADS', 'PODS', 'COSTS', 'KM'] },
  FLEET:       { label: 'Fleet',       modules: ['FLEET'] },
  WORKSHOP:    { label: 'Workshop',    modules: ['WORKSHOP', 'INVENTORY', 'PURCHASE_ORDERS'] },
  FINANCE:     { label: 'Finance',     modules: ['FINANCE', 'INVOICES'] },
  MANAGEMENT:  { label: 'Management',  modules: ['DRIVERS', 'CLIENTS', 'USERS', 'RATES'] },
  // "Director" doesn't map to a restricted module today — Home/Dashboard
  // has no permission gate (every logged-in user can already see it).
  // This flag is reserved for the dashboard surfacing extra cross-
  // department KPIs to Director-tier users later, without requiring a
  // schema change when that's built — see Dashboard.jsx for where to
  // hook it in when that's ready.
  DIRECTOR:    { label: 'Director',    modules: ['DASHBOARD'] },
};

// ─────────────────────────────────────────────────────────────
// PASSWORD POLICY
// ─────────────────────────────────────────────────────────────
// Shared by /auth/change-password, /auth/register, and
// /users/:id/reset-password so the rule lives in exactly one place.
function isStrongPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10)
    return { valid: false, error: 'Password must be at least 10 characters' };
  if (!/[A-Z]/.test(pw))
    return { valid: false, error: 'Password must include at least one uppercase letter' };
  if (!/[a-z]/.test(pw))
    return { valid: false, error: 'Password must include at least one lowercase letter' };
  if (!/[0-9]/.test(pw))
    return { valid: false, error: 'Password must include at least one number' };
  if (!/[^A-Za-z0-9]/.test(pw))
    return { valid: false, error: 'Password must include at least one special character' };
  return { valid: true };
}

module.exports = {
  authMiddleware,
  requireRole,
  loadUserPermissions,
  requirePermission,
  hasPermission,
  ROLES,
  BUILTIN_ROLES,
  BUILTIN_PERMISSION_MAP,
  ACCESS_GROUPS,
  isStrongPassword,
  // Load / ops arrays (for backward compat with existing routes)
  CAN_VIEW_LOADS,
  CAN_CREATE_LOAD,
  CAN_ADVANCE_TO_EN_ROUTE,
  CAN_ADVANCE_TO_OFFLOADED,
  CAN_ADVANCE_PAST_OFFLOADED,
  CAN_APPROVE_FOR_POD,
  CAN_APPROVE_INVOICE,
  CAN_REJECT_LOAD,
  CAN_DELETE_LOAD,
  CAN_APPROVE_KM,
  CAN_ADD_COSTS,
  CAN_VIEW_WORKSHOP,
  CAN_EDIT_WORKSHOP,
  CAN_MANAGE_CLIENTS,
  CAN_VIEW_RATES,
  CAN_MANAGE_USERS,
  CAN_VIEW_FLEET,
  CAN_EDIT_FLEET,
  CAN_MANAGE_INVOICES,
  CAN_CREATE_CREDIT_NOTE,
  CAN_POST_GL_JOURNALS,
  CAN_CREATE_PO,
  CAN_SELECT_INVENTORY_PO,
  CAN_VIEW_INVENTORY,
  CAN_CREATE_INVENTORY_ITEMS,
  CAN_APPROVE_INVENTORY_ITEMS,
  CAN_APPROVE_PO_L1,
  CAN_APPROVE_PO_L2,
  CAN_APPROVE_PO_L3,
  CAN_APPROVE_PO_FINANCIAL,
  CAN_MARK_POD,
  CAN_MANAGE_ROLES,
};

