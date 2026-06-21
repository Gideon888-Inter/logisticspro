import { useState, useEffect } from 'react';

const API = `${import.meta.env.VITE_API_URL}/api`;
const token = () => localStorage.getItem('lp_token');
const req = (path) => fetch(API + path, { headers: { Authorization: 'Bearer ' + token() } }).then(r => r.json());
const fmt = (n) => n == null ? '—' : `R ${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const BUCKET_COLOR = { 'Current':'badge-green', '1-30 Days':'badge-amber', '31-60 Days':'badge-amber', '61-90 Days':'badge-red', '90+ Days':'badge-red' };

export default function FinanceAR() {
  const [tab, setTab]             = useState('aging');
  const [aging, setAging]         = useState(null);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [selected, setSelected]   = useState(null);

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

  const tabStyle = (t) => ({
    padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    borderBottom: tab === t ? '2px solid #005A8E' : '2px solid transparent',
    color: tab === t ? '#005A8E' : '#666',
  });

  const filteredCustomers = customers.filter(c =>
    !search || c.customer_code.toLowerCase().includes(search.toLowerCase()) ||
               c.customer_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div style={{ display:'flex', borderBottom:'1px solid #e8edf2', marginBottom:16, gap:4 }}>
        <div style={tabStyle('aging')}     onClick={()=>setTab('aging')}>Debtor Aging</div>
        <div style={tabStyle('customers')} onClick={()=>setTab('customers')}>Customer Master ({customers.length || 290})</div>
      </div>

      {/* AGING TAB */}
      {tab === 'aging' && (
        <>
          {aging && (
            <div className="stats-grid">
              <div className="stat-card"><div className="stat-label">Total Outstanding</div><div className="stat-value" style={{color:'#005A8E',fontSize:15}}>{fmt(aging.total)}</div></div>
              {Object.entries(aging.summary || {}).map(([k,v]) => (
                <div className="stat-card" key={k}>
                  <div className="stat-label">{k}</div>
                  <div className="stat-value" style={{fontSize:14,color: v > 0 && k !== 'Current' ? '#e53e3e' : '#059669'}}>{fmt(v)}</div>
                </div>
              ))}
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Invoice Ref</th><th>Invoice Date</th><th>Due Date</th><th style={{textAlign:'right'}}>Amount</th><th style={{textAlign:'right'}}>Balance</th><th>Bucket</th><th>Load #</th></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={8}><div className="loading">Loading debtor aging…</div></td></tr>}
                {!loading && (!aging?.invoices?.length) && <tr><td colSpan={8}><div className="empty-state">No outstanding invoices</div></td></tr>}
                {!loading && aging?.invoices?.map(i => (
                  <tr key={i.invoice_id}>
                    <td style={{fontWeight:600}}>{i.customer_name}</td>
                    <td className="mono">{i.invoice_ref}</td>
                    <td style={{fontSize:12}}>{i.invoice_date}</td>
                    <td style={{fontSize:12}}>{i.due_date}</td>
                    <td style={{textAlign:'right',fontFamily:'monospace'}}>{fmt(i.total_incl_vat)}</td>
                    <td style={{textAlign:'right',fontFamily:'monospace',fontWeight:600,color:'#e53e3e'}}>{fmt(i.balance_due)}</td>
                    <td><span className={`badge ${BUCKET_COLOR[i.aging_bucket]||'badge-gray'}`} style={{fontSize:10}}>{i.aging_bucket}</span></td>
                    <td className="mono" style={{fontSize:12}}>{i.lp_load_number||'—'}</td>
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
            <input placeholder="Search customer code or name…" value={search} onChange={e=>setSearch(e.target.value)} />
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Customer Name</th><th>VAT Number</th><th>Telephone</th><th>Email</th><th>Terms</th><th>LP Code</th><th>Status</th></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={8}><div className="loading">Loading customers…</div></td></tr>}
                {!loading && filteredCustomers.length === 0 && <tr><td colSpan={8}><div className="empty-state">No customers found</div></td></tr>}
                {!loading && filteredCustomers.map(c => (
                  <tr key={c.customer_id} onClick={()=>setSelected(c)}>
                    <td className="mono" style={{fontWeight:600}}>{c.customer_code}</td>
                    <td>{c.customer_name}</td>
                    <td className="mono" style={{fontSize:12}}>{c.vat_number||'—'}</td>
                    <td style={{fontSize:12}}>{c.telephone||'—'}</td>
                    <td style={{fontSize:11,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.email||'—'}</td>
                    <td style={{fontSize:12}}>{c.payment_terms_days} days</td>
                    <td className="mono" style={{fontSize:12,color:'#00AEEF'}}>{c.lp_client_code||'—'}</td>
                    <td>
                      {c.on_hold
                        ? <span className="badge badge-red" style={{fontSize:10}}>On Hold</span>
                        : <span className="badge badge-green" style={{fontSize:10}}>Active</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Customer Detail */}
      {selected && (
        <div className="modal-overlay" onClick={()=>setSelected(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selected.customer_code} — {selected.customer_name}</h3>
              <button onClick={()=>setSelected(null)} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label>VAT Number</label><div className="mono">{selected.vat_number||'—'}</div></div>
                <div className="form-group"><label>Category</label><div>{selected.category||'—'}</div></div>
                <div className="form-group"><label>Payment Terms</label><div>{selected.payment_terms_days} days</div></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Telephone</label><div>{selected.telephone||'—'}</div></div>
                <div className="form-group"><label>Email</label><div style={{fontSize:12,wordBreak:'break-all'}}>{selected.email||'—'}</div></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>GL Control Account</label><div className="mono">{selected.gl_control_account}</div></div>
                <div className="form-group"><label>LP Client Code</label><div className="mono" style={{color:'#00AEEF'}}>{selected.lp_client_code||'Not linked'}</div></div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={()=>setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
