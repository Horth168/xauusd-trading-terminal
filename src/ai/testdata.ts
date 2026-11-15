/** Deterministic synthetic XAUUSD-like candles for tests ONLY (never used by the app at runtime). */
import type { Bar } from '../market/types';
import { aggregate } from '../market/aggregate';
import { getTimeframe } from '../market/timeframes';
import type { CandleSet, MarketSnapshot } from './types';

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** M1 random walk with regime-switching drift (trends and ranges), roughly gold-sized moves. */
export function syntheticM1(minutes: number, seed = 7, start = Date.UTC(2026, 9, 5, 0, 0) / 1000): Bar[] {
  const r = rng(seed);
  const out: Bar[] = [];
  let px = 4000, drift = 0;
  for (let i = 0; i < minutes; i++) {
    if (i % 240 === 0) drift = (r() - 0.5) * 0.12;
    const o = px;
    const c = o + drift + (r() - 0.5) * 1.4;
    const h = Math.max(o, c) + r() * 0.5, l = Math.min(o, c) - r() * 0.5;
    out.push({ time: start + i * 60, open: o, high: h, low: l, close: c, volume: 50 + Math.floor(r() * 200) });
    px = c;
  }
  return out;
}

export function candleSet(m1: Bar[]): CandleSet {
  return {
    M1: m1,
    M5: aggregate(m1, getTimeframe('M5')),
    M15: aggregate(m1, getTimeframe('M15')),
    H1: aggregate(m1, getTimeframe('H1')),
    H4: aggregate(m1, getTimeframe('H4')),
  };
}

export function snapshotAt(set: CandleSet, asOf: number, live = true, spread = 0.16): MarketSnapshot {
  const m1 = set.M1!;
  let i = m1.length - 1;
  while (i > 0 && m1[i].time + 60 > asOf) i--;
  const bid = m1[i].close;
  return { source: live ? 'mt5' : 'twelvedata', live, bid, ask: bid + spread, spread, digits: 2, updatedAt: asOf, server: 'TEST', symbol: 'XAUUSD' };
}
