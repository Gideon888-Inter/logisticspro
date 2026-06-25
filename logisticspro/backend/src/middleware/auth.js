/**
 * LP2.0 Auth Middleware — single source of truth for roles and permissions.
 */

const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

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

const BUILTIN_ROLES = new Set(Object.values(ROLES));

const CAN_VIEW_LOADS = [
  ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR, ROLES.OPS_ASSISTANT,
  ROLES.CONTROL_ROOM, ROLES.FINANCE,
  ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT,
  ROLES.STOCK_CONTROLLER, ROLES.WORKSHOP,
  ROLES.READONLY,
];
const CAN_CREATE_LOAD            = [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT, ROLES.CONTROL_ROOM];
const CAN_ADVANCE_TO_EN_ROUTE    = [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT, ROLES.CONTROL_ROOM];
const CAN_ADVANCE_TO_OFFLOADED   = [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT, ROLES.CONTROL_ROOM];
const CAN_ADVANCE_PAST_OFFLOADED = [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT];
const CAN_APPROVE_FOR_POD        = [ROLES.ADMIN, ROLES.OPERATOR];
const CAN_APPROVE_INVOICE        = [ROLES.ADMIN, ROLES.FINANCE];
const CAN_REJECT_LOAD            = [ROLES.ADMIN, ROLES.OPERATOR, ROLES.FINANCE];
const CAN_DELETE_LOAD            = [ROLES.ADMIN, ROLES.OPERATOR];
const CAN_APPROVE_KM             = [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT];
const CAN_ADD_COSTS              = [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT, ROLES.CONTROL_ROOM];
const CAN_VIEW_WORKSHOP          = [
  ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR, ROLES.OPS_ASSISTANT,
  ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT, ROLES.STOCK_CONTROLLER, ROLES.WORKSHOP,
];
const CAN_EDIT_WORKSHOP          = [ROLES.ADMIN, ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT, ROLES.WORKSHOP];
const CAN_MANAGE_CLIENTS         = [ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR, ROLES.OPS_ASSISTANT];
const CAN_VIEW_RATES             = [ROLES.ADMIN, ROLES.MANAGER];
const CAN_MANAGE_USERS           = [ROLES.ADMIN, ROLES.MANAGER];
const CAN_VIEW_FLEET             = [ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR, ROLES.OPS_ASSISTANT, ROLES.WORKSHOP_MANAGER];
const CAN_EDIT_FLEET             = [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT];
const CAN_MANAGE_INVOICES        = [ROLES.ADMIN, ROLES.FINANCE];
const CAN_CREATE_CREDIT_NOTE     = [ROLES.ADMIN, ROLES.FINANCE];
const CAN_POST_GL_JOURNALS       = [ROLES.ADMIN, ROLES.FINANCE];
const CAN_CREATE_PO              = [ROLES.ADMIN, ROLES.FINANCE, ROLES.CONTROL_ROOM, ROLES.STOCK_CONTROLLER, ROLES.WORKSHOP_ASSISTANT, ROLES.WORKSHOP_MANAGER];
const CAN_SELECT_INVENTORY_PO    = [ROLES.ADMIN, ROLES.FINANCE, ROLES.WORKSHOP_ASSISTANT, ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP];
const CAN_VIEW_INVENTORY         = [ROLES.ADMIN, ROLES.MANAGER, ROLES.FINANCE, ROLES.OPERATOR, ROLES.OPS_ASSISTANT, ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT, ROLES.STOCK_CONTROLLER, ROLES.WORKSHOP];
const CAN_CREATE_INVENTORY_ITEMS = [ROLES.ADMIN, ROLES.WORKSHOP_MANAGER];
const CAN_APPROVE_INVENTORY_ITEMS= [ROLES.ADMIN, ROLES.WORKSHOP_ASSISTANT];
const CAN_APPROVE_PO_L1          = [ROLES.ADMIN, ROLES.STOCK_CONTROLLER];
const CAN_APPROVE_PO_L2          = [ROLES.ADMIN, ROLES.WORKSHOP_ASSISTANT];
const CAN_APPROVE_PO_L3          = [ROLES.ADMIN, ROLES.WORKSHOP_MANAGER];
const CAN_APPROVE_PO_FINANCIAL   = [ROLES.ADMIN, ROLES.FINANCE];
const CAN_MARK_POD               = [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT];
const CAN_MANAGE_ROLES           = [ROLES.ADMIN];

