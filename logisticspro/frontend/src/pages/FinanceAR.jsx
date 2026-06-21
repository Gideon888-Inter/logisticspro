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

function ExportBar({ onCSV }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 10, justifyContent: 'flex-end' }}>
      <button className="btn btn-sm" onClick={onCSV}>⬇ CSV</button>
      <button className="btn btn-sm" onClick={onCSV}>⬇ Excel</button>
      <button className="btn btn-sm" onClick={() => window.print()}>🖨 Print</button>
    </div>
  );
}

const EMPTY_CUSTOMER = { customer_code: '', customer_name: '', category: '', vat_number: '', telephone: '', email: '', payment_terms_days: 30, gl_control_account: '1200' };

export default function FinanceAR() {
  const { user } = useAuth();
  const [tab, setTab]             = useState('aging');
  const [aging, setAging]         = useState(null);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [selected, setSelected]   = useState(null);
  const [showAdd, setShowAdd]     = useState(false);
  const [form, setForm]           = useState(EMPTY_CUSTOMER);
  const [saving, setSaving]       = useState(false);
  const [syncing, setSyncing]     = useState(null);
  const [syncMsg, setSyncMsg]     = useState('');

  useEffect(() => { load(); }, [tab]);

  const load = async () => {
    setLoading(true);
    if (tab === 'aging') {
      const data = await req('/fin/aging/debtors');
      setAging(data);
    } else {
      const data = await req('/fin/ar-customers?active=true');
      setCustomers(Array.isArray(data) ? data : []);
    }
    setLoading(false);
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const saveCustomer = async () => {
    if (!form.customer_code.trim() || !form.customer_name.trim()) return alert('Customer Code and Name are required');
    setSaving(true);
    try {
      const res = await req('/fin/ar-customers', { method: 'POST', body: JSON.stringify(form) });
      if (res.error) throw new Error(res.error);
      setShowAdd(false);
      setForm(EMPTY_CUSTOMER);
      setTab('customers');
      load();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const toggleLoads = async (c, val) => {
    setSyncing(c.customer_code);
    setSyncMsg('');
    try {
      const res = await req(`/fin/ar-customers/${c.customer_code}/loads`, {
        method: 'PATCH',
        body: JSON.stringify({ loads_allowed: val }),
      });
      if (res.error) throw new Error(res.error);
      if (res.synced) setSyncMsg(`✓ Customer synced to Loads as "${res.lp_client_code}" — blank rate card created.`);
      load();
    } catch (e) { alert(e.message); }
    finally { setSyncing(null); }
  };

  const tabStyle = (t) => ({
    padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    borderBottom: tab === t ? '2px solid #005A8E' : '2px solid transparent',
    color: tab === t ? '#005A8E' : '#666',
  });

  const filteredCustomers = customers.filter(c =>
    !search || c.customer_code.toLowerCase().includes(search.toLowerCase()) ||
               c.customer_name.toLowerCase().includes(search.toLowerCase())
  );

  const agingCSV = () => {
    if (!aging?.invoices?.length) return;
    exportCSV(aging.invoices.map(i => ({
      Customer: i.customer_name, 'Invoice Ref': i.invoice_ref, 'Invoice Date': i.invoice_date,
      'Due Date': i.due_date, Amount: i.total_incl_vat, Balance: i.balance_due,
      Bucket: i.aging_bucket, 'Load #': i.lp_load_number || '',
    })), 'ar_aging.csv');
  };
  const customersCSV = () => exportCSV(filteredCustomers.map(c => ({
    Code: c.customer_code, Name: c.customer_name, VAT: c.vat_number || '', Tel: c.telephone || '',
    Email: c.email || '', 'Terms (days)': c.payment_terms_days, 'LP Code': c.lp_client_code || '',
    'Loads Allowed': c.loads_allowed ? 'YES' : 'NO', Synced: c.lp_synced ? 'YES' : 'NO',
  })), 'ar_customers.csv');

  return (
    <div>
      {syncMsg && (
        <div style={{ background: '#ecfdf5', border: '1px solid #34d399', borderRadius: 6, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#065f46' }}>
          {syncMsg} <button style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setSyncMsg('')}>✕</button>
        </div>
      )}

      <div style={{ display: 'flex', borderBottom: '1px solid #e8edf2', marginBottom: 16, gap: 4, alignItems: 'center' }}>
        <div style={tabStyle('aging')}     onClick={() => setTab('aging')}>Debtor Aging</div>
        <div style={tabStyle('customers')} onClick={() => setTab('customers')}>Customer Master ({customers.length || '…'})</div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => { setForm(EMPTY_CUSTOMER); setShowAdd(true); }}>+ New Customer</button>
      </div>

      {/* AGING TAB */}
      {tab === 'aging' && (
        <>
          {aging && (
            <div className="stats-grid">
              <div className="stat-card"><div className="stat-label">Total Outstanding</div><div className="stat-value" style={{ color: '#005A8E', fontSize: 15 }}>{fmt(aging.total)}</div></div>
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
              <thead><tr><th>Customer</th><th>Invoice Ref</th><th>Invoice Date</th><th>Due Date</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Balance</th><th>Bucket</th><th>Load #</th></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={8}><div className="loading">Loading debtor aging…</div></td></tr>}
                {!loading && !aging?.invoices?.length && <tr><td colSpan={8}><div className="empty-state">No outstanding invoices</div></td></tr>}
                {!loading && aging?.invoices?.map(i => (
                  <tr key={i.invoice_id}>
                    <td style={{ fontWeight: 600 }}>{i.customer_name}</td>
                    <td className="mono">{i.invoice_ref}</td>
                    <td style={{ fontSize: 12 }}>{i.invoice_date}</td>
                    <td style={{ fontSize: 12 }}>{i.due_date}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(i.total_incl_vat)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#e53e3e' }}>{fmt(i.balance_due)}</td>
                    <td><span className={`badge ${BUCKET_COLOR[i.aging_bucket] || 'badge-gray'}`} style={{ fontSize: 10 }}>{i.aging_bucket}</span></td>
                    <td className="mono" style={{ fontSize: 12 }}>{i.lp_load_number || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* CUSTOMERS TAB */}
      {tab === 'customers' && (
        <>
          <div className="filter-bar">
            <input placeholder="Search customer code or name…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <ExportBar onCSV={customersCSV} />
          <div className="table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Customer Name</th><th>VAT Number</th><th>Telephone</th><th>Email</th><th>Terms</th><th>LP Code</th><th style={{ textAlign: 'center' }}>Loads</th><th>Status</th></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={9}><div className="loading">Loading customers…</div></td></tr>}
                {!loading && filteredCustomers.length === 0 && <tr><td colSpan={9}><div className="empty-state">No customers found</div></td></tr>}
                {!loading && filteredCustomers.map(c => (
                  <tr key={c.customer_id} onClick={() => setSelected(c)} style={{ cursor: 'pointer' }}>
                    <td className="mono" style={{ fontWeight: 600 }}>{c.customer_code}</td>
                    <td>{c.customer_name}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{c.vat_number || '—'}</td>
                    <td style={{ fontSize: 12 }}>{c.telephone || '—'}</td>
                    <td style={{ fontSize: 11, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email || '—'}</td>
                    <td style={{ fontSize: 12 }}>{c.payment_terms_days} days</td>
                    <td className="mono" style={{ fontSize: 12, color: '#00AEEF' }}>{c.lp_client_code || '—'}</td>
                    <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      <button
                        className={`btn btn-sm ${c.loads_allowed ? 'btn-primary' : ''}`}
                        style={{ fontSize: 10, padding: '2px 8px', opacity: syncing === c.customer_code ? 0.5 : 1 }}
                        onClick={() => toggleLoads(c, !c.loads_allowed)}
                        disabled={syncing === c.customer_code}
                        title={c.loads_allowed ? 'Remove from Loads' : 'Allow in Loads + auto-create rate card'}
                      >
                        {syncing === c.customer_code ? '…' : c.loads_allowed ? '✓ Loads' : 'Allow'}
                      </button>
                    </td>
                    <td>
                      {c.on_hold
                        ? <span className="badge badge-red" style={{ fontSize: 10 }}>On Hold</span>
                        : <span className="badge badge-green" style={{ fontSize: 10 }}>Active</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Customer Detail Modal */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selected.customer_code} — {selected.customer_name}</h3>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label>VAT Number</label><div className="mono">{selected.vat_number || '—'}</div></div>
                <div className="form-group"><label>Category</label><div>{selected.category || '—'}</div></div>
                <div className="form-group"><label>Payment Terms</label><div>{selected.payment_terms_days} days</div></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Telephone</label><div>{selected.telephone || '—'}</div></div>
                <div className="form-group"><label>Email</label><div style={{ fontSize: 12, wordBreak: 'break-all' }}>{selected.email || '—'}</div></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>GL Control Account</label><div className="mono">{selected.gl_control_account}</div></div>
                <div className="form-group"><label>LP Client Code</label><div className="mono" style={{ color: '#00AEEF' }}>{selected.lp_client_code || 'Not linked'}</div></div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Loads / Rate Card</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`badge ${selected.loads_allowed ? 'badge-green' : 'badge-gray'}`} style={{ fontSize: 11 }}>
                      {selected.loads_allowed ? '✓ Allowed in Loads' : 'Not in Loads'}
                    </span>
                    {selected.lp_synced && <span className="badge badge-blue" style={{ fontSize: 10 }}>Synced</span>}
                    <button className="btn btn-sm" style={{ fontSize: 11 }}
                      onClick={() => { toggleLoads(selected, !selected.loads_allowed); setSelected(null); }}>
                      {selected.loads_allowed ? 'Remove from Loads' : 'Allow in Loads'}
                    </button>
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

      {/* Add Customer Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>New AR Customer</h3>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label>Customer Code *</label><input value={form.customer_code} onChange={e => set('customer_code', e.target.value.toUpperCase())} placeholder="e.g. CUST001" maxLength={20} /></div>
                <div className="form-group"><label>Customer Name *</label><input value={form.customer_name} onChange={e => set('customer_name', e.target.value)} placeholder="Full customer name" /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>VAT Number</label><input value={form.vat_number} onChange={e => set('vat_number', e.target.value)} placeholder="4xxxxxxxxx" /></div>
                <div className="form-group"><label>Category</label><input value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. RETAIL" /></div>
                <div className="form-group"><label>Payment Terms (days)</label><input type="number" value={form.payment_terms_days} onChange={e => set('payment_terms_days', e.target.value)} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Telephone</label><input value={form.telephone} onChange={e => set('telephone', e.target.value)} /></div>
                <div className="form-group"><label>Email</label><input type="email" value={form.email} onChange={e => set('email', e.target.value)} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>GL Control Account</label><input value={form.gl_control_account} onChange={e => set('gl_control_account', e.target.value)} placeholder="1200" /></div>
              </div>
              <p style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
                ℹ️ After creating, use the <strong>Allow</strong> button in the Loads column to link this customer to the Loads module and auto-create a blank rate card.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveCustomer} disabled={saving}>{saving ? 'Saving…' : 'Create Customer'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
