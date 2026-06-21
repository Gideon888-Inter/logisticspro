import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';

const API   = `${import.meta.env.VITE_API_URL}/api`;
const token = () => localStorage.getItem('lp_token');
const req   = (path, opts = {}) => fetch(API + path, {
  ...opts,
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(), ...(opts.headers || {}) },
}).then(r => r.json());
const fmt = (n) => n == null ? '—' : `R ${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const BUCKET_COLOR = { 'Current': 'badge-green', '1-30 Days': 'badge-amber', '31-60 Days': 'badge-amber', '61-90 Days': 'badge-red', '90+ Days': 'badge-red' };

function exportCSV(rows, filename) {
  const headers = Object.keys(rows[0] || {});
  const csv = [headers, ...rows.map(r => headers.map(h => `"${(r[h] ?? '').toString().replace(/"/g, '""')}"`))].map(r => r.join(',')).join('\n');
  const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = filename; a.click();
}

function ExportBar({ onCSV, onExcel, label }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 10, justifyContent: 'flex-end' }}>
      <button className="btn btn-sm" onClick={onCSV} title="Export CSV">⬇ CSV</button>
      <button className="btn btn-sm" onClick={onExcel} title="Export Excel (CSV)">⬇ Excel</button>
      <button className="btn btn-sm" onClick={() => window.print()} title="Print / PDF">🖨 Print</button>
    </div>
  );
}

const EMPTY_SUPPLIER = { supplier_code: '', supplier_name: '', vat_number: '', telephone: '', email: '', payment_terms_days: 30, gl_control_account: '2000', group_terms: '', city: '' };

