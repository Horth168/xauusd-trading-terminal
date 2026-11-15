/**
 * Strategy rule sets. Each evaluates the last CLOSED entry-timeframe bar and reports every condition (met or not),
 * so the app can show exactly what is missing before an entry. Strategies only propose candidates; the
 * level engine, risk agent and final reviewer decide whether a signal is CONFIRMED.
 */
import { crossover, crossunder } from '../indicators/ta';
import { runScript } from '../indicators/runtime';
import type { AnalysisContext } from './context';
import { fairValueGaps, inZone, isDisplacement, orderBlocks, premiumDiscount } from './smc';
import type { Candidate, Side, Zone } from './types';

type Cond = Candidate['conditions'][number];

export interface StrategyDef {
  id: string;
  name: string;
  description: string;
  evaluate: (ctx: AnalysisContext, side: Side) => Candidate | null;
}

const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');

/** Did a cross happen within the last `n` closed bars (ending at the last bar)? Returns bars ago or -1. */
function recentCross(a: number[], b: number[] | number, n: number, dir: 'up' | 'down'): number {
  const last = a.length - 1;
  for (let k = 0; k < n; k++) {
    const i = last - k;
    if (i < 1) break;
    if (dir === 'up' ? crossover(a, b, i) : crossunder(a, b, i)) return k;
  }
  return -1;
}

function mk(side: Side, id: string, name: string, ctx: AnalysisContext, conditions: Cond[], extra: Partial<Candidate> = {}): Candidate {
  const last = ctx.entry.bars[ctx.entry.bars.length - 1];
  return { side, strategy: id, strategyName: name, entryType: 'market', conditions, triggerTime: last?.time ?? 0, ...extra };
}

export const emaStochCci: StrategyDef = {
  id: 'ema_stoch_cci',
  name: 'EMA + Stochastic + CCI',
  description: 'EMA 12/26 trend, Stochastic 5,3,3 cross from extreme, CCI ±100 cross, bullish/bearish candle and structure support.',
  evaluate(ctx, side) {
    const s = ctx.entry, n = s.bars.length, i = n - 1;
    if (n < 60) return null;
    const st = ctx.structure[ctx.entryTf];
    const buy = side === 'BUY';
    const lb = ctx.cfg.triggerLookback;
    const bar = s.bars[i];
    const recentEvent = st?.events.filter((e) => e.index >= i - 10).pop();
    const emaOk = buy ? s.ema12[i] > s.ema26[i] : s.ema12[i] < s.ema26[i];
    const transition = recentEvent && recentEvent.direction === (buy ? 'bullish' : 'bearish');
    const kx = recentCross(s.k, s.d, lb, buy ? 'up' : 'down');
    const kxOk = kx >= 0 && (buy ? s.d[i - kx] < 20 || s.k[i - kx - 1] < 20 : s.d[i - kx] > 80 || s.k[i - kx - 1] > 80);
    const cx = recentCross(s.cci, buy ? -100 : 100, lb, buy ? 'up' : 'down');
    const momentum = buy ? bar.close > bar.open && bar.close > s.ema12[i] : bar.close < bar.open && bar.close < s.ema12[i];
    const swingsKnown = (st?.swings ?? []).filter((w) => w.kind === (buy ? 'low' : 'high'));
    const lastSwing = swingsKnown[swingsKnown.length - 1];
    const structOk = !!lastSwing && (buy ? bar.close > lastSwing.price && st!.bias !== 'bearish' : bar.close < lastSwing.price && st!.bias !== 'bullish');
    return mk(side, this.id, this.name, ctx, [
      { label: `EMA 12 ${buy ? 'above' : 'below'} EMA 26 or confirmed ${buy ? 'bullish' : 'bearish'} transition`, met: emaOk || !!transition, mandatory: true, detail: `EMA12 ${fmt(s.ema12[i])} vs EMA26 ${fmt(s.ema26[i])}${transition ? `; ${recentEvent!.kind} ${recentEvent!.direction} at ${fmt(recentEvent!.level)}` : ''}` },
      { label: `Stochastic K crosses ${buy ? 'above' : 'below'} D ${buy ? 'below 20' : 'above 80'}`, met: kxOk, mandatory: true, detail: kx >= 0 ? `cross ${kx} bar(s) ago, K ${fmt(s.k[i - kx], 1)} / D ${fmt(s.d[i - kx], 1)}` : `no cross in last ${lb} bars (K ${fmt(s.k[i], 1)}, D ${fmt(s.d[i], 1)})` },
      { label: `CCI crosses ${buy ? 'above -100' : 'below +100'}`, met: cx >= 0, mandatory: true, detail: cx >= 0 ? `cross ${cx} bar(s) ago, CCI now ${fmt(s.cci[i], 1)}` : `CCI ${fmt(s.cci[i], 1)}, no cross in last ${lb} bars` },
      { label: `${buy ? 'Bullish' : 'Bearish'} momentum candle beyond EMA 12`, met: momentum, mandatory: true, detail: `last close ${fmt(bar.close)} (open ${fmt(bar.open)}), EMA12 ${fmt(s.ema12[i])}` },
      { label: `Entry supported by market structure`, met: structOk, mandatory: true, detail: lastSwing ? `last confirmed swing ${buy ? 'low' : 'high'} ${fmt(lastSwing.price)}, ${ctx.entryTf} bias ${st?.bias}` : 'no confirmed swing yet' },
    ]);
  },
};

