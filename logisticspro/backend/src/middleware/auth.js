const jwt = require('jsonwebtoken');

// ── Role definitions ──────────────────────────────────────────
// Single source of truth for every role in the system.
const ROLES = {
  ADMIN:         'ADMIN',
  MANAGER:       'MANAGER',
  OPERATOR:      'OPERATOR',
  OPS_ASSISTANT: 'OPS_ASSISTANT',
  CONTROL_ROOM:  'CONTROL_ROOM',
  ACCOUNTING:    'ACCOUNTING',
  WORKSHOP:      'WORKSHOP',
  READONLY:      'READONLY',
};

// ── Permission helpers ────────────────────────────────────────
// Use these constants in route files instead of hard-coding role arrays.

const CAN_VIEW_LOADS = [
  ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR,
  ROLES.OPS_ASSISTANT, ROLES.CONTROL_ROOM,
  ROLES.ACCOUNTING, ROLES.WORKSHOP,
];

const CAN_CREATE_LOAD = [
  ROLES.ADMIN, ROLES.OPERATOR,
  ROLES.OPS_ASSISTANT, ROLES.CONTROL_ROOM,
];

const CAN_ADVANCE_TO_EN_ROUTE = [
  ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT, ROLES.CONTROL_ROOM,
];

const CAN_ADVANCE_TO_OFFLOADED = [
  ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT, ROLES.CONTROL_ROOM,
];

// After OFFLOADED only Operator/Admin can advance (Control Room stops at OFFLOADED)
const CAN_ADVANCE_PAST_OFFLOADED = [
  ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT,
];

// WAIT_APPROVAL → WAIT_POD_SCAN  (Operator final approval before POD)
const CAN_APPROVE_FOR_POD = [
  ROLES.ADMIN, ROLES.OPERATOR,
];

// WAIT_INVOICE_NO → LOAD_INVOICED  (Accounting / Manager / Admin)
const CAN_APPROVE_INVOICE = [
  ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING,
];

// Reject a load at any stage
const CAN_REJECT_LOAD = [
  ROLES.ADMIN, ROLES.OPERATOR, ROLES.ACCOUNTING,
  // Control Room explicitly CANNOT reject
];

// Soft-delete a load (status → DELETED, values zeroed)
const CAN_DELETE_LOAD = [
  ROLES.OPERATOR, ROLES.ADMIN,
];

// Approve KM anomalies
const CAN_APPROVE_KM = [
  ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT,
];

// Add/edit costs on a load
const CAN_ADD_COSTS = [
  ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT, ROLES.CONTROL_ROOM,
];

// View Workshop section
const CAN_VIEW_WORKSHOP = [
  ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR,
  ROLES.OPS_ASSISTANT, ROLES.WORKSHOP,
];

// Edit Workshop section
const CAN_EDIT_WORKSHOP = [
  ROLES.ADMIN, ROLES.WORKSHOP,
];

// View/edit Clients, Drivers, Rates
const CAN_MANAGE_CLIENTS = [
  ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR, ROLES.OPS_ASSISTANT,
];

// View/edit Client Rates (sensitive — Operator excluded)
const CAN_VIEW_RATES = [
  ROLES.ADMIN, ROLES.MANAGER,
];

// View/edit Users
const CAN_MANAGE_USERS = [
  ROLES.ADMIN, ROLES.MANAGER,
];

// View Fleet
const CAN_VIEW_FLEET = [
  ROLES.ADMIN, ROLES.MANAGER, ROLES.OPERATOR, ROLES.OPS_ASSISTANT,
];

// Edit Fleet
const CAN_EDIT_FLEET = [
  ROLES.ADMIN, ROLES.OPERATOR, ROLES.OPS_ASSISTANT,
];

// Approve / action invoices and credit notes
const CAN_MANAGE_INVOICES = [
  ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING,
];

// Create credit notes
const CAN_CREATE_CREDIT_NOTE = [
  ROLES.ADMIN, ROLES.MANAGER,
];

// ── Middleware ────────────────────────────────────────────────

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }
  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token expired or invalid' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = {
  authMiddleware,
  requireRole,
  ROLES,
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
};
