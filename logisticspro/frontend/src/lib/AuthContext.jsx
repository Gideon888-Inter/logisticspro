import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api } from './api';

const AuthContext = createContext(null);

function safeParseUser() {
  try {
    return JSON.parse(localStorage.getItem('lp_user')) || null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(safeParseUser);

  const login = useCallback(async (username, password) => {
    const { token, user } = await api.login({ username, password });
    localStorage.setItem('lp_token', token);
    localStorage.setItem('lp_user', JSON.stringify(user));
    setUser({...user});
    return user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('lp_token');
    localStorage.removeItem('lp_user');
    setUser(null);
  }, []);

  // api.js dispatches this when a 401 clears the session — react gracefully
  // (show the login screen) instead of a hard window.location.reload().
  useEffect(() => {
    const onAuthExpired = () => setUser(null);
    window.addEventListener('lp-auth-expired', onAuthExpired);
    return () => window.removeEventListener('lp-auth-expired', onAuthExpired);
  }, []);

  const updateUser = useCallback((updates) => {
    const updated = { ...(safeParseUser() || {}), ...updates };
    localStorage.setItem('lp_user', JSON.stringify(updated));
    setUser(updated);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
