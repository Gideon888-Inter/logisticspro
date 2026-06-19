// ── Single source of truth for role permissions on the frontend ──
// Mirror of backend/src/middleware/auth.js — keep in sync.

export const ROLES = {
  ADMIN:         'ADMIN',
  MANAGER:       'MANAGER',
  OPERATOR:      'OPERATOR',
  OPS_ASSISTANT: 'OPS_ASSISTANT',
  CONTROL_ROOM:  'CONTROL_ROOM',
  ACCOUNTING:    'ACCOUNTING',
  WORKSHOP:      'WORKSHOP',
  READONLY:      'READONLY',
};

// ── Role label for display ────────────────────────────────────
export const ROLE_LABELS = {
  ADMIN:         'Admin',
  MANAGER:       'Manager',
  OPERATOR:      'Operator',
  OPS_ASSISTANT: 'Ops Assistant',
  CONTROL_ROOM:  'Control Room',
  ACCOUNTING:    'Administrator',   // Display name per brief
  WORKSHOP:      'Workshop',
  READONLY:      'Read Only',
};

export const ROLE_BADGE_COLORS = {
  ADMIN:         'badge-red',
  MANAGER:       'badge-amber',
  OPERATOR:      'badge-blue',
  OPS_ASSISTANT: 'badge-blue',
  CONTROL_ROOM:  'badge-gray',
  ACCOUNTING:    'badge-green',
  WORKSHOP:      'badge-gray',
  READONLY:      'badge-gray',
};

// ── Permission helpers (pass the user object from useAuth) ────

export function canViewLoads(user) {
  return [ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR, ROLES.OPS_ASSISTANT,
          ROLES.CONTROL_ROOM, ROLES.ACCOUNTING, ROLES.WORKSHOP].includes(user?.role);
}

export function canCreateLoad(user) {
  return [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT, ROLES.CONTROL_ROOM].includes(user?.role);
}

export function canEditLoad(user) {
  // Editing load fields (rate, customer, route) — not just status
  return [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT].includes(user?.role);
}

export function canDeleteLoad(user) {
  return [ROLES.OPERATOR, ROLES.ADMIN].includes(user?.role);
}

export function canRejectLoad(user) {
  return [ROLES.ADMIN, ROLES.OPERATOR, ROLES.ACCOUNTING].includes(user?.role);
}

// Status transition rules
export function canAdvanceStatus(user, currentStatus, newStatus) {
  const role = user?.role;

  // Workshop and Read Only — never
  if ([ROLES.WORKSHOP, ROLES.READONLY, ROLES.MANAGER].includes(role)) return false;

  // Accounting — only WAIT_INVOICE_NO → LOAD_INVOICED (via invoice approval)
  if (role === ROLES.ACCOUNTING) return false;

  // Control Room — up to OFFLOADED only, cannot reject
  if (role === ROLES.CONTROL_ROOM) {
    if (newStatus === 'REJECTED') return false;
    return ['EN_ROUTE', 'OFFLOADED'].includes(newStatus);
  }

  // Ops Assistant — can submit all transitions (will be queued for approval)
  if (role === ROLES.OPS_ASSISTANT) return true;

  // Operator / Admin — full control
  return [ROLES.OPERATOR, ROLES.ADMIN].includes(role);
}

export function isOpsAssistant(user) {
  return user?.role === ROLES.OPS_ASSISTANT;
}

// What the next logical status is (for the "advance" button label)
export const STATUS_NEXT = {
  PRELOAD:          'EN_ROUTE',
  EN_ROUTE:         'OFFLOADED',
  OFFLOADED:        'WAIT_ORDER_NO',
  WAIT_ORDER_NO:    'WAIT_APPROVAL',
  WAIT_APPROVAL:    'WAIT_POD_SCAN',
  WAIT_POD_SCAN:    'WAIT_INVOICE_NO',   // system-driven
  WAIT_INVOICE_NO:  'LOAD_INVOICED',     // via invoice approval
};

export const STATUS_LABELS = {
  PRELOAD:               'Pre-load',
  EN_ROUTE:              'En Route',
  OFFLOADED:             'Offloaded',
  WAIT_ORDER_NO:         'Awaiting PO Number',
  WAIT_APPROVAL:         'Awaiting Approval',
  WAIT_POD_SCAN:         'Require POD Scans',
  WAIT_INVOICE_NO:       'Awaiting Invoice No.',
  LOAD_INVOICED:         'Invoiced',
  REJECTED:              'Rejected',
  DELETED:               'Deleted',
  PENDING_KM_APPROVAL:   'Pending KM Approval',
  KM_CORRECTION_NEEDED:  'KM Correction Needed',
};

// ── Menu / page access ────────────────────────────────────────

export function canViewFleet(user) {
  return [ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR, ROLES.OPS_ASSISTANT].includes(user?.role);
}

export function canEditFleet(user) {
  return [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT].includes(user?.role);
}

export function canViewWorkshop(user) {
  return [ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR, ROLES.OPS_ASSISTANT, ROLES.WORKSHOP].includes(user?.role);
}

export function canEditWorkshop(user) {
  return [ROLES.ADMIN, ROLES.WORKSHOP].includes(user?.role);
}

export function canViewRates(user) {
  return [ROLES.ADMIN, ROLES.MANAGER].includes(user?.role);
}

export function canManageClients(user) {
  return [ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR, ROLES.OPS_ASSISTANT].includes(user?.role);
}

export function canManageDrivers(user) {
  return [ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR, ROLES.OPS_ASSISTANT].includes(user?.role);
}

export function canManageUsers(user) {
  return [ROLES.ADMIN, ROLES.MANAGER].includes(user?.role);
}

export function canManageInvoices(user) {
  return [ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING].includes(user?.role);
}

export function canCreateCreditNote(user) {
  return [ROLES.ADMIN, ROLES.MANAGER].includes(user?.role);
}

export function canViewApprovals(user) {
  return [ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR, ROLES.ACCOUNTING].includes(user?.role);
}

export function canAddCosts(user) {
  return [ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT, ROLES.CONTROL_ROOM].includes(user?.role);
}
