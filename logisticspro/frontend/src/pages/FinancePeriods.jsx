import { useState, useEffect } from 'react';

const API = `${import.meta.env.VITE_API_URL}/api`;
const token = () => localStorage.getItem('lp_token');
const req = (path, opts={}) => fetch(API + path, {
  ...opts,
  headers: { 'Content-Type':'application/json', Authorization: 'Bearer ' + token(), ...(opts.headers||{}) }
}).then(r => r.json());

export default function FinancePeriods({ user }) {
  const isAdmin = user?.role === 'ADMIN';
  const [periods, setPeriods]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [locking, setLocking]   = useState(null);
  const [unlocking, setUnlocking] = useState(null);
  const [unlockReason, setReason] = useState('');
  const [showUnlock, setShowUnlock] = useState(null);

  useEffect(() => { load(); }, []);
  const load = async () => {
    setLoading(true);
    const data = await req('/fin/periods/status');
    setPeriods(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  const lock = async (p) => {
    if (!confirm(`Lock ${p.period_name}? No further journals can be posted until unlocked.`)) return;
    setLocking(p.period_id);
    await req(`/fin/periods/${p.period_id}/lock`, { method:'PATCH', body: JSON.stringify({ reason:'Manual lock' }) });
    setLocking(null);
    load();
  };

  const unlock = async () => {
    if (!unlockReason.trim()) return alert('Unlock reason is required');
    setUnlocking(showUnlock.period_id);
    await req(`/fin/periods/${showUnlock.period_id}/unlock`, { method:'PATCH', body: JSON.stringify({ reason: unlockReason }) });
    setUnlocking(null);
    setShowUnlock(null);
    setReason('');
    load();
  };

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">FY2026 Periods</div><div className="stat-value">{periods.length}</div></div>
        <div className="stat-card"><div className="stat-label">Open</div><div className="stat-value" style={{color:'#059669'}}>{periods.filter(p=>!p.is_closed).length}</div></div>
        <div className="stat-card"><div className="stat-label">Locked</div><div className="stat-value" style={{color:'#e53e3e'}}>{periods.filter(p=>p.is_closed).length}</div></div>
        <div className="stat-card"><div className="stat-label">Posted Journals</div><div className="stat-value" style={{color:'#00AEEF'}}>{periods.reduce((s,p)=>s+(p.posted_journals||0),0)}</div></div>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Period</th><th>Dates</th><th style={{textAlign:'center'}}>Journals</th><th style={{textAlign:'center'}}>Posted</th><th>VAT Period</th><th>Status</th><th>Locked By</th>{isAdmin && <th>Action</th>}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8}><div className="loading">Loading periods…</div></td></tr>}
            {periods.map(p => (
              <tr key={p.period_id}>
                <td style={{fontWeight:600}}>{p.period_name}</td>
                <td style={{fontSize:12}}>{p.period_start} → {p.period_end}</td>
                <td style={{textAlign:'center'}}>{p.total_journals||0}</td>
                <td style={{textAlign:'center'}}>{p.posted_journals||0}</td>
                <td className="mono" style={{fontSize:12}}>{p.vat_period_code||'—'}</td>
                <td>
                  {p.is_closed
                    ? <span className="badge badge-red" style={{fontSize:10}}>🔒 Locked</span>
                    : <span className="badge badge-green" style={{fontSize:10}}>Open</span>}
                </td>
                <td style={{fontSize:12}}>{p.locked_by||'—'}</td>
                {isAdmin && (
                  <td>
                    {!p.is_closed && (
                      <button className="btn btn-sm" style={{color:'#e53e3e',fontSize:11}} onClick={()=>lock(p)} disabled={locking===p.period_id}>
                        {locking===p.period_id ? '…' : 'Lock'}
                      </button>
                    )}
                    {p.is_closed && (
                      <button className="btn btn-sm" style={{fontSize:11}} onClick={()=>setShowUnlock(p)} disabled={unlocking===p.period_id}>
                        {unlocking===p.period_id ? '…' : 'Unlock'}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showUnlock && (
        <div className="modal-overlay" onClick={()=>setShowUnlock(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>Unlock Period — {showUnlock.period_name}</h3>
              <button onClick={()=>setShowUnlock(null)} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{fontSize:13,marginBottom:12,color:'#555'}}>⚠️ Unlocking allows new journals to be posted into a closed period. This action is audit-logged.</p>
              <div className="form-group">
                <label>Unlock Reason *</label>
                <textarea rows={3} value={unlockReason} onChange={e=>setReason(e.target.value)}
                  placeholder="e.g. Late supplier invoice — approved by Gideon 21/06/2026"
                  style={{width:'100%',resize:'vertical'}} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setShowUnlock(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={unlock} disabled={!unlockReason.trim()}>Confirm Unlock</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
