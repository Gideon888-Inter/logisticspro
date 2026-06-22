import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { canCreatePO, hasPOApprovalDuties, myPOApprovalStatuses, PO_STATUS_LABELS, PO_STATUS_COLORS } from '../lib/roles';

const API = `${import.meta.env.VITE_API_URL}/api`;
const token = () => localStorage.getItem('lp_token');
const req = (path, opts = {}) =>
  fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(), ...(opts.headers || {}) },
  }).then(r => r.json());

const fmtR    = (n) => n == null ? '—' : 'R ' + Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const EMPTY_LINE = () => ({ typeCategory: 'HORSE', type: '', description: '', excl: '', vat: '', incl: '' });
const DEFAULT_LINES = () => [EMPTY_LINE(), EMPTY_LINE(), EMPTY_LINE()];

// ── Shared PO Form (used for both New and Edit) ───────────────────────────
function POForm({ title, initial, suppliers, vehicles, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial);

  const vehicleOptions = (vehicles || []).filter(v => /^(MH|RH)/i.test(v.vh_code));
  const trailerOptions = (vehicles || []).filter(v => /^(BT|ST)/i.test(v.vh_code));
  const isVatReg = !!(form.supplier_vat);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const setLine = (i, k, v) => {
    setForm(f => {
      const lines = (f.lines || []).map((l, idx) => idx !== i ? l : { ...l, [k]: v });
      if (k === 'typeCategory') lines[i] = { ...lines[i], typeCategory: v, type: '' };
      if (k === 'excl') {
        const excl = parseFloat(v) || 0;
        const vatAmt = isVatReg ? Math.round(excl * 0.15 * 100) / 100 : 0;
        lines[i] = { ...lines[i], vat: isVatReg ? String(vatAmt) : '', incl: String(Math.round((excl + vatAmt) * 100) / 100) };
      }
      return { ...f, lines };
    });
  };

  const addLine    = () => setForm(f => ({ ...f, lines: [...(f.lines || []), EMPTY_LINE()] }));
  const removeLine = (i) => setForm(f => ({ ...f, lines: (f.lines || []).filter((_, idx) => idx !== i) }));

  const recalcLines = (vatReg, lines) => (lines || []).map(l => {
    const excl = parseFloat(l.excl) || 0;
    const vatAmt = vatReg ? Math.round(excl * 0.15 * 100) / 100 : 0;
    return { ...l, vat: vatReg ? String(vatAmt) : '', incl: String(Math.round((excl + vatAmt) * 100) / 100) };
  });

  const totalExcl = (form.lines || []).reduce((s, l) => s + (parseFloat(l.excl) || 0), 0);
  const totalVat  = (form.lines || []).reduce((s, l) => s + (parseFloat(l.vat)  || 0), 0);
  const totalIncl = (form.lines || []).reduce((s, l) => s + (parseFloat(l.incl) || 0), 0);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 820, width: '96vw' }}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        <div className="modal-body" style={{ maxHeight: '80vh', overflowY: 'auto' }}>

          {/* Supplier + Supplier Invoice No */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: '1 1 320px', marginBottom: 0 }}>
              <label style={{ fontWeight: 600 }}>Supplier *</label>
              <select value={form.supplier_code} onChange={e => {
                const sup    = suppliers.find(s => s.supplier_code === e.target.value);
                const vatReg = !!(sup && (sup.vat_number || sup.vat_enabled));
                setForm(f => ({
                  ...f,
                  supplier_code: e.target.value,
                  supplier_name: sup ? sup.supplier_name : '',
                  supplier_vat:  vatReg ? (sup.vat_number || 'Y') : '',
                  lines: recalcLines(vatReg, f.lines),
                }));
              }} style={{ width: '100%' }}>
                <option value="">— Select supplier —</option>
                {suppliers.map(s => (
                  <option key={s.supplier_code} value={s.supplier_code}>
                    {s.supplier_code} — {s.supplier_name}{(s.vat_number || s.vat_enabled) ? '  ✓ VAT' : ''}
                  </option>
                ))}
              </select>
              {isVatReg
                ? <div style={{ fontSize: 11, color: '#059669', marginTop: 3 }}>✓ VAT registered — VAT calculated at 15%</div>
                : form.supplier_code
                  ? <div style={{ fontSize: 11, color: '#888', marginTop: 3 }}>Not VAT registered — no VAT on this PO</div>
                  : null}
            </div>
            <div className="form-group" style={{ flex: '0 1 240px', marginBottom: 0 }}>
              <label style={{ fontWeight: 600 }}>
                Supplier Invoice No
                <span style={{ fontWeight: 400, fontSize: 11, color: '#888', marginLeft: 6 }}>(required before approval)</span>
              </label>
              <input value={form.supplier_invoice_no} onChange={e => setF('supplier_invoice_no', e.target.value)}
                placeholder="e.g. INV-2025-001" style={{ width: '100%' }} />
            </div>
          </div>

          {/* Line items */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontWeight: 600, fontSize: 13 }}>Line Items *</label>
              <button className="btn btn-sm" onClick={addLine} style={{ fontSize: 11 }}>+ Add Line</button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 680 }}>
                <thead>
                  <tr style={{ background: '#1e3a5f', color: 'white' }}>
                    <th style={{ padding: '7px 8px', textAlign: 'left', width: 110 }}>Type</th>
                    <th style={{ padding: '7px 8px', textAlign: 'left', width: 190 }}>Item</th>
                    <th style={{ padding: '7px 8px', textAlign: 'left' }}>Description *</th>
                    <th style={{ padding: '7px 8px', textAlign: 'right', width: 110 }}>Excl VAT (R)</th>
                    <th style={{ padding: '7px 8px', textAlign: 'right', width: 90 }}>VAT (R)</th>
                    <th style={{ padding: '7px 8px', textAlign: 'right', width: 110 }}>Incl VAT (R)</th>
                    <th style={{ width: 28 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {(form.lines || []).map((l, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #e2e8f0', background: i % 2 === 0 ? 'white' : '#f7f9fc' }}>
                      <td style={{ padding: '4px 6px' }}>
                        <select value={l.typeCategory} onChange={e => setLine(i, 'typeCategory', e.target.value)}
                          style={{ width: '100%', fontSize: 11, border: '1px solid #cbd5e0', borderRadius: 3, padding: '3px 4px' }}>
                          <option value="HORSE">Horse</option>
                          <option value="TRAILER">Trailer</option>
                          <option value="INVENTORY">Inventory</option>
                        </select>
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        {l.typeCategory === 'HORSE' && (
                          <select value={l.type} onChange={e => setLine(i, 'type', e.target.value)}
                            style={{ width: '100%', fontSize: 11, border: '1px solid #cbd5e0', borderRadius: 3, padding: '3px 4px' }}>
                            <option value="">— Select horse —</option>
                            {vehicleOptions.map(v => <option key={v.vh_code} value={v.vh_code}>{v.vh_code}{v.vh_display_name ? ' — ' + v.vh_display_name : ''}</option>)}
                            <option value="GENERAL_HORSE">General / Unspecified</option>
                          </select>
                        )}
                        {l.typeCategory === 'TRAILER' && (
                          <select value={l.type} onChange={e => setLine(i, 'type', e.target.value)}
                            style={{ width: '100%', fontSize: 11, border: '1px solid #cbd5e0', borderRadius: 3, padding: '3px 4px' }}>
                            <option value="">— Select trailer —</option>
                            {trailerOptions.map(v => <option key={v.vh_code} value={v.vh_code}>{v.vh_code}{v.vh_display_name ? ' — ' + v.vh_display_name : ''}</option>)}
                            <option value="GENERAL_TRAILER">General / Unspecified</option>
                          </select>
                        )}
                        {l.typeCategory === 'INVENTORY' && (
                          <span style={{ fontSize: 11, color: '#059669', padding: '3px 4px', display: 'block' }}>Stock / Parts</span>
                        )}
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        <input value={l.description} onChange={e => setLine(i, 'description', e.target.value)}
                          placeholder="e.g. Front brake pads"
                          style={{ width: '100%', fontSize: 12, border: '1px solid #cbd5e0', borderRadius: 3, padding: '3px 6px' }} />
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        <input type="number" value={l.excl} onChange={e => setLine(i, 'excl', e.target.value)}
                          placeholder="0.00" min="0" step="0.01"
                          style={{ width: '100%', textAlign: 'right', fontSize: 12, border: '1px solid #cbd5e0', borderRadius: 3, padding: '3px 6px' }} />
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        <input type="number" value={l.vat} readOnly placeholder={isVatReg ? 'auto' : 'N/A'}
                          style={{ width: '100%', textAlign: 'right', fontSize: 12, background: '#f0f4f8', color: isVatReg ? '#c05621' : '#ccc', border: '1px solid #e2e8f0', borderRadius: 3, padding: '3px 6px', cursor: 'default' }} />
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        <input type="number" value={l.incl} readOnly placeholder="0.00"
                          style={{ width: '100%', textAlign: 'right', fontSize: 12, fontWeight: 600, background: '#e8f0f8', color: '#005A8E', border: '1px solid #c3d4e8', borderRadius: 3, padding: '3px 6px', cursor: 'default' }} />
                      </td>
                      <td style={{ padding: '4px 2px', textAlign: 'center' }}>
                        <button onClick={() => removeLine(i)} disabled={(form.lines || []).length <= 1}
                          style={{ background: 'none', border: 'none', cursor: (form.lines || []).length > 1 ? 'pointer' : 'default',
                                   color: (form.lines || []).length > 1 ? '#e53e3e' : '#ddd', fontSize: 15 }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#1e3a5f', color: 'white', fontWeight: 700 }}>
                    <td colSpan={3} style={{ padding: '7px 8px', textAlign: 'right', fontSize: 12 }}>TOTALS</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'monospace' }}>R {totalExcl.toFixed(2)}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'monospace', color: '#fbd38d' }}>{totalVat > 0 ? 'R ' + totalVat.toFixed(2) : '—'}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'monospace', color: '#90cdf4' }}>R {totalIncl.toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div style={{ fontSize: 12, color: '#666', background: '#f0f7ff', padding: '8px 12px', borderRadius: 6 }}>
            ℹ️ PO is saved as a draft (Parked). Add the supplier invoice number, then submit to start the approval workflow.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(form, totalExcl, totalVat, totalIncl)} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main PurchaseOrders page ──────────────────────────────────────────────
