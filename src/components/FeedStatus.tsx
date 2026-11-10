import { useEffect, useRef, useState } from 'react';
import { useFeed } from '../market/feed';
import { useSettings } from '../store/settings';
import { fmtTime, sessionState, TIMEZONES, goldMarketLikelyOpen } from '../lib/time';
import { num } from '../lib/format';

const STATE_STYLE: Record<string, { dot: string; label: string }> = {
  live: { dot: 'bg-up', label: 'LIVE' },
  delayed: { dot: 'bg-gold-400', label: 'DELAYED' },
  connecting: { dot: 'bg-ink-400 animate-pulse', label: 'CONNECTING' },
  reconnecting: { dot: 'bg-gold-500 animate-pulse', label: 'RECONNECTING' },
  offline: { dot: 'bg-down', label: 'OFFLINE' },
  error: { dot: 'bg-down', label: 'ERROR' },
};

export function FeedBadge({ compact = false }: { compact?: boolean }) {
  const status = useFeed((s) => s.status);
  const st = STATE_STYLE[status.state];
  const detail = 'detail' in status ? status.detail : 'Connecting to data source…';
  return (
    <div className="flex min-w-0 items-center gap-1.5" title={detail}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} />
      <span className="text-[11px] font-semibold tracking-wide text-ink-200">{st.label}</span>
      {!compact && <span className="truncate text-[11px] text-ink-400">{detail}</span>}
    </div>
  );
}

export function PriceTicker() {
  const tick = useFeed((s) => s.tick);
  const prev = useFeed((s) => s.prevBid);
  const digits = useFeed((s) => s.symbol.digits);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !tick || prev == null || tick.bid === prev) return;
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth;
    el.classList.add(tick.bid > prev ? 'flash-up' : 'flash-down');
  }, [tick, prev]);
  if (!tick) return <span className="font-mono text-sm text-ink-400">—</span>;
  const spread = tick.ask != null ? (tick.ask - tick.bid) * 10 ** digits : null;
  return (
    <div className="flex items-center gap-2 font-mono text-xs">
      <span ref={ref} className={`rounded px-1 text-sm font-semibold ${prev != null && tick.bid < prev ? 'text-down' : 'text-up'}`}>{num(tick.bid, digits)}</span>
      {tick.ask != null ? (
        <>
          <span className="text-ink-400">Bid</span>
          <span className="text-[#2f9bff]">{num(tick.ask, digits)}</span>
          <span className="text-ink-400">Ask · {spread!.toFixed(0)} pts</span>
        </>
      ) : <span className="text-ink-400">last close · bid/ask n/a</span>}
    </div>
  );
}

export function StatusBar() {
  const tz = useSettings((s) => s.timezone);
  const set = useSettings((s) => s.set);
  const lastUpdate = useFeed((s) => s.lastUpdate);
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => { const id = setInterval(() => setNow(Date.now() / 1000), 1000); return () => clearInterval(id); }, []);
  const sessions = sessionState(now);
  const marketOpen = goldMarketLikelyOpen(now);
  return (
    <div className="flex h-7 shrink-0 items-center gap-3 overflow-x-auto border-t border-ink-700 bg-ink-900 px-2 text-[11px] text-ink-400">
      <div className="hidden min-w-0 max-w-[45%] shrink md:block"><FeedBadge /></div>
      <div className="shrink-0 md:hidden"><FeedBadge compact /></div>
      {lastUpdate && <span className="shrink-0">updated {fmtTime(lastUpdate / 1000, tz, true)}</span>}
      <span className="shrink-0">{marketOpen ? 'Gold market hours' : 'Gold market likely closed'}</span>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {sessions.map((s) => (
          <span key={s.name} className="flex items-center gap-1" title={`${s.name}: ${fmtTime(s.openAt, tz)}–${fmtTime(s.closeAt, tz)} (${tz})`}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.isOpen ? s.color : '#3a3a43' }} />
            <span className={s.isOpen ? 'text-ink-200' : ''}>{s.name}</span>
          </span>
        ))}
        <span className="font-mono text-ink-200">{fmtTime(now, tz, true)}</span>
        <select className="rounded bg-ink-800 px-1 py-0.5 text-ink-200 outline-none" value={tz} onChange={(e) => set({ timezone: e.target.value })} aria-label="Chart timezone">
          {TIMEZONES.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
        </select>
      </div>
    </div>
  );
}
