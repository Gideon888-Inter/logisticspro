import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { ROLES, ROLE_LABELS, ROLE_BADGE_COLORS, canManageUsers } from '../lib/roles';

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
  u_username: '', u_password: '', u_name: '', u_email: '',
  u_role: ROLES.OPERATOR, u_bus_unit: 'IDC', u_active: 'Y', u_region: '',
};

function exportCSV(data) {
  const headers = ['Username', 'Name', 'Email', 'Role', 'Business Unit', 'Region', 'Active'];
  const rows = data.map(u => [
    u.u_username, u.u_name || '', u.u_email || '',
    ROLE_LABELS[u.u_role] || u.u_role, u.u_bus_unit || '', u.u_region || '',
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
  const isAdmin = currentUser?.role === ROLES.ADMIN;

  const [data, setData] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('Y');
  const [roleFilter, setRoleFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [saveResult, setSaveResult] = useState(null);
  const [tab, setTab] = useState('users');
  const [selectedApproval, setSelectedApproval] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [actionSaving, setActionSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [usersRes, approvalsRes] = await Promise.all([
        req('/users'),
        req('/auth/pending-users').catch(() => []),
      ]);
      setData(Array.isArray(usersRes) ? usersRes : usersRes.data || []);
      setPendingApprovals(Array.isArray(approvalsRes) ? approvalsRes : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => { setForm(EMPTY); setEditId(null); setSaveError(''); setSaveResult(null); setShowModal(true); };
  const openEdit = (u) => { setForm({ ...EMPTY, ...u, u_password: '' }); setEditId(u.u_id); setSaveError(''); setSaveResult(null); setShowModal(true); };
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

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
        setShowModal(false);
        load();
      } else {
        const result = await req('/auth/register', { method: 'POST', body: JSON.stringify(form) });
        if (result.error) return setSaveError(result.error);
        if (result.pending) {
          setSaveResult({ type: 'pending', message: result.message, approver: result.approver });
        } else {
          setShowModal(false);
          load();
        }
      }
    } catch (e) { setSaveError(e.message); }
    finally { setSaving(false); }
  };

  const actionApproval = async (id, action) => {
    if (action === 'reject' && !rejectionReason.trim()) return alert('Please enter a rejection reason');
    setActionSaving(true);
    try {
      const result = await req(`/auth/pending-users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action, rejection_reason: rejectionReason }),
      });
      if (result.error) return alert(result.error);
      setSelectedApproval(null);
      setRejectionReason('');
      load();
    } catch (e) { alert(e.message); }
    finally { setActionSaving(false); }
  };

  const filtered = data.filter(u =>
    (!activeFilter || u.u_active === activeFilter) &&
    (!roleFilter || u.u_role === roleFilter)
  );

  const tabStyle = (t) => ({
    padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    borderBottom: tab === t ? '2px solid #005A8E' : '2px solid transparent',
    color: tab === t ? '#005A8E' : '#666',
  });

  return (
    <div>
      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Total Users</div><div className="stat-value">{data.length}</div></div>
        <div className="stat-card"><div className="stat-label">Admins</div><div className="stat-value" style={{ color:'#e53e3e' }}>{data.filter(u => u.u_role === ROLES.ADMIN).length}</div></div>
        <div className="stat-card"><div className="stat-label">Operators</div><div className="stat-value" style={{ color:'#00AEEF' }}>{data.filter(u => u.u_role === ROLES.OPERATOR).length}</div></div>
        <div className="stat-card"><div className="stat-label">Pending Approvals</div><div className="stat-value" style={{ color: pendingApprovals.length > 0 ? '#d97706' : '#059669' }}>{pendingApprovals.length}</div></div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid #e8edf2', marginBottom:16 }}>
        <div style={tabStyle('users')} onClick={() => setTab('users')}>Active Users</div>
        <div style={tabStyle('approvals')} onClick={() => setTab('approvals')}>
          Pending Approvals {pendingApprovals.length > 0 && <span style={{ marginLeft:6, background:'#e53e3e', color:'white', borderRadius:10, padding:'1px 6px', fontSize:11 }}>{pendingApprovals.length}</span>}
        </div>
      </div>

      {/* ── USERS TAB ── */}
      {tab === 'users' && (
        <>
          <div className="filter-bar">
            <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
              <option value="">All roles</option>
              {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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
                    <td>
                      <button className="btn btn-primary btn-sm" style={{ marginRight:6 }} onClick={() => actionApproval(a.id, 'approve')}>Approve</button>
                      <button className="btn btn-sm" style={{ color:'#e53e3e' }} onClick={() => setSelectedApproval(a)}>Reject</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Reject reason modal */}
      {selectedApproval && (
        <div className="modal-overlay" onClick={() => setSelectedApproval(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Reject User Request</h3>
              <button onClick={() => setSelectedApproval(null)} style={{ background:'none', border:'none', color:'white', cursor:'pointer', fontSize:18 }}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom:12, fontSize:13 }}>Rejecting request for <strong>{selectedApproval.ua_username}</strong> ({ROLE_LABELS[selectedApproval.ua_role]})</p>
              <div className="form-group">
                <label>Rejection Reason *</label>
                <textarea
                  rows={3}
                  value={rejectionReason}
                  onChange={e => setRejectionReason(e.target.value)}
                  placeholder="Please provide a reason..."
                  style={{ width:'100%', resize:'vertical' }}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setSelectedApproval(null)}>Cancel</button>
              <button className="btn" style={{ background:'#e53e3e', color:'white' }} onClick={() => actionApproval(selectedApproval.id, 'reject')} disabled={actionSaving}>
                {actionSaving ? 'Saving…' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editId ? 'Edit User' : 'Add New User'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background:'none', border:'none', color:'white', cursor:'pointer', fontSize:18 }}>✕</button>
            </div>
            <div className="modal-body">
              {saveError && (
                <div style={{ background:'#fff5f5', border:'1px solid #fca5a5', borderRadius:4, padding:'10px 14px', marginBottom:12, color:'#e53e3e', fontSize:13 }}>
                  ⚠ {saveError}
                </div>
              )}
              {saveResult?.type === 'pending' && (
                <div style={{ background:'#fffbeb', border:'1px solid #fcd34d', borderRadius:4, padding:'10px 14px', marginBottom:12, fontSize:13 }}>
                  <strong>⏳ Approval Required</strong><br />
                  {saveResult.message}<br />
                  <span style={{ color:'#666' }}>Approver: {saveResult.approver}</span>
                  <div style={{ marginTop:10 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => { setShowModal(false); load(); }}>Done</button>
                  </div>
                </div>
              )}
              {!saveResult && (
                <>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Username *</label>
                      <input value={form.u_username} onChange={e => set('u_username', e.target.value)} disabled={!!editId} placeholder="e.g. jsmith" />
                    </div>
                    <div className="form-group">
                      <label>{editId ? 'New Password (leave blank to keep)' : 'Password *'}</label>
                      <input type="password" value={form.u_password} onChange={e => set('u_password', e.target.value)} placeholder={editId ? '(leave blank to keep current)' : 'Min 8 characters'} />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Full Name</label>
                      <input value={form.u_name} onChange={e => set('u_name', e.target.value)} placeholder="e.g. John Smith" />
                    </div>
                    <div className="form-group">
                      <label>Email</label>
                      <input type="email" value={form.u_email} onChange={e => set('u_email', e.target.value)} placeholder="e.g. jsmith@company.co.za" />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Role</label>
                      <select value={form.u_role} onChange={e => set('u_role', e.target.value)} disabled={!isAdmin && !!editId}>
                        {Object.entries(ROLE_LABELS)
                          .filter(([k]) => isAdmin || k !== ROLES.ADMIN)
                          .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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
