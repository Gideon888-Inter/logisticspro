import { useState, useEffect } from 'react';
// LogisticsPro v2
import { useState, useEffect } from 'react';
import { useAuth } from './lib/AuthContext';
import Login from './pages/Login';
import Loads from './pages/Loads';
import Dashboard from './pages/Dashboard';
import Approvals from './pages/Approvals';
import Vehicles from './pages/Vehicles';
import VehicleLicenses from './pages/VehicleLicenses';
import Drivers from './pages/Drivers';
import Clients from './pages/Clients';
import Rates from './pages/Rates';
import Users from './pages/Users';
import { Maintenance, Inventory, Routes } from './pages/Entities';

const LOGO = "data:image/jpeg;base64,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";
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
  { key: 'vehicles',   label: 'Vehicles',         icon: '🚚',
    sub: [
      { key: 'vehicles-list',     label: 'Fleet List' },
      { key: 'vehicles-licenses', label: 'License Expiry' },
    ]
  },
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
  'vehicles-list': 'Vehicles',
  'vehicles-licenses': 'License Expiry',
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
      case 'vehicles-list':       return <Vehicles />;
      case 'vehicles-licenses':   return <VehicleLicenses />;
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
