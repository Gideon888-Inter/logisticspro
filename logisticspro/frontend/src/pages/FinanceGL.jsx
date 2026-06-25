import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../lib/AuthContext';

const API   = `${import.meta.env.VITE_API_URL || ''}/api`;
const token = () => localStorage.getItem('lp_token');
const req   = (path, opts = {}) =>
  fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(), ...(opts.headers || {}) },
  }).then(r => r.json());

function exportCSV(rows, filename) {
  const headers = Object.keys(rows[0] || {});
  const csv = [headers, ...rows.map(r => headers.map(h => `"${(r[h] ?? '').toString().replace(/"/g, '""')}"`))].map(r => r.join(',')).join('\n');
  const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = filename; a.click();
}

const fmt     = (n) => n == null ? '—' : `R ${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => { if (!d) return '—'; const dt = new Date(d); return dt.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }); };

const EMPTY_ACCOUNT = {
  account_code: '', account_name: '', category: 'Expenses',
  ifrs_classification: 'Income Statement', account_type: 'DETAIL',
  vat_treatment: 'NONE', allowed_vat_codes: '', is_sub_account: false,
  parent_code: '', allow_journals: true, active: true, notes: '',
};

// ── CHART OF ACCOUNTS ──────────────────────────────────────────────────────
function ChartOfAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [catFilter, setCat]     = useState('');
  const [showAdd, setShowAdd]   = useState(false);
  const [editAcct, setEditAcct] = useState(null);
  const [form, setForm]         = useState(EMPTY_ACCOUNT);
  const [saving, setSaving]     = useState(false);

  useEffect(() => { load(); }, []);
  const load = async () => {
    setLoading(true);
    const data = await req('/fin/accounts');
    setAccounts(Array.isArray(data) ? data : []);
    setLoading(false);
  };
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const openEdit = (a) => {
    setEditAcct(a);
    setForm({
      account_code: a.account_code, account_name: a.account_name,
      category: a.category, ifrs_classification: a.ifrs_classification || 'Income Statement',
      account_type: a.account_type, vat_treatment: a.vat_treatment || 'NONE',
      allowed_vat_codes: a.allowed_vat_codes || '', is_sub_account: a.is_sub_account || false,
      parent_code: a.parent_code || '', allow_journals: a.allow_journals !== false,
      active: a.active !== false, notes: a.notes || '',
    });
    setShowAdd(true);
  };

  const saveAccount = async () => {
    if (!form.account_code.trim() || !form.account_name.trim()) return alert('Account Code and Name are required');
    setSaving(true);
    try {
      let res;
      if (editAcct) {
        res = await req(`/fin/accounts/${editAcct.account_id}`, { method: 'PATCH', body: JSON.stringify(form) });
      } else {
        res = await req('/fin/accounts', { method: 'POST', body: JSON.stringify(form) });
      }
      if (res.error) throw new Error(res.error);
      setShowAdd(false); setEditAcct(null); setForm(EMPTY_ACCOUNT); load();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const cats = [...new Set(accounts.map(a => a.category))].sort();
  const filtered = accounts.filter(a =>
    (!catFilter || a.category === catFilter) &&
    (!search || a.account_code.toLowerCase().includes(search.toLowerCase()) ||
                a.account_name.toLowerCase().includes(search.toLowerCase()))
  );

  const doExportCSV = () => exportCSV(filtered.map(a => ({
    Code: a.account_code, Name: a.account_name, Category: a.category,
    'IFRS Class': a.ifrs_classification || '', Type: a.account_type,
    'VAT Treatment': a.vat_treatment, 'VAT Codes': a.allowed_vat_codes || '', Active: a.active ? 'YES' : 'NO',
  })), 'gl_accounts.csv');

  const VAT_BADGE = { OUTPUT: 'badge-green', INPUT: 'badge-blue', CAPITAL: 'badge-amber', BOTH: 'badge-purple', NONE: 'badge-gray' };
  const CATS = ['Income','Cost of Sales','Other Income','Expenses','Income Tax',
                'Owners Equity','Current Assets','Non-Current Assets',
                'Current Liabilities','Non-Current Liabilities'];
  const IFRS_CLASSES = ['Income Statement','Balance Sheet','Equity Statement'];

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Total Accounts</div><div className="stat-value">{accounts.length}</div></div>
        <div className="stat-card"><div className="stat-label">Active</div><div className="stat-value" style={{ color: '#00AEEF' }}>{accounts.filter(a => a.active).length}</div></div>
        <div className="stat-card"><div className="stat-label">Sub-Accounts</div><div className="stat-value">{accounts.filter(a => a.is_sub_account).length}</div></div>
        <div className="stat-card"><div className="stat-label">Categories</div><div className="stat-value">{cats.length}</div></div>
      </div>
      <div className="filter-bar">
        <input placeholder="Search code or name…" value={search} onChange={e => setSearch(e.target.value)} />
        <select value={catFilter} onChange={e => setCat(e.target.value)}>
          <option value="">All Categories</option>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button className="btn btn-sm" onClick={doExportCSV}>⬇ CSV</button>
          <button className="btn btn-sm" onClick={() => window.print()}>🖨 Print</button>
          <button className="btn btn-primary btn-sm" onClick={() => { setEditAcct(null); setForm(EMPTY_ACCOUNT); setShowAdd(true); }}>+ New Account</button>
        </div>
      </div>
      <div className="mobile-card-list">
        {loading && <div className="loading">Loading accounts…</div>}
        {!loading && filtered.length === 0 && <div className="empty-state">No accounts found</div>}
        {!loading && filtered.map(a => (
          <div key={a.account_id} className="data-card" onClick={() => openEdit(a)}
            style={{opacity: a.active?1:0.5, paddingLeft: a.is_sub_account ? 20 : 16, borderLeftColor: a.is_sub_account?'#00AEEF':'var(--blue-deep)'}}>
            <div className="data-card-header">
              <div>
                <div className="data-card-title" style={{fontFamily:'monospace'}}>{a.account_code}</div>
                <div className="data-card-sub" style={{fontWeight: a.is_sub_account?400:600}}>{a.account_name}</div>
              </div>
              <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
                <span className={`badge ${VAT_BADGE[a.vat_treatment]||'badge-gray'}`} style={{fontSize:10}}>{a.vat_treatment}</span>
                <span style={{fontSize:10,color:'#888'}}>{a.category}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="desktop-table">
      <div className="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Account Name</th><th>Category</th><th>IFRS Class</th><th>Type</th><th>VAT</th><th style={{ width: 40 }}></th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7}><div className="loading">Loading accounts…</div></td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={7}><div className="empty-state">No accounts found</div></td></tr>}
            {!loading && filtered.map(a => (
              <tr key={a.account_id} style={{ opacity: a.active ? 1 : 0.45 }}>
                <td className="mono" style={{ fontWeight: 600, paddingLeft: a.is_sub_account ? 24 : 8 }}>{a.account_code}</td>
                <td style={{ fontWeight: a.is_sub_account ? 400 : 600 }}>{a.account_name}</td>
                <td style={{ fontSize: 12, color: '#666' }}>{a.category}</td>
                <td style={{ fontSize: 11, color: '#888' }}>{a.ifrs_classification || '—'}</td>
                <td style={{ fontSize: 12 }}>{a.account_type}</td>
                <td><span className={`badge ${VAT_BADGE[a.vat_treatment] || 'badge-gray'}`} style={{ fontSize: 10 }}>{a.vat_treatment}</span></td>
                <td>
                  <button onClick={() => openEdit(a)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#005A8E', fontSize: 14 }} title="Edit account">✏️</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>

      {showAdd && (
        <div className="modal-overlay" onClick={() => { setShowAdd(false); setEditAcct(null); }}>
          <div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editAcct ? `Edit Account — ${editAcct.account_code}` : 'New GL Account'}</h3>
              <button onClick={() => { setShowAdd(false); setEditAcct(null); }} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label>Account Code *</label><input value={form.account_code} onChange={e => set('account_code', e.target.value.toUpperCase())} /></div>
                <div className="form-group"><label>Account Name *</label><input value={form.account_name} onChange={e => set('account_name', e.target.value)} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Category</label>
                  <select value={form.category} onChange={e => set('category', e.target.value)}>
                    {CATS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>IFRS Classification</label>
                  <select value={form.ifrs_classification} onChange={e => set('ifrs_classification', e.target.value)}>
                    {IFRS_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Account Type</label>
                  <select value={form.account_type} onChange={e => set('account_type', e.target.value)}>
                    <option value="DETAIL">DETAIL</option><option value="CONTROL">CONTROL</option><option value="HEADER">HEADER</option>
                  </select>
                </div>
                <div className="form-group"><label>VAT Treatment</label>
                  <select value={form.vat_treatment} onChange={e => set('vat_treatment', e.target.value)}>
                    {['NONE','INPUT','OUTPUT','CAPITAL','BOTH'].map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Allowed VAT Codes</label><input value={form.allowed_vat_codes} onChange={e => set('allowed_vat_codes', e.target.value)} placeholder="e.g. IN_STD,IN_ZERO" /></div>
                <div className="form-group"><label>Parent Account Code</label><input value={form.parent_code} onChange={e => set('parent_code', e.target.value)} placeholder="e.g. 6000" /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Sub-Account?</label>
                  <select value={form.is_sub_account ? 'true' : 'false'} onChange={e => set('is_sub_account', e.target.value === 'true')}>
                    <option value="false">No</option><option value="true">Yes</option>
                  </select>
                </div>
                <div className="form-group"><label>Allow Journals?</label>
                  <select value={form.allow_journals ? 'true' : 'false'} onChange={e => set('allow_journals', e.target.value === 'true')}>
                    <option value="true">Yes</option><option value="false">No</option>
                  </select>
                </div>
                <div className="form-group"><label>Active?</label>
                  <select value={form.active ? 'true' : 'false'} onChange={e => set('active', e.target.value === 'true')}>
                    <option value="true">Yes</option><option value="false">No</option>
                  </select>
                </div>
              </div>
              <div className="form-group"><label>Notes</label><textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} /></div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => { setShowAdd(false); setEditAcct(null); }}>Cancel</button>
              <button className="btn btn-primary" onClick={saveAccount} disabled={saving}>{saving ? 'Saving…' : (editAcct ? 'Save Changes' : 'Create Account')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TrialBalance() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [groupFilter, setGF]  = useState('');

  useEffect(() => { load(); }, []);
  const load = async () => {
    setLoading(true);
    const res = await req('/fin/trial-balance');
    setData(res);
    setLoading(false);
  };

  if (loading) return <div className="loading">Loading trial balance…</div>;
  if (!data)   return <div className="empty-state">No data</div>;

  const groups  = [...new Set(data.accounts.map(a => a.ifrs_classification))].sort();
  const filtered = data.accounts.filter(a =>
    (!groupFilter || a.ifrs_classification === groupFilter) &&
    (Math.abs(a.balance) > 0.001)
  );

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Total Debit</div><div className="stat-value" style={{ color: '#00AEEF', fontSize: 16 }}>{fmt(data.totals.total_debit)}</div></div>
        <div className="stat-card"><div className="stat-label">Total Credit</div><div className="stat-value" style={{ color: '#005A8E', fontSize: 16 }}>{fmt(data.totals.total_credit)}</div></div>
        <div className="stat-card"><div className="stat-label">Balanced</div><div className="stat-value" style={{ color: data.totals.balanced ? '#059669' : '#e53e3e' }}>{data.totals.balanced ? '✓ Yes' : '✗ No'}</div></div>
      </div>
      <div className="filter-bar">
        <select value={groupFilter} onChange={e => setGF(e.target.value)}>
          <option value="">All Sections</option>
          {groups.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <button className="btn btn-sm" onClick={() => exportCSV(filtered.map(a => ({ Code: a.account_code, Name: a.account_name, Classification: a.ifrs_classification, Debit: a.total_debit, Credit: a.total_credit, Balance: a.balance })), 'trial_balance.csv')}>⬇ CSV</button>
        <button className="btn btn-sm" onClick={() => window.print()}>🖨 Print</button>
        <span style={{ fontSize: 12, color: '#888', marginLeft: 'auto' }}>Showing accounts with non-zero balances</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Account Name</th><th>Classification</th><th style={{ textAlign: 'right' }}>Debit</th><th style={{ textAlign: 'right' }}>Credit</th><th style={{ textAlign: 'right' }}>Balance</th></tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={6}><div className="empty-state">No posted journals yet</div></td></tr>}
            {filtered.map(a => (
              <tr key={a.account_code}>
                <td className="mono" style={{ fontWeight: 600 }}>{a.account_code}</td>
                <td>{a.account_name}</td>
                <td style={{ fontSize: 12, color: '#666' }}>{a.ifrs_classification}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{a.total_debit > 0 ? fmt(a.total_debit) : '—'}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{a.total_credit > 0 ? fmt(a.total_credit) : '—'}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: a.balance >= 0 ? '#005A8E' : '#e53e3e' }}>{fmt(Math.abs(a.balance))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── ACCOUNT TRANSACTIONS (LEDGER ENQUIRY) ─────────────────────
function AccountTransactions() {
  const [accounts, setAccounts]   = useState([]);
  const [rows, setRows]           = useState([]);
  const [totals, setTotals]       = useState(null);
  const [loading, setLoading]     = useState(false);
  const [acctFilter, setAcct]     = useState('');
  const [dateFrom, setDateFrom]   = useState('');
  const [dateTo, setDateTo]       = useState('');
  const [searched, setSearched]   = useState(false);

  // Load account list for the dropdown
  useEffect(() => {
    req('/fin/accounts').then(d => setAccounts(Array.isArray(d) ? d : []));
  }, []);

  const search = useCallback(async () => {
    setLoading(true);
    setSearched(true);
    const params = new URLSearchParams();
    if (acctFilter) params.set('account_code', acctFilter);
    if (dateFrom)   params.set('date_from', dateFrom);
    if (dateTo)     params.set('date_to', dateTo);
    const data = await req(`/fin/account-transactions?${params.toString()}`);
    setRows(data.transactions || []);
    setTotals(data.totals || null);
    setLoading(false);
  }, [acctFilter, dateFrom, dateTo]);

  const clear = () => {
    setAcct(''); setDateFrom(''); setDateTo('');
    setRows([]); setTotals(null); setSearched(false);
  };

  const doExport = () => {
    if (!rows.length) return;
    exportCSV(rows.map(r => ({
      Date:            r.journal_date,
      'Journal Ref':   r.journal_ref,
      Type:            r.journal_type,
      Account:         r.account_code,
      'Line Desc':     r.line_desc || '',
      'Journal Desc':  r.journal_desc || '',
      Reference:       r.reference || '',
      'Source Module': r.source_module || '',
      Debit:           r.debit || 0,
      Credit:          r.credit || 0,
      'VAT Amount':    r.vat_amount || 0,
    })), `gl_transactions${acctFilter ? '_' + acctFilter : ''}.csv`);
  };

  // Running balance (debit - credit, chronological order for display)
  const rowsChron  = [...rows].reverse();
  let runningBal   = 0;
  const rowsWithBal = rowsChron.map(r => {
    runningBal += (r.debit || 0) - (r.credit || 0);
    return { ...r, running_balance: runningBal };
  }).reverse(); // back to date-desc for display

  const selectedAccount = accounts.find(a => a.account_code === acctFilter);

  return (
    <div>
      {/* Filter bar */}
      <div style={{ background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 220px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>GL Account</label>
            <select
              value={acctFilter}
              onChange={e => setAcct(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">— All accounts —</option>
              {accounts.map(a => (
                <option key={a.account_code} value={a.account_code}>
                  {a.account_code} — {a.account_name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: '0 0 150px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Date From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div style={{ flex: '0 0 150px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Date To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', paddingBottom: 1 }}>
            <button className="btn btn-primary btn-sm" onClick={search} disabled={loading}>
              {loading ? 'Loading…' : '🔍 Search'}
            </button>
            {searched && (
              <button className="btn btn-sm" onClick={clear}>Clear</button>
            )}
          </div>
        </div>
        {acctFilter && selectedAccount && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#555' }}>
            <span className="badge badge-blue" style={{ fontSize: 11, marginRight: 6 }}>{selectedAccount.category}</span>
            <strong>{selectedAccount.account_code}</strong> — {selectedAccount.account_name}
            {selectedAccount.vat_treatment && selectedAccount.vat_treatment !== 'NONE' && (
              <span style={{ marginLeft: 8, color: '#888' }}>VAT: {selectedAccount.vat_treatment}</span>
            )}
          </div>
        )}
      </div>

      {/* Totals strip — shown once results are in */}
      {totals && (
        <div className="stats-grid" style={{ marginBottom: 12 }}>
          <div className="stat-card">
            <div className="stat-label">Transactions</div>
            <div className="stat-value" style={{ color: '#00AEEF' }}>{rows.length}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Debit</div>
            <div className="stat-value" style={{ fontSize: 14 }}>{fmt(totals.total_debit)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Credit</div>
            <div className="stat-value" style={{ fontSize: 14 }}>{fmt(totals.total_credit)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Net Balance</div>
            <div className="stat-value" style={{ fontSize: 14, color: totals.net_balance >= 0 ? '#005A8E' : '#e53e3e' }}>
              {fmt(Math.abs(totals.net_balance))}
              <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 4 }}>
                {totals.net_balance >= 0 ? 'DR' : 'CR'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Export bar */}
      {rows.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-sm" onClick={doExport}>⬇ CSV</button>
          <button className="btn btn-sm" onClick={doExport}>⬇ Excel</button>
          <button className="btn btn-sm" onClick={() => window.print()}>🖨 Print</button>
          <span style={{ fontSize: 12, color: '#888', alignSelf: 'center', marginLeft: 4 }}>
            {rows.length} line{rows.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Results table */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Journal Ref</th>
              <th>Type</th>
              {!acctFilter && <th>Account</th>}
              <th>Description</th>
              <th>Reference</th>
              <th style={{ textAlign: 'right' }}>Debit</th>
              <th style={{ textAlign: 'right' }}>Credit</th>
              {acctFilter && <th style={{ textAlign: 'right' }}>Running Bal</th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={acctFilter ? 9 : 8}><div className="loading">Loading transactions…</div></td></tr>
            )}
            {!loading && !searched && (
              <tr><td colSpan={acctFilter ? 9 : 8}>
                <div className="empty-state" style={{ padding: '32px 0' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
                  <div>Select filters above and click <strong>Search</strong> to view transactions.</div>
                  <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>No account filter = all accounts. No date filter = all dates.</div>
                </div>
              </td></tr>
            )}
            {!loading && searched && rows.length === 0 && (
              <tr><td colSpan={acctFilter ? 9 : 8}>
                <div className="empty-state">No transactions found for the selected filters.</div>
              </td></tr>
            )}
            {!loading && rowsWithBal.map((r, idx) => (
              <tr key={r.line_id || idx} style={{ background: idx % 2 === 0 ? 'white' : '#fafbfc' }}>
                <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{r.journal_date}</td>
                <td className="mono" style={{ fontWeight: 600, fontSize: 12 }}>{r.journal_ref}</td>
                <td><span className="badge badge-blue" style={{ fontSize: 10 }}>{r.journal_type}</span></td>
                {!acctFilter && <td className="mono" style={{ fontSize: 12 }}>{r.account_code}</td>}
                <td style={{ fontSize: 12 }}>
                  <div>{r.line_desc || r.journal_desc}</div>
                  {r.line_desc && r.journal_desc && r.line_desc !== r.journal_desc && (
                    <div style={{ fontSize: 11, color: '#888' }}>{r.journal_desc}</div>
                  )}
                </td>
                <td style={{ fontSize: 11, color: '#888' }}>{r.journal_ref || r.reference || '—'}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', color: r.debit > 0 ? '#005A8E' : '#ccc' }}>
                  {r.debit > 0 ? fmt(r.debit) : '—'}
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', color: r.credit > 0 ? '#e53e3e' : '#ccc' }}>
                  {r.credit > 0 ? fmt(r.credit) : '—'}
                </td>
                {acctFilter && (
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: r.running_balance >= 0 ? '#005A8E' : '#e53e3e' }}>
                    {fmt(Math.abs(r.running_balance))}
                    <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 3 }}>
                      {r.running_balance >= 0 ? 'DR' : 'CR'}
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── GL JOURNALS ───────────────────────────────────────────────

// ── GL JOURNALS ────────────────────────────────────────────────────────────
// New line shape: date, journalRef (display), description, module (AR/AP/GL),
// account (filtered by module), side (DR/CR), incl_amount, vat_type, vat_amount (auto), excl_amount (auto)
function GLJournals({ user }) {
  const isAdmin  = user?.role === 'ADMIN' || user?.role === 'FINANCE';
  const [journals,  setJournals]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [selected,  setSelected]  = useState(null);
  const [detail,    setDetail]    = useState(null);
  const [showNew,   setShowNew]   = useState(false);
  const [periods,   setPeriods]   = useState([]);
  const [glAccounts,setGlAccounts]= useState([]);  // fin_gl_accounts
  const [customers, setCustomers] = useState([]);  // fin_ar_customers
  const [suppliers, setSuppliers] = useState([]);  // fin_suppliers
  const [vatTypes,  setVatTypes]  = useState([]);
  const [saving,    setSaving]    = useState(false);
  const [saveErr,   setSaveErr]   = useState('');

  // Journal header
  const today = new Date().toISOString().slice(0,10);
  const [hdr, setHdr] = useState({ description: '', period_id: '', journal_date: today });

  // Journal lines — incl_amount is the editable value (inclusive of VAT if applicable)
  // vat_amount and excl_amount are derived automatically from the selected VAT type rate
  const EMPTY_LINE = { date: today, description: '', module: 'GL', account_code: '', side: 'debit', incl_amount: '', vat_type: '', vat_amount: '0', excl_amount: '' };
  const [lines, setLines] = useState([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);

  useEffect(() => { load(); loadSupport(); }, []);

  const load = async () => {
    setLoading(true);
    const data = await req('/fin/journals?limit=200');
    setJournals(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  const loadSupport = async () => {
    const [pRes, aRes, cRes, sRes, vRes] = await Promise.all([
      req('/fin/periods'),
      req('/fin/accounts'),
      req('/fin/ar-customers'),
      req('/fin/suppliers'),
      req('/fin/vat-types'),
    ]);
    const openPeriods = Array.isArray(pRes) ? pRes.filter(p => !p.is_closed) : [];
    setPeriods(openPeriods);
    if (openPeriods.length) setHdr(h => ({ ...h, period_id: String(openPeriods[openPeriods.length - 1].period_id) }));
    // GL accounts: exclude control accounts (account_type === 'CONTROL') from direct posting
    setGlAccounts(Array.isArray(aRes) ? aRes.filter(a => a.active && a.allow_journals && a.account_type !== 'CONTROL') : []);
    setCustomers(Array.isArray(cRes) ? cRes.filter(c => c.active) : []);
    setSuppliers(Array.isArray(sRes) ? sRes.filter(s => s.active) : []);
    setVatTypes(Array.isArray(vRes) ? vRes.filter(v => v.active) : []);
  };

  const openDetail = async (j) => {
    setSelected(j);
    const data = await req(`/fin/journals/${j.journal_id}`);
    setDetail(data);
  };

  // Helper: recalculate vat_amount and excl_amount from incl_amount + vat_type rate
  const calcVat = (inclStr, vat_type) => {
    const incl = parseFloat(inclStr) || 0;
    if (!vat_type) return { vat_amount: '0', excl_amount: incl.toFixed(2) };
    const vt = vatTypes.find(v => v.vat_code === vat_type);
    const rate = vt ? Number(vt.rate_pct) : 0;
    if (rate === 0) return { vat_amount: '0', excl_amount: incl.toFixed(2) };
    const excl = incl / (1 + rate / 100);
    const vat  = incl - excl;
    return { vat_amount: vat.toFixed(2), excl_amount: excl.toFixed(2) };
  };

  // Build VAT type options filtered to what the selected GL account allows
  const vatOptionsFor = (account_code, module) => {
    if (module !== 'GL') return vatTypes; // AP/AR lines: show all
    const acct = glAccounts.find(a => a.account_code === account_code);
    if (!acct || !acct.allowed_vat_codes) return [];
    const allowed = acct.allowed_vat_codes.split(',').map(s => s.trim()).filter(Boolean);
    if (!allowed.length) return [];
    return vatTypes.filter(v => allowed.includes(v.vat_code));
  };

  // When a line changes, cascade: module → clear account; vat_type or incl → recalc
  const setLine = (i, k, v) => {
    setLines(prev => {
      const next = prev.map((l, idx) => idx !== i ? l : { ...l, [k]: v });
      const line = next[i];
      if (k === 'module') { next[i].account_code = ''; next[i].vat_type = ''; next[i].vat_amount = '0'; next[i].excl_amount = ''; }
      if (k === 'account_code') {
        // When account changes, reset VAT if the new account doesn't allow current vat_type
        const allowed = vatOptionsFor(v, line.module);
        if (line.vat_type && !allowed.find(vt => vt.vat_code === line.vat_type)) {
          next[i].vat_type = '';
          next[i].vat_amount = '0';
          const incl = parseFloat(line.incl_amount) || 0;
          next[i].excl_amount = incl.toFixed(2);
        }
      }
      if (k === 'vat_type') {
        const { vat_amount, excl_amount } = calcVat(line.incl_amount, v);
        next[i].vat_amount  = vat_amount;
        next[i].excl_amount = excl_amount;
      }
      if (k === 'incl_amount') {
        const { vat_amount, excl_amount } = calcVat(v, line.vat_type);
        next[i].vat_amount  = vat_amount;
        next[i].excl_amount = excl_amount;
      }
      return next;
    });
  };

  const addLine = () => {
    setLines(prev => {
      const last = prev[prev.length - 1];
      return [...prev, { ...EMPTY_LINE, date: last.date || hdr.journal_date, description: last.description }];
    });
  };

  const removeLine = (i) => {
    if (lines.length <= 2) return;
    setLines(prev => prev.filter((_, idx) => idx !== i));
  };

  // Totals operate on the inclusive amount, split by side (debit/credit)
  const totalDR  = lines.reduce((s, l) => s + (l.side === 'debit'  ? (parseFloat(l.incl_amount) || 0) : 0), 0);
  const totalCR  = lines.reduce((s, l) => s + (l.side === 'credit' ? (parseFloat(l.incl_amount) || 0) : 0), 0);
  const balanced = Math.abs(totalDR - totalCR) < 0.01 && totalDR > 0;

  // Build the account dropdown options based on module selection
  const accountOptions = (module) => {
    if (module === 'AR') return customers.map(c => ({ value: c.customer_code, label: `${c.customer_code} — ${c.customer_name}` }));
    if (module === 'AP') return suppliers.map(s => ({ value: s.supplier_code, label: `${s.supplier_code} — ${s.supplier_name}` }));
    return glAccounts.map(a => ({ value: a.account_code, label: `${a.account_code} — ${a.account_name}` }));
  };

  const save = async () => {
    setSaveErr('');
    if (!hdr.description.trim()) return setSaveErr('Journal description is required');
    // Period and date are derived from the first line's date on the backend
    const firstDate = lines[0]?.date || lines[0]?.incl_amount ? lines[0].date : null;
    if (!firstDate) return setSaveErr('Line date is required');
    if (lines.length < 2)         return setSaveErr('At least 2 lines required');
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].account_code)  return setSaveErr(`Line ${i + 1}: account is required`);
      if (!lines[i].incl_amount)   return setSaveErr(`Line ${i + 1}: amount is required`);
    }
    if (!balanced) return setSaveErr(`Journal not balanced — DR: ${fmt(totalDR)}, CR: ${fmt(totalCR)}`);
    setSaving(true);

    // Map lines to the API format — debit/credit determined by side
    const apiLines = lines.map(l => {
      const incl = parseFloat(l.incl_amount) || 0;
      return {
        account_code: l.account_code,
        description:  l.description || hdr.description,
        debit:        l.side === 'debit'  ? incl : 0,
        credit:       l.side === 'credit' ? incl : 0,
        vat_type:     l.vat_type || null,
        vat_amount:   parseFloat(l.vat_amount) || 0,
        reference:    l.module !== 'GL' ? l.module : null,
      };
    });

    const journalDate = lines[0]?.date || new Date().toISOString().slice(0,10);
    const result = await req('/fin/journals', {
      method: 'POST',
      body: JSON.stringify({ ...hdr, journal_date: journalDate, period_id: hdr.period_id || '', lines: apiLines, journal_type: 'GL' }),
    });
    setSaving(false);
    if (result.error) return setSaveErr(result.error);
    setShowNew(false);
    setHdr({ description: '', period_id: periods.length ? String(periods[periods.length - 1].period_id) : '', journal_date: today });
    setLines([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
    load();
  };

  const MOD_COLOR = { GL: 'badge-blue', AR: 'badge-green', AP: 'badge-amber' };

  return (
    <div>
      <div className="filter-bar">
        <span style={{ fontWeight: 600, fontSize: 14 }}>GL Journal Entry</span>
      </div>

      {/* Posted journals are visible in Account Transactions — this screen is for entry only */}
      {journals.length > 0 && (
        <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
          {journals.length} posted journals — view in Account Transactions tab
        </div>
      )}

      {/* Journal detail panel */}
      {selected && detail && (
        <div style={{ marginTop: 16, background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 8, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 15, color: '#005A8E', marginRight: 12 }}>{selected.journal_ref}</span>
              <span style={{ fontSize: 13, color: '#555' }}>{fmtDate(selected.journal_date)}</span>
              <span style={{ marginLeft: 12, fontSize: 13 }}>{selected.description}</span>
            </div>
            <button onClick={() => { setSelected(null); setDetail(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#888' }}>✕</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Account</th><th>Description</th><th>Ref</th><th style={{ textAlign: 'right' }}>Debit</th><th style={{ textAlign: 'right' }}>Credit</th><th>VAT</th></tr></thead>
              <tbody>
                {(detail.lines || []).map((l, i) => (
                  <tr key={l.line_id || i}>
                    <td style={{ fontSize: 12, color: '#888' }}>{l.line_number}</td>
                    <td className="mono" style={{ fontWeight: 600 }}>{l.account_code}</td>
                    <td style={{ fontSize: 13 }}>{l.description}</td>
                    <td style={{ fontSize: 11, color: '#888' }}>
                      {l.reference ? <span className={`badge ${MOD_COLOR[l.reference] || 'badge-gray'}`} style={{ fontSize: 10 }}>{l.reference}</span> : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#005A8E' }}>{l.debit > 0 ? fmt(l.debit) : '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#e53e3e' }}>{l.credit > 0 ? fmt(l.credit) : '—'}</td>
                    <td style={{ fontSize: 11 }}>{l.vat_type ? <span className="badge badge-blue" style={{ fontSize: 10 }}>{l.vat_type}</span> : '—'}</td>
                  </tr>
                ))}
                <tr style={{ background: '#eef2f7', fontWeight: 700 }}>
                  <td colSpan={4} style={{ textAlign: 'right', fontSize: 12 }}>TOTALS</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#005A8E' }}>{fmt((detail.lines || []).reduce((s, l) => s + (l.debit || 0), 0))}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#e53e3e' }}>{fmt((detail.lines || []).reduce((s, l) => s + (l.credit || 0), 0))}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Journal Modal */}
      {isAdmin && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#1e3a5f', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            📝 New Journal Entry
          </div>
          <div>

              {/* Journal Header — description only; period and date derived from line dates */}
              <div className="form-row" style={{ marginBottom: 12 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Journal Description *</label>
                  <input value={hdr.description} onChange={e => setHdr(h => ({ ...h, description: e.target.value }))} placeholder="e.g. Monthly accruals — June 2026" />
                </div>
                <div style={{ fontSize: 12, color: '#888', alignSelf: 'flex-end', paddingBottom: 8, paddingLeft: 8 }}>
                  Period and date are set per line below
                </div>
              </div>

              {/* Sage-style batch entry grid */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', minWidth: 900 }}>
                  <thead>
                    <tr style={{ background: '#1e3a5f', color: 'white' }}>
                      <th style={{ padding: '7px 5px', textAlign: 'left', width: 34, fontWeight: 500, fontSize: 11 }}>Line</th>
                      <th style={{ padding: '7px 5px', textAlign: 'left', width: 108, fontWeight: 500, fontSize: 11 }}>Date</th>
                      <th style={{ padding: '7px 5px', textAlign: 'left', width: 65, fontWeight: 500, fontSize: 11 }}>Module</th>
                      <th style={{ padding: '7px 5px', textAlign: 'left', minWidth: 180, fontWeight: 500, fontSize: 11 }}>Account</th>
                      <th style={{ padding: '7px 5px', textAlign: 'left', minWidth: 150, fontWeight: 500, fontSize: 11 }}>Description</th>
                      <th style={{ padding: '7px 5px', textAlign: 'left', width: 62, fontWeight: 500, fontSize: 11 }}>DR / CR</th>
                      <th style={{ padding: '7px 5px', textAlign: 'right', width: 115, fontWeight: 500, fontSize: 11 }}>Incl. Amount</th>
                      <th style={{ padding: '7px 5px', textAlign: 'left', width: 120, fontWeight: 500, fontSize: 11 }}>VAT Type</th>
                      <th style={{ padding: '7px 5px', textAlign: 'right', width: 95, fontWeight: 500, fontSize: 11 }}>VAT Amount</th>
                      <th style={{ padding: '7px 5px', textAlign: 'right', width: 105, fontWeight: 500, fontSize: 11 }}>Excl. Amount</th>
                      <th style={{ width: 26 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const allowedVat = vatOptionsFor(l.account_code, l.module);
                      const rowBg = i % 2 === 0 ? 'white' : '#f7f9fc';
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #e2e8f0', background: rowBg }}>
                          {/* Line number */}
                          <td style={{ padding: '3px 5px', color: '#aaa', fontSize: 11, textAlign: 'center' }}>{i + 1}</td>
                          {/* Date */}
                          <td style={{ padding: '3px 4px' }}>
                            <input type="date" value={l.date || hdr.journal_date}
                              onChange={e => setLine(i, 'date', e.target.value)}
                              style={{ width: 106, fontSize: 11, border: '1px solid #cbd5e0', borderRadius: 3, padding: '2px 4px' }} />
                          </td>
                          {/* Module */}
                          <td style={{ padding: '3px 4px' }}>
                            <select value={l.module} onChange={e => setLine(i, 'module', e.target.value)}
                              style={{ width: 62, fontSize: 11, border: '1px solid #cbd5e0', borderRadius: 3, padding: '2px 3px' }}>
                              <option value="GL">GL</option>
                              <option value="AR">AR</option>
                              <option value="AP">AP</option>
                            </select>
                          </td>
                          {/* Account */}
                          <td style={{ padding: '3px 4px' }}>
                            <select value={l.account_code} onChange={e => setLine(i, 'account_code', e.target.value)}
                              style={{ width: '100%', fontSize: 11, border: '1px solid #cbd5e0', borderRadius: 3, padding: '2px 3px' }}>
                              <option value="">— Select —</option>
                              {accountOptions(l.module).map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </td>
                          {/* Description */}
                          <td style={{ padding: '3px 4px' }}>
                            <input value={l.description}
                              onChange={e => setLine(i, 'description', e.target.value)}
                              placeholder="Description…"
                              style={{ width: '100%', fontSize: 11, border: '1px solid #cbd5e0', borderRadius: 3, padding: '2px 5px' }} />
                          </td>
                          {/* DR / CR toggle */}
                          <td style={{ padding: '3px 4px' }}>
                            <select value={l.side} onChange={e => setLine(i, 'side', e.target.value)}
                              style={{ width: 60, fontSize: 11, border: '1px solid #cbd5e0', borderRadius: 3, padding: '2px 3px',
                                       color: l.side === 'debit' ? '#005A8E' : '#c53030', fontWeight: 600 }}>
                              <option value="debit">DR</option>
                              <option value="credit">CR</option>
                            </select>
                          </td>
                          {/* Inclusive amount (editable) */}
                          <td style={{ padding: '3px 4px' }}>
                            <input type="number" value={l.incl_amount}
                              onChange={e => setLine(i, 'incl_amount', e.target.value)}
                              placeholder="0.00" min="0" step="0.01"
                              style={{ width: '100%', textAlign: 'right', fontSize: 12, fontWeight: 600,
                                       border: '1px solid #cbd5e0', borderRadius: 3, padding: '2px 5px',
                                       color: l.side === 'debit' ? '#005A8E' : '#c53030' }} />
                          </td>
                          {/* VAT Type — filtered to account's allowed codes */}
                          <td style={{ padding: '3px 4px' }}>
                            {allowedVat.length > 0 || l.module !== 'GL' ? (
                              <select value={l.vat_type} onChange={e => setLine(i, 'vat_type', e.target.value)}
                                style={{ width: '100%', fontSize: 11, border: '1px solid #cbd5e0', borderRadius: 3, padding: '2px 3px' }}>
                                <option value="">— None —</option>
                                {(l.module !== 'GL' ? vatTypes : allowedVat).map(v => (
                                  <option key={v.vat_code} value={v.vat_code}>{v.vat_code} — {v.rate_pct}%</option>
                                ))}
                              </select>
                            ) : (
                              <span style={{ color: '#bbb', fontSize: 11, paddingLeft: 4 }}>N/A</span>
                            )}
                          </td>
                          {/* VAT Amount (auto-calculated, read-only) */}
                          <td style={{ padding: '3px 4px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12,
                                       color: parseFloat(l.vat_amount) > 0 ? '#c05621' : '#bbb' }}>
                            {parseFloat(l.vat_amount) > 0 ? fmt(parseFloat(l.vat_amount)) : '—'}
                          </td>
                          {/* Exclusive Amount (auto-calculated, read-only) */}
                          <td style={{ padding: '3px 4px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12,
                                       color: '#444' }}>
                            {l.excl_amount ? fmt(parseFloat(l.excl_amount)) : (l.incl_amount ? fmt(parseFloat(l.incl_amount) || 0) : '—')}
                          </td>
                          {/* Remove */}
                          <td style={{ padding: '3px 2px', textAlign: 'center' }}>
                            <button onClick={() => removeLine(i)}
                              disabled={lines.length <= 2}
                              style={{ background: 'none', border: 'none', cursor: lines.length > 2 ? 'pointer' : 'default',
                                       color: lines.length > 2 ? '#e53e3e' : '#ddd', fontSize: 15, lineHeight: 1 }}>✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#1e3a5f', color: 'white', fontWeight: 700 }}>
                      <td colSpan={6} style={{ padding: '7px 5px', textAlign: 'right', fontSize: 12 }}>TOTALS</td>
                      <td style={{ padding: '7px 5px', textAlign: 'right', fontFamily: 'monospace' }}>
                        <div style={{ color: '#7ec8f4' }}>DR {fmt(totalDR)}</div>
                        <div style={{ color: '#fca5a5', fontSize: 11, marginTop: 1 }}>CR {fmt(totalCR)}</div>
                      </td>
                      <td colSpan={3} style={{ padding: '7px 5px', textAlign: 'center' }}>
                        {balanced
                          ? <span className="badge badge-green" style={{ fontSize: 11 }}>✓ Balanced</span>
                          : <span className="badge badge-red" style={{ fontSize: 11 }}>⚠ Diff: {fmt(Math.abs(totalDR - totalCR))}</span>
                        }
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>



              {saveErr && (
                <div style={{ marginTop: 10, padding: '8px 12px', background: '#fff5f5', border: '1px solid #fc8181', borderRadius: 6, color: '#c53030', fontSize: 13 }}>
                  {saveErr}
                </div>
              )}
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={save} disabled={saving || !balanced}>
                  {saving ? 'Saving…' : '⬆ Post Journal'}
                </button>
                <button className="btn btn-sm" onClick={addLine}>+ Add Line</button>
                <button className="btn btn-sm" onClick={() => {
                  setLines([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
                  setHdr(h => ({ ...h, description: '' }));
                  setSaveErr('');
                }}>↺ Clear</button>
              </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── INCOME STATEMENT ───────────────────────────────────────────────────────
// Shows every individual account under its COA category
function IncomeStatement() {
  const defaultFrom = '2026-03-01';
  const defaultTo   = '2027-02-28';
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo,   setDateTo]   = useState(defaultTo);
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [viewMode, setView]     = useState('monthly');
  const [collapsed, setCollapsed] = useState({});

  const fmtN = (n) => {
    if (n == null || n === 0) return '—';
    return Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };

  const load = async () => {
    if (!dateFrom || !dateTo) return setError('Both dates are required');
    setError(''); setLoading(true);
    const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    const res = await req(`/fin/income-statement?${params}`);
    setLoading(false);
    if (res.error) return setError(res.error);
    setData(res);
  };

  const toggle = (cat) => setCollapsed(c => ({ ...c, [cat]: !c[cat] }));

  const exportCSV = () => {
    if (!data) return;
    const { periods, rows } = data;
    const headers = ['Category', 'Account Code', 'Account Name', ...periods.map(p => p.period_name), 'YTD'];
    const csvRows = rows.map(r => [
      r.category, r.account_code, r.account_name,
      ...periods.map(p => r.period_data?.[p.period_id] || 0),
      r.ytd || 0,
    ]);
    const csv = [headers, ...csvRows].map(r => r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `income_statement_${dateFrom}_${dateTo}.csv`;
    a.click();
  };

  // Sections in P&L order
  const SECTIONS = [
    { key: 'Income',         label: 'Revenue',       color: '#005A8E', sign: 1  },
    { key: 'Cost of Sales',  label: 'Cost of Sales', color: '#c53030', sign: -1 },
    { key: 'Other Income',   label: 'Other Income',  color: '#059669', sign: 1  },
    { key: 'Expenses',       label: 'Expenses',      color: '#b45309', sign: -1 },
    { key: 'Income Tax',     label: 'Income Tax',    color: '#6b7280', sign: -1 },
  ];

  const getAccounts = (cat) => (data?.rows || []).filter(r => r.category === cat && (r.ytd !== 0 || true));

  const sectionYTD = (cat) => getAccounts(cat).reduce((s, r) => s + (r.ytd || 0), 0);

  const sectionPeriod = (cat, pid) =>
    getAccounts(cat).reduce((s, r) => s + (r.period_data?.[pid] || 0), 0);

  const periods = data?.periods || [];
  const showPeriods = viewMode === 'monthly';

  const revenue  = sectionYTD('Income') + sectionYTD('Other Income');
  const cos      = sectionYTD('Cost of Sales');
  const expenses = sectionYTD('Expenses');
  const tax      = sectionYTD('Income Tax');
  const grossProfit = revenue - Math.abs(cos);
  const netProfit   = grossProfit - Math.abs(expenses) - Math.abs(tax);

  return (
    <div>
      {/* Filter bar */}
      <div style={{ background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 3 }}>Date From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
          <div><label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 3 }}>Date To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
          <div><label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 3 }}>View</label>
            <select value={viewMode} onChange={e => setView(e.target.value)}>
              <option value="monthly">Monthly columns</option>
              <option value="ytd">YTD only</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 6, paddingBottom: 1 }}>
            <button className="btn btn-primary btn-sm" onClick={load} disabled={loading}>{loading ? 'Loading…' : '🔍 Run'}</button>
            {data && <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>}
            {data && <button className="btn btn-sm" onClick={() => window.print()}>🖨 Print</button>}
          </div>
        </div>
        {error && <div style={{ marginTop: 8, color: '#c53030', fontSize: 13 }}>{error}</div>}
      </div>

      {!data && !loading && (
        <div className="empty-state" style={{ padding: '32px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
          <div>Select date range and click <strong>Run</strong> to generate the Income Statement.</div>
        </div>
      )}

      {data && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#1e3a5f', borderBottom: '2px solid #0f2440' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', minWidth: 80, color: 'white' }}>Code</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', minWidth: 200, color: 'white' }}>Account</th>
                {showPeriods && periods.map(p => (
                  <th key={p.period_id} style={{ padding: '8px 6px', textAlign: 'right', minWidth: 100, whiteSpace: 'nowrap', color: 'white' }}>{p.period_name}</th>
                ))}
                <th style={{ padding: '8px 10px', textAlign: 'right', minWidth: 120, color: 'white', fontWeight: 700 }}>YTD</th>
              </tr>
            </thead>
            <tbody>
              {SECTIONS.map(sec => {
                const accts = getAccounts(sec.key);
                if (accts.length === 0) return null;
                const secYTD = sectionYTD(sec.key);
                const isCollapsed = collapsed[sec.key];
                return (
                  <>
                    {/* Section header row */}
                    <tr key={`hdr-${sec.key}`}
                      onClick={() => toggle(sec.key)}
                      style={{ background: sec.color, color: 'white', cursor: 'pointer', userSelect: 'none' }}>
                      <td colSpan={showPeriods ? periods.length + 2 : 2}
                          style={{ padding: '7px 10px', fontWeight: 700, fontSize: 13 }}>
                        {isCollapsed ? '▶' : '▼'} {sec.label}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>
                        {fmtN(Math.abs(secYTD))}
                      </td>
                    </tr>
                    {/* Account detail rows */}
                    {!isCollapsed && accts.map(r => (
                      <tr key={r.account_code}
                        style={{ borderBottom: '1px solid #f0f4f8', background: 'white' }}>
                        <td className="mono" style={{ padding: '5px 10px', paddingLeft: r.is_sub_account ? 28 : 10, color: '#666', fontSize: 11 }}>{r.account_code}</td>
                        <td style={{ padding: '5px 10px', paddingLeft: r.is_sub_account ? 28 : 10 }}>{r.account_name}</td>
                        {showPeriods && periods.map(p => (
                          <td key={p.period_id} style={{ padding: '5px 6px', textAlign: 'right', fontFamily: 'monospace', color: r.period_data?.[p.period_id] ? '#333' : '#ccc' }}>
                            {fmtN(r.period_data?.[p.period_id] || 0)}
                          </td>
                        ))}
                        <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: r.ytd ? sec.color : '#ccc' }}>
                          {fmtN(r.ytd || 0)}
                        </td>
                      </tr>
                    ))}
                    {/* Section subtotal */}
                    {!isCollapsed && (
                      <tr key={`sub-${sec.key}`} style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                        <td colSpan={showPeriods ? periods.length + 2 : 2}
                            style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 600, fontSize: 12, color: '#555' }}>
                          Total {sec.label}
                        </td>
                        <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: sec.color }}>
                          {fmtN(Math.abs(secYTD))}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}

              {/* Gross Profit */}
              <tr style={{ background: '#dbeafe', borderBottom: '2px solid #93c5fd' }}>
                <td colSpan={showPeriods ? periods.length + 2 : 2}
                    style={{ padding: '7px 10px', fontWeight: 700, fontSize: 13, color: '#1e40af' }}>
                  GROSS PROFIT
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: grossProfit >= 0 ? '#059669' : '#c53030' }}>
                  {fmtN(Math.abs(grossProfit))} {grossProfit < 0 ? '(Loss)' : ''}
                </td>
              </tr>

              {/* Net Profit */}
              <tr style={{ background: netProfit >= 0 ? '#f0fdf4' : '#fff5f5', borderTop: '2px solid #cbd5e0' }}>
                <td colSpan={showPeriods ? periods.length + 2 : 2}
                    style={{ padding: '9px 10px', fontWeight: 700, fontSize: 14, color: netProfit >= 0 ? '#059669' : '#c53030' }}>
                  NET PROFIT {netProfit < 0 ? '(LOSS)' : ''}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 14, color: netProfit >= 0 ? '#059669' : '#c53030' }}>
                  {fmtN(Math.abs(netProfit))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── AUDIT LOG EXPORT ───────────────────────────────────────────────────────
function AuditLog() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setFrom]   = useState('');
  const [dateTo,   setTo]     = useState('');
  const [tableFlt, setTable]  = useState('');

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: 500 });
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo)   params.set('date_to', dateTo);
    if (tableFlt) params.set('table_name', tableFlt);
    const data = await req(`/fin/audit-log?${params}`);
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const doExport = () => {
    if (!rows.length) return;
    exportCSV(rows.map(r => ({
      Time: r.event_time, Table: r.table_name, 'Record ID': r.record_id,
      Action: r.action, 'Changed By': r.changed_by || '',
      'Old Values': r.old_values ? JSON.stringify(r.old_values) : '',
      'New Values': r.new_values ? JSON.stringify(r.new_values) : '',
    })), 'gl_audit_trail.csv');
  };

  const TABLES = ['fin_gl_journals','fin_gl_journal_lines','fin_gl_accounts','fin_periods','fin_assets'];

  return (
    <div>
      <div style={{ background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 3 }}>Date From</label>
            <input type="date" value={dateFrom} onChange={e => setFrom(e.target.value)} /></div>
          <div><label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 3 }}>Date To</label>
            <input type="date" value={dateTo} onChange={e => setTo(e.target.value)} /></div>
          <div><label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 3 }}>Table</label>
            <select value={tableFlt} onChange={e => setTable(e.target.value)}>
              <option value="">All tables</option>
              {TABLES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 6, paddingBottom: 1 }}>
            <button className="btn btn-primary btn-sm" onClick={load} disabled={loading}>{loading ? 'Loading…' : '🔍 Search'}</button>
            {rows.length > 0 && <button className="btn btn-sm" onClick={doExport}>⬇ Export CSV</button>}
          </div>
        </div>
      </div>
      <div className="mobile-card-list">
        {loading && <div className="loading">Loading…</div>}
        {!loading && rows.length === 0 && <div className="empty-state">No audit records found. Try adjusting filters.</div>}
        {!loading && rows.map(r => (
          <div key={r.log_id} className="data-card"
            style={{borderLeftColor: r.action==='DELETE'?'#e53e3e':r.action==='INSERT'?'#059669':'#1e40af'}}>
            <div className="data-card-header">
              <div>
                <div className="data-card-title" style={{fontFamily:'monospace'}}>{r.table_name} / {r.record_id}</div>
                <div className="data-card-sub">{fmtDate(r.event_time)}</div>
              </div>
              <span className={`badge ${r.action==='DELETE'?'badge-red':r.action==='INSERT'?'badge-green':'badge-blue'}`} style={{fontSize:10}}>{r.action}</span>
            </div>
            <div className="data-card-meta">
              <div>By: <strong>{r.changed_by||'—'}</strong></div>
            </div>
            {r.new_values && <div style={{fontSize:11,color:'#555',marginTop:6,fontFamily:'monospace',wordBreak:'break-all'}}>{JSON.stringify(r.new_values).slice(0,120)}</div>}
          </div>
        ))}
      </div>
      <div className="desktop-table">
      <div className="table-wrap">
        <table>
          <thead><tr><th>Time</th><th>Table</th><th>Record</th><th>Action</th><th>Changed By</th><th>Old Values</th><th>New Values</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7}><div className="loading">Loading…</div></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={7}><div className="empty-state">No audit records found. Try adjusting filters.</div></td></tr>}
            {!loading && rows.map(r => (
              <tr key={r.log_id}>
                <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDate(r.event_time)}</td>
                <td className="mono" style={{ fontSize: 11 }}>{r.table_name}</td>
                <td style={{ fontSize: 11 }}>{r.record_id}</td>
                <td><span className={`badge ${r.action === 'DELETE' ? 'badge-red' : r.action === 'INSERT' ? 'badge-green' : 'badge-blue'}`} style={{ fontSize: 10 }}>{r.action}</span></td>
                <td style={{ fontSize: 12 }}>{r.changed_by || '—'}</td>
                <td style={{ fontSize: 11, color: '#888', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.old_values ? JSON.stringify(r.old_values).slice(0, 80) : '—'}
                </td>
                <td style={{ fontSize: 11, color: '#333', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.new_values ? JSON.stringify(r.new_values).slice(0, 80) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  );
}

// ── MAIN EXPORT ────────────────────────────────────────────────────────────

// ── AP SUPPLIER CATEGORIES ────────────────────────────────────
function APCategories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [editId, setEditId]         = useState(null);
  const [editName, setEditName]     = useState('');
  const [addType, setAddType]       = useState('SUPPLIER_TYPE');
  const [addName, setAddName]       = useState('');
  const [saving, setSaving]         = useState(false);
  const [deleting, setDeleting]     = useState(null);
  const [err, setErr]               = useState('');

  const API   = `${import.meta.env.VITE_API_URL || ''}/api`;
  const token = () => localStorage.getItem('lp_token');
  const req   = (path, opts = {}) => fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(), ...(opts.headers || {}) },
  }).then(r => r.json());

  const load = async () => {
    setLoading(true);
    const data = await req('/fin/supplier-categories');
    setCategories(Array.isArray(data) ? data : []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const byType = (type) => categories.filter(c => c.category_type === type);

  const startEdit = (c) => { setEditId(c.id); setEditName(c.name); setErr(''); };
  const cancelEdit = () => { setEditId(null); setEditName(''); };

  const saveEdit = async (id) => {
    if (!editName.trim()) return setErr('Name cannot be empty');
    setSaving(true);
    const r = await req(`/fin/supplier-categories/${id}`, { method: 'PATCH', body: JSON.stringify({ name: editName.trim() }) });
    setSaving(false);
    if (r.error) return setErr(r.error);
    setEditId(null); load();
  };

  const doDelete = async (id) => {
    if (!window.confirm('Delete this category? This cannot be undone.')) return;
    setDeleting(id);
    const r = await req(`/fin/supplier-categories/${id}`, { method: 'DELETE' });
    setDeleting(null);
    if (r.error) return setErr(r.error);
    load();
  };

  const doAdd = async () => {
    if (!addName.trim()) return setErr('Name is required');
    setSaving(true);
    const r = await req('/fin/supplier-categories', { method: 'POST', body: JSON.stringify({ name: addName.trim(), category_type: addType }) });
    setSaving(false);
    if (r.error) return setErr(r.error);
    setAddName(''); load();
  };

  const Section = ({ type, label }) => (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: '#005A8E', marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid #e8edf2' }}>{label}</div>
      {loading ? <div className="loading">Loading…</div> : (
        <div className="table-wrap" style={{ marginBottom: 10 }}>
          <table>
            <thead><tr><th>Name</th><th style={{ width: 120 }}>Actions</th></tr></thead>
            <tbody>
              {byType(type).length === 0 && (
                <tr><td colSpan={2}><div className="empty-state" style={{ padding: '12px 0' }}>No {label.toLowerCase()} defined yet</div></td></tr>
              )}
              {byType(type).map(c => (
                <tr key={c.id}>
                  <td>
                    {editId === c.id ? (
                      <input value={editName} onChange={e => setEditName(e.target.value)}
                        style={{ width: '100%', fontSize: 13 }}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(c.id); if (e.key === 'Escape') cancelEdit(); }}
                        autoFocus />
                    ) : (
                      <span style={{ fontSize: 13 }}>{c.name}</span>
                    )}
                  </td>
                  <td>
                    {editId === c.id ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-primary btn-sm" style={{ fontSize: 11 }} onClick={() => saveEdit(c.id)} disabled={saving}>Save</button>
                        <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={cancelEdit}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={() => startEdit(c)}>✏ Edit</button>
                        <button className="btn btn-sm" style={{ fontSize: 11, color: '#e53e3e', borderColor: '#e53e3e' }}
                          onClick={() => doDelete(c.id)} disabled={deleting === c.id}>
                          {deleting === c.id ? '…' : '🗑'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* Add row for this type */}
      {addType === type && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={addName} onChange={e => setAddName(e.target.value)} placeholder={`New ${label} name…`}
            style={{ flex: 1, maxWidth: 280 }}
            onKeyDown={e => { if (e.key === 'Enter') doAdd(); }} />
          <button className="btn btn-primary btn-sm" onClick={doAdd} disabled={saving}>{saving ? 'Adding…' : '+ Add'}</button>
          <button className="btn btn-sm" onClick={() => { setAddName(''); setErr(''); }}>Clear</button>
        </div>
      )}
      {addType !== type && (
        <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={() => { setAddType(type); setAddName(''); setErr(''); }}>
          + Add {label}
        </button>
      )}
    </div>
  );

  return (
    <div style={{ maxWidth: 640 }}>
      {err && <div style={{ background: '#fff5f5', border: '1px solid #fca5a5', borderRadius: 4, padding: '8px 12px', marginBottom: 12, color: '#e53e3e', fontSize: 13 }}>⚠ {err}</div>}
      <Section type="SUPPLIER_TYPE" label="Supplier Types" />
      <Section type="DISCOUNT"      label="Supplier Discounts" />
    </div>
  );
}

export default function FinanceGL() {
  const { user } = useAuth();
  const [tab, setTab] = useState('coa');

  const tabStyle = (t) => ({
    padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
    borderBottom: tab === t ? '2px solid #005A8E' : '2px solid transparent',
    color: tab === t ? '#005A8E' : '#666', whiteSpace: 'nowrap',
  });

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid #e8edf2', marginBottom: 14, gap: 2, flexWrap: 'wrap' }}>
        <div style={tabStyle('coa')}      onClick={() => setTab('coa')}>Chart of Accounts</div>
        <div style={tabStyle('tb')}       onClick={() => setTab('tb')}>Trial Balance</div>
        <div style={tabStyle('ledger')}   onClick={() => setTab('ledger')}>Account Transactions</div>
        <div style={tabStyle('journals')} onClick={() => setTab('journals')}>GL Journals</div>
        <div style={tabStyle('is')}       onClick={() => setTab('is')}>Income Statement</div>
        <div style={tabStyle('audit')}      onClick={() => setTab('audit')}>Audit Trail</div>
        <div style={tabStyle('ap-cats')}    onClick={() => setTab('ap-cats')}>AP Categories</div>
      </div>
      {tab === 'coa'      && <ChartOfAccounts />}
      {tab === 'tb'       && <TrialBalance />}
      {tab === 'ledger'   && <AccountTransactions />}
      {tab === 'journals' && <GLJournals user={user} />}
      {tab === 'is'       && <IncomeStatement />}
      {tab === 'audit'    && <AuditLog />}
      {tab === 'ap-cats'  && <APCategories />}
    </div>
  );
}


