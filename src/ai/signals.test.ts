import { describe, expect, it } from 'vitest';
import type { Bar } from '../market/types';
import { isDuplicate, signalStats, updateSignal } from './signals';
import { inQuietHours, scanStep, shouldNotify } from './monitor';
import { notificationText } from './explain';
import { auditNumbers } from './audit';
import { mergeConfig } from './config';
import { candleSet, snapshotAt, syntheticM1 } from './testdata';
import type { SignalRecord } from './types';

const T0 = 1_800_000_000; // bar time of the signal (M5)
const bar = (min: number, o: number, h: number, l: number, c: number): Bar => ({ time: T0 + 300 + min * 60, open: o, high: h, low: l, close: c });

function sig(side: 'BUY' | 'SELL', over: Partial<SignalRecord['plan']> = {}): SignalRecord {
  const buy = side === 'BUY';
  return {
    id: `t-${side}`, createdAt: T0, updatedAt: T0, side, status: 'CONFIRMED', outcome: 'PENDING_ENTRY', strategy: 'ema_stoch_cci', strategyName: 'EMA', entryTf: 'M5', barTime: T0,
    plan: {
      side, entryType: 'market', entryLow: buy ? 4080 : 4090, entryHigh: buy ? 4082 : 4092, entryRef: buy ? 4082 : 4090,
      sl: buy ? 4076 : 4096, slMethod: '', tp1: buy ? 4094 : 4078, tp2: buy ? 4100 : 4072, tpMethod: '', risk: 6, rr1: 2, rr2: 3, blockingLevel: null, invalidation: '', calc: [], ...over,
    },
    score: { trend: 16, structure: 15, indicators: 14, liquidity: 12, risk: 18, total: 75 },
    market: { source: 'mt5', live: true, bid: 4081, ask: 4081.2, spread: 0.2, digits: 2, updatedAt: T0 },
    reasonsFor: [], reasonsAgainst: [], biases: {}, reportId: 'r', candles: [],
  };
}
const cfg = { expiryBars: 6 };

describe('signal lifecycle', () => {
  it('fills, then hits TP1 then TP2', () => {
    const s = updateSignal(sig('BUY'), [bar(0, 4084, 4085, 4081, 4083), bar(1, 4083, 4095, 4083, 4094), bar(2, 4094, 4101, 4093, 4100)], 'M1', cfg, 0.2);
    expect(s.outcome).toBe('TP2_HIT');
    expect(s.filledAt).toBe(T0 + 300);
    expect(s.mfe).toBeGreaterThan(17);
  });

  it('marks AMBIGUOUS when SL and TP1 are inside the same candle', () => {
    const s = updateSignal(sig('BUY'), [bar(0, 4082, 4083, 4081, 4082), bar(1, 4082, 4095, 4075, 4085)], 'M1', cfg, 0.2);
    expect(s.outcome).toBe('AMBIGUOUS');
  });

  it('stop loss for a SELL triggers on ASK (bid high + spread)', () => {
    const s = updateSignal(sig('SELL'), [bar(0, 4089, 4091, 4088, 4090), bar(1, 4090, 4095.85, 4089, 4093)], 'M1', cfg, 0.2);
    expect(s.outcome).toBe('SL_HIT');
  });

  it('invalidates when price closes beyond the stop before entry', () => {
    const s2 = updateSignal(sig('BUY', { entryLow: 4070, entryHigh: 4071, sl: 4078 }), [bar(0, 4084, 4085, 4080, 4081), bar(1, 4081, 4081, 4076.5, 4077)], 'M1', cfg, 0.2);
    expect(s2.status).toBe('INVALIDATED');
    expect(s2.outcome).toBe('CANCELLED');
    expect(s2.filledAt).toBeNull();
  });

  it('expires as a missed entry if TP1 is reached first, and when stale', () => {
    const missed = updateSignal(sig('BUY', { entryLow: 4078, entryHigh: 4079 }), [bar(0, 4084, 4095, 4083, 4094)], 'M1', cfg, 0.2);
    expect(missed.status).toBe('EXPIRED');
    expect(missed.statusReason).toMatch(/Missed entry/);
    const stale = updateSignal(sig('BUY', { entryLow: 4070, entryHigh: 4071, sl: 4060 }), Array.from({ length: 40 }, (_, k) => bar(k, 4085, 4086, 4084, 4085)), 'M1', cfg, 0.2);
    expect(stale.status).toBe('EXPIRED');
  });

  it('prevents duplicates for overlapping active setups', () => {
    const a = sig('BUY');
    const b = { ...sig('BUY'), id: 'other' };
    expect(isDuplicate(b, [a])).toBe(true);
    expect(isDuplicate({ ...b, side: 'SELL' } as SignalRecord, [a])).toBe(false);
    expect(isDuplicate(b, [{ ...a, outcome: 'SL_HIT' }])).toBe(false);
  });

  it('computes R statistics with ambiguous outcomes excluded', () => {
    const st = signalStats([
      { ...sig('BUY'), outcome: 'TP2_HIT', createdAt: 1 },
      { ...sig('BUY'), outcome: 'SL_HIT', createdAt: 2 },
      { ...sig('BUY'), outcome: 'SL_HIT', createdAt: 3 },
      { ...sig('BUY'), outcome: 'AMBIGUOUS', createdAt: 4 },
    ]);
    expect(st.decided).toBe(3);
    expect(st.totalR).toBeCloseTo(1);
    expect(st.maxDrawdownR).toBeCloseTo(2);
    expect(st.maxConsecLosses).toBe(2);
    expect(st.ambiguous).toBe(1);
  });
});

