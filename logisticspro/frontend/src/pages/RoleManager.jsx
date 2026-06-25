import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../lib/AuthContext';
import { ROLES } from '../lib/roles';

const API = import.meta.env.VITE_API_URL || '';
const token = () => localStorage.getItem('lp_token');

function apiFetch(path, opts = {}) {
  return fetch(`${API}/api/roles${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token()}`,
      ...(opts.headers || {}),
    },
  }).then(r => r.json());
}

const BUILTIN_ROLE_KEYS = new Set([
  'ADMIN','MANAGER','OPERATOR','OPS_ASSISTANT','CONTROL_ROOM',
  'FINANCE','WORKSHOP_MANAGER','WORKSHOP_ASSISTANT','STOCK_CONTROLLER',
  'WORKSHOP','READONLY',
]);

const BADGE_OPTIONS = [
  { value: 'badge-red',    label: '🔴 Red' },
  { value: 'badge-amber',  label: '🟡 Amber' },
  { value: 'badge-blue',   label: '🔵 Blue' },
  { value: 'badge-green',  label: '🟢 Green' },
  { value: 'badge-purple', label: '🟣 Purple' },
  { value: 'badge-gray',   label: '⚫ Gray' },
];

const MODULE_GROUPS = ['Operational', 'Finance', 'Workshop', 'Admin'];

