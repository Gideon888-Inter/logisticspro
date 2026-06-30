import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useAuth } from '../lib/AuthContext';
import { api } from '../lib/api';
import { loadGoogleMaps, resetGoogleMapsLoader } from '../lib/googleMaps';
import Loads from './Loads';
import { canDebugTracking } from '../lib/roles';

// ── Constants ──────────────────────────────────────────────────────────────────
const SERVICE_WARN_KM = 5000;
const SERVICE_INTERVAL = 40000;

// ── Date helpers ───────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getDateStatus(dateStr) {
  if (!dateStr) return 'none';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  if (d < today) return 'expired';
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  if (d <= monthEnd) return 'this-month';
  return 'ok';
}

const DATE_STYLE = {
  expired:      { color: '#e53e3e', bg: '#fff0f0', label: 'EXPIRED' },
  'this-month': { color: '#c05621', bg: '#fff7ed', label: 'THIS MONTH' },
  ok:           { color: '#059669', bg: '#f0fdf4', label: '' },
  none:         { color: '#aaa',    bg: 'transparent', label: 'NOT SET' },
};

function DateCell({ value }) {
  const s = getDateStatus(value);
  const cfg = DATE_STYLE[s];
  return (
    <td style={{ whiteSpace: 'nowrap' }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        color: cfg.color, fontWeight: s !== 'ok' && s !== 'none' ? 700 : 400,
        fontSize: 12,
      }}>
        {s === 'expired' && '🔴'}
        {s === 'this-month' && '🟠'}
        {s === 'ok' && '🟢'}
        {s === 'none' && '⚪'}
        {value ? fmtDate(value) : '—'}
      </span>
    </td>
  );
}

// ── KM due cell (service / wheel alignment) ────────────────────────────────────
function KmDueCell({ nextKm, currentOdo }) {
  if (!nextKm) return <td style={{ color: '#aaa', fontSize: 12 }}>—</td>;
  const remaining = Number(nextKm) - Number(currentOdo || 0);
  const pct = Math.max(0, Math.min(100, (remaining / SERVICE_INTERVAL) * 100));
  let color = '#059669';
  if (remaining < 0) color = '#e53e3e';
  else if (remaining <= SERVICE_WARN_KM) color = '#c05621';

  return (
    <td style={{ whiteSpace: 'nowrap' }}>
      <div style={{ fontSize: 11, color, fontWeight: remaining <= SERVICE_WARN_KM ? 700 : 400 }}>
        {remaining < 0
          ? `${Math.abs(remaining).toLocaleString()} km OVERDUE`
          : `${remaining.toLocaleString()} km remaining`}
      </div>
      <div style={{ marginTop: 3, height: 4, background: '#eee', borderRadius: 2, width: 80 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
    </td>
  );
}

// ── Status badge ───────────────────────────────────────────────────────────────
const STATUS_COLOR = {
  EN_ROUTE: '#00AEEF', PRELOAD: '#7c3aed', AVAILABLE: '#059669',
  OFFLOADED: '#059669', WAIT_APPROVAL: '#d97706', WAIT_ORDER_NO: '#d97706',
  Workshop: '#d97706', Inactive: '#e53e3e', DELETED: '#e53e3e',
};
function StatusBadge({ status }) {
  const s = status || 'AVAILABLE';
  const color = STATUS_COLOR[s] || '#888';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
      fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
      background: color + '22', color, border: `1px solid ${color}44`,
    }}>
      {s.replace(/_/g, ' ')}
    </span>
  );
}

