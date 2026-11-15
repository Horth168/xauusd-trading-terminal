import { describe, expect, it } from 'vitest';
import type { Bar } from '../market/types';
import { emptySignals, type SignalOutput } from '../indicators/types';
import { aiSignals } from './aiStrategy';
import { DEFAULT_CONFIG, runBacktest } from './engine';
import { lookAheadCheck, monteCarlo, outOfSample, overfittingWarnings, walkForward } from './validation';
import { STRATEGY_MAP } from './strategies';
import { candleSet, syntheticM1 } from '../ai/testdata';

const m5 = candleSet(syntheticM1(60 * 24 * 10, 9)).M5!;
const cfg = { ...DEFAULT_CONFIG, sl: { ...DEFAULT_CONFIG.sl, mode: 'signal' as const }, tp: { ...DEFAULT_CONFIG.tp, mode: 'rr' as const, levels: [{ value: 2, closePct: 50 }, { value: 3, closePct: 50 }] }, exitOnSignal: false };

describe('AI strategy in the existing backtest engine', () => {
  const sig = aiSignals(m5, {}, 'all', 0.16);
  it('produces signals with structural stops and trades them', () => {
    const n = sig.long.filter(Boolean).length + sig.short.filter(Boolean).length;
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < m5.length; i++) if (sig.long[i] || sig.short[i]) expect(Number.isFinite(sig.sl[i])).toBe(true);
    const r = runBacktest(m5, sig, cfg);
    expect(r.trades.length).toBeGreaterThan(0);
    for (const t of r.trades) expect(t.entryTime).toBeGreaterThan(t.signalTime); // filled after the signal candle
  });

  it('passes the look-ahead check (signals unchanged when future candles are removed)', () => {
    const la = lookAheadCheck(m5, (b) => aiSignals(b, {}, 'all', 0.16), sig, 3, 30);
    expect(la.checked).toBeGreaterThan(50);
    expect(la.passed).toBe(true);
  });
});

describe('validation tools', () => {
  const ema = STRATEGY_MAP.get('ema_cross')!;
  const sig = ema.compute(m5, { fast: 9, slow: 21, trend: 0 }, { tzOffsetSec: 0 }).signals;
  const full = runBacktest(m5, sig, DEFAULT_CONFIG);

  it('look-ahead check catches a strategy that peeks at the next candle', () => {
    const cheat = (b: Bar[]): SignalOutput => { const s = emptySignals(b.length); for (let i = 0; i < b.length - 1; i++) if (b[i + 1].close > b[i].close + 1) s.long[i] = true; return s; };
    const la = lookAheadCheck(m5, cheat, cheat(m5), 3, 30);
    expect(la.passed).toBe(false);
    expect(lookAheadCheck(m5, (b) => ema.compute(b, { fast: 9, slow: 21, trend: 0 }, { tzOffsetSec: 0 }).signals, sig).passed).toBe(true);
  });

  it('splits in-sample / out-of-sample and walk-forward windows covering the data', () => {
    const oos = outOfSample(m5, sig, DEFAULT_CONFIG, 0.7);
    expect(oos.outSample.from).toBeGreaterThan(oos.inSample.to);
    const wf = walkForward(m5, sig, DEFAULT_CONFIG, 5);
    expect(wf).toHaveLength(5);
    expect(wf[0].from).toBe(m5[0].time);
    expect(wf[4].to).toBe(m5[m5.length - 1].time);
  });

  it('Monte Carlo is deterministic per seed and brackets the median', () => {
    const a = monteCarlo(full.trades, 1000, 500, 1)!, b = monteCarlo(full.trades, 1000, 500, 1)!;
    expect(a).toEqual(b);
    expect(a.finalP5).toBeLessThanOrEqual(a.finalP50);
    expect(a.finalP50).toBeLessThanOrEqual(a.finalP95);
  });

  it('warns when there are too few trades', () => {
    const few = { ...full.stats, totalTrades: 8 };
    const w = overfittingWarnings(few, outOfSample(m5, sig, DEFAULT_CONFIG), walkForward(m5, sig, DEFAULT_CONFIG), null, 1000);
    expect(w.join(' ')).toMatch(/too few/);
  });
});
