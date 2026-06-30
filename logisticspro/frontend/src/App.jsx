import { useState, useEffect, Component } from 'react';
import LOGO from '../assets/logo.png';
import { useAuth } from './lib/AuthContext';
import {
  canViewLoads, canViewFleet, canViewWorkshop, canViewRates,
  canManageClients, canManageDrivers, canManageUsers,
  canManageInvoices, canViewApprovals, canViewInventory, canViewFinance,
  canViewPOs,
  ROLES,
} from './lib/roles';
import Login from './pages/Login';
import Loads from './pages/Loads';
import Dashboard from './pages/Dashboard';
import Approvals from './pages/Approvals';
import Fleet from './pages/Fleet';
import Drivers, { DriverCellphones } from './pages/Drivers';
import Clients from './pages/Clients';
import Rates from './pages/Rates';
import Users from './pages/Users';
import { Maintenance } from './pages/Entities';
import FinanceGL      from './pages/FinanceGL';
import FinanceAssets  from './pages/FinanceAssets';
import FinanceAR      from './pages/FinanceAR';
import FinanceAP      from './pages/FinanceAP';
import FinanceVAT     from './pages/FinanceVAT';
import FinancePeriods  from './pages/FinancePeriods';
import FinanceCashbook from './pages/FinanceCashbook';
import ServiceCards from './pages/ServiceCards';
import InventoryPage from './pages/Inventory';
import PurchaseOrders from './pages/PurchaseOrders';

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

// ── Error boundary ──────────────────────────────────────────────
// Without this, an uncaught render error in ANY page component unmounts
// the entire app (sidebar, header, everything) instead of just that page.
// Keyed by `page` in the render below so switching pages resets it.
class PageErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Page crashed:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'50vh', gap:12, textAlign:'center', padding: 24 }}>
          <div style={{ fontSize:48 }}>⚠️</div>
          <div style={{ fontSize:20, fontWeight:700, color:'#c05621' }}>This page hit an error</div>
          <div style={{ fontSize:13, color:'#888', maxWidth:420 }}>{this.state.error.message || 'Something went wrong loading this page.'}</div>
          <button onClick={() => this.setState({ error: null })} style={{
            fontSize: 13, padding: '8px 16px', border: '1px solid #ddd', borderRadius: 6,
            background: 'white', cursor: 'pointer', color: '#555', marginTop: 8,
          }}>↻ Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Build menu dynamically based on user role
function buildMenu(user) {
  const menu = [];
  // READONLY gets a minimal menu — Loads view only
  if (user?.role === ROLES.READONLY) {
    menu.push({ key: 'movement', label: 'Loads', icon: '🚛' });
    return menu;
  }
  menu.push({ key: '', label: 'Home', icon: '🏠' });
  if (canViewLoads(user))
    menu.push({ key: 'movement', label: 'Loads', icon: '🚛' });
  if (canViewFleet(user))
    menu.push({ key: 'vehicles', label: 'Fleet', icon: '🚚' });
  if (canViewApprovals(user))
    menu.push({ key: 'approvals', label: 'Approvals', icon: '✅' });
  if (canViewWorkshop(user) || canViewInventory(user))
    menu.push({ key: 'workshop', label: 'Workshop', icon: '🔧',
      sub: [
        ...(canViewPOs(user)        ? [{ key: 'workshop-pos',         label: 'Purchase Orders' }] : []),
        ...(canViewWorkshop(user)   ? [{ key: 'workshop-service',     label: 'Service' }] : []),
        ...(canViewWorkshop(user)   ? [{ key: 'workshop-maintenance', label: 'Maintenance' }] : []),
        ...(canViewInventory(user)  ? [{ key: 'workshop-inventory',   label: 'Inventory' }] : []),
      ]
    });
  if (canManageDrivers(user))
    menu.push({ key: 'drivers', label: 'Drivers', icon: '👤',
      sub: [
        { key: 'drivers-list',       label: 'Driver List' },
        { key: 'drivers-cellphones', label: 'Cellphones' },
        { key: 'drivers-leave',      label: 'Leave' },
      ]
    });
  if (canManageClients(user))
    menu.push({ key: 'clients-list', label: 'Clients', icon: '🏢' });
  if (canViewRates(user))
    menu.push({ key: 'rates', label: 'Client Rates', icon: '💰',
      sub: [
        { key: 'rates-list',   label: 'Rate List' },
      ]
    });
  if (canViewFinance(user) || canManageInvoices(user))
    menu.push({ key: 'finance', label: 'Finance', icon: '💰',
      sub: [
        { key: 'finance-gl',        label: 'GL / Chart of Accounts' },
        { key: 'finance-cashbook',  label: 'Cash Book' },
        { key: 'finance-ar',        label: 'Accounts Receivable' },
        { key: 'finance-ap',        label: 'Accounts Payable' },
        { key: 'finance-assets',    label: 'Fixed Assets' },
        { key: 'finance-vat',       label: 'VAT Returns' },
        { key: 'finance-periods',   label: 'Period Management' },
      ]
    });
  if (canManageUsers(user))
    menu.push({ key: 'users', label: 'Users', icon: '👥' });
  return menu;
}

