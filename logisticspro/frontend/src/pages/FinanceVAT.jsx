import { useState, useEffect, useCallback } from 'react';

const API   = `${import.meta.env.VITE_API_URL || ''}/api`;
const token = () => localStorage.getItem('lp_token');
const req   = (path) => fetch(API + path, { headers: { Authorization: 'Bearer ' + token() } }).then(r => r.json());
const fmt   = (n) => n == null ? '—' : `R ${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtR  = (n) => n == null ? '' : Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function exportCSV(rows, filename) {
  const headers = Object.keys(rows[0] || {});
  const csv = [headers, ...rows.map(r => headers.map(h => `"${(r[h] ?? '').toString().replace(/"/g, '""')}"`))].map(r => r.join(',')).join('\n');
  const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = filename; a.click();
}

// ── VAT201 SUMMARY TAB (existing) ────────────────────────────
function VATSummary({ vatTypes }) {
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    req('/fin/vat201').then(d => { setPeriods(Array.isArray(d) ? d : []); setLoading(false); });
  }, []);

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">VAT Periods</div><div className="stat-value">{periods.length}</div></div>
        <div className="stat-card"><div className="stat-label">VAT Types</div><div className="stat-value" style={{ color: '#00AEEF' }}>{vatTypes.length}</div></div>
        <div className="stat-card"><div className="stat-label">Filed Periods</div><div className="stat-value" style={{ color: '#059669' }}>0</div></div>
      </div>

      {periods.length === 0 && !loading && (
        <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: 16, margin: '16px 0', fontSize: 13 }}>
          <strong>ℹ️ No VAT transactions yet.</strong> The VAT201 summary will populate automatically as GL journals with VAT are posted.
          The VAT control account is <span className="mono" style={{ background: '#f5f5f5', padding: '1px 6px', borderRadius: 3 }}>9500</span>.
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#333', marginBottom: 8 }}>VAT Type Reference</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Description</th><th>Rate</th><th>Direction</th><th>VAT201 Field</th><th>AR</th><th>AP</th><th>Capital</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={8}><div className="loading">Loading…</div></td></tr>}
              {vatTypes.map(v => (
                <tr key={v.vat_code}>
                  <td className="mono" style={{ fontWeight: 600 }}>{v.vat_code}</td>
                  <td style={{ fontSize: 12 }}>{v.description}</td>
                  <td style={{ fontWeight: 600 }}>{v.rate_pct}%</td>
                  <td><span className={`badge ${v.vat_direction === 'OUTPUT' ? 'badge-green' : v.vat_direction === 'INPUT' ? 'badge-blue' : 'badge-gray'}`} style={{ fontSize: 10 }}>{v.vat_direction}</span></td>
                  <td className="mono" style={{ fontWeight: 600, color: '#005A8E' }}>{v.vat201_field || '—'}</td>
                  <td style={{ textAlign: 'center' }}>{v.allowed_on_ar ? '✓' : '—'}</td>
                  <td style={{ textAlign: 'center' }}>{v.allowed_on_ap ? '✓' : '—'}</td>
                  <td style={{ textAlign: 'center' }}>{v.is_capital_goods ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {periods.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#333', marginBottom: 8 }}>VAT201 Summary by Period</div>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Period</th>
                <th style={{ textAlign: 'right' }}>Field 1 (Output)</th>
                <th style={{ textAlign: 'right' }}>Field 1A (CN)</th>
                <th style={{ textAlign: 'right' }}>Field 14 (Input)</th>
                <th style={{ textAlign: 'right' }}>Field 15 (Capital)</th>
                <th style={{ textAlign: 'right' }}>Net VAT</th>
              </tr></thead>
              <tbody>
                {periods.map(p => (
                  <tr key={p.vat_period}>
                    <td className="mono" style={{ fontWeight: 600 }}>{p.vat_period}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(p.field1_output_sales_vat)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(p.field1a_output_cn_vat)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(p.field14_input_purchases_vat)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(p.field15_input_capital_vat)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: (p.net_vat_payable || 0) > 0 ? '#e53e3e' : '#059669' }}>{fmt(p.net_vat_payable)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── VAT TRANSACTIONS TAB ──────────────────────────────────────
function VATTransactions() {
  const [rows, setRows]         = useState([]);
  const [totals, setTotals]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [searched, setSearched] = useState(false);
  const [direction, setDir]     = useState('');       // '' | 'OUTPUT' | 'INPUT'
  const [vatPeriod, setVatPer]  = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');

  const search = useCallback(async () => {
    setLoading(true);
    setSearched(true);
    const params = new URLSearchParams();
    if (vatPeriod) params.set('vat_period', vatPeriod);
    if (direction) params.set('direction', direction);
    if (dateFrom)  params.set('date_from', dateFrom);
    if (dateTo)    params.set('date_to', dateTo);
    const data = await req(`/fin/vat-transactions?${params}`);
    setRows(data.transactions || []);
    setTotals(data.totals || null);
    setLoading(false);
  }, [vatPeriod, direction, dateFrom, dateTo]);

  const clear = () => { setDir(''); setVatPer(''); setDateFrom(''); setDateTo(''); setRows([]); setTotals(null); setSearched(false); };

  const doExport = () => {
    if (!rows.length) return;
    exportCSV(rows.map(r => ({
      Date: r.transaction_date, 'VAT Period': r.vat_period, Code: r.vat_code,
      Description: r.vat_description, Direction: r.vat_direction, Rate: r.rate_pct + '%',
      'Tax Invoice': r.tax_invoice_no || '', Counterparty: r.counterparty_name || '',
      'Counterparty VAT': r.counterparty_vat_no || '', 'Excl Amount': r.exclusive_amount,
      'VAT Amount': r.vat_amount, 'Incl Amount': r.inclusive_amount,
      'GL Account': r.gl_account_code, Module: r.source_module || '',
      Capital: r.is_capital_goods ? 'YES' : 'NO',
    })), `vat_transactions${vatPeriod ? '_' + vatPeriod : ''}.csv`);
  };

  // Group by vat_code for category subtotals
  const outputRows = rows.filter(r => r.vat_direction === 'OUTPUT');
  const inputRows  = rows.filter(r => r.vat_direction === 'INPUT');

  const groupBy = (arr) => {
    const groups = {};
    arr.forEach(r => {
      const key = r.vat_code;
      if (!groups[key]) groups[key] = { vat_code: key, description: r.vat_description, rate_pct: r.rate_pct, vat201_field: r.vat201_field, rows: [], excl: 0, vat: 0, incl: 0 };
      groups[key].rows.push(r);
      groups[key].excl += r.exclusive_amount;
      groups[key].vat  += r.vat_amount;
      groups[key].incl += r.inclusive_amount;
    });
    return Object.values(groups).sort((a, b) => (a.vat201_field || '').localeCompare(b.vat201_field || ''));
  };

  const outputGroups = groupBy(outputRows);
  const inputGroups  = groupBy(inputRows);

  const showAll = !direction;

  return (
    <div>
      {/* Filter panel */}
      <div style={{ background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '0 0 130px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Direction</label>
            <select value={direction} onChange={e => setDir(e.target.value)} style={{ width: '100%' }}>
              <option value="">Output + Input</option>
              <option value="OUTPUT">Output only</option>
              <option value="INPUT">Input only</option>
            </select>
          </div>
          <div style={{ flex: '0 0 130px' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>VAT Period</label>
            <input value={vatPeriod} onChange={e => setVatPer(e.target.value)} placeholder="e.g. 202605" style={{ width: '100%' }} />
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
      </div>

      {/* Totals */}
      {totals && (
        <div className="stats-grid" style={{ marginBottom: 12 }}>
          <div className="stat-card"><div className="stat-label">Transactions</div><div className="stat-value" style={{ color: '#00AEEF' }}>{rows.length}</div></div>
          <div className="stat-card"><div className="stat-label">Output VAT</div><div className="stat-value" style={{ fontSize: 14, color: '#e53e3e' }}>{fmt(totals.output_vat)}</div></div>
          <div className="stat-card"><div className="stat-label">Input VAT</div><div className="stat-value" style={{ fontSize: 14, color: '#059669' }}>{fmt(totals.input_vat)}</div></div>
          <div className="stat-card">
            <div className="stat-label">Net VAT</div>
            <div className="stat-value" style={{ fontSize: 14, color: totals.net_vat > 0 ? '#e53e3e' : '#059669' }}>
              {fmt(Math.abs(totals.net_vat))} <span style={{ fontSize: 11, fontWeight: 400 }}>{totals.net_vat > 0 ? 'Payable' : 'Refund'}</span>
            </div>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-sm" onClick={doExport}>⬇ CSV</button>
          <button className="btn btn-sm" onClick={doExport}>⬇ Excel</button>
          <button className="btn btn-sm" onClick={() => {
            const w = window.open('','_blank','width=900,height=700');
            const tbl = document.getElementById('vat-tx-table');
            if (!tbl || !w) return;
            w.document.write('<html><head><title>VAT Transactions</title><style>body{font-family:sans-serif;font-size:12px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:4px 6px}th{background:#f0f0f0}</style></head><body>');
            w.document.write('<h2>VAT Transactions</h2>');
            w.document.write(tbl.outerHTML);
            w.document.write('</body></html>');
            w.document.close(); w.print();
          }}>🖨 Print</button>
        </div>
      )}

      {!searched && (
        <div className="empty-state" style={{ padding: '32px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
          <div>Select filters above and click <strong>Search</strong> to view VAT transactions.</div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>All filters are optional — leave blank to see everything.</div>
        </div>
      )}

      {/* OUTPUT section */}
      {searched && (showAll || direction === 'OUTPUT') && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#005A8E', borderBottom: '2px solid #005A8E', paddingBottom: 4, marginBottom: 8 }}>
            OUTPUT TAX
          </div>
          {outputGroups.length === 0 ? (
            <div className="empty-state" style={{ padding: 16 }}>No output VAT transactions</div>
          ) : outputGroups.map(g => (
            <div key={g.vat_code} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, background: '#f0f7ff', padding: '6px 10px', borderRadius: 4 }}>
                <span className="badge badge-green" style={{ fontSize: 11 }}>{g.vat_code}</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{g.description}</span>
                <span style={{ fontSize: 12, color: '#888' }}>{g.rate_pct}%</span>
                {g.vat201_field && <span className="mono" style={{ fontSize: 11, color: '#005A8E', marginLeft: 'auto' }}>Field {g.vat201_field}</span>}
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Date</th><th>Tax Invoice #</th><th>Counterparty</th><th>Counterparty VAT</th><th>Module</th><th style={{ textAlign: 'right' }}>Excl Amt</th><th style={{ textAlign: 'right' }}>VAT</th><th style={{ textAlign: 'right' }}>Incl Amt</th></tr></thead>
                  <tbody>
                    {g.rows.map((r, i) => (
                      <tr key={r.vat_id} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                        <td style={{ fontSize: 12 }}>{r.transaction_date}</td>
                        <td className="mono" style={{ fontSize: 12 }}>{r.tax_invoice_no || '—'}</td>
                        <td style={{ fontSize: 12 }}>{r.counterparty_name || '—'}</td>
                        <td className="mono" style={{ fontSize: 11 }}>{r.counterparty_vat_no || '—'}</td>
                        <td style={{ fontSize: 11, color: '#888' }}>{r.source_module || '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmt(r.exclusive_amount)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: '#e53e3e' }}>{fmt(r.vat_amount)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmt(r.inclusive_amount)}</td>
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 700, background: '#e8f4ff', borderTop: '2px solid #005A8E' }}>
                      <td colSpan={5} style={{ padding: '6px 8px', fontSize: 12 }}>Subtotal — {g.vat_code}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, padding: '6px 8px' }}>{fmt(g.excl)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, padding: '6px 8px', color: '#e53e3e' }}>{fmt(g.vat)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, padding: '6px 8px' }}>{fmt(g.incl)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {totals && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, padding: '8px 12px', background: '#005A8E', color: 'white', borderRadius: 4, fontSize: 13, fontWeight: 700 }}>
              <span>Total Output — Excl: R {fmtR(totals.output_excl)}</span>
              <span>VAT: R {fmtR(totals.output_vat)}</span>
            </div>
          )}
        </div>
      )}

      {/* INPUT section */}
      {searched && (showAll || direction === 'INPUT') && (
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#059669', borderBottom: '2px solid #059669', paddingBottom: 4, marginBottom: 8 }}>
            INPUT TAX
          </div>
          {inputGroups.length === 0 ? (
            <div className="empty-state" style={{ padding: 16 }}>No input VAT transactions</div>
          ) : inputGroups.map(g => (
            <div key={g.vat_code} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, background: '#f0fdf4', padding: '6px 10px', borderRadius: 4 }}>
                <span className="badge badge-blue" style={{ fontSize: 11 }}>{g.vat_code}</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{g.description}</span>
                <span style={{ fontSize: 12, color: '#888' }}>{g.rate_pct}%</span>
                {g.is_capital_goods && <span className="badge badge-amber" style={{ fontSize: 10 }}>Capital</span>}
                {g.vat201_field && <span className="mono" style={{ fontSize: 11, color: '#059669', marginLeft: 'auto' }}>Field {g.vat201_field}</span>}
              </div>
              <div className="mobile-card-list" style={{marginBottom:8}}>
                {g.rows.map(r => (
                  <div key={r.vat_id} className="data-card" style={{padding:'8px 12px',borderLeftColor:'#059669'}}>
                    <div className="data-card-header">
                      <div>
                        <div className="data-card-title" style={{fontSize:12}}>{r.counterparty_name||'—'}</div>
                        <div className="data-card-sub" style={{fontFamily:'monospace'}}>{r.tax_invoice_no||'—'} · {r.transaction_date}</div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontFamily:'monospace',fontWeight:700,color:'#059669',fontSize:13}}>{fmt(r.vat_amount)}</div>
                        <div style={{fontSize:11,color:'#888'}}>VAT</div>
                      </div>
                    </div>
                    <div className="data-card-meta">
                      <div>Excl: <strong>{fmt(r.exclusive_amount)}</strong></div>
                      <div>Incl: <strong>{fmt(r.inclusive_amount)}</strong></div>
                    </div>
                  </div>
                ))}
                <div style={{display:'flex',justifyContent:'flex-end',gap:16,padding:'6px 8px',background:'#dcfce7',borderRadius:4,fontSize:12,fontWeight:700}}>
                  <span>Subtotal — {g.vat_code}</span>
                  <span>Excl: {fmt(g.excl)}</span>
                  <span style={{color:'#059669'}}>VAT: {fmt(g.vat)}</span>
                  <span>Incl: {fmt(g.incl)}</span>
                </div>
              </div>
              <div className="desktop-table">
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Date</th><th>Tax Invoice #</th><th>Counterparty</th><th>Counterparty VAT</th><th>Module</th><th style={{ textAlign: 'right' }}>Excl Amt</th><th style={{ textAlign: 'right' }}>VAT</th><th style={{ textAlign: 'right' }}>Incl Amt</th></tr></thead>
                  <tbody>
                    {g.rows.map((r, i) => (
                      <tr key={r.vat_id} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                        <td style={{ fontSize: 12 }}>{r.transaction_date}</td>
                        <td className="mono" style={{ fontSize: 12 }}>{r.tax_invoice_no || '—'}</td>
                        <td style={{ fontSize: 12 }}>{r.counterparty_name || '—'}</td>
                        <td className="mono" style={{ fontSize: 11 }}>{r.counterparty_vat_no || '—'}</td>
                        <td style={{ fontSize: 11, color: '#888' }}>{r.source_module || '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmt(r.exclusive_amount)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: '#059669' }}>{fmt(r.vat_amount)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmt(r.inclusive_amount)}</td>
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 700, background: '#dcfce7', borderTop: '2px solid #059669' }}>
                      <td colSpan={5} style={{ padding: '6px 8px', fontSize: 12 }}>Subtotal — {g.vat_code}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, padding: '6px 8px' }}>{fmt(g.excl)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, padding: '6px 8px', color: '#059669' }}>{fmt(g.vat)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, padding: '6px 8px' }}>{fmt(g.incl)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              </div>
            </div>
          ))}
          {totals && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, padding: '8px 12px', background: '#059669', color: 'white', borderRadius: 4, fontSize: 13, fontWeight: 700 }}>
              <span>Total Input — Excl: R {fmtR(totals.input_excl)}</span>
              <span>VAT: R {fmtR(totals.input_vat)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── VAT RETURN (VAT201 FORMAT) TAB ────────────────────────────
function VATReturn() {
  const [vatPeriod, setVatPer]   = useState('');
  const [inputPeriod, setInput]  = useState('');
  const [data, setData]          = useState(null);
  const [loading, setLoading]    = useState(false);
  const [error, setError]        = useState('');

  const load = async () => {
    if (!inputPeriod.trim()) return setError('Enter a VAT period e.g. 202605');
    if (!/^\d{6}$/.test(inputPeriod.trim())) return setError('Format must be YYYYMM — e.g. 202605');
    setError('');
    setLoading(true);
    const res = await req(`/fin/vat-return/${inputPeriod.trim()}`);
    if (res?.error) { setError(res.error); setData(null); }
    else if (!res?.fields) { setError('No data returned — check the period or try again.'); setData(null); }
    else { setData(res); setVatPer(res.vat_period); }
    setLoading(false);
  };

  const doPrint = () => {
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    const el = document.getElementById('vat201-report');
    w.document.write('<html><head><title>VAT 201 Return</title><style>body{font-family:sans-serif;font-size:13px;padding:24px}table{border-collapse:collapse;width:100%}th,td{padding:6px 10px;border-bottom:1px solid #ddd}th{text-align:left;background:#f5f5f5}.section-head{background:#1e3a5f;color:white;padding:6px 10px;font-weight:bold;margin:16px 0 4px}.field-row{display:flex;justify-content:space-between;padding:5px 10px;border-bottom:1px solid #eee}.field-label{color:#444}.field-value{font-family:monospace;font-weight:bold}</style></head><body>');
    w.document.write(el ? el.innerHTML : '<p>Report not loaded</p>');
    w.document.write('</body></html>');
    w.document.close(); w.print();
  };

  // Helper row renderer — matches VAT201 layout
  const Row = ({ field, label, value, isTotal, color, indent }) => (
    <tr style={{ background: isTotal ? '#e8f0f8' : 'white', fontWeight: isTotal ? 700 : 400 }}>
      <td style={{ padding: '5px 10px', fontSize: 12, paddingLeft: indent ? 24 : 10, color: '#444' }}>{label}</td>
      <td style={{ padding: '5px 10px', width: 48, fontSize: 12, fontWeight: 700, textAlign: 'center', color: '#005A8E', background: isTotal ? '#d0e0f0' : '#f0f4f8' }}>{field}</td>
      <td style={{ padding: '5px 8px', fontSize: 12, width: 20, color: '#666' }}>R</td>
      <td style={{ padding: '5px 10px', fontFamily: 'monospace', fontSize: 13, textAlign: 'right', fontWeight: isTotal ? 700 : 400, color: color || (isTotal ? '#005A8E' : '#222'), minWidth: 140, borderBottom: '1px solid #e0e6ed' }}>
        {value != null ? fmtR(value) : ''}
      </td>
      <td style={{ width: 16 }} />
    </tr>
  );

  const SectionHeader = ({ label, color }) => (
    <tr>
      <td colSpan={5} style={{ background: color || '#005A8E', color: 'white', fontWeight: 700, fontSize: 12, padding: '6px 10px', letterSpacing: 0.3 }}>{label}</td>
    </tr>
  );

  const SubHeader = ({ label, color }) => (
    <tr>
      <td colSpan={5} style={{ background: color || '#3a7ec4', color: 'white', fontWeight: 600, fontSize: 11, padding: '4px 10px' }}>{label}</td>
    </tr>
  );

  const f = data?.fields;

  return (
    <div>
      {/* Period picker */}
      <div style={{ background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 8, padding: '14px 16px', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>VAT Period (YYYYMM)</label>
            <input
              value={inputPeriod}
              onChange={e => setInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="e.g. 202605"
              style={{ width: 140, fontFamily: 'monospace', fontSize: 14, letterSpacing: 1 }}
              onKeyDown={e => e.key === 'Enter' && load()}
            />
          </div>
          <button className="btn btn-primary btn-sm" onClick={load} disabled={loading}>{loading ? 'Loading…' : '🔍 Generate Return'}</button>
          {data && <button className="btn btn-sm" onClick={doPrint}>🖨 Print / PDF</button>}
        </div>
        {error && <div style={{ color: '#e53e3e', fontSize: 13, marginTop: 8 }}>⚠ {error}</div>}
      </div>

      {!data && !loading && (
        <div className="empty-state" style={{ padding: '32px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
          <div>Enter a VAT period and click <strong>Generate Return</strong> to build the VAT201.</div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>Format: YYYYMM — e.g. 202605 for May 2026</div>
        </div>
      )}

      {data && data.transaction_count === 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: 16, margin: '0 0 16px', fontSize: 13 }}>
          <strong>⚠ No VAT transactions found for period {vatPeriod}.</strong><br />
          VAT transactions are written automatically when journals with a VAT type are posted, or when supplier invoices are captured with a VAT amount.
          Post a journal with VAT or capture a supplier invoice first, then regenerate.
        </div>
      )}

      {data && data.transaction_count > 0 && (
        <div style={{ display:'flex', gap:12, marginBottom:12, flexWrap:'wrap' }}>
          <div className="stat-card" style={{ flex:1, minWidth:140 }}>
            <div className="stat-label">Transactions</div>
            <div className="stat-value" style={{ color:'#005A8E' }}>{data.transaction_count}</div>
          </div>
          <div className="stat-card" style={{ flex:1, minWidth:140 }}>
            <div className="stat-label">Output Tax (Field 13)</div>
            <div className="stat-value" style={{ color:'#e53e3e', fontSize:16 }}>{fmtR(data.fields.field13)}</div>
          </div>
          <div className="stat-card" style={{ flex:1, minWidth:140 }}>
            <div className="stat-label">Input Tax (Field 19)</div>
            <div className="stat-value" style={{ color:'#059669', fontSize:16 }}>{fmtR(data.fields.field19)}</div>
          </div>
          <div className="stat-card" style={{ flex:1, minWidth:140 }}>
            <div className="stat-label">{data.payable ? 'VAT Payable' : 'VAT Refundable'}</div>
            <div className="stat-value" style={{ color: data.payable ? '#c00' : '#059669', fontSize:16 }}>{fmtR(Math.abs(data.fields.field20))}</div>
          </div>
        </div>
      )}

      {data && (
        <div id="vat201-report" style={{ maxWidth: 740, margin: '0 auto' }}>
          {/* Header */}
          <div style={{ border: '2px solid #005A8E', borderRadius: 6, overflow: 'hidden', fontFamily: 'Arial, sans-serif' }}>

            {/* Return title bar */}
            <div style={{ background: '#005A8E', color: 'white', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>VAT201 — VAT Return</div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>Interland Distribution Cape (Pty) Ltd</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, fontSize: 18, fontFamily: 'monospace' }}>{vatPeriod}</div>
                <div style={{ fontSize: 11, opacity: 0.75 }}>
                  {data.payable ? '⚠ VAT PAYABLE' : '✓ REFUNDABLE'}
                </div>
              </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>

                {/* SECTION A — OUTPUT */}
                <SectionHeader label="A. Calculation of Output Tax and Imported Services" />
                <SubHeader label="Supply of Goods and / or Services By You" />
                <Row field="1"  label="Standard rate (excluding capital goods and / or services and accommodation)" value={f.field1}  />
                <Row field="4"  label="" value={f.field4}  color="#e53e3e" indent />
                <Row field="1A" label="Standard rate (only capital goods and / or services)" value={f.field1A} />
                <Row field="4A" label="" value={f.field4A} color="#e53e3e" indent />
                <Row field="2"  label="Zero rate (excluding goods exported)" value={f.field2}  />
                <Row field="2A" label="Zero rate (only exported goods)"       value={f.field2A} />
                <Row field="3"  label="Exempt and non-supplies"               value={0}         />

                <SubHeader label="Supply of accommodation:" color="#5a8ec4" />
                <Row field="8"  label="Total: (6 + 7)"  value={0} />
                <Row field="9"  label=""                value={0} indent />

                <SubHeader label="Adjustments:" color="#5a8ec4" />
                <Row field="10" label="Change in use and export of second-hand goods" value={0} />
                <Row field="11" label="" value={0} indent />
                <Row field="12" label="Other and imported services" value={0} />

                <Row field="13" label="Total A: TOTAL OUTPUT TAX (4+4A+9+11+12)" value={f.field13} isTotal color="#e53e3e" />

                {/* Spacer */}
                <tr><td colSpan={5} style={{ height: 8, background: '#f5f7fa' }} /></tr>

                {/* SECTION B — INPUT */}
                <SectionHeader label="B. Calculation of Input Tax" />
                <Row field="14"  label={<span>Capital goods and / or services supplied to you<br/><span style={{fontSize:10,color:'#888'}}>Excl. base: {fmtR(f.field14_excl || 0)}</span></span>} value={f.field14}     />
                <Row field="14A" label="Capital goods imported by you"                   value={0}             />
                <Row field="15"  label={<span>Other goods and / or services supplied to you (not capital goods)<br/><span style={{fontSize:10,color:'#888'}}>Excl. base: {fmtR(f.field15_excl || 0)}</span></span>} value={f.field15} />
                <Row field="15A" label="Other goods imported by you (not capital goods)" value={0}             />

                <SubHeader label="Adjustments:" color="#5a8ec4" />
                <Row field="16" label="Change in use" value={0} />
                <Row field="17" label="Bad debts"     value={0} />
                <Row field="18" label="Other"         value={0} />

                <Row field="19" label="Total B: TOTAL INPUT TAX (14+14A+15+15A+16+17+18)" value={f.field19} isTotal color="#059669" />

                {/* Spacer */}
                <tr><td colSpan={5} style={{ height: 8, background: '#f5f7fa' }} /></tr>

                {/* Field 20 — NET */}
                <tr style={{ background: data.payable ? '#fff0f0' : '#f0fdf4' }}>
                  <td style={{ padding: '10px', fontSize: 13, fontWeight: 700, color: data.payable ? '#c00' : '#059669' }}>
                    VAT PAYABLE / REFUNDABLE (Total A − Total B)
                    <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2 }}>
                      {data.payable ? '⚠ Amount payable to SARS' : '✓ Amount refundable from SARS'}
                    </div>
                  </td>
                  <td style={{ padding: '10px', width: 48, fontWeight: 700, textAlign: 'center', color: 'white', background: data.payable ? '#c00' : '#059669', fontSize: 13 }}>20</td>
                  <td style={{ padding: '10px', color: '#666', fontSize: 12 }}>R</td>
                  <td style={{ padding: '10px', fontFamily: 'monospace', fontSize: 16, fontWeight: 700, textAlign: 'right', color: data.payable ? '#c00' : '#059669', borderTop: '3px solid', borderColor: data.payable ? '#c00' : '#059669' }}>
                    {fmtR(Math.abs(f.field20))}
                  </td>
                  <td />
                </tr>

              </tbody>
            </table>

            {/* Footer note */}
            <div style={{ background: '#f5f7fa', padding: '8px 14px', fontSize: 11, color: '#888', borderTop: '1px solid #e0e6ed' }}>
              Generated by LogisticsPro LP2.0 · VAT Period {vatPeriod} · {new Date().toLocaleDateString('en-ZA')}
              {' · '}Fields 6, 7, 10, 14A, 15A, 16, 17, 18 default to zero — enter manually if applicable.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MAIN VAT PAGE ─────────────────────────────────────────────

// ── VAT TYPES MANAGER ────────────────────────────────────────────────────────
function VATTypeManager({ vatTypes: initial, onRefresh }) {
  // Local req with Content-Type for POST/PATCH calls
  const vatReq = (path, opts = {}) => fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(), ...(opts.headers || {}) },
  }).then(r => r.json());
  const [types, setTypes] = useState(initial || []);
  const [editing, setEditing] = useState(null); // vat_code being edited
  const [adding, setAdding]   = useState(false);
  const [form, setForm] = useState({ vat_code: '', description: '', rate_pct: '', vat_direction: 'OUTPUT', vat201_field: '', is_capital_goods: false, active: true });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    const data = await vatReq('/fin/vat-types?all=1');
    setTypes(Array.isArray(data) ? data : []);
    onRefresh && onRefresh();
  };
  useEffect(() => { load(); }, []);

  const startAdd = () => {
    setForm({ vat_code: '', description: '', rate_pct: '', vat_direction: 'OUTPUT', vat201_field: '', is_capital_goods: false, active: true });
    setAdding(true); setEditing(null); setErr('');
  };
  const startEdit = (v) => {
    setForm({ vat_code: v.vat_code, description: v.description, rate_pct: String(v.rate_pct), vat_direction: v.vat_direction, vat201_field: v.vat201_field || '', is_capital_goods: !!v.is_capital_goods, active: v.active });
    setEditing(v.vat_code); setAdding(false); setErr('');
  };
  const cancel = () => { setAdding(false); setEditing(null); setErr(''); };

  const save = async () => {
    setErr('');
    if (!form.description.trim()) return setErr('Description is required');
    if (form.rate_pct === '' || isNaN(Number(form.rate_pct))) return setErr('Rate % is required');
    setSaving(true);
    let res;
    if (adding) {
      if (!form.vat_code.trim()) return setErr('VAT Code is required');
      res = await vatReq('/fin/vat-types', { method: 'POST', body: JSON.stringify({ ...form, rate_pct: Number(form.rate_pct) }) });
    } else {
      res = await vatReq(`/fin/vat-types/${editing}`, { method: 'PATCH', body: JSON.stringify({ description: form.description, rate_pct: Number(form.rate_pct), vat_direction: form.vat_direction, vat201_field: form.vat201_field || null, is_capital_goods: form.is_capital_goods, active: form.active }) });
    }
    setSaving(false);
    if (res?.error) return setErr(res.error);
    cancel(); load();
  };

  const DIR_BADGE = { OUTPUT: 'badge-green', INPUT: 'badge-blue', BOTH: 'badge-purple' };
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div>
      <div className="filter-bar">
        <span style={{ fontWeight: 600, fontSize: 14 }}>VAT Types ({types.length})</span>
        <button className="btn btn-primary btn-sm" onClick={startAdd}>+ Add VAT Type</button>
      </div>

      {(adding || editing) && (
        <div style={{ background: '#f0f7ff', border: '1px solid #bee3f8', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <h4 style={{ marginBottom: 12, color: '#005A8E' }}>{adding ? 'New VAT Type' : `Edit — ${editing}`}</h4>
          <div className="form-row">
            {adding && (
              <div className="form-group" style={{ width: 120 }}>
                <label>VAT Code *</label>
                <input value={form.vat_code} onChange={e => setF('vat_code', e.target.value.toUpperCase())} placeholder="e.g. IN_STD" style={{ textTransform: 'uppercase' }} />
              </div>
            )}
            <div className="form-group" style={{ flex: 2 }}>
              <label>Description *</label>
              <input value={form.description} onChange={e => setF('description', e.target.value)} placeholder="e.g. Standard rate (15%)" />
            </div>
            <div className="form-group" style={{ width: 90 }}>
              <label>Rate % *</label>
              <input type="number" value={form.rate_pct} onChange={e => setF('rate_pct', e.target.value)} min="0" max="100" step="0.01" />
            </div>
            <div className="form-group" style={{ width: 110 }}>
              <label>Direction</label>
              <select value={form.vat_direction} onChange={e => setF('vat_direction', e.target.value)}>
                <option value="OUTPUT">OUTPUT</option>
                <option value="INPUT">INPUT</option>
                <option value="BOTH">BOTH</option>
              </select>
            </div>
            <div className="form-group" style={{ width: 90 }}>
              <label>VAT201 Field</label>
              <input value={form.vat201_field} onChange={e => setF('vat201_field', e.target.value)} placeholder="e.g. 1" />
            </div>
            <div className="form-group" style={{ width: 90, justifyContent: 'flex-end' }}>
              <label>Active</label>
              <input type="checkbox" checked={form.active} onChange={e => setF('active', e.target.checked)} style={{ width: 16, height: 16, marginTop: 8 }} />
            </div>
          </div>
          {err && <div style={{ color: '#c53030', fontSize: 13, marginBottom: 8 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button className="btn btn-sm" onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Description</th><th>Rate %</th><th>Direction</th><th>VAT201 Field</th><th>Capital</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {types.map(v => (
              <tr key={v.vat_code} style={{ opacity: v.active ? 1 : 0.5 }}>
                <td className="mono" style={{ fontWeight: 700 }}>{v.vat_code}</td>
                <td style={{ fontSize: 13 }}>{v.description}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{v.rate_pct}%</td>
                <td><span className={`badge ${DIR_BADGE[v.vat_direction] || 'badge-gray'}`} style={{ fontSize: 11 }}>{v.vat_direction}</span></td>
                <td style={{ textAlign: 'center', color: '#888', fontSize: 13 }}>{v.vat201_field || '—'}</td>
                <td style={{ textAlign: 'center' }}>{v.is_capital_goods ? '✓' : '—'}</td>
                <td><span className={`badge ${v.active ? 'badge-green' : 'badge-gray'}`} style={{ fontSize: 10 }}>{v.active ? 'Active' : 'Inactive'}</span></td>
                <td><button className="btn btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => startEdit(v)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function FinanceVAT() {
  const [tab, setTab]         = useState('summary');
  const [vatTypes, setVatTypes] = useState([]);

  useEffect(() => {
    req('/fin/vat-types').then(d => setVatTypes(Array.isArray(d) ? d : []));
  }, []);

  const tabStyle = (t) => ({
    padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    borderBottom: tab === t ? '2px solid #005A8E' : '2px solid transparent',
    color: tab === t ? '#005A8E' : '#666', whiteSpace: 'nowrap',
  });

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid #e8edf2', marginBottom: 16, gap: 4, overflowX: 'auto' }}>
        <div style={tabStyle('summary')}      onClick={() => setTab('summary')}>Summary</div>
        <div style={tabStyle('transactions')} onClick={() => setTab('transactions')}>VAT Transactions</div>
        <div style={tabStyle('return')}       onClick={() => setTab('return')}>VAT Return (VAT201)</div>
        <div style={tabStyle('vattypes')}     onClick={() => setTab('vattypes')}>VAT Types</div>
      </div>
      {tab === 'summary'      && <VATSummary vatTypes={vatTypes} />}
      {tab === 'transactions' && <VATTransactions />}
      {tab === 'return'       && <VATReturn />}
      {tab === 'vattypes'     && <VATTypeManager vatTypes={vatTypes} onRefresh={load} />}
    </div>
  );
}



