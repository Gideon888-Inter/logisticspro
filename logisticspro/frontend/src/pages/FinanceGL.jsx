import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';

const API = `${import.meta.env.VITE_API_URL}/api`;
const token = () => localStorage.getItem('lp_token');
const req = (path, opts = {}) =>
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

  const doExportCSV = () => exportCSV(filtered.map(a => ({
    Code: a.account_code, Name: a.account_name, Category: a.category, Type: a.account_type,
    'VAT Treatment': a.vat_treatment, 'VAT Codes': a.allowed_vat_codes || '', Active: a.active ? 'YES' : 'NO',
  })), 'gl_accounts.csv');

  const cats = [...new Set(accounts.map(a => a.category))].sort();
  const filtered = accounts.filter(a =>
    (!catFilter || a.category === catFilter) &&
    (!search || a.account_code.toLowerCase().includes(search.toLowerCase()) ||
                a.account_name.toLowerCase().includes(search.toLowerCase()))
  );

  const VAT_BADGE = { OUTPUT:'badge-green', INPUT:'badge-blue', CAPITAL:'badge-amber', BOTH:'badge-purple', NONE:'badge-gray' };

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Total Accounts</div><div className="stat-value">{accounts.length}</div></div>
        <div className="stat-card"><div className="stat-label">Active</div><div className="stat-value" style={{color:'#00AEEF'}}>{accounts.filter(a=>a.active).length}</div></div>
        <div className="stat-card"><div className="stat-label">Sub-Accounts</div><div className="stat-value">{accounts.filter(a=>a.is_sub_account).length}</div></div>
        <div className="stat-card"><div className="stat-label">Categories</div><div className="stat-value">{cats.length}</div></div>
      </div>
      <div className="filter-bar">
        <input placeholder="Search code or name…" value={search} onChange={e=>setSearch(e.target.value)} />
        <select value={catFilter} onChange={e=>setCat(e.target.value)}>
          <option value="">All Categories</option>
          {cats.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <button className="btn btn-primary btn-sm" onClick={() => { setForm(EMPTY_ACCOUNT); setShowAdd(true); }}>+ New Account</button>
      </div>
      <div style={{ display:'flex', gap:6, marginBottom:10, justifyContent:'flex-end' }}>
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
                <td><span className={`badge ${VAT_BADGE[a.vat_treatment] || 'badge-gray'}`} style={{fontSize:10}}>{a.vat_treatment}</span></td>
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
              <button onClick={() => setShowAdd(false)} style={{ background:'none',border:'none',color:'white',cursor:'pointer',fontSize:18 }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label>Account Code *</label><input value={form.account_code} onChange={e=>set('account_code',e.target.value.toUpperCase())} placeholder="e.g. 6100" /></div>
                <div className="form-group"><label>Account Name *</label><input value={form.account_name} onChange={e=>set('account_name',e.target.value)} placeholder="Full account name" /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Category</label>
                  <select value={form.category} onChange={e=>set('category',e.target.value)}>
                    {['ASSETS','LIABILITIES','EQUITY','INCOME','EXPENSES','COST_OF_SALES'].map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>Account Type</label>
                  <select value={form.account_type} onChange={e=>set('account_type',e.target.value)}>
                    <option value="DETAIL">DETAIL</option>
                    <option value="CONTROL">CONTROL</option>
                    <option value="HEADER">HEADER</option>
                  </select>
                </div>
                <div className="form-group"><label>VAT Treatment</label>
                  <select value={form.vat_treatment} onChange={e=>set('vat_treatment',e.target.value)}>
                    {['NONE','INPUT','OUTPUT','CAPITAL','BOTH'].map(v=><option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Allowed VAT Codes</label><input value={form.allowed_vat_codes} onChange={e=>set('allowed_vat_codes',e.target.value)} placeholder="e.g. S1,Z1" /></div>
                <div className="form-group"><label>Parent Account</label><input value={form.parent_account} onChange={e=>set('parent_account',e.target.value)} placeholder="e.g. 6000" /></div>
                <div className="form-group"><label>Sub-Account?</label>
                  <select value={form.is_sub_account?'true':'false'} onChange={e=>set('is_sub_account',e.target.value==='true')}>
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

  const groups = [...new Set(data.accounts.map(a => a.ifrs_classification))].sort();
  const filtered = data.accounts.filter(a =>
    (!groupFilter || a.ifrs_classification === groupFilter) &&
    (Math.abs(a.balance) > 0.001)
  );

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Total Debit</div><div className="stat-value" style={{color:'#00AEEF',fontSize:16}}>{fmt(data.totals.total_debit)}</div></div>
        <div className="stat-card"><div className="stat-label">Total Credit</div><div className="stat-value" style={{color:'#005A8E',fontSize:16}}>{fmt(data.totals.total_credit)}</div></div>
        <div className="stat-card"><div className="stat-label">Balanced</div><div className="stat-value" style={{color: data.totals.balanced ? '#059669' : '#e53e3e'}}>{data.totals.balanced ? '✓ Yes' : '✗ No'}</div></div>
      </div>
      <div className="filter-bar">
        <select value={groupFilter} onChange={e=>setGF(e.target.value)}>
          <option value="">All Sections</option>
          {groups.map(g=><option key={g} value={g}>{g}</option>)}
        </select>
        <button className="btn btn-sm" onClick={()=>exportCSV(filtered.map(a=>({Code:a.account_code,Name:a.account_name,Classification:a.ifrs_classification,Debit:a.total_debit,Credit:a.total_credit,Balance:a.balance})),'trial_balance.csv')}>⬇ CSV</button>
        <button className="btn btn-sm" onClick={()=>window.print()}>🖨 Print</button>
        <span style={{fontSize:12,color:'#888',marginLeft:'auto'}}>Showing accounts with non-zero balances</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Account Name</th><th>Classification</th><th style={{textAlign:'right'}}>Debit</th><th style={{textAlign:'right'}}>Credit</th><th style={{textAlign:'right'}}>Balance</th></tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={6}><div className="empty-state">No posted journals yet</div></td></tr>}
            {filtered.map(a => (
              <tr key={a.account_code}>
                <td className="mono" style={{fontWeight:600}}>{a.account_code}</td>
                <td>{a.account_name}</td>
                <td style={{fontSize:12,color:'#666'}}>{a.ifrs_classification}</td>
                <td style={{textAlign:'right',fontFamily:'monospace'}}>{a.total_debit > 0 ? fmt(a.total_debit) : '—'}</td>
                <td style={{textAlign:'right',fontFamily:'monospace'}}>{a.total_credit > 0 ? fmt(a.total_credit) : '—'}</td>
                <td style={{textAlign:'right',fontFamily:'monospace',fontWeight:600,color: a.balance >= 0 ? '#005A8E' : '#e53e3e'}}>{fmt(Math.abs(a.balance))}</td>
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
  const [form, setForm]           = useState({ journal_type:'GL', description:'', period_id:'', journal_date: new Date().toISOString().slice(0,10), lines:[] });
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
    ...f, lines: [...f.lines, { account_code:'', description:'', debit:'', credit:'', vat_type:'', vat_amount:'0' }]
  }));

  const setLine = (i, k, v) => setForm(f => {
    const lines = [...f.lines];
    lines[i] = { ...lines[i], [k]: v };
    // Auto-calc VAT
    if (k === 'debit' || k === 'credit') {
      const amt = parseFloat(v) || 0;
      if (lines[i].vat_type && lines[i].vat_type !== 'NONE') {
        lines[i].vat_amount = (amt * 15 / 115).toFixed(2);
      }
    }
    return { ...f, lines };
  });

  const totalDR = form.lines.reduce((s,l) => s + (parseFloat(l.debit)  || 0), 0);
  const totalCR = form.lines.reduce((s,l) => s + (parseFloat(l.credit) || 0), 0);
  const balanced = Math.abs(totalDR - totalCR) < 0.01;

  const save = async () => {
    setSaveErr('');
    if (!form.description.trim()) return setSaveErr('Description is required');
    if (!form.period_id)          return setSaveErr('Period is required');
    if (form.lines.length < 2)    return setSaveErr('At least 2 lines required');
    if (!balanced)                return setSaveErr(`Not balanced — DR: ${totalDR.toFixed(2)}, CR: ${totalCR.toFixed(2)}`);
    setSaving(true);
    const result = await req('/fin/journals', { method:'POST', body: JSON.stringify(form) });
    setSaving(false);
    if (result.error) return setSaveErr(result.error);
    setShowNew(false);
    setForm({ journal_type:'GL', description:'', period_id:'', journal_date: new Date().toISOString().slice(0,10), lines:[] });
    load();
  };

  return (
    <div>
      <div className="filter-bar">
        <span style={{fontWeight:600,fontSize:14}}>{journals.length} journals</span>
        {isAdmin && <button className="btn btn-primary btn-sm" onClick={()=>setShowNew(true)}>+ New Journal</button>}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Ref</th><th>Date</th><th>Type</th><th>Description</th><th style={{textAlign:'right'}}>Amount</th><th style={{textAlign:'center'}}>Posted</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6}><div className="loading">Loading journals…</div></td></tr>}
            {!loading && journals.length === 0 && <tr><td colSpan={6}><div className="empty-state">No journals posted yet</div></td></tr>}
            {!loading && journals.map(j => (
              <tr key={j.journal_id} onClick={()=>openDetail(j)}>
                <td className="mono" style={{fontWeight:600}}>{j.journal_ref}</td>
                <td>{j.journal_date}</td>
                <td><span className="badge badge-blue" style={{fontSize:10}}>{j.journal_type}</span></td>
                <td>{j.description}</td>
                <td style={{textAlign:'right',fontFamily:'monospace'}}>—</td>
                <td style={{textAlign:'center'}}><span className={`badge ${j.posted ? 'badge-green' : 'badge-amber'}`} style={{fontSize:10}}>{j.posted ? 'Posted' : 'Draft'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Journal Detail */}
      {selected && (
        <div className="modal-overlay" onClick={()=>{setSelected(null);setDetail(null);}}>
          <div className="modal" style={{maxWidth:680}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selected.journal_ref}</h3>
              <button onClick={()=>{setSelected(null);setDetail(null);}} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            <div className="modal-body">
              {!detail && <div className="loading">Loading…</div>}
              {detail && (
                <>
                  <div className="form-row">
                    <div className="form-group"><label>Date</label><div>{detail.journal_date}</div></div>
                    <div className="form-group"><label>Type</label><span className="badge badge-blue">{detail.journal_type}</span></div>
                    <div className="form-group"><label>Status</label><span className={`badge ${detail.posted ? 'badge-green':'badge-amber'}`}>{detail.posted?'Posted':'Draft'}</span></div>
                  </div>
                  <div className="form-group"><label>Description</label><div>{detail.description}</div></div>
                  <div style={{marginTop:12}}>
                    <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                      <thead><tr style={{background:'#005A8E',color:'white'}}>
                        <th style={{padding:'6px 8px',textAlign:'left'}}>Account</th>
                        <th style={{padding:'6px 8px',textAlign:'left'}}>Description</th>
                        <th style={{padding:'6px 8px',textAlign:'right'}}>Debit</th>
                        <th style={{padding:'6px 8px',textAlign:'right'}}>Credit</th>
                      </tr></thead>
                      <tbody>
                        {(detail.lines||[]).map(l=>(
                          <tr key={l.line_id} style={{borderBottom:'1px solid #f0f0f0'}}>
                            <td className="mono" style={{padding:'5px 8px',fontWeight:600}}>{l.account_code}</td>
                            <td style={{padding:'5px 8px'}}>{l.description}</td>
                            <td style={{padding:'5px 8px',textAlign:'right',fontFamily:'monospace'}}>{l.debit > 0 ? fmt(l.debit) : ''}</td>
                            <td style={{padding:'5px 8px',textAlign:'right',fontFamily:'monospace'}}>{l.credit > 0 ? fmt(l.credit) : ''}</td>
                          </tr>
                        ))}
                        <tr style={{fontWeight:700,background:'#f5f7fa'}}>
                          <td colSpan={2} style={{padding:'6px 8px'}}>Totals</td>
                          <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'monospace'}}>{fmt(detail.total_debit)}</td>
                          <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'monospace'}}>{fmt(detail.total_credit)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div style={{marginTop:8,fontSize:12,color: detail.balanced ? '#059669' : '#e53e3e'}}>
                    {detail.balanced ? '✓ Balanced' : '✗ NOT BALANCED'}
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={()=>{setSelected(null);setDetail(null);}}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* New Journal Modal */}
      {showNew && (
        <div className="modal-overlay" onClick={()=>setShowNew(false)}>
          <div className="modal" style={{maxWidth:720}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>New GL Journal</h3>
              <button onClick={()=>setShowNew(false)} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            <div className="modal-body">
              {saveErr && <div style={{background:'#fff5f5',border:'1px solid #fca5a5',borderRadius:4,padding:'8px 12px',marginBottom:12,color:'#e53e3e',fontSize:13}}>⚠ {saveErr}</div>}
              <div className="form-row">
                <div className="form-group"><label>Journal Type</label>
                  <select value={form.journal_type} onChange={e=>setForm(f=>({...f,journal_type:e.target.value}))}>
                    {['GL','AP_INV','AR_INV','FA_PUR','FA_DISP','YE'].map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>Period *</label>
                  <select value={form.period_id} onChange={e=>setForm(f=>({...f,period_id:e.target.value}))}>
                    <option value="">— Select period —</option>
                    {periods.map(p=><option key={p.period_id} value={p.period_id}>{p.period_name}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>Journal Date *</label>
                  <input type="date" value={form.journal_date} onChange={e=>setForm(f=>({...f,journal_date:e.target.value}))} />
                </div>
              </div>
              <div className="form-group"><label>Description *</label>
                <input value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="e.g. Feb 2026 depreciation journal" />
              </div>

              {/* Lines */}
              <div style={{marginTop:12}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <label style={{fontWeight:600}}>Journal Lines</label>
                  <button className="btn btn-sm" onClick={addLine}>+ Add Line</button>
                </div>
                <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                  <thead><tr style={{background:'#005A8E',color:'white'}}>
                    <th style={{padding:'6px 8px',textAlign:'left'}}>Account</th>
                    <th style={{padding:'6px 8px',textAlign:'left'}}>Description</th>
                    <th style={{padding:'6px 8px',textAlign:'right'}}>Debit</th>
                    <th style={{padding:'6px 8px',textAlign:'right'}}>Credit</th>
                    <th style={{width:24}}></th>
                  </tr></thead>
                  <tbody>
                    {form.lines.map((l,i)=>(
                      <tr key={i} style={{borderBottom:'1px solid #f0f0f0'}}>
                        <td style={{padding:'4px 6px'}}>
                          <select value={l.account_code} onChange={e=>setLine(i,'account_code',e.target.value)} style={{width:'100%',fontSize:11}}>
                            <option value="">— Account —</option>
                            {accounts.map(a=><option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name}</option>)}
                          </select>
                        </td>
                        <td style={{padding:'4px 6px'}}><input value={l.description} onChange={e=>setLine(i,'description',e.target.value)} style={{width:'100%',fontSize:11}} placeholder="Line description" /></td>
                        <td style={{padding:'4px 6px'}}><input type="number" value={l.debit} onChange={e=>setLine(i,'debit',e.target.value)} style={{width:90,textAlign:'right',fontSize:11}} placeholder="0.00" /></td>
                        <td style={{padding:'4px 6px'}}><input type="number" value={l.credit} onChange={e=>setLine(i,'credit',e.target.value)} style={{width:90,textAlign:'right',fontSize:11}} placeholder="0.00" /></td>
                        <td style={{padding:'4px'}}><button onClick={()=>setForm(f=>({...f,lines:f.lines.filter((_,j)=>j!==i)}))} style={{background:'none',border:'none',color:'#e53e3e',cursor:'pointer',fontSize:14}}>✕</button></td>
                      </tr>
                    ))}
                    {form.lines.length > 0 && (
                      <tr style={{fontWeight:700,background:'#f5f7fa'}}>
                        <td colSpan={2} style={{padding:'6px 8px',color: balanced?'#059669':'#e53e3e'}}>{balanced ? '✓ Balanced' : '✗ Out of balance'}</td>
                        <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'monospace'}}>{fmt(totalDR)}</td>
                        <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'monospace'}}>{fmt(totalCR)}</td>
                        <td></td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {form.lines.length === 0 && <div style={{padding:16,textAlign:'center',color:'#aaa',fontSize:13}}>Click "+ Add Line" to add journal lines</div>}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setShowNew(false)}>Cancel</button>
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
      <div style={{ display:'flex', borderBottom:'1px solid #e8edf2', marginBottom:16, gap:4, overflowX:'auto' }}>
        <div style={tabStyle('coa')}     onClick={()=>setTab('coa')}>Chart of Accounts</div>
        <div style={tabStyle('tb')}      onClick={()=>setTab('tb')}>Trial Balance</div>
        <div style={tabStyle('journals')}onClick={()=>setTab('journals')}>GL Journals</div>
      </div>
      {tab === 'coa'      && <ChartOfAccounts />}
      {tab === 'tb'       && <TrialBalance />}
      {tab === 'journals' && <GLJournals user={user} />}
    </div>
  );
}