export default function FinanceAP() {
  const { user } = useAuth();
  const [tab, setTab]             = useState('aging');
  const [aging, setAging]         = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [selected, setSelected]   = useState(null);
  const [showAdd, setShowAdd]     = useState(false);
  const [form, setForm]           = useState(EMPTY_SUPPLIER);
  const [saving, setSaving]       = useState(false);
  const [toggling, setToggling]   = useState(null);

  // Roles that can toggle workshop_allowed
  const canToggleWorkshop = ['ADMIN', 'FINANCE', 'WORKSHOP_MANAGER'].includes(user?.role);

  useEffect(() => { load(); }, [tab]);

  const load = async () => {
    setLoading(true);
    if (tab === 'aging') {
      const data = await req('/fin/aging/suppliers');
      setAging(data);
    } else {
      const data = await req('/fin/suppliers?active=true');
      setSuppliers(Array.isArray(data) ? data : []);
    }
    setLoading(false);
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const saveSupplier = async () => {
    if (!form.supplier_code.trim() || !form.supplier_name.trim()) return alert('Supplier Code and Name are required');
    setSaving(true);
    try {
      const res = await req('/fin/suppliers', { method: 'POST', body: JSON.stringify(form) });
      if (res.error) throw new Error(res.error);
      setShowAdd(false);
      setForm(EMPTY_SUPPLIER);
      setTab('suppliers');
      load();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const toggleWorkshop = async (s, val) => {
    if (!canToggleWorkshop) return;
    setToggling(s.supplier_code);
    await req(`/fin/suppliers/${s.supplier_code}/workshop`, { method: 'PATCH', body: JSON.stringify({ workshop_allowed: val }) });
    setToggling(null);
    load();
  };

  const tabStyle = (t) => ({
    padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    borderBottom: tab === t ? '2px solid #005A8E' : '2px solid transparent',
    color: tab === t ? '#005A8E' : '#666',
  });

  const filteredSuppliers = suppliers.filter(s =>
    !search || s.supplier_code.toLowerCase().includes(search.toLowerCase()) ||
               s.supplier_name.toLowerCase().includes(search.toLowerCase())
  );

  const agingCSV = () => {
    if (!aging?.invoices?.length) return;
    exportCSV(aging.invoices.map(i => ({
      Supplier: i.supplier_name, 'Invoice Ref': i.invoice_ref, 'Supplier Inv#': i.supplier_invoice_no || '',
      'Invoice Date': i.invoice_date, 'Due Date': i.due_date,
      Amount: i.total_incl_vat, Balance: i.balance_due, Bucket: i.aging_bucket,
    })), 'ap_aging.csv');
  };
  const suppliersCSV = () => exportCSV(filteredSuppliers.map(s => ({
    Code: s.supplier_code, Name: s.supplier_name, 'Group Terms': s.group_terms || '',
    VAT: s.vat_number || '', Tel: s.telephone || '', 'Terms (days)': s.payment_terms_days,
    'GL Account': s.gl_control_account, 'Workshop Allowed': s.workshop_allowed ? 'YES' : 'NO',
  })), 'suppliers.csv');

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid #e8edf2', marginBottom: 16, gap: 4, alignItems: 'center' }}>
        <div style={tabStyle('aging')}     onClick={() => setTab('aging')}>Supplier Aging</div>
        <div style={tabStyle('suppliers')} onClick={() => setTab('suppliers')}>Supplier Master ({suppliers.length || '…'})</div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => { setForm(EMPTY_SUPPLIER); setShowAdd(true); }}>+ New Supplier</button>
      </div>

      {tab === 'aging' && (
        <>
          {aging && (
            <div className="stats-grid">
              <div className="stat-card"><div className="stat-label">Total Outstanding</div><div className="stat-value" style={{ color: '#e53e3e', fontSize: 15 }}>{fmt(aging.total)}</div></div>
              {Object.entries(aging.summary || {}).map(([k, v]) => (
                <div className="stat-card" key={k}>
                  <div className="stat-label">{k}</div>
                  <div className="stat-value" style={{ fontSize: 14, color: v > 0 && k !== 'Current' ? '#e53e3e' : '#059669' }}>{fmt(v)}</div>
                </div>
              ))}
            </div>
          )}
          <ExportBar onCSV={agingCSV} onExcel={agingCSV} />
          <div className="table-wrap">
            <table>
              <thead><tr><th>Supplier</th><th>Invoice Ref</th><th>Supplier Inv #</th><th>Invoice Date</th><th>Due Date</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Balance</th><th>Bucket</th></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={8}><div className="loading">Loading supplier aging…</div></td></tr>}
                {!loading && !aging?.invoices?.length && <tr><td colSpan={8}><div className="empty-state">No outstanding supplier invoices</div></td></tr>}
                {!loading && aging?.invoices?.map(i => (
                  <tr key={i.invoice_id}>
                    <td style={{ fontWeight: 600 }}>{i.supplier_name}</td>
                    <td className="mono">{i.invoice_ref}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{i.supplier_invoice_no || '—'}</td>
                    <td style={{ fontSize: 12 }}>{i.invoice_date}</td>
                    <td style={{ fontSize: 12 }}>{i.due_date}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(i.total_incl_vat)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#e53e3e' }}>{fmt(i.balance_due)}</td>
                    <td><span className={`badge ${BUCKET_COLOR[i.aging_bucket] || 'badge-gray'}`} style={{ fontSize: 10 }}>{i.aging_bucket}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'suppliers' && (
        <>
          <div className="filter-bar">
            <input placeholder="Search supplier code or name…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <ExportBar onCSV={suppliersCSV} onExcel={suppliersCSV} />
          <div className="table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Supplier Name</th><th>Group Terms</th><th>VAT Number</th><th>Telephone</th><th>Terms</th><th>GL Account</th><th style={{ textAlign: 'center' }}>Workshop</th></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={8}><div className="loading">Loading suppliers…</div></td></tr>}
                {!loading && filteredSuppliers.length === 0 && <tr><td colSpan={8}><div className="empty-state">No suppliers found</div></td></tr>}
                {!loading && filteredSuppliers.map(s => (
                  <tr key={s.supplier_id} onClick={() => setSelected(s)} style={{ cursor: 'pointer' }}>
                    <td className="mono" style={{ fontWeight: 600 }}>{s.supplier_code}</td>
                    <td>{s.supplier_name}</td>
                    <td style={{ fontSize: 12 }}>{s.group_terms || '—'}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{s.vat_number || '—'}</td>
                    <td style={{ fontSize: 12 }}>{s.telephone || '—'}</td>
                    <td style={{ fontSize: 12 }}>{s.payment_terms_days} days</td>
                    <td className="mono" style={{ fontSize: 12 }}>{s.gl_control_account}</td>
                    <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      {canToggleWorkshop ? (
                        <button
                          className={`btn btn-sm ${s.workshop_allowed ? 'btn-primary' : ''}`}
                          style={{ fontSize: 10, padding: '2px 8px', opacity: toggling === s.supplier_code ? 0.5 : 1 }}
                          onClick={() => toggleWorkshop(s, !s.workshop_allowed)}
                          disabled={toggling === s.supplier_code}
                          title={s.workshop_allowed ? 'Click to remove Workshop access' : 'Click to allow Workshop access'}
                        >
                          {s.workshop_allowed ? '✓ Workshop' : 'Allow'}
                        </button>
                      ) : (
                        s.workshop_allowed
                          ? <span className="badge badge-green" style={{ fontSize: 10 }}>✓</span>
                          : <span style={{ color: '#ccc', fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Supplier Detail Modal */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selected.supplier_code} — {selected.supplier_name}</h3>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label>VAT Number</label><div className="mono">{selected.vat_number || '—'}</div></div>
                <div className="form-group"><label>Group Terms</label><div>{selected.group_terms || '—'}</div></div>
                <div className="form-group"><label>Payment Terms</label><div>{selected.payment_terms_days} days</div></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Telephone</label><div>{selected.telephone || '—'}</div></div>
                <div className="form-group"><label>Email</label><div style={{ fontSize: 12 }}>{selected.email || '—'}</div></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>City</label><div>{selected.city || '—'}</div></div>
                <div className="form-group"><label>GL Control Account</label><div className="mono">{selected.gl_control_account}</div></div>
                <div className="form-group"><label>Status</label><span className={`badge ${selected.on_hold ? 'badge-red' : 'badge-green'}`}>{selected.on_hold ? 'On Hold' : 'Active'}</span></div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Workshop Access</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`badge ${selected.workshop_allowed ? 'badge-green' : 'badge-gray'}`} style={{ fontSize: 11 }}>
                      {selected.workshop_allowed ? '✓ Allowed for Workshop POs' : 'Not allowed for Workshop'}
                    </span>
                    {canToggleWorkshop && (
                      <button className="btn btn-sm" style={{ fontSize: 11 }}
                        onClick={() => { toggleWorkshop(selected, !selected.workshop_allowed); setSelected(null); }}>
                        {selected.workshop_allowed ? 'Remove' : 'Allow'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Supplier Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>New Supplier</h3>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label>Supplier Code *</label><input value={form.supplier_code} onChange={e => set('supplier_code', e.target.value.toUpperCase())} placeholder="e.g. ACME001" /></div>
                <div className="form-group"><label>Supplier Name *</label><input value={form.supplier_name} onChange={e => set('supplier_name', e.target.value)} placeholder="Full supplier name" /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>VAT Number</label><input value={form.vat_number} onChange={e => set('vat_number', e.target.value)} placeholder="4xxxxxxxxx" /></div>
                <div className="form-group"><label>Group Terms</label><input value={form.group_terms} onChange={e => set('group_terms', e.target.value)} placeholder="e.g. NET30" /></div>
                <div className="form-group"><label>Payment Terms (days)</label><input type="number" value={form.payment_terms_days} onChange={e => set('payment_terms_days', e.target.value)} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Telephone</label><input value={form.telephone} onChange={e => set('telephone', e.target.value)} /></div>
                <div className="form-group"><label>Email</label><input type="email" value={form.email} onChange={e => set('email', e.target.value)} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>City</label><input value={form.city} onChange={e => set('city', e.target.value)} /></div>
                <div className="form-group"><label>GL Control Account</label><input value={form.gl_control_account} onChange={e => set('gl_control_account', e.target.value)} placeholder="2000" /></div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveSupplier} disabled={saving}>{saving ? 'Saving…' : 'Create Supplier'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
