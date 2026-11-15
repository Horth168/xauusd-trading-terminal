import { describe, expect, it } from 'vitest';
import type { Bar } from '../market/types';
import { findSwings, structureEvents, classifyTrend } from './structure';
import { fairValueGaps } from './smc';
import { closedBars, buildContext } from './context';
import { analyze } from './analyze';
import { mergeConfig } from './config';
import { buildPlan } from './levels';
import { candleSet, snapshotAt, syntheticM1 } from './testdata';

const B = (i: number, o: number, h: number, l: number, c: number): Bar => ({ time: 1_700_000_000 + i * 300, open: o, high: h, low: l, close: c });

/** zig-zag price path from pivot values (each leg = 4 bars) */
function zigzag(pivots: number[]): Bar[] {
  const bars: Bar[] = [];
  let i = 0;
  for (let p = 0; p < pivots.length - 1; p++) {
    for (let k = 0; k < 4; k++) {
      const a = pivots[p] + ((pivots[p + 1] - pivots[p]) * k) / 4, b = pivots[p] + ((pivots[p + 1] - pivots[p]) * (k + 1)) / 4;
      bars.push(B(i++, a, Math.max(a, b) + 0.05, Math.min(a, b) - 0.05, b));
    }
  }
  return bars;
}

describe('market structure', () => {
  it('finds confirmed swings and classifies higher highs / higher lows', () => {
    const bars = zigzag([100, 110, 105, 115, 108, 120, 112, 125]);
    const sw = findSwings(bars, 2);
    expect(sw.filter((s) => s.kind === 'high').map((s) => Math.round(s.price))).toEqual([110, 115, 120]);
    expect(classifyTrend(sw).bias).toBe('bullish');
  });

  it('emits BOS in-trend and CHOCH on reversal, only after a swing is confirmed', () => {
    const bars = zigzag([100, 110, 105, 115, 108, 120, 112, 100, 104, 95]);
    const sw = findSwings(bars, 2);
    const ev = structureEvents(bars, sw, 2);
    expect(ev.some((e) => e.kind === 'BOS' && e.direction === 'bullish')).toBe(true);
    const choch = ev.find((e) => e.kind === 'CHOCH');
    expect(choch?.direction).toBe('bearish');
    // every event breaks a swing that was confirmed (index + lookback) before the breaking bar
    for (const e of ev) {
      const s = sw.find((x) => Math.abs(x.price - e.level) < 1e-9);
      expect(s && s.index + 2 <= e.index).toBe(true);
    }
  });

  it('detects a bullish fair value gap and its mitigation', () => {
    const bars = [B(0, 100, 101, 99.5, 100.8), B(1, 100.8, 104, 100.7, 103.9), B(2, 103.9, 104.5, 102, 104.2), B(3, 104.2, 104.4, 103, 103.5)];
    const z = fairValueGaps(bars, [1, 1, 1, 1], 0.1);
    expect(z[0]).toMatchObject({ kind: 'FVG', direction: 'bullish', bottom: 101, top: 102, mitigated: false });
    const z2 = fairValueGaps([...bars, B(4, 103.5, 103.6, 100.5, 101)], [1, 1, 1, 1, 1], 0.1);
    expect(z2[0].mitigated).toBe(true);
  });
});

describe('no look-ahead', () => {
  const m1 = syntheticM1(60 * 24 * 6, 11);
  const set = candleSet(m1);

  it('closedBars excludes the forming candle', () => {
    const t = set.M5![100].time + 120; // 2 minutes into bar 100
    const cb = closedBars(set.M5, 'M5', t);
    expect(cb[cb.length - 1].time).toBe(set.M5![99].time);
  });

  it('a report is identical whether or not future candles exist', () => {
    const asOf = set.M5![1200].time;
    const cut: typeof set = {};
    for (const [tf, bars] of Object.entries(set)) (cut as any)[tf] = bars!.filter((b) => b.time < asOf);
    const a = analyze(set, snapshotAt(set, asOf), {}, { asOf });
    const b = analyze(cut, snapshotAt(set, asOf), {}, { asOf });
    const strip = (r: any) => ({ ...r, createdAt: 0 });
    expect(strip(a)).toEqual(strip(b));
  });
});

