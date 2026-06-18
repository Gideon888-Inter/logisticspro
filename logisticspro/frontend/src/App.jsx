import { useState, useEffect } from 'react';
import { useAuth } from './lib/AuthContext';
import Login from './pages/Login';
import Loads from './pages/Loads';
import Dashboard from './pages/Dashboard';
import Approvals from './pages/Approvals';
import Fleet from './pages/Fleet';
import Drivers from './pages/Drivers';
import Clients from './pages/Clients';
import Rates from './pages/Rates';
import Users from './pages/Users';
import { Maintenance, Inventory, Routes } from './pages/Entities';

const LOGO = "data:image/jpeg;base64,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";

const MenuIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="6" x2="21" y2="6"/>
    <line x1="3" y1="12" x2="21" y2="12"/>
    <line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
);
const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const ChevronIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);
const LogoutIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
);

const MENU = [
  { key: '',           label: 'Home',            icon: '🏠' },
  { key: 'movement',   label: 'Loads',           icon: '🚛' },
  { key: 'workshop',   label: 'Workshop',        icon: '🔧',
    sub: [
      { key: 'workshop-jobcards',    label: 'Job Cards' },
      { key: 'workshop-maintenance', label: 'Maintenance' },
      { key: 'workshop-inventory',   label: 'Inventory' },
    ]
  },
  { key: 'approvals',  label: 'Approvals',       icon: '✅' },
  { key: 'vehicles', label: 'Fleet', icon: '🚚' },
  { key: 'drivers',    label: 'Drivers',           icon: '👤',
    sub: [
      { key: 'drivers-list',  label: 'Driver List' },
      { key: 'drivers-leave', label: 'Leave' },
    ]
  },
  { key: 'rates',      label: 'Client Rates',     icon: '💰',
    sub: [
      { key: 'rates-list',   label: 'Rate List' },
      { key: 'rates-routes', label: 'Routes' },
    ]
  },
  { key: 'clients',    label: 'Clients',           icon: '🏢' },
  { key: 'users',      label: 'Users',              icon: '👥' },
  { key: 'schedule',   label: 'Report Schedule',   icon: '📅' },
];

const PAGE_TITLES = {
  '': 'Overview',
  movement: 'Loads',
  'vehicles': 'Fleet',
  'drivers-list': 'Drivers', 'drivers-leave': 'Driver Leave',
  clients: 'Clients', 'workshop-jobcards': 'Job Cards',
  'workshop-maintenance': 'Maintenance', 'workshop-inventory': 'Inventory',
  approvals: 'Approvals', 'rates-list': 'Client Rates', 'rates-routes': 'Routes',
  users: 'Users', schedule: 'Report Schedule',
};

export default function App() {
  const { user, logout } = useAuth();
  const [page, setPage] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState({});

  const navigate = (key) => {
    setPage(key);
    MENU.forEach(item => {
      if (item.sub && item.sub.find(s => s.key === key)) {
        setExpandedMenus(prev => ({ ...prev, [item.key]: true }));
      }
    });
  };

  // Handle banner navigation from Dashboard
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.page) navigate(e.detail.page);
    };
    window.addEventListener('lp-navigate', handler);
    return () => window.removeEventListener('lp-navigate', handler);
  }, []);

  if (!user) return <Login />;

  const toggleMenu = (key) => {
    setExpandedMenus(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const renderPage = () => {
    switch (page) {
      case '':                    return <Dashboard onNavigate={navigate} />;
      case 'movement':            return <Loads />;
      case 'approvals':           return <Approvals />;
      case 'vehicles':            return <Fleet />;

      case 'drivers-list':        return <Drivers />;
      case 'workshop-maintenance':return <Maintenance />;
      case 'workshop-inventory':  return <Inventory />;
      case 'rates-list':          return <Rates />;
      case 'clients':             return <Clients />;
      case 'users':               return <Users />;
      default:                    return <Dashboard onNavigate={navigate} />;
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#f5f7fa' }}>

      {/* Sidebar */}
      <div style={{
        width: sidebarOpen ? 220 : 0, minWidth: sidebarOpen ? 220 : 0,
        background: '#005A8E', color: 'white', display: 'flex', flexDirection: 'column',
        transition: 'width 0.2s, min-width 0.2s', overflow: 'hidden', flexShrink: 0,
      }}>
        {/* Logo */}
        {sidebarOpen && (
          <div style={{ padding: '16px 12px 12px', borderBottom: '1px solid rgba(255,255,255,0.12)', flexShrink: 0 }}>
            <img src={LOGO} alt="Interland Distribution" style={{ width: '100%', maxHeight: 48, objectFit: 'contain' }} />
          </div>
        )}

        {/* Nav items */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {MENU.map(item => (
            <div key={item.key}>
              <div
                onClick={() => item.sub ? toggleMenu(item.key) : navigate(item.key)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '9px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                  background: page === item.key ? 'rgba(255,255,255,0.18)' : 'transparent',
                  borderLeft: page === item.key ? '3px solid #00AEEF' : '3px solid transparent',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (page !== item.key) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                onMouseLeave={e => { if (page !== item.key) e.currentTarget.style.background = 'transparent'; }}
              >
                <span>{item.icon} {item.label}</span>
                {item.sub && <span style={{ opacity: 0.7, transform: expandedMenus[item.key] ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}><ChevronIcon /></span>}
              </div>
              {item.sub && expandedMenus[item.key] && (
                <div style={{ background: 'rgba(0,0,0,0.15)' }}>
                  {item.sub.map(s => (
                    <div key={s.key}
                      onClick={() => navigate(s.key)}
                      style={{
                        padding: '7px 16px 7px 36px', cursor: 'pointer', fontSize: 12,
                        background: page === s.key ? 'rgba(255,255,255,0.18)' : 'transparent',
                        borderLeft: page === s.key ? '3px solid #00AEEF' : '3px solid transparent',
                      }}
                      onMouseEnter={e => { if (page !== s.key) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                      onMouseLeave={e => { if (page !== s.key) e.currentTarget.style.background = 'transparent'; }}
                    >
                      {s.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Logout */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', padding: 8 }}>
          <div onClick={logout} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
            cursor: 'pointer', fontSize: 13, borderRadius: 4,
          }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <LogoutIcon /> Sign out
          </div>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Top bar */}
        <div style={{
          height: 52, background: 'white', borderBottom: '1px solid #e8edf2',
          display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12,
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)', flexShrink: 0,
        }}>
          <button onClick={() => setSidebarOpen(o => !o)} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: '#005A8E',
            display: 'flex', alignItems: 'center', padding: 4,
          }}>
            {sidebarOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
          <span style={{ fontWeight: 600, fontSize: 16, color: '#1a202c' }}>
            {PAGE_TITLES[page] || 'Overview'}
          </span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: '#555' }}>
            🔔
          </span>
          <span style={{ fontSize: 13, color: '#555' }}>
            {user?.name || user?.username}
          </span>
        </div>

        {/* Page content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {renderPage()}
        </div>
      </div>
    </div>
  );
}
