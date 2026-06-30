import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { canCreateCreditNote, canManageInvoices } from '../lib/roles';

const API = import.meta.env.VITE_API_URL || '';
const token = () => localStorage.getItem('lp_token');
const req = (path, opts = {}) =>
  fetch(API + '/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token(), ...(opts.headers || {}) },
  }).then(r => r.json());

const fmtR = (n) => n || n === 0 ? 'R ' + Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2 }) : '—';
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const STATUS_BADGE = { DRAFT: 'badge-amber', FINAL: 'badge-green', CREDITED: 'badge-gray' };

export default function Invoices() {
  const { user } = useAuth();
  const [tab, setTab] = useState('ready');
  const [draftsReady, setDraftsReady] = useState([]);    // loads in WAIT_INVOICE_NO
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState(null);        // load being invoiced
  const [selectedInv, setSelectedInv] = useState(null);  // invoice being viewed/actioned
  const [cnModal, setCnModal] = useState(false);
  const [cnReason, setCnReason] = useState('');
  const [cnAmountExcl, setCnAmountExcl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [draftsRes, invRes] = await Promise.all([
        req('/invoices/drafts'),
        req(`/invoices${statusFilter ? '?status=' + statusFilter : ''}`),
      ]);
      if (draftsRes?.error) { setError('Could not load drafts: ' + draftsRes.error); setLoading(false); return; }
      if (invRes?.error)    { setError('Could not load invoices: ' + invRes.error);  setLoading(false); return; }
      setDraftsReady(Array.isArray(draftsRes) ? draftsRes : []);
      setInvoices(Array.isArray(invRes) ? invRes : []);
    } catch (e) {
      setError('Failed to load invoice data: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [statusFilter]);

  // Create draft invoice for a load
  const createDraft = async (load) => {
    setError('');
    setSaving(true);
    try {
      const result = await req('/invoices', {
        method: 'POST',
        body: JSON.stringify({ load_no: load.m_load_no }),
      });
      if (result.error) { setError(result.error); return; }
      setSelected(null);
      setTab('invoices');
      loadData();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  // Approve (finalise) a draft invoice
  const approveInvoice = async (inv) => {
    if (!window.confirm(`Finalise invoice ${inv.inv_number}? This cannot be undone.`)) return;
    setSaving(true);
    try {
      const result = await req(`/invoices/${inv.id}/approve`, { method: 'POST' });
      if (result.error) { alert(result.error); return; }
      setSelectedInv(null);
      loadData();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  // Email POD + invoice to the client (Outlook/Graph)
  const sendToClient = async (inv) => {
    if (!window.confirm(`Email POD/invoice to the client for ${inv.inv_number}?`)) return;
    setSaving(true);
    try {
      const result = await req(`/invoices/${inv.id}/send-to-client`, { method: 'POST' });
      if (result.error) { alert(result.error); return; }
      const summary = (result.sent || []).map(s =>
        s.skipped ? `${s.type}: skipped — ${s.skipped}` : `${s.type} sent to ${s.to}`
      ).join('\n');
      alert(`Done:\n${summary}`);
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  // Raise credit note
  const submitCreditNote = async () => {
    if (!cnReason.trim()) return setError('A reason for the credit note is required');
    setSaving(true);
    setError('');
    try {
      const payload = { reason: cnReason };
      if (cnAmountExcl) payload.amount_excl = parseFloat(cnAmountExcl);
      const result = await req(`/invoices/${selectedInv.id}/credit-note`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (result.error) { setError(result.error); return; }
      setCnModal(false);
      setCnReason('');
      setCnAmountExcl('');
      setSelectedInv(null);
      loadData();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const tabStyle = (t) => ({
    padding: '8px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    borderBottom: tab === t ? '2px solid #005A8E' : '2px solid transparent',
    color: tab === t ? '#005A8E' : '#666',
  });

  const draftCount = draftsReady.filter(l => !l.existing_invoice).length;

  return (
    <div>
      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Ready to Invoice</div><div className="stat-value" style={{ color: draftCount > 0 ? '#d97706' : '#059669' }}>{draftCount}</div></div>
        <div className="stat-card"><div className="stat-label">Draft Invoices</div><div className="stat-value" style={{ color:'#00AEEF' }}>{invoices.filter(i => i.inv_status === 'DRAFT').length}</div></div>
        <div className="stat-card"><div className="stat-label">Final Invoices</div><div className="stat-value" style={{ color:'#059669' }}>{invoices.filter(i => i.inv_status === 'FINAL').length}</div></div>
        <div className="stat-card"><div className="stat-label">Credit Notes</div><div className="stat-value" style={{ color:'#666' }}>{invoices.filter(i => i.inv_status === 'CREDITED').length}</div></div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid #e8edf2', marginBottom:16 }}>
        <div style={tabStyle('ready')} onClick={() => setTab('ready')}>
          Ready to Invoice
          {draftCount > 0 && <span style={{ marginLeft:6, background:'#d97706', color:'white', borderRadius:10, padding:'1px 6px', fontSize:11 }}>{draftCount}</span>}
        </div>
        <div style={tabStyle('invoices')} onClick={() => setTab('invoices')}>All Invoices</div>
      </div>

      {error && (
        <div style={{ background:'#fff5f5', border:'1px solid #fca5a5', borderRadius:4, padding:'10px 14px', marginBottom:12, color:'#e53e3e', fontSize:13 }}>
          ⚠ {error}
        </div>
      )}

      {/* ── READY TO INVOICE ── */}
      {tab === 'ready' && (
        <>
        <div className="mobile-card-list">
          {loading && <div className="loading">Loading…</div>}
          {!loading && draftsReady.length === 0 && <div className="empty-state">No loads awaiting invoice</div>}
          {!loading && draftsReady.map(load => (
            <div key={load.m_load_no} className="data-card">
              <div className="data-card-header">
                <div>
                  <div className="data-card-title">#{load.m_load_no} · {load.lp_customers?.c_name||load.m_customer}</div>
                  <div className="data-card-sub">{load.m_from} → {load.m_to} · {fmtDate(load.m_date)}</div>
                </div>
                <div style={{fontFamily:'monospace',fontWeight:700,color:'var(--blue-deep)',fontSize:14}}>
                  {fmtR(load.m_load_total||load.m_rate)}
                </div>
              </div>
              <div className="data-card-meta">
                <div>PO No: <strong>{load.m_order_no||'—'}</strong></div>
                <div>{load.existing_invoice
                  ? <span className={`badge ${STATUS_BADGE[load.existing_invoice.inv_status]}`}>{load.existing_invoice.inv_number}</span>
                  : <span className="badge badge-gray">No invoice yet</span>}</div>
              </div>
              {!load.existing_invoice && (
                <button className="btn btn-primary btn-sm" style={{marginTop:8}} onClick={() => createDraft(load)} disabled={saving}>
                  Create Draft
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="desktop-table">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Load No</th><th>Date</th><th>Customer</th><th>Route</th><th>Amount</th><th>Order No</th><th>Invoice</th><th></th></tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8}><div className="loading">Loading…</div></td></tr>}
              {!loading && draftsReady.length === 0 && <tr><td colSpan={8}><div className="empty-state">No loads awaiting invoice</div></td></tr>}
              {!loading && draftsReady.map(load => (
                <tr key={load.m_load_no}>
                  <td className="mono" style={{ fontWeight:600 }}>{load.m_load_no}</td>
                  <td>{fmtDate(load.m_date)}</td>
                  <td>{load.lp_customers?.c_name || load.m_customer}</td>
                  <td style={{ fontSize:12 }}>{load.m_from} → {load.m_to}</td>
                  <td>{fmtR(load.m_load_total || load.m_rate)}</td>
                  <td>{load.m_order_no || '—'}</td>
                  <td>
                    {load.existing_invoice ? (
                      <span className={`badge ${STATUS_BADGE[load.existing_invoice.inv_status]}`}>
                        {load.existing_invoice.inv_number} ({load.existing_invoice.inv_status})
                      </span>
                    ) : <span className="badge badge-gray">No invoice yet</span>}
                  </td>
                  <td>
                    {!load.existing_invoice && (
                      <button className="btn btn-primary btn-sm" onClick={() => createDraft(load)} disabled={saving}>
                        Create Draft
                      </button>
                    )}
                    {load.existing_invoice?.inv_status === 'DRAFT' && (
                      <button className="btn btn-sm" style={{ background:'#059669', color:'white' }}
                        onClick={() => { setTab('invoices'); }}>
                        View Draft
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>{/* end desktop-table */}
        </>
      )}

      {/* ── ALL INVOICES ── */}
      {tab === 'invoices' && (
        <>
          <div className="filter-bar">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="FINAL">Final</option>
              <option value="CREDITED">Credited</option>
            </select>
          </div>
          <div className="mobile-card-list">
            {loading && <div className="loading">Loading…</div>}
            {!loading && invoices.length === 0 && <div className="empty-state">No invoices found</div>}
            {!loading && invoices.map(inv => (
              <div key={inv.id} className="data-card" onClick={() => setSelectedInv(inv)}>
                <div className="data-card-header">
                  <div>
                    <div className="data-card-title">{inv.inv_number}</div>
                    <div className="data-card-sub">{inv.lp_customers?.c_name||inv.inv_customer} · {fmtDate(inv.inv_date)}</div>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
                    <span className={`badge ${STATUS_BADGE[inv.inv_status]||'badge-gray'}`}>{inv.inv_status}</span>
                    <span style={{fontFamily:'monospace',fontWeight:700,color:'var(--blue-deep)',fontSize:13}}>{fmtR(inv.inv_amount_incl)}</span>
                  </div>
                </div>
                <div className="data-card-meta">
                  <div>Load: <strong>{inv.inv_load_no}</strong></div>
                  <div>VAT: <strong>{fmtR(inv.inv_vat)}</strong></div>
                </div>
                {inv.inv_status==='DRAFT' && (
                  <button className="btn btn-primary btn-sm" style={{marginTop:8}} onClick={e=>{e.stopPropagation();approveInvoice(inv);}} disabled={saving}>Finalise</button>
                )}
              </div>
            ))}
          </div>
          <div className="desktop-table">
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Invoice No</th><th>Date</th><th>Load No</th><th>Customer</th><th>Excl. VAT</th><th>VAT</th><th>Incl. VAT</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={9}><div className="loading">Loading…</div></td></tr>}
                {!loading && invoices.length === 0 && <tr><td colSpan={9}><div className="empty-state">No invoices found</div></td></tr>}
                {!loading && invoices.map(inv => (
                  <tr key={inv.id} onClick={() => setSelectedInv(inv)} style={{ cursor:'pointer' }}>
                    <td className="mono" style={{ fontWeight:600 }}>{inv.inv_number}</td>
                    <td>{fmtDate(inv.inv_date)}</td>
                    <td className="mono">{inv.inv_load_no}</td>
                    <td>{inv.lp_customers?.c_name || inv.inv_customer}</td>
                    <td>{fmtR(inv.inv_amount_excl)}</td>
                    <td>{fmtR(inv.inv_vat)}</td>
                    <td style={{ fontWeight:600 }}>{fmtR(inv.inv_amount_incl)}</td>
                    <td><span className={`badge ${STATUS_BADGE[inv.inv_status] || 'badge-gray'}`}>{inv.inv_status}</span></td>
                    <td>
                      {inv.inv_status === 'DRAFT' && (
                        <button className="btn btn-primary btn-sm" onClick={e => { e.stopPropagation(); approveInvoice(inv); }} disabled={saving}>
                          Finalise
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>{/* end desktop-table */}
        </>
      )}

      {/* ── INVOICE DETAIL MODAL ── */}
      {selectedInv && !cnModal && (
        <div className="modal-overlay" onClick={() => setSelectedInv(null)}>
          <div className="modal" style={{ maxWidth:560 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selectedInv.inv_number}</h3>
              <button onClick={() => setSelectedInv(null)} style={{ background:'none', border:'none', color:'white', cursor:'pointer', fontSize:18 }}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px 20px', fontSize:13, marginBottom:20 }}>
                <div><span style={{ color:'#666' }}>Status:</span> <span className={`badge ${STATUS_BADGE[selectedInv.inv_status]}`}>{selectedInv.inv_status}</span></div>
                <div><span style={{ color:'#666' }}>Date:</span> {fmtDate(selectedInv.inv_date)}</div>
                <div><span style={{ color:'#666' }}>Load No:</span> {selectedInv.inv_load_no}</div>
                <div><span style={{ color:'#666' }}>Customer:</span> {selectedInv.lp_customers?.c_name || selectedInv.inv_customer}</div>
                <div><span style={{ color:'#666' }}>Order No:</span> {selectedInv.inv_order_no || '—'}</div>
                <div><span style={{ color:'#666' }}>Created By:</span> {selectedInv.inv_created_by}</div>
                {selectedInv.inv_approved_by && <div><span style={{ color:'#666' }}>Approved By:</span> {selectedInv.inv_approved_by}</div>}
              </div>
              <div style={{ background:'#f9fafb', borderRadius:6, padding:16, fontSize:13 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                  <span>{selectedInv.inv_description}</span>
                  <span>{fmtR(selectedInv.inv_amount_excl)}</span>
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6, color:'#666' }}>
                  <span>VAT (15%)</span>
                  <span>{fmtR(selectedInv.inv_vat)}</span>
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, fontSize:15, borderTop:'1px solid #e8edf2', paddingTop:8, marginTop:6 }}>
                  <span>Total (incl. VAT)</span>
                  <span>{fmtR(selectedInv.inv_amount_incl)}</span>
                </div>
              </div>
              {selectedInv.lp_credit_notes?.length > 0 && (
                <div style={{ marginTop:12, fontSize:12, color:'#666' }}>
                  Credit note raised: {selectedInv.lp_credit_notes[0].cn_number} — {fmtR(selectedInv.lp_credit_notes[0].cn_amount_incl)}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setSelectedInv(null)}>Close</button>
              {selectedInv.inv_status === 'DRAFT' && (
                <button className="btn btn-primary" onClick={() => approveInvoice(selectedInv)} disabled={saving}>
                  {saving ? 'Saving…' : 'Finalise Invoice'}
                </button>
              )}
              {selectedInv.inv_status === 'FINAL' && (
                <button className="btn" style={{ background:'#005A8E', color:'white' }} onClick={() => sendToClient(selectedInv)} disabled={saving}>
                  {saving ? 'Sending…' : '📧 Email to Client'}
                </button>
              )}
              {selectedInv.inv_status === 'FINAL' && canCreateCreditNote(user) && (
                <button className="btn" style={{ background:'#7c3aed', color:'white' }} onClick={() => { setCnModal(true); setCnAmountExcl(String(selectedInv.inv_amount_excl)); }}>
                  Raise Credit Note
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── CREDIT NOTE MODAL ── */}
      {selectedInv && cnModal && (
        <div className="modal-overlay" onClick={() => { setCnModal(false); }}>
          <div className="modal" style={{ maxWidth:500 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ background:'#7c3aed' }}>
              <h3>Raise Credit Note — {selectedInv.inv_number}</h3>
              <button onClick={() => setCnModal(false)} style={{ background:'none', border:'none', color:'white', cursor:'pointer', fontSize:18 }}>✕</button>
            </div>
            <div className="modal-body">
              {error && <div style={{ background:'#fff5f5', border:'1px solid #fca5a5', borderRadius:4, padding:'10px 14px', marginBottom:12, color:'#e53e3e', fontSize:13 }}>⚠ {error}</div>}
              <p style={{ fontSize:13, color:'#555', marginBottom:16 }}>
                Creating a credit note against invoice <strong>{selectedInv.inv_number}</strong>. Only the amount and reason can be changed.
              </p>
              <div className="form-group">
                <label>Credit Amount (Excl. VAT) *</label>
                <input
                  type="number"
                  value={cnAmountExcl}
                  onChange={e => setCnAmountExcl(e.target.value)}
                  placeholder={String(selectedInv.inv_amount_excl)}
                />
                {cnAmountExcl && (
                  <div style={{ fontSize:12, color:'#666', marginTop:4 }}>
                    Incl. VAT: {fmtR(parseFloat(cnAmountExcl) * 1.15)}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label>Reason for Credit Note *</label>
                <textarea
                  rows={3}
                  value={cnReason}
                  onChange={e => setCnReason(e.target.value)}
                  placeholder="Required — describe why the credit note is being raised…"
                  style={{ width:'100%', resize:'vertical' }}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setCnModal(false)}>Cancel</button>
              <button className="btn" style={{ background:'#7c3aed', color:'white' }} onClick={submitCreditNote} disabled={saving}>
                {saving ? 'Saving…' : 'Confirm Credit Note'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
