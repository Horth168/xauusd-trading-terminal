/**
 * Signal lifecycle and outcome tracking, driven only by subsequent real candles.
 * CONFIRMED → (entry zone touched) OPEN → TP1_HIT / TP2_HIT / SL_HIT / AMBIGUOUS
 *           → INVALIDATED (structure broken before entry) / EXPIRED (stale or missed entry)
 * If SL and a target are both inside one candle and tick order is unknown, the outcome is AMBIGUOUS.
 */
import type { Bar } from '../market/types';
import type { AiConfig } from './config';
import { TF_SECONDS } from './config';
import type { AnalysisReport, AnalysisTf, SignalRecord } from './types';

export const signalId = (r: Pick<AnalysisReport, 'strategy' | 'decision' | 'entryTf' | 'barTime'>) => `${r.strategy}-${r.decision}-${r.entryTf}-${r.barTime}`.replace(/[^A-Za-z0-9_-]/g, '_');

export function toSignal(report: AnalysisReport, candles: Bar[], now = Math.floor(Date.now() / 1000)): SignalRecord {
  if (report.status !== 'CONFIRMED' || !report.plan || report.decision === 'WAIT') throw new Error('Only CONFIRMED reports become signals');
  return {
    id: signalId(report),
    createdAt: now,
    updatedAt: now,
    side: report.decision,
    status: 'CONFIRMED',
    outcome: 'PENDING_ENTRY',
    strategy: report.strategy!,
    strategyName: report.strategyName!,
    entryTf: report.entryTf,
    barTime: report.barTime,
    plan: report.plan,
    score: report.score,
    market: report.market,
    reasonsFor: report.reasonsFor.slice(0, 12),
    reasonsAgainst: report.reasonsAgainst.slice(0, 8),
    biases: report.biases,
    reportId: report.id,
    candles: candles.slice(-150),
    filledAt: null, fillPrice: null, closedAt: null, exitPrice: null, mfe: 0, mae: 0, timeToTargetSec: null,
    statusReason: 'All mandatory rules met',
  };
}

const active = (s: SignalRecord) => s.status === 'CONFIRMED' && (s.outcome === 'PENDING_ENTRY' || s.outcome === 'OPEN');

/**
 * Duplicate prevention: same id, or an active signal on the same side whose entry zone overlaps
 * (or lies within 0.5 R) of the new one.
 */
export function isDuplicate(candidate: SignalRecord, existing: SignalRecord[]): boolean {
  return existing.some((s) => {
    if (s.id === candidate.id) return true;
    if (!active(s) || s.side !== candidate.side) return false;
    const pad = 0.5 * Math.max(s.plan.risk, candidate.plan.risk);
    return candidate.plan.entryLow <= s.plan.entryHigh + pad && candidate.plan.entryHigh >= s.plan.entryLow - pad;
  });
}

/**
 * Advance a signal using candles that closed after its creation bar. `bars` may be M1 (finer) or the entry TF;
 * `spread` converts bid candles into ask prices for BUY fills and SELL stops.
 */