describe('signal engine invariants (property test over simulated market)', () => {
  const m1 = syntheticM1(60 * 24 * 12, 3);
  const set = candleSet(m1);
  const cfg = mergeConfig({ minScore: 55, sessions: { asia: true, london: true, newyork: true } });
  const reports = [] as ReturnType<typeof analyze>[];
  for (let i = 900; i < set.M5!.length; i += 6) {
    const asOf = set.M5![i].time;
    reports.push(analyze(set, snapshotAt(set, asOf), cfg, { asOf }));
  }

  it('WAIT is the default and confirmations are rare', () => {
    const confirmed = reports.filter((r) => r.status === 'CONFIRMED');
    expect(confirmed.length).toBeGreaterThan(0);
    expect(confirmed.length / reports.length).toBeLessThan(0.25);
  });

  it('every CONFIRMED signal satisfies all mandatory rules and consistent levels', () => {
    for (const r of reports.filter((x) => x.status === 'CONFIRMED')) {
      const p = r.plan!;
      expect(r.decision).toBe(p.side);
      expect(r.score.total).toBeGreaterThanOrEqual(cfg.minScore);
      expect(p.rr1).toBeGreaterThanOrEqual(cfg.minRR - 1e-6);
      expect(r.agents.find((a) => a.agent === 'risk')!.verdict).toBe('pass');
      if (p.side === 'BUY') expect(p.sl < p.entryLow && p.entryLow <= p.entryHigh && p.entryHigh < p.tp1 && p.tp1 < p.tp2).toBe(true);
      else expect(p.tp2 < p.tp1 && p.tp1 < p.entryLow && p.entryLow <= p.entryHigh && p.entryHigh < p.sl).toBe(true);
      expect(r.reasonsFor.length).toBeGreaterThan(0);
      expect(r.score.total).toBe(r.score.trend + r.score.structure + r.score.indicators + r.score.liquidity + r.score.risk);
    }
  });

  it('never confirms from delayed / non-Exness data', () => {
    const asOfs = reports.filter((r) => r.status === 'CONFIRMED').map((r) => r.market.updatedAt);
    for (const asOf of asOfs.slice(0, 10)) {
      const r = analyze(set, snapshotAt(set, asOf, false), cfg, { asOf });
      expect(r.status).not.toBe('CONFIRMED');
      expect(r.decision).toBe('WAIT');
      expect(r.waitReasons.join(' ')).toMatch(/not live Exness/);
    }
  });

  it('rejects when spread exceeds the maximum', () => {
    const asOf = reports.find((r) => r.status === 'CONFIRMED')!.market.updatedAt;
    const r = analyze(set, snapshotAt(set, asOf, true, 1.5), cfg, { asOf });
    expect(r.status).not.toBe('CONFIRMED');
  });
});

describe('entry / SL / TP engine', () => {
  it('places a BUY stop beyond the last swing low with buffer and targets at 2R/3R', () => {
    const m1 = syntheticM1(60 * 24 * 5, 5);
    const set = candleSet(m1);
    const asOf = set.M5![1000].time;
    const cfg = mergeConfig({});
    const ctx = buildContext(set, asOf, cfg);
    const mkt = snapshotAt(set, asOf);
    const plan = buildPlan(ctx, { side: 'BUY', strategy: 't', strategyName: 't', entryType: 'market', conditions: [], triggerTime: asOf }, mkt)!;
    expect(plan.entryRef).toBeCloseTo(mkt.ask, 2);
    expect(plan.sl).toBeLessThan(plan.entryRef);
    expect(Math.abs(plan.tp1 - plan.entryRef)).toBeCloseTo(2 * plan.risk, 1);
    expect(plan.calc.length).toBeGreaterThan(2);
    const sp = buildPlan(ctx, { side: 'SELL', strategy: 't', strategyName: 't', entryType: 'market', conditions: [], triggerTime: asOf }, mkt)!;
    expect(sp.entryRef).toBeCloseTo(mkt.bid, 2);
    expect(sp.sl).toBeGreaterThan(sp.entryRef);
    expect(sp.tp1).toBeLessThan(sp.entryRef);
  });
});
