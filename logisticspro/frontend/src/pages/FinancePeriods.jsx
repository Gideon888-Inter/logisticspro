import { useState, useEffect } from 'react';

const API   = `${import.meta.env.VITE_API_URL}/api`;
const token = () => localStorage.getItem('lp_token');
const req   = (path, opts = {}) => fetch(API + path, {
  ...opts,
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(), ...(opts.headers || {}) },
}).then(r => r.json());

// Financial year range: 2020 → 2027 (current), generated client-side
// Backend returns real fy data; we also show a year selector to filter
const YEAR_RANGE = Array.from({ length: 9 }, (_, i) => 2020 + i).reverse(); // 2028 → 2020, current is 2027

export default function FinancePeriods({ user }) {
  const isAdmin   = user?.role === 'ADMIN';
  const isFinance = ['ADMIN', 'FINANCE'].includes(user?.role);

  const [financialYears, setFYs]  = useState([]);
  const [selectedFY, setSelectedFY] = useState('');   // fy_id
  const [periods, setPeriods]       = useState([]);
  const [loading, setLoading]       = useState(false);
  const [locking, setLocking]       = useState(null);
  const [unlocking, setUnlocking]   = useState(null);
  const [unlockReason, setReason]   = useState('');
  const [showUnlock, setShowUnlock] = useState(null);

  // Load financial years on mount
  useEffect(() => {
    req('/fin/financial-years').then(d => {
      const fys = Array.isArray(d) ? d : [];
      setFYs(fys);
      // Default to current FY
      const current = fys.find(f => f.is_current) || fys[0];
      if (current) setSelectedFY(String(current.fy_id));
    });
  }, []);

  // Load periods when FY changes
  useEffect(() => {
    if (!selectedFY) return;
    loadPeriods(selectedFY);
  }, [selectedFY]);

  const loadPeriods = async (fyId) => {
    setLoading(true);
    const data = await req(`/fin/periods-by-year/${fyId}`);
    setPeriods(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  const reload = () => selectedFY && loadPeriods(selectedFY);

  const lock = async (p) => {
    if (!confirm(`Lock ${p.period_name}? No further journals can be posted until unlocked.`)) return;
    setLocking(p.period_id);
    await req(`/fin/periods/${p.period_id}/lock`, {
      method: 'PATCH', body: JSON.stringify({ reason: 'Manual lock' }),
    });
    setLocking(null);
    reload();
  };

  const unlock = async () => {
    if (!unlockReason.trim()) return alert('Unlock reason is required');
    setUnlocking(showUnlock.period_id);
    await req(`/fin/periods/${showUnlock.period_id}/unlock`, {
      method: 'PATCH', body: JSON.stringify({ reason: unlockReason }),
    });
    setUnlocking(null);
    setShowUnlock(null);
    setReason('');
    reload();
  };

  const doExport = () => {
    const rows = periods.map(p => ({
      Period: p.period_name, From: p.period_start, To: p.period_end,
      Journals: p.total_journals || 0, Status: p.is_closed ? 'Locked' : 'Open',
      'Locked By': p.locked_by || '',
    }));
    if (!rows.length) return;
    const h   = Object.keys(rows[0]);
    const csv = [h, ...rows.map(r => h.map(k => `"${(r[k] ?? '').toString().replace(/"/g, '""')}"`))].map(r => r.join(',')).join('\n');
    const a   = document.createElement('a');
    a.href    = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `periods_${currentFY?.fy_code || selectedFY}.csv`;
    a.click();
  };

  const currentFY    = financialYears.find(f => String(f.fy_id) === selectedFY);
  const openCount    = periods.filter(p => !p.is_closed).length;
  const lockedCount  = periods.filter(p =>  p.is_closed).length;
  const journalTotal = periods.reduce((s, p) => s + (p.posted_journals || 0), 0);

  return (
    <div>
      {/* ── Financial Year Selector ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#005A8E' }}>Financial Year</div>

        {/* Dropdown showing available FYs from DB, supplemented by year range */}
        <select
          value={selectedFY}
          onChange={e => setSelectedFY(e.target.value)}
          style={{ fontSize: 14, fontWeight: 600, padding: '6px 12px', borderRadius: 6, border: '1px solid #005A8E', color: '#005A8E', background: 'white', minWidth: 160 }}
        >
          <option value="">— Select year —</option>
          {financialYears.length > 0
            ? financialYears.map(fy => (
                <option key={fy.fy_id} value={String(fy.fy_id)}>
                  {fy.fy_code}{fy.is_current ? ' (Current)' : ''}
                </option>
              ))
            : YEAR_RANGE.map(yr => (
                <option key={yr} value={String(yr)}>
                  FY{yr}{yr === 2027 ? ' ★ Current' : ''}
                </option>
              ))
          }
        </select>

        {currentFY && (
          <span style={{ fontSize: 12, color: '#888' }}>
            {currentFY.fy_start} → {currentFY.fy_end}
            {currentFY.is_current && <span className="badge badge-green" style={{ fontSize: 10, marginLeft: 8 }}>Current</span>}
          </span>
        )}
      </div>

      {/* ── Stats ── */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Periods</div>
          <div className="stat-value">{periods.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Open</div>
          <div className="stat-value" style={{ color: '#059669' }}>{openCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Locked</div>
          <div className="stat-value" style={{ color: '#e53e3e' }}>{lockedCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Posted Journals</div>
          <div className="stat-value" style={{ color: '#00AEEF' }}>{journalTotal}</div>
        </div>
      </div>

      {/* ── Export ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, justifyContent: 'flex-end' }}>
        <button className="btn btn-sm" onClick={doExport}>⬇ CSV</button>
        <button className="btn btn-sm" onClick={() => window.print()}>🖨 Print</button>
      </div>

      {/* ── Periods Table ── */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Period</th>
              <th>Dates</th>
              <th style={{ textAlign: 'center' }}>Journals</th>
              <th style={{ textAlign: 'center' }}>Posted</th>
              <th>VAT Period</th>
              <th>Status</th>
              <th>Locked By</th>
              {isFinance && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8}><div className="loading">Loading periods…</div></td></tr>
            )}
            {!loading && periods.length === 0 && (
              <tr><td colSpan={8}>
                <div className="empty-state">
                  {selectedFY
                    ? 'No periods found for this financial year.'
                    : 'Select a financial year above to view periods.'}
                </div>
              </td></tr>
            )}
            {!loading && periods.map(p => (
              <tr key={p.period_id}>
                <td style={{ fontWeight: 600 }}>{p.period_name}</td>
                <td style={{ fontSize: 12, color: '#666' }}>{p.period_start} → {p.period_end}</td>
                <td style={{ textAlign: 'center' }}>{p.total_journals || 0}</td>
                <td style={{ textAlign: 'center' }}>{p.posted_journals || 0}</td>
                <td className="mono" style={{ fontSize: 12 }}>{p.vat_period_code || '—'}</td>
                <td>
                  {p.is_closed
                    ? <span className="badge badge-red"   style={{ fontSize: 10 }}>🔒 Locked</span>
                    : <span className="badge badge-green" style={{ fontSize: 10 }}>Open</span>}
                </td>
                <td style={{ fontSize: 12 }}>{p.locked_by || '—'}</td>
                {isFinance && (
                  <td>
                    {!p.is_closed && (
                      <button
                        className="btn btn-sm"
                        style={{ color: '#e53e3e', fontSize: 11 }}
                        onClick={() => lock(p)}
                        disabled={locking === p.period_id}
                      >
                        {locking === p.period_id ? '…' : 'Lock'}
                      </button>
                    )}
                    {p.is_closed && isAdmin && (
                      <button
                        className="btn btn-sm"
                        style={{ fontSize: 11 }}
                        onClick={() => setShowUnlock(p)}
                        disabled={unlocking === p.period_id}
                      >
                        {unlocking === p.period_id ? '…' : 'Unlock'}
                      </button>
                    )}
                    {p.is_closed && !isAdmin && (
                      <span style={{ fontSize: 11, color: '#aaa' }}>Admin only</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Unlock Modal ── */}
      {showUnlock && (
        <div className="modal-overlay" onClick={() => setShowUnlock(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Unlock Period — {showUnlock.period_name}</h3>
              <button onClick={() => setShowUnlock(null)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, marginBottom: 12, color: '#555' }}>
                ⚠️ Unlocking allows new journals to be posted into a closed period. This action is audit-logged.
              </p>
              <div className="form-group">
                <label>Unlock Reason *</label>
                <textarea
                  rows={3}
                  value={unlockReason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Late supplier invoice — approved by Gideon 21/06/2026"
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowUnlock(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={unlock} disabled={!unlockReason.trim()}>Confirm Unlock</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