export const smcStrategy: StrategyDef = {
  id: 'smc',
  name: 'Smart Money Concepts',
  description: 'Liquidity sweep → CHOCH/BOS → displacement → FVG or order-block retest with confirmation.',
  evaluate(ctx, side) {
    const s = ctx.entry, n = s.bars.length, i = n - 1;
    const st = ctx.structure[ctx.entryTf];
    if (n < 60 || !st) return null;
    const buy = side === 'BUY';
    const atrNow = s.atr[i];
    const sweep = [...st.sweeps].reverse().find((w) => w.side === (buy ? 'sell' : 'buy') && w.index >= i - 25);
    const brk = sweep ? st.events.find((e) => e.index > sweep.index && e.direction === (buy ? 'bullish' : 'bearish')) : undefined;
    let disp = -1;
    if (sweep) for (let k = sweep.index; k <= i; k++) if (isDisplacement(s.bars[k], s.atr[k]) === (buy ? 'bullish' : 'bearish')) { disp = k; break; }
    const zones: Zone[] = [...fairValueGaps(s.bars, s.atr), ...orderBlocks(s.bars, st.events)]
      .filter((z) => z.direction === (buy ? 'bullish' : 'bearish') && !z.mitigated && (!sweep || z.index >= sweep.index - 3));
    const zone = zones.sort((a, b) => b.index - a.index)[0];
    const bar = s.bars[i];
    const retest = !!zone && (inZone(bar.low, zone, 0.2 * atrNow) || inZone(bar.close, zone, 0.2 * atrNow)) && (buy ? bar.close > zone.bottom && bar.close > bar.open : bar.close < zone.top && bar.close < bar.open);
    const pd = premiumDiscount(st.swings, bar.close);
    const pdOk = buy ? pd.zone === 'discount' || pd.zone === 'equilibrium' : pd.zone === 'premium' || pd.zone === 'equilibrium';
    return mk(side, this.id, this.name, ctx, [
      { label: `${buy ? 'Sell-side' : 'Buy-side'} liquidity sweep`, met: !!sweep, mandatory: true, detail: sweep ? `swept ${fmt(sweep.level)} (wick to ${fmt(sweep.extreme)}) ${i - sweep.index} bars ago` : 'no recent sweep' },
      { label: `${buy ? 'Bullish' : 'Bearish'} CHOCH/BOS after the sweep`, met: !!brk, mandatory: true, detail: brk ? `${brk.kind} through ${fmt(brk.level)}` : 'no structure break yet' },
      { label: 'Displacement candle (body ≥ 1.2 ATR)', met: disp >= 0, mandatory: true, detail: disp >= 0 ? `${i - disp} bars ago` : 'none since the sweep' },
      { label: `Unmitigated ${buy ? 'bullish' : 'bearish'} FVG / order block`, met: !!zone, mandatory: true, detail: zone ? `${zone.kind} ${fmt(zone.bottom)}–${fmt(zone.top)}` : 'no fresh zone' },
      { label: 'Retest of the zone with confirmation candle', met: retest, mandatory: true, detail: zone ? `last bar L ${fmt(bar.low)} C ${fmt(bar.close)}` : '—' },
      { label: `Price in ${buy ? 'discount' : 'premium'} of the dealing range`, met: pdOk, mandatory: false, detail: Number.isFinite(pd.pct) ? `${(pd.pct * 100).toFixed(0)}% of ${fmt(pd.low)}–${fmt(pd.high)}` : 'range unknown' },
    ], zone ? { entryType: 'retest', zone: { low: zone.bottom, high: zone.top, source: zone.kind } } : {});
  },
};

