import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../lib/AuthContext';
import {
  canViewInventory, canCreateInventoryItems,
  canApproveInventoryItems, canAdjustInventory,
  ROLES,
} from '../lib/roles';

const API = `${import.meta.env.VITE_API_URL}/api`;

const CATEGORIES = ['Tyres','Lubricants','Filters','Belts & Hoses','Brakes',
                    'Electrical','Bodywork','Tools','Safety','Consumables','Other'];
const UOM_OPTIONS = ['Each','Litre','KG','Box','Set','Metre','Pair','Roll'];

function StatusBadge({ status }) {
  const map = {
    PENDING_APPROVAL: 'bg-amber-100 text-amber-800',
    ACTIVE:           'bg-green-100 text-green-800',
    SUSPENDED:        'bg-red-100 text-red-800',
    DISCONTINUED:     'bg-gray-200 text-gray-600',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NEW ITEM FORM
// ─────────────────────────────────────────────────────────────────────────────
function NewItemModal({ onClose, onSaved, token }) {
  const [form, setForm] = useState({
    item_name: '', item_description: '', item_category: 'Other',
    unit_of_measure: 'Each', reorder_level: '', reorder_qty: '',
    supplier_code: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSave = async () => {
    if (!form.item_name.trim()) { setError('Item name is required'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`${API}/stock/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create item');
      onSaved(data);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-bold text-lg text-gray-800">New Inventory Item</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <div className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">{error}</div>}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Item Name <span className="text-red-500">*</span></label>
            <input value={form.item_name} onChange={set('item_name')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g. Truck Air Filter — Volvo FH440" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select value={form.item_category} onChange={set('item_category')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Unit of Measure</label>
              <select value={form.unit_of_measure} onChange={set('unit_of_measure')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
                {UOM_OPTIONS.map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={form.item_description} onChange={set('item_description')} rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              placeholder="Part numbers, specifications, compatible vehicles..." />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reorder Level</label>
              <input type="number" min="0" value={form.reorder_level} onChange={set('reorder_level')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                placeholder="0" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reorder Qty</label>
              <input type="number" min="0" value={form.reorder_qty} onChange={set('reorder_qty')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                placeholder="0" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Preferred Supplier Code</label>
            <input value={form.supplier_code} onChange={set('supplier_code')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              placeholder="Optional — e.g. SHE001" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              placeholder="Storage location, hazard notes, etc." />
          </div>

          <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
            This item will be sent to the Workshop Assistant for approval before it can be used on Purchase Orders.
          </div>
        </div>
        <div className="px-6 py-4 border-t flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Submit for Approval'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ITEM DETAIL PANEL
// ─────────────────────────────────────────────────────────────────────────────
function ItemDetailPanel({ itemId, token, user, onClose, onUpdated }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rejReason, setRejReason] = useState('');
  const [acting, setActing] = useState(false);

  useEffect(() => {
    fetch(`${API}/stock/items/${itemId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(d => { setDetail(d); setLoading(false); });
  }, [itemId, token]);

  const doApproval = async (action) => {
    if (action === 'REJECT' && !rejReason.trim()) {
      alert('Please enter a rejection reason'); return;
    }
    setActing(true);
    const res = await fetch(`${API}/stock/items/${itemId}/approve`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, rejection_reason: rejReason }),
    });
    const data = await res.json();
    setActing(false);
    if (res.ok) { onUpdated(); onClose(); }
    else alert(data.error);
  };

  if (loading) return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-8 text-gray-500">Loading…</div>
    </div>
  );

  const { item, transactions } = detail || {};
  if (!item) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <div className="font-bold text-lg text-gray-800">{item.item_name}</div>
            <div className="text-xs text-gray-500">{item.item_code} · {item.item_category}</div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={item.status} />
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none ml-2">&times;</button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-6 space-y-5">
          {/* Stock summary */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'On Hand', value: item.qty_on_hand, color: 'text-green-700' },
              { label: 'On Order', value: item.qty_on_order, color: 'text-blue-700' },
              { label: 'Reserved', value: item.qty_reserved, color: 'text-amber-700' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-gray-50 rounded-xl p-3 text-center">
                <div className={`text-2xl font-bold ${color}`}>{Number(value || 0).toFixed(1)}</div>
                <div className="text-xs text-gray-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>

          {/* Item details */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div><span className="text-gray-500">Unit:</span> <span className="font-medium">{item.unit_of_measure}</span></div>
            <div><span className="text-gray-500">GL Account:</span> <span className="font-medium">{item.gl_account_code} — Inventory Control</span></div>
            <div><span className="text-gray-500">Last Cost:</span> <span className="font-medium">R {Number(item.last_cost || 0).toFixed(2)}</span></div>
            <div><span className="text-gray-500">Avg Cost:</span> <span className="font-medium">R {Number(item.average_cost || 0).toFixed(2)}</span></div>
            <div><span className="text-gray-500">Reorder at:</span> <span className="font-medium">{item.reorder_level} {item.unit_of_measure}</span></div>
            <div><span className="text-gray-500">Reorder qty:</span> <span className="font-medium">{item.reorder_qty} {item.unit_of_measure}</span></div>
            {item.supplier_code && <div><span className="text-gray-500">Pref. Supplier:</span> <span className="font-medium">{item.supplier_code}</span></div>}
            <div><span className="text-gray-500">Created by:</span> <span className="font-medium">{item.created_by}</span></div>
          </div>

          {item.item_description && (
            <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-700">{item.item_description}</div>
          )}

          {/* Approval actions */}
          {item.status === 'PENDING_APPROVAL' && canApproveInventoryItems(user) && (
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 space-y-3">
              <div className="font-semibold text-amber-800 text-sm">Pending Your Approval</div>
              <textarea value={rejReason} onChange={e => setRejReason(e.target.value)} rows={2}
                className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm bg-white"
                placeholder="Rejection reason (required if rejecting)..." />
              <div className="flex gap-2">
                <button onClick={() => doApproval('APPROVE')} disabled={acting}
                  className="flex-1 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50">
                  ✓ Approve
                </button>
                <button onClick={() => doApproval('REJECT')} disabled={acting}
                  className="flex-1 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50">
                  ✗ Reject
                </button>
              </div>
            </div>
          )}

          {/* Recent transactions */}
          {transactions?.length > 0 && (
            <div>
              <div className="font-semibold text-sm text-gray-700 mb-2">Recent Transactions</div>
              <div className="space-y-1">
                {transactions.slice(0, 10).map(t => (
                  <div key={t.txn_id} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-gray-500">{t.txn_date}</span>
                    <span className="text-gray-700">{t.txn_type.replace('_', ' ')}</span>
                    <span className="text-gray-500">{t.txn_ref}</span>
                    <span className={`font-semibold ${t.qty >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {t.qty >= 0 ? '+' : ''}{t.qty} {item.unit_of_measure}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN INVENTORY PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function Inventory() {
  const { user, token } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [showNew, setShowNew] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  if (!canViewInventory(user)) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        You do not have access to Inventory.
      </div>
    );
  }

  const loadItems = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`${API}/stock/items`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setItems(await res.json());
    setLoading(false);
  }, [token]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const filtered = items.filter(item => {
    const matchSearch = !search ||
      item.item_name.toLowerCase().includes(search.toLowerCase()) ||
      item.item_code.toLowerCase().includes(search.toLowerCase()) ||
      (item.item_description || '').toLowerCase().includes(search.toLowerCase());
    const matchCat = filterCat === 'ALL' || item.item_category === filterCat;
    const matchStat = filterStatus === 'ALL' || item.status === filterStatus;
    return matchSearch && matchCat && matchStat;
  });

  const pendingApproval = items.filter(i => i.status === 'PENDING_APPROVAL');
  const lowStock = items.filter(i => i.status === 'ACTIVE' && i.qty_on_hand <= i.reorder_level && i.reorder_level > 0);

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500 mt-0.5">{items.filter(i => i.status === 'ACTIVE').length} active items</p>
        </div>
        {canCreateInventoryItems(user) && (
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-blue-700">
            + New Item
          </button>
        )}
      </div>

      {/* Alert tiles */}
      {(pendingApproval.length > 0 || lowStock.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {canApproveInventoryItems(user) && pendingApproval.length > 0 && (
            <button onClick={() => setFilterStatus('PENDING_APPROVAL')}
              className="text-left bg-amber-50 border border-t-4 border-amber-400 rounded-xl p-4">
              <div className="text-2xl font-bold text-amber-700">{pendingApproval.length}</div>
              <div className="text-sm font-medium text-amber-800">Items Awaiting Approval</div>
            </button>
          )}
          {lowStock.length > 0 && (
            <div className="bg-red-50 border border-t-4 border-red-400 rounded-xl p-4">
              <div className="text-2xl font-bold text-red-700">{lowStock.length}</div>
              <div className="text-sm font-medium text-red-800">Items Below Reorder Level</div>
              <div className="text-xs text-red-600 mt-1">{lowStock.slice(0,3).map(i => i.item_name).join(', ')}{lowStock.length > 3 ? '…' : ''}</div>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 border border-gray-300 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="Search items…" />
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
          className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
          <option value="ALL">All Categories</option>
          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
          <option value="ALL">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PENDING_APPROVAL">Pending Approval</option>
          <option value="SUSPENDED">Suspended</option>
        </select>
      </div>

      {/* Items grid */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading inventory…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          {search ? 'No items match your search.' : 'No inventory items yet.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(item => {
            const isLow = item.status === 'ACTIVE' && item.reorder_level > 0 && item.qty_on_hand <= item.reorder_level;
            return (
              <button key={item.item_id}
                onClick={() => setSelectedId(item.item_id)}
                className={`text-left bg-white rounded-2xl shadow-sm border hover:shadow-md transition-all p-4 space-y-3 ${isLow ? 'border-red-200' : 'border-gray-100'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-gray-900 text-sm leading-tight">{item.item_name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{item.item_code}</div>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{item.item_category}</span>
                  <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{item.unit_of_measure}</span>
                  {isLow && <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">⚠ Low Stock</span>}
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-gray-50">
                  <div className="text-center">
                    <div className={`text-lg font-bold ${isLow ? 'text-red-600' : 'text-gray-800'}`}>
                      {Number(item.qty_on_hand || 0).toFixed(1)}
                    </div>
                    <div className="text-xs text-gray-400">On Hand</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-blue-600">{Number(item.qty_on_order || 0).toFixed(1)}</div>
                    <div className="text-xs text-gray-400">On Order</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-gray-700">R {Number(item.average_cost || 0).toFixed(0)}</div>
                    <div className="text-xs text-gray-400">Avg Cost</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Modals */}
      {showNew && (
        <NewItemModal
          token={token}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); loadItems(); }}
        />
      )}
      {selectedId && (
        <ItemDetailPanel
          itemId={selectedId}
          token={token}
          user={user}
          onClose={() => setSelectedId(null)}
          onUpdated={loadItems}
        />
      )}
    </div>
  );
}
