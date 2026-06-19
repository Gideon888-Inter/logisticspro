import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { api } from '../lib/api';

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

const STATUS_BADGE = {
  WAIT_POD_SCAN:   { bg: '#fff3cd', color: '#856404', label: 'Needs POD' },
  WAIT_APPROVAL:   { bg: '#d1ecf1', color: '#0c5460', label: 'POD Received' },
  WAIT_RATE_CHECK: { bg: '#d1ecf1', color: '#0c5460', label: 'POD Received' },
  WAIT_INVOICE_NO: { bg: '#d1ecf1', color: '#0c5460', label: 'POD Received' },
  LOAD_INVOICED:   { bg: '#d4edda', color: '#155724', label: 'Invoiced' },
};

function Badge({ status }) {
  const s = STATUS_BADGE[status] || { bg: '#f0f0f0', color: '#555', label: status };
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99 }}>
      {s.label}
    </span>
  );
}

// ── SharePoint folder button ──────────────────────────────────
function SharePointButton({ url, loadNo }) {
  if (!url) return (
    <span style={{ fontSize: 11, color: '#aaa' }}>No SharePoint URL configured</span>
  );
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      style={{ padding: '5px 14px', background: '#0078d4', color: 'white', borderRadius: 5, fontSize: 12, textDecoration: 'none', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}
    >
      📁 Open POD Folder
    </a>
  );
}

// ── Main PODs page ────────────────────────────────────────────
export default function PODs() {
  const { user } = useAuth();
  const [tab, setTab]           = useState('pending');
  const [pending, setPending]   = useState([]);
  const [received, setReceived] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [marking, setMarking]   = useState(null); // loadNo being marked
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');

  const canMark = ['ADMIN', 'OPERATOR', 'OPS_ASSISTANT', 'CONTROL_ROOM'].includes(user?.role);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [pend, recv] = await Promise.all([
        api.getPendingPODs(),
        api.getReceivedPODs(search ? { search } : {}),
      ]);
      setPending(Array.isArray(pend) ? pend : []);
      setReceived(Array.isArray(recv) ? recv : []);
    } catch (e) {
      setError('Could not load PODs: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  function handleSearch(e) {
    e.preventDefault();
    loadData();
  }

  async function markReceived(loadNo) {
    if (!window.confirm(`Confirm that the POD for load ${loadNo} has been saved to SharePoint?`)) return;
    setMarking(loadNo);
    setError('');
    setSuccess('');
    try {
      await api.markPODReceived(loadNo);
      setSuccess(`POD for ${loadNo} marked as received.`);
      loadData();
    } catch (e) {
      setError(e.message);
    } finally {
      setMarking(null);
    }
  }

  const TAB = { pending: 'Needs POD', received: 'POD Received' };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#005A8E', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Documents</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#1a202c' }}>Proof of Delivery</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>POD files are stored in SharePoint — click "Open POD Folder" to access them</div>
        </div>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 6 }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search load, customer, truck…"
            style={{ padding: '7px 12px', fontSize: 13, border: '1px solid #ddd', borderRadius: 6, width: 240, fontFamily: 'inherit' }} />
          <button type="submit" style={{ padding: '7px 14px', background: '#005A8E', color: 'white', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>Search</button>
        </form>
      </div>

      {error   && <div style={{ background: '#fee2e2', color: '#991b1b', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 12 }}>{error}</div>}
      {success && <div style={{ background: '#d4edda', color: '#155724', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 12 }}>{success}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e2e8f0', marginBottom: 16 }}>
        {Object.entries(TAB).map(([key, label]) => {
          const count = key === 'pending' ? pending.length : received.length;
          return (
            <button key={key} onClick={() => setTab(key)} style={{
              padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: tab === key ? 700 : 400,
              color: tab === key ? '#005A8E' : '#888',
              borderBottom: tab === key ? '2px solid #005A8E' : '2px solid transparent',
              marginBottom: -2, display: 'flex', alignItems: 'center', gap: 6,
            }}>
              {label}
              <span style={{ background: key === 'pending' ? '#fef3cd' : '#d1ecf1', color: key === 'pending' ? '#856404' : '#0c5460', fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 99 }}>
                {loading ? '…' : count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#aaa' }}>Loading…</div>
      ) : (
        <>
          {/* ── Pending tab ── */}
          {tab === 'pending' && (
            pending.length === 0
              ? <div style={{ textAlign: 'center', padding: 48, color: '#aaa' }}>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>All caught up</div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>No loads waiting for a POD</div>
                </div>
              : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      {['Load No.', 'Date', 'Customer', 'Route', 'Rate', 'SharePoint', ''].map(h => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#555', fontSize: 12 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map(load => (
                      <tr key={load.m_load_no} style={{ borderBottom: '1px solid #f0f0f0' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                        onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                        <td style={{ padding: '10px 12px', fontWeight: 600, color: '#005A8E' }}>{load.m_load_no}</td>
                        <td style={{ padding: '10px 12px', color: '#555' }}>{fmtDate(load.m_date)}</td>
                        <td style={{ padding: '10px 12px' }}>{load.m_customer}</td>
                        <td style={{ padding: '10px 12px', color: '#555' }}>{load.m_from} → {load.m_to}</td>
                        <td style={{ padding: '10px 12px' }}>R {Number(load.m_rate || 0).toLocaleString('en-ZA')}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <SharePointButton url={load.sharepoint_url} loadNo={load.m_load_no} />
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {canMark && (
                            <button
                              onClick={() => markReceived(load.m_load_no)}
                              disabled={marking === load.m_load_no}
                              style={{ padding: '5px 12px', background: marking === load.m_load_no ? '#d1fae5' : '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', borderRadius: 5, fontSize: 12, cursor: marking === load.m_load_no ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
                              {marking === load.m_load_no ? '…' : '✓ Mark Received'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
          )}

          {/* ── Received tab ── */}
          {tab === 'received' && (
            received.length === 0
              ? <div style={{ textAlign: 'center', padding: 48, color: '#aaa' }}>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>📂</div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>No PODs received yet</div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>PODs marked as received will appear here</div>
                </div>
              : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      {['Load No.', 'Date', 'Customer', 'Route', 'Status', 'SharePoint'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#555', fontSize: 12 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {received.map(load => (
                      <tr key={load.m_load_no} style={{ borderBottom: '1px solid #f0f0f0' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                        onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                        <td style={{ padding: '10px 12px', fontWeight: 600, color: '#005A8E' }}>{load.m_load_no}</td>
                        <td style={{ padding: '10px 12px', color: '#555' }}>{fmtDate(load.m_date)}</td>
                        <td style={{ padding: '10px 12px' }}>{load.m_customer}</td>
                        <td style={{ padding: '10px 12px', color: '#555' }}>{load.m_from} → {load.m_to}</td>
                        <td style={{ padding: '10px 12px' }}><Badge status={load.m_status} /></td>
                        <td style={{ padding: '10px 12px' }}>
                          <SharePointButton url={load.sharepoint_url} loadNo={load.m_load_no} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
          )}
        </>
      )}
    </div>
  );
}
