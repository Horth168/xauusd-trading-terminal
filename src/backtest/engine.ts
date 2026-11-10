/**
 * Candle-based backtesting engine for XAUUSD.
 *
 * Execution model (documented in the UI):
 * - Signals are evaluated on bar CLOSE using causal indicators; orders fill at the NEXT bar's open.
 * - Chart prices are BID (as in MT5). Longs buy at ask (= bid + spread) and exit at bid.
 *   Shorts sell at bid and buy back at ask, so a short's SL/TP trigger on ask = bid + spread.
 * - Slippage is applied against you on every market fill and stop fill. TP (limit) fills at its level.
 * - Gaps: if a bar opens beyond SL/TP, the order fills at the open price.
 * - Intrabar order is unknown with OHLC data. Mode 'pessimistic' assumes the adverse extreme first,
 *   'optimistic' the favourable one, 'ohlc' uses O→L→H→C for bullish bars and O→H→L→C for bearish bars.
 * - Trailing stops update at bar close (applied from the next bar). Break-even triggers intrabar along the path.
 * - Swap/overnight financing is not modelled.
 */
import type { Bar } from '../market/types';
import type { SignalOutput } from '../indicators/types';
import { atr as atrFn } from '../indicators/ta';

export interface TpLevel { value: number; closePct: number }

export interface BacktestConfig {
  initialBalance: number;
  sizing: { mode: 'fixed'; lots: number } | { mode: 'risk'; riskPct: number };
  contractSize: number; // oz per lot (Exness XAUUSD: 100)
  lotStep: number; // 0.01
  minLot: number;
  spread: number; // price units, e.g. 0.20 = 20 points on 2-digit gold
  commissionPerLot: number; // USD per lot, round turn
  slippage: number; // price units, adverse
  leverage: number; // e.g. 200 => margin = notional / 200
  direction: 'both' | 'long' | 'short';
  sl: { mode: 'none' | 'points' | 'atr' | 'signal'; value: number; atrLength: number };
  tp: { mode: 'none' | 'rr' | 'points' | 'atr' | 'signal'; levels: TpLevel[]; atrLength: number };
  breakeven: { enabled: boolean; triggerR: number; offset: number };
  trailing: { enabled: boolean; mode: 'points' | 'atr'; distance: number; activateR: number; atrLength: number };
  intrabar: 'pessimistic' | 'optimistic' | 'ohlc';
  exitOnSignal: boolean; // close on strategy exit / opposite signal
  reverseOnOpposite: boolean;
  closeAtEnd: boolean;
}

export const DEFAULT_CONFIG: BacktestConfig = {
  initialBalance: 1000,
  sizing: { mode: 'risk', riskPct: 1 },
  contractSize: 100,
  lotStep: 0.01,
  minLot: 0.01,
  spread: 0.2,
  commissionPerLot: 0,
  slippage: 0.05,
  leverage: 200,
  direction: 'both',
  sl: { mode: 'atr', value: 1.5, atrLength: 14 },
  tp: { mode: 'rr', levels: [{ value: 2, closePct: 100 }], atrLength: 14 },
  breakeven: { enabled: false, triggerR: 1, offset: 0 },
  trailing: { enabled: false, mode: 'atr', distance: 2, activateR: 1, atrLength: 14 },
  intrabar: 'pessimistic',
  exitOnSignal: true,
  reverseOnOpposite: false,
  closeAtEnd: true,
};

export type ExitReason = 'SL' | 'TP' | 'BE' | 'Trail' | 'Signal' | 'Reverse' | 'End' | 'StopOut';

export interface Fill { time: number; price: number; lots: number; reason: ExitReason; pnl: number }

