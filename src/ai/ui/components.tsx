import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronDown, CircleSlash, Clock, ShieldAlert } from 'lucide-react';
import type { AgentReport, Bias, ScoreBreakdown, SignalOutcome, SignalStatus, TradePlan } from '../types';
import { num } from '../../lib/format';

export function DecisionBadge({ decision, large }: { decision: 'BUY' | 'SELL' | 'WAIT'; large?: boolean }) {
  const cls = decision === 'BUY' ? 'bg-up/15 text-up ring-up/30' : decision === 'SELL' ? 'bg-down/15 text-down ring-down/30' : 'bg-white/[0.06] text-ink-200 ring-white/10';
  const Icon = decision === 'BUY' ? ArrowUpRight : decision === 'SELL' ? ArrowDownRight : Clock;
  return <span className={`inline-flex items-center gap-1.5 rounded-xl font-bold tracking-wide ring-1 ${cls} ${large ? 'px-4 py-2 text-xl' : 'px-2.5 py-1 text-xs'}`}><Icon size={large ? 22 : 14} />{decision}</span>;
}

const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: 'bg-gold-500/15 text-gold-300', SETUP_FORMING: 'bg-[#2f9bff]/15 text-[#7cc0ff]', WATCHING: 'bg-white/[0.06] text-ink-300', WAIT: 'bg-white/[0.06] text-ink-300',
  INVALIDATED: 'bg-down/15 text-down', EXPIRED: 'bg-white/[0.06] text-ink-400',
  OPEN: 'bg-[#2f9bff]/15 text-[#7cc0ff]', PENDING_ENTRY: 'bg-gold-500/10 text-gold-300', TP1_HIT: 'bg-up/15 text-up', TP2_HIT: 'bg-up/20 text-up', SL_HIT: 'bg-down/15 text-down', CANCELLED: 'bg-white/[0.06] text-ink-400', AMBIGUOUS: 'bg-[#c678dd]/15 text-[#d7a0e8]',
};
export function StatusBadge({ status }: { status: SignalStatus | SignalOutcome }) {
  return <span className={`inline-flex rounded-lg px-2 py-0.5 text-[11px] font-semibold tracking-wide ${STATUS_STYLE[status] ?? 'bg-white/5 text-ink-300'}`}>{status.replace('_', ' ')}</span>;
}

export function BiasPill({ tf, bias, label }: { tf: string; bias?: Bias; label?: string }) {
  const c = bias === 'bullish' ? 'text-up' : bias === 'bearish' ? 'text-down' : 'text-ink-300';
  const dot = bias === 'bullish' ? 'bg-up' : bias === 'bearish' ? 'bg-down' : 'bg-ink-500';
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-ink-400">{tf}{label ? ` · ${label}` : ''}</div>
      <div className={`mt-1 flex items-center gap-1.5 text-sm font-semibold capitalize ${c}`}><span className={`h-2 w-2 rounded-full ${dot}`} />{bias ?? 'n/a'}</div>
    </div>
  );
}

