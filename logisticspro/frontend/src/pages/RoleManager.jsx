import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../lib/AuthContext';
import { ROLES } from '../lib/roles';

const API = import.meta.env.VITE_API_URL;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const BADGE_OPTIONS = [
  { value: 'badge-red',    label: 'Red' },
  { value: 'badge-amber',  label: 'Amber' },
  { value: 'badge-blue',   label: 'Blue' },
  { value: 'badge-green',  label: 'Green' },
  { value: 'badge-purple', label: 'Purple' },
  { value: 'badge-gray',   label: 'Gray' },
];

const BUILTIN_ROLE_KEYS = new Set([
  'ADMIN','MANAGER','OPERATOR','OPS_ASSISTANT','CONTROL_ROOM',
  'FINANCE','WORKSHOP_MANAGER','WORKSHOP_ASSISTANT','STOCK_CONTROLLER',
  'WORKSHOP','READONLY',
]);

function apiFetch(path, token, opts = {}) {
  return fetch(`${API}/api/roles${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  }).then(r => r.json());
}

function Badge({ color, label }) {
  const colorMap = {
    'badge-red':    'bg-red-100 text-red-800',
    'badge-amber':  'bg-amber-100 text-amber-800',
    'badge-blue':   'bg-blue-100 text-blue-800',
    'badge-green':  'bg-green-100 text-green-700',
    'badge-purple': 'bg-purple-100 text-purple-800',
    'badge-gray':   'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${colorMap[color] || colorMap['badge-gray']}`}>
      {label}
    </span>
  );
}

