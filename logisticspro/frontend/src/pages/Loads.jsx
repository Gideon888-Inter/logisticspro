
import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { loadGoogleMaps, resetGoogleMapsLoader } from '../lib/googleMaps';

const API = import.meta.env.VITE_API_URL || '';

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
  WAIT_POD_SCAN:         'badge-amber',
  WAIT_APPROVAL:         'badge-blue',
  WAIT_RATE_CHECK:       'badge-orange',
  WAIT_INVOICE_NO:       'badge-orange',
  LOAD_INVOICED:         'badge-green',
  WAIT_PROCESSING:       'badge-gray',
  REJECTED:              'badge-red',
  PENDING_KM_APPROVAL:   'badge-orange',
  KM_CORRECTION_NEEDED:  'badge-red',
};

// ── Movement view: short "current status" text + colour, derived from
// the load's status + destination (no live GPS field exists yet) ──────────
function movementStatusText(l) {
  const to = l.m_to || '—';
  switch (l.m_status) {
    case 'PRELOAD':              return `Awaiting dispatch to ${to}`;
    case 'EN_ROUTE':              return `En Route to ${to}`;
    case 'OFFLOADED':             return `Arrived at ${to}`;
    case 'WAIT_ORDER_NO':         return 'Awaiting Order Number';
    case 'WAIT_POD_SCAN':         return 'Awaiting POD Scan';
    case 'WAIT_APPROVAL':         return 'Awaiting Operator Approval';
    case 'WAIT_RATE_CHECK':       return 'Awaiting Rate Check';
    case 'WAIT_INVOICE_NO':       return 'Awaiting Invoice';
    case 'LOAD_INVOICED':         return 'Invoiced';
    case 'WAIT_PROCESSING':       return 'Processing';
    case 'REJECTED':              return 'Rejected';
    case 'PENDING_KM_APPROVAL':   return 'KM Pending Approval';
    case 'KM_CORRECTION_NEEDED':  return 'KM Correction Needed';
    default:                      return l.m_status?.replace(/_/g, ' ') || '—';
  }
}
function movementStatusColor(l) {
  const badgeClass = STATUS_BADGE[l.m_status] || 'badge-gray';
  return {
    'badge-gray':   '#374151',
    'badge-blue':   '#1e40af',
    'badge-green':  '#065f46',
    'badge-amber':  '#92400e',
    'badge-orange': '#9a3412',
    'badge-red':    '#991b1b',
  }[badgeClass] || '#374151';
}

// Statuses users can manually filter/view — KM system statuses are EXCLUDED
// from the workflow buttons but INCLUDED in the filter dropdown
const ALL_STATUSES = [
  'PRELOAD', 'EN_ROUTE', 'OFFLOADED',
  'WAIT_ORDER_NO', 'WAIT_POD_SCAN', 'WAIT_APPROVAL',
  'WAIT_RATE_CHECK', 'WAIT_INVOICE_NO', 'LOAD_INVOICED', 'REJECTED',
  'PENDING_KM_APPROVAL', 'KM_CORRECTION_NEEDED',
];

// The valid manual workflow sequence (no KM system statuses here)
const WORKFLOW_STEPS = [
  'PRELOAD', 'EN_ROUTE', 'OFFLOADED',
  'WAIT_ORDER_NO', 'WAIT_POD_SCAN', 'WAIT_APPROVAL',
  'WAIT_RATE_CHECK', 'WAIT_INVOICE_NO', 'LOAD_INVOICED',
];

