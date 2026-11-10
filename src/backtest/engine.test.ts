import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, runBacktest, type BacktestConfig } from './engine';
import { emptySignals } from '../indicators/types';
import type { Bar } from '../market/types';
import { aggregate } from '../market/aggregate';
import { getTimeframe, bucketStart } from '../market/timeframes';
import { ema, rsi, sma } from '../indicators/ta';
import { runScript } from '../indicators/runtime';

const bar = (i: number, o: number, h: number, l: number, c: number): Bar => ({ time: 1700000000 + i * 3600, open: o, high: h, low: l, close: c });

const cfg = (p: Partial<BacktestConfig> = {}): BacktestConfig => ({
  ...DEFAULT_CONFIG,
  initialBalance: 10000,
  sizing: { mode: 'fixed', lots: 1 },
  spread: 0,
  slippage: 0,
  sl: { mode: 'points', value: 10, atrLength: 14 },
  tp: { mode: 'points', levels: [{ value: 20, closePct: 100 }], atrLength: 14 },
  exitOnSignal: false,
  ...p,
});

describe('backtest engine', () => {
  it('fills at next bar open (no look-ahead) and hits TP', () => {
    const bars = [bar(0, 2000, 2001, 1999, 2000), bar(1, 2002, 2003, 2001, 2002), bar(2, 2002, 2025, 2001, 2024)];
    const s = emptySignals(bars.length);
    s.long[0] = true;
    const r = runBacktest(bars, s, cfg());
    expect(r.trades).toHaveLength(1);
    const t = r.trades[0];
    expect(t.entryTime).toBe(bars[1].time);
    expect(t.entryPrice).toBe(2002);
    expect(t.exitReason).toBe('TP');
    expect(t.exitPrice).toBe(2022);
    expect(t.pnl).toBeCloseTo(20 * 100); // 1 lot = 100 oz
  });

  it('pessimistic mode takes SL when both SL and TP are inside one bar', () => {
    const bars = [bar(0, 2000, 2000, 2000, 2000), bar(1, 2000, 2000, 2000, 2000), bar(2, 2000, 2030, 1980, 2010)];
    const s = emptySignals(3);
    s.long[0] = true;
    expect(runBacktest(bars, s, cfg()).trades[0].exitReason).toBe('SL');
    expect(runBacktest(bars, s, cfg({ intrabar: 'optimistic' })).trades[0].exitReason).toBe('TP');
  });

  it('applies spread: long buys at ask, short SL triggers on ask', () => {
    const bars = [bar(0, 2000, 2000, 2000, 2000), bar(1, 2000, 2000, 2000, 2000), bar(2, 2000, 2000, 2000, 2000)];
    const s = emptySignals(3);
    s.long[0] = true;
    const r = runBacktest(bars, s, cfg({ spread: 0.3 }));
    expect(r.trades[0].entryPrice).toBeCloseTo(2000.3);
    expect(r.trades[0].exitReason).toBe('End');
    expect(r.trades[0].pnl).toBeCloseTo(-0.3 * 100);

    const s2 = emptySignals(3);
    s2.short[0] = true;
    // bid high 2009.8 + spread 0.3 = ask 2010.1 >= SL 2010
    const bars2 = [bar(0, 2000, 2000, 2000, 2000), bar(1, 2000, 2000, 2000, 2000), bar(2, 2000, 2009.8, 1999, 2000)];
    const r2 = runBacktest(bars2, s2, cfg({ spread: 0.3 }));
    expect(r2.trades[0].exitReason).toBe('SL');
  });

  it('gap through stop fills at the open, not the stop', () => {
    const bars = [bar(0, 2000, 2000, 2000, 2000), bar(1, 2000, 2001, 1999, 2000), bar(2, 1980, 1985, 1975, 1982)];
    const s = emptySignals(3);
    s.long[0] = true;
    const t = runBacktest(bars, s, cfg()).trades[0];
    expect(t.exitReason).toBe('SL');
    expect(t.exitPrice).toBe(1980);
  });

  it('partial take profits and break-even', () => {
    const bars = [bar(0, 2000, 2000, 2000, 2000), bar(1, 2000, 2000, 2000, 2000), bar(2, 2000, 2011, 1999, 2010), bar(3, 2010, 2010, 1999, 2000)];
    const s = emptySignals(4);
    s.long[0] = true;
    const r = runBacktest(bars, s, cfg({
      tp: { mode: 'points', levels: [{ value: 10, closePct: 50 }, { value: 30, closePct: 50 }], atrLength: 14 },
      breakeven: { enabled: true, triggerR: 1, offset: 0 },
      intrabar: 'ohlc',
    }));
    const t = r.trades[0];
    expect(t.fills.map((f) => f.reason)).toEqual(['TP', 'BE']);
    expect(t.fills[0].lots).toBeCloseTo(0.5);
    expect(t.pnl).toBeCloseTo(10 * 50);
  });

  it('risk sizing and margin rejection', () => {
    const bars = [bar(0, 2000, 2000, 2000, 2000), bar(1, 2000, 2000, 2000, 2000), bar(2, 2000, 2000, 2000, 2000)];
    const s = emptySignals(3);
    s.long[0] = true;
    const r = runBacktest(bars, s, cfg({ sizing: { mode: 'risk', riskPct: 1 } }));
    expect(r.trades[0].lots).toBeCloseTo(0.1); // $100 risk / (10 * 100)
    const r2 = runBacktest(bars, s, cfg({ sizing: { mode: 'fixed', lots: 50 }, leverage: 100 }));
    expect(r2.trades).toHaveLength(0);
    expect(r2.skipped[0].reason).toMatch(/margin/);
  });

  it('stats: drawdown, profit factor, streaks', () => {
    const bars: Bar[] = [];
    for (let i = 0; i < 12; i++) bars.push(bar(i, 2000, 2000, 2000, 2000));
    bars[2] = bar(2, 2000, 2025, 2000, 2020); // win
    bars[5] = bar(5, 2000, 2000, 1985, 1990); // loss
    bars[8] = bar(8, 2000, 2000, 1985, 1990); // loss
    const s = emptySignals(bars.length);
    s.long[0] = s.long[3] = s.long[6] = true;
    const r = runBacktest(bars, s, cfg());
    expect(r.stats.totalTrades).toBe(3);
    expect(r.stats.wins).toBe(1);
    expect(r.stats.maxConsecLosses).toBe(2);
    expect(r.stats.profitFactor).toBeCloseTo(2000 / 2000);
    expect(r.stats.maxDrawdown).toBeCloseTo(2000);
  });
});

