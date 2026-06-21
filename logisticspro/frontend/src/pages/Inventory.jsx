import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { canCreateInventoryItems, canApproveInventoryItems } from '../lib/roles';

const API = `${import.meta.env.VITE_API_URL}/api`;
const token = () => localStorage.getItem('lp_token');
const req = (path, opts = {}) =>
  fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token(),
      ...(opts.headers || {}),
    },
  }).then(r => r.json());

const CATEGORIES = ['Tyres', 'Lubricants', 'Filters', 'Parts', 'Tools', 'Consumables', 'Other'];
const UOM_OPTIONS = ['Each', 'Litre', 'KG', 'Box', 'Set', 'Metre', 'Pair'];

const STATUS_BADGE = {
  PENDING_APPROVAL: 'badge-amber',
  ACTIVE:           'badge-green',
  SUSPENDED:        'badge-red',
  DISCONTINUED:     'badge-gray',
};
const STATUS_LABEL = {
  PENDING_APPROVAL: 'Pending',
  ACTIVE:           'Active',
  SUSPENDED:        'Suspended',
  DISCONTINUED:     'Discontinued',
};

const EMPTY = {
  item_name: '', item_description: '', item_category: 'Parts',
  unit_of_measure: 'Each', reorder_level: '', reorder_qty: '',
  supplier_code: '', notes: '',
};

