// ── Single source of truth for role permissions on the frontend ──
// Mirror of backend/src/middleware/auth.js — keep in sync.
//
// ROLE HIERARCHY:
//
//   ADMIN             Everything — operational + financial + GL + capital POs
//   MANAGER           Management visibility + rate/user/client control; NO finance/invoice access
//   FINANCE           Financial module only — invoices, AP/AR, GL journals, PO financial approval
//                     Cannot create/edit loads, fleet records, or drivers
//   OPERATOR          Full load management, fleet, drivers, clients; no rates/users
//   OPS_ASSISTANT     Same as Operator (ops side) but changes queue for Operator approval
//   CONTROL_ROOM      Create loads, advance to OFFLOADED only; no inventory
//   WORKSHOP_MANAGER  L3 PO approver, creates inventory items, full workshop/service card access
//   WORKSHOP_ASSISTANT L2 PO approver, approves new inventory items, workshop/service cards
//   STOCK_CONTROLLER  L1 PO approver, manages stock; cannot create INVENTORY type POs
//   WORKSHOP          General workshop staff — view loads, service cards, no approval duties
//   READONLY          View only

export const ROLES = {
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

// ── DB-driven permission check ──────────────────────────────────
// The backend (auth.js loadUserPermissions) computes this same map for both
// built-in and custom roles and returns it on /auth/login and /auth/me as
// user.permissions = { MODULE: { view, edit, delete, approve } }.
// When present, this is authoritative — it's what makes custom roles actually
// work on the frontend instead of being silently blocked by a hardcoded list.
// Falls back to `null` (caller decides what to do) if permissions haven't
// loaded yet, which built-in-role hardcoded checks below still cover safely.
export function hasPermission(user, moduleName, action = 'view') {
  if (!user?.permissions) return null;
  return user.permissions[moduleName]?.[action] === true;
}

// ── Display labels ────────────────────────────────────────────
export const ROLE_LABELS = {
  ADMIN:               'Admin',
  MANAGER:             'Manager',
  OPERATOR:            'Operator',
  OPS_ASSISTANT:       'Ops Assistant',
  CONTROL_ROOM:        'Control Room',
  FINANCE:             'Finance',
  WORKSHOP_MANAGER:    'Workshop Manager',
  WORKSHOP_ASSISTANT:  'Workshop Assistant',
  STOCK_CONTROLLER:    'Stock Controller',
  WORKSHOP:            'Workshop',
  READONLY:            'Read Only',
};

// ── Badge colour classes (match your CSS badge-* classes) ─────
export const ROLE_BADGE_COLORS = {
  ADMIN:               'badge-red',
  MANAGER:             'badge-amber',
  OPERATOR:            'badge-blue',
  OPS_ASSISTANT:       'badge-blue',
  CONTROL_ROOM:        'badge-gray',
  FINANCE:             'badge-green',
  WORKSHOP_MANAGER:    'badge-purple',
  WORKSHOP_ASSISTANT:  'badge-purple',
  STOCK_CONTROLLER:    'badge-purple',
  WORKSHOP:            'badge-gray',
  READONLY:            'badge-gray',
};

// ── Role grouping (for Users page display) ────────────────────
// Lets the UI show Workshop branch as a collapsible group.
export const ROLE_GROUPS = {
  'Operational': ['ADMIN', 'MANAGER', 'OPERATOR', 'OPS_ASSISTANT', 'CONTROL_ROOM'],
  'Finance':     ['FINANCE'],
  'Workshop':    ['WORKSHOP_MANAGER', 'WORKSHOP_ASSISTANT', 'STOCK_CONTROLLER', 'WORKSHOP'],
  'Other':       ['READONLY'],
};

// ─────────────────────────────────────────────────────────────────────────────
// LOADS — who can do what
// ─────────────────────────────────────────────────────────────────────────────

export function canViewLoads(user) {
  const perm = hasPermission(user, 'LOADS', 'view');
  if (perm !== null) return perm;
  return [
    ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR, ROLES.OPS_ASSISTANT,
    ROLES.CONTROL_ROOM, ROLES.FINANCE,
    ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT,
    ROLES.STOCK_CONTROLLER, ROLES.WORKSHOP,
    ROLES.READONLY, // READONLY role exists solely to view loads — must be included here
  ].includes(user?.role);
}

// Finance and all Workshop roles cannot create load cards
export function canCreateLoad(user) {
  const perm = hasPermission(user, 'LOADS', 'edit');
  if (perm !== null) return perm;
  return [
    ROLES.ADMIN, ROLES.OPERATOR,
    ROLES.OPS_ASSISTANT, ROLES.CONTROL_ROOM,
  ].includes(user?.role);
}

// Edit load fields (rate, customer, route, truck, driver)
// Finance explicitly cannot edit load operational fields
export function canEditLoad(user) {
  return [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT].includes(user?.role);
}

export function canDeleteLoad(user) {
  const perm = hasPermission(user, 'LOADS', 'delete');
  if (perm !== null) return perm;
  return [ROLES.OPERATOR, ROLES.ADMIN].includes(user?.role);
}

// Finance replaces old ACCOUNTING for load rejection
export function canRejectLoad(user) {
  return [ROLES.ADMIN, ROLES.OPERATOR, ROLES.FINANCE].includes(user?.role);
}

export function canAdvanceStatus(user, currentStatus, newStatus) {
  const role = user?.role;

  // Workshop branch and Read Only — never
  if ([
    ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT,
    ROLES.STOCK_CONTROLLER, ROLES.WORKSHOP,
    ROLES.READONLY, ROLES.MANAGER,
  ].includes(role)) return false;

  // Finance — invoice flow only, never manual status change
  if (role === ROLES.FINANCE) return false;

  // Control Room — up to OFFLOADED only, cannot reject
  if (role === ROLES.CONTROL_ROOM) {
    if (newStatus === 'REJECTED') return false;
    return ['EN_ROUTE', 'OFFLOADED'].includes(newStatus);
  }

  // Ops Assistant — queue the change for Operator approval
  if (role === ROLES.OPS_ASSISTANT) return true;

  // Operator / Admin — full control
  return [ROLES.OPERATOR, ROLES.ADMIN].includes(role);
}

export function isOpsAssistant(user) {
  return user?.role === ROLES.OPS_ASSISTANT;
}

// Status machine next-step map
export const STATUS_NEXT = {
  PRELOAD:          'EN_ROUTE',
  EN_ROUTE:         'OFFLOADED',
  OFFLOADED:        'WAIT_ORDER_NO',
  WAIT_ORDER_NO:    'WAIT_POD_SCAN',
  WAIT_POD_SCAN:    'WAIT_APPROVAL',
  WAIT_APPROVAL:    'WAIT_RATE_CHECK',
  WAIT_RATE_CHECK:  'WAIT_INVOICE_NO',
  WAIT_INVOICE_NO:  'LOAD_INVOICED',
};

export const STATUS_LABELS = {
  PRELOAD:               'Pre-load',
  EN_ROUTE:              'En Route',
  OFFLOADED:             'Offloaded',
  WAIT_ORDER_NO:         'Awaiting PO Number',
  WAIT_POD_SCAN:         'Awaiting POD Upload',
  WAIT_APPROVAL:         'POD Review — Operator',
  WAIT_RATE_CHECK:       'Rate Check — Admin',
  WAIT_INVOICE_NO:       'Awaiting Invoice No.',
  LOAD_INVOICED:         'Invoiced',
  REJECTED:              'Rejected',
  DELETED:               'Deleted',
  PENDING_KM_APPROVAL:   'Pending KM Approval',
  KM_CORRECTION_NEEDED:  'KM Correction Needed',
};

// ─────────────────────────────────────────────────────────────────────────────
// FLEET
// ─────────────────────────────────────────────────────────────────────────────

// Workshop Manager can view fleet (needs to see asset details for POs)
export function canViewFleet(user) {
  const perm = hasPermission(user, 'FLEET', 'view');
  if (perm !== null) return perm;
  return [
    ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR,
    ROLES.OPS_ASSISTANT, ROLES.WORKSHOP_MANAGER,
  ].includes(user?.role);
}

// Admin-only by default — see middleware/auth.js TRACKING_DEBUG. DB-driven
// so it follows the same User Roles override path as every other module
// instead of being a hardcoded role check baked into the component.
export function canDebugTracking(user) {
  const perm = hasPermission(user, 'TRACKING_DEBUG', 'view');
  if (perm !== null) return perm;
  return user?.role === ROLES.ADMIN;
}

// Finance cannot edit fleet records
export function canEditFleet(user) {
  const perm = hasPermission(user, 'FLEET', 'edit');
  if (perm !== null) return perm;
  return [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT].includes(user?.role);
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKSHOP / SERVICE CARDS
// ─────────────────────────────────────────────────────────────────────────────

export function canViewWorkshop(user) {
  const perm = hasPermission(user, 'WORKSHOP', 'view');
  if (perm !== null) return perm;
  return [
    ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR, ROLES.OPS_ASSISTANT,
    ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT,
    ROLES.STOCK_CONTROLLER, ROLES.WORKSHOP,
  ].includes(user?.role);
}

export function canEditWorkshop(user) {
  const perm = hasPermission(user, 'WORKSHOP', 'edit');
  if (perm !== null) return perm;
  return [
    ROLES.ADMIN,
    ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT, ROLES.WORKSHOP,
  ].includes(user?.role);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENTS / RATES / DRIVERS / USERS
// ─────────────────────────────────────────────────────────────────────────────

export function canViewRates(user) {
  const perm = hasPermission(user, 'RATES', 'view');
  if (perm !== null) return perm;
  return [ROLES.ADMIN, ROLES.MANAGER].includes(user?.role);
}

export function canManageClients(user) {
  return [ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR, ROLES.OPS_ASSISTANT].includes(user?.role);
}

export function canManageDrivers(user) {
  return [ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR, ROLES.OPS_ASSISTANT].includes(user?.role);
}

export function canManageUsers(user) {
  const perm = hasPermission(user, 'USERS', 'view');
  if (perm !== null) return perm;
  return [ROLES.ADMIN, ROLES.MANAGER].includes(user?.role);
}

// ─────────────────────────────────────────────────────────────────────────────
// FINANCE — invoices, AP, AR, GL journals
// ─────────────────────────────────────────────────────────────────────────────

// Finance replaces ACCOUNTING everywhere in the invoice/approval flow
export function canManageInvoices(user) {
  const perm = hasPermission(user, 'INVOICES', 'view');
  if (perm !== null) return perm;
  return [ROLES.ADMIN, ROLES.FINANCE].includes(user?.role);
}

export function canCreateCreditNote(user) {
  const perm = hasPermission(user, 'INVOICES', 'edit');
  if (perm !== null) return perm;
  return [ROLES.ADMIN, ROLES.FINANCE].includes(user?.role);
}

export function canViewApprovals(user) {
  return [ROLES.ADMIN, ROLES.OPERATOR, ROLES.FINANCE].includes(user?.role);
}

// GL journal posting — Admin and Finance only. No other role.
export function canPostGLJournals(user) {
  const perm = hasPermission(user, 'FINANCE', 'edit');
  if (perm !== null) return perm;
  return [ROLES.ADMIN, ROLES.FINANCE].includes(user?.role);
}

// View the Finance / Accounting module at all
export function canViewFinance(user) {
  const perm = hasPermission(user, 'FINANCE', 'view');
  if (perm !== null) return perm;
  return [ROLES.ADMIN, ROLES.FINANCE].includes(user?.role);
}

// ─────────────────────────────────────────────────────────────────────────────
// COSTS on loads
// ─────────────────────────────────────────────────────────────────────────────

export function canAddCosts(user) {
  const perm = hasPermission(user, 'COSTS', 'edit');
  if (perm !== null) return perm;
  return [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT, ROLES.CONTROL_ROOM].includes(user?.role);
}

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY
// ─────────────────────────────────────────────────────────────────────────────

// Control Room cannot see inventory at all
export function canViewInventory(user) {
  return [
    ROLES.ADMIN, ROLES.MANAGER, ROLES.FINANCE,
    ROLES.OPERATOR, ROLES.OPS_ASSISTANT,
    ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT,
    ROLES.STOCK_CONTROLLER, ROLES.WORKSHOP,
  ].includes(user?.role);
}

// Only Workshop Manager (and Admin) can submit new items for approval
export function canCreateInventoryItems(user) {
  return [ROLES.ADMIN, ROLES.WORKSHOP_MANAGER].includes(user?.role);
}

// Workshop Assistant (and Admin) approves/rejects pending inventory items
export function canApproveInventoryItems(user) {
  return [ROLES.ADMIN, ROLES.WORKSHOP_ASSISTANT].includes(user?.role);
}

// Stock level adjustments (manual stock counts)
export function canAdjustInventory(user) {
  return [
    ROLES.ADMIN, ROLES.FINANCE,
    ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT, ROLES.STOCK_CONTROLLER,
  ].includes(user?.role);
}

// ─────────────────────────────────────────────────────────────────────────────
// PURCHASE ORDERS
// ─────────────────────────────────────────────────────────────────────────────

export function canCreatePO(user) {
  return [
    ROLES.ADMIN, ROLES.FINANCE,
    ROLES.CONTROL_ROOM,
    ROLES.STOCK_CONTROLLER,
    ROLES.WORKSHOP_ASSISTANT,
    ROLES.WORKSHOP_MANAGER,
  ].includes(user?.role);
}

export function canViewPOs(user) {
  return [
    ROLES.ADMIN, ROLES.MANAGER, ROLES.FINANCE,
    ROLES.OPERATOR, ROLES.OPS_ASSISTANT,
    ROLES.CONTROL_ROOM,
    ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT,
    ROLES.STOCK_CONTROLLER, ROLES.WORKSHOP,
  ].includes(user?.role);
}

// Control Room and Stock Controller cannot select INVENTORY type
export function canSelectInventoryOnPO(user) {
  return [
    ROLES.ADMIN, ROLES.FINANCE,
    ROLES.WORKSHOP_ASSISTANT,
    ROLES.WORKSHOP_MANAGER,
    ROLES.WORKSHOP,
  ].includes(user?.role);
}

/**
 * Returns the list of PO statuses this user can approve.
 *
 * PO Approval hierarchy (lowest to highest):
 *   L1: STOCK_CONTROLLER    (approves PENDING_L1 — created by Control Room)
 *   L2: WORKSHOP_ASSISTANT  (approves PENDING_L2)
 *   L3: WORKSHOP_MANAGER    (approves PENDING_L3)
 *   L4: FINANCE or ADMIN    (approves PENDING_FINANCIAL)
 *
 * Note: A role's APPROVAL duty (above) is separate from where their own created
 * POs START in the chain (see firstApprovalStatus below).
 * Stock Controller approves L1 POs, but Stock Controller's own POs start at L2
 * because they are already at or above L1 in the hierarchy.
 */
export function myPOApprovalStatuses(user) {
  // DB-driven (lp_po_approval_tiers, returned as user.po_approval_tier by
  // /auth/login and /auth/me) — works for custom roles, not just the 11
  // built-in ones. Falls back to the hardcoded map only if a session
  // predates this field (shouldn't happen after a fresh login).
  if (user?.po_approval_tier !== undefined) {
    const stages = ['PENDING_L1', 'PENDING_L2', 'PENDING_L3'];
    return stages.slice(0, Math.min(user.po_approval_tier, 3));
  }
  const map = {
    [ROLES.STOCK_CONTROLLER]:   ['PENDING_L1'],
    [ROLES.WORKSHOP_ASSISTANT]: ['PENDING_L1', 'PENDING_L2'],
    [ROLES.WORKSHOP_MANAGER]:   ['PENDING_L1', 'PENDING_L2', 'PENDING_L3'],
    [ROLES.FINANCE]:            ['PENDING_L1', 'PENDING_L2', 'PENDING_L3'],
    [ROLES.ADMIN]:              ['PENDING_L1', 'PENDING_L2', 'PENDING_L3'],
  };
  return map[user?.role] || [];
}

export function hasPOApprovalDuties(user) {
  return myPOApprovalStatuses(user).length > 0;
}

/**
 * First approval status when a PO is submitted, based on who created it.
 * Mirrors getPOApprovalTier()/firstApprovalStatus() in the backend
 * routes/inventory.js — same tier table, same formula.
 * Accepts either the full user object (preferred — uses DB tier) or a bare
 * role-key string for backward compatibility with older call sites.
 */
export function firstApprovalStatus(userOrRole) {
  if (userOrRole && typeof userOrRole === 'object' && userOrRole.po_approval_tier !== undefined) {
    const stageOrder = ['PENDING_L1', 'PENDING_L2', 'PENDING_L3', 'PENDING_FINANCIAL'];
    return stageOrder[Math.min(userOrRole.po_approval_tier, 3)];
  }
  const creatorRole = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  if (creatorRole === ROLES.WORKSHOP_MANAGER) return 'PENDING_FINANCIAL';
  if (creatorRole === ROLES.WORKSHOP_ASSISTANT) return 'PENDING_L3';
  if (creatorRole === ROLES.STOCK_CONTROLLER) return 'PENDING_L2';
  // Control Room starts at L1
  return 'PENDING_L1';
}

/**
 * Capital purchase option — locked by default.
 * Admin enables via lp_config 'po_capital_enabled'.
 * can_use_capital_po is DB-driven (lp_po_approval_tiers) when present.
 */
export function canUseCapitalPO(user, capitalEnabled = false) {
  if (!capitalEnabled) return false;
  if (user?.can_use_capital_po !== undefined) return user.can_use_capital_po;
  return [ROLES.ADMIN, ROLES.WORKSHOP_MANAGER].includes(user?.role);
}

export const PO_STATUS_LABELS = {
  PARKED:             'Parked',
  PENDING_L1:         'Awaiting Stock Controller',
  PENDING_L2:         'Awaiting Workshop Asst',
  PENDING_L3:         'Awaiting Workshop Manager',
  PENDING_FINANCIAL:  'Awaiting Finance Approval',
  APPROVED:           'Approved',
  GOODS_RECEIVED:     'Goods Received',
  INVOICED:           'Invoiced',
  PAID:               'Paid',
  CLOSED:             'Closed',
  REJECTED:           'Rejected',
  CANCELLED:          'Cancelled',
};

export const PO_STATUS_COLORS = {
  PARKED:             'badge-gray',
  PENDING_L1:         'badge-amber',
  PENDING_L2:         'badge-amber',
  PENDING_L3:         'badge-amber',
  PENDING_FINANCIAL:  'badge-amber',
  APPROVED:           'badge-green',
  GOODS_RECEIVED:     'badge-blue',
  INVOICED:           'badge-blue',
  PAID:               'badge-green',
  CLOSED:             'badge-gray',
  REJECTED:           'badge-red',
  CANCELLED:          'badge-gray',
};

// ─────────────────────────────────────────────────────────────────────────────
// ROLES MANAGEMENT — Admin only
// ─────────────────────────────────────────────────────────────────────────────

export function canManageRoles(user) {
  return user?.role === ROLES.ADMIN;
}


