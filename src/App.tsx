import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import {
  BellRing, BookOpenText, CalendarDays, CandlestickChart, ChevronsLeft, ChevronsRight, Code2, FlaskConical, Landmark, Library, Loader2,
  LogOut, Menu, Settings, WifiOff, X, type LucideIcon,
} from 'lucide-react';
import { feed } from './market/feed';
import { startScriptRegistry } from './indicators/registry';
import { startAlertEngine, useAlerts } from './alerts/engine';
import { useAuth } from './lib/db';
import { auth, firebaseEnabled } from './lib/firebase';
import { useSettings } from './store/settings';
import { startSettingsSync } from './store/settingsSync';
import { FeedBadge } from './components/FeedStatus';
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

interface NavItem { to: string; label: string; short?: string; icon: LucideIcon; mobile?: boolean }
const SECTIONS: { title: string; items: NavItem[] }[] = [
  { title: 'Trade', items: [
    { to: '/', label: 'Chart', icon: CandlestickChart, mobile: true },
    { to: '/backtest', label: 'Strategy Tester', short: 'Backtest', icon: FlaskConical, mobile: true },
    { to: '/alerts', label: 'Alerts', icon: BellRing },
  ] },
  { title: 'Journal', items: [
    { to: '/journey', label: 'My Trading Journey', short: 'Journey', icon: BookOpenText, mobile: true },
    { to: '/calendar', label: 'Calendar', icon: CalendarDays, mobile: true },
    { to: '/cashflow', label: 'Deposits & Withdrawals', short: 'Funds', icon: Landmark },
  ] },
  { title: 'Build', items: [
    { to: '/strategies', label: 'Strategy Library', short: 'Strategies', icon: Library },
    { to: '/indicators', label: 'My Indicators', short: 'Scripts', icon: Code2 },
    { to: '/settings', label: 'Settings', icon: Settings },
  ] },
];
const NAV = SECTIONS.flatMap((s) => s.items);
const MOBILE_TABS = ['/', '/journey', '/calendar', '/backtest'].map((p) => NAV.find((n) => n.to === p)!);

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

function Avatar({ size = 32 }: { size?: number }) {
  const user = useAuth((s) => s.user);
  const label = (user?.displayName || user?.email || 'Trader').trim()[0]?.toUpperCase();
  if (user?.photoURL) return <img src={user.photoURL} alt="" referrerPolicy="no-referrer" className="rounded-full object-cover ring-1 ring-white/10" style={{ width: size, height: size }} />;
  return <span className="flex items-center justify-center rounded-full bg-gradient-to-br from-gold-400 to-gold-600 font-semibold text-ink-950" style={{ width: size, height: size, fontSize: size * 0.42 }}>{label}</span>;
}

