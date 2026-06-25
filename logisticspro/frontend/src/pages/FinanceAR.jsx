import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../lib/AuthContext';
import InvoicesTab from './Invoices';

const API   = `${import.meta.env.VITE_API_URL || ''}/api`;
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
      <button className="btn btn-sm" onClick={() => window.print()}>🖨 Print</button>
    </div>
  );
}

const EMPTY_CUSTOMER = { customer_code: '', customer_name: '', category: '', vat_number: '', telephone: '', email: '', payment_terms_days: 30, gl_control_account: '1200' };

// ── CUSTOMER TRANSACTIONS ─────────────────────────────────────
function CustomerTransactions({ customers }) {
  const [rows, setRows]         = useState([]);
  const [totals, setTotals]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [searched, setSearched] = useState(false);
  const [custFilter, setCust]   = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');

  const search = useCallback(async () => {
    setLoading(true);
    setSearched(true);
    const params = new URLSearchParams();
    if (custFilter) params.set('customer_code', custFilter);
    if (dateFrom)   params.set('date_from', dateFrom);
    if (dateTo)     params.set('date_to', dateTo);
    const data = await req(`/fin/ar-transactions?${params.toString()}`);
    setRows(data.transactions || []);
    setTotals(data.totals || null);
    setLoading(false);
  }, [custFilter, dateFrom, dateTo]);

  const clear = () => { setCust(''); setDateFrom(''); setDateTo(''); setRows([]); setTotals(null); setSearched(false); };

  // Running balance (invoices add, receipts subtract)
  const rowsChron = [...rows].reverse();
  let runBal = 0;
  const rowsWithBal = rowsChron.map(r => {
    runBal += r.debit - r.credit;
    return { ...r, running_balance: runBal };
  }).reverse();

  const selectedCustomer = customers.find(c => c.customer_code === custFilter);

  const doExport = () => {
    if (!rows.length) return;
    exportCSV(rows.map(r => ({
      Date: r.tx_date, Ref: r.tx_ref, Type: r.tx_type,
      Customer: r.customer_code, Description: r.description,
      'Load #': r.load_number || '',
      Debit: r.debit || 0, Credit: r.credit || 0,
      Status: r.status, 'Due Date': r.due_date || '', 'Balance Due': r.balance_due || 0,
    })), `ar_transactions${custFilter ? '_' + custFilter : ''}.csv`);
  };

  const STATUS_COLOR = { POSTED: 'badge-blue', PARTIAL: 'badge-amber', PAID: 'badge-green', RECEIVED: 'badge-green', DISPUTED: 'badge-red', CANCELLED: 'badge-gray', UNPOSTED: 'badge-gray', OVERDUE: 'badge-red' };

  return (
    <div>
      {/* Filter panel */}
      <div style={{ background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 240px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Customer</label>
            <select value={custFilter} onChange={e => setCust(e.target.value)} style={{ width: '100%' }}>
              <option value="">— All customers —</option>
              {customers.map(c => <option key={c.customer_code} value={c.customer_code}>{c.customer_code} — {c.customer_name}</option>)}
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
            {searched && rows.length > 0 && <button className="btn btn-sm" onClick={() => window.print()}>🖨 Print</button>}
          </div>
        </div>
        {selectedCustomer && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#555' }}>
            <strong>{selectedCustomer.customer_code}</strong> — {selectedCustomer.customer_name}
            {selectedCustomer.payment_terms_days && <span style={{ marginLeft: 8, color: '#888' }}>Terms: {selectedCustomer.payment_terms_days} days</span>}
            {selectedCustomer.lp_client_code && <span className="badge badge-blue" style={{ fontSize: 10, marginLeft: 8 }}>LP: {selectedCustomer.lp_client_code}</span>}
          </div>
        )}
      </div>

      {/* Totals */}
      {totals && (
        <div className="stats-grid" style={{ marginBottom: 12 }}>
          <div className="stat-card"><div className="stat-label">Transactions</div><div className="stat-value" style={{ color: '#00AEEF' }}>{rows.length}</div></div>
          <div className="stat-card"><div className="stat-label">Total Invoiced</div><div className="stat-value" style={{ fontSize: 14, color: '#005A8E' }}>{fmt(totals.total_invoiced)}</div></div>
          <div className="stat-card"><div className="stat-label">Total Received</div><div className="stat-value" style={{ fontSize: 14, color: '#059669' }}>{fmt(totals.total_received)}</div></div>
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
              <th>Date</th>
              <th>Ref</th>
              <th>Type</th>
              {!custFilter && <th>Customer</th>}
              <th>Description</th>
              <th>Load #</th>
              <th>Due Date</th>
              <th style={{ textAlign: 'right' }}>Invoiced</th>
              <th style={{ textAlign: 'right' }}>Received</th>
              {custFilter && <th style={{ textAlign: 'right' }}>Running Bal</th>}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={11}><div className="loading">Loading transactions…</div></td></tr>}
            {!loading && !searched && (
              <tr><td colSpan={11}>
                <div className="empty-state" style={{ padding: '32px 0' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
                  <div>Select filters above and click <strong>Search</strong> to view customer transactions.</div>
                  <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>No customer filter = all customers. No date filter = all dates.</div>
                </div>
              </td></tr>
            )}
            {!loading && searched && rows.length === 0 && (
              <tr><td colSpan={11}><div className="empty-state">No transactions found for the selected filters.</div></td></tr>
            )}
            {!loading && rowsWithBal.map((r, idx) => (
              <tr key={r.tx_ref + idx} style={{ background: idx % 2 === 0 ? 'white' : '#fafbfc' }}>
                <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{r.tx_date}</td>
                <td className="mono" style={{ fontWeight: 600, fontSize: 12 }}>{r.tx_ref}</td>
                <td>
                  <span className={`badge ${r.tx_type === 'INVOICE' ? 'badge-blue' : 'badge-green'}`} style={{ fontSize: 10 }}>
                    {r.tx_type}
                  </span>
                </td>
                {!custFilter && <td className="mono" style={{ fontSize: 12 }}>{r.customer_code}</td>}
                <td style={{ fontSize: 12 }}>{r.description}</td>
                <td className="mono" style={{ fontSize: 11, color: '#00AEEF' }}>{r.load_number || '—'}</td>
                <td style={{ fontSize: 12, color: r.due_date && r.balance_due > 0 && r.due_date < new Date().toISOString().slice(0, 10) ? '#e53e3e' : '#555' }}>
                  {r.due_date || '—'}
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', color: r.debit > 0 ? '#005A8E' : '#ccc' }}>
                  {r.debit > 0 ? fmt(r.debit) : '—'}
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', color: r.credit > 0 ? '#059669' : '#ccc' }}>
                  {r.credit > 0 ? fmt(r.credit) : '—'}
                </td>
                {custFilter && (
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: r.running_balance > 0 ? '#005A8E' : '#059669' }}>
                    {fmt(Math.abs(r.running_balance))}
                    <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 3 }}>{r.running_balance > 0 ? 'DR' : 'CR'}</span>
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

// ── MAIN AR PAGE ──────────────────────────────────────────────
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

  useEffect(() => {
    // Always keep customer list loaded (needed for Transactions tab dropdown)
    loadCustomers();
  }, []);

  useEffect(() => {
    if (tab === 'aging') loadAging();
  }, [tab]);

  const loadCustomers = async () => {
    const data = await req('/fin/ar-customers?active=true');
    setCustomers(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  const loadAging = async () => {
    setLoading(true);
    const data = await req('/fin/aging/debtors');
    setAging(data);
    setLoading(false);
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const saveCustomer = async () => {
    if (!form.customer_code.trim() || !form.customer_name.trim()) return alert('Customer Code and Name are required');
    setSaving(true);
    try {
      const res = await req('/fin/ar-customers', { method: 'POST', body: JSON.stringify(form) });
      if (res.error) throw new Error(res.error);
      setShowAdd(false); setForm(EMPTY_CUSTOMER);
      loadCustomers();
      setTab('customers');
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const toggleLoads = async (c, val) => {
    setSyncing(c.customer_code);
    setSyncMsg('');
    try {
      const res = await req(`/fin/ar-customers/${c.customer_code}/loads`, {
        method: 'PATCH', body: JSON.stringify({ loads_allowed: val }),
      });
      if (res.error) throw new Error(res.error);
      if (res.synced) setSyncMsg(`✓ Customer synced to Loads as "${res.lp_client_code}" — blank rate card created.`);
      loadCustomers();
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
      Customer: i.customer_name, 'Invoice Ref': i.invoice_ref,
      'Invoice Date': i.invoice_date, 'Due Date': i.due_date,
      Amount: i.total_incl_vat, Balance: i.balance_due,
      Bucket: i.aging_bucket, 'Load #': i.lp_load_number || '',
    })), 'ar_aging.csv');
  };
  const customersCSV = () => exportCSV(filteredCustomers.map(c => ({
    Code: c.customer_code, Name: c.customer_name, VAT: c.vat_number || '',
    Tel: c.telephone || '', Email: c.email || '', 'Terms (days)': c.payment_terms_days,
    'LP Code': c.lp_client_code || '', 'Loads Allowed': c.loads_allowed ? 'YES' : 'NO',
  })), 'ar_customers.csv');

  return (
    <div>
      {syncMsg && (
        <div style={{ background: '#ecfdf5', border: '1px solid #34d399', borderRadius: 6, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#065f46' }}>
          {syncMsg} <button style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setSyncMsg('')}>✕</button>
        </div>
      )}

      <div style={{ display: 'flex', borderBottom: '1px solid #e8edf2', marginBottom: 16, gap: 4, alignItems: 'center' }}>
        <div style={tabStyle('aging')}       onClick={() => setTab('aging')}>Debtor Aging</div>
        <div style={tabStyle('customers')}   onClick={() => setTab('customers')}>Customer Master ({customers.length || '…'})</div>
        <div style={tabStyle('transactions')}onClick={() => setTab('transactions')}>Transactions</div>
        <div style={tabStyle('invoices')}   onClick={() => setTab('invoices')}>Invoices</div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => { setForm(EMPTY_CUSTOMER); setShowAdd(true); }}>+ New Customer</button>
      </div>

      {/* ── AGING TAB ── */}
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

      {/* ── CUSTOMERS TAB ── */}
      {tab === 'customers' && (
        <>
          <div className="filter-bar">
            <input placeholder="Search customer code or name…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <ExportBar onCSV={customersCSV} />
          <div className="mobile-card-list">
            {loading && <div className="loading">Loading customers…</div>}
            {!loading && filteredCustomers.length === 0 && <div className="empty-state">No customers found</div>}
            {!loading && filteredCustomers.map(c => (
              <div key={c.customer_id} className="data-card" onClick={() => setSelected(c)}
                style={{borderLeftColor: c.on_hold?'#e53e3e':'var(--blue)'}}>
                <div className="data-card-header">
                  <div>
                    <div className="data-card-title">{c.customer_name}</div>
                    <div className="data-card-sub" style={{fontFamily:'monospace'}}>{c.customer_code}</div>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
                    {c.on_hold
                      ? <span className="badge badge-red" style={{fontSize:10}}>On Hold</span>
                      : <span className="badge badge-green" style={{fontSize:10}}>Active</span>}
                    {c.loads_allowed && <span className="badge badge-blue" style={{fontSize:10}}>Loads</span>}
                  </div>
                </div>
                <div className="data-card-meta">
                  {c.telephone && <div>📱 <strong>{c.telephone}</strong></div>}
                  <div>Terms: <strong>{c.payment_terms_days} days</strong></div>
                  {c.lp_client_code && <div>LP: <strong style={{color:'#00AEEF'}}>{c.lp_client_code}</strong></div>}
                </div>
              </div>
            ))}
          </div>
          <div className="desktop-table">
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
          </div>{/* end desktop-table */}
        </>
      )}

      {/* ── TRANSACTIONS TAB ── */}
      {tab === 'transactions' && <CustomerTransactions customers={customers} />}
      {tab === 'invoices'      && <InvoicesTab />}

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
                    <button className="btn btn-sm" style={{ fontSize: 11 }}
                      onClick={() => { toggleLoads(selected, !selected.loads_allowed); setSelected(null); }}>
                      {selected.loads_allowed ? 'Remove from Loads' : 'Allow in Loads'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-sm" style={{ marginRight: 'auto' }}
                onClick={() => { setSelected(null); setTab('transactions'); }}>
                View Transactions →
              </button>
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
                <div className="form-group"><label>VAT Number</label><input value={form.vat_number} onChange={e => set('vat_number', e.target.value)} /></div>
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



