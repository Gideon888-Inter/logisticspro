import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { canCreatePO, hasPOApprovalDuties, PO_STATUS_LABELS, PO_STATUS_COLORS } from '../lib/roles';

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

export default function PurchaseOrders() {
  const { user } = useAuth();
  const canCreate  = canCreatePO(user);
  const hasApprovals = hasPOApprovalDuties(user);

  const [pos, setPos]               = useState([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState('all');   // all | mine | pending
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatus]   = useState('');
  const [selected, setSelected]     = useState(null);
  const [detail, setDetail]         = useState(null);
  const [detailLoading, setDL]      = useState(false);
  const [showNew, setShowNew]       = useState(false);
  const [suppliers, setSuppliers]   = useState([]);
  const [vehicles, setVehicles]     = useState([]);
  const [invItems, setInvItems]     = useState([]);
  const [form, setForm]             = useState({
    supplier_code: '', supplier_name: '', supplier_vat: '',
    lines: [{ type: 'VEHICLE', description: '', excl: '', vat: '', incl: '' }],
  });
  const [saving, setSaving]         = useState(false);
  const [approving, setApproving]   = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await req('/stock/po');
      setPos(Array.isArray(data) ? data : data.pos || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const loadSupport = async () => {
    try {
      const [supRes, vehRes, invRes] = await Promise.all([
        req('/fin/suppliers/workshop').catch(() => []),
        fetch(API + '/vehicles', { headers: { Authorization: 'Bearer ' + token() } }).then(r => r.json()).catch(() => []),
        req('/stock/items?status=ACTIVE').catch(() => []),
      ]);
      setSuppliers(Array.isArray(supRes) ? supRes : supRes.suppliers || []);
      setVehicles(Array.isArray(vehRes) ? vehRes : vehRes.data || []);
      setInvItems(Array.isArray(invRes) ? invRes : invRes.items || []);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { load(); loadSupport(); }, []);

  const openDetail = async (po) => {
    setSelected(po);
    setDL(true);
    try {
      const data = await req(`/stock/po/${po.po_id}`);
      setDetail(data);
    } catch (e) { console.error(e); }
    finally { setDL(false); }
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Line helpers
  const EMPTY_LINE = { type: 'VEHICLE', description: '', excl: '', vat: '', incl: '' };
  const addLine = () => setForm(f => ({ ...f, lines: [...(f.lines || []), { ...EMPTY_LINE }] }));
  const removeLine = (i) => setForm(f => ({ ...f, lines: (f.lines || []).filter((_, idx) => idx !== i) }));
  const setLine = (i, k, v) => {
    setForm(f => {
      const lines = (f.lines || []).map((l, idx) => idx !== i ? l : { ...l, [k]: v });
      const line = lines[i];
      const isVatReg = !!(f.supplier_vat);
      if (k === 'excl') {
        const excl = parseFloat(v) || 0;
        const vatAmt = isVatReg ? Math.round(excl * 0.15 * 100) / 100 : 0;
        lines[i] = { ...lines[i], vat: isVatReg ? String(vatAmt) : '', incl: String(Math.round((excl + vatAmt) * 100) / 100) };
      }
      return { ...f, lines };
    });
  };

  // Recalculate all lines when supplier changes (VAT registration may change)
  const recalcLines = (isVatReg, currentLines) =>
    (currentLines || []).map(l => {
      const excl = parseFloat(l.excl) || 0;
      const vatAmt = isVatReg ? Math.round(excl * 0.15 * 100) / 100 : 0;
      return { ...l, vat: isVatReg ? String(vatAmt) : '', incl: String(Math.round((excl + vatAmt) * 100) / 100) };
    });

  // Totals
  const totalExcl = (form.lines || []).reduce((s, l) => s + (parseFloat(l.excl) || 0), 0);
  const totalVat  = (form.lines || []).reduce((s, l) => s + (parseFloat(l.vat)  || 0), 0);
  const totalIncl = (form.lines || []).reduce((s, l) => s + (parseFloat(l.incl) || 0), 0);

  // Vehicle type options
  const vehicleOptions = (vehicles || []).filter(v => /^(MH|RH)/i.test(v.vh_code));
  const trailerOptions  = (vehicles || []).filter(v => /^(BT|ST)/i.test(v.vh_code));

    const savePO = async (park = true) => {
    if (!form.supplier_code) return alert('Supplier is required');
    const lines = form.lines || [];
    if (!lines.length || lines.every(l => !l.description.trim())) return alert('At least one line with a description is required');
    setSaving(true);
    try {
      const apiLines = lines.filter(l => l.description.trim()).map((l, i) => ({
        line_number:     i + 1,
        line_type:       l.type === 'INVENTORY' ? 'INVENTORY' : 'COST',
        description:     l.description,
        quantity:        1,
        unit_price_excl: parseFloat(l.excl) || 0,
        vat_type:        form.supplier_vat ? 'IN_STD' : null,
        vat_amount:      parseFloat(l.vat) || 0,
        line_total_excl: parseFloat(l.excl) || 0,
        line_total_incl: parseFloat(l.incl) || parseFloat(l.excl) || 0,
      }));
      const result = await req('/stock/po', {
        method: 'POST',
        body: JSON.stringify({
          supplier_code:     form.supplier_code,
          supplier_name:     form.supplier_name,
          allocation_type:   lines.some(l => l.type === 'INVENTORY') ? 'INVENTORY' : 'VEHICLE',
          po_description:    lines.map(l => l.description).filter(Boolean).join('; '),
          subtotal_excl_vat: totalExcl,
          vat_amount:        totalVat,
          total_incl_vat:    totalIncl,
          lines:             apiLines,
        }),
      });
      if (result.error) throw new Error(result.error);
      if (!park) {
        await req(\`/stock/po/\${result.po_id}/submit\`, { method: 'POST', body: '{}' });
      }
      setShowNew(false);
      setForm({ supplier_code: '', supplier_name: '', supplier_vat: '', lines: [{ type: 'VEHICLE', description: '', excl: '', vat: '', incl: '' }] });
      load();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  }ort { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { canCreatePO, hasPOApprovalDuties, PO_STATUS_LABELS, PO_STATUS_COLORS } from '../lib/roles';

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

export default function PurchaseOrders() {
  const { user } = useAuth();
  const canCreate  = canCreatePO(user);
  const hasApprovals = hasPOApprovalDuties(user);

  const [pos, setPos]               = useState([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState('all');   // all | mine | pending
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatus]   = useState('');
  const [selected, setSelected]     = useState(null);
  const [detail, setDetail]         = useState(null);
  const [detailLoading, setDL]      = useState(false);
  const [showNew, setShowNew]       = useState(false);
  const [suppliers, setSuppliers]   = useState([]);
  const [vehicles, setVehicles]     = useState([]);
  const [invItems, setInvItems]     = useState([]);
  const [form, setForm]             = useState({
    supplier_code: '', supplier_name: '', supplier_vat: '',
    lines: [{ type: 'VEHICLE', description: '', excl: '', vat: '', incl: '' }],
  });
  const [saving, setSaving]         = useState(false);
  const [approving, setApproving]   = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await req('/stock/po');
      setPos(Array.isArray(data) ? data : data.pos || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const loadSupport = async () => {
    try {
      const [supRes, vehRes, invRes] = await Promise.all([
        req('/fin/suppliers/workshop').catch(() => []),
        fetch(API + '/vehicles', { headers: { Authorization: 'Bearer ' + token() } }).then(r => r.json()).catch(() => []),
        req('/stock/items?status=ACTIVE').catch(() => []),
      ]);
      setSuppliers(Array.isArray(supRes) ? supRes : supRes.suppliers || []);
      setVehicles(Array.isArray(vehRes) ? vehRes : vehRes.data || []);
      setInvItems(Array.isArray(invRes) ? invRes : invRes.items || []);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { load(); loadSupport(); }, []);

  const openDetail = async (po) => {
    setSelected(po);
    setDL(true);
    try {
      const data = await req(`/stock/po/${po.po_id}`);
      setDetail(data);
    } catch (e) { console.error(e); }
    finally { setDL(false); }
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Line helpers
  const EMPTY_LINE = { type: 'VEHICLE', description: '', excl: '', vat: '', incl: '' };
  const addLine = () => setForm(f => ({ ...f, lines: [...(f.lines || []), { ...EMPTY_LINE }] }));
  const removeLine = (i) => setForm(f => ({ ...f, lines: (f.lines || []).filter((_, idx) => idx !== i) }));
  const setLine = (i, k, v) => {
    setForm(f => {
      const lines = (f.lines || []).map((l, idx) => idx !== i ? l : { ...l, [k]: v });
      const line = lines[i];
      const isVatReg = !!(f.supplier_vat);
      if (k === 'excl') {
        const excl = parseFloat(v) || 0;
        const vatAmt = isVatReg ? Math.round(excl * 0.15 * 100) / 100 : 0;
        lines[i] = { ...lines[i], vat: isVatReg ? String(vatAmt) : '', incl: String(Math.round((excl + vatAmt) * 100) / 100) };
      }
      return { ...f, lines };
    });
  };

  // Recalculate all lines when supplier changes (VAT registration may change)
  const recalcLines = (isVatReg, currentLines) =>
    (currentLines || []).map(l => {
      const excl = parseFloat(l.excl) || 0;
      const vatAmt = isVatReg ? Math.round(excl * 0.15 * 100) / 100 : 0;
      return { ...l, vat: isVatReg ? String(vatAmt) : '', incl: String(Math.round((excl + vatAmt) * 100) / 100) };
    });

  // Totals
  const totalExcl = (form.lines || []).reduce((s, l) => s + (parseFloat(l.excl) || 0), 0);
  const totalVat  = (form.lines || []).reduce((s, l) => s + (parseFloat(l.vat)  || 0), 0);
  const totalIncl = (form.lines || []).reduce((s, l) => s + (parseFloat(l.incl) || 0), 0);

  // Vehicle type options
  const vehicleOptions = (vehicles || []).filter(v => /^(MH|RH)/i.test(v.vh_code));
  const trailerOptions  = (vehicles || []).filter(v => /^(BT|ST)/i.test(v.vh_code));

  const savePO = async (park = true) => {
    if (!form.supplier_code) return alert('Supplier is required');
    if (!form.po_description.trim()) return alert('Description is required');
    if (form.allocation_type === 'VEHICLE' && !form.vehicle_code) return alert('Vehicle is required for Vehicle POs');
    setSaving(true);
    try {
      const result = await req('/stock/po', {
        method: 'POST',
        body: JSON.stringify({ ...form, status: park ? 'PARKED' : 'PARKED' }),
      });
      if (result.error) { alert(result.error); return; }
      setShowNew(false);
      load();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const submitPO = async (poId) => {
    setApproving(true);
    try {
      const result = await req(`/stock/po/${poId}/submit`, { method: 'POST', body: '{}' });
      if (result.error) { alert(result.error); return; }
      openDetail({ po_id: poId });
      load();
    } catch (e) { alert(e.message); }
    finally { setApproving(false); }
  };

  const approvePO = async (poId, action, reason = '') => {
    setApproving(true);
    try {
      const result = await req(`/stock/po/${poId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ action, reason }),
      });
      if (result.error) { alert(result.error); return; }
      openDetail({ po_id: poId });
      load();
    } catch (e) { alert(e.message); }
    finally { setApproving(false); }
  };

  const filtered = pos.filter(po => {
    const s = search.toLowerCase();
    const matchSearch  = !s || po.po_number?.toLowerCase().includes(s) || po.supplier_name?.toLowerCase().includes(s) || po.po_description?.toLowerCase().includes(s);
    const matchStatus  = !statusFilter || po.status === statusFilter;
    const matchTab     = tab === 'all' ? true
      : tab === 'mine'    ? po.created_by === user?.username
      : ['PENDING_L1','PENDING_L2','PENDING_L3','PENDING_FINANCIAL'].includes(po.status);
    return matchSearch && matchStatus && matchTab;
  });

  const needsAction = pos.filter(p => ['PENDING_L1','PENDING_L2','PENDING_L3','PENDING_FINANCIAL'].includes(p.status)).length;
  const approved    = pos.filter(p => p.status === 'APPROVED').length;
  const parked      = pos.filter(p => p.status === 'PARKED').length;

  return (
    <div>
      {/* ── Stat cards ── */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total POs</div>
          <div className="stat-value">{pos.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Needs Action</div>
          <div className="stat-value" style={{ color: needsAction > 0 ? '#d97706' : '#00AEEF' }}>{needsAction}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Approved</div>
          <div className="stat-value" style={{ color: '#00AEEF' }}>{approved}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Parked / Draft</div>
          <div className="stat-value">{parked}</div>
        </div>
      </div>

      {/* ── Tabs + Filter bar ── */}
      <div className="filter-bar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {['all', 'mine', ...(hasApprovals ? ['pending'] : [])].map(t => (
            <button key={t}
              className={`btn btn-sm ${tab === t ? 'btn-primary' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'all' ? `All (${pos.length})` : t === 'mine' ? 'Mine' : `Needs Action (${needsAction})`}
            </button>
          ))}
        </div>
        <input
          placeholder="Search PO number, supplier, description…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 180 }}
        />
        <select value={statusFilter} onChange={e => setStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {Object.entries(PO_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {canCreate && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>+ New PO</button>
        )}
      </div>

      {/* ── Table ── */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>PO Number</th>
              <th>Supplier</th>
              <th>Description</th>
              <th>Type</th>
              <th>Vehicle / Items</th>
              <th>Total (incl)</th>
              <th>Status</th>
              <th>Created By</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8}><div className="loading">Loading purchase orders…</div></td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={8}><div className="empty-state">No purchase orders found</div></td></tr>
            )}
            {!loading && filtered.map(po => (
              <tr key={po.po_id} onClick={() => openDetail(po)}>
                <td className="mono" style={{ fontWeight: 600 }}>{po.po_number}</td>
                <td>{po.supplier_name || po.supplier_code}</td>
                <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{po.po_description}</td>
                <td><span className={`badge ${po.allocation_type === 'INVENTORY' ? 'badge-purple' : 'badge-blue'}`}>{po.allocation_type}</span></td>
                <td className="mono">{po.vehicle_code || '—'}</td>
                <td style={{ fontWeight: 600 }}>R {Number(po.total_incl_vat || 0).toFixed(2)}</td>
                <td><span className={`badge ${PO_STATUS_COLORS[po.status] || 'badge-gray'}`}>{PO_STATUS_LABELS[po.status] || po.status}</span></td>
                <td>{po.created_by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── New PO Modal ── */}
      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 760, width: '95vw' }}>
            <div className="modal-header">
              <h3>New Purchase Order</h3>
              <button onClick={() => setShowNew(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '80vh', overflowY: 'auto' }}>

              {/* Supplier */}
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label style={{ fontWeight: 600 }}>Supplier *</label>
                <select value={form.supplier_code} onChange={e => {
                  const sup = suppliers.find(s => s.supplier_code === e.target.value);
                  const vatReg = !!(sup?.vat_number);
                  setForm(f => ({
                    ...f,
                    supplier_code: e.target.value,
                    supplier_name: sup?.supplier_name || '',
                    supplier_vat:  sup?.vat_number || '',
                    lines: recalcLines(vatReg, f.lines),
                  }));
                }} style={{ width: '100%' }}>
                  <option value="">— Select supplier —</option>
                  {suppliers.map(s => (
                    <option key={s.supplier_code} value={s.supplier_code}>
                      {s.supplier_code} — {s.supplier_name}{s.vat_number ? ' ✓ VAT' : ''}
                    </option>
                  ))}
                </select>
                {form.supplier_vat && (
                  <div style={{ fontSize: 11, color: '#059669', marginTop: 3 }}>✓ VAT registered — VAT will be calculated at 15%</div>
                )}
                {form.supplier_code && !form.supplier_vat && (
                  <div style={{ fontSize: 11, color: '#888', marginTop: 3 }}>Not VAT registered — no VAT on this PO</div>
                )}
              </div>

              {/* Line items table */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ fontWeight: 600, fontSize: 13 }}>Line Items *</label>
                  <button className="btn btn-sm" onClick={addLine} style={{ fontSize: 11 }}>+ Add Line</button>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#1e3a5f', color: 'white' }}>
                      <th style={{ padding: '6px 8px', textAlign: 'left', width: 150 }}>Type</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>Description *</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', width: 110 }}>Excl VAT (R)</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', width: 100 }}>VAT (R)</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', width: 110 }}>Incl VAT (R)</th>
                      <th style={{ width: 28 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(form.lines || []).map((l, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #e2e8f0', background: i % 2 === 0 ? 'white' : '#f7f9fc' }}>
                        <td style={{ padding: '4px 6px' }}>
                          <select value={l.type} onChange={e => setLine(i, 'type', e.target.value)}
                            style={{ width: '100%', fontSize: 12, border: '1px solid #cbd5e0', borderRadius: 3, padding: '3px 4px' }}>
                            <optgroup label="Vehicles (MH / RH)">
                              {vehicleOptions.map(v => (
                                <option key={v.vh_code} value={v.vh_code}>{v.vh_code}{v.vh_display_name ? ' — ' + v.vh_display_name : ''}</option>
                              ))}
                            </optgroup>
                            <optgroup label="Trailers (BT / ST)">
                              {trailerOptions.map(v => (
                                <option key={v.vh_code} value={v.vh_code}>{v.vh_code}{v.vh_display_name ? ' — ' + v.vh_display_name : ''}</option>
                              ))}
                            </optgroup>
                            <optgroup label="Other">
                              <option value="INVENTORY">Inventory / Stock</option>
                              <option value="VEHICLE">General Vehicle</option>
                            </optgroup>
                          </select>
                        </td>
                        <td style={{ padding: '4px 6px' }}>
                          <input value={l.description} onChange={e => setLine(i, 'description', e.target.value)}
                            placeholder="e.g. Front brake pads — MH195"
                            style={{ width: '100%', fontSize: 12, border: '1px solid #cbd5e0', borderRadius: 3, padding: '3px 6px' }} />
                        </td>
                        <td style={{ padding: '4px 6px' }}>
                          <input type="number" value={l.excl} onChange={e => setLine(i, 'excl', e.target.value)}
                            placeholder="0.00" min="0" step="0.01"
                            style={{ width: '100%', textAlign: 'right', fontSize: 12, border: '1px solid #cbd5e0', borderRadius: 3, padding: '3px 6px' }} />
                        </td>
                        <td style={{ padding: '4px 6px' }}>
                          <input type="number" value={l.vat} readOnly
                            style={{ width: '100%', textAlign: 'right', fontSize: 12, background: '#f0f4f8', color: form.supplier_vat ? '#c05621' : '#ccc', border: '1px solid #e2e8f0', borderRadius: 3, padding: '3px 6px', cursor: 'default' }}
                            placeholder={form.supplier_vat ? 'auto' : 'N/A'} />
                        </td>
                        <td style={{ padding: '4px 6px' }}>
                          <input type="number" value={l.incl} readOnly
                            style={{ width: '100%', textAlign: 'right', fontSize: 12, fontWeight: 600, background: '#e8f0f8', color: '#005A8E', border: '1px solid #c3d4e8', borderRadius: 3, padding: '3px 6px', cursor: 'default' }}
                            placeholder="0.00" />
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
                      <td colSpan={2} style={{ padding: '6px 8px', textAlign: 'right', fontSize: 12 }}>TOTALS</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                        R {totalExcl.toFixed(2)}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', color: '#fbd38d' }}>
                        {totalVat > 0 ? 'R ' + totalVat.toFixed(2) : '—'}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', color: '#90cdf4' }}>
                        R {totalIncl.toFixed(2)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div style={{ fontSize: 12, color: '#666', background: '#f0f7ff', padding: '8px 12px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                ℹ️ PO will be saved as a draft. Submit separately to start the approval workflow.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowNew(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => savePO(true)} disabled={saving}>
                {saving ? 'Saving…' : 'Save as Draft'}
              </button>
            </div>
          </div>
        </div>
      )}


      {selected && (
        <div className="modal-overlay" onClick={() => { setSelected(null); setDetail(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
            <div className="modal-header">
              <h3>{selected.po_number}</h3>
              <button onClick={() => { setSelected(null); setDetail(null); }} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              {detailLoading && <div className="loading">Loading PO details…</div>}
              {!detailLoading && detail && (
                <>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Supplier</label>
                      <div style={{ fontWeight: 600 }}>{detail.supplier_name} <span className="mono" style={{ color: '#888', fontSize: 12 }}>({detail.supplier_code})</span></div>
                    </div>
                    <div className="form-group">
                      <label>Status</label>
                      <span className={`badge ${PO_STATUS_COLORS[detail.status] || 'badge-gray'}`}>{PO_STATUS_LABELS[detail.status] || detail.status}</span>
                    </div>
                    <div className="form-group">
                      <label>Type</label>
                      <span className={`badge ${detail.allocation_type === 'INVENTORY' ? 'badge-purple' : 'badge-blue'}`}>{detail.allocation_type}</span>
                    </div>
                  </div>
                  {detail.vehicle_code && (
                    <div className="form-group">
                      <label>Vehicle</label>
                      <div className="mono" style={{ fontWeight: 600 }}>{detail.vehicle_code} {detail.vehicle_name && `— ${detail.vehicle_name}`}</div>
                    </div>
                  )}
                  <div className="form-group">
                    <label>Description</label>
                    <div>{detail.po_description}</div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Subtotal (excl)</label>
                      <div style={{ fontWeight: 600 }}>R {Number(detail.subtotal_excl_vat || 0).toFixed(2)}</div>
                    </div>
                    <div className="form-group">
                      <label>VAT</label>
                      <div>R {Number(detail.vat_amount || 0).toFixed(2)}</div>
                    </div>
                    <div className="form-group">
                      <label>Total (incl VAT)</label>
                      <div style={{ fontWeight: 700, fontSize: 16, color: '#005A8E' }}>R {Number(detail.total_incl_vat || 0).toFixed(2)}</div>
                    </div>
                  </div>

                  {/* Approval trail */}
                  {detail.approval_log && detail.approval_log.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Approval Trail</label>
                      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {detail.approval_log.map(log => (
                          <div key={log.log_id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                            <span className={`badge badge-sm ${log.action.includes('APPROVED') || log.action === 'SUBMITTED' ? 'badge-green' : log.action.includes('REJECTED') ? 'badge-red' : 'badge-gray'}`} style={{ fontSize: 10 }}>
                              {log.action}
                            </span>
                            <span style={{ color: '#555' }}>{log.actioned_by}</span>
                            <span style={{ color: '#aaa', marginLeft: 'auto' }}>{new Date(log.actioned_at).toLocaleDateString('en-ZA')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="modal-footer" style={{ gap: 8 }}>
              <button className="btn" onClick={() => { setSelected(null); setDetail(null); }}>Close</button>
              {/* Submit (creator action on PARKED POs) */}
              {detail?.status === 'PARKED' && detail?.created_by === user?.username && (
                <button className="btn btn-primary" onClick={() => submitPO(detail.po_id)} disabled={approving}>
                  {approving ? 'Submitting…' : 'Submit for Approval →'}
                </button>
              )}
              {/* Approve / Reject (for approvers) */}
              {detail && ['PENDING_L1','PENDING_L2','PENDING_L3','PENDING_FINANCIAL'].includes(detail.status) && (
                <>
                  <button
                    className="btn"
                    style={{ background: '#e53e3e', color: 'white' }}
                    onClick={() => {
                      const reason = prompt('Rejection reason (required):');
                      if (reason?.trim()) approvePO(detail.po_id, 'REJECT', reason);
                    }}
                    disabled={approving}
                  >
                    Reject
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => approvePO(detail.po_id, 'APPROVE')}
                    disabled={approving}
                  >
                    {approving ? 'Approving…' : '✓ Approve'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



