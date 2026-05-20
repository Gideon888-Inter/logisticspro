import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';

const API = import.meta.env.VITE_API_URL || '';
const token = () => localStorage.getItem('lp_token');
const req = (path, opts={}) => fetch(API+'/api'+path, {
  ...opts,
  headers: {'Content-Type':'application/json','Authorization':'Bearer '+token(),...(opts.headers||{})}
}).then(r=>r.json());

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-ZA',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'; }

export default function Approvals({ onNavigateToLoad }) {
  const { user } = useAuth();
  const [anomalies, setAnomalies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('PENDING');

  const load = async () => {
    setLoading(true);
    try {
      const data = await req(`/km/anomalies${filter ? '?status='+filter : ''}`);
      setAnomalies(Array.isArray(data) ? data : []);
    } catch(e){ console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [filter]);

  const approve = async (id) => {
    setSaving(true);
    try {
      await req(`/km/anomalies/${id}`, { method:'PATCH', body: JSON.stringify({ action:'approve' }) });
      setSelected(null);
      load();
    } catch(e){ alert(e.message); }
    finally { setSaving(false); }
  };

  const reject = async (id) => {
    if (!rejectionReason.trim()) return alert('Please enter a rejection reason');
    setSaving(true);
    try {
      await req(`/km/anomalies/${id}`, { method:'PATCH', body: JSON.stringify({ action:'reject', rejection_reason: rejectionReason }) });
      setSelected(null);
      setRejectionReason('');
      load();
    } catch(e){ alert(e.message); }
    finally { setSaving(false); }
  };

  const STATUS_COLORS = { PENDING:'badge-amber', APPROVED:'badge-green', REJECTED:'badge-red' };

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Pending</div><div className="stat-value" style={{color:'#d97706'}}>{anomalies.filter(a=>a.a_status==='PENDING').length}</div></div>
        <div className="stat-card"><div className="stat-label">Approved today</div><div className="stat-value" style={{color:'#059669'}}>{anomalies.filter(a=>a.a_status==='APPROVED').length}</div></div>
        <div className="stat-card"><div className="stat-label">Rejected</div><div className="stat-value" style={{color:'#e53e3e'}}>{anomalies.filter(a=>a.a_status==='REJECTED').length}</div></div>
      </div>

      <div className="filter-bar">
        <select value={filter} onChange={e=>setFilter(e.target.value)}>
          <option value="">All</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>Load No</th><th>Truck</th><th>Type</th><th>Description</th>
            <th>Last Closing KM</th><th>New Opening KM</th><th>Dead KM</th>
            <th>Operator</th><th>Date</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={11}><div className="loading">Loading…</div></td></tr>}
            {!loading && anomalies.length === 0 && <tr><td colSpan={11}><div className="empty-state">No approvals found</div></td></tr>}
            {!loading && anomalies.map(a => (
              <>
                <tr key={a.id} style={{background: selected?.id===a.id ? '#fef3c7' : undefined}}>
                  <td className="mono" style={{fontWeight:600}}>
                    <button onClick={()=>onNavigateToLoad && onNavigateToLoad(a.a_load_no)}
                      style={{background:'none',border:'none',color:'#00AEEF',cursor:'pointer',fontFamily:'monospace',fontWeight:600,fontSize:13,padding:0}}>
                      {a.a_load_no} ↗
                    </button>
                  </td>
                  <td className="mono">{a.a_truck}</td>
                  <td>{a.a_type}</td>
                  <td>{a.a_description}</td>
                  <td className="mono">{Number(a.a_last_closing).toLocaleString()} km</td>
                  <td className="mono">{Number(a.a_new_opening).toLocaleString()} km</td>
                  <td className="mono" style={{color:'#e53e3e',fontWeight:600}}>{Number(a.a_dead_km).toLocaleString()} km</td>
                  <td>{a.a_operator}</td>
                  <td>{fmtDate(a.created_at)}</td>
                  <td><span className={`badge ${STATUS_COLORS[a.a_status]||'badge-gray'}`}>{a.a_status}</span></td>
                  <td>
                    {a.a_status === 'PENDING' && (
                      <button className="btn btn-sm" onClick={()=>setSelected(selected?.id===a.id?null:a)}>
                        {selected?.id===a.id ? 'Cancel' : 'Review'}
                      </button>
                    )}
                  </td>
                </tr>
                {selected?.id === a.id && (
                  <tr key={'review-'+a.id}>
                    <td colSpan={11} style={{background:'#fef9e7',padding:'16px 20px',borderBottom:'2px solid #f59e0b'}}>
                      <div style={{marginBottom:12}}>
                        <strong>Reviewing anomaly for load {a.a_load_no}</strong>
                        <div style={{fontSize:13,color:'#555',marginTop:4}}>{a.a_description}</div>
                        {a.a_rejection_reason && <div style={{fontSize:12,color:'#e53e3e',marginTop:4}}>Previous rejection: {a.a_rejection_reason}</div>}
                      </div>
                      <div style={{display:'flex',gap:12,alignItems:'flex-end',flexWrap:'wrap'}}>
                        <div style={{flex:1,minWidth:250}}>
                          <div style={{fontSize:11,color:'#555',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.06em'}}>Rejection reason (required to reject)</div>
                          <input value={rejectionReason} onChange={e=>setRejectionReason(e.target.value)}
                            placeholder="Enter reason for rejection…"
                            style={{width:'100%',padding:'8px 10px',fontSize:13,border:'1px solid #ddd',borderRadius:4,fontFamily:'inherit'}} />
                        </div>
                        <button className="btn btn-primary" onClick={()=>approve(a.id)} disabled={saving}
                          style={{background:'#059669',borderColor:'#059669'}}>
                          ✓ Approve
                        </button>
                        <button className="btn" onClick={()=>reject(a.id)} disabled={saving}
                          style={{color:'#e53e3e',borderColor:'#fca5a5'}}>
                          ✕ Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
