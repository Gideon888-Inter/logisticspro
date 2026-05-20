import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthContext';

const API = import.meta.env.VITE_API_URL || '';
const token = () => localStorage.getItem('lp_token');
const req = (path, opts={}) => fetch(API+'/api'+path, {
  ...opts,
  headers: {'Content-Type':'application/json','Authorization':'Bearer '+token(),...(opts.headers||{})}
}).then(r=>r.json());

const STATUS_BADGE = {
  EN_ROUTE:'badge-blue', OFFLOADED:'badge-green', WAIT_ORDER_NO:'badge-amber',
  WAIT_APPROVAL:'badge-amber', WAIT_POD_SCAN:'badge-gray', WAIT_INVOICE_NO:'badge-orange',
  LOAD_INVOICED:'badge-green', WAIT_PROCESSING:'badge-gray', PRELOAD:'badge-gray', REJECTED:'badge-red',
};

const ALL_STATUSES = ['PRELOAD','EN_ROUTE','OFFLOADED','WAIT_ORDER_NO','WAIT_APPROVAL','WAIT_POD_SCAN','WAIT_INVOICE_NO','LOAD_INVOICED','REJECTED'];

const COST_TYPES = ['Loadshift','Fine','Labour','Extra Stop','Other'];

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-ZA',{day:'2-digit',month:'short',year:'numeric'}) : '—'; }
function fmtR(n) { return (n||n===0) ? 'R '+Number(n).toLocaleString('en-ZA',{minimumFractionDigits:0}) : '—'; }

