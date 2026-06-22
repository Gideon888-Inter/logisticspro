import { useState, useEffect, useCallback } from 'react';
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
  const csv = [headers, ...rows.map(r => headers.map(h => `"${(r[h] ?? '').toString().replace(/"/g, '""')}`))].map(r => r.join(',')).join('\n');
  const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = filename; a.click();
}

function ExportBar({ onCSV }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 10, justifyContent: 'flex-end' }}>
      <button className="btn btn-sm" onClick={onCSV}>⬇ CSV</button>
      <button className="btn btn-sm" onClick={() => window.print()}>🖨 Print</button>
    </div>
  );
}

const EMPTY_SUPPLIER = { supplier_code: '', supplier_name: '', vat_number: '', vat_enabled: false, telephone: '', email: '', payment_terms_days: 30, credit_limit: '' };

// ── SUPPLIER TRANSACTIONS ─────────────────────────────────────
function SupplierTransactions({ suppliers }) {
  const [rows, setRows]         = useState([]);
  const [totals, setTotals]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [searched, setSearched] = useState(false);
  const [suppFilter, setSupp]   = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');

  const search = useCallback(async () => {
    setLoading(true);
    setSearched(true);
    const params = new URLSearchParams();
    if (suppFilter) params.set('supplier_code', suppFilter);
    if (dateFrom)   params.set('date_from', dateFrom);
    if (dateTo)     params.set('date_to', dateTo);
    const data = await req(`/fin/ap-transactions?${params.toString()}`);
    setRows(data.transactions || []);
    setTotals(data.totals || null);
    setLoading(false);
  }, [suppFilter, dateFrom, dateTo]);

  const clear = () => { setSupp(''); setDateFrom(''); setDateTo(''); setRows([]); setTotals(null); setSearched(false); };

  const rowsChron = [...rows].reverse();
  let runBal = 0;
  const rowsWithBal = rowsChron.map(r => {
    runBal += r.debit - r.credit;
    return { ...r, running_balance: runBal };
  }).reverse();

  const selectedSupplier = suppliers.find(s => s.supplier_code === suppFilter);

  const doExport = () => {
    if (!rows.length) return;
    exportCSV(rows.map(r => ({
      Date: r.tx_date, Ref: r.tx_ref, Type: r.tx_type,
      Supplier: r.supplier_code, Description: r.description,
      Debit: r.debit || 0, Credit: r.credit || 0,
      Status: r.status, 'Due Date': r.due_date || '', 'Balance Due': r.balance_due || 0,
    })), `ap_transactions${suppFilter ? '_' + suppFilter : ''}.csv`);
  };

  const STATUS_COLOR = { POSTED: 'badge-blue', PARTIAL: 'badge-amber', PAID: 'badge-green', DISPUTED: 'badge-red', CANCELLED: 'badge-gray', UNPOSTED: 'badge-gray', RECEIVED: 'badge-green' };

  return (
    <div>
      <div style={{ background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 240px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Supplier</label>
            <select value={suppFilter} onChange={e => setSupp(e.target.value)} style={{ width: '100%' }}>
              <option value="">— All suppliers —</option>
              {suppliers.map(s => <option key={s.supplier_code} value={s.supplier_code}>{s.supplier_code} — {s.supplier_name}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 0 148px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Date From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div style={{ flex: '0 0 148px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Date To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', paddingBottom: 1 }}>
            <button className="btn btn-primary btn-sm" onClick={search} disabled={loading}>{loading ? 'Loading…' : '🔍 Search'}</button>
            {searched && <button className="btn btn-sm" onClick={clear}>Clear</button>}
            {searched && rows.length > 0 && <button className="btn btn-sm" onClick={doExport}>⬇ CSV</button>}
          </div>
        </div>
        {selectedSupplier && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#555' }}>
            <strong>{selectedSupplier.supplier_code}</strong> — {selectedSupplier.supplier_name}
            {selectedSupplier.payment_terms_days && <span style={{ marginLeft: 8, color: '#888' }}>Terms: {selectedSupplier.payment_terms_days} days</span>}
          </div>
        )}
      </div>

      {totals && (
        <div className="stats-grid" style={{ marginBottom: 12 }}>
          <div className="stat-card"><div className="stat-label">Transactions</div><div className="stat-value" style={{ color: '#00AEEF' }}>{rows.length}</div></div>
          <div className="stat-card"><div className="stat-label">Total Invoiced</div><div className="stat-value" style={{ fontSize: 14, color: '#e53e3e' }}>{fmt(totals.total_invoiced)}</div></div>
          <div className="stat-card"><div className="stat-label">Total Paid</div><div className="stat-value" style={{ fontSize: 14, color: '#059669' }}>{fmt(totals.total_paid)}</div></div>
          <div className="stat-card">
            <div className="stat-label">Outstanding</div>
            <div className="stat-value" style={{ fontSize: 14, color: totals.outstanding > 0 ? '#e53e3e' : '#059669' }}>{fmt(totals.outstanding)}</div>
          </div>
        </div>
      )}

      {rows.length > 0 && <ExportBar onCSV={doExport} />}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Ref</th><th>Type</th>
              {!suppFilter && <th>Supplier</th>}
              <th>Description</th><th>Due Date</th>
              <th style={{ textAlign: 'right' }}>Invoiced</th>
              <th style={{ textAlign: 'right' }}>Paid</th>
              {suppFilter && <th style={{ textAlign: 'right' }}>Running Bal</th>}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10}><div className="loading">Loading transactions…</div></td></tr>}
            {!loading && !searched && (
              <tr><td colSpan={10}>
                <div className="empty-state" style={{ padding: '32px 0' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
                  <div>Select filters above and click <strong>Search</strong> to view supplier transactions.</div>
                </div>
              </td></tr>
            )}
            {!loading && searched && rows.length === 0 && (
              <tr><td colSpan={10}><div className="empty-state">No transactions found for the selected filters.</div></td></tr>
            )}
            {!loading && rowsWithBal.map((r, idx) => (
              <tr key={r.tx_ref + idx} style={{ background: idx % 2 === 0 ? 'white' : '#fafbfc' }}>
                <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{r.tx_date}</td>
                <td className="mono" style={{ fontWeight: 600, fontSize: 12 }}>{r.tx_ref}</td>
                <td><span className={`badge ${r.tx_type === 'INVOICE' ? 'badge-blue' : 'badge-green'}`} style={{ fontSize: 10 }}>{r.tx_type}</span></td>
                {!suppFilter && <td className="mono" style={{ fontSize: 12 }}>{r.supplier_code}</td>}
                <td style={{ fontSize: 12 }}>{r.description}</td>
                <td style={{ fontSize: 12, color: r.due_date && r.balance_due > 0 && r.due_date < new Date().toISOString().slice(0, 10) ? '#e53e3e' : '#555' }}>
                  {r.due_date || '—'}
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', color: r.debit > 0 ? '#e53e3e' : '#ccc' }}>
                  {r.debit > 0 ? fmt(r.debit) : '—'}
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', color: r.credit > 0 ? '#059669' : '#ccc' }}>
                  {r.credit > 0 ? fmt(r.credit) : '—'}
                </td>
                {suppFilter && (
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: r.running_balance > 0 ? '#e53e3e' : '#059669' }}>
                    {fmt(Math.abs(r.running_balance))}
                    <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 3 }}>{r.running_balance > 0 ? 'OWE' : 'CR'}</span>
                  </td>
                )}
                <td><span className={`badge ${STATUS_COLOR[r.status] || 'badge-gray'}`} style={{ fontSize: 10 }}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── SUPPLIER INVOICES ─────────────────────────────────────────
function SupplierInvoicesTab({ suppliers, periods }) {
  const [subtab, setSubtab]       = useState('pending');
  const [pendingPOs, setPending]  = useState([]);
  const [invoices, setInvoices]   = useState([]);
  const [loading, setLoading]     = useState(false);
  const [captureModal, setCapture]= useState(null);
  const [invModal, setInvModal]   = useState(false);
  const [form, setForm]           = useState({ supplier_code: '', supplier_invoice_no: '', invoice_date: new Date().toISOString().slice(0,10), period_id: '', subtotal_excl_vat: '', vat_amount: '', total_incl_vat: '', document_ref: '' });
  const [saving, setSaving]       = useState(false);
  const [saveErr, setSaveErr]     = useState('');

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  useEffect(() => { loadPending(); loadInvoices(); }, []);
  const loadPending  = async () => { const d = await req('/fin/ap/invoices/pending-pos'); setPending(Array.isArray(d) ? d : []); };
  const loadInvoices = async () => { setLoading(true); const d = await req('/fin/ap/invoices'); setInvoices(Array.isArray(d) ? d : []); setLoading(false); };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const calcTotals = (excl) => {
    const e = parseFloat(excl || 0);
    const vat = Math.round(e * 0.15 * 100) / 100;
    setForm(f => ({ ...f, subtotal_excl_vat: excl, vat_amount: String(vat), total_incl_vat: String(Math.round((e + vat) * 100) / 100) }));
  };

  const captureFromPO = async () => {
    setSaveErr('');
    if (!form.period_id) return setSaveErr('Period is required');
    setSaving(true);
    const r = await req('/fin/ap/invoices', {
      method: 'POST',
      body: JSON.stringify({
        supplier_code: captureModal.supplier_code, supplier_invoice_no: form.supplier_invoice_no,
        invoice_date: form.invoice_date, period_id: form.period_id,
        subtotal_excl_vat: captureModal.subtotal_excl_vat, vat_amount: captureModal.vat_amount,
        total_incl_vat: captureModal.total_incl_vat, document_ref: captureModal.onedrive_url || null,
        po_id: captureModal.po_id,
      }),
    });
    setSaving(false);
    if (r.error) return setSaveErr(r.error);
    setCapture(null); setForm(f => ({ ...f, supplier_invoice_no: '', period_id: '' }));
    loadPending(); loadInvoices();
  };

  const doInvoiceExport = () => {
    exportCSV(invoices.map(inv => ({
      'Invoice Ref': inv.invoice_ref, Supplier: inv.supplier_code,
      'Supplier Inv No': inv.supplier_invoice_no || '', 'Invoice Date': inv.invoice_date,
      'Due Date': inv.due_date, 'Excl VAT': inv.subtotal_excl_vat, VAT: inv.vat_amount,
      'Total Incl VAT': inv.total_incl_vat, 'Amount Paid': inv.amount_paid,
      'Balance Due': inv.balance_due, Status: inv.status,
    })), 'ap_invoices.csv');
  };

  const createInvoice = async () => {
    setSaveErr('');
    if (!form.supplier_code) return setSaveErr('Supplier is required');
    if (!form.period_id)     return setSaveErr('Period is required');
    if (!form.total_incl_vat || parseFloat(form.total_incl_vat) <= 0) return setSaveErr('Amount is required');
    setSaving(true);
    const r = await req('/fin/ap/invoices', { method: 'POST', body: JSON.stringify(form) });
    setSaving(false);
    if (r.error) return setSaveErr(r.error);
    setInvModal(false);
    setForm({ supplier_code: '', supplier_invoice_no: '', invoice_date: new Date().toISOString().slice(0,10), period_id: '', subtotal_excl_vat: '', vat_amount: '', total_incl_vat: '', document_ref: '' });
    loadInvoices();
  };

  const STATUS_COLOR = { UNPOSTED: 'badge-amber', POSTED: 'badge-blue', PARTIAL: 'badge-amber', PAID: 'badge-green', DISPUTED: 'badge-red', CANCELLED: 'badge-gray' };
  const subTabStyle = (t) => ({ padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, borderBottom: subtab === t ? '2px solid #005A8E' : '2px solid transparent', color: subtab === t ? '#005A8E' : '#666' });

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid #e8edf2', marginBottom: 12, gap: 2 }}>
        <div style={subTabStyle('pending')} onClick={() => setSubtab('pending')}>
          POs Awaiting Invoice
          {pendingPOs.length > 0 && <span className="badge badge-red" style={{ marginLeft: 6, fontSize: 10 }}>{pendingPOs.length}</span>}
        </div>
        <div style={subTabStyle('invoices')} onClick={() => setSubtab('invoices')}>All Supplier Invoices</div>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-primary btn-sm" onClick={() => { setSaveErr(''); setInvModal(true); }}>+ New Invoice</button>
        </div>
      </div>

      {subtab === 'pending' && (
        <>
          {pendingPOs.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
              <div>No POs awaiting supplier invoice capture</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>PO Number</th><th>Supplier</th><th>Description</th><th style={{ textAlign: 'right' }}>Excl VAT</th><th style={{ textAlign: 'right' }}>VAT</th><th style={{ textAlign: 'right' }}>Total Incl</th><th>Submitted</th><th>Attachment</th><th style={{ width: 120 }}>Action</th></tr></thead>
                <tbody>
                  {pendingPOs.map(po => (
                    <tr key={po.po_id}>
                      <td className="mono" style={{ fontWeight: 700, color: '#005A8E' }}>{po.po_number}</td>
                      <td style={{ fontSize: 13 }}>{po.supplier_name || po.supplier_code}</td>
                      <td style={{ fontSize: 12, color: '#555', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{po.po_description}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmt(po.subtotal_excl_vat)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmt(po.vat_amount)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 13, fontWeight: 700 }}>{fmt(po.total_incl_vat)}</td>
                      <td style={{ fontSize: 11 }}>{po.submitted_at ? new Date(po.submitted_at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                      <td style={{ fontSize: 11 }}>
                        {po.onedrive_url
                          ? <a href={po.onedrive_url + '?web=1'} target="_blank" rel="noopener noreferrer" style={{ color: '#005A8E' }}>📎 View</a>
                          : <span style={{ color: '#ccc' }}>—</span>}
                      </td>
                      <td>
                        <button className="btn btn-primary btn-sm" style={{ fontSize: 11 }}
                          onClick={() => { setSaveErr(''); setCapture(po); }}>
                          📥 Capture Invoice
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {subtab === 'invoices' && (
        <>
          {invoices.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button className="btn btn-sm" onClick={doInvoiceExport}>⬇ CSV</button>
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Invoice Ref</th><th>Date</th><th>Supplier</th><th>Supplier Inv No</th><th>Due Date</th><th style={{ textAlign: 'right' }}>Total Incl VAT</th><th style={{ textAlign: 'right' }}>Balance Due</th><th>Status</th></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={8}><div className="loading">Loading…</div></td></tr>}
                {!loading && invoices.length === 0 && <tr><td colSpan={8}><div className="empty-state">No supplier invoices yet</div></td></tr>}
                {!loading && invoices.map(inv => (
                  <tr key={inv.invoice_id}>
                    <td className="mono" style={{ fontWeight: 700 }}>{inv.invoice_ref}</td>
                    <td style={{ fontSize: 12 }}>{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                    <td style={{ fontSize: 13 }}>{inv.fin_suppliers?.supplier_name || inv.supplier_code}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{inv.supplier_invoice_no || '—'}</td>
                    <td style={{ fontSize: 12 }}>{inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 13 }}>{fmt(inv.total_incl_vat)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 13, color: (inv.balance_due || 0) > 0 ? '#e53e3e' : '#059669' }}>{fmt(inv.balance_due)}</td>
                    <td><span className={`badge ${STATUS_COLOR[inv.status] || 'badge-gray'}`} style={{ fontSize: 10 }}>{inv.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {captureModal && (
        <div className="modal-overlay" onClick={() => setCapture(null)}>
          <div className="modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Capture Supplier Invoice — {captureModal.po_number}</h3>
              <button onClick={() => setCapture(null)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              {saveErr && <div style={{ background: '#fff5f5', border: '1px solid #fca5a5', borderRadius: 4, padding: '8px 12px', marginBottom: 12, color: '#e53e3e', fontSize: 13 }}>⚠ {saveErr}</div>}
              <div style={{ background: '#f0f7ff', borderRadius: 6, padding: '10px 12px', marginBottom: 14, fontSize: 13 }}>
                <div><strong>Supplier:</strong> {captureModal.supplier_name}</div>
                <div><strong>PO Description:</strong> {captureModal.po_description}</div>
                <div><strong>Total:</strong> {fmt(captureModal.total_incl_vat)} (incl VAT)</div>
                <div style={{ marginTop: 6, fontSize: 12, color: '#1e40af' }}>
                  ℹ️ Capturing this invoice will <strong>approve the PO</strong> and create the supplier invoice record.
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Supplier Invoice No</label>
                  <input value={form.supplier_invoice_no} onChange={e => set('supplier_invoice_no', e.target.value)} placeholder="Supplier's own invoice number" />
                </div>
                <div className="form-group"><label>Invoice Date</label>
                  <input type="date" value={form.invoice_date} onChange={e => set('invoice_date', e.target.value)} />
                </div>
              </div>
              <div className="form-group"><label>GL Period *</label>
                <select value={form.period_id} onChange={e => set('period_id', e.target.value)}>
                  <option value="">— Select period —</option>
                  {periods.map(p => <option key={p.period_id} value={p.period_id}>{p.period_name}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setCapture(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={captureFromPO} disabled={saving}>{saving ? 'Capturing…' : '📥 Capture & Approve PO'}</button>
            </div>
          </div>
        </div>
      )}

      {invModal && (
        <div className="modal-overlay" onClick={() => setInvModal(false)}>
          <div className="modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>New Supplier Invoice</h3>
              <button onClick={() => setInvModal(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              {saveErr && <div style={{ background: '#fff5f5', border: '1px solid #fca5a5', borderRadius: 4, padding: '8px 12px', marginBottom: 12, color: '#e53e3e', fontSize: 13 }}>⚠ {saveErr}</div>}
              <div className="form-group"><label>Supplier *</label>
                <select value={form.supplier_code} onChange={e => set('supplier_code', e.target.value)}>
                  <option value="">— Select supplier —</option>
                  {suppliers.map(s => <option key={s.supplier_code} value={s.supplier_code}>{s.supplier_code} — {s.supplier_name}</option>)}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Supplier Invoice No</label>
                  <input value={form.supplier_invoice_no} onChange={e => set('supplier_invoice_no', e.target.value)} />
                </div>
                <div className="form-group"><label>Invoice Date *</label>
                  <input type="date" value={form.invoice_date} onChange={e => set('invoice_date', e.target.value)} />
                </div>
              </div>
              <div className="form-group"><label>GL Period *</label>
                <select value={form.period_id} onChange={e => set('period_id', e.target.value)}>
                  <option value="">— Select period —</option>
                  {periods.map(p => <option key={p.period_id} value={p.period_id}>{p.period_name}</option>)}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Amount Excl VAT (R)</label>
                  <input type="number" value={form.subtotal_excl_vat} onChange={e => calcTotals(e.target.value)} step="0.01" />
                </div>
                <div className="form-group"><label>VAT (R)</label>
                  <input type="number" value={form.vat_amount} onChange={e => set('vat_amount', e.target.value)} step="0.01" />
                </div>
                <div className="form-group"><label>Total Incl VAT (R) *</label>
                  <input type="number" value={form.total_incl_vat} onChange={e => set('total_incl_vat', e.target.value)} step="0.01" />
                </div>
              </div>
              <div className="form-group"><label>Document / SharePoint Link</label>
                <input value={form.document_ref} onChange={e => set('document_ref', e.target.value)} placeholder="OneDrive URL or reference" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setInvModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createInvoice} disabled={saving}>{saving ? 'Saving…' : 'Create Invoice'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── SUPPLIER FORM (shared between Add and Edit) ───────────────
function SupplierForm({ initial, onSave, onCancel, saving, title }) {
  const [form, setForm] = useState(initial);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="form-group">
              <label>Supplier Code *</label>
              <input value={form.supplier_code} onChange={e => set('supplier_code', e.target.value.toUpperCase())}
                placeholder="e.g. ACME001" disabled={!!initial._editing} />
            </div>
            <div className="form-group">
              <label>Supplier Name *</label>
              <input value={form.supplier_name} onChange={e => set('supplier_name', e.target.value)} placeholder="Full supplier name" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>VAT Number</label>
              <input value={form.vat_number} onChange={e => set('vat_number', e.target.value)} placeholder="e.g. 4123456789" />
            </div>
            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              <label style={{ marginBottom: 6 }}>VAT Processing</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={!!form.vat_enabled} onChange={e => set('vat_enabled', e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer' }} />
                Charge VAT on this supplier
              </label>
              <div style={{ fontSize: 11, color: '#888', marginTop: 3 }}>
                {form.vat_enabled ? '✓ VAT will be calculated at 15% on POs' : 'No VAT applied on POs'}
              </div>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Payment Terms (days)</label>
              <input type="number" value={form.payment_terms_days} onChange={e => set('payment_terms_days', e.target.value)} min="0" />
            </div>
            <div className="form-group">
              <label>Credit Limit (R)</label>
              <input type="number" value={form.credit_limit} onChange={e => set('credit_limit', e.target.value)} placeholder="Leave blank for no limit" step="0.01" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Telephone</label>
              <input value={form.telephone} onChange={e => set('telephone', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(form)} disabled={saving}>
            {saving ? 'Saving…' : (initial._editing ? 'Save Changes' : 'Create Supplier')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MAIN AP PAGE ──────────────────────────────────────────────
export default function FinanceAP() {
  const { user } = useAuth();
  const [tab, setTab]             = useState('aging');
  const [aging, setAging]         = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [periods, setPeriods]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [suppLoading, setSuppLoading] = useState(true);
  const [search, setSearch]       = useState('');
  const [selected, setSelected]   = useState(null);
  const [supplierForm, setSupplierForm] = useState(null); // null | form object
  const [saving, setSaving]       = useState(false);
  const [toggling, setToggling]   = useState(null);

  const canToggleWorkshop = ['ADMIN', 'FINANCE', 'WORKSHOP_MANAGER'].includes(user?.role);

  useEffect(() => {
    loadSuppliers();
    req('/fin/periods').then(d => setPeriods(Array.isArray(d) ? d.filter(p => !p.is_closed) : []));
  }, []);

  useEffect(() => {
    if (tab === 'aging') loadAging();
  }, [tab]);

  const loadSuppliers = async () => {
    setSuppLoading(true);
    try {
      const data = await req('/fin/suppliers?active=true');
      setSuppliers(Array.isArray(data) ? data : data?.data || []);
    } catch (e) { console.error(e); }
    finally { setSuppLoading(false); }
  };

  const loadAging = async () => {
    setLoading(true);
    try {
      const data = await req('/fin/aging/suppliers');
      setAging(Array.isArray(data) ? { invoices: data } : data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const openAdd = () => setSupplierForm({ ...EMPTY_SUPPLIER, _editing: false });
  const openEdit = (s) => setSupplierForm({
    supplier_code: s.supplier_code, supplier_name: s.supplier_name,
    vat_number: s.vat_number || '', vat_enabled: !!s.vat_enabled,
    telephone: s.telephone || '', email: s.email || '',
    payment_terms_days: s.payment_terms_days || 30,
    credit_limit: s.credit_limit != null ? String(s.credit_limit) : '',
    _editing: true,
  });

  const saveSupplier = async (form) => {
    if (!form.supplier_code.trim() || !form.supplier_name.trim()) return alert('Supplier Code and Name are required');
    setSaving(true);
    try {
      let res;
      if (form._editing) {
        res = await req(`/fin/suppliers/${form.supplier_code}`, { method: 'PATCH', body: JSON.stringify(form) });
      } else {
        res = await req('/fin/suppliers', { method: 'POST', body: JSON.stringify(form) });
      }
      if (res.error) throw new Error(res.error);
      setSupplierForm(null);
      setSelected(null);
      loadSuppliers();
      setTab('suppliers');
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const toggleWorkshop = async (s, val) => {
    if (!canToggleWorkshop) return;
    setToggling(s.supplier_code);
    await req(`/fin/suppliers/${s.supplier_code}/workshop`, { method: 'PATCH', body: JSON.stringify({ workshop_allowed: val }) });
    setToggling(null);
    loadSuppliers();
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
    Code: s.supplier_code, Name: s.supplier_name,
    VAT: s.vat_number || '', 'VAT Enabled': s.vat_enabled ? 'YES' : 'NO',
    Tel: s.telephone || '', Email: s.email || '',
    'Terms (days)': s.payment_terms_days,
    'Credit Limit': s.credit_limit != null ? s.credit_limit : '',
    'Workshop Allowed': s.workshop_allowed ? 'YES' : 'NO',
  })), 'suppliers.csv');

  const STATUS_COLOR = { POSTED: 'badge-blue', PARTIAL: 'badge-amber', PAID: 'badge-green', DISPUTED: 'badge-red', CANCELLED: 'badge-gray', UNPOSTED: 'badge-gray' };

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid #e8edf2', marginBottom: 16, gap: 4, alignItems: 'center' }}>
        <div style={tabStyle('aging')}        onClick={() => setTab('aging')}>Supplier Aging</div>
        <div style={tabStyle('suppliers')}    onClick={() => setTab('suppliers')}>Master Supplier ({suppLoading ? '…' : suppliers.length})</div>
        <div style={tabStyle('transactions')} onClick={() => setTab('transactions')}>Transactions</div>
        <div style={tabStyle('invoices')}     onClick={() => setTab('invoices')}>Supplier Invoices</div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={openAdd}>+ New Supplier</button>
      </div>

      {/* ── AGING TAB ── */}
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
          <ExportBar onCSV={agingCSV} />
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

      {/* ── SUPPLIERS TAB ── */}
      {tab === 'suppliers' && (
        <>
          <div className="filter-bar">
            <input placeholder="Search supplier code or name…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <ExportBar onCSV={suppliersCSV} />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th><th>Supplier Name</th><th>VAT Number</th><th style={{ textAlign: 'center' }}>VAT</th>
                  <th>Telephone</th><th>Terms</th><th style={{ textAlign: 'right' }}>Credit Limit</th>
                  <th style={{ textAlign: 'center' }}>Workshop</th><th style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {suppLoading && <tr><td colSpan={9}><div className="loading">Loading suppliers…</div></td></tr>}
                {!suppLoading && filteredSuppliers.length === 0 && <tr><td colSpan={9}><div className="empty-state">No suppliers found</div></td></tr>}
                {!suppLoading && filteredSuppliers.map(s => (
                  <tr key={s.supplier_id} onClick={() => setSelected(s)} style={{ cursor: 'pointer' }}>
                    <td className="mono" style={{ fontWeight: 600 }}>{s.supplier_code}</td>
                    <td>{s.supplier_name}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{s.vat_number || '—'}</td>
                    <td style={{ textAlign: 'center' }}>
                      {s.vat_enabled
                        ? <span className="badge badge-green" style={{ fontSize: 10 }}>VAT</span>
                        : <span style={{ color: '#ccc', fontSize: 12 }}>—</span>}
                    </td>
                    <td style={{ fontSize: 12 }}>{s.telephone || '—'}</td>
                    <td style={{ fontSize: 12 }}>{s.payment_terms_days} days</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                      {s.credit_limit != null ? fmt(s.credit_limit) : '—'}
                    </td>
                    <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      {canToggleWorkshop ? (
                        <button
                          className={`btn btn-sm ${s.workshop_allowed ? 'btn-primary' : ''}`}
                          style={{ fontSize: 10, padding: '2px 8px', opacity: toggling === s.supplier_code ? 0.5 : 1 }}
                          onClick={() => toggleWorkshop(s, !s.workshop_allowed)}
                          disabled={toggling === s.supplier_code}
                        >
                          {s.workshop_allowed ? '✓ Workshop' : 'Allow'}
                        </button>
                      ) : (
                        s.workshop_allowed
                          ? <span className="badge badge-green" style={{ fontSize: 10 }}>✓</span>
                          : <span style={{ color: '#ccc', fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                      <button className="btn btn-sm" style={{ fontSize: 11, padding: '2px 8px' }}
                        onClick={() => openEdit(s)}>✏ Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── TRANSACTIONS TAB ── */}
      {tab === 'transactions' && <SupplierTransactions suppliers={suppliers} />}
      {tab === 'invoices'     && <SupplierInvoicesTab suppliers={suppliers} periods={periods} />}

      {/* Supplier Detail Panel (read-only view on row click) */}
      {selected && !supplierForm && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selected.supplier_code} — {selected.supplier_name}</h3>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label>VAT Number</label><div className="mono">{selected.vat_number || '—'}</div></div>
                <div className="form-group"><label>VAT Processing</label>
                  <span className={`badge ${selected.vat_enabled ? 'badge-green' : 'badge-gray'}`} style={{ fontSize: 11 }}>
                    {selected.vat_enabled ? '✓ VAT enabled' : 'No VAT'}
                  </span>
                </div>
                <div className="form-group"><label>Payment Terms</label><div>{selected.payment_terms_days} days</div></div>
                <div className="form-group"><label>Credit Limit</label>
                  <div>{selected.credit_limit != null ? fmt(selected.credit_limit) : 'No limit'}</div>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Telephone</label><div>{selected.telephone || '—'}</div></div>
                <div className="form-group"><label>Email</label><div style={{ fontSize: 12 }}>{selected.email || '—'}</div></div>
                <div className="form-group"><label>Status</label>
                  <span className={`badge ${selected.on_hold ? 'badge-red' : 'badge-green'}`}>{selected.on_hold ? 'On Hold' : 'Active'}</span>
                </div>
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
              <button className="btn btn-sm" style={{ marginRight: 'auto' }}
                onClick={() => { setSelected(null); setTab('transactions'); }}>
                View Transactions →
              </button>
              <button className="btn btn-sm" onClick={() => { openEdit(selected); setSelected(null); }}>✏ Edit Supplier</button>
              <button className="btn btn-primary" onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Supplier Form */}
      {supplierForm && (
        <SupplierForm
          initial={supplierForm}
          onSave={saveSupplier}
          onCancel={() => setSupplierForm(null)}
          saving={saving}
          title={supplierForm._editing ? `Edit Supplier — ${supplierForm.supplier_code}` : 'New Supplier'}
        />
      )}
    </div>
  );
}
