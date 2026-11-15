/**
 * Entry / stop-loss / take-profit engine. Prices are in the quote you would type into MT5:
 * BUY executes at ASK, SELL at BID. Every step is written to `calc` so each number is reproducible.
 */
import type { AnalysisContext } from './context';
import type { Candidate, MarketSnapshot, TradePlan } from './types';

const r = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export function buildPlan(ctx: AnalysisContext, cand: Candidate, mkt: MarketSnapshot): TradePlan | null {
  const cfg = ctx.cfg;
  const s = ctx.entry;
  const i = s.bars.length - 1;
  const atrNow = s.atr[i];
  if (!(atrNow > 0) || !(mkt.bid > 0)) return null;
  const d = mkt.digits || 2;
  const buy = cand.side === 'BUY';
  const dir = buy ? 1 : -1;
  const calc: string[] = [];
  calc.push(`ATR(${cfg.periods.atr}) on ${ctx.entryTf} = ${atrNow.toFixed(d)}; bid ${mkt.bid.toFixed(d)}, ask ${mkt.ask.toFixed(d)}, spread ${mkt.spread.toFixed(d)}`);

  // ---- entry ----
  let entryLow: number, entryHigh: number, entryRef: number;
  if (cand.zone) {
    // Zones are drawn on the (bid) chart; a BUY fills at bid + spread.
    entryLow = buy ? cand.zone.low + mkt.spread : cand.zone.low;
    entryHigh = buy ? cand.zone.high + mkt.spread : cand.zone.high;
    entryRef = buy ? entryHigh : entryLow; // worst fill inside the zone
    calc.push(`Entry zone from ${cand.zone.source} ${cand.zone.low.toFixed(d)}–${cand.zone.high.toFixed(d)} (bid chart)${buy ? ' + spread for ASK fills' : ''}`);
  } else {
    const band = 0.15 * atrNow;
    if (buy) { entryHigh = mkt.ask; entryLow = mkt.ask - band; entryRef = mkt.ask; }
    else { entryLow = mkt.bid; entryHigh = mkt.bid + band; entryRef = mkt.bid; }
    calc.push(`Market-entry reference ${entryRef.toFixed(d)} (${buy ? 'ASK' : 'BID'}); limit band 0.15×ATR = ${band.toFixed(d)}`);
  }

  // ---- stop loss ----
  const st = ctx.structure[ctx.entryTf];
  const buffer = cfg.slBufferAtr * atrNow + (buy ? 0 : mkt.spread); // shorts are stopped on ASK
  const swings = (st?.swings ?? []).filter((w) => w.kind === (buy ? 'low' : 'high') && (buy ? w.price < entryRef : w.price > entryRef));
  // Most recent swing whose stop distance is sensible (0.5–maxSlAtr ATR); otherwise the latest swing.
  const sensible = [...swings].reverse().find((w) => {
    const dist = Math.abs(entryRef - (w.price - dir * buffer));
    return dist >= 0.5 * atrNow && dist <= cfg.maxSlAtr * atrNow;
  });
  const swing = sensible ?? swings[swings.length - 1];
  const atrStop = entryRef - dir * cfg.atrSlMult * atrNow;
  let sl: number, slMethod: string;
  if (cand.sl != null && Number.isFinite(cand.sl) && (cand.sl - entryRef) * dir < 0) {
    sl = cand.sl; slMethod = 'strategy-defined stop';
    calc.push(`SL from strategy: ${sl.toFixed(d)}`);
  } else if (swing) {
    const structural = swing.price - dir * buffer;
    const dist = Math.abs(entryRef - structural);
    if (dist < 0.5 * atrNow) {
      sl = atrStop; slMethod = `ATR stop (${cfg.atrSlMult}×ATR) — structural stop too tight`;
      calc.push(`Swing ${buy ? 'low' : 'high'} ${swing.price.toFixed(d)} gives ${dist.toFixed(d)} < 0.5 ATR → ATR stop ${sl.toFixed(d)}`);
    } else {
      sl = structural; slMethod = `beyond last confirmed swing ${buy ? 'low' : 'high'} + buffer`;
      calc.push(`Swing ${buy ? 'low' : 'high'} ${swing.price.toFixed(d)} ${buy ? '−' : '+'} buffer ${buffer.toFixed(d)} (${cfg.slBufferAtr}×ATR${buy ? '' : ' + spread'}) = ${sl.toFixed(d)}`);
    }
  } else {
    sl = atrStop; slMethod = `ATR stop (${cfg.atrSlMult}×ATR) — no confirmed swing`;
    calc.push(`No confirmed swing → ${entryRef.toFixed(d)} ${buy ? '−' : '+'} ${cfg.atrSlMult}×ATR = ${sl.toFixed(d)}`);
  }
  const risk = Math.abs(entryRef - sl);
  calc.push(`Risk = |entry − SL| = ${risk.toFixed(d)} (${(risk / atrNow).toFixed(2)} ATR)`);

  // ---- take profits ----
  let tp1: number, tp2: number, tpMethod: string;
  if (cand.tp != null && Number.isFinite(cand.tp) && (cand.tp - entryRef) * dir > 0) {
    tp1 = cand.tp; tp2 = tp1 + dir * risk; tpMethod = 'strategy-defined target; TP2 = TP1 + 1R';
  } else {
    tp1 = entryRef + dir * cfg.minRR * risk;
    tp2 = entryRef + dir * (cfg.minRR + 1) * risk;
    tpMethod = `fixed ${cfg.minRR}R / ${cfg.minRR + 1}R`;
  }
  // Liquidity target for TP2: nearest resting liquidity between 2.5R and 5R.
  const pools = [ctx.structure[ctx.entryTf], ctx.structure.M15, ctx.structure.H1].flatMap((x) => x?.pools ?? [])
    .filter((p) => p.side === (buy ? 'buy' : 'sell'))
    .map((p) => p.price)
    .filter((p) => (p - entryRef) * dir >= 2.5 * risk && (p - entryRef) * dir <= 5 * risk)
    .sort((a, b) => Math.abs(a - entryRef) - Math.abs(b - entryRef));
  if (pools.length && !(cand.tp != null)) {
    tp2 = pools[0] - dir * 0.05 * atrNow;
    tpMethod += `; TP2 at ${buy ? 'buy' : 'sell'}-side liquidity ${pools[0].toFixed(d)}`;
  }
  calc.push(`TP1 ${tp1.toFixed(d)}, TP2 ${tp2.toFixed(d)} (${tpMethod})`);

  // ---- opposing structure that could block the move ----
  // Only meaningful structure can block a target: entry-TF levels tested twice, or any M15/H1 level.
  const opposing = [
    ...(ctx.structure[ctx.entryTf]?.levels ?? []).filter((l) => l.touches >= 2),
    ...(ctx.structure.M15?.levels ?? []),
    ...(ctx.structure.H1?.levels ?? []),
  ]
    .filter((l) => (l.price - entryRef) * dir > 0.3 * risk)
    .map((l) => l.price)
    .sort((a, b) => Math.abs(a - entryRef) - Math.abs(b - entryRef));
  const blockingLevel = opposing.length && Math.abs(opposing[0] - entryRef) < Math.abs(tp1 - entryRef) ? opposing[0] : null;
  if (blockingLevel != null) calc.push(`Opposing ${buy ? 'resistance' : 'support'} at ${blockingLevel.toFixed(d)} = ${(Math.abs(blockingLevel - entryRef) / risk).toFixed(2)}R before TP1`);

  const rr1 = Math.abs(tp1 - entryRef) / risk;
  const rr2 = Math.abs(tp2 - entryRef) / risk;
  const keyLevel = swing ? swing.price : sl;
  const invalidation = `${buy ? 'A close below' : 'A close above'} ${keyLevel.toFixed(d)} before entry, price reaching ${tp1.toFixed(d)} without filling the entry zone (missed entry), or no fill within ${cfg.expiryBars} ${ctx.entryTf} candles.`;

  return {
    side: cand.side, entryType: cand.entryType,
    entryLow: r(Math.min(entryLow, entryHigh), d), entryHigh: r(Math.max(entryLow, entryHigh), d), entryRef: r(entryRef, d),
    sl: r(sl, d), slMethod, tp1: r(tp1, d), tp2: r(tp2, d), tpMethod,
    risk: r(risk, d), rr1: Math.round(rr1 * 100) / 100, rr2: Math.round(rr2 * 100) / 100,
    blockingLevel: blockingLevel == null ? null : r(blockingLevel, d), invalidation, calc,
  };
}
