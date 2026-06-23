import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../lib/AuthContext';
import { api } from '../lib/api';

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

export default function Fleet({ focusServiceDue }) {
  const { user } = useAuth();
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('Y');
  const [sortCol, setSortCol] = useState('vh_code');
  const [sortDir, setSortDir] = useState('asc');
  const [quickFilter, setQuickFilter] = useState('all');  // all | service_due | align_due | cof_expired | license_expired

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
      const r = await api.getVehicles({ active: 'all' });
      setData(Array.isArray(r) ? r : []);
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
      await api.updateVehicle(editVehicle.vh_code, form);
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
              v.vh_registration?.toLowerCase().includes(s) || v.vh_model?.toLowerCase().includes(s))
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
  const total      = data.length;
  const horses     = data.filter(v => v.vh_type === 'Horse').length;
  const trailers   = data.filter(v => v.vh_type === 'Trailer').length;
  const active     = data.filter(v => v.vh_active === 'Y').length;

  // ── Table headings config ────────────────────────────────────────────────────
  const headings = [
    { col: 'vh_code',          label: 'Code' },
    { col: 'vh_type',          label: 'Type' },
    { col: 'vh_year',          label: 'Year' },
    { col: 'make_model',       label: 'Make / Model' },
    { col: 'vh_registration',  label: 'Registration' },
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
        <div className="stat-card"><div className="stat-label">Total Fleet</div><div className="stat-value">{total}</div></div>
        <div className="stat-card"><div className="stat-label">Horses</div><div className="stat-value" style={{color:'#00AEEF'}}>{horses}</div></div>
        <div className="stat-card"><div className="stat-label">Trailers</div><div className="stat-value" style={{color:'#00AEEF'}}>{trailers}</div></div>
        <div className="stat-card"><div className="stat-label">Active</div><div className="stat-value" style={{color:'#059669'}}>{active}</div></div>
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

      {/* Table */}
      <div className="table-wrap" style={{ overflowX: 'auto' }}>
        <table style={{ minWidth: 1100 }}>
          <thead>
            <tr>
              {headings.map(h => (
                <Th key={h.col} col={h.col} label={h.label}
                  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={12}><div className="loading">Loading fleet…</div></td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={12}><div className="empty-state">No vehicles found</div></td></tr>}
            {!loading && filtered.map(v => {
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

