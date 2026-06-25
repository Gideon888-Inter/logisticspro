import { useState, useEffect } from 'react';

const API   = `${import.meta.env.VITE_API_URL || ''}/api`;
const token = () => localStorage.getItem('lp_token');
const req   = (path, opts = {}) => fetch(API + path, {
  ...opts,
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(), ...(opts.headers || {}) },
}).then(r => r.json());

const fmt     = (n) => n == null ? '—' : `R ${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => { if (!d) return '—'; return new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }); };

// ── CASHBOOK ─────────────────────────────────────────────────────────────────
function Cashbook() {
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
    const rows = entries.map(e => [e.journal_date, e.journal_ref, e.direction, e.bank_account, e.description, e.amount, e.source_module || '']);
    const csv = [headers, ...rows].map(r => r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'cashbook.csv'; a.click();
  };

  const exportCSV = (rows, filename) => {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const csv = [headers, ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g,'""')}"`))].map(r => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = filename; a.click();
  };

  const doStagingExport = () => {
    if (!staging.length) return;
    exportCSV(staging.map(s => ({
      Date: s.transaction_date, Description: s.description,
      Reference: s.reference || '', 'Bank Account': s.bank_account,
      Amount: s.amount, Direction: s.direction || '',
      Status: s.status, 'GL Account': s.gl_account_code || '',
      'VAT Type': s.vat_type || '', 'Journal Ref': s.journal_ref || '',
    })), 'cashbook_staging.csv');
  };

  const tabStyle = (t) => ({
    padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
    borderBottom: tab === t ? '2px solid #005A8E' : '2px solid transparent',
    color: tab === t ? '#005A8E' : '#666',
  });

  // ── STAGING TAB STATE ──
  const [staging, setStaging]         = useState([]);
  const [stagingLoad, setStagingLoad] = useState(false);
  const [posting, setPosting]         = useState({});
  const [postingBulk, setPostingBulk] = useState(false);

  useEffect(() => {
    if (tab !== 'staging') return;
    loadStaging();
  }, [tab]);

  const loadStaging = () => {
    setStagingLoad(true);
    req('/fin/cashbook/staging?limit=200').then(d => {
      setStaging(Array.isArray(d) ? d : []);
      setStagingLoad(false);
    });
  };

  const postEntry = async (stagingId) => {
    setPosting(p => ({ ...p, [stagingId]: true }));
    const result = await req(`/fin/cashbook/staging/${stagingId}/post`, { method: 'POST' });
    setPosting(p => ({ ...p, [stagingId]: false }));
    if (result.error) { alert(`Error: ${result.error}`); return; }
    loadStaging();
  };

  const postBulk = async () => {
    const matched = staging.filter(s => s.status === 'MATCHED').map(s => s.staging_id);
    if (!matched.length) { alert('No MATCHED entries to post'); return; }
    if (!confirm(`Post ${matched.length} matched entries to GL?`)) return;
    setPostingBulk(true);
    const result = await req('/fin/cashbook/staging/post-bulk', {
      method: 'POST',
      body: JSON.stringify({ staging_ids: matched }),
    });
    setPostingBulk(false);
    alert(`Posted: ${result.posted}, Failed: ${result.failed}${result.errors?.length ? '\n' + result.errors.join('\n') : ''}`);
    loadStaging();
  };

  const STATUS_COLOR = { POSTED: 'badge-green', MATCHED: 'badge-blue', SUGGESTED: 'badge-amber', UNMATCHED: 'badge-gray', EXCLUDED: 'badge-gray', ERROR: 'badge-red' };
  const matchedCount = staging.filter(s => s.status === 'MATCHED').length;

  // ── BANK RECON TAB STATE ──
  const [reconBankAcct, setReconBank]    = useState('8400');
  const [reconPeriod, setReconPeriod]    = useState('');
  const [reconDate, setReconDate]        = useState(new Date().toISOString().slice(0,10));
  const [stmtOpening, setStmtOpening]   = useState('');
  const [stmtClosing, setStmtClosing]   = useState('');
  const [reconNotes, setReconNotes]     = useState('');
  const [reconItems, setReconItems]     = useState([]);
  const [reconResult, setReconResult]   = useState(null);
  const [reconSaving, setReconSaving]   = useState(false);
  const [reconLocking, setReconLocking] = useState(false);
  const [pastRecons, setPastRecons]     = useState([]);
  const [reconErr, setReconErr]         = useState('');

  const ITEM_TYPES = [
    { value: 'OUTSTANDING_DEPOSIT',  label: 'Outstanding Deposit (in GL, not on statement)' },
    { value: 'OUTSTANDING_PAYMENT',  label: 'Outstanding Payment (in GL, not on statement)' },
    { value: 'UNRECORDED_RECEIPT',   label: 'Unrecorded Receipt (on statement, not in GL)' },
    { value: 'UNRECORDED_PAYMENT',   label: 'Unrecorded Payment (on statement, not in GL — e.g. bank charges)' },
    { value: 'TIMING_DIFFERENCE',    label: 'Timing Difference' },
    { value: 'ERROR',                label: 'Error' },
  ];

  useEffect(() => {
    if (tab !== 'recon') return;
    req(`/fin/cashbook/bank-recon?bank_account=${reconBankAcct}&limit=10`).then(d => {
      setPastRecons(Array.isArray(d) ? d : []);
    });
  }, [tab, reconBankAcct]);

  const addReconItem = () => setReconItems(prev => [...prev, { item_type: 'OUTSTANDING_DEPOSIT', description: '', amount: '', transaction_date: '' }]);
  const setItem = (i, k, v) => setReconItems(prev => prev.map((it, idx) => idx !== i ? it : { ...it, [k]: v }));
  const removeItem = (i) => setReconItems(prev => prev.filter((_, idx) => idx !== i));

  const saveRecon = async () => {
    setReconErr('');
    if (!reconPeriod)   return setReconErr('Period is required');
    if (!stmtClosing)   return setReconErr('Bank statement closing balance is required');
    setReconSaving(true);
    const result = await req('/fin/cashbook/bank-recon', {
      method: 'POST',
      body: JSON.stringify({
        period_id: reconPeriod, bank_account: reconBankAcct,
        recon_date: reconDate,
        bank_stmt_opening: parseFloat(stmtOpening || 0),
        bank_stmt_closing: parseFloat(stmtClosing || 0),
        notes: reconNotes,
        items: reconItems.filter(i => i.description && i.amount).map(i => ({
          ...i, amount: parseFloat(i.amount || 0),
        })),
      }),
    });
    setReconSaving(false);
    if (result.error) return setReconErr(result.error);
    setReconResult(result);
    req(`/fin/cashbook/bank-recon?bank_account=${reconBankAcct}&limit=10`).then(d => setPastRecons(Array.isArray(d) ? d : []));
  };

  const lockRecon = async () => {
    if (!reconResult?.recon_id) return;
    if (!confirm('Lock this bank reconciliation? This cannot be undone.')) return;
    setReconLocking(true);
    const r = await req(`/fin/cashbook/bank-recon/${reconResult.recon_id}/lock`, { method: 'PATCH' });
    setReconLocking(false);
    if (r.error) { alert(r.error); return; }
    setReconResult(prev => ({ ...prev, status: 'LOCKED' }));
  };

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e8edf2', marginBottom: 14, gap: 2 }}>
        <div style={tabStyle('entries')} onClick={() => setTab('entries')}>Cash Book</div>
        <div style={tabStyle('staging')} onClick={() => setTab('staging')}>Staging / Import</div>
        <div style={tabStyle('recon')}   onClick={() => setTab('recon')}>Bank Reconciliation</div>
      </div>

      {/* ── CASH BOOK TAB ── */}
      {tab === 'entries' && (
        <>
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
                {searched && entries.length > 0 && <span style={{fontSize:12,color:'#aaa',marginLeft:4}}>{entries.length} entries</span>}
              </div>
              <div style={{ marginLeft: 'auto', alignSelf: 'flex-end', paddingBottom: 1 }}>
                <button className="btn btn-primary btn-sm" onClick={() => { setSaveErr(''); setShowNew(true); }}>+ New Entry</button>
              </div>
            </div>
          </div>

          {totals && (
            <div className="stats-grid" style={{ marginBottom: 12 }}>
              <div className="stat-card"><div className="stat-label">Entries</div><div className="stat-value" style={{ color: '#00AEEF' }}>{entries.length}</div></div>
              <div className="stat-card"><div className="stat-label">Total Receipts</div><div className="stat-value" style={{ fontSize: 14, color: '#059669' }}>{fmt(totals.receipts)}</div></div>
              <div className="stat-card"><div className="stat-label">Total Payments</div><div className="stat-value" style={{ fontSize: 14, color: '#e53e3e' }}>{fmt(totals.payments)}</div></div>
              <div className="stat-card">
                <div className="stat-label">Net</div>
                <div className="stat-value" style={{ fontSize: 14, color: totals.net >= 0 ? '#005A8E' : '#e53e3e' }}>
                  {fmt(Math.abs(totals.net))} <span style={{ fontSize: 11, fontWeight: 400 }}>{totals.net >= 0 ? 'DR' : 'CR'}</span>
                </div>
              </div>
            </div>
          )}

          {!searched && (
            <div className="empty-state" style={{ padding: '32px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🏦</div>
              <div>Select filters and click <strong>Search</strong> to view cashbook entries.</div>
            </div>
          )}

          <div className="mobile-card-list">
            {loading && <div className="loading">Loading…</div>}
            {!loading && searched && entries.length === 0 && <div className="empty-state">No entries found</div>}
            {!loading && entries.map((e, i) => (
              <div key={e.line_id||i} className="data-card"
                style={{borderLeftColor: e.direction==='RECEIPT'?'#059669':e.direction==='PAYMENT'?'#e53e3e':'var(--blue)'}}>
                <div className="data-card-header">
                  <div>
                    <div className="data-card-title">{e.description}</div>
                    <div className="data-card-sub" style={{fontFamily:'monospace'}}>{e.journal_ref} · {e.bank_account}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    {e.direction && <span className={`badge ${e.direction==='RECEIPT'?'badge-green':'badge-red'}`} style={{fontSize:10,display:'block',marginBottom:4}}>{e.direction}</span>}
                    <span style={{fontFamily:'monospace',fontWeight:700,fontSize:13,color:e.direction==='RECEIPT'?'#059669':'#e53e3e'}}>
                      {fmt(e.amount)}
                    </span>
                  </div>
                </div>
                <div className="data-card-meta">
                  <div>Date: <strong>{fmtDate(e.journal_date)}</strong></div>
                  {e.source_module && <div>Source: <strong>{e.source_module}</strong></div>}
                </div>
              </div>
            ))}
          </div>
          <div className="desktop-table">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Ref</th><th>Description</th><th>Bank Account</th>
                  <th>Type</th><th style={{ textAlign: 'right' }}>Receipt</th>
                  <th style={{ textAlign: 'right' }}>Payment</th><th>Source</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={8}><div className="loading">Loading…</div></td></tr>}
                {!loading && searched && entries.length === 0 && <tr><td colSpan={8}><div className="empty-state">No entries found</div></td></tr>}
                {!loading && entries.map((e, i) => (
                  <tr key={e.line_id || i}>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDate(e.journal_date)}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{e.journal_ref}</td>
                    <td style={{ fontSize: 13 }}>{e.description}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{e.bank_account}</td>
                    <td>
                      {e.direction
                        ? <span className={`badge ${e.direction === 'RECEIPT' ? 'badge-green' : 'badge-red'}`} style={{ fontSize: 10 }}>{e.direction}</span>
                        : '—'}
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
          </div>{/* end desktop-table */}
        </>
      )}

      {/* ── STAGING TAB ── */}
      {tab === 'staging' && (
        <>
          <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
            <strong>ℹ️ Staging entries</strong> are imported cashbook transactions awaiting GL posting.
            Entries with status <strong>MATCHED</strong> have a GL account assigned and are ready to post.
          </div>

          <div style={{ display:'flex', gap:8, marginBottom:10, alignItems:'center', flexWrap:'wrap' }}>
            {matchedCount > 0 && (
              <>
                <span style={{ fontSize: 13, color: '#555' }}>{matchedCount} matched {matchedCount === 1 ? 'entry' : 'entries'} ready to post</span>
                <button className="btn btn-primary btn-sm" onClick={postBulk} disabled={postingBulk}>
                  {postingBulk ? 'Posting…' : `⬆ Post All Matched (${matchedCount})`}
                </button>
              </>
            )}
            {staging.length > 0 && (
              <button className="btn btn-sm" onClick={doStagingExport}>⬇ CSV ({staging.length})</button>
            )}
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Description</th><th>Reference</th><th>Bank Account</th>
                  <th>Direction</th><th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Status</th><th>GL Account</th><th>Batch</th><th style={{ width: 80 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {stagingLoad && <tr><td colSpan={10}><div className="loading">Loading staging…</div></td></tr>}
                {!stagingLoad && staging.length === 0 && (
                  <tr><td colSpan={10}><div className="empty-state">No staging entries — import a bank CSV via the cashbook engine</div></td></tr>
                )}
                {!stagingLoad && staging.map(s => (
                  <tr key={s.staging_id} style={{ opacity: s.status === 'EXCLUDED' ? 0.45 : 1 }}>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDate(s.transaction_date)}</td>
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
                    <td style={{ fontSize: 11, color: '#888' }}>{(s.import_batch || '').slice(-12)}</td>
                    <td>
                      {s.status === 'POSTED' ? (
                        <span style={{ fontSize: 11, color: '#059669' }}>✓ {s.journal_ref}</span>
                      ) : s.status === 'EXCLUDED' ? (
                        <span style={{ fontSize: 11, color: '#aaa' }}>Excluded</span>
                      ) : (
                        <button
                          className="btn btn-sm"
                          disabled={!s.gl_account_code || posting[s.staging_id]}
                          onClick={() => postEntry(s.staging_id)}
                          title={!s.gl_account_code ? 'Assign a GL account first' : 'Post to GL'}
                          style={{ fontSize: 11, padding: '3px 8px' }}>
                          {posting[s.staging_id] ? '…' : '⬆ Post'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── BANK RECONCILIATION TAB ── */}
      {tab === 'recon' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>

            {/* Box 1: Recon Setup */}
            <div style={{ background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 8, padding: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#005A8E', marginBottom: 12 }}>📋 Reconciliation Setup</div>
              <div className="form-group">
                <label>Bank Account</label>
                <select value={reconBankAcct} onChange={e => setReconBank(e.target.value)}>
                  {bankAccounts.map(b => <option key={b.account_code} value={b.account_code}>{b.account_code} — {b.account_name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>GL Period</label>
                <select value={reconPeriod} onChange={e => setReconPeriod(e.target.value)}>
                  <option value="">— Select period —</option>
                  {periods.map(p => <option key={p.period_id} value={p.period_id}>{p.period_name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Statement Date</label>
                <input type="date" value={reconDate} onChange={e => setReconDate(e.target.value)} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Statement Opening Balance (R)</label>
                  <input type="number" value={stmtOpening} onChange={e => setStmtOpening(e.target.value)} placeholder="0.00" step="0.01" />
                </div>
                <div className="form-group">
                  <label>Statement Closing Balance (R) *</label>
                  <input type="number" value={stmtClosing} onChange={e => setStmtClosing(e.target.value)} placeholder="0.00" step="0.01" />
                </div>
              </div>
              <div className="form-group">
                <label>Notes</label>
                <textarea value={reconNotes} onChange={e => setReconNotes(e.target.value)} rows={2} placeholder="Optional notes…" />
              </div>
            </div>

            {/* Box 2: Outstanding Items */}
            <div style={{ background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 8, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#005A8E' }}>📝 Outstanding Items</div>
                <button className="btn btn-sm" onClick={addReconItem}>+ Add Item</button>
              </div>
              {reconItems.length === 0 && (
                <div style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                  No outstanding items — click + Add Item if needed
                </div>
              )}
              {reconItems.map((item, i) => (
                <div key={i} style={{ border: '1px solid #e8edf2', borderRadius: 6, padding: 10, marginBottom: 8, background: 'white' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <select value={item.item_type} onChange={e => setItem(i, 'item_type', e.target.value)} style={{ flex: 1, fontSize: 11 }}>
                      {ITEM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <button onClick={() => removeItem(i)} style={{ background: 'none', border: 'none', color: '#e53e3e', cursor: 'pointer', marginLeft: 6 }}>✕</button>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input value={item.description} onChange={e => setItem(i, 'description', e.target.value)}
                      placeholder="Description" style={{ flex: 2, fontSize: 12 }} />
                    <input type="number" value={item.amount} onChange={e => setItem(i, 'amount', e.target.value)}
                      placeholder="Amount" style={{ flex: 1, fontSize: 12, textAlign: 'right' }} />
                    <input type="date" value={item.transaction_date} onChange={e => setItem(i, 'transaction_date', e.target.value)}
                      style={{ flex: 1, fontSize: 11 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Action row */}
          {reconErr && (
            <div style={{ padding: '8px 12px', background: '#fff5f5', border: '1px solid #fc8181', borderRadius: 6, color: '#c53030', fontSize: 13, marginBottom: 12 }}>{reconErr}</div>
          )}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <button className="btn btn-primary" onClick={saveRecon} disabled={reconSaving}>
              {reconSaving ? 'Calculating…' : '🔄 Save / Recalculate'}
            </button>
            {reconResult?.status === 'BALANCED' && (
              <button className="btn btn-sm" style={{ background: '#059669', color: 'white', border: 'none' }}
                onClick={lockRecon} disabled={reconLocking}>
                {reconLocking ? 'Locking…' : '🔒 Lock Reconciliation'}
              </button>
            )}
          </div>

          {/* Box 3 & 4: Results */}
          {reconResult && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              {/* GL Balance */}
              <div style={{ background: '#f0f7ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#1e40af', marginBottom: 10 }}>📊 GL Position</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13 }}>GL Closing Balance</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{fmt(reconResult.gl_closing)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13 }}>Statement Closing Balance</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{fmt(parseFloat(stmtClosing || 0))}</span>
                </div>
              </div>

              {/* Recon Result */}
              <div style={{
                background: Math.abs(reconResult.difference) < 0.01 ? '#f0fdf4' : '#fff5f5',
                border: `1px solid ${Math.abs(reconResult.difference) < 0.01 ? '#86efac' : '#fca5a5'}`,
                borderRadius: 8, padding: 16
              }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: Math.abs(reconResult.difference) < 0.01 ? '#059669' : '#c53030', marginBottom: 10 }}>
                  {Math.abs(reconResult.difference) < 0.01 ? '✅ BALANCED' : '⚠️ DIFFERENCE'}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13 }}>Adjusted Bank Balance</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{fmt(reconResult.difference !== undefined ? (parseFloat(stmtClosing || 0)) : 0)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13 }}>Difference</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 16, color: Math.abs(reconResult.difference) < 0.01 ? '#059669' : '#c53030' }}>
                    {fmt(Math.abs(reconResult.difference))}
                  </span>
                </div>
                <div style={{ marginTop: 8 }}>
                  <span className={`badge ${reconResult.status === 'LOCKED' ? 'badge-purple' : reconResult.status === 'BALANCED' ? 'badge-green' : 'badge-amber'}`}>
                    {reconResult.status}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Past reconciliations */}
          {pastRecons.length > 0 && (
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#555', marginBottom: 8 }}>Previous Reconciliations</div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Period</th><th>Date</th><th>Bank Account</th><th style={{ textAlign: 'right' }}>Statement Closing</th><th style={{ textAlign: 'right' }}>GL Closing</th><th style={{ textAlign: 'right' }}>Difference</th><th>Status</th></tr></thead>
                  <tbody>
                    {pastRecons.map(r => (
                      <tr key={r.recon_id}>
                        <td style={{ fontSize: 12 }}>{r.fin_periods?.period_name || `Period ${r.period_id}`}</td>
                        <td style={{ fontSize: 12 }}>{fmtDate(r.recon_date)}</td>
                        <td className="mono" style={{ fontSize: 11 }}>{r.bank_account}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmt(r.bank_stmt_closing)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmt(r.gl_closing)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: Math.abs(r.difference || 0) < 0.01 ? '#059669' : '#c53030' }}>
                          {fmt(Math.abs(r.difference || 0))}
                        </td>
                        <td><span className={`badge ${r.status === 'LOCKED' ? 'badge-purple' : r.status === 'BALANCED' ? 'badge-green' : 'badge-amber'}`} style={{ fontSize: 10 }}>{r.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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
                <div className="form-group"><label>Direction *</label>
                  <select value={form.direction} onChange={e => set('direction', e.target.value)}>
                    <option value="RECEIPT">Receipt (money in)</option>
                    <option value="PAYMENT">Payment (money out)</option>
                  </select>
                </div>
                <div className="form-group"><label>Date *</label>
                  <input type="date" value={form.transaction_date} onChange={e => set('transaction_date', e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Bank Account *</label>
                  <select value={form.bank_account} onChange={e => set('bank_account', e.target.value)}>
                    {bankAccounts.map(b => <option key={b.account_code} value={b.account_code}>{b.account_code} — {b.account_name}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>Period *</label>
                  <select value={form.period_id} onChange={e => set('period_id', e.target.value)}>
                    <option value="">— Select —</option>
                    {periods.map(p => <option key={p.period_id} value={p.period_id}>{p.period_name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Contra Account *</label>
                <select value={form.contra_account} onChange={e => set('contra_account', e.target.value)}>
                  <option value="">— Select account —</option>
                  {accounts.filter(a => a.account_type !== 'HEADER').map(a => (
                    <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group"><label>Description *</label>
                <input value={form.description} onChange={e => set('description', e.target.value)} placeholder="e.g. Customer payment — Invoice IN100001" />
              </div>
              <div className="form-row">
                <div className="form-group"><label>Amount (R) *</label>
                  <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" min="0.01" step="0.01" />
                </div>
                <div className="form-group"><label>VAT Code</label>
                  <select value={form.vat_type} onChange={e => set('vat_type', e.target.value)}>
                    <option value="NONE">No VAT</option>
                    <option value="IN_STD">Input STD (15%)</option>
                    <option value="OUT_STD">Output STD (15%)</option>
                    <option value="IN_ZERO">Input Zero rated</option>
                  </select>
                </div>
              </div>
              <div className="form-group"><label>Reference</label>
                <input value={form.reference} onChange={e => set('reference', e.target.value)} placeholder="EFT ref, cheque number, etc." />
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

