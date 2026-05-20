import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || '';
const token = () => localStorage.getItem('lp_token');
const req = (path, opts={}) => fetch(API+'/api'+path, { ...opts, headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+token(), ...(opts.headers||{}) } }).then(r=>r.json());

const EMPTY_ROUTE = { from_loc:'', to_loc:'', kms:'', rate_15m:'', rate_18m:'' };

// Export ALL rates as CSV
function exportAllCSV(clients, rates) {
  const headers = ['Client Code','Client Name','From','To',"KM's",'15m Rate','18m Rate'];
  const rows = [];
  rates.forEach(rate => {
    const client = clients.find(c=>c.c_code===rate.rc_client_code);
    rows.push([rate.rc_client_code, client?.c_name||'', rate.rc_from||'', rate.rc_to||'', rate.rc_kms||'', rate.rc_rate_15m||'', rate.rc_rate_18m||'']);
  });
  const csv=[headers,...rows].map(r=>r.map(x=>`"${x}"`).join(',')).join('\n');
  const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='all_client_rates.csv';a.click();
}

// Export single client rate card as CSV
function exportClientCSV(clientCode, clientName, rates) {
  const headers = ['From','To',"KM's",'15m Rate','18m Rate'];
  const rows = rates.filter(r=>r.rc_client_code===clientCode).map(r=>[r.rc_from||'',r.rc_to||'',r.rc_kms||'',r.rc_rate_15m||'',r.rc_rate_18m||'']);
  const csv=[[`${clientCode} - ${clientName}`],['RATE STRUCTURE'],[[]],headers,...rows].map(r=>r.map?r.map(x=>`"${x}"`).join(','):r).join('\n');
  const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download=`${clientCode}_rates.csv`;a.click();
}

