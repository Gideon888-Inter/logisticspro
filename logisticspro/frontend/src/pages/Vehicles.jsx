import { useState, useEffect } from 'react';
import { api } from '../lib/api';

const EMPTY = { vh_code:'', vh_type:'Horse', vh_bus_unit:'IDC', vh_active:'Y', vh_year:'', vh_make:'', vh_model:'', vh_registration:'', vh_vin:'', vh_odometer:'', vh_next_service:'', vh_next_wheel:'', vh_cell:'', vh_cof_date:'', vh_license_expiry:'', vh_status:'AVAILABLE' };

function exportCSV(data) {
  const headers = ['Type','Code','Year','Make','Model','Registration','VIN','Odo','Service Due At','KM till Next Service Due','Wheel Alignment Due At','KM till Next Wheel Alignment Due','Cell Number','COF Date','License Expiry','Has Open Display License Job Card','Status'];
  const rows = data.map(v => [
    v.vh_type, v.vh_code, v.vh_year||'', v.vh_make||'', v.vh_model||'',
    v.vh_registration||'', v.vh_vin||'', v.vh_odometer||'',
    v.vh_next_service||'', '', v.vh_next_wheel||'', '',
    v.vh_cell||'', v.vh_cof_date||'', v.vh_license_expiry||'', 'NO', v.vh_status||''
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'vehicles_export.csv'; a.click();
}

const STATUS_COLORS = { 'En Route':'badge-blue', 'Available':'badge-green', 'AVAILABLE':'badge-green', 'New':'badge-gray', 'Workshop':'badge-amber', 'Inactive':'badge-red' };

export default function Vehicles() {
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
    try { const r = await api.getVehicles({ active: 'all' }); setData(Array.isArray(r)?r:[]); } catch(e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = data.filter(v => {
    const s = search.toLowerCase();
    return (!s || v.vh_code?.toLowerCase().includes(s) || v.vh_make?.toLowerCase().includes(s) || v.vh_registration?.toLowerCase().includes(s))
      && (!typeFilter || v.vh_type === typeFilter)
      && (!activeFilter || v.vh_active === activeFilter);
  });

  const openAdd = () => { setForm(EMPTY); setEditId(null); setShowModal(true); };
  const openEdit = (v) => { setForm({ ...EMPTY, ...v }); setEditId(v.vh_code); setShowModal(true); };

  const save = async () => {
    if (!form.vh_code.trim()) return alert('Vehicle code is required');
    setSaving(true);
    try {
      if (editId) await api.updateVehicle(editId, form);
      else await api.createVehicle(form);
      setShowModal(false); load();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const set = (k,v) => setForm(f => ({...f, [k]:v}));

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Total Fleet</div><div className="stat-value">{data.length}</div></div>
        <div className="stat-card"><div className="stat-label">Horses</div><div className="stat-value" style={{color:'#00AEEF'}}>{data.filter(v=>v.vh_type==='Horse').length}</div></div>
        <div className="stat-card"><div className="stat-label">Trailers</div><div className="stat-value" style={{color:'#00AEEF'}}>{data.filter(v=>v.vh_type==='Trailer').length}</div></div>
        <div className="stat-card"><div className="stat-label">Active</div><div className="stat-value" style={{color:'#00AEEF'}}>{data.filter(v=>v.vh_active==='Y').length}</div></div>
      </div>

      <div className="filter-bar">
        <input placeholder="Search code, make, registration…" value={search} onChange={e=>setSearch(e.target.value)} />
        <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          <option value="Horse">Horse</option>
          <option value="Trailer">Trailer</option>
          <option value="Rigid">Rigid</option>
        </select>
        <select value={activeFilter} onChange={e=>setActiveFilter(e.target.value)}>
          <option value="">All</option>
          <option value="Y">Active</option>
          <option value="N">Inactive</option>
        </select>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Vehicle</button>
        <button className="btn btn-sm" onClick={() => exportCSV(filtered)}>⬇ Export CSV</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>Code</th><th>Type</th><th>Year</th><th>Make / Model</th>
            <th>Registration</th><th>Odometer</th><th>Next Service</th>
            <th>COF Date</th><th>License Expiry</th><th>Status</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={10}><div className="loading">Loading vehicles…</div></td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={10}><div className="empty-state">No vehicles found</div></td></tr>}
            {!loading && filtered.map(v => (
              <tr key={v.vh_code} onClick={() => openEdit(v)}>
                <td className="mono">{v.vh_code}</td>
                <td>{v.vh_type}</td>
                <td>{v.vh_year||'—'}</td>
                <td>{[v.vh_make, v.vh_model].filter(Boolean).join(' ') || '—'}</td>
                <td className="mono">{v.vh_registration||'—'}</td>
                <td className="mono">{v.vh_odometer ? Number(v.vh_odometer).toLocaleString()+' km' : '—'}</td>
                <td className="mono">{v.vh_next_service ? Number(v.vh_next_service).toLocaleString()+' km' : '—'}</td>
                <td>{v.vh_cof_date||'—'}</td>
                <td>{v.vh_license_expiry||'—'}</td>
                <td><span className={`badge ${STATUS_COLORS[v.vh_status]||'badge-gray'}`}>{v.vh_status||'—'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{width:620}}>
            <div className="modal-header">
              <h3>{editId ? 'Edit Vehicle — '+editId : 'Add New Vehicle'}</h3>
              <button onClick={() => setShowModal(false)} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label>Vehicle Code *</label><input value={form.vh_code} onChange={e=>set('vh_code',e.target.value)} disabled={!!editId} placeholder="e.g. MH140" /></div>
                <div className="form-group"><label>Type *</label>
                  <select value={form.vh_type} onChange={e=>set('vh_type',e.target.value)}>
                    <option value="Horse">Horse</option><option value="Trailer">Trailer</option><option value="Rigid">Rigid</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Year</label><input type="number" value={form.vh_year} onChange={e=>set('vh_year',e.target.value)} placeholder="2020" /></div>
                <div className="form-group"><label>Make</label><input value={form.vh_make} onChange={e=>set('vh_make',e.target.value)} placeholder="e.g. Volvo" /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Model</label><input value={form.vh_model} onChange={e=>set('vh_model',e.target.value)} placeholder="e.g. FH440" /></div>
                <div className="form-group"><label>Registration</label><input value={form.vh_registration} onChange={e=>set('vh_registration',e.target.value)} placeholder="e.g. ABC123GP" /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>VIN Number</label><input value={form.vh_vin} onChange={e=>set('vh_vin',e.target.value)} /></div>
                <div className="form-group"><label>Cell Number</label><input value={form.vh_cell} onChange={e=>set('vh_cell',e.target.value)} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Current Odometer (km)</label><input type="number" value={form.vh_odometer} onChange={e=>set('vh_odometer',e.target.value)} /></div>
                <div className="form-group"><label>Next Service (km)</label><input type="number" value={form.vh_next_service} onChange={e=>set('vh_next_service',e.target.value)} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Next Wheel Alignment (km)</label><input type="number" value={form.vh_next_wheel} onChange={e=>set('vh_next_wheel',e.target.value)} /></div>
                <div className="form-group"><label>COF Date</label><input type="date" value={form.vh_cof_date} onChange={e=>set('vh_cof_date',e.target.value)} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>License Expiry</label><input type="date" value={form.vh_license_expiry} onChange={e=>set('vh_license_expiry',e.target.value)} /></div>
                <div className="form-group"><label>Business Unit</label>
                  <select value={form.vh_bus_unit} onChange={e=>set('vh_bus_unit',e.target.value)}>
                    <option value="IDC">IDC</option><option value="IDM">IDM</option><option value="MOGWASE">Mogwase</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Status</label>
                  <select value={form.vh_status} onChange={e=>set('vh_status',e.target.value)}>
                    <option value="AVAILABLE">Available</option><option value="En Route">En Route</option>
                    <option value="Workshop">Workshop</option><option value="Inactive">Inactive</option>
                  </select>
                </div>
                <div className="form-group"><label>Active</label>
                  <select value={form.vh_active} onChange={e=>set('vh_active',e.target.value)}>
                    <option value="Y">Yes</option><option value="N">No</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : editId ? 'Update Vehicle' : 'Add Vehicle'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
