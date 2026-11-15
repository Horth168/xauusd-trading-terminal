/**
 * The five specialist agents. Each is a deterministic function over calculated values that returns a structured,
 * storable report: verdict, evidence (with the direction it supports), warnings and a 0–20 score for the proposed side.
 * (Agent roles follow the "investment committee" pattern of HKUDS/Vibe-Trading, re-implemented for XAUUSD.)
 */
import type { AnalysisContext } from './context';
import { fairValueGaps, isDisplacement, orderBlocks, premiumDiscount } from './smc';
import type { AgentReport, AnalysisTf, Bias, Evidence, MarketSnapshot, Side, TradePlan } from './types';

const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
const sideBias = (s: Side): Bias => (s === 'BUY' ? 'bullish' : 'bearish');
const clamp = (v: number) => Math.max(0, Math.min(20, Math.round(v)));

export function structureAgent(ctx: AnalysisContext, side: Side | null): AgentReport {
  const tf = ctx.entryTf;
  const st = ctx.structure[tf], m15 = ctx.structure.M15;
  const ev: Evidence[] = [];
  const warnings: string[] = [];
  if (!st) return { agent: 'structure', title: 'Market Structure Analyst', verdict: 'neutral', score: 0, maxScore: 20, summary: 'Not enough closed candles to read structure.', evidence: [], warnings: ['insufficient data'] };
  const i = (ctx.bars[tf]?.length ?? 1) - 1;
  ev.push({ label: `${tf} structure`, detail: st.trendLabel, supports: st.bias === 'bullish' ? 'BUY' : st.bias === 'bearish' ? 'SELL' : 'neutral' });
  if (m15) ev.push({ label: 'M15 structure', detail: m15.trendLabel, supports: m15.bias === 'bullish' ? 'BUY' : m15.bias === 'bearish' ? 'SELL' : 'neutral' });
  const lastEv = st.events[st.events.length - 1];
  if (lastEv) ev.push({ label: `Latest ${lastEv.kind}`, detail: `${lastEv.direction} through ${f(lastEv.level)} (${i - lastEv.index} bars ago)`, supports: lastEv.direction === 'bullish' ? 'BUY' : 'SELL' });
  const sup = st.levels.filter((l) => l.kind === 'support')[0], res = st.levels.filter((l) => l.kind === 'resistance')[0];
  if (sup) ev.push({ label: 'Nearest support', detail: `${f(sup.price)} (${sup.touches} touch${sup.touches > 1 ? 'es' : ''})`, supports: 'neutral' });
  if (res) ev.push({ label: 'Nearest resistance', detail: `${f(res.price)} (${res.touches} touch${res.touches > 1 ? 'es' : ''})`, supports: 'neutral' });
  for (const p of st.pools.slice(0, 3)) ev.push({ label: `${p.side === 'buy' ? 'Buy' : 'Sell'}-side liquidity`, detail: `equal ${p.side === 'buy' ? 'highs' : 'lows'} at ${f(p.price)}`, supports: 'neutral' });
  let score = 0;
  if (side) {
    const want = sideBias(side);
    if (st.bias === want) score += 10; else if (st.bias !== 'neutral') warnings.push(`${tf} structure is ${st.bias}, against a ${side}`);
    if (lastEv && lastEv.direction === want && i - lastEv.index <= 20) score += 5;
    const atrNow = ctx.ind[tf]?.atr ?? 0;
    const opp = side === 'BUY' ? res : sup;
    if (!opp || Math.abs(opp.price - st.lastClose) > 0.5 * atrNow) score += 5; else warnings.push(`price is within 0.5 ATR of ${side === 'BUY' ? 'resistance' : 'support'} ${f(opp.price)}`);
  }
  return { agent: 'structure', title: 'Market Structure Analyst', verdict: st.bias, score: clamp(score), maxScore: 20, summary: `${tf}: ${st.trendLabel}.`, evidence: ev, warnings, data: { bias: st.bias, events: st.events.slice(-5) } };
}

