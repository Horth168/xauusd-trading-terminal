import type { Bar } from '../market/types';
import { adx, atr, cci, ema, rsi, sma, stoch } from '../indicators/ta';
import type { AiConfig } from './config';
import { TF_SECONDS } from './config';
import type { AnalysisTf, CandleSet, IndicatorSnapshot, TfStructure } from './types';
import { analyzeStructure } from './structure';

export const WINDOW: Record<AnalysisTf, number> = { M1: 300, M5: 400, M15: 300, H1: 300, H4: 300 };

/**
 * Candles that had fully CLOSED by `asOf` (unix seconds). This single rule is what keeps live analysis,
 * the background scanner and backtests free of look-ahead: a bar is usable only after open + tfSeconds.
 */
export function closedBars(bars: Bar[] | undefined, tf: AnalysisTf, asOf: number, window = WINDOW[tf]): Bar[] {
  if (!bars?.length) return [];
  const sec = TF_SECONDS[tf];
  let lo = 0, hi = bars.length - 1, end = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time + sec <= asOf) { end = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (end < 0) return [];
  return bars.slice(Math.max(0, end - window + 1), end + 1);
}

export function indicatorSnapshot(tf: AnalysisTf, bars: Bar[], cfg: AiConfig): IndicatorSnapshot | null {
  const n = bars.length;
  if (n < Math.max(cfg.periods.emaSlow, cfg.periods.adx * 2) + 5) return null;
  const c = bars.map((b) => b.close);
  const p = cfg.periods;
  const e1 = ema(c, p.emaFast), e2 = ema(c, p.emaSlow);
  const st = stoch(bars, p.stochK, p.stochSmooth, p.stochD);
  const cc = cci(bars, p.cci);
  const at = atr(bars, p.atr);
  const rs = rsi(c, p.rsi);
  const ad = adx(bars, p.adx);
  const vols = bars.map((b) => (b.volume == null ? NaN : b.volume));
  const hasVol = vols.slice(-20).every((v) => Number.isFinite(v));
  const va = hasVol ? sma(vols, 20) : null;
  const i = n - 1;
  return {
    tf, time: bars[i].time, close: c[i],
    ema12: e1[i], ema26: e2[i],
    stochK: st.k[i], stochD: st.d[i], stochKPrev: st.k[i - 1], stochDPrev: st.d[i - 1],
    cci: cc[i], cciPrev: cc[i - 1],
    atr: at[i], rsi: rs[i], adx: ad.adx[i], plusDI: ad.plusDI[i], minusDI: ad.minusDI[i],
    volume: hasVol ? vols[i] : null, volumeAvg: va ? va[i] : null,
  };
}

/** Per-bar series for the entry timeframe (strategies need recent crosses, not just the last value). */
export interface EntrySeries {
  bars: Bar[];
  ema12: number[]; ema26: number[]; k: number[]; d: number[]; cci: number[]; atr: number[]; rsi: number[];
}

export function entrySeries(bars: Bar[], cfg: AiConfig): EntrySeries {
  const c = bars.map((b) => b.close);
  const p = cfg.periods;
  const st = stoch(bars, p.stochK, p.stochSmooth, p.stochD);
  return { bars, ema12: ema(c, p.emaFast), ema26: ema(c, p.emaSlow), k: st.k, d: st.d, cci: cci(bars, p.cci), atr: atr(bars, p.atr), rsi: rsi(c, p.rsi) };
}

export interface AnalysisContext {
  asOf: number;
  cfg: AiConfig;
  entryTf: AnalysisTf;
  bars: Partial<Record<AnalysisTf, Bar[]>>; // closed only
  structure: Partial<Record<AnalysisTf, TfStructure>>;
  ind: Partial<Record<AnalysisTf, IndicatorSnapshot>>;
  entry: EntrySeries;
}

export function buildContext(set: CandleSet, asOf: number, cfg: AiConfig): AnalysisContext {
  const tfs: AnalysisTf[] = ['H4', 'H1', 'M15', 'M5', 'M1'];
  const bars: AnalysisContext['bars'] = {};
  const structure: AnalysisContext['structure'] = {};
  const ind: AnalysisContext['ind'] = {};
  for (const tf of tfs) {
    const b = closedBars(set[tf], tf, asOf);
    if (!b.length) continue;
    bars[tf] = b;
    if (b.length >= 30) structure[tf] = analyzeStructure(tf, b, cfg.swingLookback, cfg.periods.atr);
    const snap = indicatorSnapshot(tf, b, cfg);
    if (snap) ind[tf] = snap;
  }
  const eb = bars[cfg.entryTf] ?? [];
  return { asOf, cfg, entryTf: cfg.entryTf, bars, structure, ind, entry: entrySeries(eb, cfg) };
}
