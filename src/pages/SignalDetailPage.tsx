import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { getOne } from '../lib/db';
import { useAiData } from '../ai/client';
import { AgentCard, DecisionBadge, PlanCard, ReasonList, ScoreBars, StatusBadge } from '../ai/ui/components';
import { SignalChart } from '../ai/ui/SignalChart';
import { signalR } from '../ai/signals';
import { fmtDateTime } from '../lib/time';
import { num } from '../lib/format';
import { useSettings } from '../store/settings';
import type { AnalysisReport } from '../ai/types';

export default function SignalDetailPage() {
  const { id = '' } = useParams();
  const tz = useSettings((s) => s.timezone);
  const { signals, loading } = useAiData();
  const s = signals.find((x) => x.id === decodeURIComponent(id));
  const [report, setReport] = useState<AnalysisReport | null>(null);
  useEffect(() => { if (s?.reportId) getOne<any>('ai_reports', s.reportId).then((r) => setReport(r)).catch(() => setReport(null)); }, [s?.reportId]);

  if (!s) return <div className="flex flex-col items-center gap-3 py-20 text-sm text-ink-400">{loading ? <Loader2 className="animate-spin text-gold-400" /> : <>Signal not found.<Link to="/signals?tab=history" className="text-gold-400">All signals</Link></>}</div>;
  const r = signalR(s);
  const overlay = report?.overlay ?? { tf: s.entryTf, levels: [], events: [], sweeps: [], zones: [], pools: [], plan: s.plan };
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link to="/signals?tab=history" className="inline-flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-100"><ArrowLeft size={16} /> Signals</Link>
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <DecisionBadge decision={s.side} large />
          <StatusBadge status={s.status === 'CONFIRMED' ? s.outcome : s.status} />
          {r != null && <span className={`text-sm font-bold ${r > 0 ? 'text-up' : 'text-down'}`}>{r > 0 ? '+' : ''}{r.toFixed(2)}R</span>}
          <span className="ml-auto text-xs text-ink-400">{s.strategyName} · {s.entryTf} · {fmtDateTime(s.createdAt, tz)}</span>
        </div>
        {s.statusReason && <p className="mt-2 text-sm text-ink-300">{s.statusReason}</p>}
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <SignalChart bars={s.candles ?? []} overlay={overlay} markTime={s.barTime} height={360} />
          <div className="space-y-4">
            <div className="rounded-2xl border border-gold-500/25 bg-gold-500/[0.04] p-3"><PlanCard plan={s.plan} digits={s.market.digits} /></div>
            <ScoreBars score={s.score} />
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl bg-white/[0.03] p-2.5"><div className="text-ink-400">Price at signal</div><div className="font-mono text-ink-100">bid {num(s.market.bid)} / ask {num(s.market.ask)}</div></div>
              <div className="rounded-xl bg-white/[0.03] p-2.5"><div className="text-ink-400">Spread</div><div className="font-mono text-ink-100">{num(s.market.spread)}</div></div>
              <div className="rounded-xl bg-white/[0.03] p-2.5"><div className="text-ink-400">Max favourable</div><div className="font-mono text-up">{num(s.mfe ?? 0)}</div></div>
              <div className="rounded-xl bg-white/[0.03] p-2.5"><div className="text-ink-400">Max adverse</div><div className="font-mono text-down">{num(s.mae ?? 0)}</div></div>
              {s.filledAt && <div className="col-span-2 rounded-xl bg-white/[0.03] p-2.5"><div className="text-ink-400">Entry filled</div><div className="text-ink-100">{fmtDateTime(s.filledAt, tz)}{s.timeToTargetSec ? ` · target after ${Math.round(s.timeToTargetSec / 60)} min` : ''}</div></div>}
            </div>
          </div>
        </div>
      </div>
      <div className="card space-y-4 p-5">
        <ReasonList title="Why the setup was valid" items={s.reasonsFor} tone="up" />
        <ReasonList title="Against / risks" items={s.reasonsAgainst} tone="down" />
        <ReasonList title="Invalidation" items={[s.plan.invalidation]} tone="down" />
        <ReasonList title="How the prices were calculated" items={s.plan.calc} tone="muted" />
        <p className="text-[11px] text-ink-500">Data: {s.market.source === 'mt5' ? `Exness MT5 ${s.market.server ?? ''}` : s.market.source} · signal {s.id}</p>
      </div>
      {report && <div className="space-y-2"><h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Multi-agent reports at signal time</h2>{report.agents.map((a) => <AgentCard key={a.agent} a={a} />)}</div>}
    </div>
  );
}