const BUILTIN_PERMISSION_MAP = {
  LOADS:           { view: CAN_VIEW_LOADS,   edit: CAN_CREATE_LOAD,            delete: CAN_DELETE_LOAD, approve: CAN_APPROVE_FOR_POD },
  PODS:            { view: CAN_VIEW_LOADS,   edit: CAN_MARK_POD,               delete: [], approve: CAN_MARK_POD },
  COSTS:           { view: CAN_VIEW_LOADS,   edit: CAN_ADD_COSTS,              delete: [ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR], approve: [ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR] },
  FLEET:           { view: CAN_VIEW_FLEET,   edit: CAN_EDIT_FLEET,             delete: [ROLES.ADMIN], approve: [] },
  DRIVERS:         { view: CAN_MANAGE_CLIENTS, edit: CAN_MANAGE_CLIENTS,       delete: [ROLES.ADMIN], approve: [] },
  CLIENTS:         { view: CAN_MANAGE_CLIENTS, edit: CAN_MANAGE_CLIENTS,       delete: [ROLES.ADMIN], approve: [] },
  RATES:           { view: CAN_VIEW_RATES,   edit: CAN_VIEW_RATES,             delete: [ROLES.ADMIN], approve: [] },
  WORKSHOP:        { view: CAN_VIEW_WORKSHOP, edit: CAN_EDIT_WORKSHOP,         delete: [ROLES.ADMIN, ROLES.WORKSHOP_MANAGER], approve: CAN_EDIT_WORKSHOP },
  INVENTORY:       { view: CAN_VIEW_INVENTORY, edit: CAN_CREATE_INVENTORY_ITEMS, delete: [ROLES.ADMIN, ROLES.WORKSHOP_MANAGER], approve: CAN_APPROVE_INVENTORY_ITEMS },
  PURCHASE_ORDERS: { view: CAN_VIEW_INVENTORY, edit: CAN_CREATE_PO,            delete: [ROLES.ADMIN], approve: CAN_APPROVE_PO_FINANCIAL },
  INVOICES:        { view: CAN_MANAGE_INVOICES, edit: CAN_MANAGE_INVOICES,     delete: [ROLES.ADMIN], approve: CAN_APPROVE_INVOICE },
  FINANCE:         { view: CAN_MANAGE_INVOICES, edit: CAN_POST_GL_JOURNALS,    delete: [ROLES.ADMIN], approve: CAN_POST_GL_JOURNALS },
  APPROVALS:       { view: [ROLES.ADMIN, ROLES.OPERATOR, ROLES.FINANCE], edit: [ROLES.ADMIN, ROLES.OPERATOR, ROLES.FINANCE], delete: [], approve: [ROLES.ADMIN, ROLES.OPERATOR, ROLES.FINANCE] },
  USERS:           { view: CAN_MANAGE_USERS, edit: CAN_MANAGE_USERS,           delete: [ROLES.ADMIN], approve: CAN_MANAGE_USERS },
  ROLES:           { view: CAN_MANAGE_ROLES, edit: CAN_MANAGE_ROLES,           delete: CAN_MANAGE_ROLES, approve: [] },
  REPORTS:         { view: CAN_VIEW_LOADS,   edit: [ROLES.ADMIN],              delete: [ROLES.ADMIN], approve: [] },
};

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing or invalid token' });
  try {
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token expired or invalid' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

function permissionsForBuiltInRole(role) {
  return Object.fromEntries(
    Object.entries(BUILTIN_PERMISSION_MAP).map(([module, actions]) => [module, {
      view:    actions.view.includes(role),
      edit:    actions.edit.includes(role),
      delete:  (actions.delete || []).includes(role),
      approve: (actions.approve || []).includes(role),
    }])
  );
}

async function loadUserPermissions(req, res, next) {
  const role = req.user?.role;
  if (!role) return res.status(401).json({ error: 'Not authenticated' });

  if (role === ROLES.ADMIN) {
    req.permissions = Object.fromEntries(
      Object.keys(BUILTIN_PERMISSION_MAP).map(m => [m, { view: true, edit: true, delete: true, approve: true }])
    );
    return next();
  }

  if (BUILTIN_ROLES.has(role)) {
    req.permissions = permissionsForBuiltInRole(role);
    try {
      const { data: overrides, error } = await supabase()
        .from('lp_role_permissions')
        .select('module_key, can_view, can_edit, can_delete, can_approve, extra_flags')
        .eq('role_key', role);
      if (!error) {
        for (const p of (overrides || [])) {
          req.permissions[p.module_key] = {
            view:        p.can_view,
            edit:        p.can_edit,
            delete:      p.can_delete,
            approve:     p.can_approve,
            extra_flags: p.extra_flags || {},
          };
        }
      }
    } catch (_) {
      // Keep hardcoded defaults if optional DB overrides cannot be loaded.
    }
    return next();
  }

  try {
    const { data: customRole } = await supabase()
      .from('lp_custom_roles')
      .select('role_key, base_role, is_active')
      .eq('role_key', role)
      .single();

    if (!customRole || !customRole.is_active) {
      return res.status(403).json({ error: 'Role not found or inactive' });
    }

    const basePerms = customRole.base_role && BUILTIN_ROLES.has(customRole.base_role)
      ? permissionsForBuiltInRole(customRole.base_role)
      : {};

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

function requirePermission(module, action = 'view') {
  return (req, res, next) => {
    if (!req.permissions) {
      const role = req.user?.role;
      if (role === ROLES.ADMIN) return next();
      const modulePerms = BUILTIN_PERMISSION_MAP[module];
      if (!modulePerms) return res.status(403).json({ error: `Unknown module: ${module}` });
      const allowed = modulePerms[action] || [];
      if (!allowed.includes(role)) return res.status(403).json({ error: `No ${action} permission on ${module}` });
      return next();
    }
    const modulePerm = req.permissions[module];
    if (!modulePerm?.[action]) return res.status(403).json({ error: `No ${action} permission on ${module}` });
    next();
  };
}

function hasPermission(permissions, module, action = 'view') {
  return permissions?.[module]?.[action] === true;
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
