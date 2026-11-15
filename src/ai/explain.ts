/** Deterministic text for notifications and the UI. Never invents values: everything comes from the signal/report. */
import type { AnalysisReport, SignalRecord } from './types';

const n = (v: number, d = 2) => v.toFixed(d);

export function notificationText(s: SignalRecord): { title: string; body: string } {
  const p = s.plan;
  const d = s.market.digits >= 3 ? 2 : s.market.digits || 2;
  const entry = p.entryLow === p.entryHigh ? n(p.entryLow, d) : `${n(p.entryLow, d)}–${n(p.entryHigh, d)}`;
  return {
    title: `XAUUSD ${s.side} SIGNAL CONFIRMED`,
    body: [
      `Entry: ${entry}`,
      `SL: ${n(p.sl, d)}`,
      `TP1: ${n(p.tp1, d)}  TP2: ${n(p.tp2, d)}`,
      `RR: 1:${p.rr1.toFixed(1)} / 1:${p.rr2.toFixed(1)}`,
      `Strategy: ${s.strategyName} · ${s.entryTf} · score ${s.score.total}/100`,
      'Tap to view full AI analysis.',
    ].join('\n'),
  };
}

export function lifecycleText(s: SignalRecord): { title: string; body: string } {
  return { title: `XAUUSD ${s.side} signal ${s.status === 'INVALIDATED' ? 'INVALIDATED' : s.outcome.replace('_', ' ')}`, body: s.statusReason ?? '' };
}

/** Plain-language summary of a report for the dashboard / AI Analyst. */
export function reportSummary(r: AnalysisReport): string {
  const b = r.biases;
  const bias = (['H4', 'H1', 'M15', 'M5'] as const).map((tf) => `${tf} ${b[tf] ?? 'n/a'}`).join(', ');
  if (r.decision !== 'WAIT' && r.plan) {
    const p = r.plan;
    return `${r.decision} confirmed by ${r.strategyName} on ${r.entryTf}. Entry ${n(p.entryLow)}–${n(p.entryHigh)}, SL ${n(p.sl)}, TP1 ${n(p.tp1)}, TP2 ${n(p.tp2)} (RR 1:${p.rr1.toFixed(2)}). Evidence ${r.score.total}/100. Bias: ${bias}.`;
  }
  return `WAIT (${r.status.replace('_', ' ').toLowerCase()}). ${r.waitReasons[0] ?? ''} Bias: ${bias}.`;
}
