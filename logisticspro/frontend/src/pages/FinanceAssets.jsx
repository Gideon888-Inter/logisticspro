import { useState, useEffect, useCallback } from 'react';

const API   = `${import.meta.env.VITE_API_URL}/api`;
const token = () => localStorage.getItem('lp_token');
const req   = (path, opts = {}) => fetch(API + path, {
  ...opts,
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(), ...(opts.headers || {}) },
}).then(r => r.json());

const fmt    = (n) => n == null ? '—' : `R ${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtR   = (n) => n == null ? '' : Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => n == null ? '—' : `${Number(n).toFixed(2)}%`;

function exportCSV(rows, filename) {
  const headers = Object.keys(rows[0] || {});
  const csv = [headers, ...rows.map(r => headers.map(h => `"${(r[h] ?? '').toString().replace(/"/g, '""')}"`))].map(r => r.join(',')).join('\n');
  const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = filename; a.click();
}

function ExportBar({ onCSV }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 10, justifyContent: 'flex-end' }}>
      <button className="btn btn-sm" onClick={onCSV}>⬇ CSV</button>
      <button className="btn btn-sm" onClick={() => window.print()}>🖨 Print</button>
    </div>
  );
}

const EMPTY = { asset_code: '', description: '', class_code: '', location: '', purchase_price: '', purchase_date: '', depre_start_date: '', ifrs_useful_life_yr: '', sars_wt_rate_pct: '', reg_number: '' };