export interface Trade {
  id: number;
  side: 'long' | 'short';
  signalTime: number;
  entryTime: number;
  entryPrice: number;
  lots: number;
  initialSl: number; // NaN if none
  tps: number[];
  exitTime: number;
  exitPrice: number; // volume-weighted
  exitReason: ExitReason;
  fills: Fill[];
  grossPnl: number;
  commission: number;
  pnl: number; // net
  rMultiple: number; // net pnl / initial risk $
  riskUsd: number;
  bars: number;
  mfe: number; // max favourable excursion (price units)
  mae: number; // max adverse excursion (price units)
  balanceAfter: number;
}

export interface CurvePoint { time: number; balance: number; equity: number }

export interface BacktestResult {
  trades: Trade[];
  curve: CurvePoint[];
  skipped: { time: number; reason: string }[];
  warnings: string[];
  stats: Stats;
  monthly: { month: string; pnl: number; trades: number; winRate: number; returnPct: number }[];
}

export interface Stats {
  totalTrades: number; wins: number; losses: number; breakeven: number; winRate: number;
  netProfit: number; grossProfit: number; grossLoss: number; profitFactor: number; commission: number;
  maxDrawdown: number; maxDrawdownPct: number; maxBalanceDrawdown: number;
  avgWin: number; avgLoss: number; avgRR: number; avgR: number; expectedPayoff: number;
  largestWin: number; largestLoss: number; maxConsecWins: number; maxConsecLosses: number;
  finalBalance: number; returnPct: number; avgBars: number; longTrades: number; shortTrades: number;
  longWinRate: number; shortWinRate: number; sharpe: number; recoveryFactor: number;
}

interface Position {
  id: number; side: 'long' | 'short'; signalTime: number; entryTime: number; entryIdx: number; entryPrice: number;
  lots: number; openLots: number; sl: number; initialSl: number; tps: { price: number; lots: number; done: boolean }[];
  beDone: boolean; trailActive: boolean; fills: Fill[]; riskPerUnit: number; mfe: number; mae: number;
}

const roundLots = (l: number, step: number) => Math.floor(l / step + 1e-9) * step;