export function updateSignal(sig: SignalRecord, bars: Bar[], barTf: AnalysisTf, cfg: Pick<AiConfig, 'expiryBars'>, spread = sig.market.spread, maxHoldBars = 288): SignalRecord {
  if (!['PENDING_ENTRY', 'OPEN', 'TP1_HIT'].includes(sig.outcome) || sig.status === 'INVALIDATED' || sig.status === 'EXPIRED') return sig;
  const s: SignalRecord = { ...sig };
  const p = s.plan;
  const buy = s.side === 'BUY';
  const entryTfSec = TF_SECONDS[s.entryTf];
  const after = bars.filter((b) => b.time >= s.barTime + entryTfSec).sort((a, b) => a.time - b.time);
  const sec = TF_SECONDS[barTf];
  const expiryAt = s.barTime + entryTfSec + cfg.expiryBars * entryTfSec;
  // "Exit-side" prices: a long is closed at BID, a short at ASK (bid + spread).
  const hiX = (b: Bar) => (buy ? b.high : b.high + spread);
  const loX = (b: Bar) => (buy ? b.low : b.low + spread);
  // "Entry-side" prices: a long fills at ASK, a short at BID.
  const loE = (b: Bar) => (buy ? b.low + spread : b.low);
  const hiE = (b: Bar) => (buy ? b.high + spread : b.high);

  for (const b of after) {
    if (s.outcome === 'PENDING_ENTRY') {
      const filled = buy ? loE(b) <= p.entryHigh : hiE(b) >= p.entryLow;
      const tpReached = buy ? hiX(b) >= p.tp1 : loX(b) <= p.tp1;
      const broke = buy ? b.close < p.sl : b.close > p.sl;
      if (!filled && tpReached) { s.status = 'EXPIRED'; s.outcome = 'EXPIRED'; s.statusReason = `Missed entry: price reached TP1 ${p.tp1} before the entry zone was filled`; s.closedAt = b.time + sec; break; }
      if (!filled && broke) { s.status = 'INVALIDATED'; s.outcome = 'CANCELLED'; s.statusReason = `Invalidated: candle closed ${buy ? 'below' : 'above'} ${p.sl} before entry`; s.closedAt = b.time + sec; break; }
      if (!filled && b.time + sec > expiryAt) { s.status = 'EXPIRED'; s.outcome = 'EXPIRED'; s.statusReason = `Expired: entry not reached within ${cfg.expiryBars} ${s.entryTf} candles`; s.closedAt = expiryAt; break; }
      if (!filled) continue;
      s.outcome = 'OPEN';
      s.filledAt = b.time;
      // fill at the zone edge, or at the open if the candle gapped through it
      s.exitPrice = null;
      s.fillPrice = buy ? Math.min(p.entryHigh, b.open + spread) : Math.max(p.entryLow, b.open);
    }
    // OPEN / TP1_HIT tracking (including the fill candle itself)
    const fill = s.fillPrice ?? p.entryRef;
    const fav = buy ? hiX(b) - fill : fill - loX(b);
    const adv = buy ? fill - loX(b) : hiX(b) - fill;
    s.mfe = Math.max(s.mfe ?? 0, fav);
    s.mae = Math.max(s.mae ?? 0, adv);
    const slHit = buy ? loX(b) <= p.sl : hiX(b) >= p.sl;
    const tp1Hit = buy ? hiX(b) >= p.tp1 : loX(b) <= p.tp1;
    const tp2Hit = buy ? hiX(b) >= p.tp2 : loX(b) <= p.tp2;
    if (s.outcome === 'OPEN') {
      if (slHit && tp1Hit) { s.outcome = 'AMBIGUOUS'; s.statusReason = 'SL and TP1 inside the same candle — tick order unknown'; s.closedAt = b.time + sec; break; }
      if (slHit) { s.outcome = 'SL_HIT'; s.exitPrice = p.sl; s.closedAt = b.time + sec; s.statusReason = 'Stop loss hit'; break; }
      if (tp2Hit) { s.outcome = 'TP2_HIT'; s.exitPrice = p.tp2; s.closedAt = b.time + sec; s.timeToTargetSec = b.time + sec - (s.filledAt ?? b.time); s.statusReason = 'TP2 hit'; break; }
      if (tp1Hit) { s.outcome = 'TP1_HIT'; s.exitPrice = p.tp1; s.timeToTargetSec = b.time + sec - (s.filledAt ?? b.time); s.statusReason = 'TP1 hit — tracking TP2'; continue; }
    } else if (s.outcome === 'TP1_HIT') {
      // After TP1, TP2 counts only if reached before price returns to the entry.
      const backToEntry = buy ? loX(b) <= fill : hiX(b) >= fill;
      if (tp2Hit && backToEntry) { s.statusReason = 'TP1 hit; TP2 and return to entry in the same candle — kept TP1'; s.closedAt = b.time + sec; break; }
      if (tp2Hit) { s.outcome = 'TP2_HIT'; s.exitPrice = p.tp2; s.closedAt = b.time + sec; s.statusReason = 'TP2 hit'; break; }
      if (backToEntry) { s.closedAt = b.time + sec; s.statusReason = 'TP1 hit; price returned to entry before TP2'; break; }
    }
    if (s.filledAt && b.time - s.filledAt > maxHoldBars * sec && s.outcome === 'OPEN') { s.outcome = 'EXPIRED'; s.closedAt = b.time + sec; s.statusReason = 'Still open after the maximum tracking window'; break; }
  }
  s.updatedAt = Math.floor(Date.now() / 1000);
  return s;
}

/** R result used for analytics: TP1 = +rr1, TP2 = +rr2, SL = −1. Ambiguous/expired/cancelled are excluded. */
export function signalR(s: SignalRecord): number | null {
  if (s.outcome === 'TP2_HIT') return s.plan.rr2;
  if (s.outcome === 'TP1_HIT' && s.closedAt) return s.plan.rr1;
  if (s.outcome === 'SL_HIT') return -1;
  return null;
}

export interface SignalStats {
  total: number; decided: number; wins: number; losses: number; ambiguous: number; expired: number; cancelled: number; open: number;
  winRate: number; avgR: number; totalR: number; maxDrawdownR: number; maxConsecWins: number; maxConsecLosses: number;
}

export function signalStats(list: SignalRecord[]): SignalStats {
  const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt);
  const rs = sorted.map(signalR);
  const decided = rs.filter((r): r is number => r != null);
  let cum = 0, peak = 0, dd = 0, cw = 0, cl = 0, mcw = 0, mcl = 0;
  for (const r of decided) {
    cum += r; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum);
    if (r > 0) { cw++; cl = 0; } else { cl++; cw = 0; }
    mcw = Math.max(mcw, cw); mcl = Math.max(mcl, cl);
  }
  const wins = decided.filter((r) => r > 0).length;
  return {
    total: list.length, decided: decided.length, wins, losses: decided.length - wins,
    ambiguous: list.filter((s) => s.outcome === 'AMBIGUOUS').length,
    expired: list.filter((s) => s.outcome === 'EXPIRED').length,
    cancelled: list.filter((s) => s.outcome === 'CANCELLED').length,
    open: list.filter((s) => s.outcome === 'OPEN' || s.outcome === 'PENDING_ENTRY' || (s.outcome === 'TP1_HIT' && !s.closedAt)).length,
    winRate: decided.length ? (wins / decided.length) * 100 : 0,
    avgR: decided.length ? cum / decided.length : 0, totalR: cum, maxDrawdownR: dd, maxConsecWins: mcw, maxConsecLosses: mcl,
  };
}

export function groupSignals(list: SignalRecord[], key: (s: SignalRecord) => string) {
  const m = new Map<string, SignalRecord[]>();
  for (const s of list) { const k = key(s); if (!m.has(k)) m.set(k, []); m.get(k)!.push(s); }
  return [...m.entries()].map(([k, v]) => ({ key: k, stats: signalStats(v) })).sort((a, b) => a.key.localeCompare(b.key));
}