export default function Rates() {
  const [clients, setClients] = useState([]);
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [modalClient, setModalClient] = useState('');
  const [routes, setRoutes] = useState([{ ...EMPTY_ROUTE }]);
  const [saving, setSaving] = useState(false);
  const [showRouteModal, setShowRouteModal] = useState(false);
  const [editRate, setEditRate] = useState(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [c, r] = await Promise.all([
        req('/customers'),
        req('/rates/client-rates').catch(()=>[])
      ]);
      setClients(Array.isArray(c)?c:[]);
      setRates(Array.isArray(r)?r:[]);
    } catch(e){console.error(e);}
    finally{setLoading(false);}
  };
  useEffect(()=>{ loadData(); },[]);

  const clientsWithRates = clients.filter(c=> rates.some(r=>r.rc_client_code===c.c_code));
  const filteredClients = clientsWithRates.filter(c=>{
    const s=search.toLowerCase();
    return !s||c.c_code.toLowerCase().includes(s)||c.c_name.toLowerCase().includes(s);
  });

  const clientRates = selectedClient ? rates.filter(r=>r.rc_client_code===selectedClient.c_code) : [];

  const openNewRateCard = () => {
    setModalClient('');
    setRoutes([{...EMPTY_ROUTE}]);
    setShowModal(true);
  };

  const addRoute = () => setRoutes(r=>[...r,{...EMPTY_ROUTE}]);
  const removeRoute = (i) => setRoutes(r=>r.filter((_,idx)=>idx!==i));
  const setRoute = (i,k,v) => setRoutes(r=>r.map((row,idx)=>idx===i?{...row,[k]:v}:row));

  const saveRateCard = async () => {
    if(!modalClient) return alert('Please select a client');
    if(routes.every(r=>!r.from_loc&&!r.to_loc)) return alert('Please add at least one route');
    setSaving(true);
    try {
      await req('/rates/client-rates', {
        method:'POST',
        body: JSON.stringify({ client_code: modalClient, routes: routes.filter(r=>r.from_loc||r.to_loc) })
      });
      setShowModal(false); loadData();
    } catch(e){alert(e.message);}
    finally{setSaving(false);}
  };

  const openEditRoute = (rate) => { setEditRate({...rate}); setShowRouteModal(true); };

  const saveEditRoute = async () => {
    setSaving(true);
    try {
      await req(`/rates/client-rates/${editRate.id}`,{method:'PATCH',body:JSON.stringify(editRate)});
      setShowRouteModal(false); loadData();
    } catch(e){alert(e.message);}
    finally{setSaving(false);}
  };

  const deleteRoute = async (id) => {
    if(!confirm('Delete this rate?')) return;
    try { await req(`/rates/client-rates/${id}`,{method:'DELETE'}); loadData(); } catch(e){alert(e.message);}
  };

  const fmtR = n => n ? 'R '+Number(n).toLocaleString('en-ZA') : '—';

  return (
    <div style={{display:'flex', gap:20, height:'calc(100vh - 140px)'}}>
      {/* Left: client list */}
      <div style={{width:300, flexShrink:0, display:'flex', flexDirection:'column', gap:12}}>
        <div className="filter-bar" style={{marginBottom:0}}>
          <input placeholder="Search client…" value={search} onChange={e=>setSearch(e.target.value)} style={{flex:1}} />
        </div>
        <div style={{display:'flex', gap:8}}>
          <button className="btn btn-primary btn-sm" style={{flex:1}} onClick={openNewRateCard}>+ New Rate Card</button>
          <button className="btn btn-sm" onClick={()=>exportAllCSV(clients,rates)}>⬇ All</button>
        </div>
        <div style={{flex:1, overflowY:'auto', background:'white', borderRadius:6, boxShadow:'0 2px 12px rgba(0,0,0,0.08)'}}>
          {loading && <div className="loading">Loading…</div>}
          {!loading && filteredClients.length===0 && <div className="empty-state">No rate cards yet</div>}
          {!loading && filteredClients.map(c=>(
            <div key={c.c_code}
              onClick={()=>setSelectedClient(c)}
              style={{
                padding:'12px 14px', cursor:'pointer', borderBottom:'1px solid #f0f0f0',
                background: selectedClient?.c_code===c.c_code ? '#e8f4fd':'white',
                borderLeft: selectedClient?.c_code===c.c_code ? '3px solid #00AEEF':'3px solid transparent',
              }}>
              <div style={{fontWeight:600, fontSize:13, fontFamily:'monospace'}}>{c.c_code}</div>
              <div style={{fontSize:12, color:'#555', marginTop:2}}>{c.c_name}</div>
              <div style={{fontSize:11, color:'#aaa', marginTop:2}}>{rates.filter(r=>r.rc_client_code===c.c_code).length} routes</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: rate card detail */}
      <div style={{flex:1, display:'flex', flexDirection:'column', gap:12}}>
        {!selectedClient ? (
          <div className="empty-state" style={{paddingTop:80}}>
            <div style={{fontSize:32, marginBottom:12}}>💰</div>
            <div style={{fontSize:15, fontWeight:600, color:'#555'}}>Select a client to view their rate card</div>
          </div>
        ) : (
          <>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <div>
                <div style={{fontWeight:700, fontSize:16}}>{selectedClient.c_code} — {selectedClient.c_name}</div>
                <div style={{fontSize:12, color:'#888', marginTop:2}}>{clientRates.length} routes configured</div>
              </div>
              <button className="btn btn-sm" onClick={()=>exportClientCSV(selectedClient.c_code, selectedClient.c_name, rates)}>⬇ Export Rate Card</button>
            </div>
            <div className="table-wrap" style={{flex:1, overflowY:'auto'}}>
              <table>
                <thead><tr><th>From</th><th>To</th><th>KM's</th><th>15m Rate</th><th>18m Rate</th><th style={{width:80}}></th></tr></thead>
                <tbody>
                  {clientRates.length===0 && <tr><td colSpan={6}><div className="empty-state">No routes on this rate card</div></td></tr>}
                  {clientRates.map(r=>(
                    <tr key={r.id}>
                      <td style={{fontWeight:500}}>{r.rc_from}</td>
                      <td style={{fontWeight:500}}>{r.rc_to}</td>
                      <td className="mono">{r.rc_kms ? Number(r.rc_kms).toLocaleString()+' km' : '—'}</td>
                      <td className="mono">{fmtR(r.rc_rate_15m)}</td>
                      <td className="mono">{fmtR(r.rc_rate_18m)}</td>
                      <td>
                        <button className="btn btn-sm" onClick={()=>openEditRoute(r)} style={{marginRight:4}}>Edit</button>
                        <button className="btn btn-sm" onClick={()=>deleteRoute(r.id)} style={{color:'#e53e3e',borderColor:'#fca5a5'}}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* New Rate Card Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={()=>setShowModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{width:680, maxHeight:'90vh'}}>
            <div className="modal-header">
              <h3>New Rate Card</h3>
              <button onClick={()=>setShowModal(false)} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Client *</label>
                <select value={modalClient} onChange={e=>setModalClient(e.target.value)}>
                  <option value="">— Select a client —</option>
                  {clients.map(c=><option key={c.c_code} value={c.c_code}>{c.c_code} — {c.c_name}</option>)}
                </select>
              </div>
              <div style={{marginBottom:8, fontWeight:600, fontSize:12, color:'#555', textTransform:'uppercase', letterSpacing:'0.06em'}}>Routes & Pricing</div>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:13, marginBottom:8}}>
                <thead>
                  <tr style={{background:'#f8f9fa'}}>
                    <th style={{padding:'6px 8px', textAlign:'left', fontWeight:600, fontSize:11, color:'#555'}}>From</th>
                    <th style={{padding:'6px 8px', textAlign:'left', fontWeight:600, fontSize:11, color:'#555'}}>To</th>
                    <th style={{padding:'6px 8px', textAlign:'left', fontWeight:600, fontSize:11, color:'#555'}}>KM's</th>
                    <th style={{padding:'6px 8px', textAlign:'left', fontWeight:600, fontSize:11, color:'#555'}}>15m Rate</th>
                    <th style={{padding:'6px 8px', textAlign:'left', fontWeight:600, fontSize:11, color:'#555'}}>18m Rate</th>
                    <th style={{width:32}}></th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((r,i)=>(
                    <tr key={i}>
                      {['from_loc','to_loc','kms','rate_15m','rate_18m'].map(k=>(
                        <td key={k} style={{padding:'4px'}}>
                          <input value={r[k]} onChange={e=>setRoute(i,k,e.target.value)}
                            style={{width:'100%',padding:'5px 7px',border:'1px solid #ddd',borderRadius:4,fontSize:13,fontFamily:'inherit'}}
                            placeholder={k==='kms'||k.includes('rate')?'0':''}
                          />
                        </td>
                      ))}
                      <td style={{padding:'4px'}}>
                        <button onClick={()=>removeRoute(i)} style={{background:'none',border:'none',color:'#e53e3e',cursor:'pointer',padding:4,fontSize:16}}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn btn-sm" onClick={addRoute}>+ Add Route</button>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveRateCard} disabled={saving}>{saving?'Saving…':'Save Rate Card'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Route Modal */}
      {showRouteModal && editRate && (
        <div className="modal-overlay" onClick={()=>setShowRouteModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{width:460}}>
            <div className="modal-header">
              <h3>Edit Route</h3>
              <button onClick={()=>setShowRouteModal(false)} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label>From</label><input value={editRate.rc_from||''} onChange={e=>setEditRate(r=>({...r,rc_from:e.target.value}))} /></div>
                <div className="form-group"><label>To</label><input value={editRate.rc_to||''} onChange={e=>setEditRate(r=>({...r,rc_to:e.target.value}))} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>KM's</label><input type="number" value={editRate.rc_kms||''} onChange={e=>setEditRate(r=>({...r,rc_kms:e.target.value}))} /></div>
                <div className="form-group"><label>15m Rate (R)</label><input type="number" value={editRate.rc_rate_15m||''} onChange={e=>setEditRate(r=>({...r,rc_rate_15m:e.target.value}))} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>18m Rate (R)</label><input type="number" value={editRate.rc_rate_18m||''} onChange={e=>setEditRate(r=>({...r,rc_rate_18m:e.target.value}))} /></div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setShowRouteModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEditRoute} disabled={saving}>{saving?'Saving…':'Update Route'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
