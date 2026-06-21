import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../lib/AuthContext';
import { ROLES, ROLE_LABELS, ROLE_BADGE_COLORS, canManageUsers } from '../lib/roles';

const API = import.meta.env.VITE_API_URL || '';
const token = () => localStorage.getItem('lp_token');
const req = (path, opts = {}) =>
  fetch(API + '/api' + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token(),
      ...(opts.headers || {}),
    },
  }).then(r => r.json());

const rolesReq = (path, opts = {}) =>
  fetch(API + '/api/roles' + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token(),
      ...(opts.headers || {}),
    },
  }).then(r => r.json());

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const EMPTY_USER = {
  u_username: '', u_password: '', u_name: '', u_email: '',
  u_role: ROLES.OPERATOR, u_active: 'Y', u_region: '',
};

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

function exportCSV(data) {
  const headers = ['Username', 'Name', 'Email', 'Role', 'Region', 'Active'];
  const rows = data.map(u => [
    u.u_username, u.u_name || '', u.u_email || '',
    ROLE_LABELS[u.u_role] || u.u_role, u.u_region || '',
    u.u_active === 'Y' ? 'Yes' : 'No',
  ]);
  const csv = [headers, ...rows].map(r => r.map(x => `"${x}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'users_export.csv';
  a.click();
}

const tabStyle = (active) => ({
  padding: '8px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
  borderBottom: active ? '2px solid #005A8E' : '2px solid transparent',
  color: active ? '#005A8E' : '#666',
  whiteSpace: 'nowrap',
});

// ─────────────────────────────────────────────────────────────
// ROLE MANAGER PANEL (embedded)
// ─────────────────────────────────────────────────────────────
function RoleManagerPanel() {
  const [roles, setRoles]               = useState({ builtin: [], custom: [] });
  const [loading, setLoading]           = useState(true);
  const [roleTab, setRoleTab]           = useState('builtin');
  const [selectedKey, setSelectedKey]   = useState(null);
  const [perms, setPerms]               = useState([]);
  const [permsLoading, setPermsLoading] = useState(false);
  const [showNew, setShowNew]           = useState(false);
  const [saving, setSaving]             = useState(false);
  const [deactivating, setDeactivating] = useState(null);
  const [newForm, setNewForm]           = useState({
    role_key: '', role_label: '', badge_color: 'badge-gray', base_role: '', description: '',
  });

  const loadRoles = useCallback(async () => {
    setLoading(true);
    try {
      const data = await rolesReq('');
      setRoles({ builtin: data.builtin || [], custom: data.custom || [] });
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  const loadPerms = async (key) => {
    setSelectedKey(key);
    setPermsLoading(true);
    try {
      const data = await rolesReq(`/${key}`);
      setPerms(data.permissions || []);
    } catch (e) { console.error(e); }
    finally { setPermsLoading(false); }
  };

  const togglePerm = async (moduleKey, action, current) => {
    if (selectedKey === 'ADMIN') return; // ADMIN perms cannot be changed
    const updated = perms.map(p =>
      p.module_key === moduleKey ? { ...p, [`can_${action}`]: !current } : p
    );
    setPerms(updated);
    const row = updated.find(p => p.module_key === moduleKey);
    await rolesReq(`/${selectedKey}/permissions/${moduleKey}`, {
      method: 'PATCH',
      body: JSON.stringify({
        can_view: row.can_view, can_edit: row.can_edit,
        can_delete: row.can_delete, can_approve: row.can_approve,
      }),
    });
  };

  const createRole = async () => {
    if (!newForm.role_key.trim() || !newForm.role_label.trim()) return alert('Key and Label are required');
    if (!/^[A-Z0-9_]+$/.test(newForm.role_key)) return alert('Role key must be UPPERCASE_UNDERSCORE only');
    setSaving(true);
    const result = await rolesReq('', { method: 'POST', body: JSON.stringify(newForm) });
    setSaving(false);
    if (result.error) { alert(result.error); return; }
    setShowNew(false);
    setNewForm({ role_key: '', role_label: '', badge_color: 'badge-gray', base_role: '', description: '' });
    loadRoles();
  };

  const deactivate = async (key) => {
    if (!confirm(`Deactivate role "${key}"? Users with this role will lose access.`)) return;
    setDeactivating(key);
    const result = await rolesReq(`/${key}`, { method: 'DELETE' });
    setDeactivating(null);
    if (result.error) { alert(result.error); return; }
    if (selectedKey === key) { setSelectedKey(null); setPerms([]); }
    loadRoles();
  };

  const selectedRole = [...roles.builtin, ...roles.custom].find(r => r.role_key === selectedKey);
  // Only lock ADMIN role — all other built-ins editable by Admin
  const isBuiltinSelected = selectedKey === 'ADMIN';
  const displayList = roleTab === 'builtin' ? roles.builtin : roles.custom.filter(r => r.is_active);
  const groupedPerms = MODULE_GROUPS.map(g => ({
    group: g,
    modules: perms.filter(p => p.module_group === g),
  })).filter(g => g.modules.length > 0);

  return (
    <div>
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
          <div className="stat-label">Modules</div>
          <div className="stat-value">16</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, marginTop: 16 }}>
        {/* Role list */}
        <div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
            <button className={`btn btn-sm ${roleTab === 'builtin' ? 'btn-primary' : ''}`} onClick={() => setRoleTab('builtin')}>
              Built-in ({roles.builtin.length})
            </button>
            <button className={`btn btn-sm ${roleTab === 'custom' ? 'btn-primary' : ''}`} onClick={() => setRoleTab('custom')}>
              Custom ({roles.custom.filter(r => r.is_active).length})
            </button>
          </div>
          {roleTab === 'custom' && (
            <button className="btn btn-primary btn-sm" style={{ width: '100%', marginBottom: 8 }} onClick={() => setShowNew(true)}>
              + New Custom Role
            </button>
          )}
          <div className="table-wrap" style={{ margin: 0 }}>
            {loading && <div className="loading" style={{ padding: 16 }}>Loading roles…</div>}
            {!loading && displayList.length === 0 && (
              <div className="empty-state" style={{ padding: 24 }}>
                {roleTab === 'custom' ? 'No custom roles yet.' : 'No roles found.'}
              </div>
            )}
            {!loading && displayList.map(role => (
              <div key={role.role_key} onClick={() => loadPerms(role.role_key)}
                style={{
                  padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0',
                  background: selectedKey === role.role_key ? '#e8f4fd' : 'white',
                  borderLeft: selectedKey === role.role_key ? '3px solid #005A8E' : '3px solid transparent',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div>
                    <span className={`badge ${role.badge_color || 'badge-gray'}`} style={{ fontSize: 10, marginRight: 6 }}>
                      {role.role_key}
                    </span>
                    <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>{role.role_label}</div>
                  </div>
                  {!BUILTIN_ROLE_KEYS.has(role.role_key) && (
                    <button className="btn btn-sm"
                      style={{ fontSize: 10, padding: '2px 6px', color: '#e53e3e', borderColor: '#e53e3e' }}
                      onClick={e => { e.stopPropagation(); deactivate(role.role_key); }}
                      disabled={deactivating === role.role_key}>
                      {deactivating === role.role_key ? '…' : 'Off'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Permission matrix */}
        <div>
          {!selectedKey && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 280, color: '#aaa', gap: 10 }}>
              <div style={{ fontSize: 36 }}>🔑</div>
              <div style={{ fontSize: 13 }}>Select a role to view and edit permissions</div>
              <div style={{ fontSize: 11, color: '#ccc', textAlign: 'center', maxWidth: 300 }}>
                Built-in role permissions are enforced in auth.js and shown here for reference only. Only custom role permissions are editable.
              </div>
            </div>
          )}
          {selectedKey && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span className={`badge ${selectedRole?.badge_color || 'badge-gray'}`}>{selectedKey}</span>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{selectedRole?.role_label}</span>
                {selectedRole?.description && <span style={{ fontSize: 12, color: '#888' }}>— {selectedRole.description}</span>}
                {isBuiltinSelected && (
                  <span style={{ fontSize: 10, color: '#888', background: '#f5f5f5', padding: '2px 8px', borderRadius: 4, marginLeft: 'auto' }}>
                    🔒 Admin role cannot be modified
                  </span>
                )}
                {!isBuiltinSelected && BUILTIN_ROLE_KEYS.has(selectedKey) && (
                  <span style={{ fontSize: 10, color: '#059669', background: '#f0fdf4', padding: '2px 8px', borderRadius: 4, marginLeft: 'auto' }}>
                    ✏️ Editable — changes override defaults
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
                        <th style={{ textAlign: 'center', width: 60 }}>View</th>
                        <th style={{ textAlign: 'center', width: 60 }}>Edit</th>
                        <th style={{ textAlign: 'center', width: 60 }}>Delete</th>
                        <th style={{ textAlign: 'center', width: 60 }}>Approve</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupedPerms.map(({ group, modules }) => (
                        <>
                          <tr key={`grp-${group}`}>
                            <td colSpan={5} style={{ background: '#f5f7fa', fontWeight: 700, fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, padding: '5px 12px' }}>
                              {group}
                            </td>
                          </tr>
                          {modules.map(p => (
                            <tr key={p.module_key}>
                              <td style={{ fontSize: 13 }}>{p.module_label}</td>
                              {['view','edit','delete','approve'].map(action => (
                                <td key={action} style={{ textAlign: 'center' }}>
                                  <input type="checkbox"
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

      {/* New Role Modal */}
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
                  <input value={newForm.role_key}
                    onChange={e => setNewForm(f => ({ ...f, role_key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') }))}
                    placeholder="e.g. DEPOT_MANAGER" />
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
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowNew(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createRole} disabled={saving}>{saving ? 'Creating…' : 'Create Role'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN USERS PAGE
// ─────────────────────────────────────────────────────────────
export default function Users() {
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === ROLES.ADMIN;

  const [data, setData]                     = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [loading, setLoading]               = useState(true);
  const [activeFilter, setActiveFilter]     = useState('Y');
  const [roleFilter, setRoleFilter]         = useState('');
  const [showModal, setShowModal]           = useState(false);
  const [form, setForm]                     = useState(EMPTY_USER);
  const [saving, setSaving]                 = useState(false);
  const [editId, setEditId]                 = useState(null);
  const [saveError, setSaveError]           = useState('');
  const [saveResult, setSaveResult]         = useState(null);
  const [tab, setTab]                       = useState('users');
  const [selectedApproval, setSelectedApproval] = useState(null);
  const [rejectionReason, setRejectionReason]   = useState('');
  const [actionSaving, setActionSaving]         = useState(false);
  const [allRoles, setAllRoles]                 = useState([]);  // built-in + custom from API

  const load = async () => {
    setLoading(true);
    try {
      const [usersRes, approvalsRes, rolesRes] = await Promise.all([
        req('/users'),
        req('/auth/pending-users').catch(() => []),
        rolesReq('').catch(() => ({ builtin: [], custom: [] })),
      ]);
      setData(Array.isArray(usersRes) ? usersRes : usersRes.data || []);
      setPendingApprovals(Array.isArray(approvalsRes) ? approvalsRes : []);
      // Merge built-in + active custom roles for dropdowns
      const builtin = rolesRes.builtin || [];
      const custom  = (rolesRes.custom || []).filter(r => r.is_active);
      setAllRoles([...builtin, ...custom]);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openAdd  = () => { setForm(EMPTY_USER); setEditId(null); setSaveError(''); setSaveResult(null); setShowModal(true); };
  const openEdit = (u) => { setForm({ ...EMPTY_USER, ...u, u_password: '' }); setEditId(u.u_id); setSaveError(''); setSaveResult(null); setShowModal(true); };
  const set      = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaveError(''); setSaveResult(null);
    if (!form.u_username.trim()) return setSaveError('Username is required');
    if (!editId && !form.u_password.trim()) return setSaveError('Password is required for new users');
    if (!editId && form.u_password.length < 8) return setSaveError('Password must be at least 8 characters');
    setSaving(true);
    try {
      if (editId) {
        const payload = { ...form };
        if (!payload.u_password) delete payload.u_password;
        const result = await req(`/users/${editId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        if (result.error) return setSaveError(result.error);
        setShowModal(false); load();
      } else {
        const result = await req('/auth/register', { method: 'POST', body: JSON.stringify(form) });
        if (result.error) return setSaveError(result.error);
        if (result.pending) {
          setSaveResult({ type: 'pending', message: result.message, approver: result.approver });
        } else { setShowModal(false); load(); }
      }
    } catch (e) { setSaveError(e.message); }
    finally { setSaving(false); }
  };

  const actionApproval = async (id, action) => {
    if (action === 'reject' && !rejectionReason.trim()) return alert('Please enter a rejection reason');
    setActionSaving(true);
    try {
      const result = await req(`/auth/pending-users/${id}`, {
        method: 'PATCH', body: JSON.stringify({ action, rejection_reason: rejectionReason }),
      });
      if (result.error) return alert(result.error);
      setSelectedApproval(null); setRejectionReason(''); load();
    } catch (e) { alert(e.message); }
    finally { setActionSaving(false); }
  };

  const filtered = data.filter(u =>
    (!activeFilter || u.u_active === activeFilter) &&
    (!roleFilter || u.u_role === roleFilter)
  );

  return (
    <div>
      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Total Users</div><div className="stat-value">{data.length}</div></div>
        <div className="stat-card"><div className="stat-label">Admins</div><div className="stat-value" style={{ color: '#e53e3e' }}>{data.filter(u => u.u_role === ROLES.ADMIN).length}</div></div>
        <div className="stat-card"><div className="stat-label">Operators</div><div className="stat-value" style={{ color: '#00AEEF' }}>{data.filter(u => u.u_role === ROLES.OPERATOR).length}</div></div>
        <div className="stat-card"><div className="stat-label">Pending Approvals</div><div className="stat-value" style={{ color: pendingApprovals.length > 0 ? '#d97706' : '#059669' }}>{pendingApprovals.length}</div></div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e8edf2', marginBottom: 16, gap: 4, overflowX: 'auto' }}>
        <div style={tabStyle(tab === 'users')} onClick={() => setTab('users')}>Users</div>
        {canManageUsers(currentUser) && (
          <div style={tabStyle(tab === 'add')} onClick={() => { setTab('add'); openAdd(); }}>+ Add User</div>
        )}
        <div style={tabStyle(tab === 'approvals')} onClick={() => setTab('approvals')}>
          Pending {pendingApprovals.length > 0 && (
            <span style={{ marginLeft: 5, background: '#e53e3e', color: 'white', borderRadius: 10, padding: '1px 6px', fontSize: 11 }}>
              {pendingApprovals.length}
            </span>
          )}
        </div>
        {isAdmin && (
          <div style={tabStyle(tab === 'roles')} onClick={() => setTab('roles')}>🔑 User Roles</div>
        )}
      </div>

      {/* ── USERS TAB ── */}
      {tab === 'users' && (
        <>
          <div className="filter-bar">
            <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
              <option value="">All Roles</option>
              {(allRoles.length > 0 ? allRoles : Object.entries(ROLE_LABELS).map(([k,v]) => ({role_key:k, role_label:v})))
                .map(r => <option key={r.role_key} value={r.role_key}>{r.role_label}</option>)}
            </select>
            <select value={activeFilter} onChange={e => setActiveFilter(e.target.value)}>
              <option value="">All</option>
              <option value="Y">Active</option>
              <option value="N">Inactive</option>
            </select>
            {canManageUsers(currentUser) && (
              <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add User</button>
            )}
            <button className="btn btn-sm" onClick={() => exportCSV(data)}>⬇ Export CSV</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Username</th><th>Full Name</th><th>Email</th><th>Role</th><th>Region</th><th>Active</th></tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={6}><div className="loading">Loading users…</div></td></tr>}
                {!loading && filtered.length === 0 && <tr><td colSpan={6}><div className="empty-state">No users found</div></td></tr>}
                {!loading && filtered.map(u => (
                  <tr key={u.u_id} onClick={() => canManageUsers(currentUser) && openEdit(u)} style={{ cursor: canManageUsers(currentUser) ? 'pointer' : 'default' }}>
                    <td className="mono" style={{ fontWeight: 600 }}>{u.u_username}</td>
                    <td>{u.u_name || '—'}</td>
                    <td>{u.u_email || '—'}</td>
                    <td><span className={`badge ${ROLE_BADGE_COLORS[u.u_role] || 'badge-gray'}`}>{ROLE_LABELS[u.u_role] || u.u_role}</span></td>
                    <td>{u.u_region || '—'}</td>
                    <td><span className={`badge ${u.u_active === 'Y' ? 'badge-green' : 'badge-red'}`}>{u.u_active === 'Y' ? 'Active' : 'Inactive'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── APPROVALS TAB ── */}
      {tab === 'approvals' && (
        <div className="table-wrap">
          {pendingApprovals.length === 0 ? (
            <div className="empty-state" style={{ padding: 40 }}>No pending user approvals</div>
          ) : (
            <table>
              <thead>
                <tr><th>Username</th><th>Name</th><th>Role</th><th>Requested By</th><th>Date</th><th>Action</th></tr>
              </thead>
              <tbody>
                {pendingApprovals.map(a => (
                  <tr key={a.id}>
                    <td className="mono">{a.ua_username}</td>
                    <td>{a.ua_name || '—'}</td>
                    <td><span className={`badge ${ROLE_BADGE_COLORS[a.ua_role] || 'badge-gray'}`}>{ROLE_LABELS[a.ua_role] || a.ua_role}</span></td>
                    <td>{a.ua_requested_by}</td>
                    <td>{new Date(a.created_at).toLocaleDateString('en-ZA')}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-primary btn-sm" onClick={() => actionApproval(a.id, 'approve')}>Approve</button>
                      <button className="btn btn-sm" style={{ color: '#e53e3e' }} onClick={() => setSelectedApproval(a)}>Reject</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── ROLES TAB ── */}
      {tab === 'roles' && isAdmin && <RoleManagerPanel />}

      {/* Reject reason modal */}
      {selectedApproval && (
        <div className="modal-overlay" onClick={() => setSelectedApproval(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Reject User Request</h3>
              <button onClick={() => setSelectedApproval(null)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: 12, fontSize: 13 }}>Rejecting: <strong>{selectedApproval.ua_username}</strong> ({ROLE_LABELS[selectedApproval.ua_role]})</p>
              <div className="form-group">
                <label>Rejection Reason *</label>
                <textarea rows={3} value={rejectionReason} onChange={e => setRejectionReason(e.target.value)}
                  placeholder="Please provide a reason..." style={{ width: '100%', resize: 'vertical' }} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setSelectedApproval(null)}>Cancel</button>
              <button className="btn" style={{ background: '#e53e3e', color: 'white' }}
                onClick={() => actionApproval(selectedApproval.id, 'reject')} disabled={actionSaving}>
                {actionSaving ? 'Saving…' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit User Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editId ? 'Edit User' : 'Add New User'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              {saveError && (
                <div style={{ background: '#fff5f5', border: '1px solid #fca5a5', borderRadius: 4, padding: '10px 14px', marginBottom: 12, color: '#e53e3e', fontSize: 13 }}>
                  ⚠ {saveError}
                </div>
              )}
              {saveResult?.type === 'pending' && (
                <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 4, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
                  <strong>⏳ Approval Required</strong><br />
                  {saveResult.message}<br />
                  <span style={{ color: '#666' }}>Approver: {saveResult.approver}</span>
                  <div style={{ marginTop: 10 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => { setShowModal(false); load(); }}>Done</button>
                  </div>
                </div>
              )}
              {!saveResult && (
                <>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Username *</label>
                      <input value={form.u_username} onChange={e => set('u_username', e.target.value)} disabled={!!editId} placeholder="e.g. liam.smith" />
                    </div>
                    <div className="form-group">
                      <label>{editId ? 'New Password (leave blank to keep)' : 'Password *'}</label>
                      <input type="password" value={form.u_password} onChange={e => set('u_password', e.target.value)} placeholder={editId ? '(leave blank to keep current)' : 'Min 8 characters'} />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Full Name</label>
                      <input value={form.u_name} onChange={e => set('u_name', e.target.value)} placeholder="e.g. Liam Smith" />
                    </div>
                    <div className="form-group">
                      <label>Email</label>
                      <input type="email" value={form.u_email} onChange={e => set('u_email', e.target.value)} placeholder="e.g. liam@interland.co.za" />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Role</label>
                      <select value={form.u_role} onChange={e => set('u_role', e.target.value)} disabled={!isAdmin && !!editId}>
                        {(allRoles.length > 0 ? allRoles : Object.entries(ROLE_LABELS).map(([k,v]) => ({role_key:k, role_label:v})))
                          .filter(r => BUILTIN_ROLE_KEYS.has(r.role_key))
                          .filter(r => isAdmin || r.role_key !== ROLES.ADMIN)
                          .map(r => <option key={r.role_key} value={r.role_key}>{r.role_label}</option>)}
                      </select>
                    </div>
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
                </>
              )}
            </div>
            {!saveResult && (
              <div className="modal-footer">
                <button className="btn" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : editId ? 'Update User' : 'Add User'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


