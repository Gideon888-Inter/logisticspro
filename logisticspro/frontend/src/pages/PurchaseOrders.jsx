import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../lib/AuthContext';
import { canCreatePO, hasPOApprovalDuties, myPOApprovalStatuses, PO_STATUS_LABELS, PO_STATUS_COLORS } from '../lib/roles';

const API = `${import.meta.env.VITE_API_URL || ''}/api`;
const token = () => localStorage.getItem('lp_token');
const req = (path, opts = {}) =>
  fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(), ...(opts.headers || {}) },
  }).then(r => r.json());

const fmtR    = (n) => n == null ? '—' : 'R ' + Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const EMPTY_LINE  = () => ({ typeCategory: 'HORSE', type: '', description: '', excl: '', vat: '', incl: '' });
const DEFAULT_LINES = () => [EMPTY_LINE()];

// ── Inline PO editor (used inside the expanded row) ──────────────────────
function InlinePOEditor({ po, lines: existingLines, suppliers, vehicles, onSave, onCancel, saving }) {
  const vehicleOptions = (vehicles || []).filter(v => /^(MH|RH)/i.test(v.vh_code));
  const trailerOptions = (vehicles || []).filter(v => /^(BT|ST)/i.test(v.vh_code));

  const buildForm = useCallback(() => {
    const sup = suppliers.find(s => s.supplier_code === po.supplier_code);
    const vatReg = !!(sup?.vat_number || sup?.vat_enabled || po.vat_number);

    const lines = (existingLines || []).length > 0
      ? existingLines.map(l => {
          // Decode category from item_name field ("HORSE:MH202" or "TRAILER:BT001")
          // DB line_type only stores COST or INVENTORY — category is in item_name
          let typeCategory = 'HORSE';
          let type = '';

          if (l.line_type === 'INVENTORY') {
            typeCategory = 'INVENTORY';
          } else if (l.item_name && l.item_name.includes(':')) {
            const [cat, veh] = l.item_name.split(':');
            typeCategory = cat || 'HORSE';
            type = veh || '';
          } else if (l.item_name === 'TRAILER' || l.item_name === 'HORSE') {
            typeCategory = l.item_name;
          }

          if (!type && l.item_code) type = l.item_code;

          if (!type && typeCategory !== 'INVENTORY') {
            const m = (l.description || '').toUpperCase().match(/(MH|RH|BT|ST)\d+/);
            if (m) type = m[0];
          }

          if (!type && typeCategory === 'HORSE')   type = 'GENERAL_HORSE';
          if (!type && typeCategory === 'TRAILER') type = 'GENERAL_TRAILER';

          return {
            typeCategory,
            type,
            description: l.description || '',
            excl: l.line_total_excl != null ? String(l.line_total_excl) : '',
            vat:  l.vat_amount      != null ? String(l.vat_amount)      : '',
            incl: l.line_total_incl != null ? String(l.line_total_incl) : '',
          };
        })
      : DEFAULT_LINES();

    return {
      supplier_code: po.supplier_code || '',
      supplier_name: po.supplier_name || '',
      supplier_vat:  vatReg ? (sup?.vat_number || 'Y') : '',
      supplier_invoice_no: po.supplier_invoice_no || '',
      lines,
    };
  }, [po, existingLines, suppliers]);

  const [form, setForm] = useState(buildForm);
  const isVatReg = !!form.supplier_vat;

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

  const recalcLines = (vatReg, lines) => (lines || []).map(l => {
    const excl = parseFloat(l.excl) || 0;
    const vatAmt = vatReg ? Math.round(excl * 0.15 * 100) / 100 : 0;
    return { ...l, vat: vatReg ? String(vatAmt) : '', incl: String(Math.round((excl + vatAmt) * 100) / 100) };
  });

  const addLine    = () => setForm(f => ({ ...f, lines: [...(f.lines || []), EMPTY_LINE()] }));
  const removeLine = (i) => setForm(f => ({ ...f, lines: (f.lines || []).filter((_, idx) => idx !== i) }));

  const totalExcl = (form.lines || []).reduce((s, l) => s + (parseFloat(l.excl) || 0), 0);
  const totalVat  = (form.lines || []).reduce((s, l) => s + (parseFloat(l.vat)  || 0), 0);
  const totalIncl = (form.lines || []).reduce((s, l) => s + (parseFloat(l.incl) || 0), 0);

  const inp = { width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box' };
  const lbl = { fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500, display: 'block', marginBottom: 4 };

  const validate = () => {
    if (!form.supplier_code) { alert('Supplier is required'); return false; }
    const activeLines = (form.lines || []).filter(l => l.description.trim() || l.excl);
    if (!activeLines.length) { alert('At least one line with a description is required'); return false; }
    const badLine = activeLines.find(l =>
      l.typeCategory !== 'INVENTORY' && (!l.type || !l.description.trim())
    );
    if (badLine) {
      const idx = activeLines.indexOf(badLine) + 1;
      if (!badLine.type) alert(`Line ${idx}: please select a ${badLine.typeCategory === 'HORSE' ? 'horse' : 'trailer'}.`);
      else alert(`Line ${idx}: description is required.`);
      return false;
    }
    return true;
  };

  return (
    <div style={{ padding: '16px' }}>

      {/* ── Supplier + Invoice No ─────────────────────────────── */}
      <div className="form-row">
        <div className="form-group">
          <label style={lbl}>Supplier *</label>
          <select value={form.supplier_code} onChange={e => {
            const sup    = suppliers.find(s => s.supplier_code === e.target.value);
            const vatReg = !!(sup?.vat_number || sup?.vat_enabled);
            setForm(f => ({
              ...f,
              supplier_code: e.target.value,
              supplier_name: sup ? sup.supplier_name : '',
              supplier_vat:  vatReg ? (sup.vat_number || 'Y') : '',
              lines: recalcLines(vatReg, f.lines),
            }));
          }} style={inp}>
            <option value="">— Select supplier —</option>
            {suppliers.map(s => (
              <option key={s.supplier_code} value={s.supplier_code}>
                {s.supplier_code} — {s.supplier_name}{(s.vat_number || s.vat_enabled) ? ' ✓ VAT' : ''}
              </option>
            ))}
          </select>
          {isVatReg
            ? <span style={{ fontSize: 11, color: '#059669', marginTop: 3, display: 'block' }}>✓ VAT registered — 15% applied automatically</span>
            : form.supplier_code
              ? <span style={{ fontSize: 11, color: '#888', marginTop: 3, display: 'block' }}>Not VAT registered — no VAT applied</span>
              : null}
        </div>
        <div className="form-group">
          <label style={lbl}>
            Supplier Invoice No
            <span style={{ fontWeight: 400, color: '#aaa', marginLeft: 4, textTransform: 'none' }}>(required before approval)</span>
          </label>
          <input value={form.supplier_invoice_no} onChange={e => setF('supplier_invoice_no', e.target.value)}
            placeholder="e.g. INV-2025-001" style={inp} />
        </div>
      </div>

      {/* ── Line Items ───────────────────────────────────────────── */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: '#005A8E' }}>Line Items *</span>
          <button className="btn btn-sm" onClick={addLine}>+ Add Line</button>
        </div>

        {/* Mobile: stacked cards per line */}
        <div className="mobile-card-list" style={{ gap: 8 }}>
          {(form.lines || []).map((l, i) => (
            <div key={i} style={{ background: 'white', border: '1px solid #ddd', borderRadius: 6, padding: '12px 14px', borderLeft: '3px solid #00AEEF' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 12, color: '#005A8E' }}>Line {i + 1}</span>
                <button onClick={() => removeLine(i)} disabled={(form.lines || []).length <= 1}
                  style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: 4, color: '#e53e3e', fontSize: 11, padding: '2px 8px', cursor: (form.lines || []).length > 1 ? 'pointer' : 'not-allowed', opacity: (form.lines || []).length > 1 ? 1 : 0.3 }}>
                  Remove
                </button>
              </div>
              <div className="form-row">
                <div className="form-group" style={{ marginBottom: 8 }}>
                  <label style={lbl}>Type</label>
                  <select value={l.typeCategory} onChange={e => setLine(i, 'typeCategory', e.target.value)} style={inp}>
                    <option value="HORSE">Horse</option>
                    <option value="TRAILER">Trailer</option>
                    <option value="INVENTORY">Inventory</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 8 }}>
                  <label style={lbl}>
                    {l.typeCategory === 'HORSE' ? 'Horse *' : l.typeCategory === 'TRAILER' ? 'Trailer *' : 'Item'}
                  </label>
                  {l.typeCategory === 'HORSE' && (
                    <select value={l.type} onChange={e => setLine(i, 'type', e.target.value)}
                      style={{ ...inp, borderColor: !l.type ? '#e53e3e' : '#ddd' }}>
                      <option value="">— Select horse —</option>
                      {vehicleOptions.map(v => <option key={v.vh_code} value={v.vh_code}>{v.vh_code}{v.vh_display_name ? ' — ' + v.vh_display_name : ''}</option>)}
                      <option value="GENERAL_HORSE">General / Unspecified</option>
                    </select>
                  )}
                  {l.typeCategory === 'TRAILER' && (
                    <select value={l.type} onChange={e => setLine(i, 'type', e.target.value)}
                      style={{ ...inp, borderColor: !l.type ? '#e53e3e' : '#ddd' }}>
                      <option value="">— Select trailer —</option>
                      {trailerOptions.map(v => <option key={v.vh_code} value={v.vh_code}>{v.vh_code}{v.vh_display_name ? ' — ' + v.vh_display_name : ''}</option>)}
                      <option value="GENERAL_TRAILER">General / Unspecified</option>
                    </select>
                  )}
                  {l.typeCategory === 'INVENTORY' && (
                    <div style={{ ...inp, background: '#f0fdf4', color: '#059669', fontWeight: 500 }}>Stock / Parts</div>
                  )}
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 8 }}>
                <label style={lbl}>Description *</label>
                <input value={l.description} onChange={e => setLine(i, 'description', e.target.value)}
                  placeholder="e.g. Front brake pads" style={inp} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={lbl}>Excl VAT (R)</label>
                  <input type="number" value={l.excl} onChange={e => setLine(i, 'excl', e.target.value)}
                    placeholder="0.00" min="0" step="0.01"
                    style={{ ...inp, textAlign: 'right' }} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={lbl}>VAT (R)</label>
                  <input type="number" value={l.vat} readOnly
                    style={{ ...inp, textAlign: 'right', background: '#f8f9fa', color: isVatReg ? '#c05621' : '#ccc', cursor: 'default' }} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={lbl}>Incl VAT (R)</label>
                  <input type="number" value={l.incl} readOnly
                    style={{ ...inp, textAlign: 'right', background: '#e8f0f8', color: '#005A8E', fontWeight: 700, cursor: 'default' }} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop: compact table */}
        <div className="desktop-table">
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 580 }}>
              <thead>
                <tr style={{ background: '#2d6a96', color: 'white' }}>
                  <th style={{ padding: '6px 7px', textAlign: 'left', width: 100 }}>Type</th>
                  <th style={{ padding: '6px 7px', textAlign: 'left', width: 175 }}>Item</th>
                  <th style={{ padding: '6px 7px', textAlign: 'left' }}>Description *</th>
                  <th style={{ padding: '6px 7px', textAlign: 'right', width: 105 }}>Excl VAT (R)</th>
                  <th style={{ padding: '6px 7px', textAlign: 'right', width: 85 }}>VAT (R)</th>
                  <th style={{ padding: '6px 7px', textAlign: 'right', width: 105 }}>Incl VAT (R)</th>
                  <th style={{ width: 24 }}></th>
                </tr>
              </thead>
              <tbody>
                {(form.lines || []).map((l, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #e2e8f0', background: i % 2 === 0 ? 'white' : '#f7f9fc' }}>
                    <td style={{ padding: '3px 5px' }}>
                      <select value={l.typeCategory} onChange={e => setLine(i, 'typeCategory', e.target.value)}
                        style={{ width: '100%', fontSize: 10, border: '1px solid #cbd5e0', borderRadius: 3, padding: '2px 3px' }}>
                        <option value="HORSE">Horse</option>
                        <option value="TRAILER">Trailer</option>
                        <option value="INVENTORY">Inventory</option>
                      </select>
                    </td>
                    <td style={{ padding: '3px 5px' }}>
                      {l.typeCategory === 'HORSE' && (
                        <select value={l.type} onChange={e => setLine(i, 'type', e.target.value)}
                          style={{ width: '100%', fontSize: 10, borderRadius: 3, padding: '2px 3px',
                                   border: !l.type ? '1px solid #e53e3e' : '1px solid #cbd5e0' }}>
                          <option value="">— Select horse * —</option>
                          {vehicleOptions.map(v => <option key={v.vh_code} value={v.vh_code}>{v.vh_code}{v.vh_display_name ? ' — ' + v.vh_display_name : ''}</option>)}
                          <option value="GENERAL_HORSE">General / Unspecified</option>
                        </select>
                      )}
                      {l.typeCategory === 'TRAILER' && (
                        <select value={l.type} onChange={e => setLine(i, 'type', e.target.value)}
                          style={{ width: '100%', fontSize: 10, borderRadius: 3, padding: '2px 3px',
                                   border: !l.type ? '1px solid #e53e3e' : '1px solid #cbd5e0' }}>
                          <option value="">— Select trailer * —</option>
                          {trailerOptions.map(v => <option key={v.vh_code} value={v.vh_code}>{v.vh_code}{v.vh_display_name ? ' — ' + v.vh_display_name : ''}</option>)}
                          <option value="GENERAL_TRAILER">General / Unspecified</option>
                        </select>
                      )}
                      {l.typeCategory === 'INVENTORY' && (
                        <span style={{ fontSize: 10, color: '#059669', padding: '2px 3px', display: 'block' }}>Stock / Parts</span>
                      )}
                    </td>
                    <td style={{ padding: '3px 5px' }}>
                      <input value={l.description} onChange={e => setLine(i, 'description', e.target.value)}
                        placeholder="e.g. Front brake pads"
                        style={{ width: '100%', fontSize: 11, border: '1px solid #cbd5e0', borderRadius: 3, padding: '2px 5px' }} />
                    </td>
                    <td style={{ padding: '3px 5px' }}>
                      <input type="number" value={l.excl} onChange={e => setLine(i, 'excl', e.target.value)}
                        placeholder="0.00" min="0" step="0.01"
                        style={{ width: '100%', textAlign: 'right', fontSize: 11, border: '1px solid #cbd5e0', borderRadius: 3, padding: '2px 5px' }} />
                    </td>
                    <td style={{ padding: '3px 5px' }}>
                      <input type="number" value={l.vat} readOnly placeholder={isVatReg ? 'auto' : 'N/A'}
                        style={{ width: '100%', textAlign: 'right', fontSize: 11, background: '#f0f4f8', color: isVatReg ? '#c05621' : '#ccc', border: '1px solid #e2e8f0', borderRadius: 3, padding: '2px 5px', cursor: 'default' }} />
                    </td>
                    <td style={{ padding: '3px 5px' }}>
                      <input type="number" value={l.incl} readOnly placeholder="0.00"
                        style={{ width: '100%', textAlign: 'right', fontSize: 11, fontWeight: 600, background: '#e8f0f8', color: '#005A8E', border: '1px solid #c3d4e8', borderRadius: 3, padding: '2px 5px', cursor: 'default' }} />
                    </td>
                    <td style={{ padding: '3px 2px', textAlign: 'center' }}>
                      <button onClick={() => removeLine(i)} disabled={(form.lines || []).length <= 1}
                        style={{ background: 'none', border: 'none', cursor: (form.lines || []).length > 1 ? 'pointer' : 'default',
                                 color: (form.lines || []).length > 1 ? '#e53e3e' : '#ddd', fontSize: 13 }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#2d6a96', color: 'white', fontWeight: 700 }}>
                  <td colSpan={3} style={{ padding: '6px 7px', textAlign: 'right', fontSize: 11 }}>TOTALS</td>
                  <td style={{ padding: '6px 7px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>R {totalExcl.toFixed(2)}</td>
                  <td style={{ padding: '6px 7px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: '#fbd38d' }}>{totalVat > 0 ? 'R ' + totalVat.toFixed(2) : '—'}</td>
                  <td style={{ padding: '6px 7px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: '#90cdf4' }}>R {totalIncl.toFixed(2)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      {/* ── Totals bar (always visible) ──────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, padding: '10px 14px', background: '#005A8E', borderRadius: 6, marginBottom: 14, color: 'white', flexWrap: 'wrap' }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Excl VAT</div>
          <div style={{ fontFamily: 'monospace', fontWeight: 700 }}>R {totalExcl.toFixed(2)}</div>
        </div>
        {totalVat > 0 && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>VAT</div>
            <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#fbd38d' }}>R {totalVat.toFixed(2)}</div>
          </div>
        )}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total Incl VAT</div>
          <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 16 }}>R {totalIncl.toFixed(2)}</div>
        </div>
      </div>

      {/* ── Actions ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn btn-primary" onClick={() => { if (validate()) onSave(form, totalExcl, totalVat, totalIncl); }} disabled={saving}>
          {saving ? 'Saving…' : '💾 Save PO'}
        </button>
      </div>
    </div>
  );
}

// ── Main PurchaseOrders page ──────────────────────────────────────────────
export default function PurchaseOrders() {
  const { user } = useAuth();
  const canCreate    = canCreatePO(user);
  const hasApprovals = hasPOApprovalDuties(user);

  const [pos, setPos]               = useState([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState('all');
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatus]   = useState('');
  const [openPoId, setOpenPoId]     = useState(null);   // which PO row is expanded
  const [detail, setDetail]         = useState(null);   // full {po, lines, log} for expanded row
  const [detailLoading, setDL]      = useState(false);
  const [editing, setEditing]       = useState(false);  // inline editor visible
  const [showNewModal, setShowNew]  = useState(false);
  const [suppliers, setSuppliers]   = useState([]);
  const [vehicles, setVehicles]     = useState([]);
  const [saving, setSaving]         = useState(false);
  const [approving, setApproving]   = useState(false);
  const [actionErr, setActionErr]   = useState('');

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

  const toggleRow = async (po) => {
    if (openPoId === po.po_id) {
      setOpenPoId(null); setDetail(null); setEditing(false); setActionErr('');
      return;
    }
    setOpenPoId(po.po_id); setEditing(false); setActionErr(''); setDL(true);
    try { const data = await req(`/stock/po/${po.po_id}`); setDetail(data); }
    catch (e) { console.error(e); }
    finally { setDL(false); }
  };

  const refreshDetail = async (poId) => {
    const data = await req(`/stock/po/${poId}`);
    setDetail(data);
    // Update summary row in list
    setPos(prev => prev.map(p => p.po_id === poId ? { ...p, ...data.po } : p));
  };

  // ── Save edit ─────────────────────────────────────────────────────────────
  const saveEdit = async (form, totalExcl, totalVat, totalIncl) => {
    if (!form.supplier_code) return alert('Supplier is required');
    const lines = (form.lines || []).filter(l => l.description.trim());
    if (!lines.length) return alert('At least one line with a description is required');
    setSaving(true);
    try {
      const apiLines = lines.map((l, i) => {
        const isInv = l.typeCategory === 'INVENTORY';
        const vehCode = (!isInv && l.type && !['GENERAL_HORSE','GENERAL_TRAILER'].includes(l.type)) ? l.type : null;
        return {
          line_number:     i + 1,
          line_type:       isInv ? 'INVENTORY' : 'COST',
          item_name:       !isInv ? `${l.typeCategory}:${l.type || ''}` : null,
          item_code:       vehCode,
          description:     l.description,
          quantity:        1,
          unit_price_excl: parseFloat(l.excl) || 0,
          vat_type:        form.supplier_vat ? 'IN_STD' : null,
          vat_amount:      parseFloat(l.vat) || 0,
          line_total_excl: parseFloat(l.excl) || 0,
          line_total_incl: parseFloat(l.incl) || parseFloat(l.excl) || 0,
        };
      });
      const result = await req(`/stock/po/${openPoId}`, {
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
      setEditing(false);
      await refreshDetail(openPoId);
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  // ── Save new PO ───────────────────────────────────────────────────────────
  const saveNew = async (form, totalExcl, totalVat, totalIncl) => {
    if (!form.supplier_code) return alert('Supplier is required');
    const lines = (form.lines || []).filter(l => l.description.trim());
    if (!lines.length) return alert('At least one line with a description is required');
    setSaving(true);
    try {
      const apiLines = lines.map((l, i) => {
        const isInv = l.typeCategory === 'INVENTORY';
        const vehCode = (!isInv && l.type && !['GENERAL_HORSE','GENERAL_TRAILER'].includes(l.type)) ? l.type : null;
        return {
          line_number:     i + 1,
          line_type:       isInv ? 'INVENTORY' : 'COST',
          item_name:       !isInv ? `${l.typeCategory}:${l.type || ''}` : null,
          item_code:       vehCode,
          description:     l.description,
          quantity:        1,
          unit_price_excl: parseFloat(l.excl) || 0,
          vat_type:        form.supplier_vat ? 'IN_STD' : null,
          vat_amount:      parseFloat(l.vat) || 0,
          line_total_excl: parseFloat(l.excl) || 0,
          line_total_incl: parseFloat(l.incl) || parseFloat(l.excl) || 0,
        };
      });
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
      setShowNew(false);
      load();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const submitPO = async () => {
    setActionErr('');
    if (!detail?.po?.supplier_invoice_no) {
      setActionErr('Supplier invoice number is required before submitting for approval.');
      return;
    }
    // Validate lines before submit — no empty items allowed
    const lines = detail?.lines || [];
    if (!lines.length) { setActionErr('PO has no line items — please edit the PO and add at least one line.'); return; }
    const badLine = lines.find(l => {
      if (l.line_type === 'INVENTORY') return !l.description?.trim();
      // COST lines (horse/trailer) require a description; item is stored in description
      return !l.description?.trim();
    });
    if (badLine) {
      setActionErr(`Line ${badLine.line_number}: description is missing. Please edit the PO before submitting.`);
      return;
    }
    setApproving(true);
    try {
      const result = await req(`/stock/po/${openPoId}/submit`, { method: 'POST', body: '{}' });
      if (result.error) { setActionErr(result.error); return; }
      await refreshDetail(openPoId);
    } catch (e) { setActionErr(e.message); }
    finally { setApproving(false); }
  };

  // ── Recall ────────────────────────────────────────────────────────────────
  const recallPO = async () => {
    setActionErr('');
    setApproving(true);
    try {
      const result = await req(`/stock/po/${openPoId}/recall`, { method: 'POST', body: '{}' });
      if (result.error) { setActionErr(result.error); return; }
      await refreshDetail(openPoId);
    } catch (e) { setActionErr(e.message); }
    finally { setApproving(false); }
  };

  // ── Approve / Reject ──────────────────────────────────────────────────────
  const approve = async (action, reason) => {
    setApproving(true);
    try {
      const result = await req(`/stock/po/${openPoId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ action, rejection_reason: reason, notes: reason }),
      });
      if (result.error) { alert(result.error); return; }
      await refreshDetail(openPoId);
    } catch (e) { alert(e.message); }
    finally { setApproving(false); }
  };

  const filtered = pos.filter(po => {
    const s = search.toLowerCase();
    const matchSearch = !s || po.po_number?.toLowerCase().includes(s) || po.supplier_name?.toLowerCase().includes(s) || po.po_description?.toLowerCase().includes(s) || (po.supplier_invoice_no||'').toLowerCase().includes(s);
    const matchStatus = !statusFilter || po.status === statusFilter;
    const matchTab    = tab === 'all' || (tab === 'mine' && po.created_by === user?.username) || (tab === 'pending' && hasApprovals);
    return matchSearch && matchStatus && matchTab;
  });

  const myApprovalStatuses = myPOApprovalStatuses(user);
  const canApproveStatus   = (status) => myApprovalStatuses.includes(status);

  const canEdit   = (po) => po?.status === 'PARKED' && (po?.created_by === user?.username || user?.role === 'ADMIN');
  const canSubmit = (po) => po?.status === 'PARKED' && (po?.created_by === user?.username || user?.role === 'ADMIN');
  const canRecall = (po, det) => {
    if (!po || !det) return false;
    if (po.created_by !== user?.username && user?.role !== 'ADMIN') return false;
    if (!['PENDING_L1','PENDING_L2','PENDING_L3','PENDING_FINANCIAL'].includes(po.status)) return false;
    const p = det.po;
    return !p?.l1_approver && !p?.l2_approver && !p?.l3_approver && !p?.financial_approver;
  };

  // Determine which action buttons show in the list row (quick actions without opening)
  const rowActionBtns = (po) => {
    const btns = [];
    if (canApproveStatus(po.status)) {
      btns.push({ label: '✓ Approve', primary: true, action: () => { toggleRow(po).then(() => approve('APPROVE', '')); }});
    }
    return btns;
  };

  // ── Expanded PO content (detail + optional editor) ────────────────────────
  // Small component for collapsible approval history (hooks must not be inside callbacks)
  function HistoryToggle({ log }) {
    const [open, setOpen] = useState(false);
    if (!log?.length) return null;
    return (
      <div style={{ marginBottom: 10 }}>
        <button
          onClick={() => setOpen(o => !o)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0',
                   fontSize: 11, fontWeight: 600, color: '#555', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, display: 'inline-block', transition: 'transform 0.15s',
                         transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          Approval History ({log.length})
        </button>
        {open && (
          <div style={{ marginTop: 4, paddingLeft: 12, borderLeft: '2px solid #e2e8f0' }}>
            {log.map(l => (
              <div key={l.log_id} style={{ fontSize: 11, color: '#666', padding: '2px 0', borderBottom: '1px solid #f0f0f0' }}>
                <strong>{l.actioned_by}</strong> — {l.action} — {fmtDate(l.actioned_at)}
                {l.notes && <span style={{ color: '#888', marginLeft: 6 }}>({l.notes})</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const renderExpanded = (po) => {
    if (detailLoading) return <tr><td colSpan={9}><div className="loading" style={{ padding: '12px 20px' }}>Loading…</div></td></tr>;
    if (!detail) return null;
    const dpPO = detail.po;
    const PENDING = ['PENDING_L1','PENDING_L2','PENDING_L3','PENDING_FINANCIAL'].includes(dpPO.status);

    return (
      <tr key={`${po.po_id}-detail`}>
        <td colSpan={9} style={{ padding: 0, borderTop: '2px solid #005A8E' }}>
          {editing ? (
            <InlinePOEditor
              po={dpPO}
              lines={detail.lines}
              suppliers={suppliers}
              vehicles={vehicles}
              onSave={saveEdit}
              onCancel={() => setEditing(false)}
              saving={saving}
            />
          ) : (
            <div style={{ background: '#f8fafc', overflow: 'hidden', maxWidth: '100%', boxSizing: 'border-box' }}>
              {/* ── PO card banner ── */}
              <div style={{
                background: '#d0e8f5', borderTop: '2px solid #005A8E',
                padding: '10px 14px', display: 'flex', alignItems: 'flex-start',
                gap: 8, flexWrap: 'wrap',
              }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: '#003a5c' }}>{dpPO.po_number}</span>
                <span className={`badge ${PO_STATUS_COLORS[dpPO.status] || 'badge-gray'}`} style={{ fontSize: 10 }}>{PO_STATUS_LABELS[dpPO.status] || dpPO.status}</span>
                <span style={{ fontSize: 12, color: '#004a70' }}>Supplier: <strong>{dpPO.supplier_name}</strong></span>
                {dpPO.supplier_invoice_no
                  ? <span style={{ fontSize: 12, color: '#004a70' }}>Inv No: <strong className="mono">{dpPO.supplier_invoice_no}</strong></span>
                  : <span style={{ fontSize: 11, color: '#c0392b', fontWeight: 600 }}>⚠ No supplier invoice number</span>
                }
                <span style={{ fontSize: 12, color: '#004a70' }}>Total: <strong>{fmtR(dpPO.total_incl_vat)}</strong></span>
                <span style={{ fontSize: 11, color: '#336b87', marginLeft: 'auto' }}>by {dpPO.created_by} · {fmtDate(dpPO.created_at)}</span>
              </div>

              <div style={{ padding: '12px 14px', overflowX: 'hidden', maxWidth: '100%', boxSizing: 'border-box' }}>
                {/* Lines — Type shows Horse/Trailer/Inventory + Item code */}
                {detail.lines?.length > 0 && (
                  <div className="table-wrap" style={{ marginBottom: 10, overflowX: 'auto', maxWidth: '100%' }}>
                    <table>
                      <thead>
                        <tr style={{ background: '#4a90b8', color: 'white' }}>
                          <th style={{ width: 28 }}>#</th>
                          <th style={{ width: 100 }}>Category</th>
                          <th style={{ width: 130 }}>Item</th>
                          <th>Description</th>
                          <th style={{ textAlign: 'right' }}>Excl VAT</th>
                          <th style={{ textAlign: 'right' }}>VAT</th>
                          <th style={{ textAlign: 'right' }}>Incl VAT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.lines.map(l => {
                          // Derive display category and item from stored fields
                          // Decode category from item_name ("HORSE:MH202" or "TRAILER:BT001")
                          let cat = 'Horse', catColor = '#005A8E';
                          if (l.line_type === 'INVENTORY') {
                            cat = 'Inventory'; catColor = '#059669';
                          } else if (l.item_name && l.item_name.startsWith('TRAILER')) {
                            cat = 'Trailer'; catColor = '#7c3aed';
                          }
                          let itemCode = l.item_code || '';
                          if (!itemCode && l.item_name && l.item_name.includes(':')) {
                            itemCode = l.item_name.split(':')[1] || '';
                          }
                          if (!itemCode && l.line_type !== 'INVENTORY') {
                            const m = (l.description || '').toUpperCase().match(/(MH|RH|BT|ST)\d+/);
                            if (m) itemCode = m[0];
                          }
                          return (
                            <tr key={l.po_line_id}>
                              <td style={{ fontSize: 11, color: '#888' }}>{l.line_number}</td>
                              <td>
                                <span style={{ fontSize: 11, fontWeight: 600, color: catColor }}>{cat}</span>
                              </td>
                              <td className="mono" style={{ fontSize: 11, color: '#333' }}>
                                {itemCode || <span style={{ color: '#bbb' }}>—</span>}
                              </td>
                              <td style={{ fontSize: 12 }}>{l.description}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmtR(l.line_total_excl)}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: '#c05621' }}>{l.vat_amount > 0 ? fmtR(l.vat_amount) : '—'}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: '#005A8E' }}>{fmtR(l.line_total_incl)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Approval history — collapsed by default */}
                <HistoryToggle log={detail.log} />

                {/* Error */}
                {actionErr && (
                  <div style={{ background: '#fff5f5', border: '1px solid #fca5a5', borderRadius: 4, padding: '6px 10px', marginBottom: 8, color: '#e53e3e', fontSize: 12 }}>
                    ⚠ {actionErr}
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {canEdit(dpPO) && (
                    <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={() => setEditing(true)}>✏ Edit PO</button>
                  )}
                  {canSubmit(dpPO) && (
                    <button className="btn btn-primary btn-sm" style={{ fontSize: 11 }} onClick={submitPO} disabled={approving}>
                      {approving ? 'Submitting…' : '▶ Submit for Approval'}
                    </button>
                  )}
                  {canRecall(dpPO, detail) && (
                    <button className="btn btn-sm" style={{ fontSize: 11, color: '#92400e', borderColor: '#d97706', background: '#fffbeb' }}
                      onClick={recallPO} disabled={approving}>
                      {approving ? '…' : '↩ Cancel Approval Request'}
                    </button>
                  )}
                  {canApproveStatus(dpPO.status) && (
                    <>
                      <button className="btn btn-primary btn-sm" style={{ fontSize: 11 }}
                        onClick={() => approve('APPROVE', '')} disabled={approving}>
                        {approving ? 'Processing…' : '✓ Approve'}
                      </button>
                      <button className="btn btn-sm" style={{ fontSize: 11, color: '#e53e3e', borderColor: '#e53e3e' }}
                        onClick={() => { const r = prompt('Rejection reason (required):'); if (r?.trim()) approve('REJECT', r.trim()); }}
                        disabled={approving}>✕ Reject</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </td>
      </tr>
    );
  };

  // ── New PO Modal ──────────────────────────────────────────────────────────
  const NewPOModal = () => {
    const [form, setFormState] = useState({
      supplier_code: '', supplier_name: '', supplier_vat: '',
      supplier_invoice_no: '', lines: DEFAULT_LINES(),
    });
    // Re-use InlinePOEditor inside a modal wrapper
    return (
      <div className="modal-overlay" onClick={() => setShowNew(false)}>
        <div className="modal" onClick={e => e.stopPropagation()}
          style={{ maxWidth: 860, width: '98vw', maxHeight: '95vh', display: 'flex', flexDirection: 'column' }}>
          <div className="modal-header" style={{ flexShrink: 0 }}>
            <h3>New Purchase Order</h3>
            <button onClick={() => setShowNew(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
          </div>
          <div className="modal-body" style={{ padding: 0, flex: 1, overflowY: 'auto' }}>
            <InlinePOEditor
              po={{ supplier_code: '', supplier_name: '', supplier_invoice_no: '' }}
              lines={[]}
              suppliers={suppliers}
              vehicles={vehicles}
              onSave={saveNew}
              onCancel={() => setShowNew(false)}
              saving={saving}
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <style>{`
        @media (max-width: 600px) {
          /* Stack filter bar items */
          .filter-bar { flex-direction: column !important; align-items: stretch !important; }
          .filter-bar input, .filter-bar select { width: 100% !important; max-width: 100% !important; }
          /* Hide less-critical list columns on mobile */
          .po-col-desc, .po-col-created, .po-col-date { display: none; }
          /* Make modal full-screen on mobile */
          .modal { width: 100vw !important; max-width: 100vw !important; height: 100dvh !important; max-height: 100dvh !important; border-radius: 0 !important; margin: 0 !important; }
          .modal-overlay { padding: 0 !important; align-items: flex-start !important; }
          /* Ensure PO editor padding is tighter */
          .po-editor-wrap { padding: 10px 12px !important; }
        }
      `}</style>
      {/* Filter bar */}
      <div className="filter-bar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${tab === 'all'     ? 'btn-primary' : ''}`} onClick={() => setTab('all')}>All POs</button>
          <button className={`btn btn-sm ${tab === 'mine'    ? 'btn-primary' : ''}`} onClick={() => setTab('mine')}>My POs</button>
          {hasApprovals && <button className={`btn btn-sm ${tab === 'pending' ? 'btn-primary' : ''}`} onClick={() => setTab('pending')}>Pending Approval</button>}
        </div>
        <input placeholder="Search PO, supplier, description, inv no…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, maxWidth: 320 }} />
        <select value={statusFilter} onChange={e => setStatus(e.target.value)} style={{ width: 160 }}>
          <option value="">All statuses</option>
          {Object.entries(PO_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {canCreate && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>+ New PO</button>
        )}
      </div>

      {/* PO Mobile card list */}
      <div className="mobile-card-list">
        {loading && <div className="loading">Loading…</div>}
        {!loading && filtered.length === 0 && <div className="empty-state">No purchase orders found</div>}
        {!loading && filtered.map(po => {
          const isOpen = openPoId === po.po_id;
          return (
            <div key={po.po_id} className={`load-card${isOpen?' open':''}`} onClick={() => toggleRow(po)}>
              <div className="load-card-header">
                <div>
                  <div className="load-card-no">{po.po_number}</div>
                  <div style={{fontSize:12,color:'#555',marginTop:2}}>{po.supplier_name||po.supplier_code}</div>
                </div>
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
                  <span className={`badge ${PO_STATUS_COLORS[po.status]||'badge-gray'}`} style={{fontSize:10}}>
                    {PO_STATUS_LABELS[po.status]||po.status}
                  </span>
                  {po.supplier_invoice_no && <span style={{fontSize:10,color:'#555',fontFamily:'monospace'}}>{po.supplier_invoice_no}</span>}
                </div>
              </div>
              <div className="load-card-meta">
                {po.po_description && <div style={{gridColumn:'1/-1',fontSize:11,color:'#666'}}>{po.po_description}</div>}
                <div>By: <strong>{po.created_by}</strong></div>
                <div>{fmtDate(po.created_at)}</div>
              </div>
              <div className="load-card-footer">
                <div className="load-card-total">{fmtR(po.total_incl_vat)}</div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  {canApproveStatus(po.status) && (
                    <button className="btn btn-primary btn-sm" style={{fontSize:10,padding:'2px 7px'}}
                      onClick={async e => {
                        e.stopPropagation();
                        setOpenPoId(po.po_id); setEditing(false); setActionErr(''); setDL(true);
                        const data = await req(`/stock/po/${po.po_id}`); setDetail(data); setDL(false);
                        setApproving(true);
                        const r = await req(`/stock/po/${po.po_id}/approve`,{method:'POST',body:JSON.stringify({action:'APPROVE',notes:''})});
                        setApproving(false);
                        if(r.error){setActionErr(r.error);return;}
                        await refreshDetail(po.po_id);
                      }}>✓ Approve</button>
                  )}
                  <span className="load-card-chevron">▼</span>
                </div>
              </div>
              {isOpen && (
                <div style={{ maxWidth: '100%', overflow: 'hidden' }}>
                  {renderExpanded(po)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* PO Table with expandable rows */}
      <div className="desktop-table">
      <div className="table-wrap" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table>
          <thead>
            <tr>
              <th>PO Number</th>
              <th>Supplier</th>
              <th>Supplier Inv No</th>
              <th className="po-col-desc">Description</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th className="po-col-created">Created By</th>
              <th className="po-col-date">Date</th>
              <th>Status</th>
              <th style={{ width: 90, textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9}><div className="loading">Loading…</div></td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={9}><div className="empty-state">No purchase orders found</div></td></tr>}
            {!loading && filtered.map(po => {
              const isOpen = openPoId === po.po_id;
              return [
                <tr key={po.po_id}
                  onClick={() => toggleRow(po)}
                  style={{ cursor: 'pointer', background: isOpen ? '#e8f0f8' : undefined, borderLeft: isOpen ? '3px solid #005A8E' : '3px solid transparent' }}
                  className={isOpen ? 'row-selected' : ''}>
                  <td className="mono" style={{ fontWeight: 700, color: '#005A8E', fontSize: 12 }}>{po.po_number}</td>
                  <td style={{ fontSize: 12 }}>{po.supplier_name || po.supplier_code}</td>
                  <td className="mono" style={{ fontSize: 11, color: po.supplier_invoice_no ? '#333' : '#ccc' }}>
                    {po.supplier_invoice_no || '—'}
                  </td>
                  <td className="po-col-desc" style={{ fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{po.po_description}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmtR(po.total_incl_vat)}</td>
                  <td className="po-col-created" style={{ fontSize: 11, color: '#555' }}>{po.created_by}</td>
                  <td className="po-col-date" style={{ fontSize: 11 }}>{fmtDate(po.created_at)}</td>
                  <td>
                    <span className={`badge ${PO_STATUS_COLORS[po.status] || 'badge-gray'}`} style={{ fontSize: 10 }}>
                      {PO_STATUS_LABELS[po.status] || po.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                    {/* Quick approve button in list — only shown when this user can approve this PO */}
                    {canApproveStatus(po.status) && !isOpen && (
                      <button className="btn btn-primary btn-sm" style={{ fontSize: 10, padding: '2px 7px' }}
                        onClick={async e => {
                          e.stopPropagation();
                          setOpenPoId(po.po_id); setEditing(false); setActionErr(''); setDL(true);
                          const data = await req(`/stock/po/${po.po_id}`); setDetail(data); setDL(false);
                          // Immediately approve
                          setApproving(true);
                          const r = await req(`/stock/po/${po.po_id}/approve`, { method: 'POST', body: JSON.stringify({ action: 'APPROVE', notes: '' }) });
                          setApproving(false);
                          if (r.error) { setActionErr(r.error); return; }
                          await refreshDetail(po.po_id);
                        }}>
                        ✓ Approve
                      </button>
                    )}
                    <span style={{ fontSize: 11, color: '#005A8E', marginLeft: canApproveStatus(po.status) ? 4 : 0 }}>
                      {isOpen ? '▲' : '▼'}
                    </span>
                  </td>
                </tr>,
                isOpen && renderExpanded(po),
              ];
            })}
          </tbody>
        </table>
      </div>
      </div>{/* end desktop-table */}

      {/* New PO Modal */}
      {showNewModal && <NewPOModal />}
    </div>
  );
}