describe('indicators are causal', () => {
  it('values do not change when future bars are appended', () => {
    const closes = Array.from({ length: 300 }, (_, i) => 2000 + Math.sin(i / 7) * 10 + i * 0.1);
    const a = ema(closes.slice(0, 200), 21), b = ema(closes, 21);
    const r1 = rsi(closes.slice(0, 200), 14), r2 = rsi(closes, 14);
    for (let i = 0; i < 200; i++) {
      expect(a[i]).toEqual(b[i]);
      expect(r1[i]).toEqual(r2[i]);
    }
    expect(sma([1, 2, 3, 4], 2)).toEqual([NaN, 1.5, 2.5, 3.5]);
  });
});

describe('timeframe aggregation', () => {
  it('builds M2 from M1 without inventing prices', () => {
    const m1 = [0, 1, 2, 3].map((i) => ({ time: 1700000040 + i * 60, open: 10 + i, high: 20 + i, low: 5 - i, close: 11 + i }));
    const m2 = aggregate(m1, getTimeframe('M2'));
    expect(m2).toHaveLength(m1[0].time % 120 === 0 ? 2 : 3);
    for (const b of m2) expect(b.time % 120).toBe(0);
  });
  it('weekly buckets start on Sunday UTC', () => {
    const wed = Date.UTC(2024, 0, 10, 12) / 1000;
    expect(new Date(bucketStart(wed, getTimeframe('W1')) * 1000).getUTCDay()).toBe(0);
  });
});

describe('custom script runtime', () => {
  it('runs a Pine-style script and produces plots, signals and inputs', () => {
    const bars = Array.from({ length: 120 }, (_, i) => { const c = 2000 + Math.sin(i / 6) * 15; return bar(i, c, c + 1, c - 1, c); });
    const code = `
      indicator('Test', { overlay: true });
      const len = input.int('Length', 10, { min: 1 });
      const m = ta.sma(close, len);
      plot(m, 'MA');
      for (let i = 1; i < bar_count; i++) if (ta.crossover(close, m, i)) buy(i);
      if (typeof fetch !== 'undefined') throw new Error('fetch leaked');
    `;
    const r = runScript(code, bars, { length: 5 });
    expect(r.meta.name).toBe('Test');
    expect(r.meta.inputs[0]).toMatchObject({ id: 'length', default: 10 });
    expect(r.output.plots[0].values[3]).toBeNaN();
    expect(Number.isFinite(r.output.plots[0].values[4])).toBe(true);
    expect(r.output.signals.long.some(Boolean)).toBe(true);
  });
});