describe('notifications', () => {
  it('formats the confirmed-signal notification from real plan values', () => {
    const t = notificationText(sig('BUY'));
    expect(t.title).toBe('XAUUSD BUY SIGNAL CONFIRMED');
    expect(t.body).toContain('Entry: 4080.00–4082.00');
    expect(t.body).toContain('SL: 4076.00');
    expect(t.body).toContain('TP1: 4094.00');
  });

  it('respects side toggles, min score and quiet hours (Cambodia time)', () => {
    const e = { type: 'confirmed' as const, signal: sig('SELL'), key: 'k' };
    expect(shouldNotify(e, { notify: { ...mergeConfig({}).notify, sell: false } }).ok).toBe(false);
    expect(shouldNotify(e, { notify: { ...mergeConfig({}).notify, minScore: 80 } }).ok).toBe(false);
    const night = Date.UTC(2026, 10, 15, 16, 30) / 1000; // 23:30 Phnom Penh
    expect(inQuietHours(night, '23:00', '06:00', 'Asia/Phnom_Penh')).toBe(true);
    expect(shouldNotify(e, { notify: { ...mergeConfig({}).notify, quietStart: '23:00', quietEnd: '06:00' } }, night).ok).toBe(false);
    expect(shouldNotify(e, {}, night).ok).toBe(true);
  });
});

describe('scan step', () => {
  it('creates each confirmed signal once and then tracks it', () => {
    const set = candleSet(syntheticM1(60 * 24 * 12, 9));
    const cfgS = mergeConfig({});
    let signals: SignalRecord[] = [];
    let created = 0, events = 0;
    for (let i = 900; i < set.M5!.length; i += 1) {
      const asOf = set.M5![i].time;
      const r = scanStep(set, snapshotAt(set, asOf), cfgS, signals, { asOf });
      signals = signals.map((s) => r.changed.find((c) => c.id === s.id) ?? s);
      if (r.created) { signals.push(r.created); created++; }
      events += r.events.filter((e) => e.type === 'confirmed').length;
    }
    expect(created).toBeGreaterThan(0);
    expect(events).toBe(created);
    expect(new Set(signals.map((s) => s.id)).size).toBe(signals.length);
    // after enough time every signal has left PENDING_ENTRY except possibly the newest
    const pending = signals.filter((s) => s.outcome === 'PENDING_ENTRY');
    expect(pending.length).toBeLessThanOrEqual(1);
  });
});

describe('AI answer audit', () => {
  it('flags prices that are not in the report', () => {
    const report = { plan: { sl: 4074, tp1: 4092 }, market: { bid: 4081.25 } };
    expect(auditNumbers('SL at 4074.00 and TP at 4092, price 4081.25', report)).toEqual([]);
    expect(auditNumbers('Resistance near 4111.5', report)).toEqual([4111.5]);
  });
});
