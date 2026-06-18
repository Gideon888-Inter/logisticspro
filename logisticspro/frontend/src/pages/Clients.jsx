import { useState, useEffect } from 'react';
import { api } from '../lib/api';

const EMPTY = { c_code:'', c_name:'', c_send_pod:'Y', c_send_invoice:'Y', c_active:'Y' };

function exportCSV(data) {
  const headers = ['Code','Name','Send POD','Send Invoice','Active'];
  const rows = data.map(c=>[c.c_code,c.c_name,c.c_send_pod==='Y'?'YES':'NO',c.c_send_invoice==='Y'?'YES':'NO',c.c_active==='Y'?'Active':'Inactive']);
  const csv=[headers,...rows].map(r=>r.map(x=>`"${x}"`).join(',')).join('\n');
  const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='clients_export.csv';a.click();
}

export default function Clients() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('Y');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);

  const load = async () => {
    setLoading(true);
    try { setData(await api.getCustomers()); } catch(e){console.error(e);}
    finally { setLoading(false); }
  };
  useEffect(()=>{ load(); },[]);

  const filtered = data.filter(c=>{
    const s=search.toLowerCase();
    return (!s||c.c_code?.toLowerCase().includes(s)||c.c_name?.toLowerCase().includes(s))
      && (!activeFilter || c.c_active === activeFilter);
  });

  const openAdd = ()=>{setForm(EMPTY);setEditId(null);setShowModal(true);};
  const openEdit = (c)=>{setForm({...EMPTY,...c});setEditId(c.c_code);setShowModal(true);};
  const set = (k,v)=>setForm(f=>({...f,[k]:v}));

  const save = async ()=>{
    if(!form.c_code.trim()||!form.c_name.trim()) return alert('Code and Name are required');
    setSaving(true);
    try {
      // FIX: replaced raw fetch with api.updateCustomer
      if(editId) await api.updateCustomer(editId, form);
      else await api.createCustomer(form);
      setShowModal(false); load();
    } catch(e){alert(e.message);}
    finally{setSaving(false);}
  };

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Total Clients</div><div className="stat-value">{data.length}</div></div>
        <div className="stat-card"><div className="stat-label">Active</div><div className="stat-value" style={{color:'#00AEEF'}}>{data.filter(c=>c.c_active==='Y').length}</div></div>
        <div className="stat-card"><div className="stat-label">Send POD</div><div className="stat-value" style={{color:'#00AEEF'}}>{data.filter(c=>c.c_send_pod==='Y').length}</div></div>
        <div className="stat-card"><div className="stat-label">Send Invoice</div><div className="stat-value" style={{color:'#00AEEF'}}>{data.filter(c=>c.c_send_invoice==='Y').length}</div></div>
      </div>

      <div className="filter-bar">
        <input placeholder="Search client code or name…" value={search} onChange={e=>setSearch(e.target.value)} />
        <select value={activeFilter} onChange={e=>setActiveFilter(e.target.value)}>
          <option value="">All</option>
          <option value="Y">Active</option>
          <option value="N">Inactive</option>
        </select>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Client</button>
        <button className="btn btn-sm" onClick={()=>exportCSV(filtered)}>⬇ Export CSV</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Client Name</th><th>Send POD</th><th>Send Invoice</th><th>Active</th></tr></thead>
          <tbody>
            {loading&&<tr><td colSpan={5}><div className="loading">Loading clients…</div></td></tr>}
            {!loading&&filtered.length===0&&<tr><td colSpan={5}><div className="empty-state">No clients found</div></td></tr>}
            {!loading&&filtered.map(c=>(
              <tr key={c.c_code} onClick={()=>openEdit(c)}>
                <td className="mono" style={{fontWeight:600}}>{c.c_code}</td>
                <td>{c.c_name}</td>
                <td><span className={`badge ${c.c_send_pod==='Y'?'badge-green':'badge-gray'}`}>{c.c_send_pod==='Y'?'YES':'NO'}</span></td>
                <td><span className={`badge ${c.c_send_invoice==='Y'?'badge-green':'badge-gray'}`}>{c.c_send_invoice==='Y'?'YES':'NO'}</span></td>
                <td><span className={`badge ${c.c_active==='Y'?'badge-green':'badge-red'}`}>{c.c_active==='Y'?'Active':'Inactive'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal&&(
        <div className="modal-overlay" onClick={()=>setShowModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editId?'Edit Client — '+editId:'Add New Client'}</h3>
              <button onClick={()=>setShowModal(false)} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label>Client Code *</label><input value={form.c_code} onChange={e=>set('c_code',e.target.value.toUpperCase())} disabled={!!editId} placeholder="e.g. CBL001" /></div>
                <div className="form-group"><label>Client Name *</label><input value={form.c_name} onChange={e=>set('c_name',e.target.value)} placeholder="e.g. Cargo Barn Logistics" /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Send POD</label>
                  <select value={form.c_send_pod} onChange={e=>set('c_send_pod',e.target.value)}>
                    <option value="Y">Yes</option><option value="N">No</option>
                  </select>
                </div>
                <div className="form-group"><label>Send Invoice</label>
                  <select value={form.c_send_invoice} onChange={e=>set('c_send_invoice',e.target.value)}>
                    <option value="Y">Yes</option><option value="N">No</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Active</label>
                  <select value={form.c_active} onChange={e=>set('c_active',e.target.value)}>
                    <option value="Y">Yes</option><option value="N">No</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':editId?'Update Client':'Add Client'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
