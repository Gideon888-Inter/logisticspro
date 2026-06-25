import { useState, useEffect } from 'react';
import { api } from '../lib/api';

const EMPTY = { d_id:'', d_nickname:'', d_name:'', d_cell:'', d_type:'Interland', d_pdp_expiry:'', d_receipt:'N', d_start_date:'', d_training_date:'', d_active:'Y' };

// ── Date status helper (mirrors Fleet.jsx) ─────────────────────
function getPdpStatus(dateStr) {
  if (!dateStr) return 'none';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  if (d < today) return 'expired';
  const in30 = new Date(today); in30.setDate(today.getDate() + 30);
  if (d <= in30) return 'soon';
  const in90 = new Date(today); in90.setDate(today.getDate() + 90);
  if (d <= in90) return 'warning';
  return 'ok';
}

const PDP_STYLE = {
  expired: { color: '#e53e3e', icon: '🔴', label: 'EXPIRED' },
  soon:    { color: '#c05621', icon: '🟠', label: '≤ 30 days' },
  warning: { color: '#d97706', icon: '🟡', label: '≤ 90 days' },
  ok:      { color: '#059669', icon: '🟢', label: '' },
  none:    { color: '#aaa',    icon: '⚪', label: 'NOT SET' },
};

function PdpCell({ value }) {
  const s = getPdpStatus(value);
  const cfg = PDP_STYLE[s];
  const fmtDate = (d) => new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
  return (
    <td style={{ whiteSpace: 'nowrap' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: cfg.color, fontWeight: s !== 'ok' && s !== 'none' ? 700 : 400, fontSize: 12 }}>
        {cfg.icon} {value ? fmtDate(value) : '—'}
      </span>
    </td>
  );
}

