import { Link, useNavigate } from 'react-router-dom';
import { Bell, BellOff, Bot, ChevronRight, Loader2, RefreshCw, Server, Sparkles } from 'lucide-react';
import { useFeed } from '../market/feed';
import { useSettings } from '../store/settings';
import { useLiveAnalysis } from '../ai/ui/useLiveAnalysis';
import { BiasPill, DecisionBadge, PlanCard, ScoreBars, StatusBadge } from '../ai/ui/components';
import { FeedBadge } from '../components/FeedStatus';
import { fmtDateTime, fmtTime } from '../lib/time';
import { num } from '../lib/format';
import { reportSummary } from '../ai/explain';
import { useAiOverlay } from '../ai/ui/overlayStore';

function Tile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`mt-1 truncate text-lg font-semibold tabular-nums ${tone ?? 'text-ink-100'}`}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-ink-400">{sub}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const nav = useNavigate();
  const tz = useSettings((s) => s.timezone);
  const tick = useFeed((s) => s.tick);
  const prev = useFeed((s) => s.prevBid);
  const status = useFeed((s) => s.status);
  const digits = useFeed((s) => s.symbol.digits);
  const a = useLiveAnalysis();
  const r = a.report;
  const lastConfirmed = a.signals.find((s) => s.status === 'CONFIRMED' || s.outcome !== 'PENDING_ENTRY');
  const notifOn = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  const spread = tick?.ask != null ? tick.ask - tick.bid : null;
  const m15 = r?.candidates.filter((c) => c.status !== 'WATCHING').map((c) => `${c.strategy} ${c.side}`)[0];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {/* Price header */}
      <div className="card relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-gold-500/10 blur-3xl" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-ink-300">XAUUSD <span className="text-ink-500">· Gold</span></div>
            <div className={`mt-1 text-4xl font-bold tabular-nums tracking-tight ${tick && prev != null && tick.bid < prev ? 'text-down' : 'text-ink-100'}`}>{tick ? num(tick.bid, Math.min(digits, 3)) : '—'}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-sm text-ink-300">
              <span>Bid <b className="text-ink-100">{tick ? num(tick.bid, Math.min(digits, 3)) : '—'}</b></span>
              <span>Ask <b className="text-[#7cc0ff]">{tick?.ask != null ? num(tick.ask, Math.min(digits, 3)) : 'n/a'}</b></span>
              <span>Spread <b className="text-ink-100">{spread != null ? `${num(spread, Math.min(digits, 3))} (${Math.round(spread * 10 ** digits)} pts)` : 'n/a'}</b></span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <FeedBadge />
            <button className="btn" onClick={a.run} disabled={a.running}>{a.running ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Analyze now</button>
          </div>
        </div>
        {status.state !== 'live' && <p className="mt-3 rounded-xl bg-gold-500/10 px-3 py-2 text-xs text-gold-300">Not on live Exness data — analysis is informational and cannot confirm an entry.</p>}
      </div>

      {/* Bias & status tiles */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <BiasPill tf="H4" label="trend" bias={r?.biases.H4} />
        <BiasPill tf="H1" label="bias" bias={r?.biases.H1} />
        <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-2.5"><div className="text-[11px] font-medium uppercase tracking-wider text-ink-400">M15 · setup</div><div className="mt-1 truncate text-sm font-semibold text-ink-100">{m15 ?? 'No setup forming'}</div></div>
        <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-2.5"><div className="text-[11px] font-medium uppercase tracking-wider text-ink-400">{r?.entryTf ?? 'M5'} · entry</div><div className="mt-1 flex items-center gap-2">{r ? <StatusBadge status={r.status} /> : <span className="text-sm text-ink-400">—</span>}</div></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* AI signal status */}
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-semibold text-ink-100"><Sparkles size={18} className="text-gold-400" /> AI signal status</h2>
            <span className="text-[11px] text-ink-400">{a.origin ?? '—'}{r ? ` · ${fmtTime(r.createdAt, tz)}` : ''}</span>
          </div>
          {!r ? (
            <p className="text-sm text-ink-400">{a.error ?? (a.running ? 'Analyzing…' : 'Waiting for market data.')}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <DecisionBadge decision={r.decision} large />
                <div className="min-w-0 flex-1 text-sm text-ink-300">{reportSummary(r)}</div>
              </div>
              {r.plan && r.decision !== 'WAIT' && <div className="mt-4 rounded-2xl border border-gold-500/20 bg-gold-500/[0.04] p-3"><PlanCard plan={r.plan} digits={r.market.digits} /></div>}
              {r.decision === 'WAIT' && r.waitReasons.length > 1 && (
                <ul className="mt-3 space-y-1">{r.waitReasons.slice(1, 4).map((w, i) => <li key={i} className="text-sm text-ink-400">• {w}</li>)}</ul>
              )}
              <div className="mt-4"><ScoreBars score={r.score} min={r.minScore} /></div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/ai" className="btn-gold"><Bot size={15} /> Full AI analysis</Link>
                <button className="btn" onClick={() => { useAiOverlay.getState().show(r); nav('/chart'); }}>Show on chart</button>
              </div>
            </>
          )}
        </div>

        <div className="space-y-4">
          {/* latest signal */}
          <div className="card p-5">
            <h2 className="mb-3 font-semibold text-ink-100">Latest confirmed signal</h2>
            {lastConfirmed ? (
              <button className="w-full text-left" onClick={() => nav(`/signals/${encodeURIComponent(lastConfirmed.id)}`)}>
                <div className="flex items-center gap-2"><DecisionBadge decision={lastConfirmed.side} /><StatusBadge status={lastConfirmed.status === 'CONFIRMED' ? lastConfirmed.outcome : lastConfirmed.status} /><span className="ml-auto text-xs text-ink-400">{fmtDateTime(lastConfirmed.createdAt, tz)}</span></div>
                <div className="mt-2 font-mono text-sm text-ink-200">Entry {num(lastConfirmed.plan.entryLow)}–{num(lastConfirmed.plan.entryHigh)} · SL {num(lastConfirmed.plan.sl)} · TP1 {num(lastConfirmed.plan.tp1)}</div>
                <div className="mt-1 flex items-center justify-between text-xs text-ink-400"><span>{lastConfirmed.strategyName} · {lastConfirmed.entryTf} · score {lastConfirmed.score.total}</span><ChevronRight size={16} /></div>
              </button>
            ) : <p className="text-sm text-ink-400">No confirmed signals yet. The analyst only confirms when every mandatory rule is met — waiting is normal.</p>}
          </div>
          {/* system status */}
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Background scanner" value={a.scannerOnline ? 'Online' : 'Offline'} tone={a.scannerOnline ? 'text-up' : 'text-ink-300'} sub={a.scanner?.lastScan ? `last scan ${fmtTime(a.scanner.lastScan, tz)}` : 'not running'} />
            <Tile label="Notifications" value={notifOn ? 'Enabled' : 'Off'} tone={notifOn ? 'text-up' : 'text-ink-300'} sub={<Link to="/notifications" className="text-gold-400">{notifOn ? 'settings' : 'enable'}</Link>} />
            <Tile label="Last analysis" value={r ? fmtTime(r.createdAt, tz) : '—'} sub={r ? `candle ${fmtTime(r.barTime, tz)}` : ''} />
            <Tile label="Data source" value={r?.market.source === 'mt5' ? 'Exness MT5' : r?.market.source === 'twelvedata' ? 'Twelve Data' : '—'} tone={r?.market.live ? 'text-up' : 'text-gold-300'} sub={r?.market.live ? 'live' : 'not live'} />
          </div>
          {!a.scannerOnline && (
            <Link to="/notifications" className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-3 text-sm text-ink-300 transition-colors hover:bg-white/[0.05]">
              <Server size={18} className="text-gold-400" /><span className="flex-1">Start the background scanner to get signals while the app is closed.</span>{notifOn ? <Bell size={16} /> : <BellOff size={16} />}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