function PermToggle({ checked, disabled, onChange, label }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      title={disabled ? 'Built-in — managed in auth.js' : label}
      className={`w-8 h-8 rounded-lg text-xs font-bold transition-all border
        ${checked
          ? 'bg-green-500 text-white border-green-500'
          : 'bg-gray-100 text-gray-400 border-gray-200'}
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-80 cursor-pointer'}`}>
      {checked ? '✓' : '–'}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Permission Matrix Panel
// ─────────────────────────────────────────────────────────────
function PermissionMatrix({ roleKey, isBuiltin, token, onSaved }) {
  const [matrix, setMatrix] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [dirty, setDirty]     = useState(false);

  useEffect(() => {
    setLoading(true); setDirty(false);
    apiFetch(`/${roleKey}`, token)
      .then(d => { setMatrix(d.permissions || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [roleKey, token]);

  const toggle = (moduleKey, action) => {
    if (isBuiltin) return;
    setMatrix(m => m.map(row =>
      row.module_key === moduleKey
        ? { ...row, [action]: !row[action] }
        : row
    ));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true); setError('');
    const result = await apiFetch(`/${roleKey}/permissions`, token, {
      method: 'PUT',
      body: JSON.stringify({ permissions: matrix }),
    });
    setSaving(false);
    if (result.error) { setError(result.error); return; }
    setDirty(false);
    onSaved?.();
  };

  const handleDownloadMigration = async () => {
    const res = await fetch(`${API}/roles/${roleKey}/generate-migration`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `migration_add_roles.sql`;
    a.click();
  };

  if (loading) return <div className="p-6 text-gray-400 text-sm">Loading permissions…</div>;

  // Group by module_group
  const groups = {};
  for (const row of matrix) {
    const g = row.module_group || 'Other';
    if (!groups[g]) groups[g] = [];
    groups[g].push(row);
  }

  return (
    <div className="space-y-4">
      {isBuiltin && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
          Built-in role — permissions shown for reference. To change a built-in role's access, edit <code className="font-mono text-xs bg-amber-100 px-1 rounded">auth.js</code>.
        </div>
      )}
      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{error}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 border-b border-gray-100">
              <th className="text-left pb-2 pl-2 font-medium">Module</th>
              <th className="text-center pb-2 w-16 font-medium">View</th>
              <th className="text-center pb-2 w-16 font-medium">Edit</th>
              <th className="text-center pb-2 w-16 font-medium">Delete</th>
              <th className="text-center pb-2 w-16 font-medium">Approve</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(groups).map(([group, rows]) => (
              <>
                <tr key={group + '-header'}>
                  <td colSpan={5} className="pt-4 pb-1 pl-2">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{group}</span>
                  </td>
                </tr>
                {rows.map(row => (
                  <tr key={row.module_key} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 pl-2 pr-4">
                      <div className="font-medium text-gray-800">{row.module_label}</div>
                    </td>
                    {['can_view','can_edit','can_delete','can_approve'].map(action => (
                      <td key={action} className="py-2 text-center">
                        <PermToggle
                          checked={!!row[action]}
                          disabled={isBuiltin}
                          onChange={v => toggle(row.module_key, action)}
                          label={`${action.replace('can_','')} ${row.module_label}`}
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

      {!isBuiltin && (
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <button onClick={handleDownloadMigration}
            className="text-xs text-blue-600 hover:underline">
            ↓ Download constraint migration SQL
          </button>
          <button onClick={handleSave} disabled={saving || !dirty}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-40">
            {saving ? 'Saving…' : dirty ? 'Save Permissions' : 'Saved'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// New Role Form
// ─────────────────────────────────────────────────────────────
function NewRoleModal({ token, onClose, onCreated }) {
  const [form, setForm] = useState({
    role_key: '', role_label: '', role_group: 'Custom',
    badge_color: 'badge-gray', description: '', base_role: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  // Auto-generate role_key from label
  const onLabelChange = e => {
    const label = e.target.value;
    const key = label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    setForm(f => ({ ...f, role_label: label, role_key: key }));
  };

  const handleCreate = async () => {
    if (!form.role_key || !form.role_label) { setError('Role name and key are required'); return; }
    setSaving(true); setError('');
    const result = await apiFetch('', token, {
      method: 'POST',
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (result.error) { setError(result.error); return; }
    onCreated(result.role);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-bold text-lg text-gray-800">New Custom Role</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <div className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role Name <span className="text-red-500">*</span></label>
            <input value={form.role_label} onChange={onLabelChange}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Depot Manager" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role Key (auto-generated) <span className="text-red-500">*</span></label>
            <input value={form.role_key}
              onChange={e => setForm(f => ({ ...f, role_key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g,'') }))}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500"
              placeholder="DEPOT_MANAGER" />
            <p className="text-xs text-gray-400 mt-1">Uppercase letters, digits and underscores only</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Group</label>
              <input value={form.role_group} onChange={set('role_group')}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                placeholder="Custom" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Badge Colour</label>
              <select value={form.badge_color} onChange={set('badge_color')}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
                {BADGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Base Role (optional)</label>
            <select value={form.base_role} onChange={set('base_role')}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
              <option value="">— No base role —</option>
              {[...BUILTIN_ROLE_KEYS].filter(k => k !== 'ADMIN').map(k => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">New role inherits all permissions of the base role, then you add more</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={form.description} onChange={set('description')} rows={2}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              placeholder="What does this role do?" />
          </div>

          <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-700">
            After creating the role, set permissions in the matrix, then download and run the SQL migration to allow users to be assigned this role.
          </div>
        </div>
        <div className="px-6 py-4 border-t flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-xl hover:bg-gray-50">Cancel</button>
          <button onClick={handleCreate} disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create Role'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Role Manager Page
// ─────────────────────────────────────────────────────────────
export default function RoleManager() {
  const { user, token } = useAuth();
  const [roles, setRoles]           = useState({ builtin: [], custom: [] });
  const [loading, setLoading]       = useState(true);
  const [selectedKey, setSelectedKey] = useState(null);
  const [showNew, setShowNew]       = useState(false);
  const [tab, setTab]               = useState('builtin'); // 'builtin' | 'custom'
  const [deactivating, setDeactivating] = useState(null);

  if (user?.role !== ROLES.ADMIN) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        Role management is restricted to Admins only.
      </div>
    );
  }

  const loadRoles = useCallback(async () => {
    setLoading(true);
    const data = await apiFetch('', token);
    setRoles({ builtin: data.builtin || [], custom: data.custom || [] });
    setLoading(false);
  }, [token]);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  const handleDeactivate = async (key) => {
    if (!confirm(`Deactivate role "${key}"? Users with this role will lose access.`)) return;
    setDeactivating(key);
    const result = await apiFetch(`/${key}`, token, { method: 'DELETE' });
    setDeactivating(null);
    if (result.error) { alert(result.error); return; }
    if (selectedKey === key) setSelectedKey(null);
    loadRoles();
  };

  const displayList = tab === 'builtin' ? roles.builtin : roles.custom.filter(r => r.is_active);

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Role Manager</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {roles.builtin.length} built-in · {roles.custom.filter(r => r.is_active).length} custom
          </p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-blue-700">
          + New Role
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Role list */}
        <div className="lg:col-span-1 space-y-3">
          {/* Tabs */}
          <div className="flex gap-2">
            <button onClick={() => setTab('builtin')}
              className={`flex-1 py-2 text-sm font-medium rounded-xl transition-all ${tab === 'builtin' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              Built-in ({roles.builtin.length})
            </button>
            <button onClick={() => setTab('custom')}
              className={`flex-1 py-2 text-sm font-medium rounded-xl transition-all ${tab === 'custom' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              Custom ({roles.custom.filter(r => r.is_active).length})
            </button>
          </div>

          {loading ? (
            <div className="text-center py-8 text-gray-400 text-sm">Loading roles…</div>
          ) : displayList.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">
              {tab === 'custom' ? 'No custom roles yet. Create one →' : 'No roles.'}
            </div>
          ) : (
            displayList.map(role => (
              <button key={role.role_key}
                onClick={() => setSelectedKey(role.role_key)}
                className={`w-full text-left rounded-2xl border p-4 transition-all
                  ${selectedKey === role.role_key
                    ? 'border-blue-400 bg-blue-50 shadow-sm'
                    : 'border-gray-100 bg-white hover:shadow-sm hover:border-gray-200'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge color={role.badge_color} label={role.role_label} />
                    {role.is_builtin && (
                      <span className="text-xs text-gray-400">built-in</span>
                    )}
                  </div>
                  {!role.is_builtin && (
                    <button
                      onClick={e => { e.stopPropagation(); handleDeactivate(role.role_key); }}
                      disabled={deactivating === role.role_key}
                      className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40">
                      {deactivating === role.role_key ? '…' : 'Deactivate'}
                    </button>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-1.5 font-mono">{role.role_key}</div>
                {role.description && (
                  <div className="text-xs text-gray-400 mt-1 line-clamp-2">{role.description}</div>
                )}
                {role.base_role && (
                  <div className="text-xs text-blue-500 mt-1">↗ Inherits {role.base_role}</div>
                )}
              </button>
            ))
          )}
        </div>

        {/* Permission matrix */}
        <div className="lg:col-span-2">
          {selectedKey ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center gap-3 mb-5 pb-4 border-b border-gray-100">
                <div>
                  <div className="font-bold text-gray-900 text-lg">{selectedKey}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {BUILTIN_ROLE_KEYS.has(selectedKey)
                      ? 'Built-in role — view only'
                      : 'Custom role — click cells to toggle permissions'}
                  </div>
                </div>
              </div>
              <PermissionMatrix
                roleKey={selectedKey}
                isBuiltin={BUILTIN_ROLE_KEYS.has(selectedKey)}
                token={token}
                onSaved={loadRoles}
              />
            </div>
          ) : (
            <div className="bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 flex items-center justify-center h-64">
              <div className="text-center text-gray-400">
                <div className="text-3xl mb-2">🔑</div>
                <div className="text-sm">Select a role to view and edit permissions</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Permission legend */}
      <div className="mt-6 bg-gray-50 rounded-xl p-4 text-xs text-gray-500">
        <div className="font-semibold text-gray-700 mb-2">Permission columns explained</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><span className="font-medium text-gray-700">View</span> — Can open and read the module</div>
          <div><span className="font-medium text-gray-700">Edit</span> — Can create and modify records</div>
          <div><span className="font-medium text-gray-700">Delete</span> — Can delete or cancel records</div>
          <div><span className="font-medium text-gray-700">Approve</span> — Can approve, post, or confirm actions</div>
        </div>
        <div className="mt-2 text-gray-400">
          Built-in role permissions are displayed for reference and enforced in <code className="font-mono bg-gray-100 px-1 rounded">auth.js</code>. 
          Only custom role permissions are editable here.
        </div>
      </div>

      {showNew && (
        <NewRoleModal
          token={token}
          onClose={() => setShowNew(false)}
          onCreated={role => {
            setShowNew(false);
            setSelectedKey(role.role_key);
            setTab('custom');
            loadRoles();
          }}
        />
      )}
    </div>
  );
}