export const mtfTrend: StrategyDef = {
  id: 'mtf_trend',
  name: 'Multi-Timeframe Trend',
  description: 'H4 + H1 directional bias, M15 pullback setup, M5 entry confirmation.',
  evaluate(ctx, side) {
    const s = ctx.entry, n = s.bars.length, i = n - 1;
    if (n < 60) return null;
    const want = side === 'BUY' ? 'bullish' : 'bearish';
    const buy = side === 'BUY';
    const h4 = ctx.structure.H4?.bias, h1 = ctx.structure.H1?.bias;
    const m15 = ctx.bars.M15 ?? [];
    const m15i = ctx.ind.M15;
    let pullback = false, pbDetail = 'no M15 data';
    if (m15.length > 30 && m15i) {
      const recent = m15.slice(-6);
      const touchedEma = recent.some((b) => (buy ? b.low <= m15i.ema26 : b.high >= m15i.ema26));
      const rsiPull = buy ? m15i.rsi < 55 : m15i.rsi > 45;
      pullback = touchedEma || rsiPull;
      pbDetail = `M15 EMA26 ${fmt(m15i.ema26)}${touchedEma ? ' touched' : ''}, RSI ${fmt(m15i.rsi, 1)}`;
    }
    const ex = recentCross(s.ema12, s.ema26, ctx.cfg.triggerLookback, buy ? 'up' : 'down');
    const kx = recentCross(s.k, s.d, ctx.cfg.triggerLookback, buy ? 'up' : 'down');
    const close = s.bars[i].close;
    return mk(side, this.id, this.name, ctx, [
      { label: `H4 bias ${want}`, met: h4 === want, mandatory: true, detail: `H4 ${h4 ?? 'n/a'}` },
      { label: `H1 bias ${want}`, met: h1 === want, mandatory: true, detail: `H1 ${h1 ?? 'n/a'}` },
      { label: 'M15 pullback into value', met: pullback, mandatory: true, detail: pbDetail },
      { label: `M5 confirmation (EMA or Stochastic ${buy ? 'bullish' : 'bearish'} cross)`, met: ex >= 0 || kx >= 0, mandatory: true, detail: ex >= 0 ? `EMA cross ${ex} bars ago` : kx >= 0 ? `Stoch cross ${kx} bars ago` : 'no trigger' },
      { label: `M5 close ${buy ? 'above' : 'below'} EMA 12`, met: buy ? close > s.ema12[i] : close < s.ema12[i], mandatory: true, detail: `close ${fmt(close)}, EMA12 ${fmt(s.ema12[i])}` },
    ]);
  },
};

export const BUILTIN_AI_STRATEGIES: StrategyDef[] = [emaStochCci, smcStrategy, mtfTrend];

/** Strategy D: a saved XTS strategy script (existing runtime) evaluated on the entry timeframe. */
export function scriptStrategy(id: string, name: string, code: string, params: Record<string, unknown> = {}): StrategyDef {
  return {
    id: `custom:${id}`,
    name,
    description: 'Custom XTS strategy script',
    evaluate(ctx, side) {
      const bars = ctx.entry.bars;
      if (bars.length < 30) return null;
      const out = runScript(code, bars, params).output;
      const i = bars.length - 1;
      const lb = ctx.cfg.triggerLookback;
      let at = -1;
      for (let k = 0; k < lb && i - k >= 0; k++) if ((side === 'BUY' ? out.signals.long : out.signals.short)[i - k]) { at = i - k; break; }
      return mk(side, `custom:${id}`, name, ctx, [
        { label: `Script ${side === 'BUY' ? 'long' : 'short'} signal on a closed bar`, met: at >= 0, mandatory: true, detail: at >= 0 ? `${i - at} bars ago` : 'no signal' },
      ], { sl: at >= 0 && Number.isFinite(out.signals.sl[at]) ? out.signals.sl[at] : undefined, tp: at >= 0 && Number.isFinite(out.signals.tp[at]) ? out.signals.tp[at] : undefined });
    },
  };
}
