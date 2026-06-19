import { createContext, useContext, useState, useCallback } from 'react';
import { api } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('lp_user')); } catch { return null; }
  });

  const login = useCallback(async (username, password) => {
    const { token, user } = await api.login({ username, password });
    localStorage.setItem('lp_token', token);
    localStorage.setItem('lp_user', JSON.stringify(user));
    setUser({...user}); // spread to ensure new object reference triggers re-render
    return user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('lp_token');
    localStorage.removeItem('lp_user');
    setUser(null);
  }, []);

  const updateUser = useCallback((updates) => {
    const updated = { ...JSON.parse(localStorage.getItem('lp_user')), ...updates };
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
