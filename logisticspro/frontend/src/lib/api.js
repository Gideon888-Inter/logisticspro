const BASE = import.meta.env.VITE_API_URL || '';

function getToken() {
  return localStorage.getItem('lp_token');
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  // Auth
  login:          (body) => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  changePassword: (body) => request('/auth/change-password', { method: 'POST', body: JSON.stringify(body) }),
  forgotPassword: (body) => request('/auth/forgot-password', { method: 'POST', body: JSON.stringify(body) }),
  getMe:          ()     => request('/auth/me'),

  // Loads
  getLoads:     (params = {}) => request('/loads?' + new URLSearchParams(params)),
  getLoad:      (id)          => request(`/loads/${id}`),
  getLoadStats: (params = {}) => request('/loads/stats/summary?' + new URLSearchParams(params)),
  createLoad:   (body)        => request('/loads', { method: 'POST', body: JSON.stringify(body) }),
  updateLoad:   (id, body)    => request(`/loads/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteLoad:   (id)          => request(`/loads/${id}`, { method: 'DELETE' }),
  getComments:  (id)          => request(`/loads/${id}/comments`),
  addComment:   (id, comment) => request(`/loads/${id}/comments`, { method: 'POST', body: JSON.stringify({ comment }) }),

  // Vehicles
  getVehicles:  (params = {}) => request('/vehicles?' + new URLSearchParams(params)),
  createVehicle:(body)        => request('/vehicles', { method: 'POST', body: JSON.stringify(body) }),
  updateVehicle:(code, body)  => request(`/vehicles/${code}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // Drivers
  getDrivers:   (params = {}) => request('/drivers?' + new URLSearchParams(params)),
  createDriver: (body)        => request('/drivers', { method: 'POST', body: JSON.stringify(body) }),

  // Customers
  getCustomers: ()            => request('/customers'),
  createCustomer:(body)       => request('/customers', { method: 'POST', body: JSON.stringify(body) }),

  // Maintenance
  getMaintenance:(params = {})=> request('/maintenance?' + new URLSearchParams(params)),
  createMaintenance:(body)    => request('/maintenance', { method: 'POST', body: JSON.stringify(body) }),

  // Inventory
  getInventory: ()            => request('/inventory'),
  createPart:   (body)        => request('/inventory', { method: 'POST', body: JSON.stringify(body) }),
  updatePart:   (id, body)    => request(`/inventory/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // Routes
  getRoutes:    ()            => request('/routes'),
  createRoute:  (body)        => request('/routes', { method: 'POST', body: JSON.stringify(body) }),
};
