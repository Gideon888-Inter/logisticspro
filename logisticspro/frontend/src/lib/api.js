const BASE = import.meta.env.VITE_API_URL || '';

function getToken() {
  return localStorage.getItem('lp_token');
}

async function request(path, options = {}) {
  const token = getToken();
  let res;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000); // 20s timeout
  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...options,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    clearTimeout(timer);
  } catch (networkErr) {
    clearTimeout(timer);
    if (networkErr.name === 'AbortError') {
      throw new Error('Request timed out — server may be starting up. Please try again.');
    }
    // Network failure — backend may be sleeping (Render cold start)
    throw new Error('Network error — server may be starting up. Please wait a moment and try again.');
  }

  // JWT expired or invalid — clear session and let the app react gracefully
  if (res.status === 401) {
    localStorage.removeItem('lp_token');
    localStorage.removeItem('lp_user');
    window.dispatchEvent(new CustomEvent('lp-auth-expired'));
    throw new Error('Session expired — please log in again.');
  }

  // Read as text first — a non-JSON response (HTML error page, CDN/Render
  // outage, cold-start response) must not throw an opaque JSON parse error.
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || 'Unexpected server response' };
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Retry wrapper — retries once after 4 seconds on network errors (Render cold start)
export async function apiWithRetry(path, options = {}, retries = 1) {
  try {
    return await request(path, options);
  } catch (err) {
    if (retries > 0 && err.message.includes('Network error')) {
      await new Promise(r => setTimeout(r, 4000));
      return apiWithRetry(path, options, retries - 1);
    }
    throw err;
  }
}