export function runBacktest(bars: Bar[], signals: SignalOutput, cfg: BacktestConfig): BacktestResult {
  const n = bars.length;
  const trades: Trade[] = [];
  const curve: CurvePoint[] = [];
  const skipped: { time: number; reason: string }[] = [];
  const warnings: string[] = [];
  const atrSl = atrFn(bars, cfg.sl.atrLength);
  const atrTp = atrFn(bars, cfg.tp.atrLength);
  const atrTr = atrFn(bars, cfg.trailing.atrLength);
  const cs = cfg.contractSize;
  let balance = cfg.initialBalance;
  let pos = null as Position | null; // assigned inside open(); the cast stops TS narrowing it to null
  let pending: { side: 'long' | 'short'; signalIdx: number } | null = null;
  let pendingExit: ExitReason | null = null;
  let seq = 0;
  let stopped = false;

  const sign = (side: 'long' | 'short') => (side === 'long' ? 1 : -1);
  // Price you receive when closing at a given BID-based level.
  const closeFillFromBid = (side: 'long' | 'short', bidLevel: number) => (side === 'long' ? bidLevel : bidLevel + cfg.spread);

  const pnlOf = (p: Position, exitPrice: number, lots: number) => (exitPrice - p.entryPrice) * sign(p.side) * lots * cs;

  const closePart = (p: Position, time: number, price: number, lots: number, reason: ExitReason) => {
    const l = Math.min(lots, p.openLots);
    if (l <= 1e-9) return;
    const gross = pnlOf(p, price, l);
    const comm = cfg.commissionPerLot * l;
    balance += gross - comm;
    p.openLots = +(p.openLots - l).toFixed(8);
    p.fills.push({ time, price, lots: l, reason, pnl: gross - comm });
  };

  const finalize = (p: Position, idx: number) => {
    const lots = p.fills.reduce((a, f) => a + f.lots, 0);
    const exitPrice = p.fills.reduce((a, f) => a + f.price * f.lots, 0) / lots;
    const net = p.fills.reduce((a, f) => a + f.pnl, 0);
    const commission = cfg.commissionPerLot * lots;
    const riskUsd = Number.isFinite(p.initialSl) ? Math.abs(p.entryPrice - p.initialSl) * p.lots * cs : NaN;
    const last = p.fills[p.fills.length - 1];
    trades.push({
      id: p.id, side: p.side, signalTime: p.signalTime, entryTime: p.entryTime, entryPrice: p.entryPrice, lots: p.lots,
      initialSl: p.initialSl, tps: p.tps.map((t) => t.price), exitTime: last.time, exitPrice, exitReason: last.reason, fills: p.fills,
      grossPnl: net + commission, commission, pnl: net, riskUsd, rMultiple: riskUsd > 0 ? net / riskUsd : NaN,
      bars: idx - p.entryIdx + 1, mfe: p.mfe, mae: p.mae, balanceAfter: balance,
    });
  };

  const open = (side: 'long' | 'short', signalIdx: number, idx: number) => {
    const b = bars[idx];
    if (cfg.direction !== 'both' && cfg.direction !== side) return;
    const entry = side === 'long' ? b.open + cfg.spread + cfg.slippage : b.open - cfg.slippage;
    // Distances are computed from information available at the signal bar's close.
    let slDist = NaN;
    if (cfg.sl.mode === 'points') slDist = cfg.sl.value;
    else if (cfg.sl.mode === 'atr') slDist = atrSl[signalIdx] * cfg.sl.value;
    else if (cfg.sl.mode === 'signal' && Number.isFinite(signals.sl[signalIdx])) slDist = Math.abs(entry - signals.sl[signalIdx]);
    if (cfg.sl.mode !== 'none' && !(slDist > 0)) { skipped.push({ time: b.time, reason: 'Stop distance unavailable (indicator warm-up)' }); return; }
    const sl = Number.isFinite(slDist) ? entry - sign(side) * slDist : NaN;

    let lots: number;
    if (cfg.sizing.mode === 'fixed') lots = cfg.sizing.lots;
    else {
      if (!Number.isFinite(slDist)) { skipped.push({ time: b.time, reason: 'Risk sizing requires a stop loss' }); return; }
      lots = roundLots((balance * cfg.sizing.riskPct) / 100 / (slDist * cs), cfg.lotStep);
      if (lots < cfg.minLot) { skipped.push({ time: b.time, reason: `Position below minimum lot (${cfg.minLot}) at ${cfg.sizing.riskPct}% risk` }); return; }
    }
    const margin = (lots * cs * entry) / cfg.leverage;
    if (margin > balance) { skipped.push({ time: b.time, reason: `Insufficient margin (${margin.toFixed(2)} > balance)` }); return; }

    const tpDists: { dist: number; pct: number }[] = [];
    if (cfg.tp.mode === 'signal' && Number.isFinite(signals.tp[signalIdx])) tpDists.push({ dist: Math.abs(signals.tp[signalIdx] - entry), pct: 100 });
    else if (cfg.tp.mode !== 'none' && cfg.tp.mode !== 'signal') {
      for (const lv of cfg.tp.levels) {
        const d = cfg.tp.mode === 'rr' ? (Number.isFinite(slDist) ? slDist * lv.value : NaN) : cfg.tp.mode === 'points' ? lv.value : atrTp[signalIdx] * lv.value;
        if (d > 0) tpDists.push({ dist: d, pct: lv.closePct });
      }
    }
    tpDists.sort((a, c) => a.dist - c.dist);
    let remaining = lots;
    const tps = tpDists.map((t, k) => {
      const l = k === tpDists.length - 1 ? remaining : Math.min(remaining, roundLots((lots * t.pct) / 100, cfg.lotStep));
      remaining = +(remaining - l).toFixed(8);
      return { price: entry + sign(side) * t.dist, lots: l, done: false };
    }).filter((t) => t.lots > 0);

    pos = { id: ++seq, side, signalTime: bars[signalIdx].time, entryTime: b.time, entryIdx: idx, entryPrice: entry, lots, openLots: lots, sl, initialSl: sl, tps, beDone: false, trailActive: false, fills: [], riskPerUnit: slDist, mfe: 0, mae: 0 };
  };

  /** Walk the intrabar path and trigger SL / TP / BE events in the order they would be touched. */
  const processBar = (p: Position, idx: number) => {
    const b = bars[idx];
    const bull = b.close >= b.open;
    const adverseFirst = cfg.intrabar === 'pessimistic' ? true : cfg.intrabar === 'optimistic' ? false : p.side === 'long' ? bull : !bull;
    // For a long, adverse = low; for a short, adverse = high.
    const adverse = p.side === 'long' ? b.low : b.high;
    const favour = p.side === 'long' ? b.high : b.low;
    const path = adverseFirst ? [b.open, adverse, favour, b.close] : [b.open, favour, adverse, b.close];
    // The position's "exit side" price: longs watch BID, shorts watch ASK = bid + spread.
    const px = (bid: number) => (p.side === 'long' ? bid : bid + cfg.spread);
    const s = sign(p.side);
    const fav = (price: number) => (price - p.entryPrice) * s;
    p.mfe = Math.max(p.mfe, fav(px(favour)));
    p.mae = Math.max(p.mae, -fav(px(adverse)));

    for (let k = 0; k < path.length - 1 && p.openLots > 1e-9; k++) {
      const a = px(path[k]), c = px(path[k + 1]);
      if (k === 0) {
        // Gap through levels at the open
        if (Number.isFinite(p.sl) && fav(a) <= fav(p.sl)) { closePart(p, b.time, a - s * cfg.slippage, p.openLots, p.beDone && p.sl === p.entryPrice + s * cfg.breakeven.offset ? 'BE' : p.trailActive ? 'Trail' : 'SL'); break; }
        for (const t of p.tps) if (!t.done && fav(a) >= fav(t.price)) { t.done = true; closePart(p, b.time, a, t.lots, 'TP'); }
      }
      // events on segment a -> c, ordered by distance from a
      type Ev = { at: number; kind: 'sl' | 'tp' | 'be'; tp?: (typeof p.tps)[number] };
      const evs: Ev[] = [];
      const between = (lv: number) => (a <= c ? lv >= Math.min(a, c) && lv <= Math.max(a, c) : lv <= Math.max(a, c) && lv >= Math.min(a, c));
      if (Number.isFinite(p.sl) && between(p.sl) && fav(c) <= fav(p.sl)) evs.push({ at: Math.abs(p.sl - a), kind: 'sl' });
      for (const t of p.tps) if (!t.done && between(t.price) && fav(c) >= fav(t.price)) evs.push({ at: Math.abs(t.price - a), kind: 'tp', tp: t });
      if (cfg.breakeven.enabled && !p.beDone && p.riskPerUnit > 0) {
        const trig = p.entryPrice + s * p.riskPerUnit * cfg.breakeven.triggerR;
        if (between(trig) && fav(c) >= fav(trig)) evs.push({ at: Math.abs(trig - a), kind: 'be' });
      }
      evs.sort((x, y) => x.at - y.at);
      for (const ev of evs) {
        if (p.openLots <= 1e-9) break;
        if (ev.kind === 'sl') {
          if (!(fav(c) <= fav(p.sl))) continue; // SL may have moved (BE) above this segment
          const reason: ExitReason = p.trailActive ? 'Trail' : p.beDone && Math.abs(p.sl - (p.entryPrice + s * cfg.breakeven.offset)) < 1e-9 ? 'BE' : 'SL';
          closePart(p, b.time, p.sl - s * cfg.slippage, p.openLots, reason);
        } else if (ev.kind === 'tp') {
          ev.tp!.done = true;
          closePart(p, b.time, ev.tp!.price, ev.tp!.lots, 'TP');
        } else {
          p.beDone = true;
          const be = p.entryPrice + s * cfg.breakeven.offset;
          if (!Number.isFinite(p.sl) || fav(be) > fav(p.sl)) p.sl = be;
          // a BE stop placed during this segment can be hit later in the same segment
          if (fav(c) <= fav(p.sl) && between(p.sl)) closePart(p, b.time, p.sl - s * cfg.slippage, p.openLots, 'BE');
        }
      }
    }
  };

  const updateTrailing = (p: Position, idx: number) => {
    if (!cfg.trailing.enabled || p.openLots <= 1e-9) return;
    const b = bars[idx];
    const s = sign(p.side);
    const closePx = p.side === 'long' ? b.close : b.close + cfg.spread;
    const profit = (closePx - p.entryPrice) * s;
    const activateDist = (p.riskPerUnit > 0 ? p.riskPerUnit : 0) * cfg.trailing.activateR;
    if (profit < activateDist) return;
    const dist = cfg.trailing.mode === 'points' ? cfg.trailing.distance : atrTr[idx] * cfg.trailing.distance;
    if (!(dist > 0)) return;
    const candidate = closePx - s * dist;
    if (!Number.isFinite(p.sl) || (candidate - p.sl) * s > 0) { p.sl = candidate; p.trailActive = true; }
  };

  for (let i = 0; i < n && !stopped; i++) {
    const b = bars[i];
    // 1) fills at this bar's open for decisions made at the previous close
    if (pos && pendingExit) {
      const exitPx = closeFillFromBid(pos.side, b.open) - sign(pos.side) * cfg.slippage;
      closePart(pos, b.time, exitPx, pos.openLots, pendingExit);
      finalize(pos, i);
      pos = null;
    }
    pendingExit = null;
    if (!pos && pending) open(pending.side, pending.signalIdx, i);
    pending = null;

    // 2) intrabar SL/TP/BE
    if (pos) {
      processBar(pos, i);
      if (pos.openLots <= 1e-9) { finalize(pos, i); pos = null; }
    }

    // 3) equity & stop-out at close
    let equity = balance;
    if (pos) {
      const px = pos.side === 'long' ? b.close : b.close + cfg.spread;
      equity += pnlOf(pos, px, pos.openLots);
      if (equity <= 0) {
        closePart(pos, b.time, px, pos.openLots, 'StopOut');
        finalize(pos, i);
        pos = null;
        equity = balance;
        warnings.push(`Account stopped out on ${new Date(b.time * 1000).toISOString().slice(0, 10)}`);
        stopped = true;
      }
    }
    curve.push({ time: b.time, balance, equity });
    if (balance <= 0) { stopped = true; break; }

    // 4) decisions at this bar's close (executed at next open)
    if (i === n - 1) break;
    if (pos) {
      updateTrailing(pos, i);
      const opp = pos.side === 'long' ? signals.short[i] : signals.long[i];
      const ex = pos.side === 'long' ? signals.exitLong[i] : signals.exitShort[i];
      if (cfg.reverseOnOpposite && opp) { pendingExit = 'Reverse'; pending = { side: pos.side === 'long' ? 'short' : 'long', signalIdx: i }; }
      else if (cfg.exitOnSignal && (ex || opp)) pendingExit = 'Signal';
    } else {
      if (signals.long[i] && !signals.short[i]) pending = { side: 'long', signalIdx: i };
      else if (signals.short[i] && !signals.long[i]) pending = { side: 'short', signalIdx: i };
    }
  }

  if (pos) {
    const p = pos as Position;
    const last = bars[n - 1];
    if (cfg.closeAtEnd) {
      closePart(p, last.time, closeFillFromBid(p.side, last.close), p.openLots, 'End');
      finalize(p, n - 1);
      if (curve.length) curve[curve.length - 1] = { time: last.time, balance, equity: balance };
    } else warnings.push('A position was still open at the end of the test and is excluded from statistics.');
  }

  return { trades, curve, skipped, warnings, stats: computeStats(trades, curve, cfg.initialBalance), monthly: monthlyStats(trades, cfg.initialBalance) };
}

