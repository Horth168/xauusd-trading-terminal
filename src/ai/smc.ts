/**
 * Smart Money Concepts from OHLC only: fair value gaps, order blocks, displacement, premium/discount.
 * These are price-pattern definitions — no order-flow or institutional data is implied or invented.
 */
import type { Bar } from '../market/types';
import type { StructureEvent, Swing, Zone } from './types';

/** Displacement = candle body at least `mult` × ATR. */
export function isDisplacement(bar: Bar, atrAt: number, mult = 1.2): 'bullish' | 'bearish' | null {
  const body = bar.close - bar.open;
  if (!(atrAt > 0) || Math.abs(body) < mult * atrAt) return null;
  return body > 0 ? 'bullish' : 'bearish';
}

/** Three-candle imbalance: bullish if low[k] > high[k-2]; bearish if high[k] < low[k-2]. */
export function fairValueGaps(bars: Bar[], atrArr: number[], minAtr = 0.1, recent = 60): Zone[] {
  const out: Zone[] = [];
  const start = Math.max(2, bars.length - recent);
  for (let k = start; k < bars.length; k++) {
    const a = bars[k - 2], c = bars[k];
    const minGap = (atrArr[k] || 0) * minAtr;
    if (c.low > a.high && c.low - a.high >= minGap) {
      const z: Zone = { kind: 'FVG', direction: 'bullish', top: c.low, bottom: a.high, time: bars[k - 1].time, index: k - 1, mitigated: false };
      z.mitigated = bars.slice(k + 1).some((b) => b.low <= z.bottom);
      out.push(z);
    } else if (c.high < a.low && a.low - c.high >= minGap) {
      const z: Zone = { kind: 'FVG', direction: 'bearish', top: a.low, bottom: c.high, time: bars[k - 1].time, index: k - 1, mitigated: false };
      z.mitigated = bars.slice(k + 1).some((b) => b.high >= z.top);
      out.push(z);
    }
  }
  return out;
}

/** Order block = last opposite-colour candle before the move that broke structure. Invalidated by a close through it. */
export function orderBlocks(bars: Bar[], events: StructureEvent[], maxBack = 10): Zone[] {
  const out: Zone[] = [];
  for (const e of events.slice(-6)) {
    for (let j = e.index - 1; j >= Math.max(0, e.index - maxBack); j--) {
      const b = bars[j];
      const opposite = e.direction === 'bullish' ? b.close < b.open : b.close > b.open;
      if (!opposite) continue;
      const z: Zone = { kind: 'OB', direction: e.direction, top: b.high, bottom: b.low, time: b.time, index: j, mitigated: false };
      const later = bars.slice(e.index + 1);
      z.mitigated = e.direction === 'bullish' ? later.some((x) => x.close < z.bottom) : later.some((x) => x.close > z.top);
      out.push(z);
      break;
    }
  }
  return out;
}

/** Position of price inside the latest dealing range (last confirmed swing high & low). */
export function premiumDiscount(swings: Swing[], price: number): { zone: 'premium' | 'discount' | 'equilibrium' | 'unknown'; high: number; low: number; pct: number } {
  const hi = [...swings].reverse().find((s) => s.kind === 'high');
  const lo = [...swings].reverse().find((s) => s.kind === 'low');
  if (!hi || !lo || hi.price <= lo.price) return { zone: 'unknown', high: NaN, low: NaN, pct: NaN };
  const pct = (price - lo.price) / (hi.price - lo.price);
  return { zone: pct > 0.55 ? 'premium' : pct < 0.45 ? 'discount' : 'equilibrium', high: hi.price, low: lo.price, pct };
}

/** Is the latest close inside (retesting) a zone? */
export function inZone(price: number, z: { top: number; bottom: number }, pad = 0) {
  return price <= z.top + pad && price >= z.bottom - pad;
}
