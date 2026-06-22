import { useState, useEffect, useCallback } from 'react';
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

const EMPTY_LINE  = () => ({ typeCategory: 'HORSE', type: '', description: '', excl: '', vat: '', incl: '' });
const DEFAULT_LINES = () => [EMPTY_LINE(), EMPTY_LINE(), EMPTY_LINE()];

// ── Inline PO editor (used inside the expanded row) ──────────────────────
function InlinePOEditor({ po, lines: existingLines, suppliers, vehicles, onSave, onCancel, saving }) {
  const vehicleOptions = (vehicles || []).filter(v => /^(MH|RH)/i.test(v.vh_code));
  const trailerOptions = (vehicles || []).filter(v => /^(BT|ST)/i.test(v.vh_code));

  const buildForm = useCallback(() => {
    const sup = suppliers.find(s => s.supplier_code === po.supplier_code);
    const vatReg = !!(sup?.vat_number || sup?.vat_enabled || po.vat_number);

    const lines = (existingLines || []).length > 0
      ? existingLines.map(l => {
          // Determine category from stored line_type
          let typeCategory = 'HORSE';
          if (l.line_type === 'INVENTORY') typeCategory = 'INVENTORY';
          else if (l.line_type === 'TRAILER') typeCategory = 'TRAILER';

          // Recover vehicle/trailer code: stored in item_code, or infer from vehicle lists
          // The backend stores the selected vh_code in item_code when available
          let type = l.item_code || '';

          // If item_code not set, try to match against known vehicle lists via description
          // (best-effort — user can correct if wrong)
          if (!type && typeCategory !== 'INVENTORY') {
            const descUpper = (l.description || '').toUpperCase();
            // Check horse pattern e.g. "MH202", "RH08"
            const horseMatch = descUpper.match(/(MH|RH)\d+/);
            const trailerMatch = descUpper.match(/(BT|ST)\d+/);
            if (trailerMatch) { typeCategory = 'TRAILER'; type = trailerMatch[0]; }
            else if (horseMatch) { typeCategory = 'HORSE'; type = horseMatch[0]; }
            else type = typeCategory === 'HORSE' ? 'GENERAL_HORSE' : 'GENERAL_TRAILER';
          }

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

  return (
    <div style={{ padding: '16px 20px', background: '#f0f7ff', borderTop: '2px solid #005A8E' }}>
      {/* Supplier + Invoice No row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div className="form-group" style={{ flex: '1 1 280px', marginBottom: 0 }}>
          <label style={{ fontWeight: 600, fontSize: 12 }}>Supplier *</label>
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
          }} style={{ width: '100%', fontSize: 12 }}>
            <option value="">— Select supplier —</option>
            {suppliers.map(s => (
              <option key={s.supplier_code} value={s.supplier_code}>
                {s.supplier_code} — {s.supplier_name}{(s.vat_number || s.vat_enabled) ? ' ✓ VAT' : ''}
              </option>
            ))}
          </select>
          {isVatReg
            ? <span style={{ fontSize: 10, color: '#059669' }}>✓ VAT at 15%</span>
            : form.supplier_code ? <span style={{ fontSize: 10, color: '#888' }}>No VAT</span> : null}
        </div>
        <div className="form-group" style={{ flex: '0 1 220px', marginBottom: 0 }}>
          <label style={{ fontWeight: 600, fontSize: 12 }}>
            Supplier Invoice No
            <span style={{ fontWeight: 400, color: '#888', marginLeft: 4 }}>(required before approval)</span>
          </label>
          <input value={form.supplier_invoice_no} onChange={e => setF('supplier_invoice_no', e.target.value)}
            placeholder="e.g. INV-2025-001" style={{ width: '100%', fontSize: 12 }} />
        </div>
      </div>

      {/* Lines table */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 12 }}>Line Items *</span>
          <button className="btn btn-sm" onClick={addLine} style={{ fontSize: 10 }}>+ Add Line</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 660 }}>
            <thead>
              <tr style={{ background: '#1e3a5f', color: 'white' }}>
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
              <tr style={{ background: '#1e3a5f', color: 'white', fontWeight: 700 }}>
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

      {/* Save / Cancel */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-sm" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={() => {
          // Validate: supplier required
          if (!form.supplier_code) { alert('Supplier is required'); return; }
          // Validate lines
          const activeLines = (form.lines || []).filter(l => l.description.trim() || l.excl);
          if (!activeLines.length) { alert('At least one line with a description is required'); return; }
          const badLine = activeLines.find(l => {
            if (l.typeCategory === 'INVENTORY') return !l.description.trim();
            // Horse and Trailer require an item selection
            return !l.type || !l.description.trim();
          });
          if (badLine) {
            const idx = activeLines.indexOf(badLine) + 1;
            if (!badLine.type && badLine.typeCategory !== 'INVENTORY') {
              alert(`Line ${idx}: please select a ${badLine.typeCategory === 'HORSE' ? 'horse' : 'trailer'} from the Item column.`);
            } else {
              alert(`Line ${idx}: description is required.`);
            }
            return;
          }
          onSave(form, totalExcl, totalVat, totalIncl);
        }} disabled={saving}>
          {saving ? 'Saving…' : '💾 Save Changes'}
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
      const apiLines = lines.map((l, i) => ({
        line_number: i + 1, line_type: l.typeCategory === 'INVENTORY' ? 'INVENTORY' : 'COST',
        description: l.description, quantity: 1,
        item_code: (l.typeCategory !== 'INVENTORY' && l.type && !['GENERAL_HORSE','GENERAL_TRAILER'].includes(l.type)) ? l.type : null,
        unit_price_excl: parseFloat(l.excl) || 0,
        vat_type: form.supplier_vat ? 'IN_STD' : null,
        vat_amount: parseFloat(l.vat) || 0,
        line_total_excl: parseFloat(l.excl) || 0,
        line_total_incl: parseFloat(l.incl) || parseFloat(l.excl) || 0,
      }));
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
      const apiLines = lines.map((l, i) => ({
        line_number: i + 1, line_type: l.typeCategory === 'INVENTORY' ? 'INVENTORY' : 'COST',
        description: l.description, quantity: 1,
        item_code: (l.typeCategory !== 'INVENTORY' && l.type && !['GENERAL_HORSE','GENERAL_TRAILER'].includes(l.type)) ? l.type : null,
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
            <div style={{ padding: '14px 20px', background: '#f8fafc' }}>
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#005A8E' }}>{dpPO.po_number}</span>
                <span className={`badge ${PO_STATUS_COLORS[dpPO.status] || 'badge-gray'}`} style={{ fontSize: 10 }}>{PO_STATUS_LABELS[dpPO.status] || dpPO.status}</span>
                <span style={{ fontSize: 12, color: '#666' }}>Supplier: <strong>{dpPO.supplier_name}</strong></span>
                {dpPO.supplier_invoice_no
                  ? <span style={{ fontSize: 12, color: '#333' }}>Inv No: <strong className="mono">{dpPO.supplier_invoice_no}</strong></span>
                  : <span style={{ fontSize: 11, color: '#e53e3e' }}>⚠ No supplier invoice number</span>
                }
                <span style={{ fontSize: 12, color: '#555' }}>Total: <strong>{fmtR(dpPO.total_incl_vat)}</strong></span>
                <span style={{ fontSize: 11, color: '#888' }}>by {dpPO.created_by} on {fmtDate(dpPO.created_at)}</span>
              </div>

              {/* Lines */}
              {detail.lines?.length > 0 && (
                <div className="table-wrap" style={{ marginBottom: 10 }}>
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

              {/* Approval history */}
              {detail.log?.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 11, color: '#555', marginBottom: 4 }}>Approval History</div>
                  {detail.log.map(l => (
                    <div key={l.log_id} style={{ fontSize: 11, color: '#666', padding: '2px 0', borderBottom: '1px solid #eee' }}>
                      <strong>{l.actioned_by}</strong> — {l.action} — {fmtDate(l.actioned_at)}
                      {l.notes && <span style={{ color: '#888', marginLeft: 6 }}>({l.notes})</span>}
                    </div>
                  ))}
                </div>
              )}

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
        <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 840, width: '96vw' }}>
          <div className="modal-header">
            <h3>New Purchase Order</h3>
            <button onClick={() => setShowNew(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
          </div>
          <div className="modal-body" style={{ padding: 0 }}>
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
      {/* Filter bar */}
      <div className="filter-bar">
        <div style={{ display: 'flex', gap: 8 }}>
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

      {/* PO Table with expandable rows */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>PO Number</th>
              <th>Supplier</th>
              <th>Supplier Inv No</th>
              <th>Description</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th>Created By</th>
              <th>Date</th>
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
                  <td style={{ fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{po.po_description}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmtR(po.total_incl_vat)}</td>
                  <td style={{ fontSize: 11, color: '#555' }}>{po.created_by}</td>
                  <td style={{ fontSize: 11 }}>{fmtDate(po.created_at)}</td>
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

      {/* New PO Modal */}
      {showNewModal && <NewPOModal />}
    </div>
  );
}