function exportCSV(data) {
  const headers = ['Nickname','Name','Cell Number','Type','PDP Expiry','Has Receipt','Start Date','Training Date'];
  const rows = data.map(d => [d.d_nickname||'', d.d_name||d.d_nickname||'', d.d_cell||'', d.d_type||'Interland', d.d_pdp_expiry||'', d.d_receipt==='Y'?'YES':'NO', d.d_start_date||'', d.d_training_date||'']);
  const csv = [headers,...rows].map(r=>r.map(c=>`"${c}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv); a.download='drivers_export.csv'; a.click();
}

export default function Drivers() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('Y');
  const [quickFilter, setQuickFilter] = useState('all'); // all | pdp_expired | pdp_30 | pdp_90
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);

  const load = async () => {
    setLoading(true);
    try { setData(await api.getDrivers()); } catch(e){console.error(e);}
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // ── Quick-filter counts ───────────────────────────────────────
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const in30  = new Date(today); in30.setDate(today.getDate() + 30);
  const in90  = new Date(today); in90.setDate(today.getDate() + 90);

  const qCounts = {
    all:         data.length,
    pdp_expired: data.filter(d => d.d_pdp_expiry && new Date(d.d_pdp_expiry) < today).length,
    pdp_30:      data.filter(d => { if (!d.d_pdp_expiry) return false; const dt = new Date(d.d_pdp_expiry); return dt >= today && dt <= in30; }).length,
    pdp_90:      data.filter(d => { if (!d.d_pdp_expiry) return false; const dt = new Date(d.d_pdp_expiry); return dt > in30 && dt <= in90; }).length,
    pdp_none:    data.filter(d => !d.d_pdp_expiry).length,
  };

  const qTabs = [
    { key: 'all',         label: 'All Drivers',         color: '#005A8E' },
    { key: 'pdp_expired', label: '🔴 PDP Expired',      color: '#e53e3e' },
    { key: 'pdp_30',      label: '🟠 PDP ≤ 30 Days',    color: '#c05621' },
    { key: 'pdp_90',      label: '🟡 PDP ≤ 90 Days',    color: '#d97706' },
    { key: 'pdp_none',    label: '⚪ No PDP Date',       color: '#888'    },
  ];

  const filtered = data.filter(d => {
    const s = search.toLowerCase();
    if (quickFilter === 'pdp_expired' && !(d.d_pdp_expiry && new Date(d.d_pdp_expiry) < today)) return false;
    if (quickFilter === 'pdp_30') { if (!d.d_pdp_expiry) return false; const dt = new Date(d.d_pdp_expiry); if (!(dt >= today && dt <= in30)) return false; }
    if (quickFilter === 'pdp_90') { if (!d.d_pdp_expiry) return false; const dt = new Date(d.d_pdp_expiry); if (!(dt > in30 && dt <= in90)) return false; }
    if (quickFilter === 'pdp_none' && d.d_pdp_expiry) return false;
    return (!s || d.d_nickname?.toLowerCase().includes(s) || d.d_id?.toLowerCase().includes(s) || (d.d_name||'').toLowerCase().includes(s))
      && (!typeFilter || (d.d_type||'Interland') === typeFilter)
      && (!activeFilter || d.d_active === activeFilter);
  });

  const openAdd = () => { setForm(EMPTY); setEditId(null); setShowModal(true); };
  const openEdit = (d) => { setForm({...EMPTY,...d, d_name: d.d_name||d.d_nickname}); setEditId(d.d_id); setShowModal(true); };
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const save = async () => {
    if (!form.d_id.trim() || !form.d_nickname.trim()) return alert('Driver ID and Nickname are required');
    setSaving(true);
    try {
      const payload = { ...form };
      if (editId) await api.updateDriver(editId, payload);
      else await api.createDriver(payload);
      setShowModal(false); load();
    } catch(e){ alert(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div>
      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Total Drivers</div><div className="stat-value">{data.length}</div></div>
        <div className="stat-card"><div className="stat-label">Active</div><div className="stat-value" style={{color:'#00AEEF'}}>{data.filter(d=>d.d_active==='Y').length}</div></div>
        <div className="stat-card"><div className="stat-label">PDP Expired</div><div className="stat-value" style={{color:'#e53e3e'}}>{qCounts.pdp_expired}</div></div>
        <div className="stat-card"><div className="stat-label">PDP Expiring (90 days)</div><div className="stat-value" style={{color:'#d97706'}}>{qCounts.pdp_30 + qCounts.pdp_90}</div></div>
      </div>

      {/* Quick-filter tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {qTabs.map(t => {
          const isActive = quickFilter === t.key;
          return (
            <button key={t.key} onClick={() => setQuickFilter(t.key)} style={{
              padding: '5px 12px', fontSize: 11, fontWeight: isActive ? 700 : 500,
              borderRadius: 20, cursor: 'pointer',
              border: isActive ? `2px solid ${t.color}` : '2px solid #e2e8f0',
              background: isActive ? t.color : 'white',
              color: isActive ? 'white' : '#555',
              transition: 'all 0.15s',
            }}>
              {t.label} ({qCounts[t.key]})
            </button>
          );
        })}
      </div>

      {/* Search / type / active filters */}
      <div className="filter-bar">
        <input placeholder="Search nickname, name, ID…" value={search} onChange={e=>setSearch(e.target.value)} />
        <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}>
          <option value="">All types</option><option value="Interland">Interland</option><option value="TRILLIUM">Trillium</option>
        </select>
        <select value={activeFilter} onChange={e=>setActiveFilter(e.target.value)}>
          <option value="">All</option>
          <option value="Y">Active</option>
          <option value="N">Inactive</option>
        </select>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Driver</button>
        <button className="btn btn-sm" onClick={()=>exportCSV(filtered)}>⬇ Export CSV</button>
      </div>

      {/* Mobile card list */}
      <div className="mobile-card-list">
        {loading && <div className="loading">Loading drivers…</div>}
        {!loading && filtered.length === 0 && <div className="empty-state">No drivers found</div>}
        {!loading && filtered.map(d => {
          const pdpStatus = getPdpStatus(d.d_pdp_expiry);
          const borderColor = pdpStatus==='expired' ? '#e53e3e' : pdpStatus==='soon'||pdpStatus==='warning' ? '#d97706' : 'var(--blue)';
          return (
            <div key={d.d_id} className="data-card" onClick={() => openEdit(d)} style={{ borderLeftColor: borderColor }}>
              <div className="data-card-header">
                <div>
                  <div className="data-card-title">{d.d_nickname}</div>
                  <div className="data-card-sub">{d.d_name || d.d_nickname}</div>
                </div>
                <span className={`badge ${d.d_active==='Y'?'badge-green':'badge-red'}`}>{d.d_active==='Y'?'Active':'Inactive'}</span>
              </div>
              <div className="data-card-meta">
                <div>📱 <strong>{d.d_cell||'—'}</strong></div>
                <div>Type: <strong>{d.d_type||'Interland'}</strong></div>
                <div>PDP: <strong style={{color: borderColor}}>{d.d_pdp_expiry || '—'}</strong></div>
                <div>Receipt: <strong>{d.d_receipt==='Y'?'Yes':'No'}</strong></div>
              </div>
            </div>
          );
        })}
      </div>
      {/* Desktop table */}
      <div className="desktop-table">
      <div className="table-wrap">
        <table>
          <thead><tr><th>Nickname</th><th>Full Name</th><th>Cell</th><th>Type</th><th>PDP Expiry</th><th>Has Receipt</th><th>Start Date</th><th>Training Date</th><th>Active</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9}><div className="loading">Loading drivers…</div></td></tr>}
            {!loading && filtered.length===0 && <tr><td colSpan={9}><div className="empty-state">No drivers found</div></td></tr>}
            {!loading && filtered.map(d => {
              const pdpStatus = getPdpStatus(d.d_pdp_expiry);
              const rowBg = pdpStatus === 'expired' ? '#fff0f0'
                          : pdpStatus === 'soon'    ? '#fff7ed'
                          : pdpStatus === 'warning' ? '#fffbeb'
                          : undefined;
              return (
                <tr key={d.d_id} onClick={()=>openEdit(d)} style={{ background: rowBg, cursor: 'pointer' }}>
                  <td style={{fontWeight:600}}>{d.d_nickname}</td>
                  <td>{d.d_name||d.d_nickname}</td>
                  <td className="mono">{d.d_cell||'—'}</td>
                  <td>{d.d_type||'Interland'}</td>
                  <PdpCell value={d.d_pdp_expiry} />
                  <td><span className={`badge ${d.d_receipt==='Y'?'badge-green':'badge-gray'}`}>{d.d_receipt==='Y'?'YES':'NO'}</span></td>
                  <td className="mono">{d.d_start_date||'—'}</td>
                  <td className="mono">{d.d_training_date||'—'}</td>
                  <td><span className={`badge ${d.d_active==='Y'?'badge-green':'badge-red'}`}>{d.d_active==='Y'?'Active':'Inactive'}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>{/* end desktop-table */}

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={()=>setShowModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{width:600}}>
            <div className="modal-header">
              <h3>{editId?'Edit Driver — '+editId:'Add New Driver'}</h3>
              <button onClick={()=>setShowModal(false)} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label>Driver ID *</label><input value={form.d_id} onChange={e=>set('d_id',e.target.value)} disabled={!!editId} placeholder="e.g. D-001" /></div>
                <div className="form-group"><label>Nickname *</label><input value={form.d_nickname} onChange={e=>set('d_nickname',e.target.value)} placeholder="e.g. LUCKY" /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Full Name</label><input value={form.d_name} onChange={e=>set('d_name',e.target.value)} placeholder="e.g. Lucky Nkosi" /></div>
                <div className="form-group"><label>Cell Number</label><input value={form.d_cell} onChange={e=>set('d_cell',e.target.value)} placeholder="082 555 0101" /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Driver Type</label>
                  <select value={form.d_type||'Interland'} onChange={e=>set('d_type',e.target.value)}>
                    <option value="Interland">Interland</option><option value="TRILLIUM">Trillium</option><option value="Subcontractor">Subcontractor</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>PDP Expiry Date</label><input type="date" value={form.d_pdp_expiry} onChange={e=>set('d_pdp_expiry',e.target.value)} /></div>
                <div className="form-group"><label>Start Date</label><input type="date" value={form.d_start_date} onChange={e=>set('d_start_date',e.target.value)} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Training Date</label><input type="date" value={form.d_training_date} onChange={e=>set('d_training_date',e.target.value)} /></div>
                <div className="form-group"><label>Has Receipt</label>
                  <select value={form.d_receipt} onChange={e=>set('d_receipt',e.target.value)}>
                    <option value="Y">Yes</option><option value="N">No</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Active</label>
                  <select value={form.d_active} onChange={e=>set('d_active',e.target.value)}>
                    <option value="Y">Yes</option><option value="N">No</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':editId?'Update Driver':'Add Driver'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
