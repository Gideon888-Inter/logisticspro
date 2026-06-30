import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { loadGoogleMaps, resetGoogleMapsLoader } from '../lib/googleMaps';

const EMPTY = { c_code:'', c_name:'', c_send_pod:'Y', c_send_invoice:'Y', c_active:'Y' };
const EMPTY_ADDRESS = { a_name:'', a_address:'', a_latitude:null, a_longitude:null, a_radius_km:2, a_type:'CLIENT', a_client_code:'' };

const ADDRESS_TYPES = [
  { value: 'CLIENT',    label: 'Client Site' },
  { value: 'HOME_BASE', label: 'Home Base' },
  { value: 'DEPOT',     label: 'Depot' },
  { value: 'OTHER',     label: 'Other' },
];

function exportCSV(data) {
  const headers = ['Code','Name','Send POD','Send Invoice','Active'];
  const rows = data.map(c=>[c.c_code,c.c_name,c.c_send_pod==='Y'?'YES':'NO',c.c_send_invoice==='Y'?'YES':'NO',c.c_active==='Y'?'Active':'Inactive']);
  const csv=[headers,...rows].map(r=>r.map(x=>`"${x}"`).join(',')).join('\n');
  const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='clients_export.csv';a.click();
}

const tabStyle = (active) => ({
  padding: '8px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
  borderBottom: active ? '2px solid #005A8E' : '2px solid transparent',
  color: active ? '#005A8E' : '#666',
  whiteSpace: 'nowrap',
});

