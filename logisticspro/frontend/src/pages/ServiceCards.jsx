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

// ── Status config ──────────────────────────────────────────────────────────────
const STATUSES = {
  PENDING_SERVICE:  { label: 'Pending Service',   color: '#6366f1', bg: '#eef2ff', icon: '🔵' },
  SERVICE_ACCEPTED: { label: 'Service Accepted',  color: '#d97706', bg: '#fffbeb', icon: '🟠' },
  WAITING_FOR_PART: { label: 'Waiting for Part',  color: '#dc2626', bg: '#fff0f0', icon: '🔴' },
  COMPLETE:         { label: 'Complete',           color: '#059669', bg: '#f0fdf4', icon: '🟢' },
  REJECTED:         { label: 'Rejected',           color: '#6b7280', bg: '#f9fafb', icon: '⛔' },
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { day:'2-digit', month:'short', year:'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-ZA', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function StatusBadge({ status }) {
  const s = STATUSES[status] || { label: status, color: '#888', bg: '#f0f0f0', icon: '•' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 20,
      fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
      background: s.bg, color: s.color, border: `1px solid ${s.color}44`,
    }}>
      {s.icon} {s.label}
    </span>
  );
}

// ── Checklist ──────────────────────────────────────────────────────────────────
function Checklist({ serviceNo, readOnly }) {
  const [items, setItems]         = useState([]);
  const [newLabel, setNewLabel]   = useState('');
  const [adding, setAdding]       = useState(false);
  const [loaded, setLoaded]       = useState(false);
  const [comments, setComments]   = useState({});
  const [savingComment, setSavingComment] = useState({});

  const load = useCallback(async () => {
    try {
      const data = await req(`/service/${serviceNo}/checklist`);
      // Auto-seed template if checklist is empty (first open after accept)
      if (data.length === 0 && !readOnly) {
        try {
          await req(`/service/${serviceNo}/checklist/seed`, { method: 'POST' });
          const seeded = await req(`/service/${serviceNo}/checklist`);
          const drafts = {};
          seeded.forEach(i => { drafts[i.id] = i.sl_comment || ''; });
          setItems(seeded);
          setComments(drafts);
        } catch {
          setItems([]);
        }
      } else {
        const drafts = {};
        data.forEach(i => { drafts[i.id] = i.sl_comment || ''; });
        setItems(data);
        setComments(drafts);
      }
    } catch {}
    setLoaded(true);
  }, [serviceNo, readOnly]);

  useEffect(() => { load(); }, [load]);

  const addItem = async () => {
    if (!newLabel.trim()) return;
    setAdding(true);
    try {
      await req(`/service/${serviceNo}/checklist`, {
        method: 'POST', body: JSON.stringify({ item_label: newLabel, sl_order: items.length }),
      });
      setNewLabel(''); load();
    } catch(e) { alert(e.message); } finally { setAdding(false); }
  };

  const toggle = async (item) => {
    try {
      await req(`/service/${serviceNo}/checklist/${item.id}`, {
        method: 'PATCH', body: JSON.stringify({ sl_checked: !item.sl_checked }),
      });
      load();
    } catch(e) { alert(e.message); }
  };

  const saveComment = async (item) => {
    const val = (comments[item.id] || '').trim();
    if (val === (item.sl_comment || '')) return;
    setSavingComment(s => ({ ...s, [item.id]: true }));
    try {
      await req(`/service/${serviceNo}/checklist/${item.id}`, {
        method: 'PATCH', body: JSON.stringify({ sl_comment: val }),
      });
      load();
    } catch(e) { alert(e.message); } finally {
      setSavingComment(s => ({ ...s, [item.id]: false }));
    }
  };

  const remove = async (item) => {
    if (!window.confirm(`Remove "${item.sl_label}"?`)) return;
    try { await req(`/service/${serviceNo}/checklist/${item.id}`, { method: 'DELETE' }); load(); }
    catch(e) { alert(e.message); }
  };

  const checked = items.filter(i => i.sl_checked).length;

  // Group by section
  const sections = [];
  const sectionMap = {};
  items.forEach(item => {
    const sec = item.sl_section || 'Checklist';
    if (!sectionMap[sec]) { sectionMap[sec] = []; sections.push(sec); }
    sectionMap[sec].push(item);
  });

  if (!loaded) return <div style={{ color:'#aaa', fontSize:13, padding:'16px 0' }}>Loading checklist…</div>;

  return (
    <div>
      {/* Progress bar */}
      {items.length > 0 && (
        <div style={{ marginBottom:14 }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'#888', marginBottom:4 }}>
            <span>Progress</span>
            <span style={{ fontWeight:700, color: checked===items.length ? '#059669':'#555' }}>
              {checked} / {items.length} done
            </span>
          </div>
          <div style={{ height:6, background:'#e8edf2', borderRadius:3 }}>
            <div style={{ height:'100%', borderRadius:3, transition:'width 0.3s',
              background: checked===items.length ? '#059669':'#00AEEF',
              width: items.length ? `${(checked/items.length)*100}%`:'0%' }} />
          </div>
        </div>
      )}

      {/* Sections */}
      {sections.map(sec => (
        <div key={sec} style={{ marginBottom:18 }}>
          {/* Section header */}
          <div style={{
            fontSize:10, fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase',
            color:'#005A8E', borderBottom:'2px solid #dbeafe', paddingBottom:4, marginBottom:6,
          }}>{sec}</div>

          {/* Items — flex column, mobile-friendly */}
          <div>
            {sectionMap[sec].map(item => (
              <div key={item.id} style={{
                borderBottom:'1px solid #f0f4f8',
                padding:'8px 0',
                background: item.sl_checked ? '#f0fdf4' : 'transparent',
              }}>
                {/* Row 1: checkbox + label + remove */}
                <div style={{ display:'flex', alignItems:'flex-start', gap:8 }}>
                  <input type="checkbox" checked={!!item.sl_checked}
                    onChange={() => !readOnly && toggle(item)} disabled={readOnly}
                    style={{ width:16, height:16, marginTop:2, cursor: readOnly?'default':'pointer',
                      accentColor:'#059669', flexShrink:0 }} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{
                      fontSize:13, color: item.sl_checked ? '#999':'#1a202c',
                      textDecoration: item.sl_checked ? 'line-through':'none',
                      wordBreak:'break-word',
                    }}>
                      {item.sl_label}
                    </div>
                    {item.sl_checked && item.sl_checked_by && (
                      <div style={{ fontSize:10, color:'#bbb', marginTop:1 }}>
                        ✓ {item.sl_checked_by} · {fmtDateTime(item.sl_checked_at)}
                      </div>
                    )}
                  </div>
                  {!readOnly && (
                    <button onClick={() => remove(item)}
                      style={{ background:'none', border:'none', color:'#ddd',
                        cursor:'pointer', fontSize:16, lineHeight:1, padding:0, flexShrink:0 }}>×</button>
                  )}
                </div>
                {/* Row 2: comment field (indented to align with label) */}
                <div style={{ paddingLeft:24, marginTop:6 }}>
                  {readOnly ? (
                    item.sl_comment ? (
                      <span style={{ fontSize:12, color:'#666', fontStyle:'italic' }}>{item.sl_comment}</span>
                    ) : null
                  ) : (
                    <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                      <input
                        value={comments[item.id] || ''}
                        onChange={e => setComments(c => ({ ...c, [item.id]: e.target.value }))}
                        onBlur={() => saveComment(item)}
                        placeholder="Note…"
                        style={{
                          flex:1, padding:'5px 8px', fontSize:12,
                          border:'1px solid #e2e8f0', borderRadius:4,
                          outline:'none', color:'#444', background:'#fff',
                          fontFamily:'inherit', width:'100%', boxSizing:'border-box',
                        }}
                      />
                      {savingComment[item.id] && (
                        <span style={{ fontSize:10, color:'#aaa', flexShrink:0 }}>saving…</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Add extra item */}
      {!readOnly && (
        <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid #f0f4f8' }}>
          <div style={{ fontSize:10, color:'#bbb', fontWeight:700, letterSpacing:'0.05em',
            textTransform:'uppercase', marginBottom:6 }}>Add extra item</div>
          <div style={{ display:'flex', gap:8 }}>
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => e.key==='Enter' && addItem()}
              placeholder="Extra checklist item… (Enter or click Add)"
              style={{ flex:1, padding:'7px 12px', fontSize:13, border:'1px solid #ddd',
                borderRadius:6, outline:'none', fontFamily:'inherit' }} />
            <button onClick={addItem} disabled={adding || !newLabel.trim()}
              style={{ padding:'7px 16px', fontSize:12, fontWeight:700, background:'#005A8E',
                color:'white', border:'none', borderRadius:6, cursor:'pointer', opacity: adding?0.7:1 }}>
              {adding ? '…' : '+ Add'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Comments ───────────────────────────────────────────────────────────────────
function Comments({ serviceNo }) {
  const [comments, setComments] = useState([]);
  const [text, setText]         = useState('');
  const [saving, setSaving]     = useState(false);

  const load = useCallback(async () => {
    try { setComments(await req(`/service/${serviceNo}/comments`)); } catch {}
  }, [serviceNo]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await req(`/service/${serviceNo}/comments`, { method:'POST', body: JSON.stringify({ comment: text.trim() }) });
      setText(''); load();
    } catch(e) { alert(e.message); } finally { setSaving(false); }
  };

  return (
    <div>
      <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:14 }}>
        {comments.length === 0 && <div style={{ color:'#aaa', fontSize:13, fontStyle:'italic' }}>No comments yet.</div>}
        {comments.map(c => (
          <div key={c.id} style={{ background:'#f8fafc', borderRadius:6, padding:'10px 14px', borderLeft:'3px solid #00AEEF' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
              <span style={{ fontSize:11, fontWeight:700, color:'#005A8E' }}>{c.sm_operator}</span>
              <span style={{ fontSize:11, color:'#aaa' }}>{fmtDateTime(c.created_at)}</span>
            </div>
            <div style={{ fontSize:13, color:'#333', whiteSpace:'pre-wrap' }}>{c.sm_comment}</div>
          </div>
        ))}
      </div>
      <div style={{ display:'flex', gap:8 }}>
        <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Add a comment…" rows={2}
          style={{ flex:1, padding:'8px 12px', fontSize:13, border:'1px solid #ddd', borderRadius:6,
            outline:'none', resize:'vertical', fontFamily:'inherit' }} />
        <button onClick={submit} disabled={saving || !text.trim()}
          style={{ padding:'8px 16px', fontSize:12, fontWeight:700, background:'#005A8E', color:'white',
            border:'none', borderRadius:6, cursor:'pointer', alignSelf:'flex-end', opacity: saving?0.7:1 }}>
          {saving ? '…' : '💬 Add'}
        </button>
      </div>
    </div>
  );
}

// ── Audit Trail ────────────────────────────────────────────────────────────────
function AuditTrail({ serviceNo }) {
  const [log, setLog] = useState([]);

  useEffect(() => {
    req(`/service/${serviceNo}/audit`).then(setLog).catch(() => {});
  }, [serviceNo]);

  const ICON = {
    CREATED:'🆕', AUTO_CREATED:'🤖', STATUS_CHANGED:'🔄', COMPLETED:'✅',
    REJECTED:'⛔', COMMENT_ADDED:'💬', CHECKLIST_CHECKED:'☑️',
    CHECKLIST_UNCHECKED:'🔲', CHECKLIST_ITEM_ADDED:'➕', CHECKLIST_ITEM_REMOVED:'➖',
  };

  return (
    <div>
      {log.length === 0 && <div style={{ color:'#aaa', fontSize:13, fontStyle:'italic' }}>No entries yet.</div>}
      {log.map((e, i) => (
        <div key={i} style={{ display:'grid', gridTemplateColumns:'24px 155px 90px 1fr',
          gap:10, padding:'8px 4px', borderBottom:'1px solid #f0f4f8', alignItems:'start', fontSize:12 }}>
          <span style={{ fontSize:14 }}>{ICON[e.sa_action] || '•'}</span>
          <span style={{ color:'#888', fontSize:11 }}>{fmtDateTime(e.created_at)}</span>
          <span style={{ fontWeight:700, color:'#005A8E', fontSize:11 }}>{e.sa_operator}</span>
          <span style={{ color:'#444' }}>{e.sa_detail}</span>
        </div>
      ))}
    </div>
  );
}

// ── New Service Card Modal ─────────────────────────────────────────────────────
function NewServiceModal({ vehicles, onClose, onCreated }) {
  const [form, setForm] = useState({ sc_vehicle:'', sc_notes:'', sc_trigger:'Manual' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const selVeh = vehicles.find(v => v.vh_code === form.sc_vehicle);

  const submit = async () => {
    if (!form.sc_vehicle) return alert('Please select a vehicle');
    setSaving(true);
    try {
      const created = await req('/service', {
        method:'POST', body: JSON.stringify({ ...form, sc_odometer: selVeh?.vh_odometer || 0 }),
      });
      onCreated(created);
    } catch(e) { alert(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width:500 }}>
        <div className="modal-header">
          <h3>New Service Card</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'white', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Vehicle *</label>
            <select value={form.sc_vehicle} onChange={e => set('sc_vehicle', e.target.value)}>
              <option value="">— Select vehicle —</option>
              {vehicles.filter(v => v.vh_type==='Horse' || v.vh_type==='Rigid').map(v => (
                <option key={v.vh_code} value={v.vh_code}>
                  {v.vh_code} — {v.vh_make} {v.vh_model} ({(Number(v.vh_odometer)||0).toLocaleString()} km)
                </option>
              ))}
            </select>
          </div>
          {selVeh && (
            <div style={{ background:'#f0f8ff', border:'1px solid #bee3f8', borderRadius:6, padding:'10px 14px', marginBottom:12, fontSize:12 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                <div><span style={{ color:'#888' }}>Odometer: </span>
                  <strong>{Number(selVeh.vh_odometer||0).toLocaleString()} km</strong></div>
                <div><span style={{ color:'#888' }}>Next Service: </span>
                  <strong style={{ color:((Number(selVeh.vh_next_service||0)-Number(selVeh.vh_odometer||0))<=0)?'#e53e3e':'#333' }}>
                    {selVeh.vh_next_service ? Number(selVeh.vh_next_service).toLocaleString()+' km' : '—'}
                  </strong></div>
              </div>
            </div>
          )}
          <div className="form-group">
            <label>Trigger / Reason</label>
            <input value={form.sc_trigger} onChange={e => set('sc_trigger', e.target.value)}
              placeholder="e.g. Service due: 3000 km remaining" />
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea value={form.sc_notes} onChange={e => set('sc_notes', e.target.value)}
              placeholder="Any additional notes…" rows={3}
              style={{ resize:'vertical', fontFamily:'inherit', fontSize:13 }} />
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

// ── Service Card Detail Modal ──────────────────────────────────────────────────
function ServiceCardModal({ card, onClose, onUpdated }) {
  const [currentCard, setCurrentCard] = useState(card);
  const [activeTab, setActiveTab]     = useState('checklist');
  const [busy, setBusy]               = useState(false);

  // Reject flow
  const [showReject, setShowReject]   = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Complete flow
  const [showComplete, setShowComplete] = useState(false);
  const [completionKm, setCompletionKm] = useState('');
  const [kmError, setKmError]           = useState('');

  const update = (updated) => { setCurrentCard(updated); onUpdated(updated); };

  // ── Accept ────────────────────────────────────────────────────────────────
  const accept = async () => {
    setBusy(true);
    try {
      const updated = await req(`/service/${currentCard.sc_no}`, {
        method:'PATCH', body: JSON.stringify({ sc_status:'SERVICE_ACCEPTED' }),
      });
      update(updated);
    } catch(e) { alert(e.message); } finally { setBusy(false); }
  };

  // ── Reject ────────────────────────────────────────────────────────────────
  const reject = async () => {
    if (!rejectReason.trim()) { alert('Please enter a rejection reason'); return; }
    setBusy(true);
    try {
      const updated = await req(`/service/${currentCard.sc_no}/reject`, {
        method:'POST', body: JSON.stringify({ reason: rejectReason }),
      });
      update(updated); setShowReject(false);
    } catch(e) { alert(e.message); } finally { setBusy(false); }
  };

  // ── Toggle Waiting for Part ───────────────────────────────────────────────
  const toggleWaiting = async () => {
    const next = currentCard.sc_status === 'WAITING_FOR_PART' ? 'SERVICE_ACCEPTED' : 'WAITING_FOR_PART';
    setBusy(true);
    try {
      const updated = await req(`/service/${currentCard.sc_no}`, {
        method:'PATCH', body: JSON.stringify({ sc_status: next }),
      });
      update(updated);
    } catch(e) { alert(e.message); } finally { setBusy(false); }
  };

  // ── Complete ─────────────────────────────────────────────────────────────
  const complete = async () => {
    const km = parseInt(completionKm.replace(/\D/g, ''), 10);
    if (!km || km <= 0) { setKmError('Please enter a valid odometer reading'); return; }
    if (currentCard.sc_odometer && km < Number(currentCard.sc_odometer)) {
      setKmError(`KM (${km.toLocaleString()}) cannot be less than opening KM (${Number(currentCard.sc_odometer).toLocaleString()})`);
      return;
    }
    setKmError('');
    setBusy(true);
    try {
      const updated = await req(`/service/${currentCard.sc_no}/complete`, {
        method:'POST', body: JSON.stringify({ completion_km: km }),
      });
      update(updated); setShowComplete(false);
    } catch(e) { alert(e.message); } finally { setBusy(false); }
  };

  const st = currentCard.sc_status;
  const sCfg = STATUSES[st] || {};
  const isPending  = st === 'PENDING_SERVICE';
  const isAccepted = st === 'SERVICE_ACCEPTED';
  const isWaiting  = st === 'WAITING_FOR_PART';
  const isComplete = st === 'COMPLETE';
  const isRejected = st === 'REJECTED';
  const isActive   = isAccepted || isWaiting;

  const tabs = [
    { key: 'checklist', label: '✅ Checklist' },
    { key: 'comments',  label: '💬 Comments' },
    { key: 'audit',     label: '📜 Audit Trail' },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{
        width:'min(700px,100%)', maxHeight:'92dvh', display:'flex', flexDirection:'column',
      }}>

        {/* ── Header ── */}
        <div className="modal-header" style={{ flexShrink:0 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700 }}>
              {currentCard.sc_no} — {currentCard.sc_vehicle}
            </div>
            <div style={{ fontSize:11, opacity:0.75, marginTop:2 }}>
              {fmtDate(currentCard.sc_date)} · {currentCard.sc_operator}
              {currentCard.sc_odometer ? ` · ${Number(currentCard.sc_odometer).toLocaleString()} km at creation` : ''}
            </div>
          </div>
          <button onClick={onClose}
            style={{ background:'none', border:'none', color:'white', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>

        {/* ── Reason / Trigger panel ── */}
        <div style={{ padding:'12px 14px 0', background:'#f8fafc', flexShrink:0 }}>
          <div style={{
            background: sCfg.bg || '#f0f0f0',
            border: `1px solid ${sCfg.color || '#ccc'}44`,
            borderRadius:8, padding:'12px 16px',
          }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color: sCfg.color, letterSpacing:'0.08em',
                  textTransform:'uppercase', marginBottom:4 }}>
                  {sCfg.icon} {sCfg.label}
                </div>
                <div style={{ fontSize:15, fontWeight:700, color:'#1a202c' }}>
                  {currentCard.sc_trigger || 'Manual service'}
                </div>
                {currentCard.sc_notes && (
                  <div style={{ fontSize:12, color:'#666', marginTop:4, fontStyle:'italic' }}>
                    {currentCard.sc_notes}
                  </div>
                )}
                {isRejected && currentCard.sc_rejected_reason && (
                  <div style={{ fontSize:12, color:'#e53e3e', marginTop:6, fontWeight:600 }}>
                    Rejection reason: {currentCard.sc_rejected_reason}
                  </div>
                )}
                {isComplete && currentCard.sc_completion_km && (
                  <div style={{ fontSize:12, color:'#059669', marginTop:6, fontWeight:600 }}>
                    ✅ Completed at {Number(currentCard.sc_completion_km).toLocaleString()} km
                  </div>
                )}
              </div>

              {/* ── Action buttons by status ── */}
              <div style={{ display:'flex', flexDirection:'column', gap:8, alignItems:'flex-start', minWidth:0 }}>

                {/* PENDING → Accept or Reject */}
                {isPending && (
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    <button onClick={() => setShowReject(true)} disabled={busy}
                      style={{ padding:'8px 18px', borderRadius:6, fontSize:12, fontWeight:700,
                        border:'2px solid #e53e3e', background:'white', color:'#e53e3e',
                        cursor:'pointer', opacity: busy?0.6:1 }}>
                      ✕ Reject
                    </button>
                    <button onClick={accept} disabled={busy}
                      style={{ padding:'8px 18px', borderRadius:6, fontSize:12, fontWeight:700,
                        border:'none', background:'#059669', color:'white',
                        cursor:'pointer', opacity: busy?0.6:1 }}>
                      {busy ? 'Accepting…' : '✓ Accept Service'}
                    </button>
                  </div>
                )}

                {/* ACCEPTED / WAITING → Waiting for Part toggle + Complete */}
                {isActive && (
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    <button onClick={toggleWaiting} disabled={busy}
                      style={{ padding:'7px 16px', borderRadius:6, fontSize:12, fontWeight:700,
                        border: `2px solid ${isWaiting ? '#6366f1':'#dc2626'}`,
                        background: isWaiting ? '#eef2ff' : 'white',
                        color: isWaiting ? '#6366f1' : '#dc2626',
                        cursor:'pointer', opacity: busy?0.6:1 }}>
                      {isWaiting ? '↩ Parts Arrived' : '⏳ Waiting for Part'}
                    </button>
                    <button onClick={() => setShowComplete(true)} disabled={busy}
                      style={{ padding:'7px 16px', borderRadius:6, fontSize:12, fontWeight:700,
                        border:'none', background:'#059669', color:'white',
                        cursor:'pointer', opacity: busy?0.6:1 }}>
                      🏁 Complete Service
                    </button>
                  </div>
                )}

                {/* Vehicle blocked notice */}
                {isActive && (
                  <div style={{ fontSize:11, color:'#c05621' }}>
                    🚫 {currentCard.sc_vehicle} blocked from new load cards
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Reject modal (inline) ── */}
        {showReject && (
          <div style={{
            padding:'12px 20px', background:'#fff0f0', borderTop:'1px solid #fca5a5', flexShrink:0,
          }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#e53e3e', marginBottom:8 }}>
              Rejection Reason *
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <input value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                placeholder="Explain why the service is being rejected…"
                autoFocus
                style={{ flex:1, padding:'8px 12px', fontSize:13, border:'1px solid #fca5a5',
                  borderRadius:6, outline:'none' }} />
              <button onClick={() => setShowReject(false)} disabled={busy}
                style={{ padding:'8px 14px', borderRadius:6, fontSize:12, border:'1px solid #ccc',
                  background:'white', cursor:'pointer' }}>Cancel</button>
              <button onClick={reject} disabled={busy || !rejectReason.trim()}
                style={{ padding:'8px 14px', borderRadius:6, fontSize:12, fontWeight:700,
                  border:'none', background:'#e53e3e', color:'white', cursor:'pointer',
                  opacity: (busy || !rejectReason.trim()) ? 0.6 : 1 }}>
                {busy ? '…' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        )}

        {/* ── Complete modal (inline) ── */}
        {showComplete && (
          <div style={{
            padding:'12px 20px', background:'#f0fdf4', borderTop:'1px solid #86efac', flexShrink:0,
          }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#059669', marginBottom:8 }}>
              🏁 Complete Service — Enter Closing Odometer Reading *
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'flex-start', flexWrap:'wrap' }}>
              <div style={{ flex:1, minWidth:200 }}>
                <input
                  type="number"
                  value={completionKm}
                  onChange={e => { setCompletionKm(e.target.value); setKmError(''); }}
                  placeholder={`e.g. ${currentCard.sc_odometer ? (Number(currentCard.sc_odometer)+500).toLocaleString() : '250000'}`}
                  autoFocus
                  style={{ width:'100%', padding:'8px 12px', fontSize:14, fontWeight:600,
                    border: `1px solid ${kmError ? '#e53e3e':'#86efac'}`, borderRadius:6, outline:'none', boxSizing:'border-box' }}
                />
                {kmError && <div style={{ fontSize:11, color:'#e53e3e', marginTop:4 }}>{kmError}</div>}
                <div style={{ fontSize:11, color:'#888', marginTop:4 }}>
                  Opening KM: {currentCard.sc_odometer ? Number(currentCard.sc_odometer).toLocaleString() : '—'} km
                  &nbsp;· This will update the vehicle odometer and unblock it from loads.
                </div>
              </div>
              <button onClick={() => setShowComplete(false)} disabled={busy}
                style={{ padding:'8px 14px', borderRadius:6, fontSize:12, border:'1px solid #ccc',
                  background:'white', cursor:'pointer', alignSelf:'flex-start' }}>Cancel</button>
              <button onClick={complete} disabled={busy || !completionKm}
                style={{ padding:'8px 18px', borderRadius:6, fontSize:12, fontWeight:700,
                  border:'none', background:'#059669', color:'white', cursor:'pointer',
                  alignSelf:'flex-start', opacity: (busy || !completionKm)?0.6:1 }}>
                {busy ? 'Saving…' : '✓ Confirm Complete'}
              </button>
            </div>
          </div>
        )}

        {/* ── Tabs (only show checklist/comments/audit when not pending/rejected) ── */}
        {!isRejected && (
          <>
            <div style={{ display:'flex', borderBottom:'1px solid #e8edf2', background:'#fff', flexShrink:0 }}>
              {tabs.map(t => (
                <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
                  padding:'10px 20px', fontSize:12, fontWeight: activeTab===t.key ? 700:400,
                  border:'none', background:'none', cursor: isPending ? 'not-allowed' : 'pointer',
                  borderBottom: activeTab===t.key ? '2px solid #005A8E':'2px solid transparent',
                  color: activeTab===t.key ? '#005A8E':'#888',
                  opacity: isPending ? 0.4 : 1,
                }}
                  disabled={isPending}
                  title={isPending ? 'Accept the service first to access the checklist' : ''}
                >{t.label}</button>
              ))}
            </div>

            {isPending && (
              <div style={{ padding:'20px 14px', textAlign:'center', color:'#aaa', fontSize:13, fontStyle:'italic' }}>
                Accept the service first to unlock the checklist &amp; comments
              </div>
            )}

            {!isPending && (
              <div style={{ flex:1, overflowY:'auto', padding:'12px 14px' }}>
                {activeTab==='checklist' && <Checklist serviceNo={currentCard.sc_no} readOnly={isComplete} />}
                {activeTab==='comments'  && <Comments serviceNo={currentCard.sc_no} />}
                {activeTab==='audit'     && <AuditTrail serviceNo={currentCard.sc_no} />}
              </div>
            )}
          </>
        )}

        {/* Audit trail still available when rejected */}
        {isRejected && (
          <div style={{ flex:1, overflowY:'auto', padding:'16px 20px' }}>
            <AuditTrail serviceNo={currentCard.sc_no} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── ServiceCardTable — reusable table for any status group ────────────────────
function ServiceCardTable({ cards, vehicles, loading, onOpen, emptyMsg }) {
  return (
    <>
    <div className="mobile-card-list">
      {loading && <div className="loading">Loading…</div>}
      {!loading && cards.length===0 && <div className="empty-state">{emptyMsg || 'No records found'}</div>}
      {!loading && cards.map(c => {
        const veh = vehicles.find(v => v.vh_code === c.sc_vehicle);
        const cfg = STATUSES[c.sc_status] || {};
        const statusColors = { Pending:'#d97706', Accepted:'#1e40af', 'Waiting for Part':'#7c3aed', Complete:'#059669', Rejected:'#e53e3e' };
        return (
          <div key={c.sc_no} className="data-card" onClick={() => onOpen(c)}
            style={{borderLeftColor: statusColors[c.sc_status]||'var(--blue)'}}>
            <div className="data-card-header">
              <div>
                <div className="data-card-title" style={{fontFamily:'monospace'}}>{cfg.icon} {c.sc_no}</div>
                <div className="data-card-sub">{c.sc_vehicle} · {veh?`${veh.vh_make||''} ${veh.vh_model||''}`.trim():'—'}</div>
              </div>
              <StatusBadge status={c.sc_status} />
            </div>
            <div className="data-card-meta">
              <div>Date: <strong>{fmtDate(c.sc_date)}</strong></div>
              <div>ODO: <strong>{c.sc_odometer?Number(c.sc_odometer).toLocaleString()+' km':'—'}</strong></div>
              {c.sc_trigger && <div style={{gridColumn:'1/-1',fontSize:11,color:'#666'}}>{c.sc_trigger}</div>}
            </div>
          </div>
        );
      })}
    </div>
    <div className="desktop-table">
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Service No.</th><th>Date</th><th>Vehicle</th>
            <th>Make / Model</th><th>Odometer</th><th>Trigger / Reason</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={7}><div className="loading">Loading…</div></td></tr>}
          {!loading && cards.length===0 && (
            <tr><td colSpan={7}><div className="empty-state">{emptyMsg || 'No records found'}</div></td></tr>
          )}
          {!loading && cards.map(c => {
            const veh = vehicles.find(v => v.vh_code === c.sc_vehicle);
            const cfg = STATUSES[c.sc_status] || {};
            return (
              <tr key={c.sc_no} onClick={() => onOpen(c)} style={{ cursor:'pointer' }}>
                <td className="mono" style={{ fontWeight:700 }}>{cfg.icon} {c.sc_no}</td>
                <td>{fmtDate(c.sc_date)}</td>
                <td className="mono" style={{ fontWeight:600 }}>{c.sc_vehicle}</td>
                <td>{veh ? `${veh.vh_make||''} ${veh.vh_model||''}`.trim()||'—' : '—'}</td>
                <td className="mono">{c.sc_odometer ? Number(c.sc_odometer).toLocaleString()+' km':'—'}</td>
                <td style={{ fontSize:12, color:'#666', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {c.sc_trigger||'—'}
                </td>
                <td><StatusBadge status={c.sc_status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </div>
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ServiceCards() {
  const [pageTab, setPageTab]   = useState('pending');  // pending | active | complete | rejected
  const [allCards, setAllCards] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [stats, setStats]       = useState({});
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [showNew, setShowNew]   = useState(false);
  const [openCard, setOpenCard] = useState(null);
  const [autoResult, setAutoResult] = useState(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      try {
        const r = await req('/service/auto-create', { method:'POST' });
        if (r.created > 0) setAutoResult(r);
      } catch {}

      const [cardsRes, vehRes, statsRes] = await Promise.all([
        req('/service?limit=2000'),
        req('/vehicles?active=all'),
        req('/service/stats'),
      ]);
      setAllCards(cardsRes.data || []);
      setVehicles(Array.isArray(vehRes) ? vehRes : []);
      setStats(statsRes || {});
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const s = search.toLowerCase();
  const match = c => !s || c.sc_no?.toLowerCase().includes(s) || c.sc_vehicle?.toLowerCase().includes(s);

  const pending  = allCards.filter(c => c.sc_status === 'PENDING_SERVICE'  && match(c));
  const active   = allCards.filter(c => ['SERVICE_ACCEPTED','WAITING_FOR_PART'].includes(c.sc_status) && match(c));
  const complete = allCards.filter(c => c.sc_status === 'COMPLETE'          && match(c));
  const rejected = allCards.filter(c => c.sc_status === 'REJECTED'          && match(c));

  const pageTabs = [
    { key:'pending',  label:'Pending Service',  count: stats.pending,          color:'#6366f1', emptyMsg:'No pending service cards.' },
    { key:'active',   label:'Active Services',  count: (stats.accepted||0) + (stats.waiting_for_part||0), color:'#d97706', emptyMsg:'No active services.' },
    { key:'complete', label:'Complete',         count: stats.complete,          color:'#059669', emptyMsg:'No completed services yet.' },
    { key:'rejected', label:'Rejected',         count: stats.rejected || 0,    color:'#6b7280', emptyMsg:'No rejected service cards.' },
  ];

  const tabCards = { pending, active, complete, rejected };
  const currentCards = tabCards[pageTab] || [];
  const currentTab = pageTabs.find(t => t.key === pageTab);

  return (
    <div>
      {/* Stats */}
      <div className="stats-grid">
        {[
          { label:'Total',            val: stats.total,                                         color:'#1a202c' },
          { label:'Pending',          val: stats.pending,                                       color:'#6366f1' },
          { label:'Active',           val: (stats.accepted||0)+(stats.waiting_for_part||0),    color:'#d97706' },
          { label:'Complete',         val: stats.complete,                                      color:'#059669' },
          { label:'Rejected',         val: stats.rejected || 0,                                 color:'#6b7280' },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ color: s.color }}>{s.val ?? '—'}</div>
          </div>
        ))}
      </div>

      {/* Auto-create banner */}
      {autoResult && autoResult.created > 0 && (
        <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8,
          padding:'10px 16px', marginBottom:12, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:13, color:'#059669', fontWeight:600 }}>
            🔧 {autoResult.created} service card{autoResult.created>1?'s':''} automatically created for vehicles due or overdue.
          </span>
          <button onClick={() => setAutoResult(null)}
            style={{ background:'none', border:'none', cursor:'pointer', color:'#aaa', fontSize:18 }}>×</button>
        </div>
      )}

      {/* ── Page-level tabs ── */}
      <div style={{ display:'flex', borderBottom:'2px solid #e8edf2', marginBottom:0, background:'white',
        borderRadius:'8px 8px 0 0', overflow:'hidden', border:'1px solid #e8edf2' }}>
        {pageTabs.map(t => {
          const active = pageTab === t.key;
          return (
            <button key={t.key} onClick={() => setPageTab(t.key)} style={{
              flex:1, padding:'12px 8px', fontSize:12, fontWeight: active ? 700:400,
              border:'none', background: active ? 'white':'#f8fafc',
              borderBottom: active ? `3px solid ${t.color}`:'3px solid transparent',
              color: active ? t.color:'#888', cursor:'pointer',
              transition:'all 0.15s',
            }}>
              {t.label}
              {t.count !== undefined && (
                <span style={{
                  marginLeft:6, display:'inline-block', minWidth:18, padding:'1px 5px',
                  background: active ? t.color:'#e8edf2', color: active ? 'white':'#888',
                  borderRadius:10, fontSize:10, fontWeight:700,
                }}>
                  {t.count ?? 0}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search + New button bar */}
      <div style={{ display:'flex', gap:8, alignItems:'center', padding:'10px 0 8px',
        background:'white', borderLeft:'1px solid #e8edf2', borderRight:'1px solid #e8edf2',
        paddingLeft:12, paddingRight:12 }}>
        <input placeholder={`Search ${currentTab?.label || ''}…`} value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex:1, padding:'7px 12px', fontSize:13, border:'1px solid #ddd', borderRadius:6, outline:'none' }} />
        {pageTab === 'pending' && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>
            + New Service Card
          </button>
        )}
      </div>

      {/* Table for current tab */}
      <ServiceCardTable
        cards={currentCards}
        vehicles={vehicles}
        loading={loading}
        onOpen={setOpenCard}
        emptyMsg={currentTab?.emptyMsg}
      />

      {showNew && (
        <NewServiceModal vehicles={vehicles} onClose={() => setShowNew(false)}
          onCreated={c => { setShowNew(false); setOpenCard(c); loadAll(); }} />
      )}

      {openCard && (
        <ServiceCardModal card={openCard}
          onClose={() => { setOpenCard(null); loadAll(); }}
          onUpdated={updated => {
            setOpenCard(updated);
            setAllCards(prev => prev.map(c => c.sc_no===updated.sc_no ? updated : c));
          }} />
      )}
    </div>
  );
}



