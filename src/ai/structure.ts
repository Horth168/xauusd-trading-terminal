/**
 * Market structure from CLOSED candles only. A swing at bar j is "known" only from bar j + lookback onward,
 * so results at bar i never use data after i (no repaint, no look-ahead).
 */
import type { Bar } from '../market/types';
import { atr } from '../indicators/ta';
import type { AnalysisTf, Bias, Level, LiquidityPool, StructureEvent, Sweep, Swing, TfStructure } from './types';

export function findSwings(bars: Bar[], lookback: number): Swing[] {
  const out: Swing[] = [];
  for (let j = lookback; j < bars.length - lookback; j++) {
    let hi = true, lo = true;
    for (let k = 1; k <= lookback; k++) {
      if (!(bars[j].high > bars[j - k].high && bars[j].high >= bars[j + k].high)) hi = false;
      if (!(bars[j].low < bars[j - k].low && bars[j].low <= bars[j + k].low)) lo = false;
      if (!hi && !lo) break;
    }
    if (hi) out.push({ index: j, time: bars[j].time, price: bars[j].high, kind: 'high' });
    if (lo) out.push({ index: j, time: bars[j].time, price: bars[j].low, kind: 'low' });
  }
  return out;
}

/** HH/HL vs LH/LL from the last two confirmed swing highs and lows. */
export function classifyTrend(swings: Swing[]): { bias: Bias; label: string } {
  const highs = swings.filter((s) => s.kind === 'high').slice(-2);
  const lows = swings.filter((s) => s.kind === 'low').slice(-2);
  if (highs.length < 2 || lows.length < 2) return { bias: 'neutral', label: 'Not enough confirmed swings' };
  const hh = highs[1].price > highs[0].price, hl = lows[1].price > lows[0].price;
  const lh = highs[1].price < highs[0].price, ll = lows[1].price < lows[0].price;
  if (hh && hl) return { bias: 'bullish', label: 'Higher highs and higher lows' };
  if (lh && ll) return { bias: 'bearish', label: 'Lower highs and lower lows' };
  if (hh && ll) return { bias: 'neutral', label: 'Expanding range (HH + LL)' };
  if (lh && hl) return { bias: 'neutral', label: 'Contracting range (LH + HL)' };
  return { bias: 'neutral', label: 'Mixed structure' };
}

/**
 * Break of structure / change of character, walking forward in time and only using swings
 * that were already confirmed when each candle closed.
 */
export function structureEvents(bars: Bar[], swings: Swing[], lookback: number): StructureEvent[] {
  const events: StructureEvent[] = [];
  let state: 'bullish' | 'bearish' | null = null;
  let lastHigh: Swing | null = null, lastLow: Swing | null = null;
  let highBroken = false, lowBroken = false;
  let si = 0;
  const sorted = [...swings].sort((a, b) => a.index - b.index);
  for (let k = 0; k < bars.length; k++) {
    // reveal swings confirmed at this bar
    while (si < sorted.length && sorted[si].index + lookback <= k) {
      const s = sorted[si++];
      if (s.kind === 'high') { lastHigh = s; highBroken = false; } else { lastLow = s; lowBroken = false; }
    }
    const c = bars[k].close;
    if (lastHigh && !highBroken && c > lastHigh.price) {
      events.push({ kind: state === 'bearish' ? 'CHOCH' : 'BOS', direction: 'bullish', index: k, time: bars[k].time, level: lastHigh.price });
      state = 'bullish';
      highBroken = true;
    } else if (lastLow && !lowBroken && c < lastLow.price) {
      events.push({ kind: state === 'bullish' ? 'CHOCH' : 'BOS', direction: 'bearish', index: k, time: bars[k].time, level: lastLow.price });
      state = 'bearish';
      lowBroken = true;
    }
  }
  return events;
}