export function indicatorAgent(ctx: AnalysisContext, side: Side | null): AgentReport {
  const x = ctx.ind[ctx.entryTf];
  if (!x) return { agent: 'indicators', title: 'Technical Indicator Analyst', verdict: 'neutral', score: 0, maxScore: 20, summary: 'Indicators need more history.', evidence: [], warnings: ['insufficient data'] };
  const p = ctx.cfg.periods;
  const ev: Evidence[] = [
    { label: `EMA ${p.emaFast}/${p.emaSlow}`, detail: `${f(x.ema12)} / ${f(x.ema26)}`, supports: x.ema12 > x.ema26 ? 'BUY' : 'SELL' },
    { label: `Stochastic ${p.stochK},${p.stochSmooth},${p.stochD}`, detail: `K ${f(x.stochK, 1)}, D ${f(x.stochD, 1)}${x.stochK < 20 ? ' (oversold)' : x.stochK > 80 ? ' (overbought)' : ''}`, supports: x.stochK > x.stochD ? 'BUY' : 'SELL' },
    { label: `CCI ${p.cci}`, detail: f(x.cci, 1), supports: x.cci > 0 ? 'BUY' : 'SELL' },
    { label: `RSI ${p.rsi}`, detail: f(x.rsi, 1), supports: x.rsi > 50 ? 'BUY' : 'SELL' },
    { label: `ADX ${p.adx}`, detail: `${f(x.adx, 1)} (+DI ${f(x.plusDI, 1)} / −DI ${f(x.minusDI, 1)})${x.adx < 20 ? ' — weak trend' : ''}`, supports: x.plusDI > x.minusDI ? 'BUY' : 'SELL' },
    { label: `ATR ${p.atr}`, detail: f(x.atr), supports: 'neutral' },
  ];
  if (x.volume != null && x.volumeAvg != null) ev.push({ label: 'Tick volume', detail: `${x.volume} vs 20-bar avg ${f(x.volumeAvg, 0)}`, supports: 'neutral' });
  const bullVotes = ev.filter((e) => e.supports === 'BUY').length, bearVotes = ev.filter((e) => e.supports === 'SELL').length;
  const verdict: Bias = bullVotes >= bearVotes + 2 ? 'bullish' : bearVotes >= bullVotes + 2 ? 'bearish' : 'neutral';
  const warnings: string[] = [];
  let score = 0;
  if (side) {
    const buy = side === 'BUY';
    if (buy ? x.ema12 > x.ema26 : x.ema12 < x.ema26) score += 5; else warnings.push('EMA alignment contradicts the trade');
    if (buy ? x.stochK > x.stochD : x.stochK < x.stochD) score += 5;
    if (buy ? x.cci > -100 : x.cci < 100) score += 4;
    if (buy ? x.rsi < 70 : x.rsi > 30) score += 3; else warnings.push(`RSI ${f(x.rsi, 1)} is stretched in the trade direction`);
    if (x.adx >= 20) score += 3; else warnings.push(`ADX ${f(x.adx, 1)} — weak trend strength`);
  }
  return { agent: 'indicators', title: 'Technical Indicator Analyst', verdict, score: clamp(score), maxScore: 20, summary: `${bullVotes} bullish vs ${bearVotes} bearish readings on ${ctx.entryTf}.`, evidence: ev, warnings, data: { ...x } };
}

