import { createContext, useContext, useState, useCallback } from 'react';
import { api } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('lp_user')); } catch { return null; }
  });

  const login = useCallback(async (username, password) => {
    const { token, user } = await api.login({ username, password });
    localStorage.setItem('lp_token', token);
    localStorage.setItem('lp_user', JSON.stringify(user));
    setUser(user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('lp_token');
    localStorage.removeItem('lp_user');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