export function computeStats(trades: Trade[], curve: CurvePoint[], initial: number): Stats {
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl < 0);
  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.pnl, 0);
  const net = grossProfit - grossLoss;
  let peakE = initial, maxDD = 0, maxDDPct = 0, peakB = initial, maxBDD = 0;
  for (const c of curve) {
    peakE = Math.max(peakE, c.equity);
    const dd = peakE - c.equity;
    if (dd > maxDD) maxDD = dd;
    if (peakE > 0) maxDDPct = Math.max(maxDDPct, (dd / peakE) * 100);
    peakB = Math.max(peakB, c.balance);
    maxBDD = Math.max(maxBDD, peakB - c.balance);
  }
  let cw = 0, cl = 0, mcw = 0, mcl = 0;
  for (const t of trades) {
    if (t.pnl > 0) { cw++; cl = 0; } else if (t.pnl < 0) { cl++; cw = 0; } else { cw = 0; cl = 0; }
    mcw = Math.max(mcw, cw); mcl = Math.max(mcl, cl);
  }
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const rs = trades.map((t) => t.rMultiple).filter(Number.isFinite);
  const longs = trades.filter((t) => t.side === 'long'), shorts = trades.filter((t) => t.side === 'short');
  const rets = trades.map((t) => t.pnl / Math.max(1e-9, t.balanceAfter - t.pnl));
  const mean = rets.reduce((a, r) => a + r, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length || 1));
  const finalBalance = initial + net;
  return {
    totalTrades: trades.length, wins: wins.length, losses: losses.length, breakeven: trades.length - wins.length - losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    netProfit: net, grossProfit, grossLoss, profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    commission: trades.reduce((a, t) => a + t.commission, 0),
    maxDrawdown: maxDD, maxDrawdownPct: maxDDPct, maxBalanceDrawdown: maxBDD,
    avgWin, avgLoss, avgRR: avgLoss ? avgWin / avgLoss : 0, avgR: rs.length ? rs.reduce((a, r) => a + r, 0) / rs.length : NaN,
    expectedPayoff: trades.length ? net / trades.length : 0,
    largestWin: wins.length ? Math.max(...wins.map((t) => t.pnl)) : 0, largestLoss: losses.length ? Math.min(...losses.map((t) => t.pnl)) : 0,
    maxConsecWins: mcw, maxConsecLosses: mcl, finalBalance, returnPct: (net / initial) * 100,
    avgBars: trades.length ? trades.reduce((a, t) => a + t.bars, 0) / trades.length : 0,
    longTrades: longs.length, shortTrades: shorts.length,
    longWinRate: longs.length ? (longs.filter((t) => t.pnl > 0).length / longs.length) * 100 : 0,
    shortWinRate: shorts.length ? (shorts.filter((t) => t.pnl > 0).length / shorts.length) * 100 : 0,
    sharpe: sd ? (mean / sd) * Math.sqrt(trades.length) : 0,
    recoveryFactor: maxDD ? net / maxDD : 0,
  };
}

export function monthlyStats(trades: Trade[], initial: number) {
  const map = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = new Date(t.exitTime * 1000).toISOString().slice(0, 7);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(t);
  }
  let bal = initial;
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, ts]) => {
    const pnl = ts.reduce((a, t) => a + t.pnl, 0);
    const start = bal;
    bal += pnl;
    return { month, pnl, trades: ts.length, winRate: (ts.filter((t) => t.pnl > 0).length / ts.length) * 100, returnPct: start ? (pnl / start) * 100 : 0 };
  });
}