// Who can manually advance each step
const STEP_ROLES = {
  PRELOAD:          ['OPERATOR', 'ADMIN'],
  EN_ROUTE:         ['OPERATOR', 'ADMIN'],              // via KM offload
  OFFLOADED:        ['OPERATOR', 'ADMIN'],              // → WAIT_ORDER_NO
  WAIT_ORDER_NO:    ['OPERATOR', 'ADMIN'],              // → WAIT_POD_SCAN
  WAIT_POD_SCAN:    [],                                 // system only (POD upload)
  WAIT_APPROVAL:    ['OPERATOR', 'ADMIN'],              // Operator reviews POD → WAIT_RATE_CHECK
  WAIT_RATE_CHECK:  ['MANAGER', 'ADMIN'],               // Admin/Manager confirms rate → WAIT_INVOICE_NO
  WAIT_INVOICE_NO:  [],                                 // system only (invoice flow)
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
  const [mapError, setMapError] = React.useState(null);
  const [retryKey, setRetryKey] = React.useState(0);

  const updateAddress = (newAddr) => {
    setAddress(newAddr);
    // Update the input display
    if (inputRef.current) inputRef.current.value = newAddr;
  };

  React.useEffect(() => {
    setMapError(null);
    loadGoogleMaps((err) => {
      if (err) { setMapError(err); return; }
      try {
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
      } catch (e) {
        // Most likely cause: Places API not enabled on this key, so
        // google.maps.places.Autocomplete isn't a usable constructor.
        console.error('Map picker init error:', e);
        setMapError(`Map picker failed to start (${e.message}). You can still type the address below.`);
      }
    });
  }, [retryKey]);

  const retry = () => {
    resetGoogleMapsLoader();
    setRetryKey(k => k + 1);
  };

  // FIX: Confirm passes the current address state (not DOM value) to parent
  const confirm = () => {
    onChange(address);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 'min(680px, 95vw)', maxHeight: '90vh' }}>
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
              onChange={(e) => updateAddress(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
          {mapError ? (
            <div style={{ padding: '20px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
              <div style={{ fontSize: 13, color: '#c05621', fontWeight: 600, marginBottom: 4 }}>Map unavailable</div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 12, maxWidth: 440, marginLeft: 'auto', marginRight: 'auto' }}>{mapError}</div>
              <button onClick={retry} style={{
                fontSize: 12, padding: '6px 14px', border: '1px solid #ddd', borderRadius: 6,
                background: 'white', cursor: 'pointer', color: '#555',
              }}>↻ Retry</button>
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 10 }}>
                The address field above still works — type the full address and confirm.
              </div>
            </div>
          ) : (
            <div ref={mapRef} style={{ width: '100%', height: 380 }} />
          )}
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
      req('/users').catch(e => { console.error(e); return []; }),
    ]).then(([v, d, c, r, u]) => {
      setVehicles(Array.isArray(v) ? v : []);
      setDrivers(Array.isArray(d) ? d : []);
      setClients(Array.isArray(c) ? c : []);
      setRates(Array.isArray(r) ? r : []);
      setOperators(Array.isArray(u) ? u.filter(usr => usr.u_role === 'OPERATOR' || usr.u_role === 'MANAGER') : []);
    }).catch(console.error);
  }, []);

  // Only active, non-service vehicles available for new load cards
  const horses = vehicles.filter(v => v.vh_type === 'Horse' && v.vh_active !== 'N' && v.vh_in_service !== 'Y');
  const trailers = vehicles.filter(v => v.vh_type === 'Trailer' && v.vh_active !== 'N' && v.vh_in_service !== 'Y');
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
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 'min(620px, 95vw)' }}>
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
              <select value={form.m_trailer1} onChange={e => {
                    const selected = trailers.find(v => v.vh_code === e.target.value);
                    set('m_trailer1', e.target.value);
                    // Auto-fill Trailer 2 if this is a link trailer and size is 18m
                    if (form.m_trailer_size === '18m' && selected?.vh_is_link === 'Y' && selected?.vh_link_pair) {
                      set('m_trailer2', selected.vh_link_pair);
                    } else if (form.m_trailer_size === '18m') {
                      set('m_trailer2', '');
                    }
                  }} style={inputStyle} disabled={form.m_trailer_size === 'None'}>
                <option value="">— Select trailer —</option>
                {trailers.map(v => (
                  <option key={v.vh_code} value={v.vh_code}>
                    {v.vh_code} — {v.vh_make} {v.vh_model}{v.vh_is_link === 'Y' && v.vh_link_pair ? ' 🔗' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {/* Second trailer — only for 18m */}
          {form.m_trailer_size === '18m' && (
          <div className="form-row">
            <div className="form-group" />
            <div className="form-group">
              {(() => {
                const t1 = trailers.find(v => v.vh_code === form.m_trailer1);
                const isLinked = t1?.vh_is_link === 'Y' && t1?.vh_link_pair;
                return (
                  <>
                    <label style={labelStyle}>
                      Trailer 2 *{' '}
                      {isLinked
                        ? <span style={{ color: '#7c3aed', fontWeight: 600 }}>🔗 Auto-linked with {form.m_trailer1}</span>
                        : <span style={{ color: '#00AEEF', fontWeight: 400, textTransform: 'none' }}>(18m requires 2 trailers)</span>
                      }
                    </label>
                    <select value={form.m_trailer2} onChange={e => set('m_trailer2', e.target.value)}
                      style={{ ...inputStyle, background: isLinked ? '#f5f3ff' : undefined,
                        border: isLinked ? '1px solid #7c3aed66' : undefined }}
                      disabled={!!isLinked}>
                      <option value="">— Select second trailer —</option>
                      {trailers.filter(v => v.vh_code !== form.m_trailer1).map(v => (
                        <option key={v.vh_code} value={v.vh_code}>{v.vh_code} — {v.vh_make} {v.vh_model}</option>
                      ))}
                    </select>
                    {isLinked && (
                      <div style={{ fontSize: 11, color: '#7c3aed', marginTop: 4 }}>
                        🔗 Locked — this trailer always travels with {form.m_trailer1}
                      </div>
                    )}
                  </>
                );
              })()}
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

// ── Add Extra Stop Modal ──────────────────────────────────────
function AddStopModal({ loadId, onClose, onSaved }) {
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!address.trim()) return alert('Please choose or enter a dropoff location');
    if (amount && isNaN(Number(amount))) return alert('Please enter a valid amount');
    setSaving(true);
    try {
      await api.addStop({
        s_load: loadId,
        s_address: address.trim(),
        s_amount: Number(amount) || 0,
      });
      onSaved();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 420 }}>
        <div className="modal-header">
          <h3>Add Extra Stop — {loadId}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Dropoff Location *</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={address} onChange={e => setAddress(e.target.value)}
                placeholder="Type an address or pin on map…"
                style={{ flex: 1, padding: '8px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit' }} />
              <button type="button" onClick={() => setShowPicker(true)} title="Pin on map"
                style={{ padding: '0 12px', border: '1px solid #ddd', borderRadius: 4, background: '#f8f9fa', cursor: 'pointer', fontSize: 16 }}>
                📍
              </button>
            </div>
          </div>
          <div className="form-group">
            <label>Cost for this stop (R) <span style={{ color: '#aaa', fontWeight: 400 }}>(optional)</span></label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit' }} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add Stop'}</button>
        </div>
      </div>
      {showPicker && (
        <MapPicker label="Extra Stop" value={address}
          onChange={addr => setAddress(addr)} onClose={() => setShowPicker(false)} />
      )}
    </div>
  );
}

// ── Expanded Load Row ─────────────────────────────────────────
function ExpandedRow({ load, onRefresh, onCostUpdate, asCard = false }) {
  const { user } = useAuth();
  const [comments, setComments] = useState([]);
  const [costs, setCosts] = useState([]);
  const [stops, setStops] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [showCostModal, setShowCostModal] = useState(false);
  const [showStopModal, setShowStopModal] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deletingCost, setDeletingCost] = useState(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deletingStop, setDeletingStop] = useState(null);
  const [stopDeleteReason, setStopDeleteReason] = useState('');
  const [stopDeleteSaving, setStopDeleteSaving] = useState(false);
  const [orderNoEdit, setOrderNoEdit] = useState(false);
  const [orderNoVal, setOrderNoVal] = useState(load.m_order_no || '');
  const [orderNoSaving, setOrderNoSaving] = useState(false);
  const [orderNoMsg, setOrderNoMsg] = useState('');
  const [showClosingKm, setShowClosingKm] = useState(false);
  const [pulsitFetching, setPulsitFetching] = useState(false);
  const [pulsitReading, setPulsitReading] = useState(null);   // { odometer, lastUpdate }
  const [pulsitErrorMsg, setPulsitErrorMsg] = useState('');
  const [useManualEntry, setUseManualEntry] = useState(false);
  const [manualKm, setManualKm] = useState('');
  const [kmError, setKmError] = useState('');
  const [kmSaving, setKmSaving] = useState(false);
  const [kmMaxAllowed, setKmMaxAllowed] = useState(0);
  const [statusSaving, setStatusSaving] = useState(false);
  const [podLink, setPodLink] = useState(load.m_pod_sharepoint_url || null);
  const [podChecking, setPodChecking] = useState(false);
  const [showComments, setShowComments] = useState(false);  // mobile: collapsed by default

  // ── Assignment edit (driver / horse / trailer) ─────────────
  const ASSIGNMENT_EDITABLE = ['PRELOAD','EN_ROUTE','OFFLOADED','WAIT_ORDER_NO','WAIT_POD_SCAN'];
  const canEditAssignment =
    ASSIGNMENT_EDITABLE.includes(load.m_status) &&
    ['ADMIN','OPERATOR','OPS_ASSISTANT','MANAGER'].includes(user?.role);

  const [showAssign, setShowAssign]         = useState(false);
  const [assignVehicles, setAssignVehicles] = useState([]);
  const [assignDrivers, setAssignDrivers]   = useState([]);
  const [assignForm, setAssignForm]         = useState({
    m_truck:    load.m_truck    || '',
    m_driver_id:load.m_driver_id|| '',
    m_trailer1: load.m_trailer1 || '',
    m_trailer2: load.m_trailer2 || '',
    m_trailer_size: load.m_trailer_size || 'None',
  });
  const [assignSaving, setAssignSaving]     = useState(false);

  const openAssignPanel = async () => {
    setShowAssign(true);
    if (assignVehicles.length === 0) {
      try {
        const [v, d] = await Promise.all([
          api.getVehicles({ active: 'Y' }),
          api.getDrivers({ active: 'Y' }),
        ]);
        setAssignVehicles(Array.isArray(v) ? v : []);
        setAssignDrivers(Array.isArray(d) ? d : []);
      } catch (e) { console.error(e); }
    }
  };

  const saveAssignment = async () => {
    setAssignSaving(true);
    try {
      await api.updateLoad(load.m_load_no, {
        m_truck:         assignForm.m_truck,
        m_driver_id:     assignForm.m_driver_id,
        m_trailer1:      assignForm.m_trailer1,
        m_trailer2:      assignForm.m_trailer2,
        m_trailer_size:  assignForm.m_trailer_size,
      });
      // Log what changed
      const changes = [];
      if (assignForm.m_truck     !== load.m_truck)     changes.push(`Horse: ${load.m_truck||'—'} → ${assignForm.m_truck||'—'}`);
      if (assignForm.m_driver_id !== load.m_driver_id) changes.push(`Driver: ${load.m_driver_id||'—'} → ${assignForm.m_driver_id||'—'}`);
      if (assignForm.m_trailer1  !== load.m_trailer1)  changes.push(`Trailer 1: ${load.m_trailer1||'—'} → ${assignForm.m_trailer1||'—'}`);
      if (assignForm.m_trailer2  !== load.m_trailer2)  changes.push(`Trailer 2: ${load.m_trailer2||'—'} → ${assignForm.m_trailer2||'—'}`);
      if (changes.length > 0) {
        await api.addComment(load.m_load_no, `Assignment updated by ${user?.username}: ${changes.join(', ')}`);
      }
      setShowAssign(false);
      onRefresh();
      loadDetails();
    } catch (e) { alert(e.message); }
    finally { setAssignSaving(false); }
  };

  const loadDetails = async () => {
    try {
      const [c, co, st] = await Promise.all([
        api.getComments(load.m_load_no),
        req(`/costs?load=${encodeURIComponent(load.m_load_no)}`).catch(e => { console.error(e); return []; }),
        api.getStops(load.m_load_no).catch(e => { console.error(e); return []; }),
      ]);
      setComments(Array.isArray(c) ? c : []);
      const costsArr = Array.isArray(co) ? co : [];
      const stopsArr = Array.isArray(st) ? st : [];
      setCosts(costsArr);
      setStops(stopsArr);
      const extraTotal =
        costsArr.reduce((s, c) => s + Number(c.c_amount || 0), 0) +
        stopsArr.filter(s => s.s_deleted !== 'Y').reduce((s, x) => s + Number(x.s_amount || 0), 0);
      if (onCostUpdate) onCostUpdate(load.m_load_no, extraTotal);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { loadDetails(); }, [load.m_load_no]);

  // Auto-check SharePoint for POD when load is in WAIT_POD_SCAN
  useEffect(() => {
    if (load.m_status !== 'WAIT_POD_SCAN') return;
    let cancelled = false;
    const checkPod = async () => {
      setPodChecking(true);
      try {
        const result = await req(`/pods/${encodeURIComponent(load.m_load_no)}/check`);
        if (cancelled) return;
        if (result.found) {
          setPodLink(result.sharepoint_url);
          // Reload parent list so the badge updates to WAIT_APPROVAL
          onRefresh();
          loadDetails();
        }
      } catch (e) { /* silent — will retry on next interval */ }
      finally { if (!cancelled) setPodChecking(false); }
    };
    checkPod(); // immediate check on expand
    const interval = setInterval(checkPod, 60000); // re-check every 60s
    return () => { cancelled = true; clearInterval(interval); };
  }, [load.m_load_no, load.m_status]);

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

  // Opens the closing panel and immediately fetches the live Pulsit
  // odometer reading for this load's truck — this is now the primary
  // path for closing KM (replaces manual entry). Manual entry remains
  // available as an explicit fallback if Pulsit has no reading.
  const openClosingKm = async () => {
    setShowClosingKm(true);
    setUseManualEntry(false);
    setKmError('');
    setPulsitErrorMsg('');
    setPulsitReading(null);
    setPulsitFetching(true);
    try {
      const r = await api.getPulsitReading(load.m_truck);
      setPulsitReading(r);
    } catch (e) {
      setPulsitErrorMsg(e.message || 'Could not reach Pulsit tracking');
    } finally {
      setPulsitFetching(false);
    }
  };

  const confirmClosingAuto = async () => {
    setKmError('');
    setKmSaving(true);
    try {
      await api.confirmClosingAuto(load.m_load_no);
      setShowClosingKm(false);
      onRefresh();
      loadDetails();
    } catch (e) { setKmError(e.message); }
    finally { setKmSaving(false); }
  };

  const saveClosingKmManual = async () => {
    const opening = Number(load.m_opening_km || 0);
    const closing = Number(manualKm);
    if (!manualKm) return setKmError('Please enter the closing odometer reading');
    if (closing < opening) return setKmError(`Cannot be less than opening KM (${opening.toLocaleString()})`);
    if (kmMaxAllowed > 0 && closing > kmMaxAllowed) return setKmError(`Cannot exceed ${kmMaxAllowed.toLocaleString()} km`);
    setKmSaving(true);
    try {
      const result = await req(`/km/closing/${encodeURIComponent(load.m_load_no)}`, {
        method: 'POST', body: JSON.stringify({ closing_km: closing }),
      });
      if (result?.error) { setKmError(result.error); return; }
      setShowClosingKm(false);
      onRefresh();
      loadDetails();
    } catch (e) { setKmError(e.message || 'Could not save closing KM'); }
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
  const totalStops = stops.filter(s => s.s_deleted !== 'Y').reduce((s, x) => s + Number(x.s_amount || 0), 0);
  const grandTotal = Number(load.m_rate || 0) + totalCosts + totalStops;

  // Work out what the current user can do based on their role and the load status
  const currentStatus = load.m_status;
  const stepIdx = WORKFLOW_STEPS.indexOf(currentStatus);
  const nextStatus = stepIdx >= 0 && stepIdx < WORKFLOW_STEPS.length - 1 ? WORKFLOW_STEPS[stepIdx + 1] : null;
  const allowedRoles = STEP_ROLES[currentStatus] || [];
  const canAdvance = allowedRoles.includes(user?.role) && nextStatus;
  const isKmStatus = currentStatus === 'PENDING_KM_APPROVAL' || currentStatus === 'KM_CORRECTION_NEEDED';

  // Any status that comes after WAIT_POD_SCAN means the POD was received
  const POD_PASSED_STATUSES = ['WAIT_APPROVAL', 'WAIT_RATE_CHECK', 'WAIT_INVOICE_NO', 'LOAD_INVOICED'];
  const hasPodPassed = POD_PASSED_STATUSES.includes(currentStatus);
  const sharepointPodUrl = `https://llamahosted.sharepoint.com/sites/Interland/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2FInterland%2FShared%20Documents%2FInterland%20Distribution%2FPODS%20New%2FA${load.m_load_no}&viewid=`;
  const sharepointInvoiceUrl = load.m_invoice
    ? `https://llamahosted.sharepoint.com/sites/Interland/Shared%20Documents/Interland%20Distribution/INVOICES/${encodeURIComponent(load.m_invoice)}?web=1`
    : `https://llamahosted.sharepoint.com/sites/Interland/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2FInterland%2FShared%20Documents%2FInterland%20Distribution%2FINVOICES`;

  // Friendly next-step button labels
  const NEXT_LABELS = {
    PRELOAD:          '✓ Approve — Send En Route',
    EN_ROUTE:         '✓ Mark as Offloaded',
    OFFLOADED:        '✓ Move to Awaiting PO Number',
    WAIT_ORDER_NO:    '✓ PO Received — Awaiting POD',
    WAIT_POD_SCAN:    '— Awaiting POD Upload',
    WAIT_APPROVAL:    '✓ POD Approved — Send for Rate Check',
    WAIT_RATE_CHECK:  '✓ Rate Confirmed — Ready to Invoice',
    WAIT_INVOICE_NO:  '— Awaiting Invoice (Accounting)',
  };

  const cell = (label, value) => (
    <div style={{ minWidth: 120 }}>
      <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{value || '—'}</div>
    </div>
  );

  const inner = (
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
                  {!['WAIT_APPROVAL','WAIT_RATE_CHECK','WAIT_INVOICE_NO','LOAD_INVOICED','REJECTED'].includes(currentStatus) && (
                    <button onClick={() => setOrderNoEdit(true)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#00AEEF', fontSize: 11, padding: '1px 4px' }}>✏️</button>
                  )}
                </div>
              )}
              {orderNoMsg && <div style={{ fontSize: 11, color: orderNoMsg.includes('⏳') ? '#d97706' : '#059669', marginTop: 2 }}>{orderNoMsg}</div>}
            </div>
            {cell('Invoice', load.m_invoice)}
            {hasPodPassed && (
              <div style={{ minWidth: 120 }}>
                <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>POD</div>
                <a href={podLink || sharepointPodUrl} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 13, color: '#005A8E', textDecoration: 'underline', display: 'flex', alignItems: 'center', gap: 4 }}>
                  📂 View POD
                </a>
              </div>
            )}
            {currentStatus === 'LOAD_INVOICED' && (
              <div style={{ minWidth: 120 }}>
                <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Invoice</div>
                <a href={sharepointInvoiceUrl} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 13, color: '#005A8E', textDecoration: 'underline', display: 'flex', alignItems: 'center', gap: 4 }}>
                  📄 {load.m_invoice || 'View Invoice'}
                </a>
              </div>
            )}
            {load.m_loading_address && cell('Loading Address', load.m_loading_address)}
            {load.m_offloading_address && cell('Offloading Address', load.m_offloading_address)}
          </div>

          {/* ── Edit Assignment Panel ────────────────────────────────── */}
          {canEditAssignment && (
            <div>
              {!showAssign ? (
                <button
                  onClick={openAssignPanel}
                  style={{
                    background: 'none', border: '1px solid #00AEEF', borderRadius: 4,
                    color: '#005A8E', fontSize: 12, cursor: 'pointer', padding: '4px 10px',
                    fontFamily: 'inherit',
                  }}>
                  ✏️ Edit Driver / Horse / Trailer
                </button>
              ) : (
                <div style={{
                  background: '#f0f8ff', border: '1px solid #00AEEF',
                  borderRadius: 6, padding: '14px 16px',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#005A8E', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    ✏️ Edit Assignment
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10, marginBottom: 12 }}>
                    {/* Horse */}
                    <div>
                      <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Horse</div>
                      <select
                        value={assignForm.m_truck}
                        onChange={e => setAssignForm(f => ({ ...f, m_truck: e.target.value }))}
                        style={{ width: '100%', padding: '7px 8px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit' }}>
                        <option value="">— None —</option>
                        {assignVehicles.filter(v => v.vh_type === 'Horse').map(v => (
                          <option key={v.vh_code} value={v.vh_code}>{v.vh_code}{v.vh_make ? ` — ${v.vh_make}` : ''}</option>
                        ))}
                      </select>
                    </div>
                    {/* Driver */}
                    <div>
                      <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Driver</div>
                      <select
                        value={assignForm.m_driver_id}
                        onChange={e => setAssignForm(f => ({ ...f, m_driver_id: e.target.value }))}
                        style={{ width: '100%', padding: '7px 8px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit' }}>
                        <option value="">— None —</option>
                        {assignDrivers.map(d => (
                          <option key={d.d_id} value={d.d_nickname}>{d.d_nickname}{d.d_name ? ` — ${d.d_name}` : ''}</option>
                        ))}
                      </select>
                    </div>
                    {/* Trailer Size */}
                    <div>
                      <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Trailer Size</div>
                      <select
                        value={assignForm.m_trailer_size}
                        onChange={e => {
                          const sz = e.target.value;
                          setAssignForm(f => ({
                            ...f,
                            m_trailer_size: sz,
                            m_trailer1: sz === 'None' ? '' : f.m_trailer1,
                            m_trailer2: sz !== '18m'  ? '' : f.m_trailer2,
                          }));
                        }}
                        style={{ width: '100%', padding: '7px 8px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit' }}>
                        <option value="None">None</option>
                        <option value="15m">15m</option>
                        <option value="18m">18m</option>
                      </select>
                    </div>
                    {/* Trailer 1 */}
                    {assignForm.m_trailer_size !== 'None' && (
                      <div>
                        <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Trailer 1</div>
                        <select
                          value={assignForm.m_trailer1}
                          onChange={e => {
                            const code = e.target.value;
                            const v = assignVehicles.find(x => x.vh_code === code);
                            const linked = v?.vh_is_link === 'Y' && v?.vh_link_pair && assignForm.m_trailer_size === '18m';
                            setAssignForm(f => ({
                              ...f,
                              m_trailer1: code,
                              m_trailer2: linked ? v.vh_link_pair : f.m_trailer2,
                            }));
                          }}
                          style={{ width: '100%', padding: '7px 8px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit' }}>
                          <option value="">— None —</option>
                          {assignVehicles.filter(v => v.vh_type === 'Trailer').map(v => (
                            <option key={v.vh_code} value={v.vh_code}>{v.vh_code}{v.vh_is_link === 'Y' && v.vh_link_pair ? ' 🔗' : ''}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {/* Trailer 2 — only for 18m */}
                    {assignForm.m_trailer_size === '18m' && (
                      <div>
                        <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Trailer 2</div>
                        {(() => {
                          const t1 = assignVehicles.find(v => v.vh_code === assignForm.m_trailer1);
                          const isLinked = t1?.vh_is_link === 'Y' && t1?.vh_link_pair;
                          return (
                            <select
                              value={assignForm.m_trailer2}
                              onChange={e => setAssignForm(f => ({ ...f, m_trailer2: e.target.value }))}
                              disabled={!!isLinked}
                              style={{
                                width: '100%', padding: '7px 8px', fontSize: 13, borderRadius: 4, fontFamily: 'inherit',
                                border: isLinked ? '1px solid #7c3aed66' : '1px solid #ddd',
                                background: isLinked ? '#f5f3ff' : 'white',
                              }}>
                              <option value="">— None —</option>
                              {assignVehicles.filter(v => v.vh_type === 'Trailer' && v.vh_code !== assignForm.m_trailer1).map(v => (
                                <option key={v.vh_code} value={v.vh_code}>{v.vh_code}</option>
                              ))}
                            </select>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={saveAssignment}
                      disabled={assignSaving}
                      style={{
                        background: '#059669', color: 'white', border: 'none', borderRadius: 4,
                        padding: '7px 16px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                      }}>
                      {assignSaving ? 'Saving…' : '✓ Save Assignment'}
                    </button>
                    <button
                      onClick={() => setShowAssign(false)}
                      style={{
                        background: 'none', border: '1px solid #ddd', borderRadius: 4,
                        padding: '7px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                      }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Costs section */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#005A8E', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Additional Costs</div>
              {!['WAIT_APPROVAL','WAIT_RATE_CHECK','WAIT_INVOICE_NO','LOAD_INVOICED','REJECTED'].includes(currentStatus) && (
                <button className="btn btn-sm btn-primary" onClick={() => setShowCostModal(true)}>+ Add Cost</button>
              )}
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
              {totalStops > 0 && <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase' }}>Stop Costs</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 600, color: '#e53e3e' }}>{fmtR(totalStops)}</div>
              </div>}
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase' }}>Total</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 15, color: '#005A8E' }}>{fmtR(grandTotal)}</div>
              </div>
            </div>
          </div>

          {/* Extra Stops section */}
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#005A8E', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Extra Stops</div>
              {!['WAIT_APPROVAL','WAIT_RATE_CHECK','WAIT_INVOICE_NO','LOAD_INVOICED','REJECTED'].includes(currentStatus) && (
                <button className="btn btn-sm btn-primary" onClick={() => setShowStopModal(true)}>+ Add Stop</button>
              )}
            </div>
            {stops.filter(s => s.s_deleted !== 'Y').length === 0 ? (
              <div style={{ fontSize: 12, color: '#aaa', padding: '8px 0' }}>No extra stops</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 8 }}>
                <thead>
                  <tr style={{ background: '#e8f4fd' }}>
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, color: '#005A8E' }}>#</th>
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, color: '#005A8E' }}>Dropoff Location</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 11, color: '#005A8E' }}>Cost</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 11, color: '#005A8E' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {stops.filter(s => s.s_deleted !== 'Y').map((s, idx) => (
                    <React.Fragment key={s.stop_no}>
                      <tr style={{ borderBottom: '1px solid #e8f4fd', background: s.s_delete_requested === 'Y' ? '#fef9e7' : undefined }}>
                        <td style={{ padding: '6px 10px', color: '#888' }}>{idx + 1}</td>
                        <td style={{ padding: '6px 10px', color: '#555' }}>{s.s_address}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{s.s_amount > 0 ? fmtR(s.s_amount) : '—'}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                          {s.s_delete_requested === 'Y' ? (
                            <span style={{ fontSize: 11, color: '#d97706', fontWeight: 600 }}>⏳ Pending approval</span>
                          ) : (
                            <button onClick={() => setDeletingStop(deletingStop === s.stop_no ? null : s.stop_no)}
                              style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: 4, color: '#e53e3e', fontSize: 11, cursor: 'pointer', padding: '2px 8px' }}>
                              🗑 Remove
                            </button>
                          )}
                        </td>
                      </tr>
                      {deletingStop === s.stop_no && (
                        <tr key={'del-stop-' + s.stop_no}>
                          <td colSpan={4} style={{ padding: '8px 10px', background: '#fff5f5', borderBottom: '1px solid #fecaca' }}>
                            <div style={{ fontSize: 12, color: '#e53e3e', marginBottom: 6, fontWeight: 600 }}>Request removal — {s.s_address}</div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <input value={stopDeleteReason} onChange={e => setStopDeleteReason(e.target.value)}
                                placeholder="Reason for removal (required)…"
                                style={{ flex: 1, padding: '5px 8px', fontSize: 12, border: '1px solid #fca5a5', borderRadius: 4, fontFamily: 'inherit' }} />
                              <button disabled={stopDeleteSaving || !stopDeleteReason.trim()}
                                onClick={async () => {
                                  if (!stopDeleteReason.trim()) return;
                                  setStopDeleteSaving(true);
                                  try {
                                    await api.requestDeleteStop(s.stop_no, stopDeleteReason);
                                    setDeletingStop(null); setStopDeleteReason(''); loadDetails();
                                  } catch (e) { alert(e.message); }
                                  finally { setStopDeleteSaving(false); }
                                }}
                                style={{ background: '#e53e3e', color: 'white', border: 'none', borderRadius: 4, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>
                                {stopDeleteSaving ? 'Sending…' : 'Submit Request'}
                              </button>
                              <button onClick={() => { setDeletingStop(null); setStopDeleteReason(''); }}
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
          </div>
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
                    Confirm Offload — Closing Odometer
                  </div>
                  <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>
                    Opening KM: <strong>{Number(load.m_opening_km || 0).toLocaleString()} km</strong>
                    {kmMaxAllowed > 0 && <span> · Max: <strong>{Number(kmMaxAllowed).toLocaleString()} km</strong></span>}
                  </div>

                  {!useManualEntry && (
                    <>
                      {pulsitFetching && (
                        <div style={{ fontSize: 12, color: '#555', padding: '8px 0' }}>📡 Reading live odometer from Pulsit GPS…</div>
                      )}
                      {!pulsitFetching && pulsitReading && (
                        <div style={{ background: 'white', border: '1px solid #86efac', borderRadius: 4, padding: '8px 10px', marginBottom: 8 }}>
                          <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>Live Pulsit Reading</div>
                          <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 18, color: '#059669' }}>
                            {Number(pulsitReading.odometer).toLocaleString()} km
                          </div>
                          <div style={{ fontSize: 11, color: '#888' }}>
                            Accrued this load: <strong>{(Number(pulsitReading.odometer) - Number(load.m_opening_km || 0)).toLocaleString()} km</strong>
                          </div>
                        </div>
                      )}
                      {!pulsitFetching && pulsitErrorMsg && (
                        <div style={{ fontSize: 12, color: '#c05621', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 4, padding: '8px 10px', marginBottom: 8 }}>
                          ⚠️ {pulsitErrorMsg}
                        </div>
                      )}
                      {kmError && <div style={{ color: '#e53e3e', fontSize: 12, marginBottom: 6 }}>⚠ {kmError}</div>}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-primary btn-sm" style={{ flex: 1, background: '#059669', borderColor: '#059669' }}
                          onClick={confirmClosingAuto} disabled={kmSaving || pulsitFetching || !pulsitReading}>
                          {kmSaving ? 'Saving…' : '✓ Confirm Offload'}
                        </button>
                        {!pulsitFetching && (
                          <button className="btn btn-sm" onClick={openClosingKm} title="Re-read from Pulsit">↻</button>
                        )}
                        <button className="btn btn-sm" onClick={() => setShowClosingKm(false)}>Cancel</button>
                      </div>
                      {!pulsitFetching && (
                        <div style={{ marginTop: 8, textAlign: 'center' }}>
                          <button onClick={() => { setUseManualEntry(true); setKmError(''); }}
                            style={{ background: 'none', border: 'none', color: '#888', fontSize: 11, textDecoration: 'underline', cursor: 'pointer' }}>
                            Pulsit unavailable for this truck? Enter manually
                          </button>
                        </div>
                      )}
                    </>
                  )}

                  {useManualEntry && (
                    <>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Manual fallback — only use if Pulsit has no reading for this truck.</div>
                      <input type="number" value={manualKm}
                        onChange={e => { setManualKm(e.target.value); setKmError(''); }}
                        placeholder="Enter closing odometer reading"
                        style={{ width: '100%', padding: '7px 10px', fontSize: 13, border: `1px solid ${kmError ? '#e53e3e' : '#86efac'}`, borderRadius: 4, fontFamily: 'inherit', marginBottom: 4 }}
                      />
                      {kmError && <div style={{ color: '#e53e3e', fontSize: 12, marginBottom: 6 }}>⚠ {kmError}</div>}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-primary btn-sm" style={{ flex: 1, background: '#059669', borderColor: '#059669' }}
                          onClick={saveClosingKmManual} disabled={kmSaving}>
                          {kmSaving ? 'Saving…' : '✓ Confirm Offload & Save KM'}
                        </button>
                        <button className="btn btn-sm" onClick={() => { setUseManualEntry(false); setKmError(''); }}>← Back to Pulsit</button>
                        <button className="btn btn-sm" onClick={() => setShowClosingKm(false)}>Cancel</button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Workflow action buttons — only show if not a KM system status */}
              {!isKmStatus && !showClosingKm && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {canAdvance && nextStatus === 'OFFLOADED' ? (
                    // EN_ROUTE → OFFLOADED requires closing KM first
                    <button className="btn btn-primary btn-sm" onClick={openClosingKm} disabled={statusSaving}>
                      ✓ Confirm Offload
                    </button>
                  ) : canAdvance ? (
                    <button className="btn btn-primary btn-sm"
                      style={{ background: '#059669', borderColor: '#059669' }}
                      onClick={() => advanceStatus(nextStatus)} disabled={statusSaving}>
                      {statusSaving ? 'Saving…' : NEXT_LABELS[currentStatus] || `→ ${nextStatus}`}
                    </button>
                  ) : currentStatus !== 'LOAD_INVOICED' && currentStatus !== 'REJECTED' && !isKmStatus ? (
                    <div>
                      {currentStatus === 'WAIT_POD_SCAN' ? (
                        <div style={{
                          background: podLink ? '#f0fdf4' : '#fffbeb',
                          border: `1px solid ${podLink ? '#86efac' : '#fcd34d'}`,
                          borderRadius: 6, padding: '10px 12px',
                        }}>
                          {podLink ? (
                            <>
                              <div style={{ color: '#059669', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                                ✅ POD found in SharePoint
                              </div>
                              <a href={podLink} target="_blank" rel="noopener noreferrer"
                                style={{ fontSize: 12, color: '#005A8E', textDecoration: 'underline', display: 'block', marginBottom: 6 }}>
                                📂 Open POD folder →
                              </a>
                              <div style={{ fontSize: 11, color: '#059669' }}>Status advancing to Operator review…</div>
                            </>
                          ) : (
                            <>
                              <div style={{ color: '#d97706', fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                                {podChecking ? '🔍 Scanning SharePoint…' : '⏳ Awaiting POD in SharePoint'}
                              </div>
                              <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>
                                Upload the POD to the SharePoint PODS folder for this load. The system checks automatically every 60 seconds.
                              </div>
                              <a href={`https://llamahosted.sharepoint.com/sites/Interland/Shared%20Documents/Interland%20Distribution/PODS%20New`}
                                target="_blank" rel="noopener noreferrer"
                                style={{ fontSize: 12, color: '#005A8E', textDecoration: 'underline', display: 'block', marginBottom: 8 }}>
                                📂 Open SharePoint PODs folder →
                              </a>
                              <button
                                onClick={async () => {
                                  if (!window.confirm('Mark POD as received for load ' + load.m_load_no + '? This will advance the status to Awaiting Approval.')) return;
                                  try {
                                    await req(`/pods/${encodeURIComponent(load.m_load_no)}/mark-received`, {
                                      method: 'POST',
                                      body: JSON.stringify({ received_by: user?.username }),
                                    });
                                    onRefresh();
                                  } catch (e) { alert('Error: ' + e.message); }
                                }}
                                style={{
                                  background: '#059669', color: 'white', border: 'none',
                                  borderRadius: 4, padding: '6px 12px', fontSize: 12,
                                  cursor: 'pointer', fontFamily: 'inherit', width: '100%',
                                }}>
                                ✓ Mark POD Received Manually
                              </button>
                            </>
                          )}
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: '#aaa', fontStyle: 'italic' }}>
                          {allowedRoles.length === 0
                            ? 'This step is system-driven'
                            : `Waiting for: ${allowedRoles.join(', ')}`}
                        </div>
                      )}
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
              <div
                onClick={() => asCard && setShowComments(s => !s)}
                style={{ fontSize: 12, fontWeight: 600, color: '#005A8E', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: asCard ? 'pointer' : 'default' }}>
                <span>Audit Trail & Comments {comments.length > 0 ? `(${comments.length})` : ''}</span>
                {asCard && (
                  <span style={{ fontSize: 16, color: '#00AEEF', transition: 'transform 0.2s', display: 'inline-block', transform: showComments ? 'rotate(180deg)' : 'none' }}>▼</span>
                )}
              </div>
              {(!asCard || showComments) && (
              <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
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
                      display: 'flex', alignItems: 'baseline', gap: 8,
                      padding: '4px 8px',
                      borderRadius: 3,
                      background: isSystem ? '#f5f9ff' : 'white',
                      borderLeft: `3px solid ${isSystem ? '#3b82f6' : '#00AEEF'}`,
                    }}>
                      <span style={{ fontSize: 11, color: '#999', fontFamily: 'monospace', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {fmtDateTime(c.c_time)}
                      </span>
                      <span style={{
                        fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
                        color: isSystem ? '#1e40af' : '#005A8E',
                      }}>
                        {c.c_logged_by}
                      </span>
                      {isSystem && (
                        <span style={{ fontSize: 10, color: '#9ca3af', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          SYSTEM
                        </span>
                      )}
                      <span style={{ fontSize: 12, color: '#333', lineHeight: 1.4 }}>
                        {c.c_comment}
                      </span>
                    </div>
                  );
                })}
              </div>
              )}
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
  );

  if (asCard) {
    return (
      <div style={{ background: '#f8fafc', borderLeft: '4px solid #00AEEF', borderRadius: '0 0 6px 6px', marginTop: -6 }}>
        {inner}
        {showCostModal && (
          <AddCostModal loadId={load.m_load_no} onClose={() => setShowCostModal(false)}
            onSaved={() => { setShowCostModal(false); loadDetails(); onRefresh(); }} />
        )}
        {showStopModal && (
          <AddStopModal loadId={load.m_load_no} onClose={() => setShowStopModal(false)}
            onSaved={() => { setShowStopModal(false); loadDetails(); onRefresh(); }} />
        )}
      </div>
    );
  }

  return (
    <tr>
      <td colSpan={12} style={{ padding: 0, background: '#f8fafc', borderBottom: '2px solid #00AEEF' }}>
        {inner}
        {showCostModal && (
          <AddCostModal loadId={load.m_load_no} onClose={() => setShowCostModal(false)}
            onSaved={() => { setShowCostModal(false); loadDetails(); onRefresh(); }} />
        )}
        {showStopModal && (
          <AddStopModal loadId={load.m_load_no} onClose={() => setShowStopModal(false)}
            onSaved={() => { setShowStopModal(false); loadDetails(); onRefresh(); }} />
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
// viewMode: 'standard' (default, full finance-oriented columns) or
// 'movement' (fleet-ops oriented columns — used by Fleet > Movement tab).
export default function Loads({ viewMode = 'standard' } = {}) {
  const [loads, setLoads] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', search: '' });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const LIMIT = 100;

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [dateTo, setDateTo] = useState('');
  const [expandedRow, setExpandedRow] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [loadCosts, setLoadCosts] = useState({});

  const fetchLoads = async () => {
    setLoading(true);
    try {
      const params = { page, limit: LIMIT };
      if (filters.status)   params.status   = filters.status;
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
  }, [filters.status, page, dateFrom, dateTo, filters.search]);

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
        {/* Date range + clear — all on one compact row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 auto', minWidth: 0 }}>
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
            style={{ flex: '1 1 0', minWidth: 0, padding: '7px 6px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4 }} />
          <span style={{ fontSize: 11, color: '#aaa', flexShrink: 0 }}>to</span>
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
            style={{ flex: '1 1 0', minWidth: 0, padding: '7px 6px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4 }} />
          {(dateFrom || dateTo) && (
            <button className="btn btn-sm" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
              onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}>
              Clear dates
            </button>
          )}
        </div>
        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-sm" onClick={() => {
            if (window.confirm('Export all matching loads? This may take a moment for large datasets.'))
              exportAllLoadsCSV(dateFrom, dateTo, filters.status, filters.search);
          }}>⬇ CSV</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>+ New Load</button>
        </div>
      </div>

      {total > LIMIT && <PaginationBar page={page} total={total} limit={LIMIT} setPage={setPage} />}

      {/* ── Mobile card list (shown ≤768px, CSS-controlled) ─────── */}
      <div className="mobile-card-list">
        {loading && <div className="loading">Loading…</div>}
        {!loading && loads.length === 0 && <div className="empty-state">No loads found</div>}
        {!loading && loads.map(l => {
          const extra = Number(loadCosts[l.m_load_no] || 0);
          const tot   = Number(l.m_rate || 0) + extra;
          const isOpen = expandedRow === l.m_load_no;
          return (
            <React.Fragment key={l.m_load_no}>
              <div className={`load-card${isOpen ? ' open' : ''}`} onClick={() => toggleRow(l.m_load_no)}>
                <div className="load-card-header">
                  <div>
                    <div className="load-card-no">#{l.m_load_no}</div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{fmtDate(l.m_date)}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span className={`badge ${STATUS_BADGE[l.m_status] || 'badge-gray'}`}>
                      {l.m_status?.replace(/_/g, ' ')}
                    </span>
                    {l.m_order_no_pending && <span style={{ fontSize: 10, color: '#d97706' }}>⏳ PO pending</span>}
                  </div>
                </div>
                <div className="load-card-meta">
                  <div>🚛 <strong>{l.m_truck || '—'}</strong></div>
                  <div>👤 <strong>{l.m_driver_id || '—'}</strong></div>
                  {(l.m_responsible_operator || l.m_operator) && (
                    <div>🧑‍💼 <strong>{l.m_responsible_operator || l.m_operator}</strong></div>
                  )}
                  <div>📦 <strong>{l.m_customer || '—'}</strong></div>
                  <div>🗺 <strong>{l.m_from} → {l.m_to}</strong></div>
                  {l.m_order_no && <div>PO: <strong>{l.m_order_no}</strong></div>}
                  {l.m_trailer1 && <div>🚛 <strong>{l.m_trailer1}</strong></div>}
                </div>
                <div className="load-card-footer">
                  <div className="load-card-total">{fmtR(tot)}</div>
                  <span className="load-card-chevron">▼</span>
                </div>
              </div>
              {isOpen && (
                <ExpandedRow key={'exp-' + l.m_load_no} load={l} onRefresh={fetchLoads} asCard={true}
                  onCostUpdate={(id, total) => setLoadCosts(prev => ({ ...prev, [id]: total }))} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* ── Desktop table (hidden ≤768px, CSS-controlled) ─────── */}
      <div className="desktop-table">
      <div className="table-wrap">
        <table>
          <thead>
            {viewMode === 'movement' ? (
              <tr>
                <th style={{ width: 32 }}></th>
                <th>Vehicle</th><th>Client</th><th>#</th><th>Date</th>
                <th>From</th><th>To</th><th>Status</th>
              </tr>
            ) : (
              <tr>
                <th style={{ width: 32 }}></th>
                <th>Load No</th><th>Date</th><th>Truck</th><th>Operator</th>
                <th>Customer</th><th>From</th><th>To</th>
                <th>Rate</th><th>Extra Costs</th><th>Total</th><th>Order No</th><th>Status</th>
              </tr>
            )}
          </thead>
          <tbody>
            {loading && <tr><td colSpan={viewMode === 'movement' ? 8 : 13}><div className="loading">Loading…</div></td></tr>}
            {!loading && loads.length === 0 && <tr><td colSpan={viewMode === 'movement' ? 8 : 13}><div className="empty-state">No loads found</div></td></tr>}
            {!loading && loads.map(l => {
              const extra = Number(loadCosts[l.m_load_no] || 0);
              const tot = Number(l.m_rate || 0) + extra;
              const isOpen = expandedRow === l.m_load_no;
              const trailers = [l.m_trailer1, l.m_trailer2].filter(Boolean).join(', ');
              return (
                <React.Fragment key={l.m_load_no}>
                  {viewMode === 'movement' ? (
                    <tr style={{ background: isOpen ? '#e8f4fd' : undefined, cursor: 'pointer' }}
                      onClick={() => toggleRow(l.m_load_no)}>
                      <td style={{ textAlign: 'center', color: '#00AEEF', fontWeight: 700, fontSize: 16 }}>
                        {isOpen ? '▲' : '▼'}
                      </td>
                      <td className="mono" style={{ fontWeight: 600 }}>
                        {l.m_truck || '—'}{trailers && <span style={{ color: '#888', fontWeight: 400 }}> · {trailers}</span>}
                      </td>
                      <td>{l.m_customer}</td>
                      <td className="mono">{l.m_load_no}</td>
                      <td>{fmtDate(l.m_date)}</td>
                      <td>{l.m_from}</td>
                      <td>{l.m_to}</td>
                      <td style={{ fontSize: 12, color: movementStatusColor(l), fontWeight: 600 }}>
                        {movementStatusText(l)}
                      </td>
                    </tr>
                  ) : (
                    <tr style={{ background: isOpen ? '#e8f4fd' : undefined, cursor: 'pointer' }}
                      onClick={() => toggleRow(l.m_load_no)}>
                      <td style={{ textAlign: 'center', color: '#00AEEF', fontWeight: 700, fontSize: 16 }}>
                        {isOpen ? '▲' : '▼'}
                      </td>
                      <td className="mono" style={{ fontWeight: 600 }}>{l.m_load_no}</td>
                      <td>{fmtDate(l.m_date)}</td>
                      <td className="mono">{l.m_truck}</td>
                      <td style={{ fontSize: 12, color: '#555' }}>{l.m_responsible_operator || l.m_operator || '—'}</td>
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
                  )}
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
      </div>{/* end desktop-table */}

      {total > LIMIT && <PaginationBar page={page} total={total} limit={LIMIT} setPage={setPage} />}
      {showModal && <NewLoadModal onClose={() => setShowModal(false)} onCreated={() => { setShowModal(false); fetchLoads(); fetchStats(); }} />}
    </div>
  );
}






