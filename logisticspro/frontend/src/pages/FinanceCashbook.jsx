import { useState, useEffect } from 'react';

const API   = `${import.meta.env.VITE_API_URL}/api`;
const token = () => localStorage.getItem('lp_token');
const req   = (path, opts = {}) => fetch(API + path, {
  ...opts,
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(), ...(opts.headers || {}) },
}).then(r => r.json());

// ── CASHBOOK ─────────────────────────────────────────────────
function Cashbook() {
  const fmt  = (n) => n == null ? '—' : `R ${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const [tab, setTab]               = useState('entries');
  const [bankAccounts, setBankAccts]= useState([]);
  const [accounts, setAccounts]     = useState([]);
  const [periods, setPeriods]       = useState([]);

  // Entries state
  const [entries, setEntries]       = useState([]);
  const [totals, setTotals]         = useState(null);
  const [loading, setLoading]       = useState(false);
  const [bankFilter, setBankFilter] = useState('');
  const [dirFilter, setDirFilter]   = useState('');
  const [dateFrom, setDateFrom]     = useState('');
  const [dateTo, setDateTo]         = useState('');
  const [searched, setSearched]     = useState(false);

  // New entry state
  const [showNew, setShowNew]       = useState(false);
  const [form, setForm]             = useState({
    bank_account: '8400', contra_account: '', description: '',
    amount: '', direction: 'RECEIPT', transaction_date: new Date().toISOString().slice(0,10),
    period_id: '', reference: '', vat_type: 'NONE',
  });
  const [saving, setSaving]         = useState(false);
  const [saveErr, setSaveErr]       = useState('');

  useEffect(() => {
    // Load bank accounts, GL accounts and open periods
    Promise.all([
      req('/fin/cashbook/bank-accounts'),
      req('/fin/accounts?active=true'),
      req('/fin/periods'),
    ]).then(([ba, accs, pers]) => {
      setBankAccts(Array.isArray(ba) ? ba : []);
      setAccounts(Array.isArray(accs) ? accs : []);
      const openPers = Array.isArray(pers) ? pers.filter(p => !p.is_closed) : [];
      setPeriods(openPers);
      if (openPers.length) setForm(f => ({ ...f, period_id: String(openPers[openPers.length - 1].period_id) }));
    });
  }, []);

  const search = async () => {
    setLoading(true); setSearched(true);
    const params = new URLSearchParams();
    if (bankFilter) params.set('bank_account', bankFilter);
    if (dirFilter)  params.set('direction', dirFilter);
    if (dateFrom)   params.set('date_from', dateFrom);
    if (dateTo)     params.set('date_to', dateTo);
    const data = await req(`/fin/cashbook/entries?${params}`);
    setEntries(data.entries || []);
    setTotals(data.totals || null);
    setLoading(false);
  };

  const saveEntry = async () => {
    setSaveErr('');
    if (!form.contra_account) return setSaveErr('Contra account is required');
    if (!form.description.trim()) return setSaveErr('Description is required');
    if (!form.amount || parseFloat(form.amount) <= 0) return setSaveErr('Amount must be positive');
    if (!form.period_id) return setSaveErr('Period is required');
    setSaving(true);
    const result = await req('/fin/cashbook/entry', {
      method: 'POST',
      body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
    });
    setSaving(false);
    if (result.error) return setSaveErr(result.error);
    setShowNew(false);
    setForm(f => ({ ...f, description: '', amount: '', reference: '', contra_account: '', vat_type: 'NONE' }));
    if (searched) search();
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const doExport = () => {
    if (!entries.length) return;
    const headers = ['Date','Ref','Direction','Bank Account','Description','Amount','Source'];
    const rows = entries.map(e => [
      e.journal_date, e.journal_ref, e.direction, e.bank_account,
      e.description, e.amount, e.source_module || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'cashbook.csv'; a.click();
  };

  const tabStyle = (t) => ({
    padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
    borderBottom: tab === t ? '2px solid #005A8E' : '2px solid transparent',
    color: tab === t ? '#005A8E' : '#666',
  });

  // Staging tab
  const [staging, setStaging]       = useState([]);
  const [stagingLoad, setStagingLoad]= useState(false);
  useEffect(() => {
    if (tab !== 'staging') return;
    setStagingLoad(true);
    req('/fin/cashbook/staging?limit=200').then(d => {
      setStaging(Array.isArray(d) ? d : []);
      setStagingLoad(false);
    });
  }, [tab]);

  const STATUS_COLOR = { POSTED: 'badge-green', PENDING: 'badge-amber', REVIEW: 'badge-blue', ERROR: 'badge-red' };

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e8edf2', marginBottom: 14, gap: 2 }}>
        <div style={tabStyle('entries')} onClick={() => setTab('entries')}>Cash Book</div>
        <div style={tabStyle('staging')} onClick={() => setTab('staging')}>Staging / Import</div>
      </div>

      {/* ── CASH BOOK TAB ── */}
      {tab === 'entries' && (
        <>
          {/* Filter bar */}
          <div style={{ background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 3 }}>Bank Account</label>
                <select value={bankFilter} onChange={e => setBankFilter(e.target.value)} style={{ minWidth: 160 }}>
                  <option value="">All accounts</option>
                  {bankAccounts.map(b => <option key={b.account_code} value={b.account_code}>{b.account_code} — {b.account_name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 3 }}>Direction</label>
                <select value={dirFilter} onChange={e => setDirFilter(e.target.value)}>
                  <option value="">All</option>
                  <option value="RECEIPT">Receipts</option>
                  <option value="PAYMENT">Payments</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 3 }}>Date From</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 3 }}>Date To</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', paddingBottom: 1 }}>
                <button className="btn btn-primary btn-sm" onClick={search} disabled={loading}>{loading ? 'Loading…' : '🔍 Search'}</button>
                {searched && <button className="btn btn-sm" onClick={doExport}>⬇ CSV</button>}
                {searched && <button className="btn btn-sm" onClick={() => window.print()}>🖨 Print</button>}
              </div>
              <div style={{ marginLeft: 'auto', alignSelf: 'flex-end', paddingBottom: 1 }}>
                <button className="btn btn-primary btn-sm" onClick={() => { setSaveErr(''); setShowNew(true); }}>+ New Entry</button>
              </div>
            </div>
          </div>

          {/* Totals */}
          {totals && (
            <div className="stats-grid" style={{ marginBottom: 12 }}>
              <div className="stat-card"><div className="stat-label">Entries</div><div className="stat-value" style={{ color: '#00AEEF' }}>{entries.length}</div></div>
              <div className="stat-card"><div className="stat-label">Total Receipts</div><div className="stat-value" style={{ fontSize: 14, color: '#059669' }}>{fmt(totals.receipts)}</div></div>
              <div className="stat-card"><div className="stat-label">Total Payments</div><div className="stat-value" style={{ fontSize: 14, color: '#e53e3e' }}>{fmt(totals.payments)}</div></div>
              <div className="stat-card">
                <div className="stat-label">Net</div>
                <div className="stat-value" style={{ fontSize: 14, color: totals.net >= 0 ? '#005A8E' : '#e53e3e' }}>{fmt(Math.abs(totals.net))} <span style={{ fontSize: 11, fontWeight: 400 }}>{totals.net >= 0 ? 'DR' : 'CR'}</span></div>
              </div>
            </div>
          )}

          {!searched && (
            <div className="empty-state" style={{ padding: '32px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🏦</div>
              <div>Select filters and click <strong>Search</strong> to view cashbook entries.</div>
              <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>All filters are optional. Entries come from posted GL journals on bank accounts.</div>
            </div>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Ref</th>
                  <th>Description</th>
                  <th>Bank Account</th>
                  <th>Type</th>
                  <th style={{ textAlign: 'right' }}>Receipt</th>
                  <th style={{ textAlign: 'right' }}>Payment</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={8}><div className="loading">Loading cashbook…</div></td></tr>}
                {!loading && searched && entries.length === 0 && <tr><td colSpan={8}><div className="empty-state">No entries found</div></td></tr>}
                {!loading && entries.map((e, i) => (
                  <tr key={e.line_id} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{e.journal_date}</td>
                    <td className="mono" style={{ fontSize: 11, fontWeight: 600 }}>{e.journal_ref}</td>
                    <td style={{ fontSize: 12 }}>{e.description}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{e.bank_account}</td>
                    <td>
                      <span className={`badge ${e.direction === 'RECEIPT' ? 'badge-green' : 'badge-red'}`} style={{ fontSize: 10 }}>
                        {e.direction === 'RECEIPT' ? '↓ REC' : '↑ PAY'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: '#059669' }}>
                      {e.direction === 'RECEIPT' ? fmt(e.amount) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: '#e53e3e' }}>
                      {e.direction === 'PAYMENT' ? fmt(e.amount) : '—'}
                    </td>
                    <td style={{ fontSize: 11, color: '#888' }}>{e.source_module || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── STAGING TAB ── */}
      {tab === 'staging' && (
        <>
          <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
            <strong>ℹ️ Staging entries</strong> are imported or queued cashbook transactions awaiting review and posting. Use the Python cashbook engine to import bank CSV files.
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Reference</th>
                  <th>Bank Account</th>
                  <th>Direction</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Status</th>
                  <th>GL Account</th>
                  <th>Batch</th>
                </tr>
              </thead>
              <tbody>
                {stagingLoad && <tr><td colSpan={9}><div className="loading">Loading staging…</div></td></tr>}
                {!stagingLoad && staging.length === 0 && (
                  <tr><td colSpan={9}><div className="empty-state">No staging entries — import a bank CSV to populate</div></td></tr>
                )}
                {!stagingLoad && staging.map(s => (
                  <tr key={s.staging_id}>
                    <td style={{ fontSize: 12 }}>{s.transaction_date}</td>
                    <td style={{ fontSize: 12 }}>{s.description}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{s.reference || '—'}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{s.bank_account}</td>
                    <td>
                      {s.direction
                        ? <span className={`badge ${s.direction === 'RECEIPT' ? 'badge-green' : 'badge-red'}`} style={{ fontSize: 10 }}>{s.direction}</span>
                        : <span style={{ color: '#ccc' }}>—</span>}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: (s.amount || 0) >= 0 ? '#059669' : '#e53e3e' }}>
                      {fmt(Math.abs(s.amount || 0))}
                    </td>
                    <td><span className={`badge ${STATUS_COLOR[s.status] || 'badge-gray'}`} style={{ fontSize: 10 }}>{s.status || '—'}</span></td>
                    <td className="mono" style={{ fontSize: 11 }}>{s.gl_account_code || '—'}</td>
                    <td style={{ fontSize: 11, color: '#888' }}>{s.import_batch || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── NEW ENTRY MODAL ── */}
      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>New Cashbook Entry</h3>
              <button onClick={() => setShowNew(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              {saveErr && (
                <div style={{ background: '#fff5f5', border: '1px solid #fca5a5', borderRadius: 4, padding: '8px 12px', marginBottom: 12, color: '#e53e3e', fontSize: 13 }}>⚠ {saveErr}</div>
              )}
              <div className="form-row">
                <div className="form-group">
                  <label>Direction *</label>
                  <select value={form.direction} onChange={e => set('direction', e.target.value)}>
                    <option value="RECEIPT">Receipt (money in)</option>
                    <option value="PAYMENT">Payment (money out)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Date *</label>
                  <input type="date" value={form.transaction_date} onChange={e => set('transaction_date', e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Bank Account *</label>
                  <select value={form.bank_account} onChange={e => set('bank_account', e.target.value)}>
                    {bankAccounts.map(b => <option key={b.account_code} value={b.account_code}>{b.account_code} — {b.account_name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Period *</label>
                  <select value={form.period_id} onChange={e => set('period_id', e.target.value)}>
                    <option value="">— Select —</option>
                    {periods.map(p => <option key={p.period_id} value={p.period_id}>{p.period_name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Contra Account * <span style={{ fontSize: 11, color: '#888' }}>(income/expense/creditor/debtor account)</span></label>
                <select value={form.contra_account} onChange={e => set('contra_account', e.target.value)}>
                  <option value="">— Select account —</option>
                  {accounts.filter(a => a.account_type !== 'HEADER').map(a => (
                    <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Description *</label>
                <input value={form.description} onChange={e => set('description', e.target.value)} placeholder="e.g. Customer payment — Invoice INV-2026-001" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Amount (R) *</label>
                  <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" min="0.01" step="0.01" />
                </div>
                <div className="form-group">
                  <label>VAT Code</label>
                  <select value={form.vat_type} onChange={e => set('vat_type', e.target.value)}>
                    <option value="NONE">No VAT</option>
                    <option value="IN_STD">Input STD (15%)</option>
                    <option value="OUT_STD">Output STD (15%)</option>
                    <option value="IN_ZERO">Input Zero rated</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Reference / Cheque No</label>
                <input value={form.reference} onChange={e => set('reference', e.target.value)} placeholder="e.g. EFT ref, cheque number" />
              </div>
              <div style={{ background: '#f0f7ff', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#005A8E' }}>
                {form.direction === 'RECEIPT'
                  ? `Will post: DR ${form.bank_account || 'bank'} / CR ${form.contra_account || 'contra'}`
                  : `Will post: DR ${form.contra_account || 'contra'} / CR ${form.bank_account || 'bank'}`}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowNew(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEntry} disabled={saving}>{saving ? 'Posting…' : 'Post Entry'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FinanceCashbook() {
  return <Cashbook />;
}
