import { useState } from 'react';
import { useAuth } from './lib/AuthContext';
import Login from './pages/Login';
import Loads from './pages/Loads';
import { Vehicles, Drivers, Customers, Maintenance, Inventory, Routes } from './pages/Entities';

const ICONS = {
  loads:       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  vehicles:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v9h-2"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="17.5" r="2.5"/></svg>,
  drivers:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  customers:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  routes:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>,
  maintenance: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>,
  inventory:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
};

const PAGES = [
  { key: 'loads',       label: 'Loads',       component: Loads },
  { key: 'vehicles',    label: 'Vehicles',    component: Vehicles },
  { key: 'drivers',     label: 'Drivers',     component: Drivers },
  { key: 'customers',   label: 'Customers',   component: Customers },
  { key: 'routes',      label: 'Routes',      component: Routes },
  { key: 'maintenance', label: 'Maintenance', component: Maintenance },
  { key: 'inventory',   label: 'Inventory',   component: Inventory },
];

const ADD_LABELS = {
  loads: '+ New Load', vehicles: '+ Add Vehicle', drivers: '+ Add Driver',
  customers: '+ Add Customer', routes: '+ New Route', maintenance: '+ New Job Card', inventory: '+ Add Part',
};

export default function App() {
  const { user, logout } = useAuth();
  const [page, setPage] = useState('loads');

  if (!user) return <Login />;

  const current = PAGES.find(p => p.key === page);
  const PageComponent = current?.component;
  const initials = user.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || user.username?.[0]?.toUpperCase();

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>LogisticsPro</h1>
          <p>Transport Management</p>
        </div>
        <nav>
          {PAGES.map(p => (
            <button key={p.key} className={`nav-item ${page === p.key ? 'active' : ''}`} onClick={() => setPage(p.key)}>
              {ICONS[p.key]}
              {p.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-pill">
            <div className="user-avatar">{initials}</div>
            <div>
              <div style={{ color: 'var(--text)', fontSize: 12 }}>{user.name || user.username}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>{user.role}</div>
            </div>
            <button className="btn btn-sm" style={{ marginLeft: 'auto', fontSize: 11 }} onClick={logout}>Sign out</button>
          </div>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <h2>{current?.label}</h2>
          <div className="topbar-actions">
            <span style={{ fontSize: 12, color: 'var(--text3)', alignSelf: 'center' }}>{user.bus_unit || 'All units'}</span>
          </div>
        </div>
        <div className="content">
          {PageComponent && <PageComponent />}
        </div>
      </div>
    </div>
  );
}
