import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';

const API = import.meta.env.VITE_API_URL || '';
const token = () => localStorage.getItem('lp_token');
const req = (path, opts = {}) =>
  fetch(API + '/api' + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token(),
      ...(opts.headers || {}),
    },
  }).then(r => r.json());

const EMPTY = {
  u_username: '',
  u_password: '',
  u_name: '',
  u_email: '',
  u_role: 'OPERATOR',
  u_bus_unit: 'IDC',
  u_active: 'Y',
  u_region: '',
};

function exportCSV(data) {
  const headers = ['Username', 'Name', 'Email', 'Role', 'Business Unit', 'Region', 'Active'];
  const rows = data.map(u => [
    u.u_username, u.u_name || '', u.u_email || '',
    u.u_role, u.u_bus_unit || '', u.u_region || '',
    u.u_active === 'Y' ? 'Yes' : 'No',
  ]);
  const csv = [headers, ...rows].map(r => r.map(x => `"${x}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'users_export.csv';
  a.click();
}

export default function Users() {
  const { user: currentUser } = useAuth();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('Y');
  const [roleFilter, setRoleFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [saveError, setSaveError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await req('/users');
      setData(Array.isArray(r) ? r : r.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => {
    setForm(EMPTY);
    setEditId(null);
    setSaveError('');
    setShowModal(true);
  };

  const openEdit = (u) => {
    setForm({ ...EMPTY, ...u, u_password: '' });
    setEditId(u.u_id);
    setSaveError('');
    setShowModal(true);
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaveError('');

    if (!form.u_username.trim())
      return setSaveError('Username is required');
    if (!editId && !form.u_password.trim())
      return setSaveError('Password is required for new users');
    if (!editId && form.u_password.length < 8)
      return setSaveError('Password must be at least 8 characters');

    setSaving(true);
    try {
      if (editId) {
        // Update existing user
        const payload = { ...form };
        if (!payload.u_password) delete payload.u_password;
        const result = await req(`/users/${editId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        if (result.error) return setSaveError(result.error);
      } else {
        // Create new user — calls /api/auth/register with auth token
        const result = await req('/auth/register', {
          method: 'POST',
          body: JSON.stringify(form),
        });
        if (result.error) return setSaveError(result.error);
      }
      setShowModal(false);
      load();
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const ROLE_COLORS = {
    ADMIN: 'badge-red',
    MANAGER: 'badge-amber',
    OPERATOR: 'badge-blue',
    OPERATIONS: 'badge-blue',
    ACCOUNTING: 'badge-green',
    WORKSHOP: 'badge-gray',
    TRACKING: 'badge-gray',
    READONLY: 'badge-gray',
  };

  const filtered = data.filter(u =>
    (!activeFilter || u.u_active === activeFilter) &&
    (!roleFilter || u.u_role === roleFilter)
  );

  return (
    <div>
      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Users</div>
          <div className="stat-value">{data.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Admins</div>
          <div className="stat-value" style={{ color: '#e53e3e' }}>
            {data.filter(u => u.u_role === 'ADMIN').length}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Operators</div>
          <div className="stat-value" style={{ color: '#00AEEF' }}>
            {data.filter(u => u.u_role === 'OPERATOR').length}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active</div>
          <div className="stat-value" style={{ color: '#059669' }}>
            {data.filter(u => u.u_active === 'Y').length}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="">All roles</option>
          <option value="ADMIN">Admin</option>
          <option value="MANAGER">Manager</option>
          <option value="OPERATIONS">Operations</option>
          <option value="OPERATOR">Operator</option>
          <option value="TRACKING">Tracking</option>
          <option value="ACCOUNTING">Accounting</option>
          <option value="WORKSHOP">Workshop</option>
          <option value="READONLY">Read Only</option>
        </select>
        <select value={activeFilter} onChange={e => setActiveFilter(e.target.value)}>
          <option value="">All</option>
          <option value="Y">Active</option>
          <option value="N">Inactive</option>
        </select>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>
          + Add User
        </button>
        <button className="btn btn-sm" onClick={() => exportCSV(data)}>
          ⬇ Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Full Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Region</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6}><div className="loading">Loading users…</div></td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6}><div className="empty-state">No users found</div></td></tr>
            )}
            {!loading && filtered.map(u => (
              <tr key={u.u_id} onClick={() => openEdit(u)} style={{ cursor: 'pointer' }}>
                <td className="mono" style={{ fontWeight: 600 }}>{u.u_username}</td>
                <td>{u.u_name || '—'}</td>
                <td>{u.u_email || '—'}</td>
                <td>
                  <span className={`badge ${ROLE_COLORS[u.u_role] || 'badge-gray'}`}>
                    {u.u_role}
                  </span>
                </td>
                <td>{u.u_region || '—'}</td>
                <td>
                  <span className={`badge ${u.u_active === 'Y' ? 'badge-green' : 'badge-red'}`}>
                    {u.u_active === 'Y' ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editId ? 'Edit User' : 'Add New User'}</h3>
              <button
                onClick={() => setShowModal(false)}
                style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}
              >✕</button>
            </div>

            <div className="modal-body">
              {saveError && (
                <div style={{
                  background: '#fff5f5', border: '1px solid #fca5a5',
                  borderRadius: 4, padding: '10px 14px', marginBottom: 12,
                  color: '#e53e3e', fontSize: 13,
                }}>
                  ⚠ {saveError}
                </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label>Username *</label>
                  <input
                    value={form.u_username}
                    onChange={e => set('u_username', e.target.value)}
                    disabled={!!editId}
                    placeholder="e.g. jsmith"
                  />
                </div>
                <div className="form-group">
                  <label>{editId ? 'New Password (leave blank to keep)' : 'Password *'}</label>
                  <input
                    type="password"
                    value={form.u_password}
                    onChange={e => set('u_password', e.target.value)}
                    placeholder={editId ? '(leave blank to keep current)' : 'Min 8 characters'}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Full Name</label>
                  <input
                    value={form.u_name}
                    onChange={e => set('u_name', e.target.value)}
                    placeholder="e.g. John Smith"
                  />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={form.u_email}
                    onChange={e => set('u_email', e.target.value)}
                    placeholder="e.g. jsmith@company.co.za"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Role</label>
                  <select value={form.u_role} onChange={e => set('u_role', e.target.value)}>
                    <option value="ADMIN">Admin</option>
                    <option value="MANAGER">Manager</option>
                    <option value="OPERATIONS">Operations</option>
                    <option value="OPERATOR">Operator</option>
                    <option value="TRACKING">Tracking</option>
                    <option value="ACCOUNTING">Accounting</option>
                    <option value="WORKSHOP">Workshop</option>
                    <option value="READONLY">Read Only</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Business Unit</label>
                  <select value={form.u_bus_unit} onChange={e => set('u_bus_unit', e.target.value)}>
                    <option value="IDC">IDC</option>
                    <option value="IDM">IDM</option>
                    <option value="MOGWASE">Mogwase</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Region</label>
                  <select value={form.u_region || ''} onChange={e => set('u_region', e.target.value)}>
                    <option value="">— No region —</option>
                    <option value="Johannesburg">Johannesburg</option>
                    <option value="Cape Town">Cape Town</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Active</label>
                  <select value={form.u_active} onChange={e => set('u_active', e.target.value)}>
                    <option value="Y">Yes</option>
                    <option value="N">No</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : editId ? 'Update User' : 'Add User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
