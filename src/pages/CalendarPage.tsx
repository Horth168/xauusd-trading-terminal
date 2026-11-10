import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Trophy, TrendingDown } from 'lucide-react';
import { PageHeader, Stat } from '../components/ui';
import { useCollection } from '../lib/db';
import { useSettings } from '../store/settings';
import { dailyPnl, netOf, summarize, type JournalTrade } from '../journal/stats';
import { TradeForm } from '../journal/TradeForm';
import { dayKey, fmtTime } from '../lib/time';
import { pct, pnlClass, signedUsd } from '../lib/format';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function CalendarPage() {
  const tz = useSettings((s) => s.timezone);
  const trades = useCollection<JournalTrade>('trades');
  const today = dayKey(Date.now() / 1000, tz);
  const [ym, setYm] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string | null>(today);
  const [editing, setEditing] = useState<Partial<JournalTrade> | null>(null);

  const days = useMemo(() => new Map(dailyPnl(trades.items, tz).map((d) => [d.day, d])), [trades.items, tz]);
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: dim }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  const monthTrades = trades.items.filter((t) => dayKey(t.date, tz).startsWith(ym));
  const ms = summarize(monthTrades, tz);
  const monthDays = [...days.values()].filter((d) => d.day.startsWith(ym));
  const greenDays = monthDays.filter((d) => d.pnl > 0).length, redDays = monthDays.filter((d) => d.pnl < 0).length;
  const maxAbs = Math.max(1, ...monthDays.map((d) => Math.abs(d.pnl)));
  const shift = (k: number) => { const d = new Date(Date.UTC(y, m - 1 + k, 1)); setYm(d.toISOString().slice(0, 7)); };
  const dayTrades = selected ? trades.items.filter((t) => dayKey(t.date, tz) === selected).sort((a, b) => a.date - b.date) : [];
  const allBest = useMemo(() => [...days.values()].sort((a, b) => b.pnl - a.pnl).slice(0, 3), [days]);
  const allWorst = useMemo(() => [...days.values()].sort((a, b) => a.pnl - b.pnl).slice(0, 3), [days]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Trading Calendar" subtitle={`Daily net P&L in ${tz}`} actions={
        <div className="flex items-center gap-1">
          <button className="btn-icon" onClick={() => shift(-1)}><ChevronLeft size={16} /></button>
          <span className="w-32 text-center text-sm font-semibold text-ink-100">{first.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</span>
          <button className="btn-icon" onClick={() => shift(1)}><ChevronRight size={16} /></button>
          <button className="btn ml-2" onClick={() => setYm(today.slice(0, 7))}>Today</button>
        </div>} />

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="Month net P&L" value={signedUsd(ms.netPnl)} tone={ms.netPnl >= 0 ? 'up' : 'down'} />
        <Stat label="Trades" value={ms.totalTrades} sub={`win rate ${pct(ms.winRate)}`} />
        <Stat label="Green / red days" value={`${greenDays} / ${redDays}`} />
        <Stat label="Best day" value={ms.bestDay ? signedUsd(ms.bestDay.pnl) : '—'} sub={ms.bestDay?.day} tone="up" />
        <Stat label="Worst day" value={ms.worstDay ? signedUsd(ms.worstDay.pnl) : '—'} sub={ms.worstDay?.day} tone="down" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="card overflow-hidden p-2">
          <div className="grid grid-cols-[repeat(7,1fr)_minmax(64px,90px)] gap-1 text-center text-[11px] text-ink-400">
            {DOW.map((d) => <div key={d} className="py-1">{d}</div>)}<div className="py-1">Week</div>
          </div>
          {weeks.map((w, wi) => {
            const wk = w.filter(Boolean).map((d) => days.get(d!)).filter(Boolean) as { pnl: number; count: number }[];
            const wpnl = wk.reduce((a, d) => a + d.pnl, 0), wcount = wk.reduce((a, d) => a + d.count, 0);
            return (
              <div key={wi} className="mt-1 grid grid-cols-[repeat(7,1fr)_minmax(64px,90px)] gap-1">
                {w.map((d, i) => {
                  if (!d) return <div key={i} />;
                  const v = days.get(d);
                  const intensity = v ? 0.12 + 0.5 * (Math.abs(v.pnl) / maxAbs) : 0;
                  const bg = v ? (v.pnl > 0 ? `rgba(34,176,125,${intensity})` : v.pnl < 0 ? `rgba(229,72,77,${intensity})` : 'rgba(255,255,255,0.05)') : undefined;
                  return (
                    <button key={d} onClick={() => setSelected(d)} style={{ background: bg }}
                      className={`flex min-h-[64px] flex-col rounded-md border p-1.5 text-left transition-colors sm:min-h-[78px] ${selected === d ? 'border-gold-500' : 'border-ink-800 hover:border-ink-600'} ${d === today ? 'ring-1 ring-gold-600/40' : ''}`}>
                      <span className="text-[11px] text-ink-300">{Number(d.slice(8))}</span>
                      {v && <>
                        <span className={`mt-auto font-mono text-[11px] font-semibold sm:text-xs ${pnlClass(v.pnl)}`}>{signedUsd(v.pnl).replace('.00', '')}</span>
                        <span className="text-[10px] text-ink-300">{v.count} trade{v.count > 1 ? 's' : ''}</span>
                      </>}
                    </button>
                  );
                })}
                <div className="flex flex-col justify-center rounded-md bg-ink-900 p-1.5 text-right">
                  <span className={`font-mono text-[11px] font-semibold ${pnlClass(wpnl)}`}>{wcount ? signedUsd(wpnl).replace('.00', '') : '—'}</span>
                  <span className="text-[10px] text-ink-400">{wcount} trades</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-4">
          <div className="card p-3">
            <h3 className="mb-2 text-sm font-semibold text-ink-100">{selected ?? 'Select a day'}</h3>
            {selected && !dayTrades.length && <p className="text-xs text-ink-400">No trades on this day.</p>}
            <div className="space-y-1">
              {dayTrades.map((t) => (
                <button key={t.id} className="flex w-full items-center justify-between rounded-md bg-ink-800 px-2 py-1.5 text-xs hover:bg-ink-700" onClick={() => setEditing(t)}>
                  <span><span className="text-ink-400">{fmtTime(t.date, tz)}</span> <span className={t.side === 'buy' ? 'text-up' : 'text-down'}>{t.side.toUpperCase()}</span> {t.lots} {t.instrument}</span>
                  <span className={`font-mono ${pnlClass(netOf(t))}`}>{signedUsd(netOf(t))}</span>
                </button>
              ))}
            </div>
            {selected && <button className="btn mt-2 w-full text-xs" onClick={() => setEditing({ date: Math.floor(Date.parse(selected + 'T12:00:00Z') / 1000), instrument: 'XAUUSD', side: 'buy', lots: 0.1, fees: 0 })}>Record trade on this day</button>}
          </div>
          <div className="card p-3 text-xs">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-100"><Trophy size={14} className="text-gold-400" /> Best days (all time)</h3>
            {allBest.map((d) => <button key={d.day} className="flex w-full justify-between py-0.5 hover:text-gold-300" onClick={() => { setYm(d.day.slice(0, 7)); setSelected(d.day); }}><span>{d.day}</span><span className={pnlClass(d.pnl)}>{signedUsd(d.pnl)}</span></button>)}
            <h3 className="mb-2 mt-3 flex items-center gap-1.5 text-sm font-semibold text-ink-100"><TrendingDown size={14} className="text-down" /> Worst days</h3>
            {allWorst.map((d) => <button key={d.day} className="flex w-full justify-between py-0.5 hover:text-gold-300" onClick={() => { setYm(d.day.slice(0, 7)); setSelected(d.day); }}><span>{d.day}</span><span className={pnlClass(d.pnl)}>{signedUsd(d.pnl)}</span></button>)}
          </div>
        </div>
      </div>
      {editing && <TradeForm trade={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
