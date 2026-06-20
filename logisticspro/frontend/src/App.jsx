import { useState, useEffect } from 'react';
import LOGO from '../assets/logo.png';
import { useAuth } from './lib/AuthContext';
import {
  canViewLoads, canViewFleet, canViewWorkshop, canViewRates,
  canManageClients, canManageDrivers, canManageUsers,
  canManageInvoices, canViewApprovals,
  ROLES,
} from './lib/roles';
import Login from './pages/Login';
import Loads from './pages/Loads';
import Dashboard from './pages/Dashboard';
import Approvals from './pages/Approvals';
import Fleet from './pages/Fleet';
import Drivers from './pages/Drivers';
import Clients from './pages/Clients';
import Rates from './pages/Rates';
import Users from './pages/Users';
import Invoices from './pages/Invoices';
import { Maintenance, Inventory } from './pages/Entities';
import ServiceCards from './pages/ServiceCards';

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

// Build menu dynamically based on user role
function buildMenu(user) {
  const menu = [];
  if (user?.role === ROLES.READONLY) return menu;
  menu.push({ key: '', label: 'Home', icon: '🏠' });
  if (canViewLoads(user))
    menu.push({ key: 'movement', label: 'Loads', icon: '🚛' });
  if (canViewWorkshop(user))
    menu.push({ key: 'workshop', label: 'Workshop', icon: '🔧',
      sub: [
        { key: 'workshop-service',     label: 'Service' },
        { key: 'workshop-maintenance', label: 'Maintenance' },
        { key: 'workshop-inventory',   label: 'Inventory' },
      ]
    });
  if (canViewApprovals(user))
    menu.push({ key: 'approvals', label: 'Approvals', icon: '✅' });
  if (canViewFleet(user))
    menu.push({ key: 'vehicles', label: 'Fleet', icon: '🚚' });
  if (canManageDrivers(user))
    menu.push({ key: 'drivers', label: 'Drivers', icon: '👤',
      sub: [
        { key: 'drivers-list',  label: 'Driver List' },
        { key: 'drivers-leave', label: 'Leave' },
      ]
    });
  if (canViewRates(user))
    menu.push({ key: 'rates', label: 'Client Rates', icon: '💰',
      sub: [
        { key: 'rates-list',   label: 'Rate List' },
        { key: 'rates-routes', label: 'Routes' },
      ]
    });
  if (canManageClients(user))
    menu.push({ key: 'clients', label: 'Clients', icon: '🏢' });
  if (canManageInvoices(user))
    menu.push({ key: 'invoices', label: 'Invoices', icon: '🧾' });
  if (canManageUsers(user))
    menu.push({ key: 'users', label: 'Users', icon: '👥' });
  return menu;
}

const PAGE_TITLES = {
  '': 'Overview',
  movement: 'Loads',
  vehicles: 'Fleet',
  'drivers-list': 'Drivers', 'drivers-leave': 'Driver Leave',
  clients: 'Clients', 'workshop-service': 'Service Cards',
  'workshop-maintenance': 'Maintenance', 'workshop-inventory': 'Inventory',
  approvals: 'Approvals', 'rates-list': 'Client Rates', 'rates-routes': 'Routes',
  users: 'Users', invoices: 'Invoices',
};

const ReadOnlyHome = () => (
  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'60vh', gap:16, textAlign:'center' }}>
    <div style={{ fontSize:56 }}>👁️</div>
    <div style={{ fontSize:22, fontWeight:700, color:'#005A8E' }}>Read-Only Access</div>
    <div style={{ fontSize:14, color:'#666', maxWidth:340, lineHeight:1.6 }}>
      Your account has read-only access. You can view information but cannot make any changes.
      Please contact your administrator if you need additional permissions.
    </div>
  </div>
);

