import { useState, useEffect } from 'react';
import { api } from '../lib/api';

// ── MAINTENANCE ───────────────────────────────────────────────
// NOTE: this file previously also exported Vehicles, Drivers, Customers,
// Inventory, and Routes components — none of which were imported anywhere
// in the app (App.jsx only ever imports `Maintenance` from here). Those
// were fully superseded by the dedicated Fleet.jsx, Drivers.jsx,
// Clients.jsx, Inventory.jsx, and Rates.jsx pages, which already have the
// mobile card / desktop table treatment these duplicates lacked. Removed
// as dead code; Maintenance is the only live export and has been given
// the same mobile-card-list / desktop-table pattern used everywhere else.
export function Maintenance() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');

  useEffect(() => {
    api.getMaintenance(status ? { status } : {}).then(setData).catch(console.error).finally(() => setLoading(false));
  }, [status]);

  function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-ZA') : '—'; }
  function fmtR(n) { return n ? 'R ' + Number(n).toLocaleString('en-ZA') : '—'; }
  function statusBadgeClass(s) {
    return s === 'COMPLETE' ? 'badge-green' : s === 'IN_PROGRESS' ? 'badge-blue' : 'badge-amber';
  }

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Total records</div><div className="stat-value">{data.length}</div></div>
        <div className="stat-card"><div className="stat-label">Open</div><div className="stat-value" style={{ color: 'var(--accent)' }}>{data.filter(m => m.ma_status === 'OPEN').length}</div></div>
        <div className="stat-card"><div className="stat-label">In progress</div><div className="stat-value" style={{ color: 'var(--blue)' }}>{data.filter(m => m.ma_status === 'IN_PROGRESS').length}</div></div>
        <div className="stat-card"><div className="stat-label">Completed</div><div className="stat-value" style={{ color: 'var(--green)' }}>{data.filter(m => m.ma_status === 'COMPLETE').length}</div></div>
      </div>
      <div className="filter-bar">
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option><option value="OPEN">Open</option><option value="IN_PROGRESS">In Progress</option><option value="COMPLETE">Complete</option>
        </select>
      </div>

      {/* Mobile card list */}
      <div className="mobile-card-list">
        {loading && <div className="loading">Loading…</div>}
        {!loading && data.length === 0 && <div className="empty-state">No maintenance records</div>}
        {!loading && data.map(m => (
          <div key={m.ma_incident_no} className="data-card" style={{ cursor: 'default' }}>
            <div className="data-card-header">
              <div>
                <div className="data-card-title">{m.ma_vehicle}</div>
                <div className="data-card-sub">#{m.ma_incident_no} · {fmtDate(m.ma_date)}</div>
              </div>
              <span className={`badge ${statusBadgeClass(m.ma_status)}`}>{m.ma_status}</span>
            </div>
            <div className="data-card-meta">
              <div>Service: <strong>{m.ma_service_type}</strong></div>
              <div>Supplier: <strong>{m.ma_supplier || '—'}</strong></div>
              <div>Labour: <strong>{fmtR(m.ma_labour)}</strong></div>
              <div>KM at service: <strong>{m.ma_km?.toLocaleString()} km</strong></div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="desktop-table">
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Vehicle</th><th>Date</th><th>Service type</th><th>Supplier</th><th>Labour</th><th>KM at service</th><th>Status</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={8}><div className="loading">Loading…</div></td></tr>}
              {!loading && data.map(m => (
                <tr key={m.ma_incident_no}>
                  <td className="mono">{m.ma_incident_no}</td>
                  <td className="mono">{m.ma_vehicle}</td>
                  <td>{fmtDate(m.ma_date)}</td>
                  <td>{m.ma_service_type}</td>
                  <td>{m.ma_supplier || '—'}</td>
                  <td className="mono">{fmtR(m.ma_labour)}</td>
                  <td className="mono">{m.ma_km?.toLocaleString()} km</td>
                  <td><span className={`badge ${statusBadgeClass(m.ma_status)}`}>{m.ma_status}</span></td>
                </tr>
              ))}
              {!loading && data.length === 0 && <tr><td colSpan={8}><div className="empty-state">No maintenance records</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