export function smcAgent(ctx: AnalysisContext, side: Side | null): AgentReport {
  const tf = ctx.entryTf;
  const st = ctx.structure[tf];
  const bars = ctx.bars[tf] ?? [];
  if (!st || bars.length < 30) return { agent: 'smc', title: 'Smart Money Concepts Analyst', verdict: 'neutral', score: 0, maxScore: 20, summary: 'Not enough data.', evidence: [], warnings: ['insufficient data'] };
  const atrArr = ctx.entry.atr;
  const i = bars.length - 1;
  const fvgs = fairValueGaps(bars, atrArr).filter((z) => !z.mitigated);
  const obs = orderBlocks(bars, st.events).filter((z) => !z.mitigated);
  const sweeps = st.sweeps.filter((s) => s.index >= i - 30);
  let disp: { dir: 'bullish' | 'bearish'; ago: number } | null = null;
  for (let k = i; k >= Math.max(0, i - 15); k--) { const d = isDisplacement(bars[k], atrArr[k]); if (d) { disp = { dir: d, ago: i - k }; break; } }
  const pd = premiumDiscount(st.swings, bars[i].close);
  const ev: Evidence[] = [];
  for (const s of sweeps.slice(-2)) ev.push({ label: `${s.side === 'buy' ? 'Buy' : 'Sell'}-side sweep`, detail: `wick ${f(s.extreme)} beyond ${f(s.level)}, closed back inside (${i - s.index} bars ago)`, supports: s.side === 'buy' ? 'SELL' : 'BUY' });
  for (const z of [...fvgs.slice(-2), ...obs.slice(-2)]) ev.push({ label: `${z.direction} ${z.kind}`, detail: `${f(z.bottom)}–${f(z.top)} (unmitigated)`, supports: z.direction === 'bullish' ? 'BUY' : 'SELL' });
  if (disp) ev.push({ label: 'Displacement', detail: `${disp.dir} candle ${disp.ago} bars ago (body ≥ 1.2 ATR)`, supports: disp.dir === 'bullish' ? 'BUY' : 'SELL' });
  ev.push({ label: 'Premium / discount', detail: Number.isFinite(pd.pct) ? `${pd.zone} (${(pd.pct * 100).toFixed(0)}% of ${f(pd.low)}–${f(pd.high)})` : 'range unknown', supports: pd.zone === 'discount' ? 'BUY' : pd.zone === 'premium' ? 'SELL' : 'neutral' });
  const b = ev.filter((e) => e.supports === 'BUY').length, s = ev.filter((e) => e.supports === 'SELL').length;
  let score = 0;
  const warnings: string[] = [];
  if (side) {
    const buy = side === 'BUY';
    if (sweeps.some((w) => w.side === (buy ? 'sell' : 'buy'))) score += 6;
    if ([...fvgs, ...obs].some((z) => z.direction === (buy ? 'bullish' : 'bearish'))) score += 6;
    if (disp?.dir === (buy ? 'bullish' : 'bearish')) score += 4;
    if (buy ? pd.zone !== 'premium' : pd.zone !== 'discount') score += 4; else warnings.push(`${side} from ${pd.zone} — poor location`);
  }
  return {
    agent: 'smc', title: 'Smart Money Concepts Analyst', verdict: b > s ? 'bullish' : s > b ? 'bearish' : 'neutral', score: clamp(score), maxScore: 20,
    summary: `${sweeps.length} recent sweep(s), ${fvgs.length} open FVG, ${obs.length} active order block(s); price in ${pd.zone}. Patterns are read from OHLC only — no order-flow data.`,
    evidence: ev, warnings, data: { fvgs, obs, sweeps, pd },
  };
}

export function mtfAgent(ctx: AnalysisContext, side: Side | null): AgentReport {
  const tfs: AnalysisTf[] = ['H4', 'H1', 'M15', ctx.entryTf];
  const roles: Record<string, string> = { H4: 'major trend', H1: 'trading bias', M15: 'setup', M5: 'entry', M1: 'refinement' };
  const weights: Record<string, number> = { H4: 6, H1: 6, M15: 4, M5: 4, M1: 4 };
  const ev: Evidence[] = [];
  const biases: Partial<Record<AnalysisTf, Bias>> = {};
  for (const tf of Array.from(new Set(tfs))) {
    const st = ctx.structure[tf];
    const ind = ctx.ind[tf];
    let bias: Bias = st?.bias ?? 'neutral';
    // Tie-break a neutral structure with EMA alignment.
    if (bias === 'neutral' && ind) bias = ind.ema12 > ind.ema26 && ind.close > ind.ema26 ? 'bullish' : ind.ema12 < ind.ema26 && ind.close < ind.ema26 ? 'bearish' : 'neutral';
    biases[tf] = bias;
    ev.push({ label: `${tf} (${roles[tf]})`, detail: st ? `${bias} — ${st.trendLabel}` : 'no data', supports: bias === 'bullish' ? 'BUY' : bias === 'bearish' ? 'SELL' : 'neutral' });
  }
  const vals = Object.values(biases);
  const agree = vals.every((v) => v === vals[0]) && vals[0] !== 'neutral';
  let score = 0;
  const warnings: string[] = [];
  if (side) {
    const want = sideBias(side);
    for (const [tf, b] of Object.entries(biases)) {
      if (b === want) score += weights[tf] ?? 0;
      else if (b !== 'neutral') warnings.push(`${tf} is ${b} — conflicts with ${side}`);
    }
  }
  const verdict: Bias = agree ? vals[0] : (biases.H1 === biases.H4 ? biases.H1 ?? 'neutral' : 'neutral');
  return { agent: 'mtf', title: 'Multi-Timeframe Analyst', verdict, score: clamp(score), maxScore: 20, summary: agree ? `All timeframes ${vals[0]}.` : 'Timeframes are not fully aligned.', evidence: ev, warnings, data: { biases } };
}