const PAGE_TITLES = {
  '': 'Overview',
  movement: 'Loads',
  vehicles: 'Fleet',
  'drivers-list': 'Drivers', 'drivers-leave': 'Driver Leave', 'drivers-cellphones': 'Cellphones',
  'clients-list': 'Customers',
  'workshop-service': 'Service Cards', 'workshop-maintenance': 'Maintenance',
  'workshop-inventory': 'Inventory', 'workshop-pos': 'Purchase Orders',
  approvals: 'Approvals', 'rates-list': 'Client Rates',
  users: 'Users',
  'finance-gl':'GL / Chart of Accounts',
  'finance-cashbook':'Cash Book','finance-ar':'Accounts Receivable','finance-ap':'Accounts Payable',
  'finance-assets':'Fixed Assets','finance-vat':'VAT Returns','finance-periods':'Period Management',
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
  const [pendingLoadNo, setPendingLoadNo] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState({});
  const MENU = user ? buildMenu(user) : [];

  // opts.loadNo lets callers (e.g. clicking a horse's active load on the
  // Fleet page) deep-link straight into a specific load on the Loads page.
  // Normal sidebar navigation calls this with no opts, which clears it.
  const navigate = (key, opts = {}) => {
    setPage(key);
    setPendingLoadNo(opts.loadNo || null);
    setSidebarOpen(false);
    MENU.forEach(item => {
      if (item.sub && item.sub.find(s => s.key === key)) {
        setExpandedMenus(prev => ({ ...prev, [item.key]: true }));
      }
    });
  };

  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.page) navigate(e.detail.page, { loadNo: e.detail.loadNo });
    };
    window.addEventListener('lp-navigate', handler);
    return () => window.removeEventListener('lp-navigate', handler);
  }, []);

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
    switch (page) {
      case '':                    return user?.role === ROLES.READONLY ? <ReadOnlyHome /> : <Dashboard onNavigate={navigate} />;
      case 'movement':            return canViewLoads(user) ? <Loads initialLoadNo={pendingLoadNo} /> : <AccessDenied />;
      case 'approvals':           return canViewApprovals(user) ? <Approvals /> : <AccessDenied />;
      case 'vehicles':            return canViewFleet(user) ? <Fleet /> : <AccessDenied />;
      case 'drivers-list':        return canManageDrivers(user) ? <Drivers /> : <AccessDenied />;
      case 'drivers-cellphones':  return canManageDrivers(user) ? <DriverCellphones /> : <AccessDenied />;
      case 'workshop-service':    return canViewWorkshop(user) ? <ServiceCards /> : <AccessDenied />;
      case 'workshop-maintenance':return canViewWorkshop(user) ? <Maintenance /> : <AccessDenied />;
      case 'workshop-inventory':  return canViewInventory(user) ? <InventoryPage /> : <AccessDenied />;
      case 'workshop-pos':        return canViewPOs(user) ? <PurchaseOrders /> : <AccessDenied />;
      case 'rates-list':          return canViewRates(user) ? <Rates /> : <AccessDenied />;
      case 'clients-list':        return canManageClients(user) ? <Clients /> : <AccessDenied />;
      case 'users':               return canManageUsers(user) ? <Users /> : <AccessDenied />;
      case 'finance-gl':      return canViewFinance(user) ? <FinanceGL /> : <AccessDenied />;
      case 'finance-cashbook': return canViewFinance(user) ? <FinanceCashbook /> : <AccessDenied />;
      case 'finance-ar':      return canViewFinance(user) ? <FinanceAR /> : <AccessDenied />;
      case 'finance-ap':      return canViewFinance(user) ? <FinanceAP /> : <AccessDenied />;
      case 'finance-assets':  return canViewFinance(user) ? <FinanceAssets /> : <AccessDenied />;
      case 'finance-vat':     return canViewFinance(user) ? <FinanceVAT /> : <AccessDenied />;
      case 'finance-periods': return canViewFinance(user) ? <FinancePeriods user={user} /> : <AccessDenied />;
      case 'drivers-leave': {
        const labels = { 'drivers-leave': 'Driver Leave' };
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
    <div style={{ display: 'flex', height: '100dvh', overflow: 'hidden', background: '#f5f7fa' }}>

      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 98,
          }}
        />
      )}

      <div style={{
        position: 'fixed', top: 0, left: 0, bottom: 0,
        width: 'min(280px, 85vw)', background: '#005A8E', color: 'white',
        display: 'flex', flexDirection: 'column',
        zIndex: 99,
        boxShadow: '4px 0 24px rgba(0,0,0,0.35)',
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

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

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

        <div className="main-content" style={{ flex: 1, overflowY: 'auto' }}>
          <PageErrorBoundary key={page}>
            {renderPage()}
          </PageErrorBoundary>
        </div>
      </div>
    </div>
  );
}
