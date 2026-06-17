import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthContext';

const API = import.meta.env.VITE_API_URL || '';
const MAPS_KEY = import.meta.env.VITE_MAPS_KEY || '';

// ── Google Maps loader (declared ONCE here — do not repeat below) ──
let mapsLoaded = false;
let mapsLoading = false;
const mapsCallbacks = [];
function loadGoogleMaps(cb) {
  if (mapsLoaded) return cb();
  mapsCallbacks.push(cb);
  if (mapsLoading) return;
  mapsLoading = true;
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&libraries=places`;
  script.async = true;
  script.onload = () => {
    mapsLoaded = true;
    mapsCallbacks.forEach(f => f());
    mapsCallbacks.length = 0;
  };
  document.head.appendChild(script);
}

const token = () => localStorage.getItem('lp_token');
const req = (path, opts = {}) =>
  fetch(API + '/api' + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token(),
      ...(opts.headers || {}),
    },
  }).then(r => r.json());

// ── Status definitions ────────────────────────────────────────
const STATUS_BADGE = {
  PRELOAD:               'badge-gray',
  EN_ROUTE:              'badge-blue',
  OFFLOADED:             'badge-green',
  WAIT_ORDER_NO:         'badge-amber',
  WAIT_APPROVAL:         'badge-amber',
  WAIT_POD_SCAN:         'badge-gray',
  WAIT_INVOICE_NO:       'badge-orange',
  LOAD_INVOICED:         'badge-green',
  WAIT_PROCESSING:       'badge-gray',
  REJECTED:              'badge-red',
  PENDING_KM_APPROVAL:   'badge-orange',
  KM_CORRECTION_NEEDED:  'badge-red',
};

// Statuses users can manually filter/view — KM system statuses are EXCLUDED
// from the workflow buttons but INCLUDED in the filter dropdown
const ALL_STATUSES = [
  'PRELOAD', 'EN_ROUTE', 'OFFLOADED',
  'WAIT_ORDER_NO', 'WAIT_APPROVAL', 'WAIT_POD_SCAN',
  'WAIT_INVOICE_NO', 'LOAD_INVOICED', 'REJECTED',
  'PENDING_KM_APPROVAL', 'KM_CORRECTION_NEEDED',
];

// The valid manual workflow sequence (no KM system statuses here)
const WORKFLOW_STEPS = [
  'PRELOAD', 'EN_ROUTE', 'OFFLOADED',
  'WAIT_ORDER_NO', 'WAIT_APPROVAL', 'WAIT_POD_SCAN',
  'WAIT_INVOICE_NO', 'LOAD_INVOICED',
];

// Who can advance each step
const STEP_ROLES = {
  PRELOAD:         ['OPERATIONS', 'MANAGER', 'ADMIN'],       // → EN_ROUTE
  EN_ROUTE:        ['OPERATOR', 'OPERATIONS', 'MANAGER', 'ADMIN'], // → OFFLOADED (via KM)
  OFFLOADED:       ['OPERATOR', 'OPERATIONS', 'MANAGER', 'ADMIN'], // → WAIT_ORDER_NO
  WAIT_ORDER_NO:   ['OPERATIONS', 'MANAGER', 'ADMIN'],       // → WAIT_APPROVAL
  WAIT_APPROVAL:   ['MANAGER', 'ADMIN'],                     // → WAIT_POD_SCAN
  WAIT_POD_SCAN:   [],                                       // system only
  WAIT_INVOICE_NO: ['ACCOUNTING', 'MANAGER', 'ADMIN'],       // → LOAD_INVOICED
};

const COST_TYPES = ['Loadshift', 'Fine', 'Labour', 'Extra Stop', 'Other'];

function fmtDate(d) {
  return d
    ? new Date(d).toLocaleDateString('en-ZA', {
        day: '2-digit', month: 'short', year: 'numeric',
      })
    : '—';
}

function fmtDateTime(d) {
  return d
    ? new Date(d).toLocaleString('en-ZA', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '—';
}

function fmtR(n) {
  return n || n === 0
    ? 'R ' + Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 0 })
    : '—';
}

// ── Export CSV helper ─────────────────────────────────────────
async function exportAllLoadsCSV(dateFrom, dateTo, status, search) {
  const tkn = localStorage.getItem('lp_token');
  const BASE = import.meta.env.VITE_API_URL || '';
  let allLoads = [];
  let currentPage = 1;
  let hasMore = true;
  const batchSize = 1000;

  while (hasMore) {
    const params = new URLSearchParams({ limit: batchSize, page: currentPage });
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo)   params.append('date_to', dateTo);
    if (status)   params.append('status', status);
    if (search)   params.append('search', search);

    const res = await fetch(`${BASE}/api/loads?${params}`, {
      headers: { 'Authorization': 'Bearer ' + tkn },
    });
    const json = await res.json();
    const batch = json.data || [];
    allLoads = allLoads.concat(batch);
    hasMore = batch.length === batchSize;
    currentPage++;
  }

  const headers = [
    'Load Number', 'Load Date', 'Client', 'Truck', 'Driver',
    'From', 'To', 'Rate', 'Status', 'Opening KM', 'Closing KM',
    'Trailer 1', 'Operator', 'Invoice No', 'Order No',
  ];
  const rows = allLoads.map(l => [
    l.m_load_no || '', l.m_date || '', l.m_customer || '',
    l.m_truck || '', l.m_driver_id || '', l.m_from || '', l.m_to || '',
    l.m_rate || 0, l.m_status || '',
    l.m_opening_km || 0, l.m_closing_km || 0,
    l.m_trailer1 || '', l.m_responsible_operator || '',
    l.m_invoice || '', l.m_order_no || '',
  ]);

  const csv = [headers, ...rows]
    .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `loads_export_${dateFrom || 'all'}_to_${dateTo || 'today'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Map Location Picker ───────────────────────────────────────
// FIX: onChange is now called immediately when address changes,
//      not only on "Confirm". All state goes through React, not
//      direct DOM mutation.
function MapPicker({ label, value, onChange, onClose }) {
  const mapRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const [address, setAddress] = React.useState(value || '');

  const updateAddress = (newAddr) => {
    setAddress(newAddr);
    // Update the input display
    if (inputRef.current) inputRef.current.value = newAddr;
  };

  React.useEffect(() => {
    loadGoogleMaps(() => {
      const defaultPos = { lat: -26.2041, lng: 28.0473 }; // Johannesburg
      const m = new window.google.maps.Map(mapRef.current, {
        center: defaultPos, zoom: 10,
        mapTypeControl: false, streetViewControl: false,
      });
      const mk = new window.google.maps.Marker({ map: m, draggable: true });

      // Autocomplete search box
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
        // FIX: Use the formatted address from the place result
        const addr = place.formatted_address || inputRef.current.value;
        updateAddress(addr);
      });

      // Click on map to pin
      m.addListener('click', (e) => {
        mk.setPosition(e.latLng);
        const geocoder = new window.google.maps.Geocoder();
        geocoder.geocode({ location: e.latLng }, (results, status) => {
          if (status === 'OK' && results[0]) {
            updateAddress(results[0].formatted_address);
          }
        });
      });

      // Drag the marker
      mk.addListener('dragend', (e) => {
        const geocoder = new window.google.maps.Geocoder();
        geocoder.geocode({ location: e.latLng }, (results, status) => {
          if (status === 'OK' && results[0]) {
            updateAddress(results[0].formatted_address);
          }
        });
      });

      // If a value was passed in, show it on the map
      if (value) {
        const geocoder = new window.google.maps.Geocoder();
        geocoder.geocode({ address: value + ', South Africa' }, (results, status) => {
          if (status === 'OK' && results[0]) {
            m.setCenter(results[0].geometry.location);
            m.setZoom(14);
            mk.setPosition(results[0].geometry.location);
          }
        });
      }
    });
  }, []);

  // FIX: Confirm passes the current address state (not DOM value) to parent
  const confirm = () => {
    onChange(address);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 680, maxHeight: '90vh' }}>
        <div className="modal-header">
          <h3>📍 Pin {label}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        <div className="modal-body" style={{ padding: 0 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee' }}>
            <input
              ref={inputRef}
              defaultValue={value}
              placeholder="Search for an address…"
              style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
          <div ref={mapRef} style={{ width: '100%', height: 380 }} />
          {address && (
            <div style={{ padding: '10px 16px', background: '#f0fdf4', borderTop: '1px solid #86efac', fontSize: 13, color: '#059669' }}>
              📍 <strong>Selected:</strong> {address}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={confirm} disabled={!address}>✓ Confirm Location</button>
        </div>
      </div>
    </div>
  );
}

// ── New Load Modal ────────────────────────────────────────────
function NewLoadModal({ onClose, onCreated }) {
  const { user } = useAuth();
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [clients, setClients] = useState([]);
  const [rates, setRates] = useState([]);
  const [operators, setOperators] = useState([]);
  const [form, setForm] = useState({
    m_truck: '', m_driver_id: '', m_customer: '',
    m_trailer_size: 'None', m_trailer1: '', m_trailer2: '',
    m_from: '', m_to: '', m_rate: 0,
    m_bus_unit: user?.bus_unit || 'IDC',
    m_opening_km: '', m_responsible_operator: '',
    m_loading_address: '', m_offloading_address: '',
  });
  const [saving, setSaving] = useState(false);
  const [lastClosingKm, setLastClosingKm] = useState(null);
  const [mapPicker, setMapPicker] = useState(null);
  const [kmValidation, setKmValidation] = useState(null);

  useEffect(() => {
    Promise.all([
      api.getVehicles({ active: 'Y' }),
      api.getDrivers({ active: 'Y' }),
      api.getCustomers(),
      req('/rates/client-rates'),
      req('/users').catch(() => []),
    ]).then(([v, d, c, r, u]) => {
      setVehicles(Array.isArray(v) ? v : []);
      setDrivers(Array.isArray(d) ? d : []);
      setClients(Array.isArray(c) ? c : []);
      setRates(Array.isArray(r) ? r : []);
      setOperators(Array.isArray(u) ? u.filter(usr => usr.u_role === 'OPERATOR' || usr.u_role === 'MANAGER') : []);
    }).catch(console.error);
  }, []);

  const horses = vehicles.filter(v => v.vh_type === 'Horse');
  const trailers = vehicles.filter(v => v.vh_type === 'Trailer');
  const clientRates = rates.filter(r => r.rc_client_code === form.m_customer);
  const fromOptions = [...new Set(clientRates.map(r => r.rc_from))].sort();
  const toOptions = [...new Set(clientRates.filter(r => r.rc_from === form.m_from).map(r => r.rc_to))].sort();

  const fetchLastKm = async (truck) => {
    if (!truck) return;
    try {
      const res = await req(`/km/last-closing/${encodeURIComponent(truck)}`);
      setLastClosingKm(res.last_closing_km || 0);
      setForm(f => ({ ...f, m_opening_km: res.last_closing_km || '' }));
    } catch (e) { console.error(e); }
  };

  const validateOpeningKm = async (truck, opening_km) => {
    if (!truck || !opening_km) return;
    try {
      const res = await req('/km/validate-opening', {
        method: 'POST',
        body: JSON.stringify({ truck, opening_km: Number(opening_km) }),
      });
      setKmValidation(res);
    } catch (e) { console.error(e); }
  };

  const set = (k, v) => {
    setForm(f => {
      const next = { ...f, [k]: v };
      if (k === 'm_customer') { next.m_from = ''; next.m_to = ''; next.m_rate = 0; }
      if (k === 'm_truck') fetchLastKm(v);
      if (k === 'm_from') { next.m_to = ''; next.m_rate = 0; }
      if (k === 'm_to') {
        const matched = rates.find(r => r.rc_client_code === next.m_customer && r.rc_from === next.m_from && r.rc_to === v);
        if (matched) {
          next.m_rate = next.m_trailer_size === '18m'
            ? (matched.rc_rate_18m || 0)
            : (matched.rc_rate_15m || matched.rc_rate_18m || 0);
        }
      }
      if (k === 'm_trailer_size') {
        const matched = rates.find(r => r.rc_client_code === next.m_customer && r.rc_from === next.m_from && r.rc_to === next.m_to);
        if (matched) next.m_rate = v === '18m' ? (matched.rc_rate_18m || 0) : (matched.rc_rate_15m || matched.rc_rate_18m || 0);
        if (v === 'None') { next.m_trailer1 = ''; next.m_trailer2 = ''; }
        if (v === '15m') next.m_trailer2 = '';
      }
      return next;
    });
  };

  const save = async () => {
    if (!form.m_truck) return alert('Please select a truck');
    if (!form.m_customer) return alert('Please select a customer');
    if (form.m_trailer_size === '18m' && !form.m_trailer2) return alert('Please select a second trailer for 18m loads');
    if (kmValidation && !kmValidation.valid) return alert(kmValidation.error);
    setSaving(true);
    try {
      const status = kmValidation?.anomaly ? 'PENDING_KM_APPROVAL' : 'PRELOAD';
      const payload = {
        ...form,
        m_opening_km: Number(form.m_opening_km) || 0,
        m_operator: user?.username,
        m_status: status,
      };
      const newLoad = await api.createLoad(payload);

      if (kmValidation?.anomaly && newLoad?.m_load_no) {
        await req('/km/anomalies', {
          method: 'POST',
          body: JSON.stringify({
            a_load_no:     newLoad.m_load_no,
            a_truck:       form.m_truck,
            a_type:        'DEAD_KM',
            a_description: `Dead KM of ${kmValidation.dead_km.toLocaleString()} km exceeds ${kmValidation.anomaly_threshold} km threshold`,
            a_dead_km:     kmValidation.dead_km,
            a_last_closing: kmValidation.last_closing_km,
            a_new_opening: Number(form.m_opening_km),
            a_operator:    user?.username,
          }),
        }).catch(console.error);

        await req('/km/notifications', {
          method: 'POST',
          body: JSON.stringify({
            n_role:    'OPERATIONS',
            n_type:    'KM_ANOMALY',
            n_title:   'KM Anomaly Requires Approval',
            n_message: `Load ${newLoad.m_load_no} has dead KM of ${kmValidation.dead_km.toLocaleString()} km for truck ${form.m_truck}`,
            n_load_no: newLoad.m_load_no,
          }),
        }).catch(console.error);
      }

      onCreated();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const inputStyle = { width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit' };
  const labelStyle = { fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500, display: 'block', marginBottom: 4 };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 620 }}>
        <div className="modal-header">
          <h3>New Load</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="form-group">
              <label style={labelStyle}>Truck *</label>
              <select value={form.m_truck} onChange={e => set('m_truck', e.target.value)} style={inputStyle}>
                <option value="">— Select truck —</option>
                {horses.map(v => <option key={v.vh_code} value={v.vh_code}>{v.vh_code} — {v.vh_make} {v.vh_model}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label style={labelStyle}>Driver *</label>
              <select value={form.m_driver_id} onChange={e => set('m_driver_id', e.target.value)} style={inputStyle}>
                <option value="">— Select driver —</option>
                {drivers.map(d => <option key={d.d_id} value={d.d_nickname}>{d.d_nickname}{d.d_name ? ' — ' + d.d_name : ''}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label style={labelStyle}>Trailer Size</label>
              <select value={form.m_trailer_size} onChange={e => set('m_trailer_size', e.target.value)} style={inputStyle}>
                <option value="None">None</option>
                <option value="15m">15m</option>
                <option value="18m">18m</option>
              </select>
            </div>
            <div className="form-group">
              <label style={labelStyle}>Trailer {form.m_trailer_size === 'None' ? '(not required)' : '*'}</label>
              <select value={form.m_trailer1} onChange={e => set('m_trailer1', e.target.value)} style={inputStyle} disabled={form.m_trailer_size === 'None'}>
                <option value="">— Select trailer —</option>
                {trailers.map(v => <option key={v.vh_code} value={v.vh_code}>{v.vh_code} — {v.vh_make} {v.vh_model}</option>)}
              </select>
            </div>
          </div>
          {/* Second trailer — only for 18m */}
          {form.m_trailer_size === '18m' && (
          <div className="form-row">
            <div className="form-group" />
            <div className="form-group">
              <label style={labelStyle}>Trailer 2 * <span style={{ color: '#00AEEF', fontWeight: 400, textTransform: 'none' }}>(18m requires 2 trailers)</span></label>
              <select value={form.m_trailer2} onChange={e => set('m_trailer2', e.target.value)} style={inputStyle}>
                <option value="">— Select second trailer —</option>
                {trailers.filter(v => v.vh_code !== form.m_trailer1).map(v => <option key={v.vh_code} value={v.vh_code}>{v.vh_code} — {v.vh_make} {v.vh_model}</option>)}
              </select>
            </div>
          </div>
          )}
          <div className="form-row">
            <div className="form-group">
              <label style={labelStyle}>Responsible Operator</label>
              <select value={form.m_responsible_operator} onChange={e => set('m_responsible_operator', e.target.value)} style={inputStyle}>
                <option value="">— Select operator —</option>
                {operators.map(o => <option key={o.u_id} value={o.u_username}>{o.u_name || o.u_username}{o.u_region ? ' (' + o.u_region + ')' : ''}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label style={labelStyle}>Business Unit</label>
              <select value={form.m_bus_unit} onChange={e => set('m_bus_unit', e.target.value)} style={inputStyle}>
                <option value="IDC">IDC</option><option value="IDM">IDM</option><option value="MOGWASE">Mogwase</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label style={labelStyle}>Customer *</label>
              <select value={form.m_customer} onChange={e => set('m_customer', e.target.value)} style={inputStyle}>
                <option value="">— Select customer —</option>
                {clients.map(c => <option key={c.c_code} value={c.c_code}>{c.c_code} — {c.c_name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label style={labelStyle}>From {!form.m_customer && <span style={{ color: '#aaa' }}>(select customer first)</span>}</label>
              <select value={form.m_from} onChange={e => set('m_from', e.target.value)} style={inputStyle} disabled={!form.m_customer}>
                <option value="">— Select origin —</option>
                {fromOptions.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label style={labelStyle}>To {!form.m_from && <span style={{ color: '#aaa' }}>(select origin first)</span>}</label>
              <select value={form.m_to} onChange={e => set('m_to', e.target.value)} style={inputStyle} disabled={!form.m_from}>
                <option value="">— Select destination —</option>
                {toOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label style={labelStyle}>Rate (auto from rate card)</label>
              <input value={form.m_rate ? 'R ' + Number(form.m_rate).toLocaleString('en-ZA') : '—'} readOnly
                style={{ ...inputStyle, background: '#f8f9fa', color: form.m_rate ? '#005A8E' : '#aaa', fontWeight: 600 }} />
            </div>
          </div>
          {/* Loading & Offloading Addresses */}
          <div className="form-row">
            <div className="form-group">
              <label style={labelStyle}>Loading Address</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={form.m_loading_address} onChange={e => set('m_loading_address', e.target.value)}
                  placeholder="Type or pin on map…" style={{ ...inputStyle, flex: 1 }} />
                <button type="button" onClick={() => setMapPicker('loading')} title="Pin on map"
                  style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 4, background: 'white', cursor: 'pointer', fontSize: 16 }}>📍</button>
              </div>
            </div>
            <div className="form-group">
              <label style={labelStyle}>Offloading Address</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={form.m_offloading_address} onChange={e => set('m_offloading_address', e.target.value)}
                  placeholder="Type or pin on map…" style={{ ...inputStyle, flex: 1 }} />
                <button type="button" onClick={() => setMapPicker('offloading')} title="Pin on map"
                  style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 4, background: 'white', cursor: 'pointer', fontSize: 16 }}>📍</button>
              </div>
            </div>
          </div>
          {/* Opening KM */}
          <div className="form-row">
            <div className="form-group">
              <label style={labelStyle}>
                Opening KM
                {lastClosingKm !== null && <span style={{ color: '#888', fontWeight: 400, textTransform: 'none' }}> (last closing: {Number(lastClosingKm).toLocaleString()} km)</span>}
              </label>
              <input type="number" value={form.m_opening_km}
                onChange={e => { set('m_opening_km', e.target.value); if (form.m_truck) validateOpeningKm(form.m_truck, e.target.value); }}
                placeholder={lastClosingKm !== null ? String(lastClosingKm) : 'Enter opening odometer reading'}
                style={{ ...inputStyle, borderColor: kmValidation && !kmValidation.valid ? '#e53e3e' : kmValidation?.anomaly ? '#f59e0b' : undefined }}
              />
              {kmValidation && !kmValidation.valid && <div style={{ color: '#e53e3e', fontSize: 12, marginTop: 4 }}>⚠ {kmValidation.error}</div>}
              {kmValidation?.anomaly && kmValidation.valid && (
                <div style={{ color: '#d97706', fontSize: 12, marginTop: 4, background: '#fef3c7', padding: '6px 8px', borderRadius: 4 }}>
                  ⚠ Dead KM: {Number(kmValidation.dead_km).toLocaleString()} km — this load will require Operations approval
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create Load'}</button>
        </div>
      </div>
      {mapPicker === 'loading' && (
        <MapPicker label="Loading Address" value={form.m_loading_address}
          onChange={addr => set('m_loading_address', addr)} onClose={() => setMapPicker(null)} />
      )}
      {mapPicker === 'offloading' && (
        <MapPicker label="Offloading Address" value={form.m_offloading_address}
          onChange={addr => set('m_offloading_address', addr)} onClose={() => setMapPicker(null)} />
      )}
    </div>
  );
}

// ── Add Cost Modal ────────────────────────────────────────────
function AddCostModal({ loadId, onClose, onSaved }) {
  const { user } = useAuth();
  const [form, setForm] = useState({ c_code: 'Loadshift', c_description: '', c_amount: '' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.c_amount || isNaN(Number(form.c_amount))) return alert('Please enter a valid amount');
    if (form.c_code === 'Other' && !form.c_description.trim()) return alert('Please enter a reason for Other cost');
    setSaving(true);
    try {
      await req('/costs', {
        method: 'POST',
        body: JSON.stringify({
          c_load: loadId,
          c_code: form.c_code,
          c_description: form.c_code === 'Other' ? form.c_description : form.c_code,
          c_amount: Number(form.c_amount),
          c_operator: user?.username,
        }),
      });
      onSaved();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 420 }}>
        <div className="modal-header">
          <h3>Add Cost — {loadId}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Cost Type *</label>
            <select value={form.c_code} onChange={e => set('c_code', e.target.value)}
              style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit' }}>
              {COST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {form.c_code === 'Other' && (
            <div className="form-group">
              <label>Reason *</label>
              <input value={form.c_description} onChange={e => set('c_description', e.target.value)}
                placeholder="Describe the cost reason…"
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit' }} />
            </div>
          )}
          <div className="form-group">
            <label>Amount (R) *</label>
            <input type="number" value={form.c_amount} onChange={e => set('c_amount', e.target.value)}
              placeholder="0.00"
              style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit' }} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add Cost'}</button>
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
  const [deleteReason, setDeleteReason] = useState('');
  const [deletingCost, setDeletingCost] = useState(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [orderNoEdit, setOrderNoEdit] = useState(false);
  const [orderNoVal, setOrderNoVal] = useState(load.m_order_no || '');
  const [orderNoSaving, setOrderNoSaving] = useState(false);
  const [orderNoMsg, setOrderNoMsg] = useState('');
  const [showClosingKm, setShowClosingKm] = useState(false);
  const [closingKm, setClosingKm] = useState('');
  const [kmError, setKmError] = useState('');
  const [kmSaving, setKmSaving] = useState(false);
  const [kmMaxAllowed, setKmMaxAllowed] = useState(0);
  const [statusSaving, setStatusSaving] = useState(false);

  const loadDetails = async () => {
    try {
      const [c, co] = await Promise.all([
        api.getComments(load.m_load_no),
        req(`/costs?load=${encodeURIComponent(load.m_load_no)}`).catch(() => []),
      ]);
      setComments(Array.isArray(c) ? c : []);
      const costsArr = Array.isArray(co) ? co : [];
      setCosts(costsArr);
      const extraTotal = costsArr.reduce((s, c) => s + Number(c.c_amount || 0), 0);
      if (onCostUpdate) onCostUpdate(load.m_load_no, extraTotal);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { loadDetails(); }, [load.m_load_no]);

  // Pre-fetch route KM for closing KM max calculation
  useEffect(() => {
    if (load.m_from && load.m_to && load.m_customer) {
      req(`/rates/client-rates?client_code=${load.m_customer}`)
        .then(rates => {
          const match = rates.find(r => r.rc_from === load.m_from && r.rc_to === load.m_to);
          if (match?.rc_kms) setKmMaxAllowed(Number(load.m_opening_km || 0) + match.rc_kms + 500);
        }).catch(() => {});
    }
  }, []);

  const sendComment = async () => {
    if (!newComment.trim()) return;
    try { await api.addComment(load.m_load_no, newComment); setNewComment(''); loadDetails(); }
    catch (e) { alert(e.message); }
  };

  const saveClosingKm = async () => {
    const opening = Number(load.m_opening_km || 0);
    const closing = Number(closingKm);
    if (!closingKm) return setKmError('Please enter the closing odometer reading');
    if (closing < opening) return setKmError(`Cannot be less than opening KM (${opening.toLocaleString()})`);
    if (kmMaxAllowed > 0 && closing > kmMaxAllowed) return setKmError(`Cannot exceed ${kmMaxAllowed.toLocaleString()} km`);
    setKmSaving(true);
    try {
      await req(`/km/closing/${encodeURIComponent(load.m_load_no)}`, {
        method: 'POST', body: JSON.stringify({ closing_km: closing }),
      });
      setShowClosingKm(false);
      onRefresh();
      loadDetails();
    } catch (e) { setKmError(e.message); }
    finally { setKmSaving(false); }
  };

  // ── WORKFLOW: advance to the next valid status ──
  const advanceStatus = async (nextStatus) => {
    setStatusSaving(true);
    try {
      await api.updateLoad(load.m_load_no, { m_status: nextStatus });
      onRefresh();
      loadDetails();
    } catch (e) { alert(e.message); }
    finally { setStatusSaving(false); }
  };

  const rejectLoad = async () => {
    if (!window.confirm('Reject this load? This will set it to REJECTED status.')) return;
    setStatusSaving(true);
    try {
      await api.updateLoad(load.m_load_no, { m_status: 'REJECTED' });
      onRefresh();
      loadDetails();
    } catch (e) { alert(e.message); }
    finally { setStatusSaving(false); }
  };

  const totalCosts = costs.reduce((s, c) => s + Number(c.c_amount || 0), 0);
  const grandTotal = Number(load.m_rate || 0) + totalCosts;

  // Work out what the current user can do based on their role and the load status
  const currentStatus = load.m_status;
  const stepIdx = WORKFLOW_STEPS.indexOf(currentStatus);
  const nextStatus = stepIdx >= 0 && stepIdx < WORKFLOW_STEPS.length - 1 ? WORKFLOW_STEPS[stepIdx + 1] : null;
  const allowedRoles = STEP_ROLES[currentStatus] || [];
  const canAdvance = allowedRoles.includes(user?.role) && nextStatus;
  const isKmStatus = currentStatus === 'PENDING_KM_APPROVAL' || currentStatus === 'KM_CORRECTION_NEEDED';

  // Friendly next-step button labels
  const NEXT_LABELS = {
    PRELOAD:         '✓ Approve — Send En Route',
    EN_ROUTE:        '✓ Mark as Offloaded',
    OFFLOADED:       '✓ Move to Awaiting Order No',
    WAIT_ORDER_NO:   '✓ Send for Approval',
    WAIT_APPROVAL:   '✓ Approve Load',
    WAIT_POD_SCAN:   '✓ Mark POD Received',
    WAIT_INVOICE_NO: '✓ Mark as Invoiced',
  };

  const cell = (label, value) => (
    <div style={{ minWidth: 120 }}>
      <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{value || '—'}</div>
    </div>
  );

  return (
    <tr>
      <td colSpan={12} style={{ padding: 0, background: '#f8fafc', borderBottom: '2px solid #00AEEF' }}>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Load detail fields */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 32px' }}>
            {cell('Load No', load.m_load_no)}
            {cell('Date', fmtDate(load.m_date))}
            {cell('Truck', load.m_truck)}
            {cell('Driver', load.m_driver_id)}
            {cell('Customer', load.m_customer)}
            {cell('From', load.m_from)}
            {cell('To', load.m_to)}
            {cell('Trailer', load.m_trailer1 || 'None')}
            {cell('Rate', fmtR(load.m_rate))}
            <div style={{ minWidth: 180 }}>
              <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Order No</div>
              {orderNoEdit ? (
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input value={orderNoVal} onChange={e => setOrderNoVal(e.target.value)}
                    style={{ padding: '3px 6px', fontSize: 13, border: '1px solid #00AEEF', borderRadius: 3, fontFamily: 'inherit', width: 120 }}
                    autoFocus />
                  <button onClick={async () => {
                    setOrderNoSaving(true); setOrderNoMsg('');
                    try {
                      const res = await req(`/loads/${load.m_load_no}/request-order-no`, { method: 'POST', body: JSON.stringify({ order_no: orderNoVal }) });
                      setOrderNoEdit(false);
                      setOrderNoMsg(res.pending ? '⏳ Pending approval' : '✓ Saved');
                      loadDetails(); onRefresh();
                    } catch (e) { setOrderNoMsg('Error: ' + e.message); }
                    finally { setOrderNoSaving(false); }
                  }} disabled={orderNoSaving}
                    style={{ background: '#00AEEF', color: 'white', border: 'none', borderRadius: 3, padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}>
                    {orderNoSaving ? '…' : '✓'}
                  </button>
                  <button onClick={() => { setOrderNoEdit(false); setOrderNoVal(load.m_order_no || ''); }}
                    style={{ background: 'none', border: '1px solid #ddd', borderRadius: 3, padding: '3px 6px', fontSize: 12, cursor: 'pointer' }}>✕</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>
                    {load.m_order_no_pending
                      ? <><span style={{ textDecoration: 'line-through', color: '#aaa' }}>{load.m_order_no || '—'}</span> <span style={{ color: '#d97706' }}>→ {load.m_order_no_pending} ⏳</span></>
                      : load.m_order_no || '—'}
                  </span>
                  <button onClick={() => setOrderNoEdit(true)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#00AEEF', fontSize: 11, padding: '1px 4px' }}>✏️</button>
                </div>
              )}
              {orderNoMsg && <div style={{ fontSize: 11, color: orderNoMsg.includes('⏳') ? '#d97706' : '#059669', marginTop: 2 }}>{orderNoMsg}</div>}
            </div>
            {cell('Invoice', load.m_invoice)}
            {cell('Unit', load.m_bus_unit)}
            {load.m_loading_address && cell('Loading Address', load.m_loading_address)}
            {load.m_offloading_address && cell('Offloading Address', load.m_offloading_address)}
          </div>

          {/* Costs section */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#005A8E', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Additional Costs</div>
              <button className="btn btn-sm btn-primary" onClick={() => setShowCostModal(true)}>+ Add Cost</button>
            </div>
            {costs.length === 0 ? (
              <div style={{ fontSize: 12, color: '#aaa', padding: '8px 0' }}>No additional costs</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 8 }}>
                <thead>
                  <tr style={{ background: '#e8f4fd' }}>
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, color: '#005A8E' }}>Type</th>
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, color: '#005A8E' }}>Description</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 11, color: '#005A8E' }}>Amount</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 11, color: '#005A8E' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {costs.filter(c => c.c_deleted !== 'Y').map(c => (
                    <React.Fragment key={c.c_cost_no}>
                      <tr style={{ borderBottom: '1px solid #e8f4fd', background: c.c_delete_requested === 'Y' ? '#fef9e7' : undefined }}>
                        <td style={{ padding: '6px 10px' }}>{c.c_code}</td>
                        <td style={{ padding: '6px 10px', color: '#555' }}>{c.c_description}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{fmtR(c.c_amount)}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                          {c.c_delete_requested === 'Y' ? (
                            <span style={{ fontSize: 11, color: '#d97706', fontWeight: 600 }}>⏳ Pending approval</span>
                          ) : (
                            <button onClick={() => setDeletingCost(deletingCost === c.c_cost_no ? null : c.c_cost_no)}
                              style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: 4, color: '#e53e3e', fontSize: 11, cursor: 'pointer', padding: '2px 8px' }}>
                              🗑 Delete
                            </button>
                          )}
                        </td>
                      </tr>
                      {deletingCost === c.c_cost_no && (
                        <tr key={'del-' + c.c_cost_no}>
                          <td colSpan={4} style={{ padding: '8px 10px', background: '#fff5f5', borderBottom: '1px solid #fecaca' }}>
                            <div style={{ fontSize: 12, color: '#e53e3e', marginBottom: 6, fontWeight: 600 }}>Request deletion — {c.c_code} {fmtR(c.c_amount)}</div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <input value={deleteReason} onChange={e => setDeleteReason(e.target.value)}
                                placeholder="Reason for deletion (required)…"
                                style={{ flex: 1, padding: '5px 8px', fontSize: 12, border: '1px solid #fca5a5', borderRadius: 4, fontFamily: 'inherit' }} />
                              <button disabled={deleteSaving || !deleteReason.trim()}
                                onClick={async () => {
                                  if (!deleteReason.trim()) return;
                                  setDeleteSaving(true);
                                  try {
                                    await req(`/costs/${c.c_cost_no}/request-delete`, { method: 'PATCH', body: JSON.stringify({ reason: deleteReason }) });
                                    setDeletingCost(null); setDeleteReason(''); loadDetails();
                                  } catch (e) { alert(e.message); }
                                  finally { setDeleteSaving(false); }
                                }}
                                style={{ background: '#e53e3e', color: 'white', border: 'none', borderRadius: 4, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>
                                {deleteSaving ? 'Sending…' : 'Submit Request'}
                              </button>
                              <button onClick={() => { setDeletingCost(null); setDeleteReason(''); }}
                                style={{ background: 'none', border: '1px solid #ddd', borderRadius: 4, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ display: 'flex', gap: 24, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid #ddd' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase' }}>Rate</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 600, color: '#005A8E' }}>{fmtR(load.m_rate)}</div>
              </div>
              {totalCosts > 0 && <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase' }}>Extra Costs</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 600, color: '#e53e3e' }}>{fmtR(totalCosts)}</div>
              </div>}
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase' }}>Total</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 15, color: '#005A8E' }}>{fmtR(grandTotal)}</div>
              </div>
            </div>
          </div>

          {/* Status + Audit Trail side by side */}
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>

            {/* ── STATUS WORKFLOW PANEL ── */}
            <div style={{ minWidth: 240 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#005A8E', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Update Status
              </div>

              {/* Current status badge */}
              <div style={{ marginBottom: 10 }}>
                <span className={`badge ${STATUS_BADGE[currentStatus] || 'badge-gray'}`} style={{ fontSize: 13, padding: '4px 10px' }}>
                  {currentStatus?.replace(/_/g, ' ')}
                </span>
              </div>

              {/* KM System Alert — shown in red BELOW the status, separate from workflow */}
              {isKmStatus && (
                <div style={{
                  background: '#fff1f2', border: '2px solid #e53e3e',
                  borderRadius: 6, padding: '10px 12px', marginBottom: 10,
                }}>
                  <div style={{ color: '#e53e3e', fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                    ⚠ KM Review Required
                  </div>
                  <div style={{ fontSize: 12, color: '#555' }}>
                    {currentStatus === 'PENDING_KM_APPROVAL'
                      ? 'This load is awaiting KM anomaly approval from Operations.'
                      : 'Opening KM needs to be corrected before this load can proceed.'}
                  </div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 6 }}>
                    Go to <strong>Approvals → KM Anomalies</strong> to review.
                  </div>
                </div>
              )}

              {/* Closing KM section (shows when EN_ROUTE and user clicks advance) */}
              {showClosingKm && (
                <div style={{ marginBottom: 10, padding: 12, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6 }}>
                  <div style={{ fontSize: 11, color: '#059669', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    Closing Odometer Reading
                  </div>
                  <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>
                    Opening KM: <strong>{Number(load.m_opening_km || 0).toLocaleString()} km</strong>
                    {kmMaxAllowed > 0 && <span> · Max: <strong>{Number(kmMaxAllowed).toLocaleString()} km</strong></span>}
                  </div>
                  <input type="number" value={closingKm}
                    onChange={e => { setClosingKm(e.target.value); setKmError(''); }}
                    placeholder="Enter closing odometer reading"
                    style={{ width: '100%', padding: '7px 10px', fontSize: 13, border: `1px solid ${kmError ? '#e53e3e' : '#86efac'}`, borderRadius: 4, fontFamily: 'inherit', marginBottom: 4 }}
                  />
                  {kmError && <div style={{ color: '#e53e3e', fontSize: 12, marginBottom: 6 }}>⚠ {kmError}</div>}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-primary btn-sm" style={{ flex: 1, background: '#059669', borderColor: '#059669' }}
                      onClick={saveClosingKm} disabled={kmSaving}>
                      {kmSaving ? 'Saving…' : '✓ Confirm Offload & Save KM'}
                    </button>
                    <button className="btn btn-sm" onClick={() => setShowClosingKm(false)}>Cancel</button>
                  </div>
                </div>
              )}

              {/* Workflow action buttons — only show if not a KM system status */}
              {!isKmStatus && !showClosingKm && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {canAdvance && nextStatus === 'OFFLOADED' ? (
                    // EN_ROUTE → OFFLOADED requires closing KM first
                    <button className="btn btn-primary btn-sm" onClick={() => setShowClosingKm(true)} disabled={statusSaving}>
                      ✓ Enter Closing KM & Offload
                    </button>
                  ) : canAdvance ? (
                    <button className="btn btn-primary btn-sm"
                      style={{ background: '#059669', borderColor: '#059669' }}
                      onClick={() => advanceStatus(nextStatus)} disabled={statusSaving}>
                      {statusSaving ? 'Saving…' : NEXT_LABELS[currentStatus] || `→ ${nextStatus}`}
                    </button>
                  ) : currentStatus !== 'LOAD_INVOICED' && currentStatus !== 'REJECTED' && !isKmStatus ? (
                    <div style={{ fontSize: 12, color: '#aaa', fontStyle: 'italic' }}>
                      {allowedRoles.length === 0
                        ? 'This step is system-driven'
                        : `Waiting for: ${allowedRoles.join(', ')}`}
                    </div>
                  ) : null}

                  {/* Reject button — available to managers/admins on active loads */}
                  {!['LOAD_INVOICED', 'REJECTED', 'DELETED'].includes(currentStatus) &&
                    ['MANAGER', 'ADMIN'].includes(user?.role) && (
                      <button className="btn btn-sm" style={{ color: '#e53e3e', borderColor: '#fca5a5', marginTop: 4 }}
                        onClick={rejectLoad} disabled={statusSaving}>
                        ✕ Reject Load
                      </button>
                    )}
                </div>
              )}
            </div>

            {/* ── AUDIT TRAIL & COMMENTS ── */}
            <div style={{ flex: 1, minWidth: 300 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#005A8E', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Audit Trail & Comments
              </div>
              <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {comments.length === 0 && <div style={{ fontSize: 12, color: '#aaa' }}>No activity yet</div>}
                {comments.map(c => {
                  const isSystem =
                    c.c_comment?.startsWith('Status changed') ||
                    c.c_comment?.startsWith('Load created') ||
                    c.c_comment?.startsWith('Load offloaded') ||
                    c.c_comment?.startsWith('KM anomaly') ||
                    c.c_comment?.startsWith('Cost added') ||
                    c.c_comment?.startsWith('Cost deletion') ||
                    c.c_comment?.startsWith('Order number');

                  return (
                    <div key={c.id} style={{
                      background: isSystem ? '#f0f7ff' : 'white',
                      border: `1px solid ${isSystem ? '#bfdbfe' : '#e8f4fd'}`,
                      borderLeft: `3px solid ${isSystem ? '#3b82f6' : '#00AEEF'}`,
                      borderRadius: 4, padding: '8px 10px',
                    }}>
                      {/* FIX: Layout is now: timestamp → user → activity */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: '#aaa', fontFamily: 'monospace' }}>
                          🕐 {fmtDateTime(c.c_time)}
                        </span>
                        <span style={{
                          fontSize: 11, fontWeight: 600,
                          background: isSystem ? '#dbeafe' : '#e8f4fd',
                          color: isSystem ? '#1e40af' : '#005A8E',
                          borderRadius: 3, padding: '1px 6px',
                        }}>
                          👤 {c.c_logged_by}
                        </span>
                        {isSystem && (
                          <span style={{ fontSize: 10, color: '#6b7280', background: '#f3f4f6', borderRadius: 3, padding: '1px 5px' }}>
                            SYSTEM
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: '#333', lineHeight: 1.4 }}>
                        {c.c_comment}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Add comment */}
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={newComment} onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendComment()}
                  placeholder="Add comment…"
                  style={{ flex: 1, padding: '6px 8px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit' }} />
                <button className="btn btn-sm btn-primary" onClick={sendComment}>Add</button>
              </div>
            </div>
          </div>
        </div>

        {showCostModal && (
          <AddCostModal loadId={load.m_load_no} onClose={() => setShowCostModal(false)}
            onSaved={() => { setShowCostModal(false); loadDetails(); onRefresh(); }} />
        )}
      </td>
    </tr>
  );
}

// ── Pagination Bar ────────────────────────────────────────────
function PaginationBar({ page, total, limit, setPage }) {
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) return null;

  const delta = 2;
  const getPages = () => {
    const pages = [];
    const left = Math.max(1, page - delta);
    const right = Math.min(totalPages, page + delta);
    if (left > 1) { pages.push(1); if (left > 2) pages.push('...'); }
    for (let i = left; i <= right; i++) pages.push(i);
    if (right < totalPages) { if (right < totalPages - 1) pages.push('...'); pages.push(totalPages); }
    return pages;
  };

  const btnStyle = (isActive) => ({
    padding: '4px 8px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4,
    cursor: 'pointer', background: isActive ? '#00AEEF' : 'white',
    color: isActive ? 'white' : '#555', fontWeight: isActive ? 700 : 400, minWidth: 32,
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
      <button style={btnStyle(false)} onClick={() => setPage(1)} disabled={page === 1}>«</button>
      <button style={btnStyle(false)} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>‹</button>
      {getPages().map((p, i) =>
        p === '...'
          ? <span key={i} style={{ padding: '0 4px', color: '#aaa' }}>…</span>
          : <button key={p} style={btnStyle(p === page)} onClick={() => setPage(p)}>{p}</button>
      )}
      <button style={btnStyle(false)} onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>›</button>
      <button style={btnStyle(false)} onClick={() => setPage(totalPages)} disabled={page >= totalPages}>»</button>
      <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>
        Page {page} of {totalPages.toLocaleString()} ({total.toLocaleString()} loads)
      </span>
    </div>
  );
}

// ── Main Loads Page ───────────────────────────────────────────
export default function Loads() {
  const [loads, setLoads] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', bus_unit: '', search: '' });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const LIMIT = 100;

  const now = new Date();
  const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState('');
  const [expandedRow, setExpandedRow] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [loadCosts, setLoadCosts] = useState({});

  const fetchLoads = async () => {
    setLoading(true);
    try {
      const params = { page, limit: LIMIT };
      if (filters.status)   params.status   = filters.status;
      if (filters.bus_unit) params.bus_unit  = filters.bus_unit;
      if (dateFrom)         params.date_from = dateFrom;
      if (dateTo)           params.date_to   = dateTo;
      if (filters.search)   params.search    = filters.search;
      const res = await api.getLoads(params);
      setLoads(res.data || []);
      setTotal(res.total || 0);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const fetchStats = async () => {
    try { setStats(await api.getLoadStats()); } catch {}
  };

  useEffect(() => {
    fetchLoads();
    fetchStats();
  }, [filters.status, filters.bus_unit, page, dateFrom, dateTo, filters.search]);

  const toggleRow = (id) => setExpandedRow(e => e === id ? null : id);

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Active Loads</div><div className="stat-value">{stats.total ?? '—'}</div></div>
        <div className="stat-card"><div className="stat-label">En Route</div><div className="stat-value" style={{ color: '#00AEEF' }}>{stats.en_route ?? '—'}</div></div>
        <div className="stat-card"><div className="stat-label">Awaiting Approval</div><div className="stat-value" style={{ color: '#d97706' }}>{stats.wait_approval ?? '—'}</div></div>
        <div className="stat-card"><div className="stat-label">Invoiced Value</div><div className="stat-value" style={{ fontSize: 18 }}>{fmtR(stats.total_value)}</div></div>
      </div>

      <div className="filter-bar">
        <input placeholder="Search load no, truck, customer…" value={filters.search}
          onChange={e => { setFilters(f => ({ ...f, search: e.target.value })); setPage(1); }} />
        <select value={filters.status} onChange={e => { setFilters(f => ({ ...f, status: e.target.value })); setPage(1); }}>
          <option value="">All statuses</option>
          {ALL_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
          style={{ padding: '7px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4 }} />
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
          style={{ padding: '7px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4 }} />
        <button className="btn btn-sm" onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}>All dates</button>
        <button className="btn btn-sm" onClick={() => {
          if (window.confirm('Export all matching loads? This may take a moment for large datasets.'))
            exportAllLoadsCSV(dateFrom, dateTo, filters.status, filters.search);
        }}>⬇ Export CSV</button>
        <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>+ New Load</button>
      </div>

      {total > LIMIT && <PaginationBar page={page} total={total} limit={LIMIT} setPage={setPage} />}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }}></th>
              <th>Load No</th><th>Date</th><th>Truck</th>
              <th>Customer</th><th>From</th><th>To</th>
              <th>Rate</th><th>Extra Costs</th><th>Total</th><th>Order No</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={12}><div className="loading">Loading…</div></td></tr>}
            {!loading && loads.length === 0 && <tr><td colSpan={12}><div className="empty-state">No loads found</div></td></tr>}
            {!loading && loads.map(l => {
              const extra = Number(loadCosts[l.m_load_no] || 0);
              const tot = Number(l.m_rate || 0) + extra;
              const isOpen = expandedRow === l.m_load_no;
              return (
                <React.Fragment key={l.m_load_no}>
                  <tr style={{ background: isOpen ? '#e8f4fd' : undefined, cursor: 'pointer' }}
                    onClick={() => toggleRow(l.m_load_no)}>
                    <td style={{ textAlign: 'center', color: '#00AEEF', fontWeight: 700, fontSize: 16 }}>
                      {isOpen ? '▲' : '▼'}
                    </td>
                    <td className="mono" style={{ fontWeight: 600 }}>{l.m_load_no}</td>
                    <td>{fmtDate(l.m_date)}</td>
                    <td className="mono">{l.m_truck}</td>
                    <td>{l.m_customer}</td>
                    <td>{l.m_from}</td>
                    <td>{l.m_to}</td>
                    <td className="mono">{fmtR(l.m_rate)}</td>
                    <td className="mono" style={{ color: extra > 0 ? '#e53e3e' : '#aaa' }}>{extra > 0 ? fmtR(extra) : '—'}</td>
                    <td className="mono" style={{ fontWeight: 600, color: '#005A8E' }}>{fmtR(tot)}</td>
                    <td style={{ fontSize: 12, color: '#555' }}>
                      {l.m_order_no_pending ? <span style={{ color: '#d97706' }}>⏳ </span> : ''}
                      {l.m_order_no || '—'}
                    </td>
                    <td><span className={`badge ${STATUS_BADGE[l.m_status] || 'badge-gray'}`}>{l.m_status?.replace(/_/g, ' ')}</span></td>
                  </tr>
                  {isOpen && (
                    <ExpandedRow key={'exp-' + l.m_load_no} load={l} onRefresh={fetchLoads}
                      onCostUpdate={(id, total) => setLoadCosts(prev => ({ ...prev, [id]: total }))} />
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > LIMIT && <PaginationBar page={page} total={total} limit={LIMIT} setPage={setPage} />}
      {showModal && <NewLoadModal onClose={() => setShowModal(false)} onCreated={() => { setShowModal(false); fetchLoads(); fetchStats(); }} />}
    </div>
  );
}
