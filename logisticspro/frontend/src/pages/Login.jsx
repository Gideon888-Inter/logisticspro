import { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import TRUCK_BG from '../../assets/login.jpeg';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError('Please enter your username and password.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await login(username.trim(), password);
    } catch (e) {
      setError('Invalid username or password.');
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') handleLogin();
  };

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflowY: 'auto',
      backgroundImage: `url(${TRUCK_BG})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      fontFamily: "'Segoe UI', Arial, sans-serif",
    }}>
      {/* Login card */}
      <div style={{
        background: 'white',
        borderRadius: 4,
        padding: '36px 28px 28px',
        width: 340,
        maxWidth: 'calc(100vw - 32px)',
        boxShadow: '0 8px 40px rgba(0,0,0,0.35)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
      }}>
        {/* Logo */}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4, justifyContent:'center' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
            <div style={{ width:22, height:3, background:'#00AEEF', borderRadius:2 }} />
            <div style={{ width:16, height:3, background:'#00AEEF', borderRadius:2 }} />
            <div style={{ width:10, height:3, background:'#00AEEF', borderRadius:2 }} />
          </div>
          <div style={{ display:'flex', flexDirection:'column', lineHeight:1.1 }}>
            <span style={{ fontSize:22, fontWeight:800, color:'#00AEEF', letterSpacing:'0.04em', fontStyle:'italic' }}>INTERLAND</span>
            <span style={{ fontSize:22, fontWeight:800, color:'#00AEEF', letterSpacing:'0.04em', fontStyle:'italic' }}>DISTRIBUTION</span>
          </div>
        </div>
        <div style={{ textAlign:'center', fontSize:9, letterSpacing:'0.15em', color:'#aaa', marginBottom:20, textTransform:'uppercase' }}>
          INTEGRATED LINEHAUL SOLUTIONS
        </div>
        <div style={{ height:1, background:'#eee', marginBottom:24 }} />

        {error && (
          <div style={{ background:'#fff1f2', border:'1px solid #fca5a5', color:'#e53e3e', borderRadius:3, padding:'8px 12px', fontSize:12, marginBottom:16, textAlign:'center' }}>
            {error}
          </div>
        )}

        {/* Username */}
        <div style={{ display:'flex', alignItems:'center', borderBottom:'1.5px solid #e53e3e', marginBottom:24, paddingBottom:4, gap:8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00AEEF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
          <input style={{ flex:1, border:'none', outline:'none', fontSize:14, color:'#333', background:'transparent', padding:'4px 0', fontFamily:'inherit' }}
            type="text" placeholder="Username" value={username}
            onChange={e => setUsername(e.target.value)} onKeyDown={handleKey} />
        </div>

        {/* Password */}
        <div style={{ display:'flex', alignItems:'center', borderBottom:'1.5px solid #e53e3e', marginBottom:24, paddingBottom:4, gap:8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e53e3e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <input style={{ flex:1, border:'none', outline:'none', fontSize:14, color:'#333', background:'transparent', padding:'4px 0', fontFamily:'inherit' }}
            type={showPassword ? 'text' : 'password'} placeholder="Password" value={password}
            onChange={e => setPassword(e.target.value)} onKeyDown={handleKey} />
          <button style={{ background:'none', border:'none', cursor:'pointer', padding:0, display:'flex', alignItems:'center' }}
            onClick={() => setShowPassword(v => !v)} tabIndex={-1}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {showPassword
                ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
                : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
              }
            </svg>
          </button>
        </div>

        {/* Button */}
        <button style={{ background:'#00AEEF', color:'white', border:'none', borderRadius:3, padding:'12px', fontSize:13, fontWeight:700, letterSpacing:'0.1em', cursor:'pointer', marginBottom:20, opacity: loading ? 0.7 : 1 }}
          onClick={handleLogin} disabled={loading}>
          {loading ? 'LOGGING IN…' : 'LOGIN'}
        </button>

        <div style={{ textAlign:'center', fontSize:10, color:'#bbb', letterSpacing:'0.05em' }}>
          © INTERLAND DISTRIBUTION 2026 v1.0.0
        </div>
      </div>
    </div>
  );
}
