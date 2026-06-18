import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../lib/AuthContext';

const API = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('lp_token');
const req = (path, opts = {}) =>
  fetch(API + '/api' + path, {
    headers: { 'Authorization': 'Bearer ' + tok(), 'Content-Type': 'application/json' },
    ...opts,
  }).then(async r => {
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Request failed');
    return j;
  });

// ── Constants ──────────────────────────────────────────────────────────────────
const STATUSES = [
  { key: 'PENDING_SERVICE',   label: 'Pending Service',   color: '#6366f1', bg: '#eef2ff' },
  { key: 'SERVICE_ACCEPTED',  label: 'Service Accepted',  color: '#d97706', bg: '#fffbeb' },
  { key: 'WAITING_FOR_PART',  label: 'Waiting for Part',  color: '#e53e3e', bg: '#fff0f0' },
  { key: 'COMPLETE',          label: 'Complete',           color: '#059669', bg: '#f0fdf4' },
];

const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.key, s]));

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Status badge ───────────────────────────────────────────────────────────────
function StatusBadge({ status, large }) {
  const s = STATUS_MAP[status] || { label: status, color: '#888', bg: '#f0f0f0' };
  return (
    <span style={{
      display: 'inline-block',
      padding: large ? '4px 14px' : '2px 10px',
      borderRadius: 20,
      fontSize: large ? 12 : 10,
      fontWeight: 700,
      letterSpacing: '0.05em',
      background: s.bg,
      color: s.color,
      border: `1px solid ${s.color}44`,
    }}>
      {s.label}
    </span>
  );
}

