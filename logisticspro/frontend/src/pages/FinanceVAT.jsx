import { useState, useEffect } from 'react';

const API = `${import.meta.env.VITE_API_URL}/api`;
const token = () => localStorage.getItem('lp_token');
const req = (path) => fetch(API + path, { headers: { Authorization: 'Bearer ' + token() } }).then(r => r.json());
const fmt = (n) => n == null ? '—' : `R ${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FinanceVAT() {
  const [periods, setPeriods] = useState([]);
  const [vatTypes, setVatTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => { load(); }, []);
  const load = async () => {
    setLoading(true);
    const [pRes, vtRes] = await Promise.all([req('/fin/vat201'), req('/fin/vat-types')]);
    setPeriods(Array.isArray(pRes) ? pRes : []);
    setVatTypes(Array.isArray(vtRes) ? vtRes : []);
    setLoading(false);
  };

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">VAT Periods</div><div className="stat-value">{periods.length}</div></div>
        <div className="stat-card"><div className="stat-label">VAT Types</div><div className="stat-value" style={{color:'#00AEEF'}}>{vatTypes.length}</div></div>
        <div className="stat-card"><div className="stat-label">Filed Periods</div><div className="stat-value" style={{color:'#059669'}}>0</div></div>
      </div>

      {periods.length === 0 && !loading && (
        <div style={{background:'#fffbeb',border:'1px solid #fcd34d',borderRadius:6,padding:16,margin:'16px 0',fontSize:13}}>
          <strong>ℹ️ No VAT transactions yet.</strong> The VAT201 summary will populate automatically as GL journals with VAT are posted.
          The VAT control account is <span className="mono" style={{background:'#f5f5f5',padding:'1px 6px',borderRadius:3}}>9500</span>.
        </div>
      )}

      <div style={{marginTop:16}}>
        <div style={{fontWeight:700,fontSize:13,color:'#333',marginBottom:8}}>VAT Type Reference</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Description</th><th>Rate</th><th>Direction</th><th>VAT201 Field</th><th>AR</th><th>AP</th><th>Capital</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={8}><div className="loading">Loading VAT types…</div></td></tr>}
              {vatTypes.map(v => (
                <tr key={v.vat_code}>
                  <td className="mono" style={{fontWeight:600}}>{v.vat_code}</td>
                  <td style={{fontSize:12}}>{v.description}</td>
                  <td style={{fontWeight:600}}>{v.rate_pct}%</td>
                  <td><span className={`badge ${v.vat_direction==='OUTPUT'?'badge-green':v.vat_direction==='INPUT'?'badge-blue':'badge-gray'}`} style={{fontSize:10}}>{v.vat_direction}</span></td>
                  <td className="mono" style={{fontWeight:600,color:'#005A8E'}}>{v.vat201_field||'—'}</td>
                  <td style={{textAlign:'center'}}>{v.allowed_on_ar ? '✓' : '—'}</td>
                  <td style={{textAlign:'center'}}>{v.allowed_on_ap ? '✓' : '—'}</td>
                  <td style={{textAlign:'center'}}>{v.is_capital_goods ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {periods.length > 0 && (
        <div style={{marginTop:24}}>
          <div style={{fontWeight:700,fontSize:13,color:'#333',marginBottom:8}}>VAT201 Summary by Period</div>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Period</th>
                <th style={{textAlign:'right'}}>Field 1 (Output)</th>
                <th style={{textAlign:'right'}}>Field 1A (CN)</th>
                <th style={{textAlign:'right'}}>Field 14 (Input)</th>
                <th style={{textAlign:'right'}}>Field 15 (Capital)</th>
                <th style={{textAlign:'right'}}>Net VAT</th>
              </tr></thead>
              <tbody>
                {periods.map(p => (
                  <tr key={p.vat_period}>
                    <td className="mono" style={{fontWeight:600}}>{p.vat_period}</td>
                    <td style={{textAlign:'right',fontFamily:'monospace'}}>{fmt(p.field1_output_sales_vat)}</td>
                    <td style={{textAlign:'right',fontFamily:'monospace'}}>{fmt(p.field1a_output_cn_vat)}</td>
                    <td style={{textAlign:'right',fontFamily:'monospace'}}>{fmt(p.field14_input_purchases_vat)}</td>
                    <td style={{textAlign:'right',fontFamily:'monospace'}}>{fmt(p.field15_input_capital_vat)}</td>
                    <td style={{textAlign:'right',fontFamily:'monospace',fontWeight:700,color: (p.net_vat_payable||0) > 0 ? '#e53e3e':'#059669'}}>{fmt(p.net_vat_payable)}</td>
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
