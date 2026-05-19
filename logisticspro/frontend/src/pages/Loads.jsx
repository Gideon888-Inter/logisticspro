import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthContext';

const STATUS_BADGE = {
  EN_ROUTE:         'badge-blue',
  OFFLOADED:        'badge-green',
  WAIT_ORDER_NO:    'badge-amber',
  WAIT_APPROVAL:    'badge-amber',
  WAIT_POD_SCAN:    'badge-gray',
  WAIT_INVOICE_NO:  'badge-orange',
  LOAD_INVOICED:    'badge-green',
  WAIT_PROCESSING:  'badge-gray',
  PRELOAD:          'badge-gray',
  REJECTED:         'badge-red',
};

const ALL_STATUSES = ['EN_ROUTE','OFFLOADED','WAIT_ORDER_NO','WAIT_APPROVAL','WAIT_POD_SCAN','WAIT_INVOICE_NO','LOAD_INVOICED','PRELOAD','REJECTED'];

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { day:'2-digit', month:'short', year:'numeric' });
}

function fmtCurrency(n) {
  if (!n && n !== 0) return '—';
  return 'R ' + Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 0 });
}

export default function Loads() {
  const { user } = useAuth();
  const [loads, setLoads] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', bus_unit: '', search: '' });
  const [selected, setSelected] = useState(null);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [showModal, setShowModal] = useState(false);

  const fetchLoads = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.status)   params.status = filters.status;
      if (filters.bus_unit) params.bus_unit = filters.bus_unit;
      const res = await api.getLoads(params);
      setLoads(res.data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const fetchStats = async () => {
    try { setStats(await api.getLoadStats()); } catch {}
  };

  useEffect(() => { fetchLoads(); fetchStats(); }, [filters.status, filters.bus_unit]);

  const openLoad = async (load) => {
    setSelected(load);
    try { setComments(await api.getComments(load.m_load_no)); } catch {}
  };

  const sendComment = async () => {
    if (!newComment.trim() || !selected) return;
    try {
      await api.addComment(selected.m_load_no, newComment);
      setNewComment('');
      setComments(await api.getComments(selected.m_load_no));
    } catch (e) { alert(e.message); }
  };

  const updateStatus = async (id, status) => {
    try {
      await api.updateLoad(id, { m_status: status });
      fetchLoads();
      if (selected?.m_load_no === id) {
        setSelected(s => ({ ...s, m_status: status }));
        setComments(await api.getComments(id));
      }
    } catch (e) { alert(e.message); }
  };

  const filtered = loads.filter(l => {
    if (!filters.search) return true;
    const s = filters.search.toLowerCase();
    return (
      l.m_load_no?.toLowerCase().includes(s) ||
      l.m_truck?.toLowerCase().includes(s) ||
      l.m_customer?.toLowerCase().includes(s) ||
      l.m_from?.toLowerCase().includes(s) ||
      l.m_to?.toLowerCase().includes(s)
    );
  });

  return (
    <div style={{ display: 'flex', gap: 20, height: '100%' }}>
      {/* Left panel */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Active loads</div>
            <div className="stat-value">{stats.total ?? '—'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">En route</div>
            <div className="stat-value" style={{ color: 'var(--blue)' }}>{stats.en_route ?? '—'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Awaiting approval</div>
            <div className="stat-value" style={{ color: 'var(--accent)' }}>{stats.wait_approval ?? '—'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Invoiced value</div>
            <div className="stat-value" style={{ fontSize: 18 }}>{fmtCurrency(stats.total_value)}</div>
          </div>
        </div>

        <div className="filter-bar">
          <input
            placeholder="Search load no, truck, customer…"
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
          />
          <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
            <option value="">All statuses</option>
            {ALL_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
          </select>
          <select value={filters.bus_unit} onChange={e => setFilters(f => ({ ...f, bus_unit: e.target.value }))}>
            <option value="">All units</option>
            <option value="IDC">IDC</option>
            <option value="IDM">IDM</option>
            <option value="MOGWASE">Mogwase</option>
          </select>
          <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>+ New Load</button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Load no</th><th>Date</th><th>Truck</th>
                <th>Customer</th><th>From</th><th>To</th>
                <th>Rate</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8}><div className="loading">Loading loads…</div></td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8}><div className="empty-state">No loads found</div></td></tr>
              )}
              {!loading && filtered.map(l => (
                <tr key={l.m_load_no} onClick={() => openLoad(l)}
                    style={{ background: selected?.m_load_no === l.m_load_no ? 'var(--bg3)' : undefined }}>
                  <td className="mono">{l.m_load_no}</td>
                  <td>{fmtDate(l.m_date)}</td>
                  <td className="mono">{l.m_truck}</td>
                  <td>{l.lp_customers?.c_name || l.m_customer}</td>
                  <td>{l.m_from}</td>
                  <td>{l.m_to}</td>
                  <td className="mono">{fmtCurrency(l.m_rate)}</td>
                  <td><span className={`badge ${STATUS_BADGE[l.m_status] || 'badge-gray'}`}>{l.m_status?.replace(/_/g,' ')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right detail panel */}
      {selected && (
        <div style={{ width: 320, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16, display: 'flex', flexDirection: 'column', gap: 14, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="mono" style={{ color: 'var(--accent)', fontSize: 14 }}>{selected.m_load_no}</span>
            <button className="btn btn-sm" onClick={() => setSelected(null)}>✕</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
            {[['Date', fmtDate(selected.m_date)],['Truck', selected.m_truck],['Driver', selected.m_driver_id || '—'],['Customer', selected.m_customer],['From', selected.m_from],['To', selected.m_to],['Distance', selected.m_total_km ? selected.m_total_km + ' km' : '—'],['Rate', fmtCurrency(selected.m_rate)],['Total', fmtCurrency(selected.m_load_total)],['Order no', selected.m_order_no || '—'],['Invoice', selected.m_invoice || '—'],['Unit', selected.m_bus_unit || '—']].map(([k,v]) => (
              <div key={k}><div style={{ color: 'var(--text3)', fontSize: 10, fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k}</div><div style={{ color: 'var(--text)', marginTop: 2 }}>{v}</div></div>
            ))}
          </div>

          <div>
            <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Update status</div>
            <select
              style={{ width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', fontFamily: 'var(--font)' }}
              value={selected.m_status}
              onChange={e => updateStatus(selected.m_load_no, e.target.value)}
            >
              {ALL_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
            </select>
          </div>

          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Comments</div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200 }}>
              {comments.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 12 }}>No comments yet</div>}
              {comments.map(c => (
                <div key={c.id} style={{ background: 'var(--bg3)', borderRadius: 'var(--radius)', padding: '8px 10px' }}>
                  <div style={{ fontSize: 12 }}>{c.c_comment}</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3, fontFamily: 'var(--mono)' }}>{c.c_logged_by} · {fmtDate(c.c_time)}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                style={{ flex: 1, padding: '6px 8px', fontSize: 12, border: '1px solid var(--border2)', borderRadius: 'var(--radius)', background: 'var(--bg3)', color: 'var(--text)', fontFamily: 'var(--font)' }}
                placeholder="Add comment…"
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendComment()}
              />
              <button className="btn btn-sm btn-primary" onClick={sendComment}>Add</button>
            </div>
          </div>
        </div>
      )}

      {showModal && <NewLoadModal onClose={() => setShowModal(false)} onCreated={() => { setShowModal(false); fetchLoads(); }} />}
    </div>
  );
}

function NewLoadModal({ onClose, onCreated }) {
  const { user } = useAuth();
  const [form, setForm] = useState({ m_load_no: '', m_date: new Date().toISOString().split('T')[0], m_truck: '', m_driver_id: '', m_customer: '', m_from: '', m_to: '', m_rate: '', m_bus_unit: user?.bus_unit || 'IDC', m_status: 'PRELOAD' });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true);
    try {
      await api.createLoad({ ...form, m_operator: user?.username });
      onCreated();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>New Load</h3>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="form-group"><label>Load no</label><input value={form.m_load_no} onChange={e => set('m_load_no', e.target.value)} placeholder="LP-0001" /></div>
            <div className="form-group"><label>Date</label><input type="date" value={form.m_date} onChange={e => set('m_date', e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Truck</label><input value={form.m_truck} onChange={e => set('m_truck', e.target.value)} placeholder="MH66" /></div>
            <div className="form-group"><label>Driver</label><input value={form.m_driver_id} onChange={e => set('m_driver_id', e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Customer code</label><input value={form.m_customer} onChange={e => set('m_customer', e.target.value)} /></div>
            <div className="form-group"><label>Rate (R)</label><input type="number" value={form.m_rate} onChange={e => set('m_rate', e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>From</label><input value={form.m_from} onChange={e => set('m_from', e.target.value)} /></div>
            <div className="form-group"><label>To</label><input value={form.m_to} onChange={e => set('m_to', e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Business unit</label>
              <select value={form.m_bus_unit} onChange={e => set('m_bus_unit', e.target.value)}>
                <option value="IDC">IDC</option><option value="IDM">IDM</option><option value="MOGWASE">Mogwase</option>
              </select>
            </div>
            <div className="form-group">
              <label>Status</label>
              <select value={form.m_status} onChange={e => set('m_status', e.target.value)}>
                <option value="PRELOAD">PRELOAD</option><option value="EN_ROUTE">EN_ROUTE</option>
              </select>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Create Load'}</button>
        </div>
      </div>
    </div>
  );
}
