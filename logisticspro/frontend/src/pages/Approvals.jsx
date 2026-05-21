import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';

const API = import.meta.env.VITE_API_URL || '';
const token = () => localStorage.getItem('lp_token');
const req = (path, opts={}) => fetch(API+'/api'+path, {
  ...opts,
  headers: {'Content-Type':'application/json','Authorization':'Bearer '+token(),...(opts.headers||{})}
}).then(r=>r.json());

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-ZA',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
}

const STATUS_COLORS = { PENDING:'badge-amber', APPROVED:'badge-green', REJECTED:'badge-red' };

export default function Approvals({ onNavigateToLoad }) {
  const { user } = useAuth();
  const [anomalies, setAnomalies] = useState([]);
  const [costDeletions, setCostDeletions] = useState([]);
  const [orderNos, setOrderNos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('PENDING');
  const [tab, setTab] = useState('km');

  const loadData = async () => {
    setLoading(true);
    try {
      const [kmData, costData, orderData] = await Promise.all([
        req(`/km/anomalies${filter ? '?status='+filter : ''}`),
        req('/costs/pending-deletions').catch(()=>[]),
        req('/loads/pending-order-nos').catch(()=>[]),
      ]);
      setAnomalies(Array.isArray(kmData) ? kmData : []);
      setCostDeletions(Array.isArray(costData) ? costData : []);
      setOrderNos(Array.isArray(orderData) ? orderData : []);
    } catch(e){ console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, [filter]);

  const approveKm = async (id) => {
    setSaving(true);
    try {
      await req(`/km/anomalies/${id}`, { method:'PATCH', body: JSON.stringify({ action:'approve' }) });
      setSelected(null);
      loadData();
    } catch(e){ alert(e.message); }
    finally { setSaving(false); }
  };

  const rejectKm = async (id) => {
    if (!rejectionReason.trim()) return alert('Please enter a rejection reason');
    setSaving(true);
    try {
      await req(`/km/anomalies/${id}`, { method:'PATCH', body: JSON.stringify({ action:'reject', rejection_reason: rejectionReason }) });
      setSelected(null); setRejectionReason('');
      loadData();
    } catch(e){ alert(e.message); }
    finally { setSaving(false); }
  };

  const approveCostDeletion = async (id) => {
    setSaving(true);
    try {
      await req(`/costs/${id}/approve-delete`, { method:'PATCH', body: JSON.stringify({ action:'approve' }) });
      setSelected(null);
      loadData();
    } catch(e){ alert(e.message); }
    finally { setSaving(false); }
  };

  const rejectCostDeletion = async (id) => {
    if (!rejectionReason.trim()) return alert('Please enter a rejection reason');
    setSaving(true);
    try {
      await req(`/costs/${id}/approve-delete`, { method:'PATCH', body: JSON.stringify({ action:'reject', rejection_reason: rejectionReason }) });
      setSelected(null); setRejectionReason('');
      loadData();
    } catch(e){ alert(e.message); }
    finally { setSaving(false); }
  };

  const approveOrderNo = async (loadNo) => {
    setSaving(true);
    try {
      await req(`/loads/${loadNo}/approve-order-no`, { method:'PATCH', body: JSON.stringify({ action:'approve' }) });
      setSelected(null);
      loadData();
    } catch(e){ alert(e.message); }
    finally { setSaving(false); }
  };

  const rejectOrderNo = async (loadNo) => {
    if (!rejectionReason.trim()) return alert('Please enter a rejection reason');
    setSaving(true);
    try {
      await req(`/loads/${loadNo}/approve-order-no`, { method:'PATCH', body: JSON.stringify({ action:'reject', rejection_reason: rejectionReason }) });
      setSelected(null); setRejectionReason('');
      loadData();
    } catch(e){ alert(e.message); }
    finally { setSaving(false); }
  };

  const reviewPanel = (onApprove, onReject) => (
    <div style={{display:'flex',gap:12,alignItems:'flex-end',flexWrap:'wrap',padding:'12px 16px',background:'#fef9e7',borderBottom:'2px solid #f59e0b'}}>
      <div style={{flex:1,minWidth:200}}>
        <div style={{fontSize:11,color:'#555',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.06em'}}>Rejection reason (required to reject)</div>
        <input value={rejectionReason} onChange={e=>setRejectionReason(e.target.value)}
          placeholder="Enter reason for rejection…"
          style={{width:'100%',padding:'7px 10px',fontSize:13,border:'1px solid #ddd',borderRadius:4,fontFamily:'inherit'}} />
      </div>
      <button className="btn btn-primary" onClick={onApprove} disabled={saving}
        style={{background:'#059669',borderColor:'#059669'}}>✓ Approve</button>
      <button className="btn" onClick={onReject} disabled={saving}
        style={{color:'#e53e3e',borderColor:'#fca5a5'}}>✕ Reject</button>
    </div>
  );

  const tabs = [
    { key:'km', label:'KM Anomalies', count: anomalies.filter(a=>a.a_status==='PENDING').length, color:'#d97706' },
    { key:'costs', label:'Cost Deletions', count: costDeletions.length, color:'#e53e3e' },
    { key:'ordernos', label:'Order Numbers', count: orderNos.length, color:'#7c3aed' },
  ];

  return (
    <div>
      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">KM Anomalies Pending</div><div className="stat-value" style={{color:'#d97706'}}>{anomalies.filter(a=>a.a_status==='PENDING').length}</div></div>
        <div className="stat-card"><div className="stat-label">Cost Deletions Pending</div><div className="stat-value" style={{color:'#e53e3e'}}>{costDeletions.length}</div></div>
        <div className="stat-card"><div className="stat-label">Order No Changes Pending</div><div className="stat-value" style={{color:'#7c3aed'}}>{orderNos.length}</div></div>
        <div className="stat-card"><div className="stat-label">KM Approved</div><div className="stat-value" style={{color:'#059669'}}>{anomalies.filter(a=>a.a_status==='APPROVED').length}</div></div>
      </div>

      {/* Tab bar */}
      <div style={{display:'flex',gap:0,marginBottom:16,borderBottom:'2px solid #e5e7eb'}}>
        {tabs.map(t => (
          <button key={t.key} onClick={()=>setTab(t.key)} style={{
            padding:'10px 20px', border:'none', cursor:'pointer', fontSize:13, fontWeight:600,
            background:'none', marginBottom:'-2px', display:'flex', alignItems:'center', gap:6,
            borderBottom: tab===t.key ? '2px solid #00AEEF' : '2px solid transparent',
            color: tab===t.key ? '#00AEEF' : '#888',
          }}>
            {t.label}
            {t.count > 0 && (
              <span style={{background:t.color,color:'white',borderRadius:10,padding:'1px 7px',fontSize:11}}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* KM filter (only on KM tab) */}
      {tab==='km' && (
        <div className="filter-bar">
          <select value={filter} onChange={e=>setFilter(e.target.value)}>
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
      )}

      {/* ── KM Anomalies Tab ── */}
      {tab==='km' && (
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Load No</th><th>Truck</th><th>Type</th><th>Description</th>
              <th>Last Closing KM</th><th>New Opening KM</th><th>Dead KM</th>
              <th>Operator</th><th>Date</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={11}><div className="loading">Loading…</div></td></tr>}
              {!loading && anomalies.length===0 && <tr><td colSpan={11}><div className="empty-state">No anomalies found</div></td></tr>}
              {!loading && anomalies.map(a => (
                <>
                  <tr key={a.id} style={{background: selected===a.id?'#fef3c7':undefined}}>
                    <td className="mono" style={{fontWeight:600}}>
                      <button onClick={()=>onNavigateToLoad&&onNavigateToLoad(a.a_load_no)}
                        style={{background:'none',border:'none',color:'#00AEEF',cursor:'pointer',fontFamily:'monospace',fontWeight:600,fontSize:13,padding:0}}>
                        {a.a_load_no} ↗
                      </button>
                    </td>
                    <td className="mono">{a.a_truck}</td>
                    <td>{a.a_type}</td>
                    <td style={{fontSize:12}}>{a.a_description}</td>
                    <td className="mono">{Number(a.a_last_closing||0).toLocaleString()} km</td>
                    <td className="mono">{Number(a.a_new_opening||0).toLocaleString()} km</td>
                    <td className="mono" style={{color:'#e53e3e',fontWeight:600}}>{Number(a.a_dead_km||0).toLocaleString()} km</td>
                    <td>{a.a_operator}</td>
                    <td>{fmtDate(a.created_at)}</td>
                    <td><span className={`badge ${STATUS_COLORS[a.a_status]||'badge-gray'}`}>{a.a_status}</span></td>
                    <td>
                      {a.a_status==='PENDING' && (
                        <button className="btn btn-sm" onClick={()=>{ setSelected(selected===a.id?null:a.id); setRejectionReason(''); }}>
                          {selected===a.id?'Cancel':'Review'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {selected===a.id && (
                    <tr key={'rev-km-'+a.id}>
                      <td colSpan={11} style={{padding:0}}>
                        {reviewPanel(()=>approveKm(a.id), ()=>rejectKm(a.id))}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Cost Deletions Tab ── */}
      {tab==='costs' && (
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Load No</th><th>Cost Type</th><th>Description</th><th>Amount</th>
              <th>Requested By</th><th>Reason</th><th></th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={7}><div className="loading">Loading…</div></td></tr>}
              {!loading && costDeletions.length===0 && <tr><td colSpan={7}><div className="empty-state">No pending cost deletions</div></td></tr>}
              {!loading && costDeletions.map(c => (
                <>
                  <tr key={c.c_cost_no}>
                    <td className="mono" style={{fontWeight:600,color:'#00AEEF'}}>{c.c_load}</td>
                    <td>{c.c_code}</td>
                    <td style={{color:'#555'}}>{c.c_description}</td>
                    <td className="mono" style={{color:'#e53e3e',fontWeight:600}}>
                      R {Number(c.c_amount||0).toLocaleString('en-ZA',{minimumFractionDigits:2})}
                    </td>
                    <td>{c.c_delete_requested_by}</td>
                    <td style={{fontSize:12,color:'#555'}}>{c.c_delete_reason}</td>
                    <td>
                      <button className="btn btn-sm" onClick={()=>{ setSelected(selected===c.c_cost_no?null:c.c_cost_no); setRejectionReason(''); }}>
                        {selected===c.c_cost_no?'Cancel':'Review'}
                      </button>
                    </td>
                  </tr>
                  {selected===c.c_cost_no && (
                    <tr key={'rev-cost-'+c.c_cost_no}>
                      <td colSpan={7} style={{padding:0}}>
                        {reviewPanel(()=>approveCostDeletion(c.c_cost_no), ()=>rejectCostDeletion(c.c_cost_no))}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Order Number Changes Tab ── */}
      {tab==='ordernos' && (
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Load No</th><th>Date</th><th>Customer</th><th>Truck</th>
              <th>Current Order No</th><th>Requested Change</th><th>Requested By</th><th></th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={8}><div className="loading">Loading…</div></td></tr>}
              {!loading && orderNos.length===0 && <tr><td colSpan={8}><div className="empty-state">No pending order number changes</div></td></tr>}
              {!loading && orderNos.map(o => (
                <>
                  <tr key={o.m_load_no}>
                    <td className="mono" style={{fontWeight:600,color:'#00AEEF'}}>{o.m_load_no}</td>
                    <td>{o.m_date}</td>
                    <td>{o.m_customer}</td>
                    <td className="mono">{o.m_truck}</td>
                    <td style={{color:'#aaa'}}>{o.m_order_no||'—'}</td>
                    <td style={{fontWeight:600,color:'#7c3aed'}}>{o.m_order_no_pending}</td>
                    <td>{o.m_order_no_requested_by}</td>
                    <td>
                      <button className="btn btn-sm" onClick={()=>{ setSelected(selected===o.m_load_no?null:o.m_load_no); setRejectionReason(''); }}>
                        {selected===o.m_load_no?'Cancel':'Review'}
                      </button>
                    </td>
                  </tr>
                  {selected===o.m_load_no && (
                    <tr key={'rev-ord-'+o.m_load_no}>
                      <td colSpan={8} style={{padding:0}}>
                        {reviewPanel(()=>approveOrderNo(o.m_load_no), ()=>rejectOrderNo(o.m_load_no))}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
