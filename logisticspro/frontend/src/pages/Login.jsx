import { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { api } from '../lib/api';

export default function Login() {
  const { login } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'forgot' | 'change'
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
      if (user?.first_login) {
        setFirstLoginUser(user);
        setMode('change');
      }
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
      } else {
        setSuccess(res.message);
      }
    } catch (err) {
      setError(err.message || 'Failed to reset password');
    } finally { setLoading(false); }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    if (changeForm.newPass.length < 8) {
      setError('New password must be at least 8 characters');
      setLoading(false); return;
    }
    if (changeForm.newPass !== changeForm.confirm) {
      setError('Passwords do not match');
      setLoading(false); return;
    }
    try {
      await api.changePassword({ current_password: changeForm.current, new_password: changeForm.newPass });
      setSuccess('Password changed! Logging you in…');
      setTimeout(() => setMode('login'), 1500);
    } catch (err) {
      setError(err.message || 'Failed to change password');
    } finally { setLoading(false); }
  };

  return (
    <div className="login-page">
      <div className="login-card">

        {/* Header */}
        <h1>LogisticsPro</h1>
        <p>
          {mode === 'login' && 'Transport Management System'}
          {mode === 'forgot' && 'Reset Password'}
          {mode === 'change' && 'Set New Password'}
        </p>

        {/* ── LOGIN ── */}
        {mode === 'login' && (
          <form onSubmit={handleLogin}>
            {error && <div className="error-msg">{error}</div>}
            <div className="form-group">
              <label>Username</label>
              <input
                type="text" required autoFocus
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="Enter your username"
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password" required
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Enter your password"
              />
            </div>
            <button type="submit" className="btn btn-primary"
              style={{ width: '100%', marginTop: 8 }} disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <button type="button"
                onClick={() => { setMode('forgot'); setError(''); setSuccess(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13 }}>
                Forgot password?
              </button>
            </div>
          </form>
        )}

        {/* ── FORGOT PASSWORD ── */}
        {mode === 'forgot' && (
          <form onSubmit={handleForgot}>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
              Enter your username to get a temporary password from your administrator.
            </p>
            {error && <div className="error-msg">{error}</div>}
            {success && (
              <div style={{ background: 'rgba(45,212,164,0.1)', border: '1px solid rgba(45,212,164,0.3)', color: 'var(--green)', padding: '10px 12px', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
                {success}
              </div>
            )}
            {tempPassword && (
              <div style={{ background: 'rgba(240,180,41,0.1)', border: '2px solid var(--accent)', borderRadius: 6, padding: 14, marginBottom: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Temporary password</div>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--accent)', letterSpacing: '0.1em' }}>{tempPassword}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Use this to login — you will be asked to change it</div>
              </div>
            )}
            <div className="form-group">
              <label>Username</label>
              <input
                type="text" required autoFocus
                value={forgotUsername}
                onChange={e => setForgotUsername(e.target.value)}
                placeholder="Enter your username"
              />
            </div>
            <button type="submit" className="btn btn-primary"
              style={{ width: '100%', marginTop: 8 }} disabled={loading}>
              {loading ? 'Generating…' : 'Get Temporary Password'}
            </button>
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <button type="button"
                onClick={() => { setMode('login'); setError(''); setSuccess(''); setTempPassword(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13 }}>
                ← Back to login
              </button>
            </div>
          </form>
        )}

        {/* ── CHANGE PASSWORD (first login) ── */}
        {mode === 'change' && (
          <form onSubmit={handleChangePassword}>
            <div style={{ background: 'rgba(240,180,41,0.1)', border: '1px solid var(--accent)', borderRadius: 6, padding: 12, marginBottom: 20, fontSize: 13, color: 'var(--accent)', textAlign: 'center' }}>
              👋 Welcome{firstLoginUser?.name ? `, ${firstLoginUser.name}` : ''}! Please set a new password to continue.
            </div>
            {error && <div className="error-msg">{error}</div>}
            {success && (
              <div style={{ color: 'var(--green)', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>{success}</div>
            )}
            <div className="form-group">
              <label>Current / Temporary Password</label>
              <input type="password" required autoFocus
                value={changeForm.current}
                onChange={e => setChangeForm(f => ({ ...f, current: e.target.value }))}
                placeholder="Enter current password" />
            </div>
            <div className="form-group">
              <label>New Password</label>
              <input type="password" required
                value={changeForm.newPass}
                onChange={e => setChangeForm(f => ({ ...f, newPass: e.target.value }))}
                placeholder="Minimum 8 characters" />
            </div>
            <div className="form-group">
              <label>Confirm New Password</label>
              <input type="password" required
                value={changeForm.confirm}
                onChange={e => setChangeForm(f => ({ ...f, confirm: e.target.value }))}
                placeholder="Repeat new password" />
            </div>
            <button type="submit" className="btn btn-primary"
              style={{ width: '100%', marginTop: 8 }} disabled={loading}>
              {loading ? 'Saving…' : 'Set New Password'}
            </button>
          </form>
        )}

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 11, color: 'var(--text3)' }}>
          Interland Distribution © {new Date().getFullYear()}
        </div>
      </div>
    </div>
  );
}
