import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../lib/AuthContext';
import { canDeleteLoad } from '../lib/roles';

const API   = import.meta.env.VITE_API_URL || '';
const token = () => localStorage.getItem('lp_token');
const req   = (path, opts = {}) =>
  fetch(API + '/api' + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token(),
      ...(opts.headers || {}),
    },
  }).then(r => r.json());

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}
function fmtDateTime(d) {
  return d ? new Date(d).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
}
function fmtBytes(n) {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

const STATUS_BADGE = {
  WAIT_POD_SCAN:   { bg: '#fff3cd', color: '#856404', label: 'Needs POD' },
  WAIT_INVOICE_NO: { bg: '#d1ecf1', color: '#0c5460', label: 'POD received' },
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

// ── File type icon ────────────────────────────────────────────
function FileIcon({ mime }) {
  const isPdf = mime?.includes('pdf');
  return (
    <span style={{ fontSize: 20, lineHeight: 1 }}>{isPdf ? '📄' : '🖼️'}</span>
  );
}

// ── Upload modal ──────────────────────────────────────────────
function UploadModal({ load, onClose, onDone }) {
  const [files, setFiles]     = useState([]);   // [{file, note}]
  const [uploading, setUploading] = useState(false);
  const [error, setError]     = useState('');
  const [progress, setProgress] = useState('');
  const inputRef = useRef();

  const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

  function addFiles(picked) {
    const added = [];
    for (const f of picked) {
      if (!ALLOWED_TYPES.includes(f.type)) { setError(`${f.name}: only PDF, JPEG, PNG, WebP accepted`); continue; }
      if (f.size > MAX_SIZE) { setError(`${f.name}: file must be under 10 MB`); continue; }
      added.push({ file: f, note: '' });
    }
    setFiles(prev => [...prev, ...added]);
    setError('');
  }

  function removeFile(i) { setFiles(prev => prev.filter((_, idx) => idx !== i)); }
  function setNote(i, val) { setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, note: val } : f)); }

  async function upload() {
    if (files.length === 0) return setError('Please select at least one file');
    setUploading(true);
    setError('');
    try {
      for (let i = 0; i < files.length; i++) {
        const { file, note } = files[i];
        setProgress(`Uploading ${i + 1} of ${files.length}: ${file.name}`);
        const base64 = await toBase64(file);
        const result = await req(`/pods/${load.m_load_no}/upload`, {
          method: 'POST',
          body: JSON.stringify({
            file_base64: base64,
            file_name:   file.name,
            mime_type:   file.type,
            note:        note || undefined,
          }),
        });
        if (result.error) throw new Error(result.error);
      }
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      setProgress('');
    }
  }

  function toBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}
      onClick={e => e.target === e.currentTarget && !uploading && onClose()}>
      <div style={{ background:'white', borderRadius:8, padding:24, width:'100%', maxWidth:520, boxShadow:'0 8px 32px rgba(0,0,0,0.18)' }}>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <div>
            <div style={{ fontWeight:700, fontSize:16, color:'#1a202c' }}>Upload POD</div>
            <div style={{ fontSize:12, color:'#888', marginTop:2 }}>{load.m_load_no} — {load.m_customer} — {load.m_from} → {load.m_to}</div>
          </div>
          {!uploading && <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#888' }}>×</button>}
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); e.currentTarget.style.background='#e8f4fd'; }}
          onDragLeave={e => { e.currentTarget.style.background='#f8fafc'; }}
          onDrop={e => { e.preventDefault(); e.currentTarget.style.background='#f8fafc'; addFiles([...e.dataTransfer.files]); }}
          onClick={() => inputRef.current?.click()}
          style={{ border:'2px dashed #cce0f0', borderRadius:8, padding:'28px 20px', textAlign:'center', cursor:'pointer', background:'#f8fafc', marginBottom:12, transition:'background 0.15s' }}
        >
          <div style={{ fontSize:32, marginBottom:8 }}>📁</div>
          <div style={{ fontSize:13, color:'#005A8E', fontWeight:600 }}>Click to browse or drag files here</div>
          <div style={{ fontSize:11, color:'#aaa', marginTop:4 }}>PDF, JPEG, PNG, WebP — max 10 MB each</div>
          <input ref={inputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp"
            style={{ display:'none' }} onChange={e => addFiles([...e.target.files])} />
        </div>

        {/* Selected files */}
        {files.length > 0 && (
          <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:12 }}>
            {files.map((f, i) => (
              <div key={i} style={{ background:'#f0f7ff', border:'1px solid #bfdbfe', borderRadius:6, padding:'8px 10px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                  <FileIcon mime={f.file.type} />
                  <span style={{ flex:1, fontSize:12, fontWeight:600, color:'#1e40af', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.file.name}</span>
                  <span style={{ fontSize:11, color:'#888' }}>{fmtBytes(f.file.size)}</span>
                  {!uploading && <button onClick={() => removeFile(i)} style={{ background:'none', border:'none', color:'#e53e3e', cursor:'pointer', fontSize:16, padding:'0 2px' }}>×</button>}
                </div>
                <input
                  placeholder="Optional note (e.g. Page 1 of 2)"
                  value={f.note}
                  onChange={e => setNote(i, e.target.value)}
                  disabled={uploading}
                  style={{ width:'100%', fontSize:11, border:'1px solid #ddd', borderRadius:4, padding:'4px 8px', fontFamily:'inherit', boxSizing:'border-box' }}
                />
              </div>
            ))}
          </div>
        )}

        {error    && <div style={{ background:'#fee2e2', color:'#991b1b', borderRadius:6, padding:'8px 12px', fontSize:12, marginBottom:10 }}>{error}</div>}
        {progress && <div style={{ background:'#eff6ff', color:'#1d4ed8', borderRadius:6, padding:'8px 12px', fontSize:12, marginBottom:10 }}>{progress}</div>}

        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          {!uploading && <button onClick={onClose} style={{ padding:'8px 16px', border:'1px solid #ddd', borderRadius:6, background:'white', cursor:'pointer', fontSize:13 }}>Cancel</button>}
          <button onClick={upload} disabled={uploading || files.length === 0}
            style={{ padding:'8px 20px', background: files.length === 0 || uploading ? '#93c5fd' : '#005A8E', color:'white', border:'none', borderRadius:6, cursor: files.length === 0 || uploading ? 'not-allowed' : 'pointer', fontSize:13, fontWeight:600 }}>
            {uploading ? 'Uploading…' : `Upload${files.length > 1 ? ` ${files.length} files` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── POD viewer modal ──────────────────────────────────────────
function ViewerModal({ loadNo, onClose, canDelete }) {
  const [podFiles, setPodFiles]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [deleting, setDeleting]   = useState(null);
  const [error, setError]         = useState('');

  async function loadFiles() {
    setLoading(true);
    try {
      const data = await req(`/pods/${loadNo}`);
      if (data.error) setError(data.error);
      else setPodFiles(Array.isArray(data) ? data : []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadFiles(); }, [loadNo]);

  async function deleteFile(id, name) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      const result = await req(`/pods/file/${id}`, { method: 'DELETE' });
      if (result.error) return setError(result.error);
      loadFiles();
    } catch (e) { setError(e.message); }
    finally { setDeleting(null); }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:'white', borderRadius:8, padding:24, width:'100%', maxWidth:540, boxShadow:'0 8px 32px rgba(0,0,0,0.18)', maxHeight:'80vh', overflowY:'auto' }}>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <div style={{ fontWeight:700, fontSize:16, color:'#1a202c' }}>POD files — {loadNo}</div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#888' }}>×</button>
        </div>

        {error   && <div style={{ background:'#fee2e2', color:'#991b1b', borderRadius:6, padding:'8px 12px', fontSize:12, marginBottom:10 }}>{error}</div>}
        {loading && <div style={{ textAlign:'center', color:'#888', padding:24 }}>Loading…</div>}
        {!loading && podFiles.length === 0 && <div style={{ textAlign:'center', color:'#aaa', padding:24 }}>No POD files found for this load.</div>}

        {!loading && podFiles.map(f => (
          <div key={f.id} style={{ border:'1px solid #e2e8f0', borderRadius:8, padding:'12px 14px', marginBottom:10, display:'flex', alignItems:'flex-start', gap:12 }}>
            <FileIcon mime={f.pf_mime_type} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:600, fontSize:13, color:'#1a202c', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.pf_file_name}</div>
              {f.pf_note && <div style={{ fontSize:12, color:'#555', marginTop:2 }}>{f.pf_note}</div>}
              <div style={{ fontSize:11, color:'#999', marginTop:4 }}>
                {fmtBytes(f.pf_file_size)} · Uploaded by {f.pf_uploaded_by} · {fmtDateTime(f.created_at)}
              </div>
            </div>
            <div style={{ display:'flex', gap:6, flexShrink:0 }}>
              {f.signed_url && (
                <a href={f.signed_url} target="_blank" rel="noreferrer"
                  style={{ padding:'5px 12px', background:'#005A8E', color:'white', borderRadius:5, fontSize:12, textDecoration:'none', fontWeight:600 }}>
                  View
                </a>
              )}
              {canDelete && (
                <button onClick={() => deleteFile(f.id, f.pf_file_name)} disabled={deleting === f.id}
                  style={{ padding:'5px 10px', background:'#fee2e2', color:'#991b1b', border:'none', borderRadius:5, fontSize:12, cursor:'pointer', fontWeight:600 }}>
                  {deleting === f.id ? '…' : 'Delete'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main PODs page ────────────────────────────────────────────
export default function PODs() {
  const { user } = useAuth();
  const [tab, setTab]             = useState('pending');
  const [pending, setPending]     = useState([]);
  const [received, setReceived]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [uploadLoad, setUploadLoad] = useState(null);   // load being uploaded to
  const [viewLoad, setViewLoad]   = useState(null);     // load whose files are being viewed
  const [error, setError]         = useState('');

  const isUploader = ['ADMIN','OPERATOR','OPS_ASSISTANT','CONTROL_ROOM'].includes(user?.role);
  const isDeletable = canDeleteLoad(user);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [pend, recv] = await Promise.all([
        req('/pods/pending').catch(() => []),
        req(`/pods/received${search ? '?search=' + encodeURIComponent(search) : ''}`).catch(() => []),
      ]);
      setPending(Array.isArray(pend) ? pend : []);
      setReceived(Array.isArray(recv) ? recv : []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadData(); }, []);

  function handleSearch(e) {
    e.preventDefault();
    loadData();
  }

  const TAB = { pending: 'Needs POD', received: 'POD received' };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16, flexWrap:'wrap', gap:8 }}>
        <div>
          <div style={{ fontSize:11, fontWeight:600, color:'#005A8E', textTransform:'uppercase', letterSpacing:'0.06em' }}>Documents</div>
          <div style={{ fontSize:20, fontWeight:700, color:'#1a202c' }}>Proof of Delivery</div>
        </div>
        <form onSubmit={handleSearch} style={{ display:'flex', gap:6 }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search load, customer, truck…"
            style={{ padding:'7px 12px', fontSize:13, border:'1px solid #ddd', borderRadius:6, width:240, fontFamily:'inherit' }} />
          <button type="submit" style={{ padding:'7px 14px', background:'#005A8E', color:'white', border:'none', borderRadius:6, fontSize:13, cursor:'pointer', fontWeight:600 }}>Search</button>
        </form>
      </div>

      {error && <div style={{ background:'#fee2e2', color:'#991b1b', borderRadius:6, padding:'8px 12px', fontSize:12, marginBottom:12 }}>{error}</div>}

      {/* Tabs + counts */}
      <div style={{ display:'flex', gap:0, borderBottom:'2px solid #e2e8f0', marginBottom:16 }}>
        {Object.entries(TAB).map(([key, label]) => {
          const count = key === 'pending' ? pending.length : received.length;
          return (
            <button key={key} onClick={() => setTab(key)} style={{
              padding:'10px 20px', border:'none', background:'none', cursor:'pointer',
              fontSize:13, fontWeight: tab === key ? 700 : 400,
              color: tab === key ? '#005A8E' : '#888',
              borderBottom: tab === key ? '2px solid #005A8E' : '2px solid transparent',
              marginBottom:-2, display:'flex', alignItems:'center', gap:6,
            }}>
              {label}
              <span style={{ background: key === 'pending' ? '#fef3cd' : '#d1ecf1', color: key === 'pending' ? '#856404' : '#0c5460', fontSize:11, fontWeight:700, padding:'1px 7px', borderRadius:99 }}>
                {loading ? '…' : count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign:'center', padding:48, color:'#aaa' }}>Loading…</div>
      ) : (
        <>
          {tab === 'pending' && (
            <>
              {pending.length === 0
                ? <div style={{ textAlign:'center', padding:48, color:'#aaa' }}>
                    <div style={{ fontSize:36, marginBottom:8 }}>✅</div>
                    <div style={{ fontSize:15, fontWeight:600 }}>All caught up</div>
                    <div style={{ fontSize:13, marginTop:4 }}>No loads waiting for a POD scan</div>
                  </div>
                : <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                    <thead>
                      <tr style={{ background:'#f8fafc', borderBottom:'2px solid #e2e8f0' }}>
                        {['Load No.','Date','Customer','Route','Rate',''].map(h => (
                          <th key={h} style={{ padding:'10px 12px', textAlign:'left', fontWeight:600, color:'#555', fontSize:12 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pending.map(load => (
                        <tr key={load.m_load_no} style={{ borderBottom:'1px solid #f0f0f0' }}
                          onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
                          onMouseLeave={e => e.currentTarget.style.background='white'}>
                          <td style={{ padding:'10px 12px', fontWeight:600, color:'#005A8E' }}>{load.m_load_no}</td>
                          <td style={{ padding:'10px 12px', color:'#555' }}>{fmtDate(load.m_date)}</td>
                          <td style={{ padding:'10px 12px' }}>{load.m_customer}</td>
                          <td style={{ padding:'10px 12px', color:'#555' }}>{load.m_from} → {load.m_to}</td>
                          <td style={{ padding:'10px 12px' }}>R {Number(load.m_rate||0).toLocaleString('en-ZA')}</td>
                          <td style={{ padding:'10px 12px' }}>
                            <div style={{ display:'flex', gap:6 }}>
                              {isUploader && (
                                <button onClick={() => setUploadLoad(load)}
                                  style={{ padding:'5px 14px', background:'#005A8E', color:'white', border:'none', borderRadius:5, fontSize:12, cursor:'pointer', fontWeight:600 }}>
                                  Upload POD
                                </button>
                              )}
                              <button onClick={() => setViewLoad(load.m_load_no)}
                                style={{ padding:'5px 10px', background:'#f0f4f8', color:'#555', border:'1px solid #ddd', borderRadius:5, fontSize:12, cursor:'pointer' }}>
                                View files
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
              }
            </>
          )}

          {tab === 'received' && (
            <>
              {received.length === 0
                ? <div style={{ textAlign:'center', padding:48, color:'#aaa' }}>
                    <div style={{ fontSize:36, marginBottom:8 }}>📂</div>
                    <div style={{ fontSize:15, fontWeight:600 }}>No PODs found</div>
                    <div style={{ fontSize:13, marginTop:4 }}>PODs will appear here once uploaded</div>
                  </div>
                : <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                    <thead>
                      <tr style={{ background:'#f8fafc', borderBottom:'2px solid #e2e8f0' }}>
                        {['Load No.','Date','Customer','Route','Status',''].map(h => (
                          <th key={h} style={{ padding:'10px 12px', textAlign:'left', fontWeight:600, color:'#555', fontSize:12 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {received.map(load => (
                        <tr key={load.m_load_no} style={{ borderBottom:'1px solid #f0f0f0' }}
                          onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
                          onMouseLeave={e => e.currentTarget.style.background='white'}>
                          <td style={{ padding:'10px 12px', fontWeight:600, color:'#005A8E' }}>{load.m_load_no}</td>
                          <td style={{ padding:'10px 12px', color:'#555' }}>{fmtDate(load.m_date)}</td>
                          <td style={{ padding:'10px 12px' }}>{load.m_customer}</td>
                          <td style={{ padding:'10px 12px', color:'#555' }}>{load.m_from} → {load.m_to}</td>
                          <td style={{ padding:'10px 12px' }}><Badge status={load.m_status} /></td>
                          <td style={{ padding:'10px 12px' }}>
                            <div style={{ display:'flex', gap:6 }}>
                              <button onClick={() => setViewLoad(load.m_load_no)}
                                style={{ padding:'5px 14px', background:'#005A8E', color:'white', border:'none', borderRadius:5, fontSize:12, cursor:'pointer', fontWeight:600 }}>
                                View files
                              </button>
                              {isUploader && (
                                <button onClick={() => setUploadLoad(load)}
                                  style={{ padding:'5px 10px', background:'#f0f4f8', color:'#555', border:'1px solid #ddd', borderRadius:5, fontSize:12, cursor:'pointer' }}>
                                  Add file
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
              }
            </>
          )}
        </>
      )}

      {/* Upload modal */}
      {uploadLoad && (
        <UploadModal
          load={uploadLoad}
          onClose={() => setUploadLoad(null)}
          onDone={() => { setUploadLoad(null); loadData(); }}
        />
      )}

      {/* Viewer modal */}
      {viewLoad && (
        <ViewerModal
          loadNo={viewLoad}
          canDelete={isDeletable}
          onClose={() => setViewLoad(null)}
        />
      )}
    </div>
  );
}