// ── Checklist component ────────────────────────────────────────────────────────
function Checklist({ serviceNo, readOnly }) {
  const { user } = useAuth();
  const [items, setItems]       = useState([]);
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding]     = useState(false);

  const loadItems = useCallback(async () => {
    try { setItems(await req(`/service/${serviceNo}/checklist`)); } catch {}
  }, [serviceNo]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const addItem = async () => {
    if (!newLabel.trim()) return;
    setAdding(true);
    try {
      await req(`/service/${serviceNo}/checklist`, {
        method: 'POST',
        body: JSON.stringify({ item_label: newLabel, sl_order: items.length }),
      });
      setNewLabel('');
      loadItems();
    } catch(e) { alert(e.message); }
    finally { setAdding(false); }
  };

  const toggle = async (item) => {
    try {
      await req(`/service/${serviceNo}/checklist/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ sl_checked: !item.sl_checked }),
      });
      loadItems();
    } catch(e) { alert(e.message); }
  };

  const remove = async (item) => {
    if (!window.confirm(`Remove "${item.sl_label}" from checklist?`)) return;
    try {
      await req(`/service/${serviceNo}/checklist/${item.id}`, { method: 'DELETE' });
      loadItems();
    } catch(e) { alert(e.message); }
  };

  const checked = items.filter(i => i.sl_checked).length;

  return (
    <div>
      {/* Progress */}
      {items.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginBottom: 4 }}>
            <span>Checklist progress</span>
            <span style={{ fontWeight: 700, color: checked === items.length ? '#059669' : '#555' }}>
              {checked} / {items.length} completed
            </span>
          </div>
          <div style={{ height: 6, background: '#e8edf2', borderRadius: 3 }}>
            <div style={{
              height: '100%', borderRadius: 3,
              width: items.length ? `${(checked / items.length) * 100}%` : '0%',
              background: checked === items.length ? '#059669' : '#00AEEF',
              transition: 'width 0.3s',
            }} />
          </div>
        </div>
      )}

      {/* Items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
        {items.length === 0 && (
          <div style={{ color: '#aaa', fontSize: 13, fontStyle: 'italic', padding: '8px 0' }}>
            No checklist items yet — add items below.
          </div>
        )}
        {items.map(item => (
          <div key={item.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 12px', borderRadius: 6,
            background: item.sl_checked ? '#f0fdf4' : '#fafafa',
            border: `1px solid ${item.sl_checked ? '#bbf7d0' : '#e8edf2'}`,
          }}>
            <input
              type="checkbox"
              checked={!!item.sl_checked}
              onChange={() => !readOnly && toggle(item)}
              disabled={readOnly}
              style={{ width: 16, height: 16, cursor: readOnly ? 'default' : 'pointer', accentColor: '#059669' }}
            />
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: 13,
                color: item.sl_checked ? '#888' : '#1a202c',
                textDecoration: item.sl_checked ? 'line-through' : 'none',
              }}>
                {item.sl_label}
              </div>
              {item.sl_checked && item.sl_checked_by && (
                <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>
                  ✓ {item.sl_checked_by} · {fmtDateTime(item.sl_checked_at)}
                </div>
              )}
            </div>
            {!readOnly && (
              <button
                onClick={() => remove(item)}
                style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                title="Remove item"
              >×</button>
            )}
          </div>
        ))}
      </div>

      {/* Add item */}
      {!readOnly && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addItem()}
            placeholder="Add checklist item… (press Enter or click Add)"
            style={{
              flex: 1, padding: '8px 12px', fontSize: 13,
              border: '1px solid #ddd', borderRadius: 6, outline: 'none',
            }}
          />
          <button
            onClick={addItem}
            disabled={adding || !newLabel.trim()}
            style={{
              padding: '8px 16px', fontSize: 12, fontWeight: 700,
              background: '#005A8E', color: 'white', border: 'none',
              borderRadius: 6, cursor: 'pointer', opacity: adding ? 0.7 : 1,
            }}
          >
            {adding ? '…' : '+ Add'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Comments thread ────────────────────────────────────────────────────────────
function Comments({ serviceNo }) {
  const { user } = useAuth();
  const [comments, setComments] = useState([]);
  const [text, setText]         = useState('');
  const [saving, setSaving]     = useState(false);

  const loadComments = useCallback(async () => {
    try { setComments(await req(`/service/${serviceNo}/comments`)); } catch {}
  }, [serviceNo]);

  useEffect(() => { loadComments(); }, [loadComments]);

  const submit = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await req(`/service/${serviceNo}/comments`, {
        method: 'POST',
        body: JSON.stringify({ comment: text.trim() }),
      });
      setText('');
      loadComments();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div>
      {/* Comment list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {comments.length === 0 && (
          <div style={{ color: '#aaa', fontSize: 13, fontStyle: 'italic' }}>No comments yet.</div>
        )}
        {comments.map(c => (
          <div key={c.id} style={{
            background: '#f8fafc', borderRadius: 6, padding: '10px 14px',
            borderLeft: '3px solid #00AEEF',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#005A8E' }}>{c.sm_operator}</span>
              <span style={{ fontSize: 11, color: '#aaa' }}>{fmtDateTime(c.created_at)}</span>
            </div>
            <div style={{ fontSize: 13, color: '#333', whiteSpace: 'pre-wrap' }}>{c.sm_comment}</div>
          </div>
        ))}
      </div>

      {/* Add comment */}
      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Add a comment…"
          rows={2}
          style={{
            flex: 1, padding: '8px 12px', fontSize: 13,
            border: '1px solid #ddd', borderRadius: 6, outline: 'none',
            resize: 'vertical', fontFamily: 'inherit',
          }}
        />
        <button
          onClick={submit}
          disabled={saving || !text.trim()}
          style={{
            padding: '8px 16px', fontSize: 12, fontWeight: 700,
            background: '#005A8E', color: 'white', border: 'none',
            borderRadius: 6, cursor: 'pointer', alignSelf: 'flex-end',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? '…' : '💬 Add'}
        </button>
      </div>
    </div>
  );
}

// ── Audit trail ────────────────────────────────────────────────────────────────
function AuditTrail({ serviceNo }) {
  const [log, setLog] = useState([]);

  useEffect(() => {
    req(`/service/${serviceNo}/audit`)
      .then(setLog)
      .catch(() => {});
  }, [serviceNo]);

  const ACTION_ICON = {
    CREATED:               '🆕',
    STATUS_CHANGED:        '🔄',
    COMPLETED:             '✅',
    COMMENT_ADDED:         '💬',
    CHECKLIST_CHECKED:     '☑️',
    CHECKLIST_UNCHECKED:   '🔲',
    CHECKLIST_ITEM_ADDED:  '➕',
    CHECKLIST_ITEM_REMOVED:'➖',
  };

  return (
    <div>
      {log.length === 0 && (
        <div style={{ color: '#aaa', fontSize: 13, fontStyle: 'italic' }}>No audit entries yet.</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {log.map((entry, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '24px 160px 100px 1fr',
            gap: 10, padding: '8px 4px',
            borderBottom: '1px solid #f0f4f8',
            alignItems: 'start', fontSize: 12,
          }}>
            <span style={{ fontSize: 14 }}>{ACTION_ICON[entry.sa_action] || '•'}</span>
            <span style={{ color: '#888', fontSize: 11 }}>{fmtDateTime(entry.created_at)}</span>
            <span style={{ fontWeight: 700, color: '#005A8E', fontSize: 11 }}>{entry.sa_operator}</span>
            <span style={{ color: '#444' }}>{entry.sa_detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── New service card modal ─────────────────────────────────────────────────────
function NewServiceModal({ vehicles, onClose, onCreated }) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    sc_vehicle: '',
    sc_notes:   '',
    sc_trigger: 'Manual',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Get odometer for selected vehicle
  const selVeh = vehicles.find(v => v.vh_code === form.sc_vehicle);

  const submit = async () => {
    if (!form.sc_vehicle) return alert('Please select a vehicle');
    setSaving(true);
    try {
      const created = await req('/service', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          sc_odometer: selVeh?.vh_odometer || 0,
        }),
      });
      onCreated(created);
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 500 }}>
        <div className="modal-header">
          <h3>New Service Card</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'white', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Vehicle *</label>
            <select value={form.sc_vehicle} onChange={e => set('sc_vehicle', e.target.value)}>
              <option value="">— Select vehicle —</option>
              {vehicles.filter(v => v.vh_type === 'Horse' || v.vh_type === 'Rigid').map(v => (
                <option key={v.vh_code} value={v.vh_code}>
                  {v.vh_code} — {v.vh_make} {v.vh_model} ({(Number(v.vh_odometer)||0).toLocaleString()} km)
                </option>
              ))}
            </select>
          </div>

          {selVeh && (
            <div style={{
              background: '#f0f8ff', border: '1px solid #bee3f8',
              borderRadius: 6, padding: '10px 14px', marginBottom: 12, fontSize: 12,
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div><span style={{ color: '#888' }}>Odometer: </span>
                  <strong>{Number(selVeh.vh_odometer||0).toLocaleString()} km</strong></div>
                <div><span style={{ color: '#888' }}>Next Service: </span>
                  <strong style={{ color: ((Number(selVeh.vh_next_service||0) - Number(selVeh.vh_odometer||0)) <= 0) ? '#e53e3e' : '#333' }}>
                    {selVeh.vh_next_service ? Number(selVeh.vh_next_service).toLocaleString() + ' km' : '—'}
                  </strong></div>
                <div><span style={{ color: '#888' }}>Type: </span><strong>{selVeh.vh_type}</strong></div>
                <div><span style={{ color: '#888' }}>Status: </span><strong>{selVeh.vh_status || 'AVAILABLE'}</strong></div>
              </div>
            </div>
          )}

          <div className="form-group">
            <label>Trigger / Reason</label>
            <input
              value={form.sc_trigger}
              onChange={e => set('sc_trigger', e.target.value)}
              placeholder="e.g. Service due: 3000 km remaining"
            />
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea
              value={form.sc_notes}
              onChange={e => set('sc_notes', e.target.value)}
              placeholder="Any additional notes for this service…"
              rows={3}
              style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Creating…' : 'Create Service Card'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Service card detail modal ──────────────────────────────────────────────────
function ServiceCardModal({ card, onClose, onUpdated }) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('checklist');
  const [statusSaving, setStatusSaving] = useState(false);
  const [currentCard, setCurrentCard] = useState(card);

  const changeStatus = async (newStatus) => {
    if (newStatus === currentCard.sc_status) return;
    if (newStatus === 'SERVICE_ACCEPTED' || newStatus === 'WAITING_FOR_PART') {
      if (!window.confirm(
        `Setting status to "${STATUS_MAP[newStatus]?.label}" will block ${currentCard.sc_vehicle} from new load cards. Continue?`
      )) return;
    }
    setStatusSaving(true);
    try {
      const updated = await req(`/service/${currentCard.sc_no}`, {
        method: 'PATCH',
        body: JSON.stringify({ sc_status: newStatus }),
      });
      setCurrentCard(updated);
      onUpdated(updated);
    } catch(e) { alert(e.message); }
    finally { setStatusSaving(false); }
  };

  const isBlocking = ['SERVICE_ACCEPTED', 'WAITING_FOR_PART'].includes(currentCard.sc_status);

  const tabs = [
    { key: 'checklist', label: '✅ Checklist' },
    { key: 'comments',  label: '💬 Comments' },
    { key: 'audit',     label: '📜 Audit Trail' },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{
        width: 680, maxHeight: '92vh', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div className="modal-header" style={{ flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              {currentCard.sc_no} — {currentCard.sc_vehicle}
            </div>
            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
              Created {fmtDate(currentCard.sc_date)} · {currentCard.sc_trigger || 'Manual'}
              {currentCard.sc_odometer ? ` · ${Number(currentCard.sc_odometer).toLocaleString()} km at creation` : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'white', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>

        {/* Status bar */}
        <div style={{
          padding: '12px 20px', background: '#f8fafc', borderBottom: '1px solid #e8edf2',
          flexShrink: 0,
        }}>
          {isBlocking && (
            <div style={{
              background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6,
              padding: '6px 12px', marginBottom: 10, fontSize: 12, color: '#c05621',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              🚫 <strong>{currentCard.sc_vehicle}</strong> is blocked from new load cards until service is complete.
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#888', marginRight: 4 }}>Status:</span>
            {STATUSES.map(s => (
              <button
                key={s.key}
                onClick={() => changeStatus(s.key)}
                disabled={statusSaving}
                style={{
                  padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                  cursor: 'pointer', transition: 'all 0.15s',
                  border: currentCard.sc_status === s.key ? `2px solid ${s.color}` : '2px solid #e2e8f0',
                  background: currentCard.sc_status === s.key ? s.bg : 'white',
                  color: currentCard.sc_status === s.key ? s.color : '#888',
                  opacity: statusSaving ? 0.6 : 1,
                }}
              >
                {s.label}
                {currentCard.sc_status === s.key && ' ✓'}
              </button>
            ))}
          </div>

          {currentCard.sc_notes && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#555', fontStyle: 'italic' }}>
              📝 {currentCard.sc_notes}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e8edf2', background: '#fff', flexShrink: 0 }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
              padding: '10px 20px', fontSize: 12, fontWeight: activeTab === t.key ? 700 : 400,
              border: 'none', background: 'none', cursor: 'pointer',
              borderBottom: activeTab === t.key ? '2px solid #005A8E' : '2px solid transparent',
              color: activeTab === t.key ? '#005A8E' : '#888',
            }}>{t.label}</button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {activeTab === 'checklist' && (
            <Checklist
              serviceNo={currentCard.sc_no}
              readOnly={currentCard.sc_status === 'COMPLETE'}
            />
          )}
          {activeTab === 'comments' && <Comments serviceNo={currentCard.sc_no} />}
          {activeTab === 'audit'    && <AuditTrail serviceNo={currentCard.sc_no} />}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function ServiceCards() {
  const { user } = useAuth();
  const [cards, setCards]         = useState([]);
  const [vehicles, setVehicles]   = useState([]);
  const [stats, setStats]         = useState({});
  const [loading, setLoading]     = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch]       = useState('');
  const [showNew, setShowNew]     = useState(false);
  const [openCard, setOpenCard]   = useState(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cardsRes, vehRes, statsRes] = await Promise.all([
        req('/service'),
        req('/vehicles?active=all'),
        req('/service/stats'),
      ]);
      setCards(cardsRes.data || []);
      setVehicles(Array.isArray(vehRes) ? vehRes : []);
      setStats(statsRes || {});
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const filtered = cards.filter(c => {
    const s = search.toLowerCase();
    return (!statusFilter || c.sc_status === statusFilter)
      && (!s || c.sc_no?.toLowerCase().includes(s) || c.sc_vehicle?.toLowerCase().includes(s));
  });

  const getVehicle = (code) => vehicles.find(v => v.vh_code === code);

  const STATUS_ICON = {
    PENDING_SERVICE:  '🔵',
    SERVICE_ACCEPTED: '🟠',
    WAITING_FOR_PART: '🔴',
    COMPLETE:         '🟢',
  };

  return (
    <div>
      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total</div>
          <div className="stat-value">{stats.total ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pending Service</div>
          <div className="stat-value" style={{ color: '#6366f1' }}>{stats.pending ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Service Accepted</div>
          <div className="stat-value" style={{ color: '#d97706' }}>{stats.accepted ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Waiting for Part</div>
          <div className="stat-value" style={{ color: '#e53e3e' }}>{stats.waiting_for_part ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Complete</div>
          <div className="stat-value" style={{ color: '#059669' }}>{stats.complete ?? '—'}</div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        <input
          placeholder="Search by service no. or vehicle…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map(s => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>
          + New Service Card
        </button>
      </div>

      {/* Cards list */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Service No.</th>
              <th>Date</th>
              <th>Vehicle</th>
              <th>Make / Model</th>
              <th>Odometer</th>
              <th>Trigger</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7}><div className="loading">Loading service cards…</div></td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7}><div className="empty-state">No service cards found</div></td></tr>
            )}
            {!loading && filtered.map(c => {
              const veh = getVehicle(c.sc_vehicle);
              const isBlocking = ['SERVICE_ACCEPTED', 'WAITING_FOR_PART'].includes(c.sc_status);
              return (
                <tr
                  key={c.sc_no}
                  onClick={() => setOpenCard(c)}
                  style={{
                    cursor: 'pointer',
                    background: isBlocking ? '#fffbeb' : undefined,
                  }}
                >
                  <td className="mono" style={{ fontWeight: 700 }}>
                    {STATUS_ICON[c.sc_status] || '•'} {c.sc_no}
                  </td>
                  <td>{fmtDate(c.sc_date)}</td>
                  <td className="mono" style={{ fontWeight: 600 }}>{c.sc_vehicle}</td>
                  <td>{veh ? `${veh.vh_make || ''} ${veh.vh_model || ''}`.trim() || '—' : '—'}</td>
                  <td className="mono">{c.sc_odometer ? Number(c.sc_odometer).toLocaleString() + ' km' : '—'}</td>
                  <td style={{ fontSize: 12, color: '#666', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.sc_trigger || '—'}
                  </td>
                  <td><StatusBadge status={c.sc_status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* New card modal */}
      {showNew && (
        <NewServiceModal
          vehicles={vehicles}
          onClose={() => setShowNew(false)}
          onCreated={(c) => {
            setShowNew(false);
            setOpenCard(c);
            loadAll();
          }}
        />
      )}

      {/* Detail modal */}
      {openCard && (
        <ServiceCardModal
          card={openCard}
          onClose={() => { setOpenCard(null); loadAll(); }}
          onUpdated={(updated) => {
            setOpenCard(updated);
            setCards(prev => prev.map(c => c.sc_no === updated.sc_no ? updated : c));
          }}
        />
      )}
    </div>
  );
}
