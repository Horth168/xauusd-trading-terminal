/**
 * Turns the AI analyst into a backtestable strategy for the EXISTING engine. At every entry-timeframe candle close,
 * the same `analyze()` used live runs on data closed by then (higher timeframes are aggregated from the same real
 * candles), so live signals and backtests share identical deterministic rules.
 */
import type { Bar } from '../market/types';
import { aggregate } from '../market/aggregate';
import { getTimeframe } from '../market/timeframes';
import { emptySignals, type SignalOutput } from '../indicators/types';
import { analyze } from '../ai/analyze';
import { mergeConfig, TF_SECONDS, type AiConfig } from '../ai/config';
import type { CandleSet } from '../ai/types';

export const AI_STRATEGY_PREFIX = 'ai:';

export function aiSignals(bars: Bar[], cfgIn: Partial<AiConfig>, only: string | 'all', spread: number, digits = 2): SignalOutput {
  const base = mergeConfig(cfgIn);
  const cfg = only === 'all' ? base : mergeConfig({ ...base, strategies: Object.fromEntries(Object.keys(base.strategies).map((k) => [k, { enabled: k === only }])) });
  const tf = cfg.entryTf;
  const sec = TF_SECONDS[tf];
  const set: CandleSet = { [tf]: bars, M15: tf === 'M15' ? bars : aggregate(bars, getTimeframe('M15')), H1: aggregate(bars, getTimeframe('H1')), H4: aggregate(bars, getTimeframe('H4')) };
  const out = emptySignals(bars.length);
  for (let i = 120; i < bars.length; i++) {
    const asOf = bars[i].time + sec; // candle i has just closed
    const close = bars[i].close;
    const report = analyze(set, { source: 'mt5', live: true, bid: close, ask: close + spread, spread, digits, updatedAt: asOf, symbol: 'XAUUSD' }, cfg, { asOf });
    if (report.status !== 'CONFIRMED' || !report.plan) continue;
    if (report.decision === 'BUY') out.long[i] = true;
    if (report.decision === 'SELL') out.short[i] = true;
    out.sl[i] = report.plan.sl;
    out.tp[i] = report.plan.tp1;
  }
  return out;
}
