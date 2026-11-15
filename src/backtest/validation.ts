/**
 * Robustness checks on top of the existing engine (concepts from HKUDS/Vibe-Trading's validation tooling):
 * out-of-sample split, walk-forward windows, Monte Carlo trade resampling, an automated look-ahead check and
 * overfitting warnings. Results describe the past only — never a guarantee of future performance.
 */
import type { Bar } from '../market/types';
import type { SignalOutput } from '../indicators/types';
import { runBacktest, type BacktestConfig, type Stats, type Trade } from './engine';

const slice = (s: SignalOutput, a: number, b: number): SignalOutput => ({
  long: s.long.slice(a, b), short: s.short.slice(a, b), exitLong: s.exitLong.slice(a, b), exitShort: s.exitShort.slice(a, b), sl: s.sl.slice(a, b), tp: s.tp.slice(a, b),
});

export interface WindowResult { label: string; from: number; to: number; stats: Stats }

export function outOfSample(bars: Bar[], sig: SignalOutput, cfg: BacktestConfig, split = 0.7): { inSample: WindowResult; outSample: WindowResult } {
  const k = Math.floor(bars.length * split);
  const a = runBacktest(bars.slice(0, k), slice(sig, 0, k), cfg).stats;
  const b = runBacktest(bars.slice(k), slice(sig, k, bars.length), cfg).stats;
  return { inSample: { label: `In-sample (first ${Math.round(split * 100)}%)`, from: bars[0].time, to: bars[k - 1].time, stats: a }, outSample: { label: `Out-of-sample (last ${Math.round((1 - split) * 100)}%)`, from: bars[k].time, to: bars[bars.length - 1].time, stats: b } };
}

export function walkForward(bars: Bar[], sig: SignalOutput, cfg: BacktestConfig, folds = 5): WindowResult[] {
  const out: WindowResult[] = [];
  const size = Math.floor(bars.length / folds);
  for (let f = 0; f < folds; f++) {
    const a = f * size, b = f === folds - 1 ? bars.length : (f + 1) * size;
    if (b - a < 50) continue;
    out.push({ label: `Window ${f + 1}`, from: bars[a].time, to: bars[b - 1].time, stats: runBacktest(bars.slice(a, b), slice(sig, a, b), cfg).stats });
  }
  return out;
}

export interface MonteCarloResult { runs: number; finalP5: number; finalP50: number; finalP95: number; ddP50: number; ddP95: number; probLoss: number }

/** Bootstrap the realised trade P&L sequence (with replacement) to see the spread of outcomes and drawdowns. */
export function monteCarlo(trades: Trade[], initial: number, runs = 1000, seed = 42): MonteCarloResult | null {
  if (trades.length < 5) return null;
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const pnls = trades.map((t) => t.pnl);
  const finals: number[] = [], dds: number[] = [];
  for (let r = 0; r < runs; r++) {
    let bal = initial, peak = initial, dd = 0;
    for (let k = 0; k < pnls.length; k++) {
      bal += pnls[Math.floor(rnd() * pnls.length)];
      peak = Math.max(peak, bal);
      dd = Math.max(dd, peak > 0 ? (peak - bal) / peak : 0);
    }
    finals.push(bal); dds.push(dd * 100);
  }
  finals.sort((a, b) => a - b); dds.sort((a, b) => a - b);
  const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  return { runs, finalP5: q(finals, 0.05), finalP50: q(finals, 0.5), finalP95: q(finals, 0.95), ddP50: q(dds, 0.5), ddP95: q(dds, 0.95), probLoss: (finals.filter((f) => f < initial).length / runs) * 100 };
}

/**
 * Look-ahead check: recompute signals on truncated history and verify every past signal is unchanged.
 * Any difference means the strategy used data from the future.
 */
export function lookAheadCheck(bars: Bar[], compute: (b: Bar[]) => SignalOutput, full: SignalOutput, cuts = 4, window = 40): { passed: boolean; checked: number; mismatches: number[] } {
  const mismatches: number[] = [];
  let checked = 0;
  for (let c = 1; c <= cuts; c++) {
    const k = Math.floor((bars.length * c) / (cuts + 1));
    if (k < 150) continue;
    const part = compute(bars.slice(0, k));
    // include the last available candle: a strategy that peeks ahead can only differ there
    for (let i = Math.max(0, k - window); i < k; i++) {
      checked++;
      if (part.long[i] !== full.long[i] || part.short[i] !== full.short[i]) mismatches.push(bars[i].time);
    }
  }
  return { passed: mismatches.length === 0, checked, mismatches: mismatches.slice(0, 10) };
}

export function overfittingWarnings(full: Stats, oos: { inSample: WindowResult; outSample: WindowResult }, wf: WindowResult[], mc: MonteCarloResult | null, initial: number): string[] {
  const w: string[] = [];
  if (full.totalTrades < 30) w.push(`Only ${full.totalTrades} trades — too few to judge reliably (aim for 30+, ideally 100+).`);
  const is = oos.inSample.stats, os = oos.outSample.stats;
  if (is.netProfit > 0 && os.netProfit <= 0) w.push('Profitable in-sample but not out-of-sample — the edge may not persist.');
  if (Number.isFinite(is.profitFactor) && Number.isFinite(os.profitFactor) && is.profitFactor > 1 && os.profitFactor < is.profitFactor * 0.7) w.push(`Out-of-sample profit factor ${os.profitFactor.toFixed(2)} is far below in-sample ${is.profitFactor.toFixed(2)}.`);
  const prof = wf.filter((x) => x.stats.netProfit > 0).length;
  if (wf.length >= 3 && prof / wf.length < 0.6) w.push(`Only ${prof} of ${wf.length} walk-forward windows were profitable — results are inconsistent over time.`);
  if (mc && mc.finalP5 < initial) w.push(`Monte Carlo: in the worst 5% of resampled sequences the account ends below the starting balance (${mc.probLoss.toFixed(0)}% of runs lost money).`);
  if (full.maxDrawdownPct > 30) w.push(`Maximum drawdown ${full.maxDrawdownPct.toFixed(1)}% is high.`);
  if (!w.length) w.push('No overfitting red flags found by these checks. Past results still do not guarantee future performance.');
  return w;
}
