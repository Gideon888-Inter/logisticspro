// v2.1.0
import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || '';
const token = () => localStorage.getItem('lp_token');
const req = (path) => fetch(API+'/api'+path, {
  headers: {'Authorization':'Bearer '+token()}
}).then(r=>r.json());

function fmtR(n) {
  if (!n && n !== 0) return 'R 0';
  return 'R ' + Number(n).toLocaleString('en-ZA', {minimumFractionDigits:0});
}

function formatMonthLabel(year, month) {
  return new Date(year, month - 1, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
}

function generateMonthOptions() {
  const options = [];
  const now = new Date();
  let y = 2024, m = 1;
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
    options.push({ year: y, month: m, label: formatMonthLabel(y, m) });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return options.reverse();
}

// Simple bar chart
function BarChart({ data, color='#00AEEF', valuePrefix='', valueSuffix='' }) {
  if (!data || data.length === 0) return <div style={{color:'#aaa',fontSize:12,padding:'8px 0'}}>No data for this month</div>;
  const max = Math.max(...data.map(d => d.value));
  return (
    <div style={{display:'flex', flexDirection:'column', gap:8}}>
      {data.map((d,i) => (
        <div key={i} style={{display:'flex', alignItems:'center', gap:10}}>
          <div style={{width:140, fontSize:12, color:'#555', textAlign:'right', flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={d.label}>{d.label}</div>
          <div style={{flex:1, background:'#f0f0f0', borderRadius:4, overflow:'hidden', height:24}}>
            <div style={{
              width: max > 0 ? `${(d.value/max)*100}%` : '0%',
              background: color, height:'100%', borderRadius:4,
              display:'flex', alignItems:'center', paddingLeft:8,
              transition:'width 0.5s ease',
              minWidth: d.value > 0 ? 40 : 0,
            }}>
              <span style={{color:'white', fontSize:11, fontWeight:600, whiteSpace:'nowrap'}}>
                {valuePrefix}{typeof d.value === 'number' ? d.value.toLocaleString('en-ZA') : d.value}{valueSuffix}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Simple pie chart using SVG
function PieChart({ data }) {
  if (!data || data.length === 0 || data.every(d => d.value === 0)) {
    return <div style={{color:'#aaa',fontSize:12,padding:'8px 0'}}>No data for this month</div>;
  }
  const total = data.reduce((s,d) => s + d.value, 0);
  const colors = ['#00AEEF','#005A8E','#4FC3F7','#0288D1','#B3E5FC'];
  let cumulative = 0;
  const size = 160;
  const cx = size/2, cy = size/2, r = 65;

  const slices = data.map((d, i) => {
    const pct = total > 0 ? d.value / total : 0;
    const startAngle = cumulative * 2 * Math.PI - Math.PI/2;
    cumulative += pct;
    const endAngle = cumulative * 2 * Math.PI - Math.PI/2;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const largeArc = pct > 0.5 ? 1 : 0;
    return { path: `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z`, color: colors[i % colors.length], pct, label: d.label, value: d.value };
  });

  return (
    <div style={{display:'flex', alignItems:'center', gap:20, flexWrap:'wrap'}}>
      <svg width={size} height={size}>
        {slices.map((s,i) => (
          <path key={i} d={s.path} fill={s.color} stroke="white" strokeWidth="2" />
        ))}
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize="13" fontWeight="600" fill="#333">
          {total}
        </text>
        <text x={cx} y={cy+16} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="#888">
          loads
        </text>
      </svg>
      <div style={{display:'flex', flexDirection:'column', gap:8}}>
        {slices.map((s,i) => (
          <div key={i} style={{display:'flex', alignItems:'center', gap:8}}>
            <div style={{width:12, height:12, borderRadius:2, background:s.color, flexShrink:0}} />
            <div style={{fontSize:12}}>
              <span style={{fontWeight:600}}>{s.label}</span>
              <span style={{color:'#888', marginLeft:6}}>{s.value} loads ({Math.round(s.pct*100)}%)</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PDP Expiry Tile ────────────────────────────────────────────
function PdpTile({ drivers, onNavigate }) {
  const [expanded, setExpanded] = useState(false);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const next30 = new Date(today); next30.setDate(today.getDate() + 30);

  const expired = drivers
    .filter(d => d.d_pdp_expiry && new Date(d.d_pdp_expiry) < today && d.d_active === 'Y')
    .sort((a, b) => new Date(a.d_pdp_expiry) - new Date(b.d_pdp_expiry));

  const expiring = drivers
    .filter(d => {
      if (!d.d_pdp_expiry || d.d_active !== 'Y') return false;
      const dt = new Date(d.d_pdp_expiry);
      return dt >= today && dt <= next30;
    })
    .sort((a, b) => new Date(a.d_pdp_expiry) - new Date(b.d_pdp_expiry));

  const total = expired.length + expiring.length;
  const fmtD = (d) => new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div style={{
      background: 'white', borderRadius: 8, borderTop: '3px solid #e53e3e',
      boxShadow: '0 2px 12px rgba(0,0,0,0.08)', overflow: 'hidden',
    }}>
      {/* Tile header — always visible, same style as stat cards */}
      <div style={{ padding: '16px 20px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          📋 Driver PDP
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: total > 0 ? '#e53e3e' : '#059669' }}>
          {total > 0 ? total : '✓ All clear'}
        </div>
        <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
          {total === 0
            ? 'No PDP issues'
            : [
                expired.length > 0 ? `${expired.length} expired` : null,
                expiring.length > 0 ? `${expiring.length} expiring ≤30 days` : null,
              ].filter(Boolean).join(' · ')
          }
        </div>
      </div>

      {/* Action row */}
      {total > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderTop: '1px solid #f3f4f6', padding: '8px 20px',
          background: '#fafafa',
        }}>
          <button
            onClick={() => onNavigate && onNavigate('drivers-list')}
            style={{ fontSize: 12, color: '#005A8E', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
            View all drivers →
          </button>
          <button
            onClick={() => setExpanded(e => !e)}
            style={{ fontSize: 12, color: '#555', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
            {expanded ? 'Hide ▲' : 'Details ▼'}
          </button>
        </div>
      )}

      {/* Expandable detail list */}
      {expanded && total > 0 && (
        <div style={{ padding: '8px 20px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {expired.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#e53e3e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2, marginTop: 4 }}>
                Already Expired
              </div>
              {expired.map(d => (
                <div key={d.d_id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: '#fee2e2', borderRadius: 4, padding: '6px 12px',
                  border: '1px solid #fca5a5',
                }}>
                  <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'monospace' }}>{d.d_id}</span>
                  <span style={{ fontSize: 12, color: '#555' }}>{d.d_nickname}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#e53e3e' }}>Expired: {fmtD(d.d_pdp_expiry)}</span>
                </div>
              ))}
            </>
          )}
          {expiring.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: expired.length > 0 ? 8 : 4, marginBottom: 2 }}>
                Expiring Within 30 Days
              </div>
              {expiring.map(d => (
                <div key={d.d_id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: '#fff7ed', borderRadius: 4, padding: '6px 12px',
                  border: '1px solid #fed7aa',
                }}>
                  <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'monospace' }}>{d.d_id}</span>
                  <span style={{ fontSize: 12, color: '#555' }}>{d.d_nickname}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#f97316' }}>Expires: {fmtD(d.d_pdp_expiry)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── License Expiry Tile ────────────────────────────────────────
function LicenseTile({ vehicles, onNavigate }) {
  const [expanded, setExpanded] = useState(false);
  const today = new Date();
  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const thisMonthEnd   = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const expiring = vehicles
    .filter(v => {
      if (!v.vh_license_expiry) return false;
      const d = new Date(v.vh_license_expiry);
      return d >= thisMonthStart && d <= thisMonthEnd;
    })
    .sort((a, b) => new Date(a.vh_license_expiry) - new Date(b.vh_license_expiry));

  const expired = vehicles
    .filter(v => v.vh_license_expiry && new Date(v.vh_license_expiry) < thisMonthStart)
    .sort((a, b) => new Date(a.vh_license_expiry) - new Date(b.vh_license_expiry));

  const total = expiring.length + expired.length;
  const fmtD = (d) => new Date(d).toLocaleDateString('en-ZA', { day:'2-digit', month:'short', year:'numeric' });

  return (
    <div style={{
      background: 'white', borderRadius: 8, borderTop: '3px solid #e53e3e',
      boxShadow: '0 2px 12px rgba(0,0,0,0.08)', overflow: 'hidden',
    }}>
      <div style={{ padding: '16px 20px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          🚨 Vehicle Licenses
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: total > 0 ? '#e53e3e' : '#059669' }}>
          {total > 0 ? total : '✓ All clear'}
        </div>
        <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
          {total === 0
            ? 'No license issues'
            : [
                expired.length > 0 ? `${expired.length} expired` : null,
                expiring.length > 0 ? `${expiring.length} expiring this month` : null,
              ].filter(Boolean).join(' · ')
          }
        </div>
      </div>

      {total > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderTop: '1px solid #f3f4f6', padding: '8px 20px', background: '#fafafa',
        }}>
          <button
            onClick={() => onNavigate && onNavigate('vehicles')}
            style={{ fontSize: 12, color: '#005A8E', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
            View all vehicles →
          </button>
          <button
            onClick={() => setExpanded(e => !e)}
            style={{ fontSize: 12, color: '#555', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
            {expanded ? 'Hide ▲' : 'Details ▼'}
          </button>
        </div>
      )}

      {expanded && total > 0 && (
        <div style={{ padding: '8px 20px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {expired.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#e53e3e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2, marginTop: 4 }}>
                Already Expired
              </div>
              {expired.map(v => (
                <div key={v.vh_code} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: '#fee2e2', borderRadius: 4, padding: '6px 12px',
                  border: '1px solid #fca5a5',
                }}>
                  <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'monospace' }}>{v.vh_code}</span>
                  <span style={{ fontSize: 12, color: '#555' }}>{v.vh_type}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#e53e3e' }}>Expired: {fmtD(v.vh_license_expiry)}</span>
                </div>
              ))}
            </>
          )}
          {expiring.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: expired.length > 0 ? 8 : 4, marginBottom: 2 }}>
                Expiring This Month
              </div>
              {expiring.map(v => (
                <div key={v.vh_code} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: '#fff7ed', borderRadius: 4, padding: '6px 12px',
                  border: '1px solid #fed7aa',
                }}>
                  <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'monospace' }}>{v.vh_code}</span>
                  <span style={{ fontSize: 12, color: '#555' }}>{v.vh_type}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#f97316' }}>Expires: {fmtD(v.vh_license_expiry)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Status badge colors
const STATUS_COLORS = {
  PRELOAD: '#94a3b8', EN_ROUTE: '#3b82f6', OFFLOADED: '#10b981',
  WAIT_ORDER_NO: '#f59e0b', WAIT_APPROVAL: '#f59e0b', WAIT_POD_SCAN: '#8b5cf6',
  WAIT_INVOICE_NO: '#f97316', LOAD_INVOICED: '#059669', REJECTED: '#ef4444',
  PENDING_KM_APPROVAL: '#f97316', KM_CORRECTION_NEEDED: '#ef4444',
};


// ── Service Due Tile ───────────────────────────────────────────
function ServiceTile({ vehicles, onNavigate }) {
  const [expanded, setExpanded] = useState(false);
  const WARN_KM = 5000;

  const dueVehicles = vehicles
    .filter(v => {
      const odo = Number(v.vh_odometer) || 0;
      const svcRem = v.vh_next_service ? (Number(v.vh_next_service) - odo) : null;
      const whlRem = v.vh_next_wheel   ? (Number(v.vh_next_wheel)   - odo) : null;
      return (svcRem !== null && svcRem <= WARN_KM) ||
             (whlRem !== null && whlRem <= WARN_KM);
    })
    .map(v => {
      const odo = Number(v.vh_odometer) || 0;
      return {
        ...v,
        _svcRem: v.vh_next_service ? Number(v.vh_next_service) - odo : null,
        _whlRem: v.vh_next_wheel   ? Number(v.vh_next_wheel)   - odo : null,
      };
    })
    .sort((a, b) => {
      const minA = Math.min(a._svcRem ?? 99999, a._whlRem ?? 99999);
      const minB = Math.min(b._svcRem ?? 99999, b._whlRem ?? 99999);
      return minA - minB;
    });

  const overdue = dueVehicles.filter(v => (v._svcRem !== null && v._svcRem <= 0) ||
                                          (v._whlRem !== null && v._whlRem <= 0));
  const total = dueVehicles.length;

  const fmtRem = (rem) => {
    if (rem === null) return null;
    if (rem <= 0) return Math.abs(rem).toLocaleString('en-ZA') + ' km OVERDUE';
    return rem.toLocaleString('en-ZA') + ' km remaining';
  };

  return (
    <div style={{
      background: 'white', borderRadius: 8, borderTop: '3px solid #e53e3e',
      boxShadow: '0 2px 12px rgba(0,0,0,0.08)', overflow: 'hidden',
    }}>
      <div style={{ padding: '16px 20px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          🔧 Service / Alignment
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: total > 0 ? '#e53e3e' : '#059669' }}>
          {total > 0 ? total : '✓ All clear'}
        </div>
        <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
          {total === 0
            ? 'No service due'
            : [
                overdue.length > 0 ? `${overdue.length} overdue` : null,
                (total - overdue.length) > 0 ? `${total - overdue.length} due within 5 000 km` : null,
              ].filter(Boolean).join(' · ')
          }
        </div>
      </div>

      {total > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderTop: '1px solid #f3f4f6', padding: '8px 20px', background: '#fafafa',
        }}>
          <button
            onClick={() => onNavigate && onNavigate('vehicles')}
            style={{ fontSize: 12, color: '#005A8E', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
            View fleet →
          </button>
          <button
            onClick={() => setExpanded(e => !e)}
            style={{ fontSize: 12, color: '#555', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
            {expanded ? 'Hide ▲' : 'Details ▼'}
          </button>
        </div>
      )}

      {expanded && total > 0 && (
        <div style={{ padding: '8px 20px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {dueVehicles.map(v => {
            const svcBad = v._svcRem !== null && v._svcRem <= 0;
            const whlBad = v._whlRem !== null && v._whlRem <= 0;
            const rowBg  = (svcBad || whlBad) ? '#fee2e2' : '#fff7ed';
            const rowBdr = (svcBad || whlBad) ? '#fca5a5' : '#fed7aa';
            return (
              <div key={v.vh_code} style={{
                display: 'grid', gridTemplateColumns: '120px 90px 1fr 1fr',
                alignItems: 'center', gap: 12,
                background: rowBg, borderRadius: 4,
                padding: '6px 12px', border: '1px solid ' + rowBdr,
              }}>
                <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 13 }}>{v.vh_code}</span>
                <span style={{ fontSize: 12, color: '#555' }}>{v.vh_type}</span>
                {v._svcRem !== null
                  ? <span style={{ fontSize: 12, fontWeight: svcBad ? 700 : 400, color: svcBad ? '#e53e3e' : '#c05621' }}>
                      Service: {fmtRem(v._svcRem)}
                    </span>
                  : <span />
                }
                {v._whlRem !== null
                  ? <span style={{ fontSize: 12, fontWeight: whlBad ? 700 : 400, color: whlBad ? '#e53e3e' : '#c05621' }}>
                      Alignment: {fmtRem(v._whlRem)}
                    </span>
                  : <span />
                }
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Dashboard({ onNavigate }) {
  const [loads, setLoads] = useState([]);
  const [users, setUsers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const monthOptions = generateMonthOptions();
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
  );

  useEffect(() => {
    setLoading(true);
    const [selYear, selMon] = selectedMonth.split('-');
    const from = `${selYear}-${selMon}-01`;
    // Calculate last day of selected month
    const lastDay = new Date(Number(selYear), Number(selMon), 0).getDate();
    const to = `${selYear}-${selMon}-${String(lastDay).padStart(2,'0')}`;
    Promise.all([
      req(`/loads?date_from=${from}&date_to=${to}&limit=2000`),
      req('/users').catch(()=>[]),
      req('/vehicles').catch(()=>[]),
      req('/drivers').catch(()=>[]),
    ]).then(([l, u, v, dr]) => {
      setLoads(l.data || []);
      setUsers(Array.isArray(u) ? u : []);
      setVehicles(Array.isArray(v) ? v : []);
      setDrivers(Array.isArray(dr) ? dr : []);
    }).catch(console.error)
    .finally(() => setLoading(false));
  }, [selectedMonth]);

  if (loading) return <div className="loading" style={{paddingTop:40}}>Loading dashboard…</div>;

  // ── Calculations ──────────────────────────────────────────
  const activeLoads = loads.filter(l=>l.m_status!=='DELETED');
  const totalRevenue = activeLoads.reduce((s,l) => s+Number(l.m_rate||0), 0);
  const billedRevenue = activeLoads.filter(l=>l.m_status==='LOAD_INVOICED').reduce((s,l) => s+Number(l.m_rate||0), 0);
  const unbilledRevenue = totalRevenue - billedRevenue;
  const totalLoads = activeLoads.length;
  const enRoute = activeLoads.filter(l=>l.m_status==='EN_ROUTE').length;
  const notBilled = activeLoads.filter(l=>!['LOAD_INVOICED','DELETED'].includes(l.m_status)).length;

  // Revenue by operator region
  const operators = users.filter(u => u.u_role==='OPERATOR' || u.u_role==='MANAGER');
  const revenueByRegion = operators.map(op => {
    const opLoads = activeLoads.filter(l => l.m_responsible_operator === op.u_username || l.m_operator === op.u_username);
    return {
      label: op.u_region || op.u_name || op.u_username,
      value: opLoads.reduce((s,l) => s+Number(l.m_rate||0), 0),
      count: opLoads.length,
    };
  }).filter(r => r.count > 0);

  // Top clients by revenue
  const clientMap = {};
  activeLoads.forEach(l => {
    const key = l.lp_customers?.c_name || l.m_customer || 'Unknown';
    if (!clientMap[key]) clientMap[key] = 0;
    clientMap[key] += Number(l.m_rate||0);
  });
  const topClients = Object.entries(clientMap)
    .map(([label, value]) => ({label, value}))
    .sort((a,b) => b.value-a.value).slice(0,5);

  // Top drivers by load count
  const driverMap = {};
  activeLoads.forEach(l => {
    const key = l.m_driver_id || 'Unassigned';
    driverMap[key] = (driverMap[key]||0) + 1;
  });
  const topDrivers = Object.entries(driverMap)
    .map(([label, value]) => ({label, value}))
    .sort((a,b) => b.value-a.value).slice(0,5);

  // Top routes by load count
  const routeMap = {};
  activeLoads.forEach(l => {
    if (l.m_from && l.m_to) {
      const key = `${l.m_from} → ${l.m_to}`;
      routeMap[key] = (routeMap[key]||0) + 1;
    }
  });
  const topRoutes = Object.entries(routeMap)
    .map(([label, value]) => ({label, value}))
    .sort((a,b) => b.value-a.value).slice(0,5);

  // Region pie chart - based on operator name mapping
  // Lance = Cape Town, Sharon = Johannesburg
  // Also use u_region from users table if available
  const getRegion = (operatorName) => {
    if (!operatorName) return 'Unknown';
    const name = operatorName.toLowerCase();
    // Check users table first
    const user = users.find(u => u.u_username?.toLowerCase() === name || u.u_name?.toLowerCase().includes(operatorName.toLowerCase()));
    if (user?.u_region) return user.u_region;
    // Fallback name mapping
    if (name.includes('lance')) return 'Cape Town';
    if (name.includes('sharon')) return 'Johannesburg';
    return 'Other';
  };

  const regionMap = {};
  activeLoads.forEach(l => {
    const op = l.m_responsible_operator || l.m_operator || '';
    const region = getRegion(op);
    regionMap[region] = (regionMap[region] || 0) + 1;
  });

  const pieData = Object.entries(regionMap)
    .map(([label, value]) => ({ label, value }))
    .filter(d => d.value > 0)
    .sort((a,b) => b.value - a.value);

  const originPie = pieData; // Same data, kept for fallback reference

  // Status breakdown
  const statusMap = {};
  activeLoads.forEach(l => { statusMap[l.m_status] = (statusMap[l.m_status]||0)+1; });

  const card = (label, value, color='#00AEEF', sub='') => (
    <div className="stat-card" style={{borderTop:`3px solid ${color}`}}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{color, fontSize:22}}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );

  return (
    <div style={{display:'flex', flexDirection:'column', gap:20}}>

      {/* Alert Tiles — License, Service, Driver PDP */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        <LicenseTile vehicles={vehicles} onNavigate={onNavigate} />
        <ServiceTile vehicles={vehicles} onNavigate={onNavigate} />
        <PdpTile drivers={drivers} onNavigate={onNavigate} />
      </div>

      {/* Month header */}
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <select
          value={selectedMonth}
          onChange={e => setSelectedMonth(e.target.value)}
          style={{fontSize:18, fontWeight:700, color:'#005A8E', border:'1px solid #ddd', borderRadius:6, padding:'6px 12px', background:'white', cursor:'pointer', fontFamily:'inherit'}}>
          {monthOptions.map(o => (
            <option key={o.label} value={`${o.year}-${String(o.month).padStart(2,'0')}`}>{o.label}</option>
          ))}
        </select>
        <div style={{fontSize:12, color:'#aaa'}}>Live data — refreshes on page load</div>
      </div>

      {/* Top stats */}
      <div className="stats-grid">
        {card('Total Loads', totalLoads, '#00AEEF', 'Selected month')}
        {card('Total Revenue', fmtR(totalRevenue), '#005A8E', 'All loads')}
        {card('Invoiced Revenue', fmtR(billedRevenue), '#059669', 'Billed to clients')}
        {card('Unbilled Revenue', fmtR(unbilledRevenue), '#f59e0b', 'Not yet invoiced')}
        {card('En Route', enRoute, '#3b82f6', 'Currently active')}
        {card('Not Yet Billed', notBilled, '#d97706', 'Loads pending billing')}
      </div>

      {/* Revenue by region */}
      {revenueByRegion.length > 0 && (
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
          {revenueByRegion.map((r,i) => (
            <div key={i} className="stat-card" style={{borderTop:'3px solid #00AEEF'}}>
              <div className="stat-label">{r.label} Region</div>
              <div className="stat-value" style={{color:'#005A8E', fontSize:20}}>{fmtR(r.value)}</div>
              <div className="stat-sub">{r.count} loads</div>
            </div>
          ))}
        </div>
      )}

      {/* Charts row */}
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>

        {/* Operator / Region pie */}
        <div style={{background:'white', borderRadius:8, padding:20, boxShadow:'0 2px 12px rgba(0,0,0,0.08)'}}>
          <div style={{fontWeight:600, fontSize:14, color:'#005A8E', marginBottom:16}}>
            Loads by Region
          </div>
          <PieChart data={pieData.length > 0 ? pieData : []} />
        </div>

        {/* Status breakdown */}
        <div style={{background:'white', borderRadius:8, padding:20, boxShadow:'0 2px 12px rgba(0,0,0,0.08)'}}>
          <div style={{fontWeight:600, fontSize:14, color:'#005A8E', marginBottom:16}}>Load Status Breakdown</div>
          {Object.keys(statusMap).length === 0
            ? <div style={{color:'#aaa',fontSize:12}}>No loads this month</div>
            : (
            <div style={{display:'flex', flexDirection:'column', gap:8}}>
              {Object.entries(statusMap).sort((a,b)=>b[1]-a[1]).map(([status, count]) => (
                <div key={status} style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                  <div style={{display:'flex', alignItems:'center', gap:8}}>
                    <div style={{width:10, height:10, borderRadius:2, background:STATUS_COLORS[status]||'#ccc'}} />
                    <span style={{fontSize:12, color:'#555'}}>{status.replace(/_/g,' ')}</span>
                  </div>
                  <span style={{fontSize:13, fontWeight:600, color:STATUS_COLORS[status]||'#555'}}>{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bar charts row */}
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16}}>

        {/* Top clients */}
        <div style={{background:'white', borderRadius:8, padding:20, boxShadow:'0 2px 12px rgba(0,0,0,0.08)'}}>
          <div style={{fontWeight:600, fontSize:14, color:'#005A8E', marginBottom:16}}>Top Clients by Revenue</div>
          <BarChart data={topClients} color='#00AEEF' valuePrefix='R ' />
        </div>

        {/* Top drivers */}
        <div style={{background:'white', borderRadius:8, padding:20, boxShadow:'0 2px 12px rgba(0,0,0,0.08)'}}>
          <div style={{fontWeight:600, fontSize:14, color:'#005A8E', marginBottom:16}}>Top Drivers by Loads</div>
          <BarChart data={topDrivers} color='#005A8E' valueSuffix=' loads' />
        </div>

        {/* Top routes */}
        <div style={{background:'white', borderRadius:8, padding:20, boxShadow:'0 2px 12px rgba(0,0,0,0.08)'}}>
          <div style={{fontWeight:600, fontSize:14, color:'#005A8E', marginBottom:16}}>Top Routes This Month</div>
          <BarChart data={topRoutes} color='#0288D1' valueSuffix=' trips' />
        </div>
      </div>

    </div>
  );
}