/** Cluster swing prices into support/resistance levels (tolerance = 0.25 ATR). */
export function srLevels(swings: Swing[], lastClose: number, atrNow: number, max = 6): Level[] {
  const tol = Math.max(atrNow * 0.25, 1e-9);
  const clusters: { price: number; touches: number; lastTime: number }[] = [];
  for (const s of swings) {
    const c = clusters.find((x) => Math.abs(x.price - s.price) <= tol);
    if (c) { c.price = (c.price * c.touches + s.price) / (c.touches + 1); c.touches++; c.lastTime = Math.max(c.lastTime, s.time); }
    else clusters.push({ price: s.price, touches: 1, lastTime: s.time });
  }
  return clusters
    .map((c) => ({ ...c, kind: (c.price >= lastClose ? 'resistance' : 'support') as Level['kind'] }))
    .sort((a, b) => Math.abs(a.price - lastClose) - Math.abs(b.price - lastClose))
    .slice(0, max);
}

/** Equal highs / equal lows that price has not traded through since = resting liquidity. */
export function liquidityPools(bars: Bar[], swings: Swing[], atrNow: number): LiquidityPool[] {
  const tol = Math.max(atrNow * 0.1, 1e-9);
  const pools: LiquidityPool[] = [];
  for (const kind of ['high', 'low'] as const) {
    const ss = swings.filter((s) => s.kind === kind);
    for (let a = 0; a < ss.length; a++) {
      for (let b = a + 1; b < ss.length; b++) {
        if (Math.abs(ss[a].price - ss[b].price) > tol) continue;
        const price = kind === 'high' ? Math.max(ss[a].price, ss[b].price) : Math.min(ss[a].price, ss[b].price);
        const after = bars.slice(ss[b].index + 1);
        const taken = kind === 'high' ? after.some((x) => x.high > price) : after.some((x) => x.low < price);
        if (taken) continue;
        if (pools.some((p) => p.side === (kind === 'high' ? 'buy' : 'sell') && Math.abs(p.price - price) <= tol)) continue;
        pools.push({ price, side: kind === 'high' ? 'buy' : 'sell', touches: 2, firstTime: ss[a].time, lastTime: ss[b].time });
      }
    }
  }
  return pools;
}

/** A wick beyond a confirmed swing that closes back inside = liquidity sweep. */
export function findSweeps(bars: Bar[], swings: Swing[], lookback: number, recent = 30): Sweep[] {
  const out: Sweep[] = [];
  const start = Math.max(0, bars.length - recent);
  for (let k = start; k < bars.length; k++) {
    const known = swings.filter((s) => s.index + lookback <= k && s.index < k);
    const hi = known.filter((s) => s.kind === 'high').slice(-3);
    const lo = known.filter((s) => s.kind === 'low').slice(-3);
    for (const s of hi) {
      if (bars[k].high > s.price && bars[k].close < s.price) { out.push({ time: bars[k].time, index: k, side: 'buy', level: s.price, extreme: bars[k].high }); break; }
    }
    for (const s of lo) {
      if (bars[k].low < s.price && bars[k].close > s.price) { out.push({ time: bars[k].time, index: k, side: 'sell', level: s.price, extreme: bars[k].low }); break; }
    }
  }
  return out;
}

export function analyzeStructure(tf: AnalysisTf, bars: Bar[], lookback: number, atrLen = 14): TfStructure {
  const swings = findSwings(bars, lookback);
  const a = atr(bars, atrLen);
  const atrNow = a[a.length - 1] || (bars.length ? bars[bars.length - 1].high - bars[bars.length - 1].low : 0);
  const events = structureEvents(bars, swings, lookback);
  const trend = classifyTrend(swings);
  // The most recent break overrides an ambiguous swing sequence.
  let bias = trend.bias;
  const lastEvent = events[events.length - 1];
  if (bias === 'neutral' && lastEvent) bias = lastEvent.direction;
  const last = bars[bars.length - 1];
  return {
    tf,
    bias,
    trendLabel: trend.bias === 'neutral' && lastEvent ? `${trend.label}; last break ${lastEvent.kind} ${lastEvent.direction}` : trend.label,
    swings,
    events,
    levels: last ? srLevels(swings, last.close, atrNow) : [],
    pools: liquidityPools(bars, swings, atrNow),
    sweeps: findSweeps(bars, swings, lookback),
    lastClose: last?.close ?? NaN,
    lastTime: last?.time ?? 0,
  };
}