// ── Address location picker — same map/search/pin pattern used on Loads,
// but also reports lat/lng (Loads' MapPicker only reports the address
// string, which isn't enough here since the Fleet dashboard needs real
// coordinates to match against vehicle GPS positions). ──────────────────
function AddressPicker({ value, onChange, onClose }) {
  const mapRef = useRef(null);
  const inputRef = useRef(null);
  const [address, setAddress] = useState(value?.a_address || '');
  const [coords, setCoords] = useState(
    value?.a_latitude != null ? { lat: Number(value.a_latitude), lng: Number(value.a_longitude) } : null
  );
  const [mapError, setMapError] = useState(null);
  const [retryKey, setRetryKey] = useState(0);

  const updateLocation = (newAddr, latLng) => {
    setAddress(newAddr);
    if (inputRef.current) inputRef.current.value = newAddr;
    if (latLng) setCoords({ lat: latLng.lat(), lng: latLng.lng() });
  };

  useEffect(() => {
    setMapError(null);
    loadGoogleMaps((err) => {
      if (err) { setMapError(err); return; }
      try {
        const defaultPos = coords || { lat: -26.2041, lng: 28.0473 }; // Johannesburg
        const m = new window.google.maps.Map(mapRef.current, {
          center: defaultPos, zoom: coords ? 14 : 10,
          mapTypeControl: false, streetViewControl: false,
        });
        const mk = new window.google.maps.Marker({ map: m, draggable: true, position: coords || undefined });

        const autocomplete = new window.google.maps.places.Autocomplete(
          inputRef.current,
          { componentRestrictions: { country: 'za' } }
        );
        autocomplete.bindTo('bounds', m);
        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          if (!place.geometry) return;
          m.setCenter(place.geometry.location);
          m.setZoom(15);
          mk.setPosition(place.geometry.location);
          updateLocation(place.formatted_address || inputRef.current.value, place.geometry.location);
        });

        m.addListener('click', (e) => {
          mk.setPosition(e.latLng);
          const geocoder = new window.google.maps.Geocoder();
          geocoder.geocode({ location: e.latLng }, (results, status) => {
            updateLocation(status === 'OK' && results[0] ? results[0].formatted_address : address, e.latLng);
          });
        });

        mk.addListener('dragend', (e) => {
          const geocoder = new window.google.maps.Geocoder();
          geocoder.geocode({ location: e.latLng }, (results, status) => {
            updateLocation(status === 'OK' && results[0] ? results[0].formatted_address : address, e.latLng);
          });
        });

        if (!coords && value?.a_address) {
          const geocoder = new window.google.maps.Geocoder();
          geocoder.geocode({ address: value.a_address + ', South Africa' }, (results, status) => {
            if (status === 'OK' && results[0]) {
              m.setCenter(results[0].geometry.location);
              m.setZoom(14);
              mk.setPosition(results[0].geometry.location);
              updateLocation(results[0].formatted_address, results[0].geometry.location);
            }
          });
        }
      } catch (e) {
        console.error('Address picker init error:', e);
        setMapError(`Map picker failed to start (${e.message}). You can still type the address below, but you'll need to drop a pin for coordinates.`);
      }
    });
  }, [retryKey]);

  const retry = () => { resetGoogleMapsLoader(); setRetryKey(k => k + 1); };

  const confirm = () => {
    if (!coords) return alert('Please search for an address or click on the map to drop a pin — coordinates are required.');
    onChange({ address, lat: coords.lat, lng: coords.lng });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 'min(680px, 95vw)', maxHeight: '90vh' }}>
        <div className="modal-header">
          <h3>📍 Pin Location</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        <div className="modal-body" style={{ padding: 0 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee' }}>
            <input ref={inputRef} defaultValue={address} placeholder="Search for an address…"
              onChange={(e) => setAddress(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>
          {mapError ? (
            <div style={{ padding: '20px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
              <div style={{ fontSize: 13, color: '#c05621', fontWeight: 600, marginBottom: 4 }}>Map unavailable</div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 12, maxWidth: 440, marginLeft: 'auto', marginRight: 'auto' }}>{mapError}</div>
              <button onClick={retry} style={{ fontSize: 12, padding: '6px 14px', border: '1px solid #ddd', borderRadius: 6, background: 'white', cursor: 'pointer', color: '#555' }}>↻ Retry</button>
            </div>
          ) : (
            <div ref={mapRef} style={{ width: '100%', height: 380 }} />
          )}
          {address && (
            <div style={{ padding: '10px 16px', background: '#f0fdf4', borderTop: '1px solid #86efac', fontSize: 13, color: '#059669' }}>
              📍 <strong>Selected:</strong> {address}
              {coords && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}</div>}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={confirm} disabled={!address || !coords}>✓ Confirm Location</button>
        </div>
      </div>
    </div>
  );
}

// ── ADDRESSES TAB ─────────────────────────────────────────────
function AddressesTab() {
  const [data, setData] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [form, setForm] = useState(EMPTY_ADDRESS);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [addr, cl] = await Promise.all([
        api.getAddresses({ active: 'all' }),
        api.getCustomers(),
      ]);
      setData(Array.isArray(addr) ? addr : []);
      setClients(Array.isArray(cl) ? cl : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const filtered = data.filter(a => !typeFilter || a.a_type === typeFilter);

  const openAdd = () => { setForm(EMPTY_ADDRESS); setEditId(null); setShowModal(true); };
  const openEdit = (a) => {
    setForm({
      a_name: a.a_name, a_address: a.a_address || '',
      a_latitude: a.a_latitude, a_longitude: a.a_longitude,
      a_radius_km: a.a_radius_km, a_type: a.a_type, a_client_code: a.a_client_code || '',
    });
    setEditId(a.address_id);
    setShowModal(true);
  };
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const onLocationPicked = ({ address, lat, lng }) => {
    setForm(f => ({ ...f, a_address: address, a_latitude: lat, a_longitude: lng }));
    setShowPicker(false);
  };

  const save = async () => {
    if (!form.a_name.trim()) return alert('Name is required');
    if (form.a_latitude == null || form.a_longitude == null) return alert('Please pick a location on the map');
    setSaving(true);
    try {
      const payload = { ...form, a_client_code: form.a_client_code || null };
      if (editId) await api.updateAddress(editId, payload);
      else await api.createAddress(payload);
      setShowModal(false);
      load();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const deactivate = async (a) => {
    if (!window.confirm(`Deactivate "${a.a_name}"? It will stop matching on the Fleet dashboard.`)) return;
    try { await api.deactivateAddress(a.address_id); load(); } catch (e) { alert(e.message); }
  };

  const clientName = (code) => clients.find(c => c.c_code === code)?.c_name || code;

  return (
    <div>
      <div className="filter-bar">
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          {ADDRESS_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Address</button>
      </div>

      <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
        Named locations used to label a vehicle's live position on the Fleet dashboard (instead of a raw GPS address) and to power the Home Base filter there. "Home Base" type addresses appear in that filter.
      </div>

      <div className="mobile-card-list">
        {loading && <div className="loading">Loading addresses…</div>}
        {!loading && filtered.length === 0 && <div className="empty-state">No addresses found</div>}
        {!loading && filtered.map(a => (
          <div key={a.address_id} className="data-card" onClick={() => openEdit(a)}>
            <div className="data-card-header">
              <div>
                <div className="data-card-title">{a.a_name}</div>
                <div className="data-card-sub">{a.a_address || '—'}</div>
              </div>
              <span className={`badge ${a.a_type === 'HOME_BASE' ? 'badge-purple' : 'badge-gray'}`}>{ADDRESS_TYPES.find(t => t.value === a.a_type)?.label || a.a_type}</span>
            </div>
            <div className="data-card-meta">
              <div>Radius: <strong>{a.a_radius_km} km</strong></div>
              <div>Linked client: <strong>{a.a_client_code ? clientName(a.a_client_code) : '—'}</strong></div>
            </div>
            {a.a_active === 'N' && (
              <div style={{ marginTop: 6 }}><span className="badge badge-red">Inactive</span></div>
            )}
          </div>
        ))}
      </div>
      <div className="desktop-table">
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Address</th><th>Type</th><th>Radius</th><th>Linked Client</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7}><div className="loading">Loading addresses…</div></td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={7}><div className="empty-state">No addresses found</div></td></tr>}
            {!loading && filtered.map(a => (
              <tr key={a.address_id}>
                <td style={{ fontWeight: 600, cursor: 'pointer' }} onClick={() => openEdit(a)}>{a.a_name}</td>
                <td style={{ fontSize: 12, color: '#666' }}>{a.a_address || '—'}</td>
                <td><span className={`badge ${a.a_type === 'HOME_BASE' ? 'badge-purple' : 'badge-gray'}`}>{ADDRESS_TYPES.find(t => t.value === a.a_type)?.label || a.a_type}</span></td>
                <td className="mono">{a.a_radius_km} km</td>
                <td>{a.a_client_code ? clientName(a.a_client_code) : '—'}</td>
                <td><span className={`badge ${a.a_active === 'Y' ? 'badge-green' : 'badge-red'}`}>{a.a_active === 'Y' ? 'Active' : 'Inactive'}</span></td>
                <td>
                  <button className="btn btn-sm" onClick={() => openEdit(a)} style={{ marginRight: 4 }}>Edit</button>
                  {a.a_active === 'Y' && (
                    <button className="btn btn-sm" style={{ color: '#e53e3e', borderColor: '#fca5a5' }} onClick={() => deactivate(a)}>Deactivate</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editId ? 'Edit Address' : 'Add New Address'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label>Name *</label><input value={form.a_name} onChange={e => set('a_name', e.target.value)} placeholder="e.g. Home Base – JHB" /></div>
                <div className="form-group"><label>Type</label>
                  <select value={form.a_type} onChange={e => set('a_type', e.target.value)}>
                    {ADDRESS_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Location *</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={form.a_address} readOnly placeholder="Pick a location on the map…"
                    style={{ flex: 1, background: '#f8f9fa' }} />
                  <button type="button" className="btn btn-sm" onClick={() => setShowPicker(true)}>📍 Pin</button>
                </div>
                {form.a_latitude != null && (
                  <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{Number(form.a_latitude).toFixed(6)}, {Number(form.a_longitude).toFixed(6)}</div>
                )}
              </div>
              <div className="form-row">
                <div className="form-group"><label>Match Radius (km)</label>
                  <input type="number" step="0.5" min="0.5" value={form.a_radius_km} onChange={e => set('a_radius_km', e.target.value)} />
                </div>
                <div className="form-group"><label>Linked Client <span style={{ color: '#aaa', fontWeight: 400 }}>(optional)</span></label>
                  <select value={form.a_client_code} onChange={e => set('a_client_code', e.target.value)}>
                    <option value="">— None —</option>
                    {clients.map(c => <option key={c.c_code} value={c.c_code}>{c.c_code} — {c.c_name}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : editId ? 'Update Address' : 'Add Address'}</button>
            </div>
          </div>
        </div>
      )}

      {showPicker && (
        <AddressPicker value={{ a_address: form.a_address, a_latitude: form.a_latitude, a_longitude: form.a_longitude }}
          onChange={onLocationPicked} onClose={() => setShowPicker(false)} />
      )}
    </div>
  );
}

// ── CLIENTS TAB (unchanged behaviour, just moved under a tab) ───
function ClientsTab() {
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

      <div className="mobile-card-list">
        {loading && <div className="loading">Loading clients…</div>}
        {!loading && filtered.length === 0 && <div className="empty-state">No clients found</div>}
        {!loading && filtered.map(c => (
          <div key={c.c_code} className="data-card" onClick={() => openEdit(c)}>
            <div className="data-card-header">
              <div>
                <div className="data-card-title">{c.c_name}</div>
                <div className="data-card-sub" style={{fontFamily:'monospace'}}>{c.c_code}</div>
              </div>
              <span className={`badge ${c.c_active==='Y'?'badge-green':'badge-red'}`}>{c.c_active==='Y'?'Active':'Inactive'}</span>
            </div>
            <div className="data-card-meta">
              <div>POD: <strong>{c.c_send_pod==='Y'?'Yes':'No'}</strong></div>
              <div>Invoice: <strong>{c.c_send_invoice==='Y'?'Yes':'No'}</strong></div>
            </div>
          </div>
        ))}
      </div>
      <div className="desktop-table">
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

export default function Clients() {
  const [tab, setTab] = useState('clients');
  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid #e8edf2', marginBottom: 16, gap: 4, overflowX: 'auto' }}>
        <div style={tabStyle(tab === 'clients')} onClick={() => setTab('clients')}>Clients</div>
        <div style={tabStyle(tab === 'addresses')} onClick={() => setTab('addresses')}>📍 Addresses</div>
      </div>
      {tab === 'clients' && <ClientsTab />}
      {tab === 'addresses' && <AddressesTab />}
    </div>
  );
}