export function riskAgent(ctx: AnalysisContext, side: Side | null, plan: TradePlan | null, mkt: MarketSnapshot): AgentReport {
  const cfg = ctx.cfg;
  const ev: Evidence[] = [];
  const warnings: string[] = [];
  const atrNow = ctx.ind[ctx.entryTf]?.atr ?? NaN;
  ev.push({ label: 'Spread', detail: `${f(mkt.spread, mkt.digits)} (max ${f(cfg.maxSpread)})`, supports: 'neutral' });
  ev.push({ label: 'Data', detail: mkt.live ? `LIVE ${mkt.server ?? 'Exness MT5'}` : `${mkt.source} — not live Exness data`, supports: 'neutral' });
  if (!side || !plan) return { agent: 'risk', title: 'Risk Analyst', verdict: 'fail', score: 0, maxScore: 20, summary: 'No trade plan to evaluate.', evidence: ev, warnings };
  let score = 0;
  const fails: string[] = [];
  ev.push({ label: 'Risk : reward', detail: `1 : ${plan.rr1.toFixed(2)} (TP1), 1 : ${plan.rr2.toFixed(2)} (TP2)`, supports: 'neutral' });
  ev.push({ label: 'Stop distance', detail: `${f(plan.risk)} = ${(plan.risk / atrNow).toFixed(2)} ATR — ${plan.slMethod}`, supports: 'neutral' });
  if (plan.rr1 >= cfg.minRR - 1e-9) score += 6; else fails.push(`RR ${plan.rr1.toFixed(2)} below minimum ${cfg.minRR}`);
  if (plan.blockingLevel == null) score += 2; else {
    const room = Math.abs(plan.blockingLevel - plan.entryRef) / plan.risk;
    if (room < cfg.minRR) fails.push(`target blocked by ${side === 'BUY' ? 'resistance' : 'support'} ${f(plan.blockingLevel)} at ${room.toFixed(2)}R`);
    else warnings.push(`level ${f(plan.blockingLevel)} before TP1`);
  }
  if (mkt.spread <= cfg.maxSpread) score += 4; else fails.push(`spread ${f(mkt.spread)} above maximum ${f(cfg.maxSpread)}`);
  const slAtr = plan.risk / atrNow;
  if (slAtr <= cfg.maxSlAtr) score += 4; else fails.push(`stop ${slAtr.toFixed(2)} ATR wider than ${cfg.maxSlAtr} ATR`);
  // Late entry: current price already moved > 0.5R past the worst entry price toward the target.
  const cur = side === 'BUY' ? mkt.ask : mkt.bid;
  const run = (cur - plan.entryRef) * (side === 'BUY' ? 1 : -1);
  if (run <= 0.5 * plan.risk) score += 4; else fails.push(`late entry: price is ${(run / plan.risk).toFixed(2)}R beyond the entry`);
  if (!mkt.live) fails.push('market data is not live Exness MT5 data');
  for (const x of fails) warnings.push(x);
  return { agent: 'risk', title: 'Risk Analyst', verdict: fails.length ? 'fail' : 'pass', score: fails.length ? Math.min(clamp(score), 10) : clamp(score), maxScore: 20, summary: fails.length ? `Rejected: ${fails.join('; ')}.` : 'Risk parameters acceptable.', evidence: ev, warnings, data: { fails } };
}