// ── New Load Modal ────────────────────────────────────────────
function NewLoadModal({ onClose, onCreated }) {
  const { user } = useAuth();
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [clients, setClients] = useState([]);
  const [rates, setRates] = useState([]);
  const [form, setForm] = useState({
    m_truck:'', m_driver_id:'', m_customer:'',
    m_trailer_size:'None', m_trailer1:'',
    m_from:'', m_to:'', m_rate:0, m_bus_unit: user?.bus_unit||'IDC',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api.getVehicles({active:'Y'}),
      api.getDrivers({active:'Y'}),
      api.getCustomers(),
      req('/rates/client-rates'),
    ]).then(([v,d,c,r]) => {
      setVehicles(Array.isArray(v)?v:[]);
      setDrivers(Array.isArray(d)?d:[]);
      setClients(Array.isArray(c)?c:[]);
      setRates(Array.isArray(r)?r:[]);
    }).catch(console.error);
  }, []);

  const horses = vehicles.filter(v=>v.vh_type==='Horse');
  const trailers = vehicles.filter(v=>v.vh_type==='Trailer');

  // Get unique FROM locations for selected client
  const clientRates = rates.filter(r=>r.rc_client_code===form.m_customer);
  const fromOptions = [...new Set(clientRates.map(r=>r.rc_from))].sort();
  const toOptions = [...new Set(clientRates.filter(r=>r.rc_from===form.m_from).map(r=>r.rc_to))].sort();

  const set = (k,v) => {
    setForm(f => {
      const next = {...f, [k]:v};
      // Reset downstream fields
      if(k==='m_customer') { next.m_from=''; next.m_to=''; next.m_rate=0; }
      if(k==='m_from') { next.m_to=''; next.m_rate=0; }
      if(k==='m_to') {
        const matched = rates.find(r=>r.rc_client_code===next.m_customer && r.rc_from===next.m_from && r.rc_to===v);
        if(matched) {
          const size = next.m_trailer_size;
          next.m_rate = size==='18m' ? (matched.rc_rate_18m||0) : (matched.rc_rate_15m||matched.rc_rate_18m||0);
        }
      }
      if(k==='m_trailer_size') {
        const matched = rates.find(r=>r.rc_client_code===next.m_customer && r.rc_from===next.m_from && r.rc_to===next.m_to);
        if(matched) next.m_rate = v==='18m' ? (matched.rc_rate_18m||0) : (matched.rc_rate_15m||matched.rc_rate_18m||0);
        if(v==='None') next.m_trailer1='';
      }
      return next;
    });
  };

  const save = async () => {
    if(!form.m_truck) return alert('Please select a truck');
    if(!form.m_customer) return alert('Please select a customer');
    setSaving(true);
    try {
      await api.createLoad({ ...form, m_operator: user?.username, m_status:'PRELOAD' });
      onCreated();
    } catch(e){ alert(e.message); }
    finally{ setSaving(false); }
  };

  const inputStyle = {width:'100%',padding:'8px 10px',fontSize:13,border:'1px solid #ddd',borderRadius:4,fontFamily:'inherit'};
  const labelStyle = {fontSize:11,color:'#555',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:500,display:'block',marginBottom:4};

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width:620}}>
        <div className="modal-header">
          <h3>New Load</h3>
          <button onClick={onClose} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:18}}>✕</button>
        </div>
        <div className="modal-body">
          {/* Row 1: Truck + Driver */}
          <div className="form-row">
            <div className="form-group">
              <label style={labelStyle}>Truck *</label>
              <select value={form.m_truck} onChange={e=>set('m_truck',e.target.value)} style={inputStyle}>
                <option value="">— Select truck —</option>
                {horses.map(v=><option key={v.vh_code} value={v.vh_code}>{v.vh_code} — {v.vh_make} {v.vh_model}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label style={labelStyle}>Driver *</label>
              <select value={form.m_driver_id} onChange={e=>set('m_driver_id',e.target.value)} style={inputStyle}>
                <option value="">— Select driver —</option>
                {drivers.map(d=><option key={d.d_id} value={d.d_nickname}>{d.d_nickname}{d.d_name?' — '+d.d_name:''}</option>)}
              </select>
            </div>
          </div>

          {/* Row 2: Trailer size + trailer selection */}
          <div className="form-row">
            <div className="form-group">
              <label style={labelStyle}>Trailer Size</label>
              <select value={form.m_trailer_size} onChange={e=>set('m_trailer_size',e.target.value)} style={inputStyle}>
                <option value="None">None</option>
                <option value="15m">15m</option>
                <option value="18m">18m</option>
              </select>
            </div>
            <div className="form-group">
              <label style={labelStyle}>Trailer {form.m_trailer_size==='None'?'(not required)':'*'}</label>
              <select value={form.m_trailer1} onChange={e=>set('m_trailer1',e.target.value)} style={inputStyle} disabled={form.m_trailer_size==='None'}>
                <option value="">— Select trailer —</option>
                {trailers.map(v=><option key={v.vh_code} value={v.vh_code}>{v.vh_code} — {v.vh_make} {v.vh_model}</option>)}
              </select>
            </div>
          </div>

          {/* Row 3: Customer */}
          <div className="form-row">
            <div className="form-group">
              <label style={labelStyle}>Customer *</label>
              <select value={form.m_customer} onChange={e=>set('m_customer',e.target.value)} style={inputStyle}>
                <option value="">— Select customer —</option>
                {clients.map(c=><option key={c.c_code} value={c.c_code}>{c.c_code} — {c.c_name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label style={labelStyle}>Business Unit</label>
              <select value={form.m_bus_unit} onChange={e=>set('m_bus_unit',e.target.value)} style={inputStyle}>
                <option value="IDC">IDC</option><option value="IDM">IDM</option><option value="MOGWASE">Mogwase</option>
              </select>
            </div>
          </div>

          {/* Row 4: From + To (from rate card) */}
          <div className="form-row">
            <div className="form-group">
              <label style={labelStyle}>From {!form.m_customer&&<span style={{color:'#aaa'}}>(select customer first)</span>}</label>
              <select value={form.m_from} onChange={e=>set('m_from',e.target.value)} style={inputStyle} disabled={!form.m_customer}>
                <option value="">— Select origin —</option>
                {fromOptions.map(f=><option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label style={labelStyle}>To {!form.m_from&&<span style={{color:'#aaa'}}>(select origin first)</span>}</label>
              <select value={form.m_to} onChange={e=>set('m_to',e.target.value)} style={inputStyle} disabled={!form.m_from}>
                <option value="">— Select destination —</option>
                {toOptions.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Rate (auto-populated, read only) */}
          <div className="form-row">
            <div className="form-group">
              <label style={labelStyle}>Rate (auto from rate card)</label>
              <input value={form.m_rate ? 'R '+Number(form.m_rate).toLocaleString('en-ZA') : '—'} readOnly
                style={{...inputStyle, background:'#f8f9fa', color: form.m_rate?'#005A8E':'#aaa', fontWeight:600}} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':'Create Load'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Add Cost Modal ────────────────────────────────────────────
function AddCostModal({ loadId, onClose, onSaved }) {
  const { user } = useAuth();
  const [form, setForm] = useState({ c_code:'Loadshift Cost', c_description:'', c_amount:'' });
  const [saving, setSaving] = useState(false);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const save = async () => {
    if(!form.c_amount || isNaN(Number(form.c_amount))) return alert('Please enter a valid amount');
    if(form.c_code==='Other' && !form.c_description.trim()) return alert('Please enter a reason for Other cost');
    setSaving(true);
    try {
      await req('/costs', { method:'POST', body: JSON.stringify({
        c_load: loadId,
        c_code: form.c_code,
        c_description: form.c_code==='Other' ? form.c_description : form.c_code,
        c_amount: Number(form.c_amount),
        c_operator: user?.username,
      })});
      onSaved();
    } catch(e){ alert(e.message); }
    finally{ setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width:420}}>
        <div className="modal-header">
          <h3>Add Cost — {loadId}</h3>
          <button onClick={onClose} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:18}}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Cost Type *</label>
            <select value={form.c_code} onChange={e=>set('c_code',e.target.value)}
              style={{width:'100%',padding:'8px 10px',fontSize:13,border:'1px solid #ddd',borderRadius:4,fontFamily:'inherit'}}>
              {COST_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {form.c_code==='Other' && (
            <div className="form-group">
              <label>Reason *</label>
              <input value={form.c_description} onChange={e=>set('c_description',e.target.value)}
                placeholder="Describe the cost reason…"
                style={{width:'100%',padding:'8px 10px',fontSize:13,border:'1px solid #ddd',borderRadius:4,fontFamily:'inherit'}} />
            </div>
          )}
          <div className="form-group">
            <label>Amount (R) *</label>
            <input type="number" value={form.c_amount} onChange={e=>set('c_amount',e.target.value)}
              placeholder="0.00"
              style={{width:'100%',padding:'8px 10px',fontSize:13,border:'1px solid #ddd',borderRadius:4,fontFamily:'inherit'}} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':'Add Cost'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Expanded Load Row ─────────────────────────────────────────
function ExpandedRow({ load, onRefresh, onCostUpdate }) {
  const { user } = useAuth();
  const [comments, setComments] = useState([]);
  const [costs, setCosts] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [showCostModal, setShowCostModal] = useState(false);
  const [statusVal, setStatusVal] = useState(load.m_status);

  const loadDetails = async () => {
    try {
      const [c, co] = await Promise.all([
        api.getComments(load.m_load_no),
        req(`/costs?load=${encodeURIComponent(load.m_load_no)}`).catch(()=>[]),
      ]);
      setComments(Array.isArray(c)?c:[]);
      const costsArr = Array.isArray(co) ? co : [];
      setCosts(costsArr);
      // Push total up to parent table immediately
      const extraTotal = costsArr.reduce((s,c) => s + Number(c.c_amount||0), 0);
      if (onCostUpdate) onCostUpdate(load.m_load_no, extraTotal);
    } catch(e){console.error(e);}
  };
  useEffect(()=>{ loadDetails(); },[load.m_load_no]);

  const sendComment = async () => {
    if(!newComment.trim()) return;
    try { await api.addComment(load.m_load_no, newComment); setNewComment(''); loadDetails(); } catch(e){alert(e.message);}
  };

  const updateStatus = async (status) => {
    try { await api.updateLoad(load.m_load_no,{m_status:status}); setStatusVal(status); onRefresh(); loadDetails(); } catch(e){alert(e.message);}
  };

  const totalCosts = costs.reduce((s,c)=>s+Number(c.c_amount||0),0);
  const grandTotal = Number(load.m_rate||0) + totalCosts;

  const cell = (label,value) => (
    <div style={{minWidth:120}}>
      <div style={{fontSize:10,color:'#aaa',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:2}}>{label}</div>
      <div style={{fontSize:13,fontWeight:500}}>{value||'—'}</div>
    </div>
  );

  return (
    <tr>
      <td colSpan={9} style={{padding:0,background:'#f8fafc',borderBottom:'2px solid #00AEEF'}}>
        <div style={{padding:'16px 20px', display:'flex', flexDirection:'column', gap:16}}>

          {/* Load details grid */}
          <div style={{display:'flex', flexWrap:'wrap', gap:'12px 32px'}}>
            {cell('Load No', load.m_load_no)}
            {cell('Date', fmtDate(load.m_date))}
            {cell('Truck', load.m_truck)}
            {cell('Driver', load.m_driver_id)}
            {cell('Customer', load.lp_customers?.c_name||load.m_customer)}
            {cell('From', load.m_from)}
            {cell('To', load.m_to)}
            {cell('Trailer', load.m_trailer1||'None')}
            {cell('Rate', fmtR(load.m_rate))}
            {cell('Order No', load.m_order_no)}
            {cell('Invoice', load.m_invoice)}
            {cell('Unit', load.m_bus_unit)}
          </div>

          {/* Costs section */}
          <div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
              <div style={{fontSize:12,fontWeight:600,color:'#005A8E',textTransform:'uppercase',letterSpacing:'0.06em'}}>Additional Costs</div>
              <button className="btn btn-sm btn-primary" onClick={()=>setShowCostModal(true)}>+ Add Cost</button>
            </div>
            {costs.length===0 ? (
              <div style={{fontSize:12,color:'#aaa',padding:'8px 0'}}>No additional costs</div>
            ) : (
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13,marginBottom:8}}>
                <thead>
                  <tr style={{background:'#e8f4fd'}}>
                    <th style={{padding:'6px 10px',textAlign:'left',fontSize:11,color:'#005A8E'}}>Type</th>
                    <th style={{padding:'6px 10px',textAlign:'left',fontSize:11,color:'#005A8E'}}>Description</th>
                    <th style={{padding:'6px 10px',textAlign:'right',fontSize:11,color:'#005A8E'}}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {costs.map(c=>(
                    <tr key={c.c_cost_no} style={{borderBottom:'1px solid #e8f4fd'}}>
                      <td style={{padding:'6px 10px'}}>{c.c_code}</td>
                      <td style={{padding:'6px 10px',color:'#555'}}>{c.c_description}</td>
                      <td style={{padding:'6px 10px',textAlign:'right',fontFamily:'monospace'}}>{fmtR(c.c_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {/* Totals */}
            <div style={{display:'flex',gap:24,justifyContent:'flex-end',paddingTop:8,borderTop:'1px solid #ddd'}}>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:10,color:'#aaa',textTransform:'uppercase',letterSpacing:'0.06em'}}>Rate</div>
                <div style={{fontFamily:'monospace',fontWeight:600,color:'#005A8E'}}>{fmtR(load.m_rate)}</div>
              </div>
              {totalCosts>0&&<div style={{textAlign:'right'}}>
                <div style={{fontSize:10,color:'#aaa',textTransform:'uppercase',letterSpacing:'0.06em'}}>Extra Costs</div>
                <div style={{fontFamily:'monospace',fontWeight:600,color:'#e53e3e'}}>{fmtR(totalCosts)}</div>
              </div>}
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:10,color:'#aaa',textTransform:'uppercase',letterSpacing:'0.06em'}}>Total</div>
                <div style={{fontFamily:'monospace',fontWeight:700,fontSize:15,color:'#005A8E'}}>{fmtR(grandTotal)}</div>
              </div>
            </div>
          </div>

          {/* Status + Comments side by side */}
          <div style={{display:'flex',gap:24,flexWrap:'wrap'}}>
            {/* Status */}
            <div style={{minWidth:200}}>
              <div style={{fontSize:12,fontWeight:600,color:'#005A8E',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:8}}>Update Status</div>
              <select value={statusVal} onChange={e=>updateStatus(e.target.value)}
                style={{width:'100%',padding:'8px 10px',fontSize:13,border:'1px solid #ddd',borderRadius:4,fontFamily:'inherit',background:'white'}}>
                {ALL_STATUSES.map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
              </select>
            </div>

            {/* Comments */}
            <div style={{flex:1,minWidth:300}}>
              <div style={{fontSize:12,fontWeight:600,color:'#005A8E',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:8}}>Comments</div>
              <div style={{maxHeight:120,overflowY:'auto',display:'flex',flexDirection:'column',gap:6,marginBottom:8}}>
                {comments.length===0&&<div style={{fontSize:12,color:'#aaa'}}>No comments yet</div>}
                {comments.map(c=>(
                  <div key={c.id} style={{background:'white',border:'1px solid #e8f4fd',borderRadius:4,padding:'6px 10px'}}>
                    <div style={{fontSize:12}}>{c.c_comment}</div>
                    <div style={{fontSize:10,color:'#aaa',marginTop:2}}>{c.c_logged_by} · {fmtDate(c.c_time)}</div>
                  </div>
                ))}
              </div>
              <div style={{display:'flex',gap:6}}>
                <input value={newComment} onChange={e=>setNewComment(e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&sendComment()}
                  placeholder="Add comment…"
                  style={{flex:1,padding:'6px 8px',fontSize:12,border:'1px solid #ddd',borderRadius:4,fontFamily:'inherit'}} />
                <button className="btn btn-sm btn-primary" onClick={sendComment}>Add</button>
              </div>
            </div>
          </div>
        </div>

        {showCostModal && (
          <AddCostModal
            loadId={load.m_load_no}
            onClose={()=>setShowCostModal(false)}
            onSaved={()=>{ setShowCostModal(false); loadDetails(); onRefresh(); }}
          />
        )}
      </td>
    </tr>
  );
}

// ── Main Loads Page ───────────────────────────────────────────
export default function Loads() {
  const [loads, setLoads] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status:'', bus_unit:'', search:'' });
  const [expandedRow, setExpandedRow] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [loadCosts, setLoadCosts] = useState({});

  const fetchLoads = async (keepExpanded = false) => {
    if (!keepExpanded) setLoading(true);
    try {
      const params = {};
      if(filters.status) params.status=filters.status;
      if(filters.bus_unit) params.bus_unit=filters.bus_unit;
      const res = await api.getLoads(params);
      const data = res.data||[];
      setLoads(data);
      setLoading(false);
    } catch(e){ console.error(e); }
    finally{ setLoading(false); }
  };

  const fetchStats = async () => {
    try { setStats(await api.getLoadStats()); } catch{}
  };

  useEffect(()=>{ fetchLoads(); fetchStats(); },[filters.status, filters.bus_unit]);



  const filtered = loads.filter(l=>{
    if(!filters.search) return true;
    const s=filters.search.toLowerCase();
    return l.m_load_no?.toLowerCase().includes(s)||l.m_truck?.toLowerCase().includes(s)||l.m_customer?.toLowerCase().includes(s)||l.m_from?.toLowerCase().includes(s)||l.m_to?.toLowerCase().includes(s);
  });

  const toggleRow = (id) => setExpandedRow(e=>e===id?null:id);

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Active Loads</div><div className="stat-value">{stats.total??'—'}</div></div>
        <div className="stat-card"><div className="stat-label">En Route</div><div className="stat-value" style={{color:'#00AEEF'}}>{stats.en_route??'—'}</div></div>
        <div className="stat-card"><div className="stat-label">Awaiting Approval</div><div className="stat-value" style={{color:'#d97706'}}>{stats.wait_approval??'—'}</div></div>
        <div className="stat-card"><div className="stat-label">Invoiced Value</div><div className="stat-value" style={{fontSize:18}}>{fmtR(stats.total_value)}</div></div>
      </div>

      <div className="filter-bar">
        <input placeholder="Search load no, truck, customer…" value={filters.search} onChange={e=>setFilters(f=>({...f,search:e.target.value}))} />
        <select value={filters.status} onChange={e=>setFilters(f=>({...f,status:e.target.value}))}>
          <option value="">All statuses</option>
          {ALL_STATUSES.map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
        </select>
        <select value={filters.bus_unit} onChange={e=>setFilters(f=>({...f,bus_unit:e.target.value}))}>
          <option value="">All units</option>
          <option value="IDC">IDC</option><option value="IDM">IDM</option><option value="MOGWASE">Mogwase</option>
        </select>
        <button className="btn btn-primary btn-sm" onClick={()=>setShowModal(true)}>+ New Load</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{width:32}}></th>
              <th>Load No</th><th>Date</th><th>Truck</th>
              <th>Customer</th><th>From</th><th>To</th>
              <th>Rate</th><th>Extra Costs</th><th>Total</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading&&<tr><td colSpan={11}><div className="loading">Loading…</div></td></tr>}
            {!loading&&filtered.length===0&&<tr><td colSpan={11}><div className="empty-state">No loads found</div></td></tr>}
            {!loading&&filtered.map(l=>{
              const extra = loadCosts[l.m_load_no]||0;
              const total = Number(l.m_rate||0)+extra;
              const extra = Number(l._extra || loadCosts[l.m_load_no] || 0);
              const total = Number(l.m_rate||0) + extra;
              const isOpen = expandedRow===l.m_load_no;
              return (
                <>
                  <tr key={l.m_load_no}
                    style={{background:isOpen?'#e8f4fd':undefined, cursor:'pointer'}}
                    onClick={()=>toggleRow(l.m_load_no)}>
                    <td style={{textAlign:'center',color:'#00AEEF',fontWeight:700,fontSize:16}}>
                      {isOpen?'▲':'▼'}
                    </td>
                    <td className="mono" style={{fontWeight:600}}>{l.m_load_no}</td>
                    <td>{fmtDate(l.m_date)}</td>
                    <td className="mono">{l.m_truck}</td>
                    <td>{l.lp_customers?.c_name||l.m_customer}</td>
                    <td>{l.m_from}</td>
                    <td>{l.m_to}</td>
                    <td className="mono">{fmtR(l.m_rate)}</td>
                    <td className="mono" style={{color:extra>0?'#e53e3e':'#aaa'}}>{extra>0?fmtR(extra):'—'}</td>
                    <td className="mono" style={{fontWeight:600,color:'#005A8E'}}>{fmtR(total)}</td>
                    <td><span className={`badge ${STATUS_BADGE[l.m_status]||'badge-gray'}`}>{l.m_status?.replace(/_/g,' ')}</span></td>
                  </tr>
                  {isOpen&&<ExpandedRow key={'exp-'+l.m_load_no} load={l} onRefresh={fetchLoads}
                    onCostUpdate={(id, total) => {
                      setLoadCosts(prev => ({...prev, [id]: total}));
                      setLoads(prev => prev.map(ld => ld.m_load_no === id ? {...ld, _extra: total} : ld));
                    }}
                  />}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {showModal&&<NewLoadModal onClose={()=>setShowModal(false)} onCreated={()=>{setShowModal(false);fetchLoads();fetchStats();}} />}
    </div>
  );
}