export default function InventoryPage() {
  const { user } = useAuth();
  const canCreate  = canCreateInventoryItems(user);
  const canApprove = canApproveInventoryItems(user);

  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm]           = useState(EMPTY);
  const [saving, setSaving]       = useState(false);
  const [selected, setSelected]   = useState(null);  // item detail panel
  const [approving, setApproving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await req('/stock/items');
      setItems(Array.isArray(data) ? data : data.items || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = items.filter(i => {
    const s = search.toLowerCase();
    const matchSearch = !s || i.item_name?.toLowerCase().includes(s) || i.item_code?.toLowerCase().includes(s);
    const matchCat    = !catFilter    || i.item_category === catFilter;
    const matchStatus = !statusFilter || i.status === statusFilter;
    return matchSearch && matchCat && matchStatus;
  });

  const active   = items.filter(i => i.status === 'ACTIVE').length;
  const pending  = items.filter(i => i.status === 'PENDING_APPROVAL').length;
  const lowStock = items.filter(i => i.status === 'ACTIVE' && i.qty_on_hand <= i.reorder_level && i.reorder_level > 0).length;

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.item_name.trim()) return alert('Item name is required');
    setSaving(true);
    try {
      const result = await req('/stock/items', { method: 'POST', body: JSON.stringify(form) });
      if (result.error) { alert(result.error); return; }
      setShowModal(false);
      setForm(EMPTY);
      load();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const approve = async (itemId, action, reason = '') => {
    setApproving(true);
    try {
      const result = await req(`/stock/items/${itemId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ action, reason }),
      });
      if (result.error) { alert(result.error); return; }
      setSelected(null);
      load();
    } catch (e) { alert(e.message); }
    finally { setApproving(false); }
  };

  return (
    <div>
      {/* ── Stat cards ── */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Items</div>
          <div className="stat-value">{items.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active</div>
          <div className="stat-value" style={{ color: '#00AEEF' }}>{active}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pending Approval</div>
          <div className="stat-value" style={{ color: pending > 0 ? '#d97706' : '#00AEEF' }}>{pending}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Low Stock</div>
          <div className="stat-value" style={{ color: lowStock > 0 ? '#e53e3e' : '#00AEEF' }}>{lowStock}</div>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="filter-bar">
        <input
          placeholder="Search item code or name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PENDING_APPROVAL">Pending</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="DISCONTINUED">Discontinued</option>
        </select>
        {canCreate && (
          <button className="btn btn-primary btn-sm" onClick={() => { setForm(EMPTY); setShowModal(true); }}>
            + New Item
          </button>
        )}
      </div>

      {/* ── Table ── */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Item Name</th>
              <th>Category</th>
              <th>UOM</th>
              <th>On Hand</th>
              <th>On Order</th>
              <th>Last Cost</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8}><div className="loading">Loading inventory…</div></td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={8}><div className="empty-state">No inventory items found</div></td></tr>
            )}
            {!loading && filtered.map(item => (
              <tr key={item.item_id} onClick={() => setSelected(item)}>
                <td className="mono" style={{ fontWeight: 600 }}>{item.item_code}</td>
                <td>{item.item_name}</td>
                <td>{item.item_category}</td>
                <td>{item.unit_of_measure}</td>
                <td style={{ color: item.qty_on_hand <= item.reorder_level && item.reorder_level > 0 ? '#e53e3e' : 'inherit', fontWeight: 600 }}>
                  {Number(item.qty_on_hand || 0).toFixed(2)}
                </td>
                <td>{Number(item.qty_on_order || 0).toFixed(2)}</td>
                <td>R {Number(item.last_cost || 0).toFixed(2)}</td>
                <td>
                  <span className={`badge ${STATUS_BADGE[item.status] || 'badge-gray'}`}>
                    {STATUS_LABEL[item.status] || item.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── New Item Modal ── */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>New Inventory Item</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label>Item Name *</label>
                  <input value={form.item_name} onChange={e => set('item_name', e.target.value)} placeholder="e.g. Oil Filter — Mann W712/75" />
                </div>
                <div className="form-group">
                  <label>Category</label>
                  <select value={form.item_category} onChange={e => set('item_category', e.target.value)}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Unit of Measure</label>
                  <select value={form.unit_of_measure} onChange={e => set('unit_of_measure', e.target.value)}>
                    {UOM_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Preferred Supplier Code</label>
                  <input value={form.supplier_code} onChange={e => set('supplier_code', e.target.value.toUpperCase())} placeholder="e.g. SUP001" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Reorder Level</label>
                  <input type="number" value={form.reorder_level} onChange={e => set('reorder_level', e.target.value)} placeholder="0" />
                </div>
                <div className="form-group">
                  <label>Reorder Qty</label>
                  <input type="number" value={form.reorder_qty} onChange={e => set('reorder_qty', e.target.value)} placeholder="0" />
                </div>
              </div>
              <div className="form-group">
                <label>Description / Notes</label>
                <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="Optional description or part number reference" style={{ width: '100%', resize: 'vertical' }} />
              </div>
              <p style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
                ℹ️ New items are submitted for Workshop Assistant approval before becoming available on POs.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Item Detail / Approval Panel ── */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h3>{selected.item_code} — {selected.item_name}</h3>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label>Category</label>
                  <div style={{ fontWeight: 600 }}>{selected.item_category}</div>
                </div>
                <div className="form-group">
                  <label>Unit of Measure</label>
                  <div style={{ fontWeight: 600 }}>{selected.unit_of_measure}</div>
                </div>
                <div className="form-group">
                  <label>Status</label>
                  <span className={`badge ${STATUS_BADGE[selected.status] || 'badge-gray'}`}>
                    {STATUS_LABEL[selected.status] || selected.status}
                  </span>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Qty On Hand</label>
                  <div style={{ fontWeight: 600, fontSize: 18, color: '#005A8E' }}>{Number(selected.qty_on_hand || 0).toFixed(2)}</div>
                </div>
                <div className="form-group">
                  <label>Qty On Order</label>
                  <div style={{ fontWeight: 600 }}>{Number(selected.qty_on_order || 0).toFixed(2)}</div>
                </div>
                <div className="form-group">
                  <label>Last Cost (excl)</label>
                  <div style={{ fontWeight: 600 }}>R {Number(selected.last_cost || 0).toFixed(2)}</div>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Reorder Level</label>
                  <div>{Number(selected.reorder_level || 0).toFixed(2)}</div>
                </div>
                <div className="form-group">
                  <label>Reorder Qty</label>
                  <div>{Number(selected.reorder_qty || 0).toFixed(2)}</div>
                </div>
                <div className="form-group">
                  <label>GL Account</label>
                  <div className="mono">{selected.gl_account_code}</div>
                </div>
              </div>
              {selected.notes && (
                <div className="form-group">
                  <label>Notes</label>
                  <div style={{ color: '#555' }}>{selected.notes}</div>
                </div>
              )}
              <div className="form-row" style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
                <div>Created by: <strong>{selected.created_by}</strong></div>
                {selected.approved_by && <div>Approved by: <strong>{selected.approved_by}</strong></div>}
              </div>
            </div>
            {canApprove && selected.status === 'PENDING_APPROVAL' && (
              <div className="modal-footer" style={{ gap: 8 }}>
                <button className="btn" onClick={() => setSelected(null)}>Close</button>
                <button
                  className="btn"
                  style={{ background: '#e53e3e', color: 'white' }}
                  onClick={() => {
                    const reason = prompt('Rejection reason (required):');
                    if (reason?.trim()) approve(selected.item_id, 'REJECT', reason);
                  }}
                  disabled={approving}
                >
                  Reject
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => approve(selected.item_id, 'APPROVE')}
                  disabled={approving}
                >
                  {approving ? 'Approving…' : '✓ Approve Item'}
                </button>
              </div>
            )}
            {(!canApprove || selected.status !== 'PENDING_APPROVAL') && (
              <div className="modal-footer">
                <button className="btn btn-primary" onClick={() => setSelected(null)}>Close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
