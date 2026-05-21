import { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { api } from '../lib/api';

const InterlandLogo = () => (
  <svg viewBox="0 0 420 110" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', maxWidth: 380 }}>
    {/* Speed lines */}
    <rect x="0" y="18" width="38" height="7" rx="2" fill="#00AEEF" opacity="0.85"/>
    <rect x="0" y="30" width="24" height="5" rx="2" fill="#00AEEF" opacity="0.55"/>
    <rect x="0" y="41" width="16" height="4" rx="2" fill="#00AEEF" opacity="0.35"/>

    {/* INTERLAND */}
    <text x="46" y="52"
      fontFamily="'Arial Black', 'Arial Bold', Arial, sans-serif"
      fontWeight="900"
      fontSize="46"
      fill="#00AEEF"
      fontStyle="italic"
      letterSpacing="-1">INTERLAND</text>

    {/* DISTRIBUTION */}
    <text x="46" y="88"
      fontFamily="'Arial Black', 'Arial Bold', Arial, sans-serif"
      fontWeight="900"
      fontSize="38"
      fill="#00AEEF"
      fontStyle="italic"
      letterSpacing="1">DISTRIBUTION</text>

    {/* INTEGRATED LINEHAUL SOLUTIONS */}
    <text x="48" y="106"
      fontFamily="Arial, sans-serif"
      fontWeight="400"
      fontSize="13"
      fill="rgba(255,255,255,0.85)"
      letterSpacing="3.5">INTEGRATED LINEHAUL SOLUTIONS</text>
  </svg>
);

export default function Login() {
  const { login } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '' });
  const [changeForm, setChangeForm] = useState({ current: '', newPass: '', confirm: '' });
  const [forgotUsername, setForgotUsername] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [tempPassword, setTempPassword] = useState('');
  const [firstLoginUser, setFirstLoginUser] = useState(null);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const user = await login(form.username, form.password);
      if (user?.first_login) { setFirstLoginUser(user); setMode('change'); }
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally { setLoading(false); }
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    try {
      const res = await api.forgotPassword({ username: forgotUsername });
      if (res.temp_password) {
        setTempPassword(res.temp_password);
        setSuccess('Temporary password generated. Note it below and use it to login.');
      } else { setSuccess(res.message); }
    } catch (err) {
      setError(err.message || 'Failed to reset password');
    } finally { setLoading(false); }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    if (changeForm.newPass.length < 8) { setError('New password must be at least 8 characters'); setLoading(false); return; }
    if (changeForm.newPass !== changeForm.confirm) { setError('Passwords do not match'); setLoading(false); return; }
    try {
      await api.changePassword({ current_password: changeForm.current, new_password: changeForm.newPass });
      setSuccess('Password changed! Logging you in…');
      setTimeout(() => setMode('login'), 1500);
    } catch (err) {
      setError(err.message || 'Failed to change password');
    } finally { setLoading(false); }
  };

  const inputStyle = {
    width: '100%', padding: '11px 13px', fontSize: 14,
    border: '1px solid #ddd', borderRadius: 6,
    fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
    background: '#f9f9f9', color: '#222',
  };
  const labelStyle = { fontSize: 11, color: '#666', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 };
  const btnStyle = {
    width: '100%', padding: '12px', fontSize: 14, fontWeight: 700,
    border: 'none', borderRadius: 6, background: '#00AEEF',
    color: 'white', cursor: 'pointer', marginTop: 8,
    opacity: loading ? 0.7 : 1, letterSpacing: '0.03em',
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(160deg, #001f3f 0%, #003d7a 40%, #005A8E 70%, #00AEEF 100%)',
      position: 'relative', overflow: 'hidden', padding: '20px 16px',
    }}>
      {/* Truck silhouette background */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: '35%', opacity: 0.06,
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 200'%3E%3Crect x='10' y='80' width='480' height='100' rx='8' fill='white'/%3E%3Crect x='490' y='50' width='180' height='130' rx='6' fill='white'/%3E%3Ccircle cx='120' cy='185' r='30' fill='white'/%3E%3Ccircle cx='400' cy='185' r='30' fill='white'/%3E%3Ccircle cx='590' cy='185' r='30' fill='white'/%3E%3Crect x='490' y='60' width='80' height='60' rx='4' fill='%23001f3f'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'repeat-x', backgroundPosition: 'bottom', backgroundSize: '600px auto',
      }} />

      {/* Logo — sits ABOVE the card, never overlaps */}
      <div style={{ marginBottom: 24, width: '100%', maxWidth: 400, textAlign: 'center' }}>
        <InterlandLogo />
      </div>

      {/* Login card */}
      <div style={{
        background: 'white', borderRadius: 12, padding: '36px 32px',
        width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
      }}>

        {/* ── LOGIN ── */}
        {mode === 'login' && (
          <form onSubmit={handleLogin}>
            {error && <div style={{ color: '#e53e3e', fontSize: 13, marginBottom: 14, textAlign: 'center', background: '#fff5f5', padding: '8px 12px', borderRadius: 6, border: '1px solid #fed7d7' }}>{error}</div>}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Username</label>
              <input style={inputStyle} type="text" required autoFocus
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="Enter your username" />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Password</label>
              <input style={inputStyle} type="password" required
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Enter your password" />
            </div>
            <button type="submit" style={btnStyle} disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button type="button"
                onClick={() => { setMode('forgot'); setError(''); setSuccess(''); }}
                style={{ background: 'none', border: 'none', color: '#00AEEF', cursor: 'pointer', fontSize: 13 }}>
                Forgot password?
              </button>
            </div>
          </form>
        )}

        {/* ── FORGOT PASSWORD ── */}
        {mode === 'forgot' && (
          <form onSubmit={handleForgot}>
            <p style={{ fontSize: 13, color: '#666', marginBottom: 16, textAlign: 'center' }}>
              Enter your username to get a temporary password.
            </p>
            {error && <div style={{ color: '#e53e3e', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>{error}</div>}
            {success && (
              <div style={{ background: '#f0fdf4', border: '1px solid #86efac', color: '#059669', padding: '10px 12px', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
                {success}
              </div>
            )}
            {tempPassword && (
              <div style={{ background: '#fffbeb', border: '2px solid #00AEEF', borderRadius: 6, padding: 14, marginBottom: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#666', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Temporary password</div>
                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: '#003d7a', letterSpacing: '0.1em' }}>{tempPassword}</div>
                <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>Use this to login — you will be asked to change it</div>
              </div>
            )}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Username</label>
              <input style={inputStyle} type="text" required autoFocus
                value={forgotUsername}
                onChange={e => setForgotUsername(e.target.value)}
                placeholder="Enter your username" />
            </div>
            <button type="submit" style={btnStyle} disabled={loading}>
              {loading ? 'Generating…' : 'Get Temporary Password'}
            </button>
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <button type="button"
                onClick={() => { setMode('login'); setError(''); setSuccess(''); setTempPassword(''); }}
                style={{ background: 'none', border: 'none', color: '#00AEEF', cursor: 'pointer', fontSize: 13 }}>
                ← Back to login
              </button>
            </div>
          </form>
        )}

        {/* ── CHANGE PASSWORD ── */}
        {mode === 'change' && (
          <form onSubmit={handleChangePassword}>
            <div style={{ background: '#fffbeb', border: '1px solid #00AEEF', borderRadius: 6, padding: 12, marginBottom: 20, fontSize: 13, color: '#003d7a', textAlign: 'center' }}>
              👋 Welcome{firstLoginUser?.name ? `, ${firstLoginUser.name}` : ''}! Please set a new password to continue.
            </div>
            {error && <div style={{ color: '#e53e3e', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>{error}</div>}
            {success && <div style={{ color: '#059669', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>{success}</div>}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Current / Temporary Password</label>
              <input style={inputStyle} type="password" required autoFocus
                value={changeForm.current}
                onChange={e => setChangeForm(f => ({ ...f, current: e.target.value }))}
                placeholder="Enter current password" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>New Password</label>
              <input style={inputStyle} type="password" required
                value={changeForm.newPass}
                onChange={e => setChangeForm(f => ({ ...f, newPass: e.target.value }))}
                placeholder="Minimum 8 characters" />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Confirm New Password</label>
              <input style={inputStyle} type="password" required
                value={changeForm.confirm}
                onChange={e => setChangeForm(f => ({ ...f, confirm: e.target.value }))}
                placeholder="Repeat new password" />
            </div>
            <button type="submit" style={btnStyle} disabled={loading}>
              {loading ? 'Saving…' : 'Set New Password'}
            </button>
          </form>
        )}

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 11, color: '#aaa' }}>
          Interland Distribution © {new Date().getFullYear()}
        </div>
      </div>
    </div>
  );
}