// ── Sortable table heading ─────────────────────────────────────────────────────
function Th({ col, label, sortCol, sortDir, onSort }) {
  const active = sortCol === col;
  return (
    <th onClick={() => onSort(col)} style={{
      cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
      color: active ? '#00AEEF' : 'white',
      background: active ? 'rgba(0,174,239,0.15)' : undefined,
      padding: '10px 12px',
    }}>
      {label} {active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  );
}

// ── Read-only field display ─────────────────────────────────────────────────────
function ROField({ label, value }) {
  return (
    <div className="form-group">
      <label style={{ color: '#888', fontSize: 11 }}>{label} <span style={{ color: '#bbb' }}>(auto)</span></label>
      <div style={{
        padding: '8px 10px', background: '#f8fafc', borderRadius: 4,
        border: '1px solid #e8edf2', fontSize: 13, color: '#555', fontFamily: 'monospace',
      }}>
        {value || '—'}
      </div>
    </div>
  );
}

// ── Export CSV ─────────────────────────────────────────────────────────────────
function exportCSV(data) {
  const headers = ['Code','Type','Year','Make','Model','Registration','VIN',
    'Odometer','Next Service (km)','Next Wheel Alignment (km)',
    'COF Date','License Expiry','Cell','Active','Status'];
  const rows = data.map(v => [
    v.vh_code, v.vh_type, v.vh_year||'', v.vh_make||'', v.vh_model||'',
    v.vh_registration||'', v.vh_vin||'', v.vh_odometer||'',
    v.vh_next_service||'', v.vh_next_wheel||'',
    v.vh_cof_date||'', v.vh_license_expiry||'', v.vh_cell||'',
    v.vh_active, v.vh_status||'',
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'fleet_export.csv'; a.click();
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
// ── ServiceHistoryChecklist — read-only checklist inside Fleet modal ─────────
function ServiceHistoryChecklist({ serviceNo }) {
  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tok = localStorage.getItem('lp_token');
    fetch(
      `${import.meta.env.VITE_API_URL || ''}/api/service/${serviceNo}/checklist`,
      { headers: { Authorization: 'Bearer ' + tok } }
    )
      .then(r => r.json())
      .then(d => setItems(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [serviceNo]);

  if (loading) return <div style={{ color: '#aaa', fontSize: 13 }}>Loading checklist…</div>;
  if (items.length === 0) return (
    <div style={{ color: '#aaa', fontSize: 13, fontStyle: 'italic' }}>No checklist recorded for this service.</div>
  );

  const sections = [];
  const sectionMap = {};
  items.forEach(item => {
    const sec = item.sl_section || 'Checklist';
    if (!sectionMap[sec]) { sectionMap[sec] = []; sections.push(sec); }
    sectionMap[sec].push(item);
  });
  const checked = items.filter(i => i.sl_checked).length;

  return (
    <div style={{ borderTop: '1px solid #e8edf2', paddingTop: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#005A8E', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Service Checklist
        <span style={{ marginLeft: 8, fontWeight: 400, color: '#888', textTransform: 'none', letterSpacing: 0 }}>
          — {checked} of {items.length} items completed
        </span>
      </div>
      {sections.map(sec => (
        <div key={sec} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: '#005A8E', borderBottom: '1px solid #dbeafe', paddingBottom: 3, marginBottom: 6 }}>{sec}</div>
          {sectionMap[sec].map(item => (
            <div key={item.id} style={{
              display: 'grid', gridTemplateColumns: '18px 1fr', gap: 8,
              padding: '5px 0', borderBottom: '1px solid #f8f8f8', alignItems: 'start',
            }}>
              <span style={{ fontSize: 14, color: item.sl_checked ? '#059669' : '#ccc', lineHeight: 1.4 }}>
                {item.sl_checked ? '☑' : '☐'}
              </span>
              <div>
                <span style={{ fontSize: 12, color: item.sl_checked ? '#1a202c' : '#aaa' }}>
                  {item.sl_label}
                </span>
                {item.sl_comment && (
                  <div style={{ fontSize: 11, color: '#666', fontStyle: 'italic', marginTop: 2 }}>
                    💬 {item.sl_comment}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function FleetList({ focusServiceDue }) {
  const { user } = useAuth();
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('Y');
  const [sortCol, setSortCol] = useState('vh_code');
  const [sortDir, setSortDir] = useState('asc');
  const [quickFilter, setQuickFilter] = useState('all');  // all | service_due | align_due | cof_expired | license_expired
  const [expandedHorse, setExpandedHorse] = useState(null); // vh_code of the horse row currently expanded to show its nested trailer(s)

  // Modal state
  const [showModal, setShowModal]   = useState(false);
  const [editVehicle, setEditVehicle] = useState(null);   // the vehicle being edited
  const [form, setForm]             = useState({});
  const [saving, setSaving]         = useState(false);
  const [auditLog, setAuditLog]     = useState([]);
  const [showAudit, setShowAudit]   = useState(false);
  const [activeTab, setActiveTab]   = useState('details'); // 'details' | 'audit' | 'service_history'
  const [serviceHistory, setServiceHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [openServiceCard, setOpenServiceCard] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // getVehicles() is the master vehicle register (every vehicle, including
      // trailers themselves); getFleetOverview() separately computes which
      // trailer(s) are currently linked to each horse from its most recent
      // load (see vehicles.js fleet-overview), plus whether that load is
      // currently active and its load number — needed for the
      // Assigned/Unassigned tiles and the click-through to Loads.
      const [vehiclesRes, overviewRes] = await Promise.all([
        api.getVehicles({ active: 'all' }),
        api.getFleetOverview().catch(() => null), // non-fatal — list still works without it
      ]);
      const overviewByHorse = new Map(
        (overviewRes?.vehicles || []).map(h => [h.vh_code, h])
      );
      const merged = (Array.isArray(vehiclesRes) ? vehiclesRes : []).map(v => {
        const ov = overviewByHorse.get(v.vh_code);
        return {
          ...v,
          linkedTrailers: ov?.trailers || [],
          is_active:      !!ov?.is_active,
          load_no:        ov?.load_no || null,
          load_status:    ov?.load_status || null,
          client_name:    ov?.client_name || null,
        };
      });
      setData(merged);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // If parent navigates here with focusServiceDue, pre-set sort
  useEffect(() => {
    if (focusServiceDue) {
      setSortCol('_service_remaining');
      setSortDir('asc');
    }
  }, [focusServiceDue]);

  // Click-through from a horse to its associated load — dispatches the same
  // global navigation event App.jsx already listens for (lp-navigate), just
  // with a loadNo riding along so the Loads page can open straight to it.
  const goToLoad = (loadNo) => {
    window.dispatchEvent(new CustomEvent('lp-navigate', { detail: { page: 'movement', loadNo } }));
  };

  const openEdit = async (v) => {
    setEditVehicle(v);
    setForm({
      vh_cell:           v.vh_cell || '',
      vh_cof_date:       v.vh_cof_date || '',
      vh_license_expiry: v.vh_license_expiry || '',
      vh_active:         v.vh_active || 'Y',
      vh_is_link:        v.vh_is_link || 'N',
      vh_link_pair:      v.vh_link_pair || '',
    });
    setActiveTab('details');
    setAuditLog([]);
    setShowModal(true);

    // Load audit trail
    try {
      const audit = await fetch(
        `${import.meta.env.VITE_API_URL || ''}/api/vehicles/${v.vh_code}/audit`,
        { headers: { Authorization: 'Bearer ' + localStorage.getItem('lp_token') } }
      ).then(r => r.json());
      setAuditLog(Array.isArray(audit) ? audit : []);
    } catch {}

    // Load service history (completed cards only)
    setHistoryLoading(true);
    setServiceHistory([]);
    try {
      const svc = await fetch(
        `${import.meta.env.VITE_API_URL || ''}/api/service?vehicle=${v.vh_code}&limit=200`,
        { headers: { Authorization: 'Bearer ' + localStorage.getItem('lp_token') } }
      ).then(r => r.json());
      setServiceHistory(
        (svc.data || [])
          .filter(c => c.sc_status === 'COMPLETE')
          .sort((a, b) => new Date(b.sc_date) - new Date(a.sc_date))
      );
    } catch { setServiceHistory([]); }
    finally { setHistoryLoading(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      // Trailer-link fields go through their own endpoint, which enforces
      // server-side invariants (no self-link, both must be trailers, one
      // rear per front). Everything else uses the generic vehicle PATCH.
      const { vh_is_link, vh_link_pair, ...generalFields } = form;
      await api.updateVehicle(editVehicle.vh_code, generalFields);
      if (editVehicle.vh_type === 'Trailer') {
        await api.updateVehicleLink(editVehicle.vh_code, { vh_is_link, vh_link_pair });
      }
      setShowModal(false);
      load();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // ── Sorting ──────────────────────────────────────────────────────────────────
  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const getValue = (v, col) => {
    switch (col) {
      case 'make_model':   return `${v.vh_make||''} ${v.vh_model||''}`.trim();
      case 'vh_odometer':  return Number(v.vh_odometer) || 0;
      case 'vh_next_service': return Number(v.vh_next_service) || 0;
      case '_service_remaining': return (Number(v.vh_next_service)||0) - (Number(v.vh_odometer)||0);
      case '_wheel_remaining': return (Number(v.vh_next_wheel)||0) - (Number(v.vh_odometer)||0);
      case '_linked_trailers': return (v.linkedTrailers || []).map(t => t.code).join(',').toLowerCase();
      case 'vh_cof_date': return v.vh_cof_date || 'zzzz';
      case 'vh_license_expiry': return v.vh_license_expiry || 'zzzz';
      default: return (v[col] || '').toString().toLowerCase();
    }
  };

  // ── Filter + sort ─────────────────────────────────────────────────────────────
  const filtered = data
    .filter(v => {
      const s = search.toLowerCase();
      const odo = Number(v.vh_odometer) || 0;
      const svcRem = v.vh_next_service ? (Number(v.vh_next_service) - odo) : null;
      const whlRem = v.vh_next_wheel   ? (Number(v.vh_next_wheel)   - odo) : null;
      const today  = new Date(); today.setHours(0,0,0,0);
      const monthEnd = new Date(today.getFullYear(), today.getMonth()+1, 0);
      if (quickFilter === 'service_due'     && !(svcRem !== null && svcRem <= SERVICE_WARN_KM)) return false;
      if (quickFilter === 'align_due'       && !(whlRem !== null && whlRem <= SERVICE_WARN_KM)) return false;
      if (quickFilter === 'cof_expired'     && !(v.vh_cof_date && new Date(v.vh_cof_date) < today)) return false;
      if (quickFilter === 'cof_this_month'  && !(v.vh_cof_date && new Date(v.vh_cof_date) >= today && new Date(v.vh_cof_date) <= monthEnd)) return false;
      if (quickFilter === 'lic_expired'     && !(v.vh_license_expiry && new Date(v.vh_license_expiry) < today)) return false;
      if (quickFilter === 'lic_this_month'  && !(v.vh_license_expiry && new Date(v.vh_license_expiry) >= today && new Date(v.vh_license_expiry) <= monthEnd)) return false;
      return (!s || v.vh_code?.toLowerCase().includes(s) || v.vh_make?.toLowerCase().includes(s) ||
              v.vh_registration?.toLowerCase().includes(s) || v.vh_model?.toLowerCase().includes(s) ||
              v.linkedTrailers?.some(t =>
                t.code?.toLowerCase().includes(s) ||
                t.registration?.toLowerCase().includes(s) ||
                t.make?.toLowerCase().includes(s) ||
                t.model?.toLowerCase().includes(s)
              ))
        && (!typeFilter || v.vh_type === typeFilter)
        && (!activeFilter || v.vh_active === activeFilter);
    })
    .sort((a, b) => {
      const av = getValue(a, sortCol);
      const bv = getValue(b, sortCol);
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });

  // ── Stats ────────────────────────────────────────────────────────────────────
  // "Assigned" = currently out on an active load (PRELOAD/EN_ROUTE — see
  // is_active in vehicles.js fleet-overview), not just "has a most-recent
  // load on file" (a horse idle between loads still shows its last load's
  // trailer for reference, but isn't "assigned" right now).
  const allHorses          = data.filter(v => v.vh_type === 'Horse');
  const allTrailers        = data.filter(v => v.vh_type === 'Trailer');
  const totalHorsesCount   = allHorses.length;
  const totalTrailersCount = allTrailers.length;
  const assignedHorses     = allHorses.filter(h => h.is_active).length;
  const unassignedHorses   = totalHorsesCount - assignedHorses;
  const assignedTrailerCodes = new Set();
  allHorses.filter(h => h.is_active).forEach(h => (h.linkedTrailers || []).forEach(t => assignedTrailerCodes.add(t.code)));
  const assignedTrailersCount   = assignedTrailerCodes.size;
  const unassignedTrailersCount = totalTrailersCount - assignedTrailersCount;

  // Trailer codes linked to ANY horse's most recent load (regardless of
  // active status) — used to split the list into Horse-grouped rows vs a
  // standalone "Unlinked Trailers" section, so every trailer stays
  // discoverable even if it's never been on a recorded load yet.
  const everLinkedTrailerCodes = new Set();
  allHorses.forEach(h => (h.linkedTrailers || []).forEach(t => everLinkedTrailerCodes.add(t.code)));

  // The grouped Horse+nested-Trailers view is the default browsing
  // experience. Maintenance/diagnostic filters (quick-filter tabs, or
  // explicitly filtering to Trailers only) fall back to the flat list
  // below instead, since those cut across vehicle type and don't fit a
  // Horse-centric hierarchy well.
  const showGrouped = typeFilter !== 'Trailer' && quickFilter === 'all';
  const horseGroups = filtered.filter(v => v.vh_type === 'Horse');
  const unlinkedTrailers = filtered.filter(v => v.vh_type === 'Trailer' && !everLinkedTrailerCodes.has(v.vh_code));

  // ── Table headings config ────────────────────────────────────────────────────
  const headings = [
    { col: 'vh_code',          label: 'Code' },
    { col: 'vh_type',          label: 'Type' },
    { col: 'vh_year',          label: 'Year' },
    { col: 'make_model',       label: 'Make / Model' },
    { col: 'vh_registration',  label: 'Registration' },
    { col: '_linked_trailers', label: 'Linked Trailer(s)' },
    { col: 'vh_odometer',      label: 'Odometer' },
    { col: '_service_remaining', label: 'Next Service' },
    { col: '_wheel_remaining', label: 'Next Alignment' },
    { col: 'vh_cof_date',      label: 'COF Date' },
    { col: 'vh_license_expiry',label: 'License Expiry' },
    { col: 'vh_status',        label: 'Status' },
    { col: 'vh_active',        label: 'Active' },
  ];

  const thStyle = { textAlign: 'left', padding: '10px 12px', fontSize: 11,
    fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
    background: '#005A8E', color: 'white', whiteSpace: 'nowrap' };

  return (
    <div>
      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Total Horses</div><div className="stat-value" style={{color:'#00AEEF'}}>{totalHorsesCount}</div></div>
        <div className="stat-card"><div className="stat-label">Assigned Horses</div><div className="stat-value" style={{color:'#059669'}}>{assignedHorses}</div></div>
        <div className="stat-card"><div className="stat-label">Unassigned Horses</div><div className="stat-value" style={{color:'#888'}}>{unassignedHorses}</div></div>
        <div className="stat-card"><div className="stat-label">Total Trailers</div><div className="stat-value" style={{color:'#00AEEF'}}>{totalTrailersCount}</div></div>
        <div className="stat-card"><div className="stat-label">Assigned Trailers</div><div className="stat-value" style={{color:'#059669'}}>{assignedTrailersCount}</div></div>
        <div className="stat-card"><div className="stat-label">Unassigned Trailers</div><div className="stat-value" style={{color:'#888'}}>{unassignedTrailersCount}</div></div>
      </div>

      {/* Quick-filter tabs — computed counts */}
      {(() => {
        const today = new Date(); today.setHours(0,0,0,0);
        const monthEnd = new Date(today.getFullYear(), today.getMonth()+1, 0);
        const counts = {
          all:            data.length,
          service_due:    data.filter(v => { const r = v.vh_next_service ? Number(v.vh_next_service)-(Number(v.vh_odometer)||0) : null; return r !== null && r <= SERVICE_WARN_KM; }).length,
          align_due:      data.filter(v => { const r = v.vh_next_wheel   ? Number(v.vh_next_wheel)-(Number(v.vh_odometer)||0) : null; return r !== null && r <= SERVICE_WARN_KM; }).length,
          cof_expired:    data.filter(v => v.vh_cof_date && new Date(v.vh_cof_date) < today).length,
          cof_this_month: data.filter(v => v.vh_cof_date && new Date(v.vh_cof_date) >= today && new Date(v.vh_cof_date) <= monthEnd).length,
          lic_expired:    data.filter(v => v.vh_license_expiry && new Date(v.vh_license_expiry) < today).length,
          lic_this_month: data.filter(v => v.vh_license_expiry && new Date(v.vh_license_expiry) >= today && new Date(v.vh_license_expiry) <= monthEnd).length,
        };
        const tabs = [
          { key: 'all',            label: 'All Vehicles',        color: '#005A8E' },
          { key: 'service_due',    label: '🔧 Service Due',      color: '#d97706' },
          { key: 'align_due',      label: '🔧 Alignment Due',    color: '#7c3aed' },
          { key: 'cof_expired',    label: '🔴 COF Expired',      color: '#e53e3e' },
          { key: 'cof_this_month', label: '🟠 COF This Month',   color: '#c05621' },
          { key: 'lic_expired',    label: '🔴 Lic Expired',      color: '#e53e3e' },
          { key: 'lic_this_month', label: '🟠 Lic This Month',   color: '#c05621' },
        ];
        return (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {tabs.map(t => {
              const active = quickFilter === t.key;
              return (
                <button key={t.key} onClick={() => setQuickFilter(t.key)} style={{
                  padding: '5px 12px', fontSize: 11, fontWeight: active ? 700 : 500,
                  borderRadius: 20, cursor: 'pointer',
                  border: active ? `2px solid ${t.color}` : '2px solid #e2e8f0',
                  background: active ? t.color : 'white',
                  color: active ? 'white' : '#555',
                  transition: 'all 0.15s',
                }}>
                  {t.label} ({counts[t.key]})
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* Search / type / active filters */}
      <div className="filter-bar">
        <input placeholder="Search code, make, registration…" value={search} onChange={e => setSearch(e.target.value)} />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          <option value="Horse">Horse</option>
          <option value="Trailer">Trailer</option>
          <option value="Rigid">Rigid</option>
        </select>
        <select value={activeFilter} onChange={e => setActiveFilter(e.target.value)}>
          <option value="">All</option>
          <option value="Y">Active</option>
          <option value="N">Inactive</option>
        </select>
        <button className="btn btn-sm" onClick={() => exportCSV(filtered)}>⬇ Export CSV</button>
      </div>

      {/* Mobile card list */}
      <div className="mobile-card-list">
        {loading && <div className="loading">Loading fleet…</div>}
        {!loading && showGrouped && horseGroups.length === 0 && unlinkedTrailers.length === 0 && (
          <div className="empty-state">No vehicles found</div>
        )}
        {!loading && showGrouped && (
          <>
            {horseGroups.map(h => {
              const isOpen = expandedHorse === h.vh_code;
              return (
                <div key={h.vh_code} className="data-card" style={{ cursor: 'pointer' }}
                  onClick={() => setExpandedHorse(o => o === h.vh_code ? null : h.vh_code)}>
                  <div className="data-card-header">
                    <div>
                      <div className="data-card-title" style={{fontFamily:'monospace'}}>{h.vh_code}</div>
                      <div className="data-card-sub">Horse · {[h.vh_make,h.vh_model].filter(Boolean).join(' ')||'—'} {h.vh_year?`(${h.vh_year})`:''}</div>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
                      <span style={{fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:10,background:h.vh_active==='Y'?'#059669':'#e53e3e',color:'white'}}>
                        {h.vh_active==='Y'?'Active':'Inactive'}
                      </span>
                      <span style={{ fontSize: 14, color: '#aaa', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
                    </div>
                  </div>
                  <div className="data-card-meta">
                    <div>Reg: <strong style={{fontFamily:'monospace'}}>{h.vh_registration||'—'}</strong></div>
                    <div>ODO: <strong>{h.vh_odometer?Number(h.vh_odometer).toLocaleString()+' km':'—'}</strong></div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6, alignItems: 'center' }}>
                    {h.linkedTrailers?.length > 0 ? h.linkedTrailers.map(t => (
                      <span key={t.code} style={{
                        fontSize: 10, fontFamily: 'monospace', padding: '1px 6px', borderRadius: 4,
                        background: t.confirmed === true ? '#d1fae5' : t.confirmed === false ? '#fef3c7' : '#f1f5f9',
                        color: t.confirmed === true ? '#065f46' : t.confirmed === false ? '#92400e' : '#64748b',
                      }}>
                        🔗 {t.code}{t.confirmed === true ? ' ✓' : t.confirmed === false ? ' ⚠' : ''}
                      </span>
                    )) : <span style={{ fontSize: 11, color: '#bbb' }}>No trailer linked</span>}
                    {h.is_active && h.load_no && (
                      <button onClick={e => { e.stopPropagation(); goToLoad(h.load_no); }} style={{
                        marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                        border: '1px solid #00AEEF', background: '#e8f4fd', color: '#005A8E', cursor: 'pointer',
                      }}>📦 #{h.load_no} →</button>
                    )}
                  </div>
                  {isOpen && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #e2e8f0', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div onClick={e => { e.stopPropagation(); openEdit(h); }} style={{
                        padding: '8px 10px', borderRadius: 6, background: '#f8f9fa', border: '1px solid #e8edf2', cursor: 'pointer',
                      }}>
                        <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Horse</div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{h.vh_code} — {[h.vh_make,h.vh_model].filter(Boolean).join(' ')||'—'}</div>
                      </div>
                      {(h.linkedTrailers || []).map(t => {
                        const full = data.find(d => d.vh_code === t.code);
                        return (
                          <div key={t.code} onClick={e => { e.stopPropagation(); openEdit(full || { vh_code: t.code, vh_type: 'Trailer' }); }} style={{
                            padding: '8px 10px', borderRadius: 6, background: '#f8f9fa', border: '1px solid #e8edf2', cursor: 'pointer',
                          }}>
                            <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Trailer</div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{t.code} — {[t.make,t.model].filter(Boolean).join(' ')||'—'}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {unlinkedTrailers.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#888', margin: '14px 2px 6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Unlinked Trailers
                </div>
                {unlinkedTrailers.map(t => (
                  <div key={t.vh_code} className="data-card" onClick={() => openEdit(t)} style={{ cursor: 'pointer' }}>
                    <div className="data-card-header">
                      <div>
                        <div className="data-card-title" style={{fontFamily:'monospace'}}>{t.vh_code}</div>
                        <div className="data-card-sub">Trailer · {[t.vh_make,t.vh_model].filter(Boolean).join(' ')||'—'}</div>
                      </div>
                      <span style={{fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:10,background:t.vh_active==='Y'?'#059669':'#e53e3e',color:'white'}}>
                        {t.vh_active==='Y'?'Active':'Inactive'}
                      </span>
                    </div>
                    <div className="data-card-meta">
                      <div>Reg: <strong style={{fontFamily:'monospace'}}>{t.vh_registration||'—'}</strong></div>
                      <div>COF: <strong>{t.vh_cof_date||'—'}</strong></div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
        {!loading && !showGrouped && filtered.length === 0 && <div className="empty-state">No vehicles found</div>}
        {!loading && !showGrouped && filtered.map(v => {
          const svcRemaining = (Number(v.vh_next_service)||0) - (Number(v.vh_odometer)||0);
          const whlRemaining = (Number(v.vh_next_wheel)||0) - (Number(v.vh_odometer)||0);
          const alert = svcRemaining < 0 || whlRemaining < 0 ? '#e53e3e'
            : (svcRemaining <= SERVICE_WARN_KM || whlRemaining <= SERVICE_WARN_KM) ? '#d97706' : 'var(--blue)';
          return (
            <div key={v.vh_code} className="data-card" onClick={() => openEdit(v)} style={{borderLeftColor: alert}}>
              <div className="data-card-header">
                <div>
                  <div className="data-card-title" style={{fontFamily:'monospace'}}>{v.vh_code}</div>
                  <div className="data-card-sub">{v.vh_type} · {[v.vh_make,v.vh_model].filter(Boolean).join(' ')||'—'} {v.vh_year?`(${v.vh_year})`:''}</div>
                </div>
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
                  <StatusBadge status={v.vh_status} />
                  <span style={{fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:10,background:v.vh_active==='Y'?'#059669':'#e53e3e',color:'white'}}>
                    {v.vh_active==='Y'?'Active':'Inactive'}
                  </span>
                </div>
              </div>
              <div className="data-card-meta">
                <div>Reg: <strong style={{fontFamily:'monospace'}}>{v.vh_registration||'—'}</strong></div>
                <div>ODO: <strong>{v.vh_odometer?Number(v.vh_odometer).toLocaleString()+' km':'—'}</strong></div>
                <div>Svc due: <strong style={{color: svcRemaining<0?'#e53e3e':svcRemaining<=SERVICE_WARN_KM?'#d97706':'inherit'}}>
                  {v.vh_next_service?Number(v.vh_next_service).toLocaleString()+' km':'—'}
                </strong></div>
                <div>COF: <strong>{v.vh_cof_date||'—'}</strong></div>
              </div>
              {v.linkedTrailers?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                  {v.linkedTrailers.map(t => (
                    <span key={t.code} style={{
                      fontSize: 10, fontFamily: 'monospace', padding: '1px 6px', borderRadius: 4,
                      background: t.confirmed === true ? '#d1fae5' : t.confirmed === false ? '#fef3c7' : '#f1f5f9',
                      color: t.confirmed === true ? '#065f46' : t.confirmed === false ? '#92400e' : '#64748b',
                    }}>
                      🔗 {t.code}{t.confirmed === true ? ' ✓' : t.confirmed === false ? ' ⚠' : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* Desktop table */}
      <div className="desktop-table">
      <div className="table-wrap" style={{ overflowX: 'auto' }}>
        <table style={{ minWidth: 1100 }}>
          <thead>
            <tr>
              {showGrouped
                ? <>
                    <th style={thStyle}></th>
                    <th style={thStyle}>Code</th><th style={thStyle}>Type</th><th style={thStyle}>Make / Model</th>
                    <th style={thStyle}>Registration</th><th style={thStyle}>Linked Trailer(s)</th>
                    <th style={thStyle}>Current Load</th><th style={thStyle}>Active</th>
                  </>
                : headings.map(h => (
                    <Th key={h.col} col={h.col} label={h.label}
                      sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={13}><div className="loading">Loading fleet…</div></td></tr>}
            {!loading && showGrouped && horseGroups.length === 0 && unlinkedTrailers.length === 0 && (
              <tr><td colSpan={8}><div className="empty-state">No vehicles found</div></td></tr>
            )}
            {!loading && showGrouped && horseGroups.map(h => {
              const isOpen = expandedHorse === h.vh_code;
              return (
                <Fragment key={h.vh_code}>
                  <tr onClick={() => setExpandedHorse(o => o === h.vh_code ? null : h.vh_code)}
                    style={{ background: isOpen ? '#e8f4fd' : undefined, cursor: 'pointer' }}>
                    <td style={{ textAlign: 'center', color: '#00AEEF', fontWeight: 700 }}>{isOpen ? '▲' : '▼'}</td>
                    <td className="mono" style={{ fontWeight: 700 }}>{h.vh_code}</td>
                    <td>Horse</td>
                    <td>{[h.vh_make, h.vh_model].filter(Boolean).join(' ') || '—'}</td>
                    <td className="mono">{h.vh_registration || '—'}</td>
                    <td>
                      {h.linkedTrailers?.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {h.linkedTrailers.map(t => (
                            <span key={t.code} title={[t.make, t.model].filter(Boolean).join(' ') || undefined} style={{
                              fontSize: 10, fontFamily: 'monospace', padding: '1px 6px', borderRadius: 4,
                              background: t.confirmed === true ? '#d1fae5' : t.confirmed === false ? '#fef3c7' : '#f1f5f9',
                              color: t.confirmed === true ? '#065f46' : t.confirmed === false ? '#92400e' : '#64748b',
                            }}>
                              🔗 {t.code}{t.confirmed === true ? ' ✓' : t.confirmed === false ? ' ⚠' : ''}
                            </span>
                          ))}
                        </div>
                      ) : <span style={{ color: '#bbb' }}>—</span>}
                    </td>
                    <td>
                      {h.is_active && h.load_no ? (
                        <button onClick={e => { e.stopPropagation(); goToLoad(h.load_no); }} style={{
                          fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                          border: '1px solid #00AEEF', background: '#e8f4fd', color: '#005A8E', cursor: 'pointer',
                        }}>📦 #{h.load_no} →</button>
                      ) : <span style={{ color: '#bbb' }}>—</span>}
                    </td>
                    <td>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 10,
                        fontSize: 10, fontWeight: 700,
                        background: h.vh_active === 'Y' ? '#059669' : '#e53e3e', color: 'white',
                      }}>{h.vh_active === 'Y' ? 'Active' : 'Inactive'}</span>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={8} style={{ background: '#fafbfc', padding: '10px 16px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                          <div onClick={() => openEdit(h)} style={{
                            minWidth: 220, padding: '8px 12px', borderRadius: 6, background: 'white', border: '1px solid #e8edf2', cursor: 'pointer',
                          }}>
                            <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Horse — click to edit</div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{h.vh_code} — {[h.vh_make,h.vh_model].filter(Boolean).join(' ')||'—'}</div>
                          </div>
                          {(h.linkedTrailers || []).length === 0 && (
                            <div style={{ fontSize: 12, color: '#aaa', alignSelf: 'center' }}>No trailer currently linked</div>
                          )}
                          {(h.linkedTrailers || []).map(t => {
                            const full = data.find(d => d.vh_code === t.code);
                            return (
                              <div key={t.code} onClick={() => openEdit(full || { vh_code: t.code, vh_type: 'Trailer' })} style={{
                                minWidth: 220, padding: '8px 12px', borderRadius: 6, background: 'white', border: '1px solid #e8edf2', cursor: 'pointer',
                              }}>
                                <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Trailer — click to edit</div>
                                <div style={{ fontSize: 13, fontWeight: 600 }}>{t.code} — {[t.make,t.model].filter(Boolean).join(' ')||'—'}</div>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!loading && showGrouped && unlinkedTrailers.length > 0 && (
              <>
                <tr><td colSpan={8} style={{ background: '#f8f9fa', fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '8px 12px' }}>
                  Unlinked Trailers
                </td></tr>
                {unlinkedTrailers.map(t => (
                  <tr key={t.vh_code} onClick={() => openEdit(t)} style={{ cursor: 'pointer' }}>
                    <td></td>
                    <td className="mono" style={{ fontWeight: 700 }}>{t.vh_code}</td>
                    <td>Trailer</td>
                    <td>{[t.vh_make, t.vh_model].filter(Boolean).join(' ') || '—'}</td>
                    <td className="mono">{t.vh_registration || '—'}</td>
                    <td><span style={{ color: '#bbb' }}>—</span></td>
                    <td><span style={{ color: '#bbb' }}>—</span></td>
                    <td>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 10,
                        fontSize: 10, fontWeight: 700,
                        background: t.vh_active === 'Y' ? '#059669' : '#e53e3e', color: 'white',
                      }}>{t.vh_active === 'Y' ? 'Active' : 'Inactive'}</span>
                    </td>
                  </tr>
                ))}
              </>
            )}
            {!loading && !showGrouped && filtered.length === 0 && <tr><td colSpan={13}><div className="empty-state">No vehicles found</div></td></tr>}
            {!loading && !showGrouped && filtered.map(v => {
              const svcRemaining = (Number(v.vh_next_service)||0) - (Number(v.vh_odometer)||0);
              const whlRemaining = (Number(v.vh_next_wheel)||0) - (Number(v.vh_odometer)||0);
              const rowAlert = svcRemaining < 0 || whlRemaining < 0
                ? '#fff0f0'
                : (svcRemaining <= SERVICE_WARN_KM || whlRemaining <= SERVICE_WARN_KM)
                  ? '#fffbeb'
                  : undefined;

              return (
                <tr key={v.vh_code} onClick={() => openEdit(v)}
                  style={{ background: rowAlert, cursor: 'pointer' }}>
                  <td className="mono" style={{ fontWeight: 700 }}>{v.vh_code}</td>
                  <td>{v.vh_type}</td>
                  <td>{v.vh_year || '—'}</td>
                  <td>{[v.vh_make, v.vh_model].filter(Boolean).join(' ') || '—'}</td>
                  <td className="mono">{v.vh_registration || '—'}</td>
                  <td>
                    {v.linkedTrailers?.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {v.linkedTrailers.map(t => (
                          <span key={t.code} title={[t.make, t.model].filter(Boolean).join(' ') || undefined} style={{
                            fontSize: 10, fontFamily: 'monospace', padding: '1px 6px', borderRadius: 4,
                            background: t.confirmed === true ? '#d1fae5' : t.confirmed === false ? '#fef3c7' : '#f1f5f9',
                            color: t.confirmed === true ? '#065f46' : t.confirmed === false ? '#92400e' : '#64748b',
                          }}>
                            🔗 {t.code}{t.confirmed === true ? ' ✓' : t.confirmed === false ? ' ⚠' : ''}
                          </span>
                        ))}
                      </div>
                    ) : (v.vh_type === 'Horse' ? <span style={{ color: '#bbb' }}>—</span> : null)}
                  </td>
                  <td className="mono" style={{ fontWeight: 600 }}>
                    {v.vh_odometer ? Number(v.vh_odometer).toLocaleString() + ' km' : '—'}
                  </td>
                  <KmDueCell nextKm={v.vh_next_service} currentOdo={v.vh_odometer} />
                  <KmDueCell nextKm={v.vh_next_wheel}   currentOdo={v.vh_odometer} />
                  <DateCell value={v.vh_cof_date} />
                  <DateCell value={v.vh_license_expiry} />
                  <td><StatusBadge status={v.vh_status} /></td>
                  <td>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
                      fontSize: 10, fontWeight: 700,
                      background: v.vh_active === 'Y' ? '#059669' : '#e53e3e',
                      color: 'white',
                    }}>
                      {v.vh_active === 'Y' ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>{/* end desktop-table */}

      {/* ── Edit Modal ─────────────────────────────────────────────────────── */}
      {showModal && editVehicle && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 660, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div className="modal-header">
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  {editVehicle.vh_code} — {editVehicle.vh_make} {editVehicle.vh_model}
                </div>
                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                  {editVehicle.vh_type} · {editVehicle.vh_year || ''}
                </div>
              </div>
              <button onClick={() => setShowModal(false)}
                style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e8edf2', background: '#f8fafc' }}>
              {[
                { key: 'details',         label: '📋 Vehicle Details' },
                { key: 'service_history', label: `🔧 Service History (${serviceHistory.length})` },
                { key: 'audit',           label: `📜 Audit Trail (${auditLog.length})` },
              ].map(tab => (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                  padding: '10px 20px', fontSize: 12, fontWeight: activeTab === tab.key ? 700 : 400,
                  border: 'none', background: 'none', cursor: 'pointer',
                  borderBottom: activeTab === tab.key ? '2px solid #005A8E' : '2px solid transparent',
                  color: activeTab === tab.key ? '#005A8E' : '#888',
                  whiteSpace: 'nowrap',
                }}>
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Body */}
            <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>

              {activeTab === 'details' && (
                <>
                  {/* Read-only identity fields */}
                  <div style={{ background: '#f0f8ff', borderRadius: 6, padding: '12px 14px', marginBottom: 16, border: '1px solid #bee3f8' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#005A8E', letterSpacing: '0.08em', marginBottom: 10, textTransform: 'uppercase' }}>
                      🔒 Read-Only — Vehicle Identity
                    </div>
                    <div className="form-row">
                      <ROField label="Vehicle Code" value={editVehicle.vh_code} />
                      <ROField label="Type" value={editVehicle.vh_type} />
                    </div>
                    <div className="form-row">
                      <ROField label="Year" value={editVehicle.vh_year} />
                      <ROField label="Make" value={editVehicle.vh_make} />
                    </div>
                    <div className="form-row">
                      <ROField label="Model" value={editVehicle.vh_model} />
                      <ROField label="Registration" value={editVehicle.vh_registration} />
                    </div>
                    <div className="form-row">
                      <ROField label="VIN Number" value={editVehicle.vh_vin} />
                    </div>
                  </div>

                  {/* Read-only live values */}
                  <div style={{ background: '#f0fdf4', borderRadius: 6, padding: '12px 14px', marginBottom: 16, border: '1px solid #bbf7d0' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#059669', letterSpacing: '0.08em', marginBottom: 10, textTransform: 'uppercase' }}>
                      🔄 Auto-Calculated from Load Cards
                    </div>
                    <div className="form-row">
                      <ROField label="Current Odometer" value={editVehicle.vh_odometer ? Number(editVehicle.vh_odometer).toLocaleString() + ' km' : '—'} />
                      <ROField label="Status (from last load)" value={editVehicle.vh_status || 'AVAILABLE'} />
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label style={{ color: '#888', fontSize: 11 }}>Next Service <span style={{ color: '#bbb' }}>(last + {SERVICE_INTERVAL.toLocaleString()} km)</span></label>
                        <div style={{ padding: '8px 10px', background: '#f8fafc', borderRadius: 4, border: '1px solid #e8edf2', fontSize: 13, color: '#555', fontFamily: 'monospace' }}>
                          {editVehicle.vh_next_service ? Number(editVehicle.vh_next_service).toLocaleString() + ' km' : '—'}
                          {editVehicle.vh_next_service && editVehicle.vh_odometer && (
                            <span style={{
                              marginLeft: 8, fontSize: 11, fontWeight: 700,
                              color: (Number(editVehicle.vh_next_service) - Number(editVehicle.vh_odometer)) <= 0 ? '#e53e3e'
                                : (Number(editVehicle.vh_next_service) - Number(editVehicle.vh_odometer)) <= SERVICE_WARN_KM ? '#c05621'
                                : '#888',
                            }}>
                              ({((Number(editVehicle.vh_next_service) - Number(editVehicle.vh_odometer)) > 0 ? '+' : '') +
                                (Number(editVehicle.vh_next_service) - Number(editVehicle.vh_odometer)).toLocaleString()} km)
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="form-group">
                        <label style={{ color: '#888', fontSize: 11 }}>Next Wheel Alignment <span style={{ color: '#bbb' }}>(last + {SERVICE_INTERVAL.toLocaleString()} km)</span></label>
                        <div style={{ padding: '8px 10px', background: '#f8fafc', borderRadius: 4, border: '1px solid #e8edf2', fontSize: 13, color: '#555', fontFamily: 'monospace' }}>
                          {editVehicle.vh_next_wheel ? Number(editVehicle.vh_next_wheel).toLocaleString() + ' km' : '—'}
                          {editVehicle.vh_next_wheel && editVehicle.vh_odometer && (
                            <span style={{
                              marginLeft: 8, fontSize: 11, fontWeight: 700,
                              color: (Number(editVehicle.vh_next_wheel) - Number(editVehicle.vh_odometer)) <= 0 ? '#e53e3e'
                                : (Number(editVehicle.vh_next_wheel) - Number(editVehicle.vh_odometer)) <= SERVICE_WARN_KM ? '#c05621'
                                : '#888',
                            }}>
                              ({((Number(editVehicle.vh_next_wheel) - Number(editVehicle.vh_odometer)) > 0 ? '+' : '') +
                                (Number(editVehicle.vh_next_wheel) - Number(editVehicle.vh_odometer)).toLocaleString()} km)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Editable fields */}
                  <div style={{ background: 'white', borderRadius: 6, padding: '12px 14px', border: '1px solid #e8edf2' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#005A8E', letterSpacing: '0.08em', marginBottom: 10, textTransform: 'uppercase' }}>
                      ✏️ Editable Fields
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>COF Date</label>
                        <input type="date" value={form.vh_cof_date}
                          onChange={e => set('vh_cof_date', e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label>License Expiry</label>
                        <input type="date" value={form.vh_license_expiry}
                          onChange={e => set('vh_license_expiry', e.target.value)} />
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Cell Number</label>
                        <input value={form.vh_cell}
                          onChange={e => set('vh_cell', e.target.value)}
                          placeholder="e.g. 082 555 0101" />
                      </div>
                      <div className="form-group">
                        <label>Active</label>
                        <select value={form.vh_active} onChange={e => set('vh_active', e.target.value)}>
                          <option value="Y">Yes — available for loads</option>
                          <option value="N">No — excluded from new loads</option>
                        </select>
                        {form.vh_active === 'N' && (
                          <div style={{ fontSize: 11, color: '#e53e3e', marginTop: 4 }}>
                            ⚠️ This vehicle will not appear when creating new load cards.
                          </div>
                        )}
                      </div>
                    </div>

                    {editVehicle.vh_type === 'Trailer' && (
                      <div style={{ marginTop: 14 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed',
                          letterSpacing: '0.08em', textTransform: 'uppercase',
                          marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                          🔗 Link Configuration
                          <span style={{ fontSize: 10, fontWeight: 400, color: '#aaa',
                            textTransform: 'none', letterSpacing: 0 }}>
                            — linked trailers auto-pair on 18m load cards
                          </span>
                        </div>
                        <div className="form-row">
                          <div className="form-group">
                            <label>Is Link Trailer?</label>
                            <select value={form.vh_is_link}
                              onChange={e => {
                                set('vh_is_link', e.target.value);
                                if (e.target.value === 'N') set('vh_link_pair', '');
                              }}>
                              <option value="N">No — standalone trailer</option>
                              <option value="Y">Yes — part of a linked pair</option>
                            </select>
                          </div>
                          <div className="form-group">
                            <label>
                              Paired With{' '}
                              {form.vh_is_link !== 'Y' && (
                                <span style={{ color: '#bbb', fontWeight: 400 }}>(set Link to Yes first)</span>
                              )}
                            </label>
                            <select
                              value={form.vh_link_pair}
                              onChange={e => set('vh_link_pair', e.target.value)}
                              disabled={form.vh_is_link !== 'Y'}
                            >
                              <option value="">— Select paired trailer —</option>
                              {data.filter(v => v.vh_type === 'Trailer' && v.vh_code !== editVehicle.vh_code)
                                .map(v => (
                                  <option key={v.vh_code} value={v.vh_code}>
                                    {v.vh_code}{v.vh_make ? ` — ${v.vh_make} ${v.vh_model || ''}` : ''}
                                  </option>
                                ))
                              }
                            </select>
                            {form.vh_is_link === 'Y' && form.vh_link_pair && (
                              <div style={{ fontSize: 11, color: '#7c3aed', marginTop: 4 }}>
                                🔗 When selected on an 18m load, <strong>{form.vh_link_pair}</strong> will auto-fill as Trailer 2.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {activeTab === 'service_history' && (
                <div>
                  {historyLoading && (
                    <div style={{ color:'#888', fontSize:13, padding:'20px 0' }}>Loading service history…</div>
                  )}
                  {!historyLoading && serviceHistory.length === 0 && (
                    <div className="empty-state" style={{ padding: 40 }}>No completed services for this vehicle yet.</div>
                  )}
                  {!historyLoading && serviceHistory.map(c => (
                    <div key={c.sc_no} style={{
                      display: 'flex', alignItems: 'center', gap: 16,
                      padding: '12px 0', borderBottom: '1px solid #f0f4f8',
                    }}>
                      <div style={{ flex: '0 0 90px' }}>
                        <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>Service No.</div>
                        <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: '#1a202c' }}>{c.sc_no}</div>
                      </div>
                      <div style={{ flex: '0 0 90px' }}>
                        <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>Date</div>
                        <div style={{ fontSize: 13 }}>{fmtDate(c.sc_date)}</div>
                      </div>
                      <div style={{ flex: '0 0 110px' }}>
                        <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>Completed KM</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#059669', fontFamily: 'monospace' }}>
                          {c.sc_completion_km ? Number(c.sc_completion_km).toLocaleString() + ' km' : '—'}
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>Trigger</div>
                        <div style={{ fontSize: 12, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.sc_trigger || '—'}
                        </div>
                      </div>
                      <button onClick={() => setOpenServiceCard(c)} style={{
                        padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                        background: '#eef4fb', color: '#005A8E', border: '1px solid #bee3f8',
                        borderRadius: 6, whiteSpace: 'nowrap', flexShrink: 0,
                      }}>
                        View →
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'audit' && (
                <div>
                  {auditLog.length === 0 ? (
                    <div className="empty-state" style={{ padding: 40 }}>No audit entries yet</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                      {auditLog.map((entry, i) => (
                        <div key={i} style={{
                          padding: '10px 0', borderBottom: '1px solid #f0f0f0',
                          display: 'grid', gridTemplateColumns: '160px 80px 1fr',
                          gap: 12, alignItems: 'start', fontSize: 12,
                        }}>
                          <div style={{ color: '#888' }}>{fmtDateTime(entry.created_at)}</div>
                          <div style={{ fontWeight: 700, color: entry.va_action === 'CREATED' ? '#059669' : '#005A8E' }}>
                            {entry.va_action}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: '#333', marginBottom: 2 }}>{entry.va_operator}</div>
                            {entry.va_fields && (() => {
                              try {
                                const fields = JSON.parse(entry.va_fields);
                                return (
                                  <div style={{ color: '#666', fontSize: 11 }}>
                                    {Object.entries(fields).map(([k, v]) => (
                                      <span key={k} style={{ display: 'inline-block', margin: '1px 4px 1px 0',
                                        padding: '1px 6px', background: '#f0f0f0', borderRadius: 4 }}>
                                        {k.replace('vh_', '')}: <strong>{v || '—'}</strong>
                                      </span>
                                    ))}
                                  </div>
                                );
                              } catch { return null; }
                            })()}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            {activeTab === 'details' && (
              <div className="modal-footer">
                <button className="btn" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Service card detail viewer (from service history) ── */}
      {openServiceCard && (
        <div className="modal-overlay" onClick={() => setOpenServiceCard(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}
            style={{ width: 580, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header">
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  {openServiceCard.sc_no} — {openServiceCard.sc_vehicle}
                </div>
                <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
                  ✅ Completed · {fmtDate(openServiceCard.sc_date)}
                </div>
              </div>
              <button onClick={() => setOpenServiceCard(null)}
                style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
                {[
                  ['Service No.',  openServiceCard.sc_no],
                  ['Vehicle',      openServiceCard.sc_vehicle],
                  ['Date',         fmtDate(openServiceCard.sc_date)],
                  ['Trigger',      openServiceCard.sc_trigger || '—'],
                  ['Opening KM',   openServiceCard.sc_odometer ? Number(openServiceCard.sc_odometer).toLocaleString() + ' km' : '—'],
                  ['Completed KM', openServiceCard.sc_completion_km ? Number(openServiceCard.sc_completion_km).toLocaleString() + ' km' : '—'],
                  ['Operator',     openServiceCard.sc_operator || '—'],
                  ['Notes',        openServiceCard.sc_notes || '—'],
                ].map(([lbl, val]) => (
                  <div key={lbl}>
                    <div style={{ fontSize: 10, color: '#888', fontWeight: 700, textTransform: 'uppercase',
                      letterSpacing: '0.06em', marginBottom: 3 }}>{lbl}</div>
                    <div style={{ fontSize: 13, fontWeight: lbl === 'Completed KM' ? 700 : 400,
                      color: lbl === 'Completed KM' ? '#059669' : '#1a202c' }}>{val}</div>
                  </div>
                ))}
              </div>
              <ServiceHistoryChecklist serviceNo={openServiceCard.sc_no} />
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setOpenServiceCard(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// Live Location tab — vehicle list (Horse/Trailer) + live Pulsit GPS map.
// Polls /api/tracking/positions every 20s and plots markers via Google Maps.
// Matches vehicles to positions on vh_registration (falls back to vh_code).
// ════════════════════════════════════════════════════════════════════════════
const POSITION_POLL_MS = 20000;

function fmtRelativeTime(iso) {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  if (isNaN(diffMs)) return null;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ── Google Maps tracking map (shared loader — see lib/googleMaps.js) ──────
function TrackingMap({ vehicles, positions, selectedCode, onSelectVehicle }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});
  const [mapError, setMapError] = useState(null);
  const [retryKey, setRetryKey] = useState(0);

  // South Africa bounding box — fleet never leaves the country, so there's
  // no reason to let the map pan/zoom out to the rest of the world.
  const SA_BOUNDS = { north: -21.5, south: -35.5, east: 33.5, west: 15.0 };

  // Init map once
  useEffect(() => {
    let cancelled = false;
    setMapError(null);
    loadGoogleMaps((err) => {
      if (cancelled) return;
      if (err) { setMapError(err); return; }
      try {
        const bounds = new window.google.maps.LatLngBounds(
          { lat: SA_BOUNDS.south, lng: SA_BOUNDS.west },
          { lat: SA_BOUNDS.north, lng: SA_BOUNDS.east }
        );
        mapRef.current = new window.google.maps.Map(mapElRef.current, {
          restriction: { latLngBounds: bounds, strictBounds: false },
          minZoom: 5,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });
        mapRef.current.fitBounds(bounds);
      } catch (e) {
        console.error('TrackingMap init failed:', e);
        setMapError(e.message || 'Failed to load the map');
      }
    });
    return () => { cancelled = true; };
  }, [retryKey]);

  // Plot / update markers whenever positions change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.google) return;

    try {
      const seen = new Set();
      let firstFit = !markersRef.current.__fitted;

      positions.forEach(p => {
        if (p.lat == null || p.lng == null) return;
        const vehicle = vehicles.find(v => v.vh_code === p.code || v.vh_registration === p.regNo);
        const code = vehicle?.vh_code || p.code || p.regNo;
        seen.add(code);
        const isSelected = code === selectedCode;
        const position = { lat: p.lat, lng: p.lng };

        const icon = {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: isSelected ? 16 : 13,
          fillColor: isSelected ? '#005A8E' : '#0ea5e9',
          fillOpacity: 1,
          strokeColor: 'white',
          strokeWeight: 2,
        };
        const label = {
          text: code,
          color: 'white',
          fontSize: '10px',
          fontWeight: '700',
        };

        if (markersRef.current[code]) {
          markersRef.current[code].setPosition(position);
          markersRef.current[code].setIcon(icon);
          markersRef.current[code].setLabel(label);
        } else {
          const marker = new window.google.maps.Marker({
            position, map, icon, label, title: code,
          });
          marker.addListener('click', () => onSelectVehicle?.(vehicle || { vh_code: code }));
          markersRef.current[code] = marker;
        }
      });

      // Drop markers for vehicles no longer in the feed
      Object.keys(markersRef.current).forEach(code => {
        if (code === '__fitted') return;
        if (!seen.has(code)) {
          markersRef.current[code].setMap(null);
          delete markersRef.current[code];
        }
      });

      // Fit bounds once, on first data load
      if (firstFit && positions.length > 0) {
        const pts = positions.filter(p => p.lat != null && p.lng != null);
        if (pts.length > 0) {
          const bounds = new window.google.maps.LatLngBounds();
          pts.forEach(p => bounds.extend({ lat: p.lat, lng: p.lng }));
          map.fitBounds(bounds, 60);
          markersRef.current.__fitted = true;
        }
      }
    } catch (e) {
      console.error('TrackingMap marker update failed:', e);
      setMapError(e.message || 'Failed to plot vehicle positions');
    }
  }, [positions, vehicles, selectedCode, onSelectVehicle]);

  // Pan to selected vehicle
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedCode) return;
    try {
      const marker = markersRef.current[selectedCode];
      if (marker) map.panTo(marker.getPosition());
    } catch (e) {
      console.error('TrackingMap pan failed:', e);
    }
  }, [selectedCode]);

  const retry = () => {
    resetGoogleMapsLoader();
    Object.keys(markersRef.current).forEach(k => { if (k !== '__fitted') markersRef.current[k].setMap?.(null); });
    markersRef.current = {};
    mapRef.current = null;
    setRetryKey(k => k + 1);
  };

  if (mapError) {
    return (
      <div style={{ width: '100%', height: '100%', minHeight: 400, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24 }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>⚠️</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#c05621', marginBottom: 6 }}>Map failed to load</div>
        <div style={{ fontSize: 12, color: '#888', maxWidth: 360, marginBottom: 12 }}>{mapError}</div>
        <button onClick={retry} style={{
          fontSize: 12, padding: '6px 14px', border: '1px solid #ddd', borderRadius: 6,
          background: 'white', cursor: 'pointer', color: '#555',
        }}>↻ Retry</button>
      </div>
    );
  }

  return <div ref={mapElRef} style={{ width: '100%', height: '100%', minHeight: 400, borderRadius: 8 }} />;
}


function LiveLocation() {
  const { user } = useAuth();
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [horses, setHorses] = useState([]);          // fleet-overview rows — horses only, trailers nested per row
  const [horsesLoading, setHorsesLoading] = useState(true);
  const [search, setSearch]     = useState('');
  const [selected, setSelected] = useState(null);
  const [positions, setPositions] = useState([]);
  const [posError, setPosError] = useState(null);
  const [posLoading, setPosLoading] = useState(true);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugData, setDebugData] = useState(null);
  const [debugLoading, setDebugLoading] = useState(false);
  // Collapsed by default on narrow screens (map-only) since a fixed-width
  // sidebar leaves almost no room for the map on a phone; expanded by
  // default on desktop, matching the previous always-on behaviour there.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 768
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.getVehicles({ active: 'all' });
      setVehicles(Array.isArray(r) ? r : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  // Horses with their currently-linked trailer(s) (from the horse's most
  // recent load assignment) and confirmation status against live GPS —
  // same source as the Fleet dashboard tab, so trailer pairing here always
  // matches what's shown there.
  const loadHorses = useCallback(async () => {
    try {
      const r = await api.getFleetOverview();
      setHorses(Array.isArray(r?.vehicles) ? r.vehicles : []);
    } catch (e) { console.error(e); }
    finally { setHorsesLoading(false); }
  }, []);

  const loadPositions = useCallback(async () => {
    try {
      const r = await api.getTrackingPositions();
      setPositions(Array.isArray(r) ? r : []);
      setPosError(null);
    } catch (e) {
      setPosError(e.message || 'Could not reach tracking service');
    } finally {
      setPosLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    loadHorses();
    const id = setInterval(loadHorses, POSITION_POLL_MS);
    return () => clearInterval(id);
  }, [loadHorses]);

  useEffect(() => {
    loadPositions();
    const id = setInterval(loadPositions, POSITION_POLL_MS);
    return () => clearInterval(id);
  }, [loadPositions]);

  const runDebug = async () => {
    setDebugOpen(true);
    setDebugLoading(true);
    try {
      const r = await api.getTrackingDebug();
      setDebugData(r);
    } catch (e) {
      setDebugData({ error: e.message });
    } finally {
      setDebugLoading(false);
    }
  };

  const filtered = horses.filter(v => {
    const s = search.trim().toLowerCase();
    if (!s) return true;
    return v.vh_code?.toLowerCase().includes(s) ||
      v.vh_make?.toLowerCase().includes(s) ||
      v.vh_model?.toLowerCase().includes(s) ||
      v.client_name?.toLowerCase().includes(s) ||
      v.trailers?.some(t => t.code?.toLowerCase().includes(s));
  });

  const positionFor = (v) => positions.find(p => p.code === v?.vh_code || p.regNo === v?.vh_registration);
  const selectedPosition = positionFor(selected);

  // The sidebar list works off fleet-overview rows (horses + nested
  // trailers), but the map/info-panel below expect a full vehicle record
  // (vh_type/vh_registration etc.) — resolve to that on selection so
  // clicking a trailer marker on the map still works exactly as before.
  const selectHorse = (row) => {
    const full = vehicles.find(x => x.vh_code === row.vh_code);
    setSelected(full || { vh_code: row.vh_code, vh_type: 'Horse', vh_make: row.vh_make, vh_model: row.vh_model });
  };

  return (
    <div>
      {canDebugTracking(user) && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button onClick={runDebug} style={{
            fontSize: 11, padding: '5px 10px', border: '1px solid #ddd', borderRadius: 6,
            background: 'white', color: '#888', cursor: 'pointer',
          }}>🔧 Debug tracking API</button>
        </div>
      )}

      {debugOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setDebugOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'white', borderRadius: 8, maxWidth: 800, width: '100%',
            maxHeight: '80vh', overflow: 'auto', padding: 20,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <strong>Pulsit tracking debug</strong>
              <button onClick={() => setDebugOpen(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            {debugLoading
              ? <div style={{ fontSize: 13, color: '#888' }}>Calling Pulsit…</div>
              : <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(debugData, null, 2)}</pre>}
          </div>
        </div>
      )}

      {posError && (
        <div style={{ background: '#fff7ed', border: '1px solid #fcd9b8', color: '#c05621',
          borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 10 }}>
          Tracking feed unavailable: {posError}
          {canDebugTracking(user) && ' — use Debug tracking API above to see why.'}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }} className="live-location-layout">
        {!sidebarCollapsed && (
          <>
            <div className="live-location-backdrop" onClick={() => setSidebarCollapsed(true)} />
            <div className="live-location-sidebar" style={{ width: 300, flexShrink: 0, background: 'white', border: '1px solid #e8edf2',
              borderRadius: 8, display: 'flex', flexDirection: 'column', maxHeight: 640 }}>
              <div style={{ padding: 10, borderBottom: '1px solid #e8edf2', display: 'flex', gap: 6, alignItems: 'center' }}>
                <input placeholder="Search horse, trailer, client…" value={search} onChange={e => setSearch(e.target.value)}
                  style={{ flex: 1, padding: '7px 10px', fontSize: 13, border: '1px solid #ddd',
                    borderRadius: 6, outline: 'none' }} />
                <button onClick={() => setSidebarCollapsed(true)} title="Hide list — map only" style={{
                  flexShrink: 0, width: 32, height: 32, border: '1px solid #ddd', borderRadius: 6,
                  background: 'white', cursor: 'pointer', color: '#888', fontSize: 14,
                }}>✕</button>
              </div>
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {(loading || horsesLoading) && <div style={{ padding: 16, fontSize: 13, color: '#888' }}>Loading vehicles…</div>}
                {!horsesLoading && filtered.length === 0 && (
                  <div style={{ padding: 16, fontSize: 13, color: '#888' }}>No horses match.</div>
                )}
                {!horsesLoading && filtered.map(v => {
                  const isTracked = v.lat != null;
                  return (
                    <div key={v.vh_code} onClick={() => selectHorse(v)} style={{
                      padding: '10px 12px', borderBottom: '1px solid #f0f2f5', cursor: 'pointer',
                      background: selected?.vh_code === v.vh_code ? '#eef6fb' : 'white',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                          background: isTracked ? '#10b981' : '#d1d5db' }} />
                        <div style={{ fontWeight: 700, fontSize: 13, fontFamily: 'monospace' }}>{v.vh_code}</div>
                        {v.load_no && <span style={{ fontSize: 10, color: '#005A8E', fontFamily: 'monospace' }}>#{v.load_no}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: '#888', marginLeft: 13 }}>
                        {[v.vh_make, v.vh_model].filter(Boolean).join(' ') || '—'}{v.client_name ? ` · ${v.client_name}` : ''}
                      </div>
                      {v.trailers?.length > 0 && (
                        <div style={{ marginLeft: 13, marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {v.trailers.map(t => (
                            <span key={t.code} title={
                              t.confirmed === true ? 'Confirmed — near horse' :
                              t.confirmed === false ? 'Unconfirmed — check pairing' :
                              t.tracked ? '' : 'Not GPS-tracked'
                            } style={{
                              fontSize: 10, fontFamily: 'monospace', padding: '1px 6px', borderRadius: 4,
                              background: t.confirmed === true ? '#d1fae5' : t.confirmed === false ? '#fef3c7' : '#f1f5f9',
                              color: t.confirmed === true ? '#065f46' : t.confirmed === false ? '#92400e' : '#64748b',
                            }}>
                              🚛 {t.code}{t.confirmed === true ? ' ✓' : t.confirmed === false ? ' ⚠' : ''}
                            </span>
                          ))}
                        </div>
                      )}
                      {v.lastUpdate && (
                        <div style={{ fontSize: 10, color: '#aaa', marginLeft: 13, marginTop: 3 }}>{fmtRelativeTime(v.lastUpdate)}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* ── Map ── */}
        <div style={{ flex: 1, background: '#eef1f4', border: '1px solid #e8edf2', borderRadius: 8,
          overflow: 'hidden', minHeight: 400, position: 'relative' }}>
          {sidebarCollapsed && (
            <button onClick={() => setSidebarCollapsed(false)} style={{
              position: 'absolute', top: 12, left: 12, zIndex: 30,
              background: 'white', border: '1px solid #e8edf2', borderRadius: 8,
              padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#005A8E',
              boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
            }}>☰ Show Vehicles</button>
          )}
          {posLoading && positions.length === 0 ? (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🛰️</div>
              <div style={{ fontSize: 13, color: '#888' }}>Connecting to tracking feed…</div>
            </div>
          ) : (
            <TrackingMap
              vehicles={vehicles}
              positions={positions}
              selectedCode={selected?.vh_code}
              onSelectVehicle={setSelected}
            />
          )}

          {selected && (
            <div style={{ position: 'absolute', bottom: 14, left: 14, background: 'white',
              border: '1px solid #e8edf2', borderRadius: 8, padding: '10px 16px', fontSize: 13,
              boxShadow: '0 2px 10px rgba(0,0,0,0.12)', zIndex: 20 }}>
              <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{selected.vh_code}</div>
              <div style={{ color: '#888' }}>{selected.vh_type} · {[selected.vh_make, selected.vh_model].filter(Boolean).join(' ') || '—'}</div>
              {selectedPosition ? (
                <div style={{ color: '#555', marginTop: 4 }}>
                  <div>
                    {selectedPosition.speed != null && <>{Math.round(selectedPosition.speed)} km/h · </>}
                    {selectedPosition.ignition === 1 ? 'Ignition on' : selectedPosition.ignition === 0 ? 'Ignition off' : null}
                  </div>
                  {selectedPosition.location && (
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2, maxWidth: 220 }}>{selectedPosition.location}</div>
                  )}
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{fmtRelativeTime(selectedPosition.lastUpdate) || 'position live'}</div>
                </div>
              ) : (
                <div style={{ color: '#aaa', marginTop: 4 }}>No live position for this vehicle</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Fleet — page-level tabs: Live Location / Movement / Fleet List.
// Movement reuses the actual Loads page component directly (same data,
// same actions — refresh, new load, offload stops, approvals, etc.) so
// there is no separate/duplicated logic to keep in sync.
// ════════════════════════════════════════════════════════════════════════════
export default function Fleet({ focusServiceDue }) {
  const [pageTab, setPageTab] = useState(focusServiceDue ? 'list' : 'movement');

  const pageTabs = [
    { key: 'live',     label: 'Live Location' },
    { key: 'movement', label: 'Movement' },
    { key: 'list',     label: 'Fleet List' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '2px solid #e8edf2', marginBottom: 16, background: 'white',
        borderRadius: '8px 8px 0 0', overflow: 'hidden', border: '1px solid #e8edf2' }}>
        {pageTabs.map(t => {
          const active = pageTab === t.key;
          return (
            <button key={t.key} onClick={() => setPageTab(t.key)} style={{
              flex: 1, padding: '12px 8px', fontSize: 13, fontWeight: active ? 700 : 400,
              border: 'none', background: active ? 'white' : '#f8fafc',
              borderBottom: active ? '3px solid #005A8E' : '3px solid transparent',
              color: active ? '#005A8E' : '#888', cursor: 'pointer', transition: 'all 0.15s',
            }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {pageTab === 'live'     && <LiveLocation />}
      {pageTab === 'movement' && <Loads viewMode="movement" />}
      {pageTab === 'list'     && <FleetList focusServiceDue={focusServiceDue} />}
    </div>
  );
}