function AccountMenu({ align = 'up', onClose }: { align?: 'up' | 'down'; onClose: () => void }) {
  const user = useAuth((s) => s.user);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    setTimeout(() => window.addEventListener('pointerdown', h), 0);
    return () => window.removeEventListener('pointerdown', h);
  }, [onClose]);
  return (
    <div ref={ref} className={`animate-in absolute z-50 w-64 rounded-2xl border border-white/10 bg-ink-800/95 p-1.5 shadow-2xl backdrop-blur-xl ${align === 'up' ? 'bottom-full left-0 mb-2' : 'right-0 top-full mt-2'}`}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Avatar size={36} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-ink-100">{user?.displayName || 'Trader'}</div>
          <div className="truncate text-xs text-ink-400">{user?.email ?? 'Local mode — this device only'}</div>
        </div>
      </div>
      <div className="my-1 h-px bg-white/5" />
      <NavLink to="/settings" onClick={onClose} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-ink-200 transition-colors hover:bg-white/5"><Settings size={16} /> Settings</NavLink>
      {user && <button onClick={() => { onClose(); signOut(auth!); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-down transition-colors hover:bg-down/10"><LogOut size={16} /> Sign out</button>}
    </div>
  );
}

function Toasts() {
  const { toasts, dismiss } = useAlerts();
  return (
    <div className="pointer-events-none fixed right-3 top-[calc(var(--safe-top)+12px)] z-[60] flex w-80 max-w-[calc(100vw-24px)] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="animate-in pointer-events-auto rounded-2xl border border-gold-600/30 bg-ink-800/95 p-3.5 shadow-2xl backdrop-blur-xl">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-gold-300">{t.title}</div>
              <div className="mt-0.5 text-sm text-ink-200">{t.body}</div>
            </div>
            <button className="btn-icon h-6 w-6" onClick={() => dismiss(t.id)}><X size={14} /></button>
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
  const [menu, setMenu] = useState<'side' | 'top' | null>(null);
  const needLogin = firebaseEnabled && ready && !user;

  useEffect(() => {
    if (needLogin || !ready) return;
    feed.start();
    startScriptRegistry();
    startAlertEngine();
    startSettingsSync();
  }, [needLogin, ready]);

  useEffect(() => { setMoreOpen(false); setMenu(null); }, [loc.pathname]);

  if (!ready) return <div className="flex h-full items-center justify-center"><img src="/icon.svg" alt="" className="h-12 w-12 animate-pulse" /></div>;
  if (needLogin) return <LoginPage />;

  const isChart = loc.pathname === '/';
  const current = NAV.find((n) => (n.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.to)));
  const moreActive = !MOBILE_TABS.some((t) => t.to === current?.to);

  return (
    <div className="flex h-full flex-col bg-ink-950">
      {/* Mobile top app bar (non-chart pages) — sits under the status bar / Dynamic Island */}
      <header className={`shrink-0 border-b border-white/5 bg-ink-900/90 pt-safe backdrop-blur-xl md:hidden ${isChart ? 'bg-ink-900' : ''}`}>
        {!isChart && (
          <div className="relative flex h-12 items-center justify-between px-4">
            <div className="flex items-center gap-2.5">
              <img src="/icon.svg" alt="" className="h-6 w-6" />
              <span className="text-[15px] font-semibold text-ink-100">{current?.short ?? current?.label}</span>
            </div>
            <div className="flex items-center gap-3">
              <FeedBadge compact />
              <button onClick={() => setMenu(menu === 'top' ? null : 'top')} aria-label="Account"><Avatar size={30} /></button>
              {menu === 'top' && <AccountMenu align="down" onClose={() => setMenu(null)} />}
            </div>
          </div>
        )}
      </header>

      {!online && (
        <div className="flex shrink-0 items-center justify-center gap-2 bg-down/15 px-3 py-1.5 text-xs text-down md:pt-safe">
          <WifiOff size={13} /> Offline — no live prices. Your saved journal is still available and will sync later.
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Desktop sidebar */}
        <nav className={`hidden shrink-0 flex-col border-r border-white/5 bg-ink-900 pl-safe pt-safe transition-[width] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] md:flex ${collapsed ? 'w-[68px]' : 'w-60'}`}>
          <div className={`flex h-14 items-center gap-2.5 ${collapsed ? 'justify-center' : 'px-4'}`}>
            <img src="/icon.svg" alt="" className="h-7 w-7 shrink-0" />
            {!collapsed && <span className="truncate text-[15px] font-semibold tracking-tight text-ink-100">XAU Terminal</span>}
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {SECTIONS.map((sec) => (
              <div key={sec.title} className="mt-3 first:mt-1">
                {!collapsed ? <div className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-500">{sec.title}</div> : <div className="mx-auto my-2 h-px w-6 bg-white/5" />}
                <div className="space-y-0.5">
                  {sec.items.map((n) => (
                    <NavLink key={n.to} to={n.to} end={n.to === '/'} title={collapsed ? n.label : undefined}
                      className={({ isActive }) => `group relative flex h-10 items-center gap-3 rounded-xl text-sm transition-all duration-150 ${collapsed ? 'justify-center' : 'px-3'} ${isActive ? 'bg-gold-500/10 font-medium text-gold-300' : 'text-ink-300 hover:bg-white/[0.04] hover:text-ink-100'}`}>
                      {({ isActive }) => (<>
                        {isActive && <span className="absolute left-0 top-2 h-6 w-[3px] rounded-r-full bg-gold-400" />}
                        <n.icon size={18} className="shrink-0" />
                        {!collapsed && <span className="truncate">{n.label}</span>}
                      </>)}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="relative border-t border-white/5 p-3 pb-[calc(12px+var(--safe-bottom))]">
            {menu === 'side' && <AccountMenu onClose={() => setMenu(null)} />}
            <div className={`flex items-center gap-2 ${collapsed ? 'flex-col' : ''}`}>
              <button onClick={() => setMenu(menu === 'side' ? null : 'side')} className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1.5 text-left transition-colors hover:bg-white/[0.04] ${collapsed ? 'justify-center' : ''}`}>
                <Avatar size={30} />
                {!collapsed && <div className="min-w-0"><div className="truncate text-sm font-medium text-ink-100">{user?.displayName || 'Trader'}</div><div className="truncate text-[11px] text-ink-400">{user?.email ?? 'Local mode'}</div></div>}
              </button>
              <button className="btn-icon shrink-0" onClick={() => set({ sidebarCollapsed: !collapsed })} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
                {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
              </button>
            </div>
          </div>
        </nav>

        <main className={`min-w-0 flex-1 ${isChart ? 'overflow-hidden' : 'overflow-y-auto overscroll-contain'} md:pt-safe`}>
          <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-gold-400" /></div>}>
            <div key={loc.pathname} className={isChart ? 'h-full' : 'animate-in px-4 pb-8 pt-4 md:px-8 md:pb-10 md:pt-7'}>
              <Routes>
                <Route path="/" element={<ChartPage />} />
                <Route path="/journey" element={<JourneyPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/backtest" element={<BacktestPage />} />
                <Route path="/cashflow" element={<CashflowPage />} />
                <Route path="/strategies" element={<StrategiesPage />} />
                <Route path="/indicators" element={<IndicatorsPage />} />
                <Route path="/alerts" element={<AlertsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </div>
          </Suspense>
        </main>
      </div>

      {/* Mobile tab bar — docked to the bottom edge, extends under the home indicator */}
      <nav className="relative z-40 shrink-0 border-t border-white/[0.06] bg-ink-900/95 pb-safe backdrop-blur-xl md:hidden">
        <div className="flex h-[58px] items-stretch">
          {MOBILE_TABS.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `group flex flex-1 flex-col items-center justify-center gap-1 transition-colors ${isActive ? 'text-gold-300' : 'text-ink-400 active:text-ink-200'}`}>
              {({ isActive }) => (<>
                <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-all duration-300 ${isActive ? 'bg-gold-500/15' : 'group-active:scale-90'}`}><n.icon size={20} strokeWidth={isActive ? 2.2 : 1.8} /></span>
                <span className="text-[10.5px] font-medium">{n.short ?? n.label}</span>
              </>)}
            </NavLink>
          ))}
          <button className={`group flex flex-1 flex-col items-center justify-center gap-1 transition-colors ${moreOpen || moreActive ? 'text-gold-300' : 'text-ink-400'}`} onClick={() => setMoreOpen(!moreOpen)}>
            <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-all duration-300 ${moreOpen || moreActive ? 'bg-gold-500/15' : 'group-active:scale-90'}`}><Menu size={20} /></span>
            <span className="text-[10.5px] font-medium">More</span>
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="animate-fade fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="animate-sheet absolute inset-x-0 bottom-0 rounded-t-[28px] border-t border-white/10 bg-ink-850 px-4 pb-[calc(20px+var(--safe-bottom))] pt-3" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink-600" />
            <div className="grid grid-cols-3 gap-2">
              {NAV.filter((n) => !MOBILE_TABS.includes(n)).map((n) => (
                <NavLink key={n.to} to={n.to} className={({ isActive }) => `flex flex-col items-center gap-2 rounded-2xl px-2 py-4 text-xs font-medium transition-all active:scale-95 ${isActive ? 'bg-gold-500/10 text-gold-300' : 'bg-white/[0.03] text-ink-200'}`}>
                  <n.icon size={22} />{n.short ?? n.label}
                </NavLink>
              ))}
            </div>
            {user && (
              <button onClick={() => signOut(auth!)} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white/[0.03] text-sm font-medium text-down active:scale-[0.98]"><LogOut size={16} /> Sign out</button>
            )}
          </div>
        </div>
      )}
      <Toasts />
    </div>
  );
}
