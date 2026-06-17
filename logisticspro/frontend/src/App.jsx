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

const LOGO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SE
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