export function ScoreBars({ score, min }: { score: ScoreBreakdown; min?: number }) {
  const parts: [string, number][] = [['Trend alignment', score.trend], ['Market structure', score.structure], ['Indicators', score.indicators], ['Liquidity & price action', score.liquidity], ['Risk & execution', score.risk]];
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Evidence score</span>
        <span className="text-lg font-bold tabular-nums text-gold-300">{score.total}<span className="text-xs font-medium text-ink-400">/100{min != null ? ` · min ${min}` : ''}</span></span>
      </div>
      <div className="space-y-1.5">
        {parts.map(([l, v]) => (
          <div key={l} className="flex items-center gap-2 text-xs">
            <span className="w-40 shrink-0 text-ink-300">{l}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-gradient-to-r from-gold-600 to-gold-300 transition-all duration-500" style={{ width: `${(v / 20) * 100}%` }} /></div>
            <span className="w-9 text-right tabular-nums text-ink-200">{v}/20</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10.5px] text-ink-500">A rule-based checklist — not a probability of success.</p>
    </div>
  );
}

export function PlanCard({ plan, digits = 2 }: { plan: TradePlan; digits?: number }) {
  const d = Math.min(digits, 3);
  const row = (l: string, v: string, cls = 'text-ink-100') => <div className="flex items-baseline justify-between gap-3 py-1.5"><span className="text-sm text-ink-400">{l}</span><span className={`font-mono text-[15px] font-semibold tabular-nums ${cls}`}>{v}</span></div>;
  return (
    <div className="divide-y divide-white/5">
      {row('Entry', plan.entryLow === plan.entryHigh ? num(plan.entryLow, d) : `${num(plan.entryLow, d)} – ${num(plan.entryHigh, d)}`, 'text-gold-300')}
      {row('Stop loss', num(plan.sl, d), 'text-down')}
      {row('Take profit 1', num(plan.tp1, d), 'text-up')}
      {row('Take profit 2', num(plan.tp2, d), 'text-up')}
      {row('Risk : reward', `1 : ${plan.rr1.toFixed(2)}  /  1 : ${plan.rr2.toFixed(2)}`)}
      {row('Entry type', plan.entryType)}
    </div>
  );
}

export function AgentCard({ a, defaultOpen = false }: { a: AgentReport; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const vcol = a.verdict === 'bullish' || a.verdict === 'pass' ? 'text-up' : a.verdict === 'bearish' || a.verdict === 'fail' ? 'text-down' : 'text-ink-300';
  return (
    <div className="card overflow-hidden">
      <button className="flex w-full items-center gap-3 p-4 text-left" onClick={() => setOpen(!open)}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><span className="font-semibold text-ink-100">{a.title}</span><span className={`text-xs font-semibold uppercase ${vcol}`}>{a.verdict}</span></div>
          <p className="mt-0.5 text-sm text-ink-400">{a.summary}</p>
        </div>
        <span className="shrink-0 font-mono text-sm tabular-nums text-gold-300">{a.score}/{a.maxScore}</span>
        <ChevronDown size={18} className={`shrink-0 text-ink-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="animate-in space-y-1.5 border-t border-white/5 px-4 pb-4 pt-3">
          {a.evidence.map((e, i) => (
            <div key={i} className="flex gap-2 text-sm">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${e.supports === 'BUY' ? 'bg-up' : e.supports === 'SELL' ? 'bg-down' : 'bg-ink-500'}`} />
              <span><span className="text-ink-200">{e.label}:</span> <span className="text-ink-400">{e.detail}</span></span>
            </div>
          ))}
          {a.warnings.map((w, i) => <div key={`w${i}`} className="flex gap-2 text-sm text-gold-300"><ShieldAlert size={14} className="mt-0.5 shrink-0" />{w}</div>)}
          {!a.evidence.length && !a.warnings.length && <p className="text-sm text-ink-400">No evidence recorded.</p>}
        </div>
      )}
    </div>
  );
}

export function ReasonList({ title, items, tone }: { title: string; items: string[]; tone: 'up' | 'down' | 'muted' }) {
  if (!items.length) return null;
  const c = tone === 'up' ? 'bg-up' : tone === 'down' ? 'bg-down' : 'bg-ink-500';
  return (
    <div>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{title}</h4>
      <ul className="space-y-1.5">{items.map((x, i) => <li key={i} className="flex gap-2 text-sm text-ink-200"><span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${c}`} />{x}</li>)}</ul>
    </div>
  );
}

export function EmptyState({ icon: Icon = CircleSlash, title, children }: { icon?: any; title: string; children?: React.ReactNode }) {
  return <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center"><Icon size={26} className="text-ink-500" /><div className="font-medium text-ink-200">{title}</div><div className="max-w-md text-sm text-ink-400">{children}</div></div>;
}
