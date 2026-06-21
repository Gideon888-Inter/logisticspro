import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../lib/AuthContext';

const API   = `${import.meta.env.VITE_API_URL}/api`;
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

const EMPTY_ACCOUNT = { account_code: '', account_name: '', category: 'EXPENSES', account_type: 'DETAIL', vat_treatment: 'NONE', allowed_vat_codes: '', is_sub_account: false, parent_account: '' };
const fmt = (n) => n == null ? '—' : `R ${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── CHART OF ACCOUNTS ────────────────────────────────────────
function ChartOfAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [catFilter, setCat]     = useState('');
  const [showAdd, setShowAdd]   = useState(false);
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

  const saveAccount = async () => {
    if (!form.account_code.trim() || !form.account_name.trim()) return alert('Account Code and Name are required');
    setSaving(true);
    try {
      const res = await req('/fin/accounts', { method: 'POST', body: JSON.stringify(form) });
      if (res.error) throw new Error(res.error);
      setShowAdd(false); setForm(EMPTY_ACCOUNT); load();
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
    Code: a.account_code, Name: a.account_name, Category: a.category, Type: a.account_type,
    'VAT Treatment': a.vat_treatment, 'VAT Codes': a.allowed_vat_codes || '', Active: a.active ? 'YES' : 'NO',
  })), 'gl_accounts.csv');

  const VAT_BADGE = { OUTPUT: 'badge-green', INPUT: 'badge-blue', CAPITAL: 'badge-amber', BOTH: 'badge-purple', NONE: 'badge-gray' };

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
        <button className="btn btn-primary btn-sm" onClick={() => { setForm(EMPTY_ACCOUNT); setShowAdd(true); }}>+ New Account</button>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, justifyContent: 'flex-end' }}>
        <button className="btn btn-sm" onClick={doExportCSV}>⬇ CSV</button>
        <button className="btn btn-sm" onClick={doExportCSV}>⬇ Excel</button>
        <button className="btn btn-sm" onClick={() => window.print()}>🖨 Print</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Account Name</th><th>Category</th><th>Type</th><th>VAT Treatment</th><th>Allowed VAT Codes</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6}><div className="loading">Loading accounts…</div></td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={6}><div className="empty-state">No accounts found</div></td></tr>}
            {!loading && filtered.map(a => (
              <tr key={a.account_id} style={{ opacity: a.active ? 1 : 0.5 }}>
                <td className="mono" style={{ fontWeight: 600, paddingLeft: a.is_sub_account ? 24 : 8 }}>{a.account_code}</td>
                <td style={{ fontWeight: a.is_sub_account ? 400 : 600 }}>{a.account_name}</td>
                <td style={{ fontSize: 12, color: '#666' }}>{a.category}</td>
                <td style={{ fontSize: 12 }}>{a.account_type}</td>
                <td><span className={`badge ${VAT_BADGE[a.vat_treatment] || 'badge-gray'}`} style={{ fontSize: 10 }}>{a.vat_treatment}</span></td>
                <td style={{ fontSize: 11, color: '#888' }}>{a.allowed_vat_codes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" style={{ maxWidth: 540 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>New GL Account</h3>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label>Account Code *</label><input value={form.account_code} onChange={e => set('account_code', e.target.value.toUpperCase())} placeholder="e.g. 6100" /></div>
                <div className="form-group"><label>Account Name *</label><input value={form.account_name} onChange={e => set('account_name', e.target.value)} placeholder="Full account name" /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Category</label>
                  <select value={form.category} onChange={e => set('category', e.target.value)}>
                    {['ASSETS', 'LIABILITIES', 'EQUITY', 'INCOME', 'EXPENSES', 'COST_OF_SALES'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>Account Type</label>
                  <select value={form.account_type} onChange={e => set('account_type', e.target.value)}>
                    <option value="DETAIL">DETAIL</option>
                    <option value="CONTROL">CONTROL</option>
                    <option value="HEADER">HEADER</option>
                  </select>
                </div>
                <div className="form-group"><label>VAT Treatment</label>
                  <select value={form.vat_treatment} onChange={e => set('vat_treatment', e.target.value)}>
                    {['NONE', 'INPUT', 'OUTPUT', 'CAPITAL', 'BOTH'].map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Allowed VAT Codes</label><input value={form.allowed_vat_codes} onChange={e => set('allowed_vat_codes', e.target.value)} placeholder="e.g. S1,Z1" /></div>
                <div className="form-group"><label>Parent Account</label><input value={form.parent_account} onChange={e => set('parent_account', e.target.value)} placeholder="e.g. 6000" /></div>
                <div className="form-group"><label>Sub-Account?</label>
                  <select value={form.is_sub_account ? 'true' : 'false'} onChange={e => set('is_sub_account', e.target.value === 'true')}>
                    <option value="false">No</option><option value="true">Yes</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveAccount} disabled={saving}>{saving ? 'Saving…' : 'Create Account'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── TRIAL BALANCE ─────────────────────────────────────────────
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
                <td style={{ fontSize: 11, color: '#888' }}>{r.reference || '—'}</td>
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
function GLJournals({ user }) {
  const isAdmin = user?.role === 'ADMIN';
  const [journals, setJournals]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(null);
  const [detail, setDetail]       = useState(null);
  const [showNew, setShowNew]     = useState(false);
  const [periods, setPeriods]     = useState([]);
  const [accounts, setAccounts]   = useState([]);
  const [form, setForm]           = useState({ journal_type: 'GL', description: '', period_id: '', journal_date: new Date().toISOString().slice(0, 10), lines: [] });
  const [saving, setSaving]       = useState(false);
  const [saveErr, setSaveErr]     = useState('');

  useEffect(() => { load(); loadSupport(); }, []);

  const load = async () => {
    setLoading(true);
    const data = await req('/fin/journals?limit=200');
    setJournals(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  const loadSupport = async () => {
    const [pRes, aRes] = await Promise.all([req('/fin/periods'), req('/fin/accounts')]);
    setPeriods(Array.isArray(pRes) ? pRes.filter(p => !p.is_closed) : []);
    setAccounts(Array.isArray(aRes) ? aRes.filter(a => a.active && a.allow_journals) : []);
  };

  const openDetail = async (j) => {
    setSelected(j);
    const data = await req(`/fin/journals/${j.journal_id}`);
    setDetail(data);
  };

  const addLine = () => setForm(f => ({
    ...f, lines: [...f.lines, { account_code: '', description: '', debit: '', credit: '', vat_type: '', vat_amount: '0' }]
  }));

  const setLine = (i, k, v) => setForm(f => {
    const lines = [...f.lines];
    lines[i] = { ...lines[i], [k]: v };
    if (k === 'debit' || k === 'credit') {
      const amt = parseFloat(v) || 0;
      if (lines[i].vat_type && lines[i].vat_type !== 'NONE') {
        lines[i].vat_amount = (amt * 15 / 115).toFixed(2);
      }
    }
    return { ...f, lines };
  });

  const totalDR  = form.lines.reduce((s, l) => s + (parseFloat(l.debit)  || 0), 0);
  const totalCR  = form.lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const balanced = Math.abs(totalDR - totalCR) < 0.01;

  const save = async () => {
    setSaveErr('');
    if (!form.description.trim()) return setSaveErr('Description is required');
    if (!form.period_id)          return setSaveErr('Period is required');
    if (form.lines.length < 2)    return setSaveErr('At least 2 lines required');
    if (!balanced)                return setSaveErr(`Not balanced — DR: ${totalDR.toFixed(2)}, CR: ${totalCR.toFixed(2)}`);
    setSaving(true);
    const result = await req('/fin/journals', { method: 'POST', body: JSON.stringify(form) });
    setSaving(false);
    if (result.error) return setSaveErr(result.error);
    setShowNew(false);
    setForm({ journal_type: 'GL', description: '', period_id: '', journal_date: new Date().toISOString().slice(0, 10), lines: [] });
    load();
  };

  return (
    <div>
      <div className="filter-bar">
        <span style={{ fontWeight: 600, fontSize: 14 }}>{journals.length} journals</span>
        {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>+ New Journal</button>}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Ref</th><th>Date</th><th>Type</th><th>Description</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'center' }}>Posted</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6}><div className="loading">Loading journals…</div></td></tr>}
            {!loading && journals.length === 0 && <tr><td colSpan={6}><div className="empty-state">No journals posted yet</div></td></tr>}
            {!loading && journals.map(j => (
              <tr key={j.journal_id} onClick={() => openDetail(j)} style={{ cursor: 'pointer' }}>
                <td className="mono" style={{ fontWeight: 600 }}>{j.journal_ref}</td>
                <td>{j.journal_date}</td>
                <td><span className="badge badge-blue" style={{ fontSize: 10 }}>{j.journal_type}</span></td>
                <td>{j.description}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>—</td>
                <td style={{ textAlign: 'center' }}><span className={`badge ${j.posted ? 'badge-green' : 'badge-amber'}`} style={{ fontSize: 10 }}>{j.posted ? 'Posted' : 'Draft'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Journal Detail Modal */}
      {selected && (
        <div className="modal-overlay" onClick={() => { setSelected(null); setDetail(null); }}>
          <div className="modal" style={{ maxWidth: 680 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selected.journal_ref}</h3>
              <button onClick={() => { setSelected(null); setDetail(null); }} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              {!detail && <div className="loading">Loading…</div>}
              {detail && (
                <>
                  <div className="form-row">
                    <div className="form-group"><label>Date</label><div>{detail.journal_date}</div></div>
                    <div className="form-group"><label>Type</label><span className="badge badge-blue">{detail.journal_type}</span></div>
                    <div className="form-group"><label>Status</label><span className={`badge ${detail.posted ? 'badge-green' : 'badge-amber'}`}>{detail.posted ? 'Posted' : 'Draft'}</span></div>
                  </div>
                  <div className="form-group"><label>Description</label><div>{detail.description}</div></div>
                  <div style={{ marginTop: 12 }}>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead><tr style={{ background: '#005A8E', color: 'white' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>Account</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>Description</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Debit</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Credit</th>
                      </tr></thead>
                      <tbody>
                        {(detail.lines || []).map(l => (
                          <tr key={l.line_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                            <td className="mono" style={{ padding: '5px 8px', fontWeight: 600 }}>{l.account_code}</td>
                            <td style={{ padding: '5px 8px' }}>{l.description}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{l.debit > 0 ? fmt(l.debit) : ''}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{l.credit > 0 ? fmt(l.credit) : ''}</td>
                          </tr>
                        ))}
                        <tr style={{ fontWeight: 700, background: '#f5f7fa' }}>
                          <td colSpan={2} style={{ padding: '6px 8px' }}>Totals</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(detail.total_debit)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(detail.total_credit)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: detail.balanced ? '#059669' : '#e53e3e' }}>
                    {detail.balanced ? '✓ Balanced' : '✗ NOT BALANCED'}
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => { setSelected(null); setDetail(null); }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* New Journal Modal */}
      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" style={{ maxWidth: 720 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>New GL Journal</h3>
              <button onClick={() => setShowNew(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              {saveErr && <div style={{ background: '#fff5f5', border: '1px solid #fca5a5', borderRadius: 4, padding: '8px 12px', marginBottom: 12, color: '#e53e3e', fontSize: 13 }}>⚠ {saveErr}</div>}
              <div className="form-row">
                <div className="form-group"><label>Journal Type</label>
                  <select value={form.journal_type} onChange={e => setForm(f => ({ ...f, journal_type: e.target.value }))}>
                    {['GL', 'AP_INV', 'AR_INV', 'FA_PUR', 'FA_DISP', 'YE'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>Period *</label>
                  <select value={form.period_id} onChange={e => setForm(f => ({ ...f, period_id: e.target.value }))}>
                    <option value="">— Select period —</option>
                    {periods.map(p => <option key={p.period_id} value={p.period_id}>{p.period_name}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>Journal Date *</label>
                  <input type="date" value={form.journal_date} onChange={e => setForm(f => ({ ...f, journal_date: e.target.value }))} />
                </div>
              </div>
              <div className="form-group"><label>Description *</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Feb 2026 depreciation journal" />
              </div>
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <label style={{ fontWeight: 600 }}>Journal Lines</label>
                  <button className="btn btn-sm" onClick={addLine}>+ Add Line</button>
                </div>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead><tr style={{ background: '#005A8E', color: 'white' }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>Account</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>Description</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Debit</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Credit</th>
                    <th style={{ width: 24 }}></th>
                  </tr></thead>
                  <tbody>
                    {form.lines.map((l, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '4px 6px' }}>
                          <select value={l.account_code} onChange={e => setLine(i, 'account_code', e.target.value)} style={{ width: '100%', fontSize: 11 }}>
                            <option value="">— Account —</option>
                            {accounts.map(a => <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '4px 6px' }}><input value={l.description} onChange={e => setLine(i, 'description', e.target.value)} style={{ width: '100%', fontSize: 11 }} placeholder="Line description" /></td>
                        <td style={{ padding: '4px 6px' }}><input type="number" value={l.debit} onChange={e => setLine(i, 'debit', e.target.value)} style={{ width: 90, textAlign: 'right', fontSize: 11 }} placeholder="0.00" /></td>
                        <td style={{ padding: '4px 6px' }}><input type="number" value={l.credit} onChange={e => setLine(i, 'credit', e.target.value)} style={{ width: 90, textAlign: 'right', fontSize: 11 }} placeholder="0.00" /></td>
                        <td style={{ padding: '4px' }}><button onClick={() => setForm(f => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))} style={{ background: 'none', border: 'none', color: '#e53e3e', cursor: 'pointer', fontSize: 14 }}>✕</button></td>
                      </tr>
                    ))}
                    {form.lines.length > 0 && (
                      <tr style={{ fontWeight: 700, background: '#f5f7fa' }}>
                        <td colSpan={2} style={{ padding: '6px 8px', color: balanced ? '#059669' : '#e53e3e' }}>{balanced ? '✓ Balanced' : '✗ Out of balance'}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(totalDR)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(totalCR)}</td>
                        <td></td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {form.lines.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: '#aaa', fontSize: 13 }}>Click "+ Add Line" to add journal lines</div>}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowNew(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving || !balanced || form.lines.length < 2}>
                {saving ? 'Posting…' : 'Post Journal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── INCOME STATEMENT ─────────────────────────────────────────
function IncomeStatement() {
  // Default to current FY: Mar 2026 → Feb 2027
  const today = new Date();
  const defaultFrom = '2026-03-01';
  const defaultTo   = '2027-02-28';

  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo,   setDateTo]   = useState(defaultTo);
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [viewMode, setView]     = useState('monthly'); // 'monthly' | 'ytd'

  const fmtN = (n) => {
    if (n == null || n === 0) return '—';
    return Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };
  const fmtPct = (n, d) => {
    if (!d || d === 0) return '—';
    return `${((n / d) * 100).toFixed(1)}%`;
  };
  const varPct = (curr, prior) => {
    if (!prior || prior === 0) return null;
    return ((curr - prior) / Math.abs(prior)) * 100;
  };

  const load = async () => {
    if (!dateFrom || !dateTo) return setError('Both dates are required');
    setError(''); setLoading(true);
    const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/fin/income-statement?${params}`, {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('lp_token') }
    }).then(r => r.json());
    setLoading(false);
    if (res.error) return setError(res.error);
    setData(res);
  };

  const exportCSV = () => {
    if (!data) return;
    const { periods, rows } = data;
    const headers = ['Account', 'Name', 'Section', ...periods.map(p => p.period_name), 'YTD', 'Prior Year'];
    const csvRows = rows.filter(r => r.ytd !== 0 || periods.some(p => r.period_data[p.period_id] !== 0)).map(r => [
      r.account_code, r.account_name, r.category,
      ...periods.map(p => r.period_data[p.period_id] || 0),
      r.ytd, r.prior_year
    ]);
    const csv = [headers, ...csvRows].map(r => r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `income_statement_${dateFrom}_${dateTo}.csv`;
    a.click();
  };

  // Section definitions in order
  const SECTIONS = [
    { key: 'Income',       label: 'Revenue',            color: '#005A8E', headerBg: '#005A8E' },
    { key: 'Cost of Sales',label: 'Cost of Sales',      color: '#e53e3e', headerBg: '#c53030' },
    { key: 'Other Income', label: 'Other Income',       color: '#059669', headerBg: '#047857' },
    { key: 'Expenses',     label: 'Other Expenses',     color: '#d97706', headerBg: '#b45309' },
  ];

  const getAccountsBySection = (cat) =>
    (data?.rows || []).filter(r => r.category === cat);

  const sectionTotal = (cat, periodId) =>
    (data?.rows || []).filter(r => r.category === cat)
      .reduce((s, r) => s + (periodId ? (r.period_data[periodId] || 0) : r.ytd), 0);

  const sectionPrior = (cat) =>
    (data?.rows || []).filter(r => r.category === cat)
      .reduce((s, r) => s + (r.prior_year || 0), 0);

  const periods = data?.periods || [];

  // Compute GP and NP per period and YTD
  const computeGP = (pidOrNull) => {
    const rev = sectionTotal('Income', pidOrNull);
    const cos = sectionTotal('Cost of Sales', pidOrNull);
    return rev - cos;
  };
  const computeNP = (pidOrNull) => {
    const gp   = computeGP(pidOrNull);
    const oi   = sectionTotal('Other Income', pidOrNull);
    const exp  = sectionTotal('Expenses', pidOrNull);
    return gp + oi - exp;
  };

  const colW = viewMode === 'monthly' ? Math.max(90, Math.floor(600 / Math.max(periods.length, 1))) : 120;

  const ValueCell = ({ value, bold, color, isPercent }) => (
    <td style={{
      textAlign: 'right', fontFamily: 'monospace', fontSize: 11,
      padding: '3px 8px', whiteSpace: 'nowrap',
      fontWeight: bold ? 700 : 400,
      color: color || (value < 0 ? '#e53e3e' : value > 0 ? 'inherit' : '#ccc'),
      minWidth: colW,
    }}>
      {isPercent
        ? (value == null ? '—' : `${value.toFixed(1)}%`)
        : fmtN(value)}
    </td>
  );

  const SectionHeader = ({ label, bg }) => (
    <tr>
      <td colSpan={100} style={{ background: bg, color: 'white', fontWeight: 700, fontSize: 12, padding: '5px 10px', letterSpacing: 0.5 }}>
        {label}
      </td>
    </tr>
  );

  const TotalRow = ({ label, getPeriodVal, ytdVal, priorVal, bold, bg, color, isGP }) => (
    <tr style={{ background: bg || '#eef4fb', fontWeight: bold ? 700 : 600, borderTop: '2px solid #ccd9e8' }}>
      <td style={{ padding: '5px 10px', fontSize: 12, fontWeight: bold ? 700 : 600, color: color }}>{label}</td>
      <td style={{ padding: '5px 8px', fontSize: 11, color: '#888' }}></td>
      {viewMode === 'monthly' && periods.map(p => {
        const v = getPeriodVal(p.period_id);
        return <ValueCell key={p.period_id} value={v} bold={bold} color={v < 0 ? '#e53e3e' : color} />;
      })}
      <ValueCell value={ytdVal} bold={bold} color={ytdVal < 0 ? '#e53e3e' : color} />
      <ValueCell value={priorVal} bold={bold} color={priorVal < 0 ? '#e53e3e' : color} />
      {isGP && (
        <>
          <ValueCell value={ytdVal && sectionTotal('Income', null) ? (ytdVal / sectionTotal('Income', null)) * 100 : 0} bold={bold} color="#005A8E" isPercent />
          <ValueCell value={priorVal && sectionPrior('Income') ? (priorVal / sectionPrior('Income')) * 100 : 0} color="#888" isPercent />
        </>
      )}
    </tr>
  );

  const VarRow = ({ numerator, denominator, priorNum, priorDen }) => {
    const curr = denominator !== 0 ? (numerator / denominator) * 100 : 0;
    const prior = priorDen !== 0 ? (priorNum / priorDen) * 100 : 0;
    return (
      <tr style={{ background: '#f5f7fa' }}>
        <td style={{ padding: '2px 10px', fontSize: 10, color: '#888', fontStyle: 'italic' }}>% of Revenue</td>
        <td></td>
        {viewMode === 'monthly' && periods.map(p => {
          const rev = sectionTotal('Income', p.period_id);
          const num = numerator === 'gp'
            ? computeGP(p.period_id)
            : numerator === 'np'
            ? computeNP(p.period_id)
            : sectionTotal(numerator, p.period_id);
          const pct = rev !== 0 ? (num / rev) * 100 : 0;
          return (
            <td key={p.period_id} style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 10, padding: '2px 8px', color: pct < 0 ? '#e53e3e' : '#059669' }}>
              {rev !== 0 ? `${pct.toFixed(1)}%` : '—'}
            </td>
          );
        })}
        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 10, padding: '2px 8px', color: curr < 0 ? '#e53e3e' : '#059669' }}>
          {denominator !== 0 ? `${curr.toFixed(1)}%` : '—'}
        </td>
        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 10, padding: '2px 8px', color: '#888' }}>
          {priorDen !== 0 ? `${prior.toFixed(1)}%` : '—'}
        </td>
      </tr>
    );
  };

  return (
    <div>
      {/* Filter bar */}
      <div style={{ background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Period From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: 148 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Period To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width: 148 }} />
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', paddingBottom: 1 }}>
            <button className="btn btn-primary btn-sm" onClick={load} disabled={loading}>{loading ? 'Loading…' : '🔍 Generate'}</button>
            {data && <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>}
            {data && <button className="btn btn-sm" onClick={() => window.print()}>🖨 Print</button>}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', marginLeft: 'auto', paddingBottom: 1 }}>
            <button className={`btn btn-sm ${viewMode === 'monthly' ? 'btn-primary' : ''}`} style={{ fontSize: 11 }} onClick={() => setView('monthly')}>Monthly</button>
            <button className={`btn btn-sm ${viewMode === 'ytd' ? 'btn-primary' : ''}`} style={{ fontSize: 11 }} onClick={() => setView('ytd')}>YTD Only</button>
          </div>
        </div>
        {error && <div style={{ color: '#e53e3e', fontSize: 13, marginTop: 8 }}>⚠ {error}</div>}
      </div>

      {!data && !loading && (
        <div className="empty-state" style={{ padding: '40px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
          <div>Set the period dates and click <strong>Generate</strong> to build the Income Statement.</div>
        </div>
      )}

      {data && (
        <div style={{ overflowX: 'auto' }}>
          {/* Report header */}
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#005A8E' }}>Statement of Comprehensive Income</div>
            <div style={{ fontSize: 12, color: '#555' }}>Interland Distribution Cape (Pty) Ltd</div>
            <div style={{ fontSize: 11, color: '#888' }}>Period: {dateFrom} to {dateTo}</div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#005A8E', color: 'white' }}>
                <th style={{ textAlign: 'left', padding: '6px 10px', minWidth: 220 }}>Account</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', minWidth: 180 }}>Name</th>
                {viewMode === 'monthly' && periods.map(p => (
                  <th key={p.period_id} style={{ textAlign: 'right', padding: '6px 8px', minWidth: colW, whiteSpace: 'nowrap', fontSize: 11 }}>
                    {p.period_name}
                  </th>
                ))}
                <th style={{ textAlign: 'right', padding: '6px 8px', minWidth: colW, background: '#003d6b' }}>YTD</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', minWidth: colW, background: '#2d6a9f', fontSize: 10 }}>Prior Year</th>
              </tr>
            </thead>
            <tbody>
              {SECTIONS.map(section => {
                const sectionRows = getAccountsBySection(section.key).filter(r =>
                  r.ytd !== 0 || periods.some(p => r.period_data[p.period_id] !== 0)
                );
                const ytdTotal   = sectionTotal(section.key, null);
                const priorTotal = sectionPrior(section.key);

                return [
                  <SectionHeader key={`h_${section.key}`} label={section.label} bg={section.headerBg} />,
                  ...sectionRows.map((r, i) => (
                    <tr key={r.account_code} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                      <td style={{ padding: '3px 10px', paddingLeft: r.is_sub_account ? 24 : 10, fontFamily: 'monospace', fontSize: 11, color: '#666' }}>
                        {r.account_code}
                      </td>
                      <td style={{ padding: '3px 8px', fontSize: 11 }}>{r.account_name}</td>
                      {viewMode === 'monthly' && periods.map(p => (
                        <ValueCell key={p.period_id} value={r.period_data[p.period_id] || 0} />
                      ))}
                      <ValueCell value={r.ytd} color={r.ytd < 0 ? '#e53e3e' : undefined} />
                      <ValueCell value={r.prior_year} color="#888" />
                    </tr>
                  )),
                  <TotalRow
                    key={`t_${section.key}`}
                    label={`Total ${section.label}`}
                    getPeriodVal={(pid) => sectionTotal(section.key, pid)}
                    ytdVal={ytdTotal}
                    priorVal={priorTotal}
                    bold
                    color={section.color}
                  />,
                  // After Revenue: no GP line yet
                  // After Cost of Sales: show Gross Profit
                  ...(section.key === 'Cost of Sales' ? [
                    <tr key="gp_spacer" style={{ height: 4, background: '#f0f0f0' }}><td colSpan={100} /></tr>,
                    <tr key="gp_row" style={{ background: '#e8f4ff', fontWeight: 700, borderTop: '2px solid #005A8E', borderBottom: '2px solid #005A8E' }}>
                      <td style={{ padding: '6px 10px', fontSize: 13, fontWeight: 700, color: '#005A8E' }}>GROSS PROFIT</td>
                      <td></td>
                      {viewMode === 'monthly' && periods.map(p => {
                        const gp = computeGP(p.period_id);
                        return <ValueCell key={p.period_id} value={gp} bold color={gp < 0 ? '#e53e3e' : '#005A8E'} />;
                      })}
                      <ValueCell value={computeGP(null)} bold color={computeGP(null) < 0 ? '#e53e3e' : '#005A8E'} />
                      <ValueCell value={computeGP(null) !== 0 ? sectionPrior('Income') - sectionPrior('Cost of Sales') : 0} bold color="#2d6a9f" />
                    </tr>,
                    <tr key="gp_pct" style={{ background: '#f0f7ff' }}>
                      <td style={{ padding: '2px 10px', fontSize: 10, color: '#888', fontStyle: 'italic' }}>GP %</td>
                      <td></td>
                      {viewMode === 'monthly' && periods.map(p => {
                        const rev = sectionTotal('Income', p.period_id);
                        const gp  = computeGP(p.period_id);
                        const pct = rev !== 0 ? (gp / rev) * 100 : 0;
                        return (
                          <td key={p.period_id} style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 10, padding: '2px 8px', color: '#005A8E' }}>
                            {rev !== 0 ? `${pct.toFixed(1)}%` : '—'}
                          </td>
                        );
                      })}
                      {(() => {
                        const rev = sectionTotal('Income', null);
                        const gp  = computeGP(null);
                        const priorRev = sectionPrior('Income');
                        const priorGP  = sectionPrior('Income') - sectionPrior('Cost of Sales');
                        return <>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 10, padding: '2px 8px', color: '#005A8E', fontWeight: 700 }}>
                            {rev !== 0 ? `${((gp/rev)*100).toFixed(1)}%` : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 10, padding: '2px 8px', color: '#888' }}>
                            {priorRev !== 0 ? `${((priorGP/priorRev)*100).toFixed(1)}%` : '—'}
                          </td>
                        </>;
                      })()}
                    </tr>,
                    <tr key="gp_spacer2" style={{ height: 4, background: '#f0f0f0' }}><td colSpan={100} /></tr>,
                  ] : []),
                ];
              })}

              {/* Net Profit */}
              <tr style={{ height: 6, background: '#f0f0f0' }}><td colSpan={100} /></tr>
              <tr style={{ background: '#003d6b', color: 'white', fontWeight: 700 }}>
                <td style={{ padding: '8px 10px', fontSize: 14, fontWeight: 700 }}>NET PROFIT / (LOSS)</td>
                <td></td>
                {viewMode === 'monthly' && periods.map(p => {
                  const np = computeNP(p.period_id);
                  return (
                    <td key={p.period_id} style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, padding: '8px', fontWeight: 700, color: np < 0 ? '#fca5a5' : '#86efac', minWidth: colW }}>
                      {fmtN(np)}
                    </td>
                  );
                })}
                {(() => {
                  const np = computeNP(null);
                  const priorNP = (sectionPrior('Income') - sectionPrior('Cost of Sales') + sectionPrior('Other Income') - sectionPrior('Expenses'));
                  return <>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, padding: '8px', fontWeight: 700, color: np < 0 ? '#fca5a5' : '#86efac', minWidth: colW }}>
                      {fmtN(np)}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 11, padding: '8px', color: '#9ca3af', minWidth: colW }}>
                      {fmtN(priorNP)}
                    </td>
                  </>;
                })()}
              </tr>
              {/* NP % row */}
              {(() => {
                const rev = sectionTotal('Income', null);
                const np  = computeNP(null);
                const priorRev = sectionPrior('Income');
                const priorNP  = sectionPrior('Income') - sectionPrior('Cost of Sales') + sectionPrior('Other Income') - sectionPrior('Expenses');
                return (
                  <tr style={{ background: '#1a3a5c' }}>
                    <td style={{ padding: '2px 10px', fontSize: 10, color: '#94a3b8', fontStyle: 'italic' }}>NP %</td>
                    <td></td>
                    {viewMode === 'monthly' && periods.map(p => {
                      const pRev = sectionTotal('Income', p.period_id);
                      const pNP  = computeNP(p.period_id);
                      return (
                        <td key={p.period_id} style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 10, padding: '2px 8px', color: pNP < 0 ? '#fca5a5' : '#86efac' }}>
                          {pRev !== 0 ? `${((pNP/pRev)*100).toFixed(1)}%` : '—'}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 10, padding: '2px 8px', color: np < 0 ? '#fca5a5' : '#86efac', fontWeight: 700 }}>
                      {rev !== 0 ? `${((np/rev)*100).toFixed(1)}%` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 10, padding: '2px 8px', color: '#94a3b8' }}>
                      {priorRev !== 0 ? `${((priorNP/priorRev)*100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                );
              })()}
            </tbody>
          </table>

          <div style={{ fontSize: 10, color: '#aaa', marginTop: 8, textAlign: 'right' }}>
            Generated by LogisticsPro LP2.0 · {new Date().toLocaleDateString('en-ZA')} · Prior year: {data.prior_date_from} to {data.prior_date_to}
          </div>
        </div>
      )}
    </div>
  );
}


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

// ── MAIN FINANCE GL PAGE ──────────────────────────────────────
export default function FinanceGL() {
  const { user } = useAuth();
  const [tab, setTab] = useState('coa');

  const tabStyle = (t) => ({
    padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    borderBottom: tab === t ? '2px solid #005A8E' : '2px solid transparent',
    color: tab === t ? '#005A8E' : '#666', whiteSpace: 'nowrap',
  });

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid #e8edf2', marginBottom: 16, gap: 4, overflowX: 'auto' }}>
        <div style={tabStyle('coa')}      onClick={() => setTab('coa')}>Chart of Accounts</div>
        <div style={tabStyle('tb')}       onClick={() => setTab('tb')}>Trial Balance</div>
        <div style={tabStyle('ledger')}   onClick={() => setTab('ledger')}>Account Transactions</div>
        <div style={tabStyle('journals')} onClick={() => setTab('journals')}>GL Journals</div>
        <div style={tabStyle('is')}       onClick={() => setTab('is')}>Income Statement</div>
        <div style={tabStyle('cashbook')}  onClick={() => setTab('cashbook')}>Cash Book</div>
      </div>
      {tab === 'coa'      && <ChartOfAccounts />}
      {tab === 'tb'       && <TrialBalance />}
      {tab === 'ledger'   && <AccountTransactions />}
      {tab === 'journals' && <GLJournals user={user} />}
      {tab === 'is'       && <IncomeStatement />}
      {tab === 'cashbook'  && <Cashbook />}
    </div>
  );
}
