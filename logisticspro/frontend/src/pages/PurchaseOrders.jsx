import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../lib/AuthContext';
import {
  canCreatePO, canViewPOs, canSelectInventoryOnPO,
  hasPOApprovalDuties, myPOApprovalStatuses, canUseCapitalPO,
  PO_STATUS_LABELS, PO_STATUS_COLORS, ROLES,
} from '../lib/roles';

const API = `${import.meta.env.VITE_API_URL}/api`;

function Badge({ status }) {
  const color = PO_STATUS_COLORS[status] || 'bg-gray-100 text-gray-600';
  const colorMap = {
    'badge-gray':   'bg-gray-100 text-gray-600',
    'badge-amber':  'bg-amber-100 text-amber-800',
    'badge-green':  'bg-green-100 text-green-700',
    'badge-blue':   'bg-blue-100 text-blue-700',
    'badge-red':    'bg-red-100 text-red-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${colorMap[color] || color}`}>
      {PO_STATUS_LABELS[status] || status}
    </span>
  );
}

function fmt(n) { return `R ${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`; }

// ─────────────────────────────────────────────────────────────────────────────
// PO FORM — Create / Edit
// ─────────────────────────────────────────────────────────────────────────────
function POForm({ po, token, user, suppliers, vehicles, inventoryItems, onClose, onSaved }) {
  const isNew = !po;
  const [form, setForm] = useState({
    supplier_code:    po?.supplier_code    || '',
    supplier_name:    po?.supplier_name    || '',
    allocation_type:  po?.allocation_type  || 'VEHICLE',
    vehicle_code:     po?.vehicle_code     || '',
    vehicle_name:     po?.vehicle_name     || '',
    po_description:   po?.po_description   || '',
    notes:            po?.notes            || '',
  });
  const [lines, setLines] = useState([
    { line_type: 'COST', description: '', quantity: 1, unit_price_excl: '', vat_type: 'IN_STD',
      gl_account_code: '2050 020', item_id: '', item_code: '', item_name: '', unit_of_measure: 'Each' },
  ]);
  const [attachment, setAttachment] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

  const canInventory = canSelectInventoryOnPO(user);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const onSupplierChange = e => {
    const code = e.target.value;
    const s = suppliers.find(s => s.supplier_code === code);
    setForm(f => ({ ...f, supplier_code: code, supplier_name: s?.supplier_name || code }));
  };

  const onVehicleChange = e => {
    const code = e.target.value;
    const v = vehicles.find(v => v.vh_code === code);
    setForm(f => ({ ...f, vehicle_code: code, vehicle_name: v?.vh_display_name || code }));
  };

  const updateLine = (idx, key, val) => {
    setLines(ls => ls.map((l, i) => {
      if (i !== idx) return l;
      const updated = { ...l, [key]: val };
      // If selecting an inventory item, fill in name/code
      if (key === 'item_id' && val) {
        const item = inventoryItems.find(it => String(it.item_id) === String(val));
        if (item) {
          updated.item_code = item.item_code;
          updated.item_name = item.item_name;
          updated.unit_of_measure = item.unit_of_measure;
          updated.description = item.item_name;
          updated.line_type = 'INVENTORY';
        }
      }
      // Recalc totals
      const qty  = Number(updated.quantity || 1);
      const excl = Number(updated.unit_price_excl || 0);
      const vat  = updated.vat_type === 'IN_STD' ? excl * qty * 0.15 : 0;
      updated.line_total_excl = excl * qty;
      updated.vat_amount      = vat;
      updated.line_total_incl = excl * qty + vat;
      return updated;
    }));
  };

  const addLine = () => setLines(ls => [...ls, {
    line_type: form.allocation_type === 'INVENTORY' ? 'INVENTORY' : 'COST',
    description: '', quantity: 1, unit_price_excl: '', vat_type: 'IN_STD',
    gl_account_code: '2050 020', item_id: '', item_code: '', item_name: '', unit_of_measure: 'Each',
  }]);

  const removeLine = idx => setLines(ls => ls.filter((_, i) => i !== idx));

  const totals = lines.reduce((a, l) => ({
    excl: a.excl + Number(l.line_total_excl || 0),
    vat:  a.vat  + Number(l.vat_amount || 0),
    incl: a.incl + Number(l.line_total_incl || 0),
  }), { excl: 0, vat: 0, incl: 0 });

  const handleSave = async () => {
    if (!form.supplier_code) { setError('Supplier is required'); return; }
    if (form.allocation_type === 'VEHICLE' && !form.vehicle_code) { setError('Vehicle is required for Vehicle POs'); return; }
    if (form.allocation_type === 'INVENTORY' && !lines.some(l => l.item_id)) { setError('At least one inventory item is required'); return; }

    setSaving(true); setError('');
    try {
      const body = {
        ...form,
        subtotal_excl_vat: totals.excl,
        vat_amount:        totals.vat,
        total_incl_vat:    totals.incl,
        lines: lines.map((l, i) => ({
          ...l,
          line_number:    i + 1,
          quantity:       Number(l.quantity || 1),
          unit_price_excl: Number(l.unit_price_excl || 0),
        })),
      };
      const res = await fetch(`${API}/stock/po`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save PO');

      // Upload attachment if selected
      if (attachment && data.po_id) {
        const fd = new FormData();
        fd.append('attachment', attachment);
        await fetch(`${API}/stock/po/${data.po_id}/attachment`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
        });
      }

      onSaved();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[96vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-bold text-lg text-gray-800">{isNew ? 'New Purchase Order' : `Edit PO ${po?.po_number}`}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">{error}</div>}

          {/* Supplier + Allocation */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Supplier <span className="text-red-500">*</span>
              </label>
              <select value={form.supplier_code} onChange={onSupplierChange}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
                <option value="">— Select Supplier —</option>
                {suppliers.map(s => (
                  <option key={s.supplier_code} value={s.supplier_code}>
                    {s.supplier_code} — {s.supplier_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Allocation Type <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setForm(f => ({ ...f, allocation_type: 'VEHICLE' }))}
                  className={`flex-1 py-2 text-sm font-medium rounded-xl border transition-all ${form.allocation_type === 'VEHICLE' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'}`}>
                  🚛 Vehicle
                </button>
                {canInventory && (
                  <button
                    onClick={() => setForm(f => ({ ...f, allocation_type: 'INVENTORY' }))}
                    className={`flex-1 py-2 text-sm font-medium rounded-xl border transition-all ${form.allocation_type === 'INVENTORY' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'}`}>
                    📦 Inventory
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Vehicle selector — forced when VEHICLE type */}
          {form.allocation_type === 'VEHICLE' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Vehicle / Trailer <span className="text-red-500">*</span>
              </label>
              <select value={form.vehicle_code} onChange={onVehicleChange}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
                <option value="">— Select Vehicle or Trailer —</option>
                <optgroup label="Trucks (Horses)">
                  {vehicles.filter(v => v.vh_type === 'Horse').map(v => (
                    <option key={v.vh_code} value={v.vh_code}>{v.vh_code} — {v.vh_display_name || v.vh_code}</option>
                  ))}
                </optgroup>
                <optgroup label="Trailers">
                  {vehicles.filter(v => v.vh_type === 'Trailer').map(v => (
                    <option key={v.vh_code} value={v.vh_code}>{v.vh_code} — {v.vh_display_name || v.vh_code}</option>
                  ))}
                </optgroup>
              </select>
            </div>
          )}

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-red-500">*</span></label>
            <input value={form.po_description} onChange={set('po_description')}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              placeholder="Brief description of the purchase…" />
          </div>

          {/* Lines */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">
                {form.allocation_type === 'INVENTORY' ? 'Inventory Items' : 'Cost Lines'}
                <span className="text-red-500"> *</span>
              </label>
              <button onClick={addLine} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ Add Line</button>
            </div>
            <div className="space-y-3">
              {lines.map((line, idx) => (
                <div key={idx} className="border border-gray-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-semibold text-gray-500">Line {idx + 1}</div>
                    {lines.length > 1 && (
                      <button onClick={() => removeLine(idx)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                    )}
                  </div>

                  {/* Item selector or GL account */}
                  {form.allocation_type === 'INVENTORY' ? (
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Inventory Item <span className="text-red-500">*</span></label>
                      <select value={line.item_id} onChange={e => updateLine(idx, 'item_id', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
                        <option value="">— Select Item —</option>
                        {inventoryItems.filter(i => i.status === 'ACTIVE').map(i => (
                          <option key={i.item_id} value={i.item_id}>{i.item_code} — {i.item_name}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">GL Account</label>
                        <select value={line.gl_account_code} onChange={e => updateLine(idx, 'gl_account_code', e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
                          <option value="2050 020">2050 020 — Maintenance Fleet</option>
                          <option value="2050 010">2050 010 — Fuel</option>
                          <option value="2050 030">2050 030 — Tyres</option>
                          <option value="2050 090">2050 090 — Toll Fees</option>
                          <option value="2050 100">2050 100 — Parking & Permits</option>
                          <option value="2050 120">2050 120 — Tracking</option>
                          <option value="4350">4350 — Repairs & Maintenance</option>
                          <option value="4260">4260 — Small Tools</option>
                          <option value="7700">7700 — Inventory Control</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">VAT</label>
                        <select value={line.vat_type} onChange={e => updateLine(idx, 'vat_type', e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
                          <option value="IN_STD">IN_STD — 15% Input</option>
                          <option value="NO_VAT">NO_VAT — No VAT</option>
                          <option value="EXEMPT">EXEMPT — Exempt</option>
                        </select>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Description</label>
                    <input value={line.description} onChange={e => updateLine(idx, 'description', e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                      placeholder="Line description…" />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Qty</label>
                      <input type="number" min="0" step="0.001" value={line.quantity}
                        onChange={e => updateLine(idx, 'quantity', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Unit Price (excl)</label>
                      <input type="number" min="0" step="0.01" value={line.unit_price_excl}
                        onChange={e => updateLine(idx, 'unit_price_excl', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                        placeholder="0.00" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Line Total (incl)</label>
                      <div className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700 font-medium">
                        {fmt(line.line_total_incl)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="mt-4 bg-gray-50 rounded-xl p-4 space-y-1 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal (excl VAT)</span><span>{fmt(totals.excl)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>VAT</span><span>{fmt(totals.vat)}</span>
              </div>
              <div className="flex justify-between font-bold text-gray-900 text-base border-t border-gray-200 pt-2 mt-2">
                <span>Total (incl VAT)</span><span>{fmt(totals.incl)}</span>
              </div>
            </div>
          </div>

          {/* Attachment */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Attachment
              {user?.role === ROLES.WORKSHOP && <span className="text-red-500 ml-1">* Required before submitting</span>}
              {user?.role !== ROLES.WORKSHOP && <span className="text-gray-400 ml-1">(optional — required before Workshop Manager approval)</span>}
            </label>
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-xl p-4 text-center cursor-pointer hover:border-blue-400 transition-colors">
              {attachment
                ? <div className="text-sm text-blue-700 font-medium">📎 {attachment.name}</div>
                : <div className="text-sm text-gray-400">Click to attach a document (PDF, image, Excel)</div>
              }
            </div>
            <input ref={fileRef} type="file" className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.heic,.xlsx,.xls"
              onChange={e => setAttachment(e.target.files?.[0] || null)} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              placeholder="Any additional notes…" />
          </div>

          <div className="bg-blue-50 rounded-xl p-3 text-sm text-blue-700">
            You can save as <strong>Parked</strong> (no value needed) or add values and submit for approval.
            Values are required before sending for approval.
          </div>
        </div>

        <div className="px-5 py-4 border-t flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-xl hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save (Parked)'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PO DETAIL PANEL
// ─────────────────────────────────────────────────────────────────────────────
function PODetailPanel({ poId, token, user, onClose, onUpdated }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rejReason, setRejReason] = useState('');
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`${API}/stock/po/${poId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setDetail(await res.json());
    setLoading(false);
  }, [poId, token]);

  useEffect(() => { load(); }, [load]);

  const doSubmit = async () => {
    setActing(true);
    const res = await fetch(`${API}/stock/po/${poId}/submit`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json();
    setActing(false);
    if (res.ok) { onUpdated(); load(); } else alert(d.error);
  };

  const doApprove = async (action) => {
    if (action === 'REJECT' && !rejReason.trim()) { alert('Rejection reason required'); return; }
    setActing(true);
    const res = await fetch(`${API}/stock/po/${poId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, notes: rejReason }),
    });
    const d = await res.json();
    setActing(false);
    if (res.ok) { onUpdated(); load(); } else alert(d.error);
  };

  const fileRef = useRef();
  const uploadAttachment = async (file) => {
    if (!file) return;
    const fd = new FormData(); fd.append('attachment', file);
    const res = await fetch(`${API}/stock/po/${poId}/attachment`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
    });
    const d = await res.json();
    if (res.ok) { alert(`Attachment uploaded: ${d.filename}`); load(); }
    else alert(d.error);
  };

  if (loading) return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-8 text-gray-500">Loading…</div>
    </div>
  );

  const { po, lines = [], log = [] } = detail || {};
  if (!po) return null;

  const canSubmit = po.status === 'PARKED' && po.created_by === user?.username;
  const myApprovalStatuses = myPOApprovalStatuses(user);
  const canApproveNow = myApprovalStatuses.includes(po.status);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[96vh] flex flex-col">
        <div className="flex items-start justify-between px-5 py-4 border-b">
          <div>
            <div className="font-bold text-lg text-gray-900">{po.po_number}</div>
            <div className="text-xs text-gray-500 mt-0.5">{po.supplier_name}</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge status={po.status} />
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {/* Summary */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              <div><span className="text-gray-500">Type:</span> <span className="font-medium">{po.allocation_type === 'VEHICLE' ? '🚛 Vehicle' : '📦 Inventory'}</span></div>
              {po.vehicle_code && <div><span className="text-gray-500">Vehicle:</span> <span className="font-medium">{po.vehicle_code} {po.vehicle_name ? `— ${po.vehicle_name}` : ''}</span></div>}
              <div><span className="text-gray-500">Created by:</span> <span className="font-medium">{po.created_by}</span></div>
              <div><span className="text-gray-500">Created:</span> <span className="font-medium">{new Date(po.created_at).toLocaleDateString('en-ZA')}</span></div>
              {po.is_capital === 'Y' && <div className="col-span-2"><span className="bg-purple-100 text-purple-700 text-xs px-2 py-0.5 rounded font-semibold">CAPITAL PURCHASE</span></div>}
            </div>
            <div className="border-t border-gray-200 pt-2 mt-2">
              <div className="text-gray-700">{po.po_description}</div>
            </div>
          </div>

          {/* Lines */}
          {lines.length > 0 && (
            <div>
              <div className="text-sm font-semibold text-gray-700 mb-2">Lines</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-100">
                      <th className="text-left pb-1">Description</th>
                      <th className="text-right pb-1">Qty</th>
                      <th className="text-right pb-1">Unit Excl</th>
                      <th className="text-right pb-1">Total Incl</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map(l => (
                      <tr key={l.po_line_id} className="border-b border-gray-50">
                        <td className="py-1.5 pr-3 text-gray-800">{l.description || l.item_name}</td>
                        <td className="py-1.5 text-right text-gray-600">{l.quantity} {l.unit_of_measure}</td>
                        <td className="py-1.5 text-right text-gray-600">{fmt(l.unit_price_excl)}</td>
                        <td className="py-1.5 text-right font-medium text-gray-800">{fmt(l.line_total_incl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
                <div className="flex justify-between text-gray-600"><span>Excl VAT</span><span>{fmt(po.subtotal_excl_vat)}</span></div>
                <div className="flex justify-between text-gray-600"><span>VAT</span><span>{fmt(po.vat_amount)}</span></div>
                <div className="flex justify-between font-bold text-gray-900 border-t pt-1 mt-1"><span>Total Incl VAT</span><span>{fmt(po.total_incl_vat)}</span></div>
              </div>
            </div>
          )}

          {/* Attachment */}
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-2">Attachment</div>
            {po.attachment_filename ? (
              <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                <span className="text-blue-700 text-sm">📎 {po.attachment_filename}</span>
                {po.onedrive_url
                  ? <a href={po.onedrive_url} target="_blank" rel="noreferrer"
                      className="ml-auto text-xs text-blue-600 hover:underline">Open on OneDrive</a>
                  : po.attachment_url
                    ? <a href={po.attachment_url} target="_blank" rel="noreferrer"
                        className="ml-auto text-xs text-blue-600 hover:underline">View (temp)</a>
                    : null
                }
              </div>
            ) : (
              <div>
                <div className="text-sm text-gray-400 italic mb-2">No attachment yet.</div>
                {['PARKED','PENDING_L1','PENDING_L2','PENDING_L3'].includes(po.status) && (
                  <>
                    <input ref={fileRef} type="file" className="hidden"
                      accept=".pdf,.jpg,.jpeg,.png,.heic,.xlsx,.xls"
                      onChange={e => uploadAttachment(e.target.files?.[0])} />
                    <button onClick={() => fileRef.current?.click()}
                      className="text-sm text-blue-600 border border-blue-300 px-3 py-1.5 rounded-lg hover:bg-blue-50">
                      + Attach Document
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Submit */}
          {canSubmit && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
              <div className="text-sm font-semibold text-amber-800">This PO is Parked</div>
              <div className="text-xs text-amber-700">
                Ensure values are entered and{user?.role === ROLES.WORKSHOP ? ' an attachment is added' : ''} before submitting for approval.
              </div>
              <button onClick={doSubmit} disabled={acting}
                className="w-full py-2 text-sm font-semibold text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50">
                {acting ? 'Submitting…' : 'Submit for Approval →'}
              </button>
            </div>
          )}

          {/* Approve/Reject */}
          {canApproveNow && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
              <div className="text-sm font-semibold text-green-800">Awaiting Your Approval</div>
              {!po.attachment_filename && user?.role === ROLES.WORKSHOP && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
                  ⚠ An attachment is required before you can submit this PO to Finance.
                </div>
              )}
              <textarea value={rejReason} onChange={e => setRejReason(e.target.value)} rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                placeholder="Notes / rejection reason (required if rejecting)…" />
              <div className="flex gap-2">
                <button onClick={() => doApprove('APPROVE')} disabled={acting || (user?.role === ROLES.WORKSHOP && !po.attachment_filename)}
                  className="flex-1 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50">
                  ✓ Approve
                </button>
                <button onClick={() => doApprove('REJECT')} disabled={acting}
                  className="flex-1 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50">
                  ✗ Reject
                </button>
              </div>
            </div>
          )}

          {/* Approval log */}
          {log.length > 0 && (
            <div>
              <div className="text-sm font-semibold text-gray-700 mb-2">Approval Trail</div>
              <div className="space-y-1">
                {log.map(l => (
                  <div key={l.log_id} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-gray-400 shrink-0">{new Date(l.actioned_at).toLocaleDateString('en-ZA')}</span>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded font-semibold ${l.action.includes('REJECT') ? 'bg-red-100 text-red-700' : l.action.includes('APPROVE') || l.action === 'FINANCIAL_APPROVED' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {l.action.replace(/_/g, ' ')}
                    </span>
                    <span className="text-gray-700">{l.actioned_by}</span>
                    {l.notes && <span className="text-gray-400 truncate">{l.notes}</span>}
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
// MAIN POs PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function PurchaseOrders() {
  const { user, token } = useAuth();
  const [pos, setPos]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]   = useState('ALL');        // ALL | MINE | PENDING
  const [search, setSearch] = useState('');
  const [showForm, setShowForm]     = useState(false);
  const [selectedPO, setSelectedPO] = useState(null);
  const [suppliers, setSuppliers]   = useState([]);
  const [vehicles, setVehicles]     = useState([]);
  const [invItems, setInvItems]     = useState([]);

  if (!canViewPOs(user)) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        You do not have access to Purchase Orders.
      </div>
    );
  }

  const loadPOs = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`${API}/stock/po`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setPos(await res.json());
    setLoading(false);
  }, [token]);

  useEffect(() => {
    loadPOs();
    // Load reference data for form
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${API}/suppliers`, { headers }).then(r => r.ok ? r.json() : []),
      fetch(`${API}/vehicles`, { headers }).then(r => r.ok ? r.json() : []),
      fetch(`${API}/stock/items`, { headers }).then(r => r.ok ? r.json() : []),
    ]).then(([s, v, i]) => {
      setSuppliers(Array.isArray(s) ? s : s.data || []);
      setVehicles(Array.isArray(v) ? v : v.data || []);
      setInvItems(Array.isArray(i) ? i : []);
    });
  }, [loadPOs, token]);

  const myApprovalStatuses = myPOApprovalStatuses(user);

  const filtered = pos.filter(po => {
    if (tab === 'MINE')    return po.created_by === user?.username;
    if (tab === 'PENDING') return myApprovalStatuses.includes(po.status);
    return true;
  }).filter(po =>
    !search ||
    po.po_number?.includes(search) ||
    po.supplier_name?.toLowerCase().includes(search.toLowerCase()) ||
    po.po_description?.toLowerCase().includes(search.toLowerCase())
  );

  const pendingCount = pos.filter(po => myApprovalStatuses.includes(po.status)).length;
  const myCount      = pos.filter(po => po.created_by === user?.username).length;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Purchase Orders</h1>
          <p className="text-sm text-gray-500 mt-0.5">{pos.length} total</p>
        </div>
        {canCreatePO(user) && (
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-blue-700">
            + New PO
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {[
          { key: 'ALL',     label: `All (${pos.length})` },
          { key: 'MINE',    label: `Mine (${myCount})` },
          ...(hasPOApprovalDuties(user) ? [{ key: 'PENDING', label: `Needs My Action (${pendingCount})`, alert: pendingCount > 0 }] : []),
        ].map(({ key, label, alert }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all relative ${tab === key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {label}
            {alert && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-xs flex items-center justify-center">{pendingCount}</span>}
          </button>
        ))}
      </div>

      {/* Search */}
      <input value={search} onChange={e => setSearch(e.target.value)}
        className="w-full border border-gray-300 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        placeholder="Search by PO number, supplier, or description…" />

      {/* PO list */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading purchase orders…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          {tab === 'PENDING' ? 'No POs awaiting your action.' : 'No purchase orders found.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(po => (
            <button key={po.po_id}
              onClick={() => setSelectedPO(po.po_id)}
              className="w-full text-left bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">{po.po_number}</span>
                    <Badge status={po.status} />
                    {po.is_capital === 'Y' && <span className="bg-purple-100 text-purple-700 text-xs px-2 py-0.5 rounded font-semibold">CAPITAL</span>}
                    {po.attachment_filename && <span className="text-gray-400 text-xs">📎</span>}
                  </div>
                  <div className="text-sm text-gray-700 mt-0.5 truncate">{po.supplier_name}</div>
                  {po.po_description && (
                    <div className="text-xs text-gray-400 mt-0.5 truncate">{po.po_description}</div>
                  )}
                  {po.vehicle_code && (
                    <div className="text-xs text-blue-600 mt-0.5">🚛 {po.vehicle_code} {po.vehicle_name ? `— ${po.vehicle_name}` : ''}</div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-gray-900">{fmt(po.total_incl_vat)}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{po.allocation_type === 'VEHICLE' ? '🚛 Vehicle' : '📦 Inventory'}</div>
                  <div className="text-xs text-gray-400">{po.created_by}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Modals */}
      {showForm && (
        <POForm
          token={token} user={user}
          suppliers={suppliers} vehicles={vehicles} inventoryItems={invItems}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); loadPOs(); }}
        />
      )}
      {selectedPO && (
        <PODetailPanel
          poId={selectedPO} token={token} user={user}
          onClose={() => setSelectedPO(null)}
          onUpdated={loadPOs}
        />
      )}
    </div>
  );
}
