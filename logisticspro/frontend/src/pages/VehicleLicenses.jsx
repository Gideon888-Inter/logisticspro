import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || '';
const token = () => localStorage.getItem('lp_token');
const req = (path) => fetch(API + '/api' + path, {
  headers: { 'Authorization': 'Bearer ' + token() }
}).then(r => r.json());

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getExpiryStatus(dateStr) {
  if (!dateStr) return 'none';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(dateStr);
  const thisMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  if (expiry < today) return 'expired';
  if (expiry <= thisMonthEnd) return 'this-month';
  const next30 = new Date(today); next30.setDate(today.getDate() + 30);
  if (expiry <= next30) return 'soon';
  return 'ok';
}

const STATUS_CONFIG = {
  expired:    { label: 'EXPIRED',          bg: '#fee2e2', border: '#e53e3e', color: '#e53e3e', bar: '#e53e3e' },
  'this-month': { label: 'EXPIRES THIS MONTH', bg: '#fff7ed', border: '#f97316', color: '#f97316', bar: '#f97316' },
  soon:       { label: 'EXPIRES < 30 DAYS', bg: '#fefce8', border: '#eab308', color: '#b45309', bar: '#eab308' },
  ok:         { label: 'VALID',            bg: '#f0fdf4', border: '#86efac', color: '#059669', bar: '#22c55e' },
  none:       { label: 'NO DATE SET',      bg: '#f8fafc', border: '#e2e8f0', color: '#94a3b8', bar: '#cbd5e1' },
};

export default function VehicleLicenses() {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    req('/vehicles')
      .then(v => setVehicles(Array.isArray(v) ? v : []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Sort: expired first, then this month, then soon, then ok, then no date
  const ORDER = ['expired', 'this-month', 'soon', 'ok', 'none'];
  const sorted = [...vehicles]
    .filter(v => v.vh_active !== 'N')
    .map(v => ({ ...v, _status: getExpiryStatus(v.vh_license_expiry) }))
    .filter(v => filter === 'all' || v._status === filter)
    .filter(v => !search || v.vh_code.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const oi = ORDER.indexOf(a._status) - ORDER.indexOf(b._status);
      if (oi !== 0) return oi;
      if (!a.vh_license_expiry) return 1;
      if (!b.vh_license_expiry) return -1;
      return new Date(a.vh_license_expiry) - new Date(b.vh_license_expiry);
    });

  // Counts for filter tabs
  const counts = vehicles.reduce((acc, v) => {
    const s = getExpiryStatus(v.vh_license_expiry);
    acc[s] = (acc[s] || 0) + 1;
    acc.all = (acc.all || 0) + 1;
    return acc;
  }, {});

  const tabs = [
    { key: 'all',        label: 'All Vehicles' },
    { key: 'expired',    label: 'Expired' },
    { key: 'this-month', label: 'This Month' },
    { key: 'soon',       label: 'Next 30 Days' },
    { key: 'ok',         label: 'Valid' },
    { key: 'none',       label: 'No Date Set' },
  ];

  return (
    <div>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#005A8E' }}>Vehicle License Expiry</h2>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>
            Sorted by expiry date — most urgent first
          </div>
        </div>
        <input
          placeholder="Search vehicle code…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 12px', fontSize: 13, border: '1px solid #ddd', borderRadius: 6, width: 200 }}
        />
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {tabs.map(t => {
          const cfg = STATUS_CONFIG[t.key] || {};
          const isActive = filter === t.key;
          return (
            <button key={t.key} onClick={() => setFilter(t.key)} style={{
              padding: '6px 14px', fontSize: 12, borderRadius: 20, cursor: 'pointer', fontWeight: isActive ? 700 : 400,
              border: `2px solid ${isActive ? (cfg.bar || '#00AEEF') : '#e2e8f0'}`,
              background: isActive ? (cfg.bg || '#e8f4fd') : 'white',
              color: isActive ? (cfg.color || '#005A8E') : '#555',
            }}>
              {t.label} {counts[t.key] ? `(${counts[t.key]})` : '(0)'}
            </button>
          );
        })}
      </div>

      {/* Vehicle list */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#aaa' }}>Loading vehicles…</div>
      ) : sorted.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#aaa' }}>No vehicles found</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
          {/* Table header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '120px 100px 120px 1fr 180px 160px',
            background: '#005A8E', color: 'white', padding: '10px 16px',
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', gap: 8,
          }}>
            <div>Vehicle</div>
            <div>Type</div>
            <div>Unit</div>
            <div>Status</div>
            <div>License Expiry</div>
            <div>Days Remaining</div>
          </div>

          {sorted.map((v, i) => {
            const cfg = STATUS_CONFIG[v._status];
            const today = new Date(); today.setHours(0,0,0,0);
            const expiry = v.vh_license_expiry ? new Date(v.vh_license_expiry) : null;
            const daysLeft = expiry ? Math.ceil((expiry - today) / (1000 * 60 * 60 * 24)) : null;

            return (
              <div key={v.vh_code} style={{
                display: 'grid', gridTemplateColumns: '120px 100px 120px 1fr 180px 160px',
                padding: '12px 16px', gap: 8, alignItems: 'center',
                background: cfg.bg,
                borderBottom: `1px solid ${cfg.border}`,
                borderLeft: `4px solid ${cfg.bar}`,
              }}>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14, color: '#1a202c' }}>
                  {v.vh_code}
                </div>
                <div style={{ fontSize: 13, color: '#555' }}>{v.vh_type}</div>
                <div style={{ fontSize: 13, color: '#555' }}>{v.vh_bus_unit || '—'}</div>
                <div>
                  <span style={{
                    display: 'inline-block', padding: '2px 10px', borderRadius: 12,
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
                    background: cfg.bar, color: 'white',
                  }}>
                    {cfg.label}
                  </span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: cfg.color }}>
                  {fmtDate(v.vh_license_expiry)}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>
                  {daysLeft === null ? '—'
                    : daysLeft < 0 ? `${Math.abs(daysLeft)} days overdue`
                    : daysLeft === 0 ? 'Expires TODAY'
                    : `${daysLeft} days`}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