export const api = {

  // ── Auth ────────────────────────────────────────────────────
  login:           (body) => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  register:        (body) => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  changePassword:  (body) => request('/auth/change-password', { method: 'POST', body: JSON.stringify(body) }),
  forgotPassword:  (body) => request('/auth/forgot-password', { method: 'POST', body: JSON.stringify(body) }),
  getMe:           ()     => request('/auth/me'),
  getPendingUsers: ()     => request('/auth/pending-users'),
  approvePendingUser: (id, body) => request(`/auth/pending-users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // ── Loads ───────────────────────────────────────────────────
  getLoads:            (params = {}) => request('/loads?' + new URLSearchParams(params)),
  getLoad:             (id)          => request(`/loads/${id}`),
  getLoadStats:        (params = {}) => request('/loads/stats/summary?' + new URLSearchParams(params)),
  getPendingOrderNos:  ()            => request('/loads/pending-order-nos'),
  getPendingOpsActions:()            => request('/loads/pending-ops-actions'),
  createLoad:          (body)        => request('/loads', { method: 'POST', body: JSON.stringify(body) }),
  updateLoad:          (id, body)    => request(`/loads/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteLoad:          (id)          => request(`/loads/${id}`, { method: 'DELETE' }),
  getComments:         (id)          => request(`/loads/${id}/comments`),
  addComment:          (id, comment) => request(`/loads/${id}/comments`, { method: 'POST', body: JSON.stringify({ comment }) }),
  requestOrderNo:      (id)          => request(`/loads/${id}/request-order-no`, { method: 'POST' }),
  approveOrderNo:      (id, body)    => request(`/loads/${id}/approve-order-no`, { method: 'PATCH', body: JSON.stringify(body) }),
  updateOpsAction:     (id, body)    => request(`/loads/ops-actions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // ── Vehicles ────────────────────────────────────────────────
  getVehicles:         (params = {}) => request('/vehicles?' + new URLSearchParams(params)),

  // ── Tracking (Pulsit GPS) ─────────────────────────────────────────
  getTrackingPositions: () => request('/tracking/positions'),
  getTrackingDebug:     () => request('/tracking/debug'),
  getVehicle:          (code)        => request(`/vehicles/${code}`),
  getVehicleAudit:     (code)        => request(`/vehicles/${code}/audit`),
  getVehicleMaintenance:(code)       => request(`/vehicles/${code}/maintenance`),
  createVehicle:       (body)        => request('/vehicles', { method: 'POST', body: JSON.stringify(body) }),
  updateVehicle:       (code, body)  => request(`/vehicles/${code}`, { method: 'PATCH', body: JSON.stringify(body) }),
  updateVehicleLink:   (code, body)  => request(`/vehicles/${code}/link`, { method: 'PATCH', body: JSON.stringify(body) }),

  // ── Drivers ─────────────────────────────────────────────────
  getDrivers:          (params = {}) => request('/drivers?' + new URLSearchParams(params)),
  getDriver:           (id)          => request(`/drivers/${id}`),
  createDriver:        (body)        => request('/drivers', { method: 'POST', body: JSON.stringify(body) }),
  updateDriver:        (id, body)    => request(`/drivers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // ── Customers ───────────────────────────────────────────────
  getCustomers:        ()            => request('/customers'),
  getCustomer:         (code)        => request(`/customers/${code}`),
  createCustomer:      (body)        => request('/customers', { method: 'POST', body: JSON.stringify(body) }),
  updateCustomer:      (code, body)  => request(`/customers/${code}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // ── Maintenance ─────────────────────────────────────────────
  getMaintenance:      (params = {}) => request('/maintenance?' + new URLSearchParams(params)),
  createMaintenance:   (body)        => request('/maintenance', { method: 'POST', body: JSON.stringify(body) }),
  updateMaintenance:   (id, body)    => request(`/maintenance/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // ── Inventory / Stock (LP2.0) ─────────────────────────────
  // Full inventory & PO management is handled via /api/stock in inventory.js
  // (Inventory.jsx and PurchaseOrders.jsx call /api/stock/... directly)

  // ── Routes ──────────────────────────────────────────────────
  getRoutes:           ()            => request('/routes'),
  createRoute:         (body)        => request('/routes', { method: 'POST', body: JSON.stringify(body) }),
  updateRoute:         (id, body)    => request(`/routes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // ── Client Rates ────────────────────────────────────────────
  getRates:            (params = {}) => request('/rates?' + new URLSearchParams(params)),
  createRate:          (body)        => request('/rates', { method: 'POST', body: JSON.stringify(body) }),
  updateRate:          (id, body)    => request(`/rates/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteRate:          (id)          => request(`/rates/${id}`, { method: 'DELETE' }),

  // ── Users ───────────────────────────────────────────────────
  getUsers:            ()            => request('/users'),
  updateUser:          (id, body)    => request(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // ── Costs ───────────────────────────────────────────────────
  getCosts:            (params = {}) => request('/costs?' + new URLSearchParams(params)),
  getPendingCostDeletions: ()        => request('/costs/pending-deletions'),
  addCost:             (body)        => request('/costs', { method: 'POST', body: JSON.stringify(body) }),
  deleteCost:          (id)          => request(`/costs/${id}`, { method: 'DELETE' }),
  requestCostDeletion: (id, body)    => request(`/costs/${id}/request-delete`, { method: 'PATCH', body: JSON.stringify(body) }),
  approveCostDeletion: (id, body)    => request(`/costs/${id}/approve-delete`, { method: 'PATCH', body: JSON.stringify(body) }),

  // ── KM ──────────────────────────────────────────────────────
  getLastClosingKm:    (truck)       => request(`/km/last-closing/${truck}`),
  submitKmClosing:     (loadNo, body)=> request(`/km/closing/${loadNo}`, { method: 'POST', body: JSON.stringify(body) }),
  validateKmOpening:   (body)        => request('/km/validate-opening', { method: 'POST', body: JSON.stringify(body) }),
  getKmAnomalies:      ()            => request('/km/anomalies'),
  createKmAnomaly:     (body)        => request('/km/anomalies', { method: 'POST', body: JSON.stringify(body) }),
  resolveKmAnomaly:    (id, body)    => request(`/km/anomalies/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  getKmNotifications:  ()            => request('/km/notifications'),
  createKmNotification:(body)        => request('/km/notifications', { method: 'POST', body: JSON.stringify(body) }),
  markAllNotificationsRead: ()       => request('/km/notifications/read-all', { method: 'PATCH' }),
  markNotificationRead:(id)          => request(`/km/notifications/${id}/read`, { method: 'PATCH' }),

  // ── Service Cards ───────────────────────────────────────────
  getServiceCards:     (params = {}) => request('/service?' + new URLSearchParams(params)),
  getServiceStats:     ()            => request('/service/stats'),
  getServiceCard:      (no)          => request(`/service/${no}`),
  getServiceAudit:     (no)          => request(`/service/${no}/audit`),
  getServiceChecklist: (no)          => request(`/service/${no}/checklist`),
  getServiceComments:  (no)          => request(`/service/${no}/comments`),
  createServiceCard:   (body)        => request('/service', { method: 'POST', body: JSON.stringify(body) }),
  autoCreateServiceCard:(body)       => request('/service/auto-create', { method: 'POST', body: JSON.stringify(body) }),
  updateServiceCard:   (no, body)    => request(`/service/${no}`, { method: 'PATCH', body: JSON.stringify(body) }),
  addServiceComment:   (no, body)    => request(`/service/${no}/comments`, { method: 'POST', body: JSON.stringify(body) }),
  addChecklistItem:    (no, body)    => request(`/service/${no}/checklist`, { method: 'POST', body: JSON.stringify(body) }),
  toggleChecklistItem: (no, id, body)=> request(`/service/${no}/checklist/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeChecklistItem: (no, id)      => request(`/service/${no}/checklist/${id}`, { method: 'DELETE' }),
  rejectServiceCard:   (no, body)    => request(`/service/${no}/reject`, { method: 'POST', body: JSON.stringify(body) }),
  completeServiceCard: (no, body)    => request(`/service/${no}/complete`, { method: 'POST', body: JSON.stringify(body) }),

  // ── PODs ────────────────────────────────────────────────────
  getPendingPODs:      (params = {}) => request('/pods/pending?' + new URLSearchParams(params)),
  getReceivedPODs:     (params = {}) => request('/pods/received?' + new URLSearchParams(params)),
  markPODReceived:     (loadNo)      => request(`/pods/${loadNo}/mark-received`, { method: 'POST' }),

  // ── Invoices ────────────────────────────────────────────────
  getInvoiceDrafts:    ()            => request('/invoices/drafts'),
  getInvoices:         (params = {}) => request('/invoices?' + new URLSearchParams(params)),
  getInvoice:          (id)          => request(`/invoices/${id}`),
  createInvoice:       (body)        => request('/invoices', { method: 'POST', body: JSON.stringify(body) }),
  approveInvoice:      (id, body)    => request(`/invoices/${id}/approve`, { method: 'POST', body: JSON.stringify(body) }),
  createCreditNote:    (id, body)    => request(`/invoices/${id}/credit-note`, { method: 'POST', body: JSON.stringify(body) }),

  // ── Fleet overview (Dashboard Fleet tab) ───────────────────────
  getFleetOverview:    ()            => request('/vehicles/fleet-overview'),

  // ── Addresses (Clients → Addresses tab; Fleet dashboard naming) ─
  getAddresses:        (params = {}) => request('/addresses?' + new URLSearchParams(params)),
  createAddress:       (body)        => request('/addresses', { method: 'POST', body: JSON.stringify(body) }),
  updateAddress:       (id, body)    => request(`/addresses/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deactivateAddress:   (id)          => request(`/addresses/${id}`, { method: 'DELETE' }),

  // ── Extra Stops (load cards) ────────────────────────────────────
  getStops:            (loadNo)      => request('/stops?' + new URLSearchParams({ load: loadNo })),
  addStop:             (body)        => request('/stops', { method: 'POST', body: JSON.stringify(body) }),
  requestDeleteStop:   (id, reason)  => request(`/stops/${id}/request-delete`, { method: 'PATCH', body: JSON.stringify({ reason }) }),
  approveDeleteStop:   (id, body)    => request(`/stops/${id}/approve-delete`, { method: 'PATCH', body: JSON.stringify(body) }),

  // ── KM (Pulsit-driven closing odometer) ─────────────────────────
  getPulsitReading:    (truck)       => request(`/km/pulsit-reading/${encodeURIComponent(truck)}`),
  confirmClosingAuto:  (loadNo)      => request(`/km/closing-auto/${encodeURIComponent(loadNo)}`, { method: 'POST' }),
};