export default function PurchaseOrders() {
  const { user } = useAuth();
  const canCreate    = canCreatePO(user);
  const hasApprovals = hasPOApprovalDuties(user);

  const [pos, setPos]             = useState([]);
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState('all');
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatus] = useState('');
  const [selected, setSelected]   = useState(null);   // selected PO summary (from list)
  const [detail, setDetail]       = useState(null);   // full detail {po, lines, log}
  const [detailLoading, setDL]    = useState(false);
  const [showForm, setShowForm]   = useState(false);  // show New PO form
  const [editPO, setEditPO]       = useState(null);   // PO being edited (null = new)
  const [suppliers, setSuppliers] = useState([]);
  const [vehicles, setVehicles]   = useState([]);
  const [saving, setSaving]       = useState(false);
  const [approving, setApproving] = useState(false);
  const [actionErr, setActionErr] = useState('');

  const load = async () => {
    setLoading(true);
    try { const data = await req('/stock/po'); setPos(Array.isArray(data) ? data : data.pos || []); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const loadSupport = async () => {
    try {
      const [supRes, vehRes] = await Promise.all([
        req('/fin/suppliers/workshop').catch(() => []),
        fetch(API + '/vehicles', { headers: { Authorization: 'Bearer ' + token() } }).then(r => r.json()).catch(() => []),
      ]);
      setSuppliers(Array.isArray(supRes) ? supRes : []);
      setVehicles(Array.isArray(vehRes) ? vehRes : vehRes.data || []);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { load(); loadSupport(); }, []);

  const openDetail = async (po) => {
    setSelected(po); setDL(true); setActionErr('');
    try { const data = await req(`/stock/po/${po.po_id}`); setDetail(data); }
    catch (e) { console.error(e); }
    finally { setDL(false); }
  };

  const closeDetail = () => { setSelected(null); setDetail(null); setActionErr(''); };

  // Open edit form — populate from current detail
  const openEdit = () => {
    if (!detail) return;
    const po = detail.po;
    // Rebuild lines from stored lines with typeCategory inference
    const lines = (detail.lines || []).map(l => ({
      typeCategory: l.line_type === 'INVENTORY' ? 'INVENTORY' : 'HORSE',
      type: '',
      description: l.description || '',
      excl: l.line_total_excl != null ? String(l.line_total_excl) : '',
      vat:  l.vat_amount      != null ? String(l.vat_amount)      : '',
      incl: l.line_total_incl != null ? String(l.line_total_incl) : '',
    }));
    const editForm = {
      supplier_code:       po.supplier_code || '',
      supplier_name:       po.supplier_name || '',
      supplier_vat:        po.vat_number || '',
      supplier_invoice_no: po.supplier_invoice_no || '',
      lines: lines.length > 0 ? lines : DEFAULT_LINES(),
    };
    setEditPO({ poId: po.po_id, form: editForm });
    setShowForm(true);
  };

  // Save new PO
  const saveNew = async (form, totalExcl, totalVat, totalIncl) => {
    if (!form.supplier_code) return alert('Supplier is required');
    const lines = (form.lines || []).filter(l => l.description.trim());
    if (!lines.length) return alert('At least one line with a description is required');
    setSaving(true);
    try {
      const apiLines = lines.map((l, i) => ({
        line_number: i + 1, line_type: l.typeCategory === 'INVENTORY' ? 'INVENTORY' : 'COST',
        description: l.description, quantity: 1,
        unit_price_excl: parseFloat(l.excl) || 0,
        vat_type: form.supplier_vat ? 'IN_STD' : null,
        vat_amount: parseFloat(l.vat) || 0,
        line_total_excl: parseFloat(l.excl) || 0,
        line_total_incl: parseFloat(l.incl) || parseFloat(l.excl) || 0,
      }));
      const result = await req('/stock/po', {
        method: 'POST',
        body: JSON.stringify({
          supplier_code: form.supplier_code, supplier_name: form.supplier_name,
          allocation_type: lines.some(l => l.typeCategory === 'INVENTORY') ? 'INVENTORY' : 'VEHICLE',
          po_description: lines.map(l => l.description).filter(Boolean).join('; '),
          subtotal_excl_vat: totalExcl, vat_amount: totalVat, total_incl_vat: totalIncl,
          supplier_invoice_no: form.supplier_invoice_no || null,
          lines: apiLines,
        }),
      });
      if (result.error) throw new Error(result.error);
      setShowForm(false); setEditPO(null);
      load();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  // Save edit to existing PARKED PO
  const saveEdit = async (form, totalExcl, totalVat, totalIncl) => {
    if (!form.supplier_code) return alert('Supplier is required');
    const lines = (form.lines || []).filter(l => l.description.trim());
    if (!lines.length) return alert('At least one line with a description is required');
    setSaving(true);
    try {
      const apiLines = lines.map((l, i) => ({
        line_number: i + 1, line_type: l.typeCategory === 'INVENTORY' ? 'INVENTORY' : 'COST',
        description: l.description, quantity: 1,
        unit_price_excl: parseFloat(l.excl) || 0,
        vat_type: form.supplier_vat ? 'IN_STD' : null,
        vat_amount: parseFloat(l.vat) || 0,
        line_total_excl: parseFloat(l.excl) || 0,
        line_total_incl: parseFloat(l.incl) || parseFloat(l.excl) || 0,
      }));
      const result = await req(`/stock/po/${editPO.poId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          supplier_code: form.supplier_code, supplier_name: form.supplier_name,
          po_description: lines.map(l => l.description).filter(Boolean).join('; '),
          subtotal_excl_vat: totalExcl, vat_amount: totalVat, total_incl_vat: totalIncl,
          supplier_invoice_no: form.supplier_invoice_no || null,
          lines: apiLines,
        }),
      });
      if (result.error) throw new Error(result.error);
      setShowForm(false); setEditPO(null);
      // Refresh detail panel
      const refreshed = await req(`/stock/po/${editPO.poId}`);
      setDetail(refreshed);
      setSelected(prev => ({ ...prev, supplier_invoice_no: form.supplier_invoice_no, total_incl_vat: totalIncl }));
      load();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  // Submit for approval
  const submitPO = async (poId) => {
    setActionErr('');
    if (!detail?.po?.supplier_invoice_no) {
      setActionErr('Supplier invoice number is required before submitting for approval.');
      return;
    }
    setApproving(true);
    try {
      const result = await req(`/stock/po/${poId}/submit`, { method: 'POST', body: '{}' });
      if (result.error) { setActionErr(result.error); return; }
      load(); closeDetail();
    } catch (e) { setActionErr(e.message); }
    finally { setApproving(false); }
  };

  // Recall from approval
  const recallPO = async (poId) => {
    setActionErr('');
    setApproving(true);
    try {
      const result = await req(`/stock/po/${poId}/recall`, { method: 'POST', body: '{}' });
      if (result.error) { setActionErr(result.error); return; }
      // Refresh detail
      const refreshed = await req(`/stock/po/${poId}`);
      setDetail(refreshed);
      setSelected(prev => ({ ...prev, status: 'PARKED' }));
      load();
    } catch (e) { setActionErr(e.message); }
    finally { setApproving(false); }
  };

  // Approve / reject
  const approve = async (poId, action, reason) => {
    setApproving(true);
    try {
      const result = await req(`/stock/po/${poId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ action, rejection_reason: reason, notes: reason }),
      });
      if (result.error) { alert(result.error); return; }
      load(); closeDetail();
    } catch (e) { alert(e.message); }
    finally { setApproving(false); }
  };

  const filtered = pos.filter(po => {
    const s = search.toLowerCase();
    const matchSearch = !s || po.po_number?.toLowerCase().includes(s) || po.supplier_name?.toLowerCase().includes(s) || po.po_description?.toLowerCase().includes(s);
    const matchStatus = !statusFilter || po.status === statusFilter;
    const matchTab    = tab === 'all' || (tab === 'mine' && po.created_by === user?.username) || (tab === 'pending' && hasApprovals);
    return matchSearch && matchStatus && matchTab;
  });

  const myApprovalStatuses = myPOApprovalStatuses(user);
  const canApproveThisPO   = (po) => myApprovalStatuses.includes(po?.status);

  // Can the current user edit this PO? (PARKED + is creator or ADMIN)
  const canEditThisPO = (po) =>
    po?.status === 'PARKED' &&
    (po?.created_by === user?.username || user?.role === 'ADMIN');

  // Can the current user recall this PO?
  // Creator can recall from any PENDING status, only if no approver has acted
  const canRecallPO = (po, det) => {
    if (!po || !det) return false;
    if (po.created_by !== user?.username && user?.role !== 'ADMIN') return false;
    const pendingStatuses = ['PENDING_L1','PENDING_L2','PENDING_L3','PENDING_FINANCIAL'];
    if (!pendingStatuses.includes(po.status)) return false;
    // No approver has acted yet
    const p = det.po;
    return !p?.l1_approver && !p?.l2_approver && !p?.l3_approver && !p?.financial_approver;
  };

  return (
    <div>
      {/* Filter bar */}
      <div className="filter-bar">
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`btn btn-sm ${tab === 'all'     ? 'btn-primary' : ''}`} onClick={() => setTab('all')}>All POs</button>
          <button className={`btn btn-sm ${tab === 'mine'    ? 'btn-primary' : ''}`} onClick={() => setTab('mine')}>My POs</button>
          {hasApprovals && <button className={`btn btn-sm ${tab === 'pending' ? 'btn-primary' : ''}`} onClick={() => setTab('pending')}>Pending Approval</button>}
        </div>
        <input placeholder="Search PO number, supplier, description…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, maxWidth: 320 }} />
        <select value={statusFilter} onChange={e => setStatus(e.target.value)} style={{ width: 160 }}>
          <option value="">All statuses</option>
          {Object.entries(PO_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {canCreate && (
          <button className="btn btn-primary btn-sm" onClick={() => { setEditPO(null); setShowForm(true); }}>+ New PO</button>
        )}
      </div>

      {/* PO List */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>PO Number</th><th>Supplier</th><th>Supplier Inv No</th>
              <th>Description</th><th style={{ textAlign: 'right' }}>Total</th>
              <th>Status</th><th>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7}><div className="loading">Loading…</div></td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={7}><div className="empty-state">No purchase orders found</div></td></tr>}
            {!loading && filtered.map(po => (
              <tr key={po.po_id} onClick={() => openDetail(po)} style={{ cursor: 'pointer' }}
                  className={selected?.po_id === po.po_id ? 'row-selected' : ''}>
                <td className="mono" style={{ fontWeight: 700, color: '#005A8E' }}>{po.po_number}</td>
                <td style={{ fontSize: 13 }}>{po.supplier_name || po.supplier_code}</td>
                <td className="mono" style={{ fontSize: 12, color: po.supplier_invoice_no ? '#333' : '#ccc' }}>
                  {po.supplier_invoice_no || '—'}
                </td>
                <td style={{ fontSize: 12, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{po.po_description}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 13 }}>{fmtR(po.total_incl_vat)}</td>
                <td><span className={`badge ${PO_STATUS_COLORS[po.status] || 'badge-gray'}`} style={{ fontSize: 10 }}>{PO_STATUS_LABELS[po.status] || po.status}</span></td>
                <td style={{ fontSize: 12 }}>{fmtDate(po.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail panel */}
      {selected && (
        <div style={{ marginTop: 16, background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 8, padding: 16 }}>
          {detailLoading ? <div className="loading">Loading detail…</div> : detail && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: '#005A8E' }}>{selected.po_number}</span>
                  <span className={`badge ${PO_STATUS_COLORS[selected.status] || 'badge-gray'}`} style={{ fontSize: 11 }}>{PO_STATUS_LABELS[selected.status] || selected.status}</span>
                  {canEditThisPO(selected) && (
                    <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={openEdit}>✏ Edit PO</button>
                  )}
                </div>
                <button onClick={closeDetail} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#888' }}>✕</button>
              </div>

              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 12, fontSize: 13 }}>
                <div><strong>Supplier:</strong> {detail.po?.supplier_name}</div>
                {detail.po?.supplier_invoice_no
                  ? <div><strong>Supplier Inv No:</strong> <span className="mono">{detail.po.supplier_invoice_no}</span></div>
                  : <div style={{ color: '#e53e3e', fontSize: 12 }}>⚠ No supplier invoice number — required before submission</div>
                }
                <div><strong>Total:</strong> {fmtR(detail.po?.total_incl_vat)}</div>
                <div><strong>Created:</strong> {fmtDate(detail.po?.created_at)} by {detail.po?.created_by}</div>
              </div>

              {/* Lines */}
              {detail.lines?.length > 0 && (
                <div className="table-wrap" style={{ marginBottom: 12 }}>
                  <table>
                    <thead><tr><th>#</th><th>Type</th><th>Description</th><th style={{ textAlign: 'right' }}>Excl VAT</th><th style={{ textAlign: 'right' }}>VAT</th><th style={{ textAlign: 'right' }}>Incl VAT</th></tr></thead>
                    <tbody>
                      {detail.lines.map(l => (
                        <tr key={l.po_line_id}>
                          <td style={{ fontSize: 11, color: '#888' }}>{l.line_number}</td>
                          <td><span className="badge badge-gray" style={{ fontSize: 10 }}>{l.line_type}</span></td>
                          <td style={{ fontSize: 13 }}>{l.description}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmtR(l.line_total_excl)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: '#c05621' }}>{l.vat_amount > 0 ? fmtR(l.vat_amount) : '—'}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: '#005A8E' }}>{fmtR(l.line_total_incl)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Approval log */}
              {detail.log?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: '#555', marginBottom: 6 }}>Approval History</div>
                  {detail.log.map(l => (
                    <div key={l.log_id} style={{ fontSize: 12, color: '#666', padding: '3px 0', borderBottom: '1px solid #eee' }}>
                      <strong>{l.actioned_by}</strong> — {l.action} — {fmtDate(l.actioned_at)}
                      {l.notes && <span style={{ color: '#888', marginLeft: 8 }}>({l.notes})</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* Error display */}
              {actionErr && (
                <div style={{ background: '#fff5f5', border: '1px solid #fca5a5', borderRadius: 4, padding: '8px 12px', marginBottom: 10, color: '#e53e3e', fontSize: 13 }}>
                  ⚠ {actionErr}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {/* Submit — PARKED, creator */}
                {selected.status === 'PARKED' && (selected.created_by === user?.username || user?.role === 'ADMIN') && (
                  <button className="btn btn-primary btn-sm" onClick={() => submitPO(selected.po_id)} disabled={approving}>
                    {approving ? 'Submitting…' : '▶ Submit for Approval'}
                  </button>
                )}
                {/* Recall — pending, creator, no approver acted */}
                {canRecallPO(selected, detail) && (
                  <button className="btn btn-sm" style={{ color: '#92400e', borderColor: '#d97706', background: '#fffbeb' }}
                    onClick={() => recallPO(selected.po_id)} disabled={approving}>
                    {approving ? 'Recalling…' : '↩ Cancel Approval Request'}
                  </button>
                )}
                {/* Approve / Reject */}
                {canApproveThisPO(selected) && (
                  <>
                    <button className="btn btn-primary btn-sm" onClick={() => approve(selected.po_id, 'APPROVE')} disabled={approving}>
                      {approving ? 'Processing…' : '✓ Approve'}
                    </button>
                    <button className="btn btn-sm" style={{ color: '#e53e3e', borderColor: '#e53e3e' }}
                      onClick={() => { const r = prompt('Rejection reason:'); if (r) approve(selected.po_id, 'REJECT', r); }}
                      disabled={approving}>✕ Reject</button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* New / Edit PO Form */}
      {showForm && (
        <POForm
          title={editPO ? `Edit PO — ${detail?.po?.po_number}` : 'New Purchase Order'}
          initial={editPO ? editPO.form : {
            supplier_code: '', supplier_name: '', supplier_vat: '',
            supplier_invoice_no: '', lines: DEFAULT_LINES(),
          }}
          suppliers={suppliers}
          vehicles={vehicles}
          onSave={editPO ? saveEdit : saveNew}
          onCancel={() => { setShowForm(false); setEditPO(null); }}
          saving={saving}
        />
      )}
    </div>
  );
}
