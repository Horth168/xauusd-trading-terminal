import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Activity, ChevronRight, History, LineChart } from 'lucide-react';
import { useAiData } from '../ai/client';
import { groupSignals, signalR, signalStats } from '../ai/signals';
import { DecisionBadge, EmptyState, StatusBadge } from '../ai/ui/components';
import { EquityChart } from '../components/charts';
import { PageHeader, Segmented, Stat } from '../components/ui';
import { dayKey, fmtDate, fmtDateTime } from '../lib/time';
import { num, pct } from '../lib/format';
import { useSettings } from '../store/settings';
import { weekKey } from '../journal/stats';
import type { SignalRecord } from '../ai/types';

type Tab = 'active' | 'history' | 'performance';

function SignalRow({ s }: { s: SignalRecord }) {
  const nav = useNavigate();
  const tz = useSettings((x) => x.timezone);
  const r = signalR(s);
  return (
    <button onClick={() => nav(`/signals/${encodeURIComponent(s.id)}`)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03] active:bg-white/[0.05]">
      <DecisionBadge decision={s.side} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink-100">{s.strategyName} · {s.entryTf} · score {s.score.total}</div>
        <div className="truncate font-mono text-xs text-ink-400">{num(s.plan.entryLow)}–{num(s.plan.entryHigh)} · SL {num(s.plan.sl)} · TP1 {num(s.plan.tp1)} · TP2 {num(s.plan.tp2)}</div>
        <div className="text-[11px] text-ink-500">{fmtDateTime(s.createdAt, tz)}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <StatusBadge status={s.status === 'CONFIRMED' ? s.outcome : s.status} />
        {r != null && <span className={`text-xs font-semibold tabular-nums ${r > 0 ? 'text-up' : 'text-down'}`}>{r > 0 ? '+' : ''}{r.toFixed(2)}R</span>}
      </div>
      <ChevronRight size={16} className="shrink-0 text-ink-500" />
    </button>
  );
}

export default function SignalsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'active';
  const tz = useSettings((s) => s.timezone);
  const { signals, loading } = useAiData();
  const activeList = signals.filter((s) => s.status === 'CONFIRMED' && ['PENDING_ENTRY', 'OPEN', 'TP1_HIT'].includes(s.outcome) && !s.closedAt);
  const stats = useMemo(() => signalStats(signals), [signals]);
  const curve = useMemo(() => {
    let cum = 0;
    return [...signals].sort((a, b) => a.createdAt - b.createdAt).map((s) => ({ s, r: signalR(s) })).filter((x) => x.r != null).map(({ s, r }) => { cum += r!; return { label: fmtDate(s.createdAt, tz), equity: Math.round(cum * 100) / 100 }; });
  }, [signals, tz]);
  const groups: [string, (s: SignalRecord) => string][] = [
    ['Side', (s) => s.side], ['Strategy', (s) => s.strategyName], ['Timeframe', (s) => s.entryTf],
    ['Week', (s) => weekKey(s.createdAt, tz)], ['Month', (s) => dayKey(s.createdAt, tz).slice(0, 7)],
    ['Quarter', (s) => { const [y, m] = dayKey(s.createdAt, tz).split('-').map(Number); return `${y}-Q${Math.ceil(m / 3)}`; }], ['Year', (s) => dayKey(s.createdAt, tz).slice(0, 4)],
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="AI Signals" subtitle="Every confirmed signal, tracked on real subsequent candles — separate from your own trading P&L."
        actions={<Segmented value={tab} onChange={(v) => setParams({ tab: v })} options={[{ value: 'active', label: `Active (${activeList.length})` }, { value: 'history', label: 'History' }, { value: 'performance', label: 'Performance' }]} />} />

      {tab === 'active' && (activeList.length
        ? <div className="card divide-y divide-white/5 overflow-hidden">{activeList.map((s) => <SignalRow key={s.id} s={s} />)}</div>
        : <EmptyState icon={Activity} title={loading ? 'Loading…' : 'No active signals'}>The analyst only confirms when every mandatory rule is met. WAIT is the default — check the Dashboard for the current status.</EmptyState>)}

      {tab === 'history' && (signals.length
        ? <div className="card divide-y divide-white/5 overflow-hidden">{signals.map((s) => <SignalRow key={s.id} s={s} />)}</div>
        : <EmptyState icon={History} title="No signal history yet">Signals appear here once the background scanner (or your analysis) confirms one.</EmptyState>)}

      {tab === 'performance' && (stats.total === 0 ? <EmptyState icon={LineChart} title="No signals to measure yet" /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Signals" value={stats.total} sub={`${stats.open} open · ${stats.expired} expired · ${stats.cancelled} cancelled`} />
            <Stat label="Win rate" value={pct(stats.winRate)} sub={`${stats.wins} W · ${stats.losses} L (decided)`} />
            <Stat label="Total" value={`${stats.totalR >= 0 ? '+' : ''}${stats.totalR.toFixed(2)}R`} tone={stats.totalR >= 0 ? 'up' : 'down'} />
            <Stat label="Average" value={`${stats.avgR.toFixed(2)}R`} sub="per decided signal" />
            <Stat label="Max drawdown" value={`${stats.maxDrawdownR.toFixed(2)}R`} tone="down" />
            <Stat label="Streaks" value={`${stats.maxConsecWins}W / ${stats.maxConsecLosses}L`} sub={`${stats.ambiguous} ambiguous (excluded)`} />
          </div>
          {curve.length > 1 && <div className="card p-4"><h3 className="mb-2 text-sm font-semibold text-ink-100">Cumulative result (R)</h3><EquityChart data={curve} showBalance={false} height={220} /></div>}
          <p className="text-[11px] text-ink-400">R: TP1 = +RR1, TP2 = +RR2, SL = −1R. Ambiguous candles (SL and TP inside one candle), expired and cancelled signals are excluded from win rate. Past signal results do not predict future results.</p>
          <div className="grid gap-4 lg:grid-cols-2">
            {groups.map(([title, key]) => (
              <div key={title} className="card overflow-hidden">
                <h3 className="px-4 pt-3 text-sm font-semibold text-ink-100">By {title.toLowerCase()}</h3>
                <table className="table-x text-xs"><thead><tr><th>{title}</th><th>Signals</th><th>Win %</th><th>Total R</th><th>Avg R</th></tr></thead>
                  <tbody>{groupSignals(signals, key).map((g) => <tr key={g.key}><td>{g.key}</td><td>{g.stats.total}</td><td>{pct(g.stats.winRate)}</td><td className={g.stats.totalR >= 0 ? 'text-up' : 'text-down'}>{g.stats.totalR.toFixed(2)}</td><td>{g.stats.avgR.toFixed(2)}</td></tr>)}</tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
