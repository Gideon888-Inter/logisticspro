import { useState, useEffect } from 'react';

const API = `${import.meta.env.VITE_API_URL}/api`;
const token = () => localStorage.getItem('lp_token');
const req = (path) => fetch(API + path, {
  headers: { Authorization: 'Bearer ' + token() }
}).then(r => r.json());

const fmt = (n) => n == null ? '—' : `R ${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (n) => n == null ? '—' : `${Number(n).toFixed(2)}%`;

export default function FinanceAssets() {
  const [assets, setAssets]       = useState([]);
  const [classes, setClasses]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(null);
  const [classFilter, setClass]   = useState('');
  const [search, setSearch]       = useState('');

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const [aRes, cRes] = await Promise.all([req('/fin/assets'), req('/fin/assets/classes')]);
    setAssets(Array.isArray(aRes) ? aRes : []);
    setClasses(Array.isArray(cRes) ? cRes : []);
    setLoading(false);
  };

  const filtered = assets.filter(a =>
    (!classFilter || a.class_code === classFilter) &&
    (!search || a.asset_code.toLowerCase().includes(search.toLowerCase()) ||
                a.description.toLowerCase().includes(search.toLowerCase()))
  );

  const totalNBV     = assets.filter(a=>a.is_active).reduce((s,a) => s + (a.book_nbv || 0), 0);
  const totalTaxVal  = assets.filter(a=>a.is_active).reduce((s,a) => s + (a.tax_value || 0), 0);
  const totalCost    = assets.filter(a=>a.is_active).reduce((s,a) => s + (a.purchase_price || 0), 0);
  const totalDeferredTax = assets.filter(a=>a.is_active).reduce((s,a) => s + (a.deferred_tax_27pct || 0), 0);

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Active Assets</div><div className="stat-value" style={{color:'#00AEEF'}}>{assets.filter(a=>a.is_active).length}</div></div>
        <div className="stat-card"><div className="stat-label">Total Cost</div><div className="stat-value" style={{fontSize:15}}>{fmt(totalCost)}</div></div>
        <div className="stat-card"><div className="stat-label">Book NBV (IFRS)</div><div className="stat-value" style={{fontSize:15,color:'#005A8E'}}>{fmt(totalNBV)}</div></div>
        <div className="stat-card"><div className="stat-label">Tax Value (SARS)</div><div className="stat-value" style={{fontSize:15}}>{fmt(totalTaxVal)}</div></div>
        <div className="stat-card"><div className="stat-label">Deferred Tax @27%</div><div className="stat-value" style={{fontSize:14,color:'#d97706'}}>{fmt(totalDeferredTax)}</div></div>
      </div>

      <div className="filter-bar">
        <input placeholder="Search asset code or description…" value={search} onChange={e=>setSearch(e.target.value)} />
        <select value={classFilter} onChange={e=>setClass(e.target.value)}>
          <option value="">All Classes</option>
          {classes.map(c=><option key={c.class_code} value={c.class_code}>{c.class_code} — {c.class_name}</option>)}
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th><th>Description</th><th>Class</th><th>Location</th>
              <th style={{textAlign:'right'}}>Cost</th>
              <th style={{textAlign:'right'}}>Book NBV</th>
              <th style={{textAlign:'right'}}>Tax Value</th>
              <th style={{textAlign:'right'}}>Timing Diff</th>
              <th>Depre Start</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10}><div className="loading">Loading fixed assets…</div></td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={10}><div className="empty-state">No assets found — import asset register to populate</div></td></tr>}
            {!loading && filtered.map(a => (
              <tr key={a.asset_code} onClick={()=>setSelected(a)} style={{opacity: a.is_active ? 1 : 0.5}}>
                <td className="mono" style={{fontWeight:600}}>{a.asset_code}</td>
                <td>{a.description}</td>
                <td><span className="badge badge-purple" style={{fontSize:10}}>{a.class_code}</span></td>
                <td style={{fontSize:12}}>{a.location || '—'}</td>
                <td style={{textAlign:'right',fontFamily:'monospace',fontSize:12}}>{fmt(a.purchase_price)}</td>
                <td style={{textAlign:'right',fontFamily:'monospace',fontWeight:600,color:'#005A8E'}}>{fmt(a.book_nbv)}</td>
                <td style={{textAlign:'right',fontFamily:'monospace'}}>{fmt(a.tax_value)}</td>
                <td style={{textAlign:'right',fontFamily:'monospace',color: (a.timing_difference||0) > 0 ? '#d97706':'#059669'}}>{fmt(a.timing_difference)}</td>
                <td style={{fontSize:12}}>{a.depre_start_date || '—'}</td>
                <td>
                  {a.fully_depreciated
                    ? <span className="badge badge-gray" style={{fontSize:10}}>Fully Depr.</span>
                    : a.is_active
                      ? <span className="badge badge-green" style={{fontSize:10}}>Active</span>
                      : <span className="badge badge-red" style={{fontSize:10}}>Disposed</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Asset Detail Modal */}
      {selected && (
        <div className="modal-overlay" onClick={()=>setSelected(null)}>
          <div className="modal" style={{maxWidth:580}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selected.asset_code} — {selected.description}</h3>
              <button onClick={()=>setSelected(null)} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label>Class</label><div><span className="badge badge-purple">{selected.class_code}</span> {selected.class_name}</div></div>
                <div className="form-group"><label>Location</label><div>{selected.location || '—'}</div></div>
                <div className="form-group"><label>Reg Number</label><div className="mono">{selected.reg_number || '—'}</div></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Purchase Price</label><div style={{fontWeight:600}}>{fmt(selected.purchase_price)}</div></div>
                <div className="form-group"><label>SARS W&T Rate</label><div>{fmtPct(selected.sars_wt_rate_pct)}</div></div>
                <div className="form-group"><label>IFRS Life</label><div>{selected.ifrs_useful_life_yr} years</div></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Depre Start</label><div>{selected.depre_start_date || 'Not set'}</div></div>
              </div>
              <div style={{background:'#f5f7fa',borderRadius:6,padding:12,marginTop:8}}>
                <div style={{fontWeight:700,marginBottom:8,fontSize:12,color:'#888',textTransform:'uppercase',letterSpacing:1}}>Depreciation Summary</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,fontSize:13}}>
                  <div><label style={{fontSize:11,color:'#888'}}>Book NBV (IFRS)</label><div style={{fontWeight:700,color:'#005A8E',fontSize:16}}>{fmt(selected.book_nbv)}</div></div>
                  <div><label style={{fontSize:11,color:'#888'}}>Tax Value (SARS)</label><div style={{fontWeight:700,fontSize:16}}>{fmt(selected.tax_value)}</div></div>
                  <div><label style={{fontSize:11,color:'#888'}}>Timing Difference</label><div style={{fontWeight:600,color:'#d97706'}}>{fmt(selected.timing_difference)}</div></div>
                  <div><label style={{fontSize:11,color:'#888'}}>Deferred Tax @27%</label><div style={{fontWeight:600,color:'#d97706'}}>{fmt(selected.deferred_tax_27pct)}</div></div>
                </div>
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
