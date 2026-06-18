import { useState, useEffect } from 'react';
import { api } from '../lib/api';

const EMPTY = { d_id:'', d_nickname:'', d_name:'', d_cell:'', d_type:'Interland', d_pdp_expiry:'', d_receipt:'N', d_start_date:'', d_training_date:'', d_active:'Y', d_bus_unit:'IDC' };

function exportCSV(data) {
  const headers = ['Nickname','Name','Cell Number','Type','PDP Expiry','Has Receipt','Start Date','Training Date'];
  const rows = data.map(d => [d.d_nickname||'', d.d_name||d.d_nickname||'', d.d_cell||'', d.d_type||'Interland', d.d_pdp_expiry||'', d.d_receipt==='Y'?'YES':'NO', d.d_start_date||'', d.d_training_date||'']);
  const csv = [headers,...rows].map(r=>r.map(c=>`"${c}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv); a.download='drivers_export.csv'; a.click();
}

export default function Drivers() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('Y');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);

  const load = async () => {
    setLoading(true);
    try { setData(await api.getDrivers()); } catch(e){console.error(e);}
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const filtered = data.filter(d => {
    const s = search.toLowerCase();
    return (!s || d.d_nickname?.toLowerCase().includes(s) || d.d_id?.toLowerCase().includes(s) || (d.d_name||'').toLowerCase().includes(s))
      && (!typeFilter || (d.d_type||'Interland') === typeFilter)
      && (!activeFilter || d.d_active === activeFilter);
  });

  const openAdd = () => { setForm(EMPTY); setEditId(null); setShowModal(true); };
  const openEdit = (d) => { setForm({...EMPTY,...d, d_name: d.d_name||d.d_nickname}); setEditId(d.d_id); setShowModal(true); };
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const save = async () => {
    if (!form.d_id.trim() || !form.d_nickname.trim()) return alert('Driver ID and Nickname are required');
    setSaving(true);
    try {
      const payload = { ...form };
      if (editId) await api.updateDriver(editId, payload);  // FIX: was conditional raw fetch fallback
      else await api.createDriver(payload);
      setShowModal(false); load();
    } catch(e){ alert(e.message); }
    finally { setSaving(false); }
  };

  const today = new Date().toISOString().split('T')[0];

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Total Drivers</div><div className="stat-value">{data.length}</div></div>
        <div className="stat-card"><div className="stat-label">Active</div><div className="stat-value" style={{color:'#00AEEF'}}>{data.filter(d=>d.d_active==='Y').length}</div></div>
        <div className="stat-card"><div className="stat-label">Interland</div><div className="stat-value" style={{color:'#00AEEF'}}>{data.filter(d=>!d.d_type||d.d_type==='Interland').length}</div></div>
        <div className="stat-card"><div className="stat-label">PDP Expiring (90 days)</div>
          <div className="stat-value" style={{color:'#e53e3e'}}>
            {data.filter(d=>{if(!d.d_pdp_expiry)return false; const days=(new Date(d.d_pdp_expiry)-new Date())/86400000; return days>=0&&days<=90;}).length}
          </div>
        </div>
      </div>

      <div className="filter-bar">
        <input placeholder="Search nickname, name, ID…" value={search} onChange={e=>setSearch(e.target.value)} />
        <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}>
          <option value="">All types</option><option value="Interland">Interland</option><option value="TRILLIUM">Trillium</option>
        </select>
        <select value={activeFilter} onChange={e=>setActiveFilter(e.target.value)}>
          <option value="">All</option>
          <option value="Y">Active</option>
          <option value="N">Inactive</option>
        </select>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Driver</button>
        <button className="btn btn-sm" onClick={()=>exportCSV(filtered)}>⬇ Export CSV</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Nickname</th><th>Full Name</th><th>Cell</th><th>Type</th><th>PDP Expiry</th><th>Has Receipt</th><th>Start Date</th><th>Training Date</th><th>Active</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9}><div className="loading">Loading drivers…</div></td></tr>}
            {!loading && filtered.length===0 && <tr><td colSpan={9}><div className="empty-state">No drivers found</div></td></tr>}
            {!loading && filtered.map(d => {
              const pdpDays = d.d_pdp_expiry ? (new Date(d.d_pdp_expiry)-new Date())/86400000 : null;
              const pdpColor = pdpDays===null?'':pdpDays<0?'color:#e53e3e':pdpDays<90?'color:#d97706':'color:#059669';
              return (
                <tr key={d.d_id} onClick={()=>openEdit(d)}>
                  <td style={{fontWeight:600}}>{d.d_nickname}</td>
                  <td>{d.d_name||d.d_nickname}</td>
                  <td className="mono">{d.d_cell||'—'}</td>
                  <td>{d.d_type||'Interland'}</td>
                  <td style={{fontFamily:'monospace',fontSize:12,...(pdpColor?{style:pdpColor}:{})}}>{d.d_pdp_expiry||'—'}</td>
                  <td><span className={`badge ${d.d_receipt==='Y'?'badge-green':'badge-gray'}`}>{d.d_receipt==='Y'?'YES':'NO'}</span></td>
                  <td className="mono">{d.d_start_date||'—'}</td>
                  <td className="mono">{d.d_training_date||'—'}</td>
                  <td><span className={`badge ${d.d_active==='Y'?'badge-green':'badge-red'}`}>{d.d_active==='Y'?'Active':'Inactive'}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={()=>setShowModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{width:600}}>
            <div className="modal-header">
              <h3>{editId?'Edit Driver — '+editId:'Add New Driver'}</h3>
              <button onClick={()=>setShowModal(false)} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label>Driver ID *</label><input value={form.d_id} onChange={e=>set('d_id',e.target.value)} disabled={!!editId} placeholder="e.g. D-001" /></div>
                <div className="form-group"><label>Nickname *</label><input value={form.d_nickname} onChange={e=>set('d_nickname',e.target.value)} placeholder="e.g. LUCKY" /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Full Name</label><input value={form.d_name} onChange={e=>set('d_name',e.target.value)} placeholder="e.g. Lucky Nkosi" /></div>
                <div className="form-group"><label>Cell Number</label><input value={form.d_cell} onChange={e=>set('d_cell',e.target.value)} placeholder="082 555 0101" /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Driver Type</label>
                  <select value={form.d_type||'Interland'} onChange={e=>set('d_type',e.target.value)}>
                    <option value="Interland">Interland</option><option value="TRILLIUM">Trillium</option><option value="Subcontractor">Subcontractor</option>
                  </select>
                </div>
                <div className="form-group"><label>Business Unit</label>
                  <select value={form.d_bus_unit} onChange={e=>set('d_bus_unit',e.target.value)}>
                    <option value="IDC">IDC</option><option value="IDM">IDM</option><option value="MOGWASE">Mogwase</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>PDP Expiry Date</label><input type="date" value={form.d_pdp_expiry} onChange={e=>set('d_pdp_expiry',e.target.value)} /></div>
                <div className="form-group"><label>Start Date</label><input type="date" value={form.d_start_date} onChange={e=>set('d_start_date',e.target.value)} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Training Date</label><input type="date" value={form.d_training_date} onChange={e=>set('d_training_date',e.target.value)} /></div>
                <div className="form-group"><label>Has Receipt</label>
                  <select value={form.d_receipt} onChange={e=>set('d_receipt',e.target.value)}>
                    <option value="Y">Yes</option><option value="N">No</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Active</label>
                  <select value={form.d_active} onChange={e=>set('d_active',e.target.value)}>
                    <option value="Y">Yes</option><option value="N">No</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':editId?'Update Driver':'Add Driver'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