export default function RoleManager() {
  const { user } = useAuth();

  const [roles, setRoles]               = useState({ builtin: [], custom: [] });
  const [loading, setLoading]           = useState(true);
  const [tab, setTab]                   = useState('builtin');
  const [selectedKey, setSelectedKey]   = useState(null);
  const [perms, setPerms]               = useState([]);
  const [permsLoading, setPermsLoading] = useState(false);
  const [showNew, setShowNew]           = useState(false);
  const [saving, setSaving]             = useState(false);
  const [deactivating, setDeactivating] = useState(null);
  const [newForm, setNewForm]           = useState({
    role_key: '', role_label: '', badge_color: 'badge-gray',
    base_role: '', description: '',
  });

  const loadRoles = useCallback(async () => {
    setLoading(true);
    const data = await apiFetch('');
    setRoles({ builtin: data.builtin || [], custom: data.custom || [] });
    setLoading(false);
  }, []);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  const loadPerms = async (key) => {
    setSelectedKey(key);
    setPermsLoading(true);
    const data = await apiFetch(`/${key}/permissions`);
    setPerms(data.permissions || []);
    setPermsLoading(false);
  };

  const togglePerm = async (moduleKey, action, current) => {
    if (BUILTIN_ROLE_KEYS.has(selectedKey)) return; // read-only for built-ins
    const updated = perms.map(p =>
      p.module_key === moduleKey ? { ...p, [`can_${action}`]: !current } : p
    );
    setPerms(updated);
    const row = updated.find(p => p.module_key === moduleKey);
    await apiFetch(`/${selectedKey}/permissions/${moduleKey}`, {
      method: 'PATCH',
      body: JSON.stringify({
        can_view: row.can_view, can_edit: row.can_edit,
        can_delete: row.can_delete, can_approve: row.can_approve,
      }),
    });
  };

  const createRole = async () => {
    if (!newForm.role_key.trim() || !newForm.role_label.trim()) return alert('Key and Label are required');
    if (!/^[A-Z0-9_]+$/.test(newForm.role_key)) return alert('Role key must be uppercase letters, numbers and underscores only');
    setSaving(true);
    const result = await apiFetch('', { method: 'POST', body: JSON.stringify(newForm) });
    setSaving(false);
    if (result.error) { alert(result.error); return; }
    setShowNew(false);
    setNewForm({ role_key: '', role_label: '', badge_color: 'badge-gray', base_role: '', description: '' });
    loadRoles();
  };

  const deactivate = async (key) => {
    if (!confirm(`Deactivate role "${key}"? Users with this role will lose access.`)) return;
    setDeactivating(key);
    const result = await apiFetch(`/${key}`, { method: 'DELETE' });
    setDeactivating(null);
    if (result.error) { alert(result.error); return; }
    if (selectedKey === key) { setSelectedKey(null); setPerms([]); }
    loadRoles();
  };

  if (user?.role !== ROLES.ADMIN) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50vh', gap: 12 }}>
        <div style={{ fontSize: 48 }}>🔒</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#e53e3e' }}>Access Denied</div>
        <div style={{ fontSize: 14, color: '#aaa' }}>Role management is restricted to Admins only.</div>
      </div>
    );
  }

  const displayList = tab === 'builtin' ? roles.builtin : roles.custom.filter(r => r.is_active);
  const selectedRole = [...roles.builtin, ...roles.custom].find(r => r.role_key === selectedKey);
  const isBuiltinSelected = BUILTIN_ROLE_KEYS.has(selectedKey);

  const groupedPerms = MODULE_GROUPS.map(g => ({
    group: g,
    modules: perms.filter(p => p.module_group === g),
  })).filter(g => g.modules.length > 0);

  return (
    <div>
      {/* ── Stat cards ── */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Built-in Roles</div>
          <div className="stat-value">{roles.builtin.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Custom Roles</div>
          <div className="stat-value" style={{ color: '#00AEEF' }}>{roles.custom.filter(r => r.is_active).length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Modules</div>
          <div className="stat-value">{perms.length > 0 ? perms.length : '16'}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, marginTop: 16 }}>

        {/* ── Left: role list ── */}
        <div>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
            <button className={`btn btn-sm ${tab === 'builtin' ? 'btn-primary' : ''}`} onClick={() => setTab('builtin')}>
              Built-in ({roles.builtin.length})
            </button>
            <button className={`btn btn-sm ${tab === 'custom' ? 'btn-primary' : ''}`} onClick={() => setTab('custom')}>
              Custom ({roles.custom.filter(r => r.is_active).length})
            </button>
          </div>

          {tab === 'custom' && (
            <button className="btn btn-primary btn-sm" style={{ width: '100%', marginBottom: 8 }} onClick={() => setShowNew(true)}>
              + New Custom Role
            </button>
          )}

          <div className="table-wrap" style={{ margin: 0 }}>
            {loading && <div className="loading" style={{ padding: 16 }}>Loading…</div>}
            {!loading && displayList.length === 0 && (
              <div className="empty-state" style={{ padding: 24 }}>
                {tab === 'custom' ? 'No custom roles yet. Create one to get started.' : 'No roles found.'}
              </div>
            )}
            {!loading && displayList.map(role => (
              <div
                key={role.role_key}
                onClick={() => loadPerms(role.role_key)}
                style={{
                  padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0',
                  background: selectedKey === role.role_key ? '#e8f4fd' : 'white',
                  borderLeft: selectedKey === role.role_key ? '3px solid #005A8E' : '3px solid transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                  <div>
                    <span className={`badge ${role.badge_color || 'badge-gray'}`} style={{ marginRight: 6, fontSize: 10 }}>
                      {role.role_key}
                    </span>
                    <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>{role.role_label}</div>
                  </div>
                  {!BUILTIN_ROLE_KEYS.has(role.role_key) && (
                    <button
                      className="btn btn-sm"
                      style={{ fontSize: 10, padding: '2px 6px', color: '#e53e3e', borderColor: '#e53e3e' }}
                      onClick={e => { e.stopPropagation(); deactivate(role.role_key); }}
                      disabled={deactivating === role.role_key}
                    >
                      {deactivating === role.role_key ? '…' : 'Deactivate'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right: permission matrix ── */}
        <div>
          {!selectedKey && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, color: '#aaa', gap: 12 }}>
              <div style={{ fontSize: 40 }}>🔑</div>
              <div>Select a role to view and edit permissions</div>
            </div>
          )}

          {selectedKey && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <span className={`badge ${selectedRole?.badge_color || 'badge-gray'}`}>{selectedKey}</span>
                <span style={{ fontWeight: 600, fontSize: 16 }}>{selectedRole?.role_label}</span>
                {isBuiltinSelected && (
                  <span style={{ fontSize: 11, color: '#888', background: '#f5f5f5', padding: '2px 8px', borderRadius: 4 }}>
                    Built-in — permissions enforced in auth.js (read-only)
                  </span>
                )}
              </div>

              {permsLoading && <div className="loading">Loading permissions…</div>}

              {!permsLoading && (
                <div className="table-wrap" style={{ margin: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Module</th>
                        <th style={{ textAlign: 'center' }}>View</th>
                        <th style={{ textAlign: 'center' }}>Edit</th>
                        <th style={{ textAlign: 'center' }}>Delete</th>
                        <th style={{ textAlign: 'center' }}>Approve</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupedPerms.map(({ group, modules }) => (
                        <>
                          <tr key={`group-${group}`}>
                            <td colSpan={5} style={{ background: '#f5f7fa', fontWeight: 700, fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, padding: '6px 12px' }}>
                              {group}
                            </td>
                          </tr>
                          {modules.map(p => (
                            <tr key={p.module_key}>
                              <td style={{ fontSize: 13 }}>
                                {p.module_label}
                                {p.description && <div style={{ fontSize: 11, color: '#aaa' }}>{p.description}</div>}
                              </td>
                              {['view', 'edit', 'delete', 'approve'].map(action => (
                                <td key={action} style={{ textAlign: 'center' }}>
                                  <input
                                    type="checkbox"
                                    checked={p[`can_${action}`] || false}
                                    onChange={() => togglePerm(p.module_key, action, p[`can_${action}`])}
                                    disabled={isBuiltinSelected}
                                    style={{ cursor: isBuiltinSelected ? 'not-allowed' : 'pointer', width: 16, height: 16 }}
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── New Custom Role Modal ── */}
      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create Custom Role</h3>
              <button onClick={() => setShowNew(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label>Role Key * <span style={{ fontSize: 11, color: '#aaa' }}>(UPPERCASE_UNDERSCORE)</span></label>
                  <input
                    value={newForm.role_key}
                    onChange={e => setNewForm(f => ({ ...f, role_key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') }))}
                    placeholder="e.g. DEPOT_MANAGER"
                  />
                </div>
                <div className="form-group">
                  <label>Display Label *</label>
                  <input value={newForm.role_label} onChange={e => setNewForm(f => ({ ...f, role_label: e.target.value }))} placeholder="e.g. Depot Manager" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Badge Colour</label>
                  <select value={newForm.badge_color} onChange={e => setNewForm(f => ({ ...f, badge_color: e.target.value }))}>
                    {BADGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Base Role <span style={{ fontSize: 11, color: '#aaa' }}>(inherit permissions)</span></label>
                  <select value={newForm.base_role} onChange={e => setNewForm(f => ({ ...f, base_role: e.target.value }))}>
                    <option value="">— None —</option>
                    {roles.builtin.map(r => <option key={r.role_key} value={r.role_key}>{r.role_label}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Description</label>
                <input value={newForm.description} onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))} placeholder="What does this role do?" />
              </div>
              <p style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
                ℹ️ After creating the role, select it from the list to set its module permissions. Then use the Users page to assign users.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowNew(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createRole} disabled={saving}>
                {saving ? 'Creating…' : 'Create Role'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
