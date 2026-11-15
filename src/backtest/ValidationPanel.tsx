import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import type { ValidationResult } from './client';
import { fmtDate } from '../lib/time';
import { num, pct, pnlClass, signedUsd, usd } from '../lib/format';

export function ValidationPanel({ v, initial, tz }: { v: ValidationResult; initial: number; tz: string }) {
  const row = (label: string, from: number, to: number, s: ValidationResult['wf'][number]['stats']) => (
    <tr key={label}><td>{label}</td><td className="text-ink-400">{fmtDate(from, tz)} → {fmtDate(to, tz)}</td><td>{s.totalTrades}</td><td>{pct(s.winRate)}</td><td className={pnlClass(s.netProfit)}>{signedUsd(s.netProfit)}</td><td>{Number.isFinite(s.profitFactor) ? num(s.profitFactor) : '∞'}</td><td>{pct(s.maxDrawdownPct)}</td></tr>
  );
  return (
    <div className="card space-y-4 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-100"><ShieldCheck size={16} className="text-gold-400" /> Robustness checks</h3>
      <div className="space-y-1.5">
        {v.warnings.map((w, i) => <div key={i} className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${/No overfitting/.test(w) ? 'bg-up/10 text-up' : 'bg-gold-500/10 text-gold-300'}`}>{/No overfitting/.test(w) ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}{w}</div>)}
        <div className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${v.lookAhead.passed ? 'bg-up/10 text-up' : 'bg-down/10 text-down'}`}>
          {v.lookAhead.passed ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
          Look-ahead check {v.lookAhead.passed ? 'passed' : 'FAILED'}: recomputed signals on truncated history for {v.lookAhead.checked} candles{v.lookAhead.passed ? ' — every past signal was identical.' : ` — ${v.lookAhead.mismatches.length}+ signals changed, so the strategy uses future data.`}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="table-x text-xs">
          <thead><tr><th>Period</th><th>Dates</th><th>Trades</th><th>Win %</th><th>Net</th><th>PF</th><th>Max DD</th></tr></thead>
          <tbody>
            {row(v.oos.inSample.label, v.oos.inSample.from, v.oos.inSample.to, v.oos.inSample.stats)}
            {row(v.oos.outSample.label, v.oos.outSample.from, v.oos.outSample.to, v.oos.outSample.stats)}
            {v.wf.map((w) => row(w.label, w.from, w.to, w.stats))}
          </tbody>
        </table>
      </div>
      {v.mc && (
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-xl bg-white/[0.03] p-3"><div className="text-ink-400">Monte Carlo final (5th pct)</div><div className={`font-mono text-sm ${v.mc.finalP5 >= initial ? 'text-up' : 'text-down'}`}>{usd(v.mc.finalP5)}</div></div>
          <div className="rounded-xl bg-white/[0.03] p-3"><div className="text-ink-400">Median final</div><div className="font-mono text-sm text-ink-100">{usd(v.mc.finalP50)}</div></div>
          <div className="rounded-xl bg-white/[0.03] p-3"><div className="text-ink-400">Drawdown (95th pct)</div><div className="font-mono text-sm text-down">{pct(v.mc.ddP95)}</div></div>
          <div className="rounded-xl bg-white/[0.03] p-3"><div className="text-ink-400">Runs ending below start</div><div className="font-mono text-sm text-ink-100">{pct(v.mc.probLoss, 0)}</div></div>
        </div>
      )}
      <p className="text-[11px] text-ink-500">Monte Carlo resamples the realised trades {v.mc?.runs ?? 0}× to show how order and luck change outcomes. These checks describe historical data only and never guarantee future results.</p>
    </div>
  );
}