// ── ASSET LIST (existing) ─────────────────────────────────────
function AssetList({ classes, onViewTransactions }) {
  const [assets, setAssets]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(null);
  const [classFilter, setClass] = useState('');
  const [search, setSearch]     = useState('');
  const [showAdd, setShowAdd]   = useState(false);
  const [form, setForm]         = useState(EMPTY);
  const [saving, setSaving]     = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const aRes = await req('/fin/assets');
    setAssets(Array.isArray(aRes) ? aRes : []);
    setLoading(false);
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const saveAsset = async () => {
    if (!form.asset_code.trim() || !form.description.trim() || !form.class_code)
      return alert('Asset Code, Description, and Class are required');
    setSaving(true);
    try {
      const res = await req('/fin/assets', { method: 'POST', body: JSON.stringify(form) });
      if (res.error) throw new Error(res.error);
      setShowAdd(false); setForm(EMPTY); load();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const filtered = assets.filter(a =>
    (!classFilter || a.class_code === classFilter) &&
    (!search || a.asset_code.toLowerCase().includes(search.toLowerCase()) ||
                a.description.toLowerCase().includes(search.toLowerCase()))
  );

  const totalNBV         = assets.filter(a => a.is_active).reduce((s, a) => s + (a.book_nbv           || 0), 0);
  const totalTaxVal      = assets.filter(a => a.is_active).reduce((s, a) => s + (a.tax_value          || 0), 0);
  const totalCost        = assets.filter(a => a.is_active).reduce((s, a) => s + (a.purchase_price      || 0), 0);
  const totalDeferredTax = assets.filter(a => a.is_active).reduce((s, a) => s + (a.deferred_tax_27pct || 0), 0);

  const doExport = () => exportCSV(filtered.map(a => ({
    Code: a.asset_code, Description: a.description, Class: a.class_code, Location: a.location || '',
    Cost: a.purchase_price, 'Book NBV': a.book_nbv, 'Tax Value': a.tax_value,
    'Timing Diff': a.timing_difference, 'Depre Start': a.depre_start_date || '',
    Status: a.fully_depreciated ? 'Fully Depr' : a.is_active ? 'Active' : 'Disposed',
  })), 'fixed_assets.csv');

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Active Assets</div><div className="stat-value" style={{ color: '#00AEEF' }}>{assets.filter(a => a.is_active).length}</div></div>
        <div className="stat-card"><div className="stat-label">Total Cost</div><div className="stat-value" style={{ fontSize: 15 }}>{fmt(totalCost)}</div></div>
        <div className="stat-card"><div className="stat-label">Book NBV (IFRS)</div><div className="stat-value" style={{ fontSize: 15, color: '#005A8E' }}>{fmt(totalNBV)}</div></div>
        <div className="stat-card"><div className="stat-label">Tax Value (SARS)</div><div className="stat-value" style={{ fontSize: 15 }}>{fmt(totalTaxVal)}</div></div>
        <div className="stat-card"><div className="stat-label">Deferred Tax @27%</div><div className="stat-value" style={{ fontSize: 14, color: '#d97706' }}>{fmt(totalDeferredTax)}</div></div>
      </div>
      <div className="filter-bar">
        <input placeholder="Search asset code or description…" value={search} onChange={e => setSearch(e.target.value)} />
        <select value={classFilter} onChange={e => setClass(e.target.value)}>
          <option value="">All Classes</option>
          {classes.map(c => <option key={c.class_code} value={c.class_code}>{c.class_code} — {c.class_name}</option>)}
        </select>
        <button className="btn btn-primary btn-sm" onClick={() => { setForm(EMPTY); setShowAdd(true); }}>+ New Asset</button>
      </div>
      <ExportBar onCSV={doExport} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th><th>Description</th><th>Class</th>
              <th style={{ textAlign: 'right' }}>Cost</th>
              <th style={{ textAlign: 'right' }}>Book NBV</th>
              <th style={{ textAlign: 'right' }}>Tax Value</th>
              <th style={{ textAlign: 'right' }}>Timing Diff</th>
              <th>Depre Start</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10}><div className="loading">Loading fixed assets…</div></td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={10}><div className="empty-state">No assets found</div></td></tr>}
            {!loading && filtered.map(a => (
              <tr key={a.asset_code} style={{ opacity: a.is_active ? 1 : 0.55 }}>
                <td className="mono" style={{ fontWeight: 600 }}>{a.asset_code}</td>
                <td style={{ cursor: 'pointer' }} onClick={() => setSelected(a)}>{a.description}</td>
                <td><span className="badge badge-purple" style={{ fontSize: 10 }}>{a.class_code}</span></td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmt(a.purchase_price)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#005A8E' }}>{fmt(a.book_nbv)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(a.tax_value)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', color: (a.timing_difference || 0) > 0 ? '#d97706' : '#059669' }}>{fmt(a.timing_difference)}</td>
                <td style={{ fontSize: 12 }}>{a.depre_start_date || '—'}</td>
                <td>
                  {a.fully_depreciated
                    ? <span className="badge badge-gray"  style={{ fontSize: 10 }}>Fully Depr.</span>
                    : a.is_active
                      ? <span className="badge badge-green" style={{ fontSize: 10 }}>Active</span>
                      : <span className="badge badge-red"   style={{ fontSize: 10 }}>Disposed</span>}
                </td>
                <td>
                  <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 7px' }}
                    onClick={() => onViewTransactions(a.asset_code, a.description)}>
                    Ledger
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Asset Detail Modal */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" style={{ maxWidth: 580 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selected.asset_code} — {selected.description}</h3>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label>Class</label><div><span className="badge badge-purple">{selected.class_code}</span> {selected.class_name}</div></div>
                <div className="form-group"><label>Location</label><div>{selected.location || '—'}</div></div>
                <div className="form-group"><label>Reg Number</label><div className="mono">{selected.reg_number || '—'}</div></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Purchase Price</label><div style={{ fontWeight: 600 }}>{fmt(selected.purchase_price)}</div></div>
                <div className="form-group"><label>SARS W&amp;T Rate</label><div>{fmtPct(selected.sars_wt_rate_pct)}</div></div>
                <div className="form-group"><label>IFRS Life</label><div>{selected.ifrs_useful_life_yr} years</div></div>
              </div>
              <div style={{ background: '#f5f7fa', borderRadius: 6, padding: 12, marginTop: 8 }}>
                <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Depreciation Summary</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                  <div><label style={{ fontSize: 11, color: '#888' }}>Book NBV (IFRS)</label><div style={{ fontWeight: 700, color: '#005A8E', fontSize: 16 }}>{fmt(selected.book_nbv)}</div></div>
                  <div><label style={{ fontSize: 11, color: '#888' }}>Tax Value (SARS)</label><div style={{ fontWeight: 700, fontSize: 16 }}>{fmt(selected.tax_value)}</div></div>
                  <div><label style={{ fontSize: 11, color: '#888' }}>Timing Difference</label><div style={{ fontWeight: 600, color: '#d97706' }}>{fmt(selected.timing_difference)}</div></div>
                  <div><label style={{ fontSize: 11, color: '#888' }}>Deferred Tax @27%</label><div style={{ fontWeight: 600, color: '#d97706' }}>{fmt(selected.deferred_tax_27pct)}</div></div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-sm" style={{ marginRight: 'auto' }}
                onClick={() => { setSelected(null); onViewTransactions(selected.asset_code, selected.description); }}>
                View Ledger →
              </button>
              <button className="btn btn-primary" onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Asset Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" style={{ maxWidth: 580 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>New Fixed Asset</h3>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label>Asset Code *</label><input value={form.asset_code} onChange={e => set('asset_code', e.target.value.toUpperCase())} placeholder="e.g. VEH-001" /></div>
                <div className="form-group"><label>Description *</label><input value={form.description} onChange={e => set('description', e.target.value)} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Asset Class *</label>
                  <select value={form.class_code} onChange={e => set('class_code', e.target.value)}>
                    <option value="">— Select class —</option>
                    {classes.map(c => <option key={c.class_code} value={c.class_code}>{c.class_code} — {c.class_name}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>Location</label><input value={form.location} onChange={e => set('location', e.target.value)} /></div>
                <div className="form-group"><label>Reg Number</label><input value={form.reg_number} onChange={e => set('reg_number', e.target.value)} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Purchase Price (R)</label><input type="number" value={form.purchase_price} onChange={e => set('purchase_price', e.target.value)} placeholder="0.00" /></div>
                <div className="form-group"><label>Purchase Date</label><input type="date" value={form.purchase_date} onChange={e => set('purchase_date', e.target.value)} /></div>
                <div className="form-group"><label>Depreciation Start</label><input type="date" value={form.depre_start_date} onChange={e => set('depre_start_date', e.target.value)} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>IFRS Useful Life (years)</label><input type="number" value={form.ifrs_useful_life_yr} onChange={e => set('ifrs_useful_life_yr', e.target.value)} /></div>
                <div className="form-group"><label>SARS W&amp;T Rate (%)</label><input type="number" value={form.sars_wt_rate_pct} onChange={e => set('sars_wt_rate_pct', e.target.value)} /></div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveAsset} disabled={saving}>{saving ? 'Saving…' : 'Create Asset'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ASSET TRANSACTIONS (depreciation ledger per asset) ─────────
function AssetTransactions({ preselectedCode, classes }) {
  const [assets, setAssets]     = useState([]);
  const [assetFilter, setAsset] = useState(preselectedCode || '');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    req('/fin/assets').then(d => {
      setAssets(Array.isArray(d) ? d : []);
    });
    // If pre-selected, auto-search
    if (preselectedCode) {
      doSearch(preselectedCode, '', '');
    }
  }, [preselectedCode]);

  const doSearch = useCallback(async (code, from, to) => {
    const ac = code !== undefined ? code : assetFilter;
    if (!ac) return alert('Please select an asset');
    setLoading(true);
    setSearched(true);
    const params = new URLSearchParams();
    if (from || dateFrom) params.set('date_from', from || dateFrom);
    if (to   || dateTo)   params.set('date_to',   to   || dateTo);
    const res = await req(`/fin/asset-transactions/${ac}?${params}`);
    setData(res.error ? null : res);
    setLoading(false);
  }, [assetFilter, dateFrom, dateTo]);

  const search = () => doSearch(assetFilter, dateFrom, dateTo);

  const clear = () => {
    setAsset(''); setDateFrom(''); setDateTo(''); setData(null); setSearched(false);
  };

  const doExport = () => {
    if (!data?.transactions?.length) return;
    exportCSV(data.transactions.map(r => ({
      Period: r.period_name || '', Date: r.run_date,
      'Book Depre': r.book_depre_amount, 'Tax Depre': r.tax_depre_amount,
      'Book NBV After': r.book_nbv_after, 'Tax Value After': r.tax_value_after,
      'Timing Diff': r.timing_difference, 'Deferred Tax': r.deferred_tax,
    })), `asset_ledger_${assetFilter}.csv`);
  };

  const rows = data?.transactions || [];
  const asset = data?.asset;

  return (
    <div>
      {/* Filters */}
      <div style={{ background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 260px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Asset *</label>
            <select value={assetFilter} onChange={e => setAsset(e.target.value)} style={{ width: '100%' }}>
              <option value="">— Select asset —</option>
              {assets.map(a => <option key={a.asset_code} value={a.asset_code}>{a.asset_code} — {a.description}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 0 148px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Date From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div style={{ flex: '0 0 148px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Date To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', paddingBottom: 1 }}>
            <button className="btn btn-primary btn-sm" onClick={search} disabled={loading || !assetFilter}>{loading ? 'Loading…' : '🔍 Search'}</button>
            {searched && <button className="btn btn-sm" onClick={clear}>Clear</button>}
          </div>
        </div>

        {/* Asset info strip */}
        {asset && (
          <div style={{ marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
            <span><strong>{asset.asset_code}</strong> — {asset.description}</span>
            <span style={{ color: '#888' }}>Cost: <strong>{fmt(asset.purchase_price)}</strong></span>
            <span style={{ color: '#005A8E' }}>Book NBV: <strong>{fmt(asset.book_nbv)}</strong></span>
            <span style={{ color: '#666' }}>Accum Depre: <strong>{fmt(asset.book_depre_total)}</strong></span>
            {asset.disposal_date && <span className="badge badge-red" style={{ fontSize: 10 }}>Disposed {asset.disposal_date}</span>}
          </div>
        )}
      </div>

      {/* Totals */}
      {data?.totals && (
        <div className="stats-grid" style={{ marginBottom: 12 }}>
          <div className="stat-card"><div className="stat-label">Depre Runs</div><div className="stat-value" style={{ color: '#00AEEF' }}>{data.totals.run_count}</div></div>
          <div className="stat-card"><div className="stat-label">Total Book Depre</div><div className="stat-value" style={{ fontSize: 14, color: '#e53e3e' }}>{fmt(data.totals.total_book_depre)}</div></div>
          <div className="stat-card"><div className="stat-label">Total Tax Depre</div><div className="stat-value" style={{ fontSize: 14 }}>{fmt(data.totals.total_tax_depre)}</div></div>
          {asset && <div className="stat-card"><div className="stat-label">Current Book NBV</div><div className="stat-value" style={{ fontSize: 14, color: '#005A8E' }}>{fmt(asset.book_nbv)}</div></div>}
        </div>
      )}

      {rows.length > 0 && <ExportBar onCSV={doExport} />}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Period</th>
              <th>Run Date</th>
              <th style={{ textAlign: 'right' }}>Book Depre</th>
              <th style={{ textAlign: 'right' }}>Tax Depre</th>
              <th style={{ textAlign: 'right' }}>Book NBV After</th>
              <th style={{ textAlign: 'right' }}>Tax Value After</th>
              <th style={{ textAlign: 'right' }}>Timing Diff</th>
              <th style={{ textAlign: 'right' }}>Deferred Tax</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8}><div className="loading">Loading asset ledger…</div></td></tr>}
            {!loading && !searched && (
              <tr><td colSpan={8}>
                <div className="empty-state" style={{ padding: '32px 0' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
                  <div>Select an asset and click <strong>Search</strong> to view its depreciation ledger.</div>
                </div>
              </td></tr>
            )}
            {!loading && searched && rows.length === 0 && (
              <tr><td colSpan={8}><div className="empty-state">No depreciation runs found for the selected filters.</div></td></tr>
            )}
            {!loading && rows.map((r, i) => (
              <tr key={r.run_id} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                <td style={{ fontWeight: 600, fontSize: 12 }}>{r.period_name || '—'}</td>
                <td style={{ fontSize: 12 }}>{r.run_date}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#e53e3e' }}>{fmt(r.book_depre_amount)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(r.tax_depre_amount)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#005A8E' }}>{fmt(r.book_nbv_after)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(r.tax_value_after)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#d97706' }}>{fmt(r.timing_difference)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#d97706' }}>{fmt(r.deferred_tax)}</td>
              </tr>
            ))}
            {/* Running cost line at bottom */}
            {!loading && rows.length > 0 && asset && (
              <tr style={{ fontWeight: 700, background: '#e8f0f8', borderTop: '2px solid #005A8E' }}>
                <td colSpan={2} style={{ padding: '6px 8px', fontSize: 12 }}>Totals — {data.totals.run_count} runs</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#e53e3e', padding: '6px 8px' }}>{fmt(data.totals.total_book_depre)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', padding: '6px 8px' }}>{fmt(data.totals.total_tax_depre)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#005A8E', padding: '6px 8px' }}>{fmt(asset.book_nbv)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', padding: '6px 8px' }}>{fmt(asset.tax_value)}</td>
                <td colSpan={2} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── ASSET REGISTER ────────────────────────────────────────────
function AssetRegister({ classes }) {
  const [classFilter, setClass]       = useState('');
  const [assetSearch, setAssetSearch] = useState('');
  const [dateFrom, setDateFrom]       = useState('');
  const [dateTo, setDateTo]           = useState('');
  const [showAdditions, setAdditions] = useState(false);
  const [showDisposals, setDisposals] = useState(false);
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(false);
  const [searched, setSearched]       = useState(false);
  const [viewMode, setViewMode]       = useState('detail'); // 'detail' | 'class'

  const search = useCallback(async () => {
    setLoading(true);
    setSearched(true);
    const params = new URLSearchParams();
    if (classFilter)    params.set('class_code', classFilter);
    if (assetSearch)    params.set('asset_code', assetSearch);
    if (dateFrom)       params.set('date_from', dateFrom);
    if (dateTo)         params.set('date_to', dateTo);
    if (showAdditions)  params.set('show_additions', 'true');
    if (showDisposals)  params.set('show_disposals', 'true');
    const res = await req(`/fin/asset-register?${params}`);
    setData(res.error ? null : res);
    setLoading(false);
  }, [classFilter, assetSearch, dateFrom, dateTo, showAdditions, showDisposals]);

  const clear = () => {
    setClass(''); setAssetSearch(''); setDateFrom(''); setDateTo('');
    setAdditions(false); setDisposals(false); setData(null); setSearched(false);
  };

  const doExport = () => {
    if (!data?.rows?.length) return;
    exportCSV(data.rows.map(r => ({
      'Asset Code':    r.asset_code,
      Description:    r.description,
      Class:          r.class_code,
      'Class Name':   r.class_name,
      Location:       r.location || '',
      'Purchase Date':r.purchase_date,
      Cost:           r.purchase_price,
      'Accum Depre':  r.accumulated_depre,
      'Period Depre': r.period_depre_book,
      'Book NBV':     r.book_nbv,
      'Tax Value':    r.tax_value,
      'Timing Diff':  r.timing_difference,
      'Deferred Tax @27%': r.deferred_tax_27pct,
      Status:         r.fully_depreciated ? 'Fully Depr' : r.is_active ? 'Active' : 'Disposed',
      'Disposal Date':r.disposal_date || '',
      'Disposal Proceeds': r.disposal_proceeds || '',
    })), 'asset_register.csv');
  };

  const rows = data?.rows || [];
  const t    = data?.totals;

  // Group by class for class-summary view
  const classSummary = data?.class_summary || [];

  // Build additions / disposals labels
  const periodLabel = dateFrom || dateTo
    ? `${dateFrom || '…'} to ${dateTo || '…'}`
    : '';

  return (
    <div>
      {/* Filter panel */}
      <div style={{ background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '0 0 190px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Asset Class</label>
            <select value={classFilter} onChange={e => setClass(e.target.value)} style={{ width: '100%' }}>
              <option value="">All Classes</option>
              {classes.map(c => <option key={c.class_code} value={c.class_code}>{c.class_code} — {c.class_name}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 0 160px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Asset Code</label>
            <input value={assetSearch} onChange={e => setAssetSearch(e.target.value.toUpperCase())} placeholder="e.g. VEH-001" style={{ width: '100%' }} />
          </div>
          <div style={{ flex: '0 0 148px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Date From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div style={{ flex: '0 0 148px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Date To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', paddingBottom: 1 }}>
            <button className="btn btn-primary btn-sm" onClick={search} disabled={loading}>{loading ? 'Loading…' : '🔍 Search'}</button>
            {searched && <button className="btn btn-sm" onClick={clear}>Clear</button>}
          </div>
        </div>

        {/* Filter toggles row */}
        <div style={{ display: 'flex', gap: 16, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={showAdditions} onChange={e => { setAdditions(e.target.checked); if (e.target.checked) setDisposals(false); }} />
            <span style={{ color: '#059669', fontWeight: 600 }}>Additions only</span>
            <span style={{ color: '#888', fontSize: 11 }}>(purchased in date range)</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={showDisposals} onChange={e => { setDisposals(e.target.checked); if (e.target.checked) setAdditions(false); }} />
            <span style={{ color: '#e53e3e', fontWeight: 600 }}>Disposals only</span>
            <span style={{ color: '#888', fontSize: 11 }}>(disposed in date range)</span>
          </label>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button className={`btn btn-sm ${viewMode === 'detail' ? 'btn-primary' : ''}`} onClick={() => setViewMode('detail')} style={{ fontSize: 11 }}>Detail</button>
            <button className={`btn btn-sm ${viewMode === 'class'  ? 'btn-primary' : ''}`} onClick={() => setViewMode('class')}  style={{ fontSize: 11 }}>By Class</button>
          </div>
        </div>
      </div>

      {/* Totals */}
      {t && (
        <div className="stats-grid" style={{ marginBottom: 12 }}>
          <div className="stat-card"><div className="stat-label">Assets</div><div className="stat-value" style={{ color: '#00AEEF' }}>{t.count}</div></div>
          <div className="stat-card"><div className="stat-label">Total Cost</div><div className="stat-value" style={{ fontSize: 14 }}>{fmt(t.total_cost)}</div></div>
          <div className="stat-card"><div className="stat-label">Accum Depreciation</div><div className="stat-value" style={{ fontSize: 14, color: '#e53e3e' }}>{fmt(t.total_accum)}</div></div>
          {periodLabel && <div className="stat-card"><div className="stat-label">Opening Accum Depre</div><div className="stat-value" style={{ fontSize: 13, color: '#e53e3e' }}>{fmt(t.total_opening)}</div></div>}
          {periodLabel && <div className="stat-card"><div className="stat-label">Period Depreciation</div><div className="stat-value" style={{ fontSize: 14, color: '#d97706' }}>{fmt(t.total_period)}</div></div>}
          {periodLabel && <div className="stat-card"><div className="stat-label">Closing Accum Depre</div><div className="stat-value" style={{ fontSize: 13, color: '#e53e3e' }}>{fmt(t.total_closing)}</div></div>}
          <div className="stat-card"><div className="stat-label">Total Book NBV</div><div className="stat-value" style={{ fontSize: 14, color: '#005A8E' }}>{fmt(t.total_nbv)}</div></div>
        </div>
      )}

      {rows.length > 0 && <ExportBar onCSV={doExport} />}

      {!searched && (
        <div className="empty-state" style={{ padding: '32px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
          <div>Set filters above and click <strong>Search</strong> to generate the asset register.</div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>All filters optional — leave blank for the full register.</div>
        </div>
      )}

      {/* ── CLASS SUMMARY VIEW ── */}
      {searched && viewMode === 'class' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Class Code</th>
                <th>Class Name</th>
                <th style={{ textAlign: 'center' }}>Assets</th>
                <th style={{ textAlign: 'right' }}>Cost</th>
                <th style={{ textAlign: 'right' }}>Accum Depre</th>
                <th style={{ textAlign: 'right' }}>Curr YR Depre</th>
                {periodLabel && <th style={{ textAlign: 'right' }}>Opening Accum</th>}
                {periodLabel && <th style={{ textAlign: 'right' }}>Period Depre</th>}
                {periodLabel && <th style={{ textAlign: 'right' }}>Closing Accum</th>}
                <th style={{ textAlign: 'right' }}>Book NBV</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7}><div className="loading">Loading…</div></td></tr>}
              {!loading && classSummary.length === 0 && <tr><td colSpan={7}><div className="empty-state">No assets found</div></td></tr>}
              {!loading && classSummary.map((c, i) => (
                <tr key={c.class_code} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                  <td className="mono" style={{ fontWeight: 600 }}>{c.class_code}</td>
                  <td>{c.class_name}</td>
                  <td style={{ textAlign: 'center' }}>{c.count}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(c.cost)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#e53e3e' }}>{fmt(c.accum_depre)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#d97706' }}>{fmt(c.curr_yr_depre)}</td>
                  {periodLabel && <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#e53e3e' }}>{fmt(c.opening_depre)}</td>}
                  {periodLabel && <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#d97706' }}>{fmt(c.period_depre)}</td>}
                  {periodLabel && <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#e53e3e' }}>{fmt(c.closing_depre)}</td>}
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#005A8E' }}>{fmt(c.book_nbv)}</td>
                </tr>
              ))}
              {!loading && t && (
                <tr style={{ fontWeight: 700, background: '#e8f0f8', borderTop: '2px solid #005A8E' }}>
                  <td colSpan={2} style={{ padding: '6px 8px' }}>TOTAL</td>
                  <td style={{ textAlign: 'center', padding: '6px 8px' }}>{t.count}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', padding: '6px 8px' }}>{fmt(t.total_cost)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#e53e3e', padding: '6px 8px' }}>{fmt(t.total_accum)}</td>
                  {periodLabel && <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#d97706', padding: '6px 8px' }}>{fmt(t.total_period)}</td>}
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#005A8E', padding: '6px 8px' }}>{fmt(t.total_nbv)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── DETAIL VIEW ── */}
      {searched && viewMode === 'detail' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Description</th>
                <th>Class</th>
                <th style={{ textAlign: 'right' }}>Cost</th>
                {showAdditions && <th style={{ textAlign: 'right', color: '#059669' }}>Addition Date</th>}
                {showDisposals && <th style={{ textAlign: 'right', color: '#e53e3e' }}>Disposal Date</th>}
                {showDisposals && <th style={{ textAlign: 'right', color: '#e53e3e' }}>Proceeds</th>}
                <th style={{ textAlign: 'right' }}>Accum Depre</th>
                <th style={{ textAlign: 'right' }}>Curr YR Depre</th>
                {periodLabel && <th style={{ textAlign: 'right' }}>Opening Accum</th>}
                {periodLabel && <th style={{ textAlign: 'right' }}>Period Depre</th>}
                {periodLabel && <th style={{ textAlign: 'right' }}>Closing Accum</th>}
                <th style={{ textAlign: 'right' }}>Book NBV</th>
                <th style={{ textAlign: 'right' }}>Tax Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={12}><div className="loading">Loading asset register…</div></td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={12}><div className="empty-state">No assets match the selected filters.</div></td></tr>}
              {!loading && (() => {
                // Group by class with class header rows
                const grouped = {};
                rows.forEach(r => {
                  if (!grouped[r.class_code]) grouped[r.class_code] = { class_name: r.class_name, rows: [] };
                  grouped[r.class_code].rows.push(r);
                });
                return Object.entries(grouped).flatMap(([cc, g]) => [
                  // Class header
                  <tr key={'h_' + cc} style={{ background: '#005A8E', color: 'white' }}>
                    <td colSpan={14} style={{ padding: '5px 10px', fontWeight: 700, fontSize: 12 }}>
                      {cc} — {g.class_name} ({g.rows.length} asset{g.rows.length !== 1 ? 's' : ''})
                    </td>
                  </tr>,
                  // Asset rows
                  ...g.rows.map((r, i) => (
                    <tr key={r.asset_code} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc', opacity: r.is_active ? 1 : 0.7 }}>
                      <td className="mono" style={{ fontWeight: 600, fontSize: 12 }}>{r.asset_code}</td>
                      <td style={{ fontSize: 12 }}>{r.description}{r.reg_number ? <span style={{ color: '#888', fontSize: 10, marginLeft: 4 }}>({r.reg_number})</span> : ''}</td>
                      <td><span className="badge badge-purple" style={{ fontSize: 10 }}>{r.class_code}</span></td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmt(r.purchase_price)}</td>
                      {showAdditions && <td style={{ textAlign: 'right', fontSize: 12, color: '#059669' }}>{r.purchase_date}</td>}
                      {showDisposals && <td style={{ textAlign: 'right', fontSize: 12, color: '#e53e3e' }}>{r.disposal_date || '—'}</td>}
                      {showDisposals && <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: '#e53e3e' }}>{r.disposal_proceeds ? fmt(r.disposal_proceeds) : '—'}</td>}
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: '#e53e3e' }}>{fmt(r.accumulated_depre)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: '#d97706' }}>{fmt(r.curr_yr_depre)}</td>
                      {periodLabel && <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: '#e53e3e' }}>{fmt(r.opening_depre_book)}</td>}
                      {periodLabel && <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: '#d97706' }}>{fmt(r.period_depre_book)}</td>}
                      {periodLabel && <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: '#e53e3e' }}>{fmt(r.closing_depre_book)}</td>}
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#005A8E', fontSize: 12 }}>{fmt(r.book_nbv)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmt(r.tax_value)}</td>
                      <td>
                        {r.fully_depreciated
                          ? <span className="badge badge-gray"  style={{ fontSize: 10 }}>Fully Depr.</span>
                          : r.is_active
                            ? <span className="badge badge-green" style={{ fontSize: 10 }}>Active</span>
                            : <span className="badge badge-red"   style={{ fontSize: 10 }}>Disposed</span>}
                      </td>
                    </tr>
                  )),
                  // Class subtotal
                  <tr key={'t_' + cc} style={{ fontWeight: 700, background: '#eef4fb', borderTop: '1px solid #ccd9e8' }}>
                    <td colSpan={3} style={{ padding: '5px 8px', fontSize: 12 }}>Subtotal — {cc}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', padding: '5px 8px', fontSize: 12 }}>{fmt(g.rows.reduce((s, r) => s + (r.purchase_price || 0), 0))}</td>
                    {showAdditions && <td />}
                    {showDisposals && <td />}
                    {showDisposals && <td style={{ textAlign: 'right', fontFamily: 'monospace', padding: '5px 8px', fontSize: 12, color: '#e53e3e' }}>{fmt(g.rows.reduce((s, r) => s + (r.disposal_proceeds || 0), 0))}</td>}
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', padding: '5px 8px', fontSize: 12, color: '#e53e3e' }}>{fmt(g.rows.reduce((s, r) => s + (r.accumulated_depre || 0), 0))}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', padding: '5px 8px', fontSize: 12, color: '#d97706' }}>{fmt(g.rows.reduce((s, r) => s + (r.curr_yr_depre || 0), 0))}</td>
                    {periodLabel && <td style={{ textAlign: 'right', fontFamily: 'monospace', padding: '5px 8px', fontSize: 12, color: '#e53e3e' }}>{fmt(g.rows.reduce((s, r) => s + (r.opening_depre_book || 0), 0))}</td>}
                    {periodLabel && <td style={{ textAlign: 'right', fontFamily: 'monospace', padding: '5px 8px', fontSize: 12, color: '#d97706' }}>{fmt(g.rows.reduce((s, r) => s + (r.period_depre_book || 0), 0))}</td>}
                    {periodLabel && <td style={{ textAlign: 'right', fontFamily: 'monospace', padding: '5px 8px', fontSize: 12, color: '#e53e3e' }}>{fmt(g.rows.reduce((s, r) => s + (r.closing_depre_book || 0), 0))}</td>}
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#005A8E', padding: '5px 8px', fontSize: 12 }}>{fmt(g.rows.reduce((s, r) => s + (r.book_nbv || 0), 0))}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', padding: '5px 8px', fontSize: 12 }}>{fmt(g.rows.reduce((s, r) => s + (r.tax_value || 0), 0))}</td>
                    <td />
                  </tr>,
                ]);
              })()}
              {/* Grand total */}
              {!loading && t && rows.length > 0 && (
                <tr style={{ fontWeight: 700, background: '#005A8E', color: 'white' }}>
                  <td colSpan={3} style={{ padding: '7px 10px', fontSize: 13 }}>GRAND TOTAL — {t.count} assets</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', padding: '7px 10px' }}>{fmt(t.total_cost)}</td>
                  {showAdditions && <td />}
                  {showDisposals && <td />}
                  {showDisposals && <td />}
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', padding: '7px 10px' }}>{fmt(t.total_accum)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', padding: '7px 10px' }}>{fmt(t.total_curr_yr)}</td>
                  {periodLabel && <td style={{ textAlign: 'right', fontFamily: 'monospace', padding: '7px 10px' }}>{fmt(t.total_opening)}</td>}
                  {periodLabel && <td style={{ textAlign: 'right', fontFamily: 'monospace', padding: '7px 10px' }}>{fmt(t.total_period)}</td>}
                  {periodLabel && <td style={{ textAlign: 'right', fontFamily: 'monospace', padding: '7px 10px' }}>{fmt(t.total_closing)}</td>}
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, padding: '7px 10px' }}>{fmt(t.total_nbv)}</td>
                  <td colSpan={2} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── MAIN FIXED ASSETS PAGE ────────────────────────────────────

// ── PROCESS DEPRECIATION ──────────────────────────────────────────────────
function ProcessDepreciation() {
  const [periods, setPeriods]     = useState([]);
  const [periodId, setPeriodId]   = useState('');
  const [preview, setPreview]     = useState(null);
  const [loading, setLoading]     = useState(false);
  const [running, setRunning]     = useState(false);
  const [result, setResult]       = useState(null);
  const [err, setErr]             = useState('');

  const fmt    = (n) => n == null ? '—' : `R ${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtNum = (n) => n == null ? '—' : Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  useEffect(() => {
    req('/fin/periods').then(d => setPeriods(Array.isArray(d) ? d.filter(p => !p.is_closed) : []));
  }, []);

  const runPreview = async () => {
    if (!periodId) return setErr('Select a period first');
    setErr(''); setLoading(true); setPreview(null); setResult(null);
    const d = await req(`/fin/depreciation/preview?period_id=${periodId}`);
    setLoading(false);
    if (d.error) return setErr(d.error);
    setPreview(d);
  };

  const doPreviewExport = () => {
    if (!preview?.assets?.length) return;
    exportCSV(preview.assets.map(a => ({
      'Asset Code':    a.asset_code,
      Description:    a.description,
      Class:          a.class_code,
      Cost:           a.purchase_price,
      'Book NBV Before': a.book_nbv,
      'Book Depre':   a.book_depre_amount,
      'Tax Depre':    a.tax_depre_amount,
      'Book NBV After': a.book_nbv_after,
    })), 'depreciation_preview.csv');
  };

  const runDepreciation = async () => {
    if (!preview) return;
    if (!confirm(`Run depreciation for ${preview.period_name}? This will update ${preview.asset_count} assets and create an UNPOSTED journal.`)) return;
    setRunning(true); setErr('');
    const d = await req('/fin/depreciation/run', { method: 'POST', body: JSON.stringify({ period_id: periodId }) });
    setRunning(false);
    if (d.error) return setErr(d.error);
    setResult(d);
    setPreview(null);
  };

  return (
    <div>
      {/* Period selector */}
      <div style={{ background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#005A8E', marginBottom: 10 }}>⚙️ Run Monthly Depreciation</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ marginBottom: 0, minWidth: 200 }}>
            <label>Period *</label>
            <select value={periodId} onChange={e => { setPeriodId(e.target.value); setPreview(null); setResult(null); setErr(''); }}>
              <option value="">— Select open period —</option>
              {periods.map(p => <option key={p.period_id} value={p.period_id}>{p.period_name}</option>)}
            </select>
          </div>
          <button className="btn btn-primary btn-sm" onClick={runPreview} disabled={loading || !periodId}>
            {loading ? 'Calculating…' : '🔍 Preview Depreciation'}
          </button>
        </div>
        {err && <div style={{ marginTop: 10, color: '#c53030', fontSize: 13 }}>⚠ {err}</div>}
      </div>

      {/* Success result */}
      {result && (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#059669', marginBottom: 8 }}>✅ Depreciation Run Complete</div>
          <div style={{ fontSize: 13 }}>Assets processed: <strong>{result.assets_run}</strong></div>
          <div style={{ fontSize: 13 }}>Total depreciation: <strong>{fmt(result.total_depre)}</strong></div>
          <div style={{ fontSize: 13 }}>Journal created: <strong style={{ color: '#005A8E' }}>{result.journal_ref}</strong> (UNPOSTED)</div>
          <div style={{ marginTop: 8, fontSize: 12, color: '#555' }}>
            ℹ️ Review the journal in <strong>GL → GL Journals</strong> and post it when ready.
          </div>
        </div>
      )}

      {/* Preview table */}
      {preview && (
        <>
          {/* Summary stats */}
          <div className="stats-grid" style={{ marginBottom: 14 }}>
            <div className="stat-card"><div className="stat-label">Period</div><div className="stat-value" style={{ fontSize: 14 }}>{preview.period_name}</div></div>
            <div className="stat-card"><div className="stat-label">Assets</div><div className="stat-value" style={{ color: '#00AEEF' }}>{preview.asset_count}</div></div>
            <div className="stat-card"><div className="stat-label">Total Depreciation</div><div className="stat-value" style={{ fontSize: 14, color: '#e53e3e' }}>{fmt(preview.total_depre)}</div></div>
          </div>

          {/* Journal preview */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#555', marginBottom: 6 }}>Journal to be created (UNPOSTED — review before posting)</div>
            <div style={{ background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 6, padding: 12 }}>
              {preview.journal_lines.map((l, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: i < preview.journal_lines.length - 1 ? '1px solid #f0f4f8' : 'none', fontSize: 13 }}>
                  <span className="mono" style={{ color: '#005A8E', marginRight: 12 }}>{l.account_code}</span>
                  <span style={{ flex: 1, color: '#555' }}>{l.description}</span>
                  <span style={{ fontFamily: 'monospace', color: '#005A8E', width: 120, textAlign: 'right' }}>{l.debit > 0 ? fmt(l.debit) + ' DR' : ''}</span>
                  <span style={{ fontFamily: 'monospace', color: '#e53e3e', width: 120, textAlign: 'right' }}>{l.credit > 0 ? fmt(l.credit) + ' CR' : ''}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Asset detail table */}
          <div style={{ fontWeight: 600, fontSize: 13, color: '#555', marginBottom: 6 }}>Asset Detail</div>
          {preview?.assets?.length > 0 && (
            <div style={{ display:'flex', gap:6, marginBottom:6 }}>
              <button className="btn btn-sm" onClick={doPreviewExport}>⬇ Export Preview CSV</button>
            </div>
          )}
          <div className="table-wrap" style={{ marginBottom: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>Asset Code</th><th>Description</th><th>Class</th>
                  <th style={{ textAlign: 'right' }}>Cost</th>
                  <th style={{ textAlign: 'right' }}>NBV Before</th>
                  <th style={{ textAlign: 'right' }}>Depre Amount</th>
                  <th style={{ textAlign: 'right' }}>NBV After</th>
                  <th style={{ textAlign: 'center' }}>Fully Depr?</th>
                </tr>
              </thead>
              <tbody>
                {preview.asset_lines.map(a => (
                  <tr key={a.asset_id} style={{ background: a.fully_depreciated_after ? '#fef9c3' : 'white' }}>
                    <td className="mono" style={{ fontWeight: 700 }}>{a.asset_code}</td>
                    <td style={{ fontSize: 12 }}>{a.description}</td>
                    <td><span className="badge badge-gray" style={{ fontSize: 10 }}>{a.class_code}</span></td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmtNum(a.purchase_price)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: '#005A8E' }}>{fmtNum(a.book_nbv_before)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: '#e53e3e' }}>{fmtNum(a.book_depre_amount)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: a.fully_depreciated_after ? '#d97706' : '#059669' }}>{fmtNum(a.book_nbv_after)}</td>
                    <td style={{ textAlign: 'center' }}>
                      {a.fully_depreciated_after ? <span className="badge badge-amber" style={{ fontSize: 10 }}>YES</span> : <span style={{ color: '#ccc' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button className="btn btn-primary" onClick={runDepreciation} disabled={running}>
            {running ? 'Running…' : `▶ Run Depreciation for ${preview.period_name}`}
          </button>
        </>
      )}

      {!preview && !result && !loading && !err && (
        <div className="empty-state" style={{ padding: '32px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📅</div>
          <div>Select an open period and click <strong>Preview Depreciation</strong> to calculate monthly asset depreciation.</div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 6 }}>Depreciation is calculated as Cost ÷ Useful Life (years) ÷ 12 per month. The system creates an UNPOSTED journal for your review.</div>
        </div>
      )}
    </div>
  );
}

export default function FinanceAssets() {
  const [tab, setTab]                     = useState('list');
  const [classes, setClasses]             = useState([]);
  const [txAssetCode, setTxAssetCode]     = useState('');
  const [txAssetLabel, setTxAssetLabel]   = useState('');

  useEffect(() => {
    req('/fin/assets/classes').then(d => setClasses(Array.isArray(d) ? d : []));
  }, []);

  // Navigate to Transactions tab pre-selected to a specific asset
  const viewTransactions = (code, label) => {
    setTxAssetCode(code);
    setTxAssetLabel(label);
    setTab('transactions');
  };

  const tabStyle = (t) => ({
    padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    borderBottom: tab === t ? '2px solid #005A8E' : '2px solid transparent',
    color: tab === t ? '#005A8E' : '#666', whiteSpace: 'nowrap',
  });

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid #e8edf2', marginBottom: 16, gap: 4, overflowX: 'auto' }}>
        <div style={tabStyle('list')}         onClick={() => setTab('list')}>Asset List</div>
        <div style={tabStyle('register')}     onClick={() => setTab('register')}>Asset Register</div>
        <div style={tabStyle('transactions')} onClick={() => setTab('transactions')}>
          Asset Transactions{txAssetLabel ? ` — ${txAssetCode}` : ''}
        </div>
        <div style={tabStyle('depreciation')} onClick={() => setTab('depreciation')}>Process Depreciation</div>
      </div>
      {tab === 'list'         && <AssetList classes={classes} onViewTransactions={viewTransactions} />}
      {tab === 'register'     && <AssetRegister classes={classes} />}
      {tab === 'transactions' && <AssetTransactions preselectedCode={txAssetCode} classes={classes} key={txAssetCode} />}
      {tab === 'depreciation'  && <ProcessDepreciation />}
    </div>
  );
}