export default function App() {
  const { user, logout } = useAuth();
  const [page, setPage] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState({});
  const MENU = user ? buildMenu(user) : [];

  const navigate = (key) => {
    setPage(key);
    setSidebarOpen(false); // close sidebar on nav (important for mobile)
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

  // Close sidebar on Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setSidebarOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!user) return <Login />;

  const toggleMenu = (key) => {
    setExpandedMenus(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const AccessDenied = () => (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'50vh', gap:12 }}>
      <div style={{ fontSize:48 }}>🔒</div>
      <div style={{ fontSize:20, fontWeight:700, color:'#e53e3e' }}>Access Denied</div>
      <div style={{ fontSize:14, color:'#aaa' }}>You do not have permission to view this page.</div>
    </div>
  );

  const renderPage = () => {
    if (user?.role === ROLES.READONLY) return <ReadOnlyHome />;

    switch (page) {
      case '':                    return <Dashboard onNavigate={navigate} />;
      case 'movement':            return canViewLoads(user) ? <Loads /> : <AccessDenied />;
      case 'approvals':           return canViewApprovals(user) ? <Approvals /> : <AccessDenied />;
      case 'vehicles':            return canViewFleet(user) ? <Fleet /> : <AccessDenied />;
      case 'drivers-list':        return canManageDrivers(user) ? <Drivers /> : <AccessDenied />;
      case 'workshop-service':    return canViewWorkshop(user) ? <ServiceCards /> : <AccessDenied />;
      case 'workshop-maintenance':return canViewWorkshop(user) ? <Maintenance /> : <AccessDenied />;
      case 'workshop-inventory':  return canViewWorkshop(user) ? <Inventory /> : <AccessDenied />;
      case 'rates-list':          return canViewRates(user) ? <Rates /> : <AccessDenied />;
      case 'clients':             return canManageClients(user) ? <Clients /> : <AccessDenied />;
      case 'users':               return canManageUsers(user) ? <Users /> : <AccessDenied />;
      case 'invoices':            return canManageInvoices(user) ? <Invoices /> : <AccessDenied />;
      case 'drivers-leave':
      case 'rates-routes': {
        const labels = { 'drivers-leave': 'Driver Leave', 'rates-routes': 'Routes' };
        return (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'50vh', gap:12 }}>
            <div style={{ fontSize:48 }}>🚧</div>
            <div style={{ fontSize:20, fontWeight:700, color:'#005A8E' }}>{labels[page]}</div>
            <div style={{ fontSize:14, color:'#aaa' }}>This page is coming soon.</div>
          </div>
        );
      }
      default: return <Dashboard onNavigate={navigate} />;
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#f5f7fa' }}>

      {/* ── Mobile overlay — tap to close sidebar ── */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 98,
          }}
        />
      )}

      {/* ── Sidebar ── */}
      <div style={{
        position: 'fixed', top: 0, left: 0, bottom: 0,
        width: 220, background: '#005A8E', color: 'white',
        display: 'flex', flexDirection: 'column',
        zIndex: 99,
        transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.22s ease',
        overflowX: 'hidden',
      }}>
        <div style={{ padding: '16px 12px 12px', borderBottom: '1px solid rgba(255,255,255,0.12)', flexShrink: 0 }}>
          <img src={LOGO} alt="Interland Distribution" style={{ width: '100%', maxHeight: 48, objectFit: 'contain' }} />
        </div>

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

      {/* ── Main (always full-width — sidebar overlays on top) ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Top bar */}
        <div style={{
          height: 52, background: 'white', borderBottom: '1px solid #e8edf2',
          display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12,
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)', flexShrink: 0,
        }}>
          {MENU.length > 0 && (
            <button onClick={() => setSidebarOpen(o => !o)} style={{
              background: 'none', border: 'none', cursor: 'pointer', color: '#005A8E',
              display: 'flex', alignItems: 'center', padding: 4,
            }}>
              {sidebarOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
          )}
          <span style={{ fontWeight: 600, fontSize: 16, color: '#1a202c' }}>
            {user?.role === ROLES.READONLY ? 'LogisticsPro' : (PAGE_TITLES[page] || 'Overview')}
          </span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: '#555' }}>🔔</span>
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
