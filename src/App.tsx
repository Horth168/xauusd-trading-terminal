import { lazy, Suspense, useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  BellRing, BookOpenText, CalendarDays, CandlestickChart, ChevronsLeft, ChevronsRight, Code2, FlaskConical, Landmark, Library, Loader2, Menu, Settings, WifiOff, X,
} from 'lucide-react';
import { feed } from './market/feed';
import { startScriptRegistry } from './indicators/registry';
import { startAlertEngine, useAlerts } from './alerts/engine';
import { useAuth } from './lib/db';
import { firebaseEnabled } from './lib/firebase';
import { useSettings } from './store/settings';
import { startSettingsSync } from './store/settingsSync';
import ChartPage from './pages/ChartPage';
import LoginPage from './pages/LoginPage';

const BacktestPage = lazy(() => import('./pages/BacktestPage'));
const JourneyPage = lazy(() => import('./pages/JourneyPage'));
const CashflowPage = lazy(() => import('./pages/CashflowPage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const StrategiesPage = lazy(() => import('./pages/StrategiesPage'));
const IndicatorsPage = lazy(() => import('./pages/IndicatorsPage'));
const AlertsPage = lazy(() => import('./pages/AlertsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

const NAV = [
  { to: '/', label: 'Chart', icon: CandlestickChart, mobile: true },
  { to: '/journey', label: 'My Trading Journey', short: 'Journey', icon: BookOpenText, mobile: true },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, mobile: true },
  { to: '/backtest', label: 'Backtest', icon: FlaskConical, mobile: true },
  { to: '/cashflow', label: 'Deposits & Withdrawals', short: 'Funds', icon: Landmark },
  { to: '/strategies', label: 'Strategy Library', short: 'Strategies', icon: Library },
  { to: '/indicators', label: 'My Indicators', short: 'Scripts', icon: Code2 },
  { to: '/alerts', label: 'Alerts', icon: BellRing },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false);
    window.addEventListener('online', a);
    window.addEventListener('offline', b);
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); };
  }, []);
  return on;
}

function Toasts() {
  const { toasts, dismiss } = useAlerts();
  return (
    <div className="pointer-events-none fixed right-3 top-[calc(var(--safe-top)+12px)] z-[60] flex w-80 max-w-[calc(100vw-24px)] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="animate-in pointer-events-auto rounded-lg border border-gold-600/40 bg-ink-850 p-3 shadow-2xl">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-gold-300">{t.title}</div>
              <div className="mt-0.5 text-xs text-ink-200">{t.body}</div>
            </div>
            <button className="text-ink-400 hover:text-ink-100" onClick={() => dismiss(t.id)}><X size={14} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const { user, ready } = useAuth();
  const collapsed = useSettings((s) => s.sidebarCollapsed);
  const set = useSettings((s) => s.set);
  const online = useOnline();
  const loc = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const needLogin = firebaseEnabled && ready && !user;

  useEffect(() => {
    if (needLogin || !ready) return;
    feed.start();
    startScriptRegistry();
    startAlertEngine();
    startSettingsSync();
  }, [needLogin, ready]);

  useEffect(() => setMoreOpen(false), [loc.pathname]);

  if (!ready) return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-gold-400" /></div>;
  if (needLogin) return <LoginPage />;

  const isChart = loc.pathname === '/';
  return (
    <div className="flex h-full flex-col pt-safe">
      {!online && (
        <div className="flex items-center justify-center gap-2 bg-down/15 px-3 py-1 text-xs text-down">
          <WifiOff size={13} /> Offline — no live prices. Saved journal records remain available and sync when you reconnect.
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {/* Desktop sidebar */}
        <nav className={`hidden shrink-0 flex-col border-r border-ink-700 bg-ink-900 pl-safe transition-[width] duration-200 md:flex ${collapsed ? 'w-14' : 'w-52'}`}>
          <div className="flex h-10 items-center gap-2 border-b border-ink-700 px-3">
            <img src="/icon.svg" alt="" className="h-6 w-6" />
            {!collapsed && <span className="truncate text-sm font-semibold text-ink-100">XAU Terminal</span>}
          </div>
          <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} title={n.label}
                className={({ isActive }) => `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${isActive ? 'bg-gold-500/10 text-gold-300' : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'}`}>
                <n.icon size={17} className="shrink-0" />
                {!collapsed && <span className="truncate">{n.label}</span>}
              </NavLink>
            ))}
          </div>
          <div className="border-t border-ink-700 p-2">
            {!collapsed && <div className="mb-1 truncate px-1 text-[11px] text-ink-400">{user ? user.email : firebaseEnabled ? '' : 'Local mode (this device only)'}</div>}
            <button className="btn-icon w-full" onClick={() => set({ sidebarCollapsed: !collapsed })} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
            </button>
          </div>
        </nav>

        <main className={`min-w-0 flex-1 ${isChart ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-gold-400" /></div>}>
            <Routes>
              <Route path="/" element={<ChartPage />} />
              <Route path="/journey" element={<div className="p-3 md:p-6"><JourneyPage /></div>} />
              <Route path="/calendar" element={<div className="p-3 md:p-6"><CalendarPage /></div>} />
              <Route path="/backtest" element={<div className="p-3 md:p-6"><BacktestPage /></div>} />
              <Route path="/cashflow" element={<div className="p-3 md:p-6"><CashflowPage /></div>} />
              <Route path="/strategies" element={<div className="p-3 md:p-6"><StrategiesPage /></div>} />
              <Route path="/indicators" element={<div className="p-3 md:p-6"><IndicatorsPage /></div>} />
              <Route path="/alerts" element={<div className="p-3 md:p-6"><AlertsPage /></div>} />
              <Route path="/settings" element={<div className="p-3 md:p-6"><SettingsPage /></div>} />
            </Routes>
          </Suspense>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="flex shrink-0 border-t border-ink-700 bg-ink-900 pb-safe md:hidden">
        {NAV.filter((n) => n.mobile).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${isActive ? 'text-gold-300' : 'text-ink-400'}`}>
            <n.icon size={19} />{n.short ?? n.label}
          </NavLink>
        ))}
        <button className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${moreOpen ? 'text-gold-300' : 'text-ink-400'}`} onClick={() => setMoreOpen(!moreOpen)}>
          <Menu size={19} />More
        </button>
      </nav>
      {moreOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="animate-in absolute bottom-[calc(56px+var(--safe-bottom))] left-2 right-2 grid grid-cols-3 gap-2 rounded-2xl border border-ink-700 bg-ink-850 p-3" onClick={(e) => e.stopPropagation()}>
            {NAV.filter((n) => !n.mobile).map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => `flex flex-col items-center gap-1 rounded-xl p-3 text-[11px] ${isActive ? 'bg-gold-500/10 text-gold-300' : 'text-ink-300'}`}>
                <n.icon size={20} />{n.short ?? n.label}
              </NavLink>
            ))}
          </div>
        </div>
      )}
      <Toasts />
    </div>
  );
}
