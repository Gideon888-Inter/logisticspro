import { useState, useEffect } from 'react';
import { api } from '../lib/api';

// ── VEHICLES ──────────────────────────────────────────────────
export function Vehicles() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');

  useEffect(() => {
    api.getVehicles({ active: 'Y' }).then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  const filtered = data.filter(v => {
    const s = search.toLowerCase();
    const matchSearch = !s || v.vh_code?.toLowerCase().includes(s) || v.vh_last_location?.toLowerCase().includes(s);
    const matchType = !type || v.vh_type === type;
    return matchSearch && matchType;
  });

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Total fleet</div><div className="stat-value">{data.length}</div></div>
        <div className="stat-card"><div className="stat-label">Horses</div><div className="stat-value">{data.filter(v => v.vh_type === 'Horse').length}</div></div>
        <div className="stat-card"><div className="stat-label">Trailers</div><div className="stat-value">{data.filter(v => v.vh_type === 'Trailer').length}</div></div>
        <div className="stat-card"><div className="stat-label">Due service</div><div className="stat-value" style={{ color: 'var(--accent)' }}>{data.filter(v => v.vh_odometer >= v.vh_next_service - 5000 && v.vh_next_service > 0).length}</div></div>
      </div>
      <div className="filter-bar">
        <input placeholder="Search vehicle code…" value={search} onChange={e => setSearch(e.target.value)} />
        <select value={type} onChange={e => setType(e.target.value)}>
          <option value="">All types</option><option value="Horse">Horse</option><option value="Trailer">Trailer</option><option value="Rigid">Rigid</option>
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Type</th><th>Unit</th><th>Odometer</th><th>Next service</th><th>Last location</th><th>Status</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7}><div className="loading">Loading…</div></td></tr>}
            {!loading && filtered.map(v => (
              <tr key={v.vh_code}>
                <td className="mono">{v.vh_code}</td>
                <td>{v.vh_type}</td>
                <td>{v.vh_bus_unit}</td>
                <td className="mono">{v.vh_odometer?.toLocaleString()} km</td>
                <td className="mono">{v.vh_next_service?.toLocaleString()} km</td>
                <td>{v.vh_last_location || '—'}</td>
                <td><span className={`badge ${v.vh_status === 'EN_ROUTE' ? 'badge-blue' : v.vh_status === 'OFFLOADED' ? 'badge-green' : 'badge-gray'}`}>{v.vh_status || 'AVAILABLE'}</span></td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && <tr><td colSpan={7}><div className="empty-state">No vehicles found</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── DRIVERS ───────────────────────────────────────────────────
export function Drivers() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [unit, setUnit] = useState('');

  useEffect(() => {
    api.getDrivers().then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  const filtered = data.filter(d => {
    const s = search.toLowerCase();
    return (!s || d.d_nickname?.toLowerCase().includes(s) || d.d_id?.toLowerCase().includes(s))
      && (!unit || d.d_bus_unit === unit);
  });

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Total drivers</div><div className="stat-value">{data.length}</div></div>
        <div className="stat-card"><div className="stat-label">Active</div><div className="stat-value" style={{ color: 'var(--green)' }}>{data.filter(d => d.d_active === 'Y').length}</div></div>
        <div className="stat-card"><div className="stat-label">IDC unit</div><div className="stat-value">{data.filter(d => d.d_bus_unit === 'IDC').length}</div></div>
        <div className="stat-card"><div className="stat-label">IDM unit</div><div className="stat-value">{data.filter(d => d.d_bus_unit === 'IDM').length}</div></div>
      </div>
      <div className="filter-bar">
        <input placeholder="Search driver name or ID…" value={search} onChange={e => setSearch(e.target.value)} />
        <select value={unit} onChange={e => setUnit(e.target.value)}>
          <option value="">All units</option><option value="IDC">IDC</option><option value="IDM">IDM</option><option value="MOGWASE">Mogwase</option>
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Name</th><th>Cell</th><th>Unit</th><th>Active</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5}><div className="loading">Loading…</div></td></tr>}
            {!loading && filtered.map(d => (
              <tr key={d.d_id}>
                <td className="mono">{d.d_id}</td>
                <td>{d.d_nickname}</td>
                <td className="mono">{d.d_cell || '—'}</td>
                <td>{d.d_bus_unit}</td>
                <td><span className={`badge ${d.d_active === 'Y' ? 'badge-green' : 'badge-red'}`}>{d.d_active === 'Y' ? 'Active' : 'Inactive'}</span></td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && <tr><td colSpan={5}><div className="empty-state">No drivers found</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── CUSTOMERS ─────────────────────────────────────────────────
export function Customers() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.getCustomers().then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  const filtered = data.filter(c => {
    const s = search.toLowerCase();
    return !s || c.c_name?.toLowerCase().includes(s) || c.c_code?.toLowerCase().includes(s);
  });

  return (
    <div>
      <div className="filter-bar">
        <input placeholder="Search customer name or code…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Customer</th><th>Contacts</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={3}><div className="loading">Loading…</div></td></tr>}
            {!loading && filtered.map(c => (
              <tr key={c.c_code}>
                <td className="mono">{c.c_code}</td>
                <td>{c.c_name}</td>
                <td>{c.lp_customer_contact?.map(x => `${x.cc_name} (${x.cc_cell || x.cc_email || '—'})`).join(', ') || '—'}</td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && <tr><td colSpan={3}><div className="empty-state">No customers found</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── MAINTENANCE ───────────────────────────────────────────────
export function Maintenance() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');

  useEffect(() => {
    api.getMaintenance(status ? { status } : {}).then(setData).catch(console.error).finally(() => setLoading(false));
  }, [status]);

  function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-ZA') : '—'; }
  function fmtR(n) { return n ? 'R ' + Number(n).toLocaleString('en-ZA') : '—'; }

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
                <td><span className={`badge ${m.ma_status === 'COMPLETE' ? 'badge-green' : m.ma_status === 'IN_PROGRESS' ? 'badge-blue' : 'badge-amber'}`}>{m.ma_status}</span></td>
              </tr>
            ))}
            {!loading && data.length === 0 && <tr><td colSpan={8}><div className="empty-state">No maintenance records</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── INVENTORY ─────────────────────────────────────────────────
export function Inventory() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.getInventory().then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  const filtered = data.filter(p => {
    const s = search.toLowerCase();
    return !s || p.p_partno?.toLowerCase().includes(s) || p.p_description?.toLowerCase().includes(s);
  });

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Total parts</div><div className="stat-value">{data.length}</div></div>
        <div className="stat-card"><div className="stat-label">Below min stock</div><div className="stat-value" style={{ color: 'var(--red)' }}>{data.filter(p => p.p_qty < p.p_min).length}</div></div>
        <div className="stat-card"><div className="stat-label">Well-stocked</div><div className="stat-value" style={{ color: 'var(--green)' }}>{data.filter(p => p.p_qty >= p.p_min).length}</div></div>
      </div>
      <div className="filter-bar">
        <input placeholder="Search part no or description…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Part no</th><th>Description</th><th>Qty</th><th>Min</th><th>Max</th><th>Supplier A</th><th>Supplier B</th><th>Stock</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8}><div className="loading">Loading…</div></td></tr>}
            {!loading && filtered.map(p => (
              <tr key={p.l_id}>
                <td className="mono">{p.p_partno}</td>
                <td>{p.p_description}</td>
                <td className="mono">{p.p_qty}</td>
                <td className="mono">{p.p_min}</td>
                <td className="mono">{p.p_max}</td>
                <td>{p.p_suppliera || '—'}</td>
                <td>{p.p_supplierb || '—'}</td>
                <td><span className={`badge ${p.p_qty < p.p_min ? 'badge-red' : p.p_qty < p.p_min * 1.5 ? 'badge-amber' : 'badge-green'}`}>{p.p_qty < p.p_min ? 'LOW' : 'OK'}</span></td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && <tr><td colSpan={8}><div className="empty-state">No parts found</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── ROUTES ────────────────────────────────────────────────────
export function Routes() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getRoutes().then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>From</th><th>To</th><th>Distance</th><th>Rate</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5}><div className="loading">Loading…</div></td></tr>}
            {!loading && data.map(r => (
              <tr key={r.rc_no}>
                <td className="mono">{r.rc_code}</td>
                <td>{r.rc_from}</td>
                <td>{r.rc_to}</td>
                <td className="mono">{r.rc_distance} km</td>
                <td className="mono">R {Number(r.rc_rate).toLocaleString('en-ZA')}</td>
              </tr>
            ))}
            {!loading && data.length === 0 && <tr><td colSpan={5}><div className="empty-state">No routes configured</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
