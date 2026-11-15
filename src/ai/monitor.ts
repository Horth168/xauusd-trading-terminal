/**
 * One scan step, shared by the background scanner and tests:
 * 1) advance existing signals with new candles, 2) run the multi-agent analysis,
 * 3) create a signal only for a new, non-duplicate CONFIRMED setup, 4) emit events for notifications.
 * Pure: all I/O (bridge, Firestore, Web Push) lives in the scanner.
 */
import { analyze, type AnalyzeOptions } from './analyze';
import type { AiConfig } from './config';
import { mergeConfig } from './config';
import { isDuplicate, toSignal, updateSignal } from './signals';
import type { AnalysisReport, CandleSet, MarketSnapshot, SignalRecord } from './types';
import { tzOffset } from '../lib/time';

export type ScanEventType = 'confirmed' | 'invalidated' | 'expired' | 'outcome';
export interface ScanEvent { type: ScanEventType; signal: SignalRecord; key: string }

export interface ScanResult { report: AnalysisReport; changed: SignalRecord[]; created: SignalRecord | null; events: ScanEvent[] }

export function scanStep(set: CandleSet, market: MarketSnapshot, cfgIn: Partial<AiConfig>, signals: SignalRecord[], opts: AnalyzeOptions = {}): ScanResult {
  const cfg = mergeConfig(cfgIn);
  const events: ScanEvent[] = [];
  const changed: SignalRecord[] = [];
  const trackBars = set.M1?.length ? set.M1 : set[cfg.entryTf] ?? [];
  const trackTf = set.M1?.length ? 'M1' : cfg.entryTf;
  const asOf = opts.asOf ?? market.updatedAt;
  const closedTrack = trackBars.filter((b) => b.time + (trackTf === 'M1' ? 60 : 300) <= asOf);

  for (const s of signals) {
    const u = updateSignal(s, closedTrack, trackTf, cfg, market.spread);
    if (u.status !== s.status || u.outcome !== s.outcome || u.mfe !== s.mfe || u.mae !== s.mae) {
      changed.push(u);
      if (u.status === 'INVALIDATED' && s.status !== 'INVALIDATED') events.push({ type: 'invalidated', signal: u, key: `${u.id}:invalidated` });
      else if (u.status === 'EXPIRED' && s.status !== 'EXPIRED') events.push({ type: 'expired', signal: u, key: `${u.id}:expired` });
      else if (u.outcome !== s.outcome && ['TP1_HIT', 'TP2_HIT', 'SL_HIT', 'AMBIGUOUS'].includes(u.outcome)) events.push({ type: 'outcome', signal: u, key: `${u.id}:${u.outcome}` });
    }
  }

  const report = analyze(set, market, cfg, opts);
  let created: SignalRecord | null = null;
  if (report.status === 'CONFIRMED') {
    const sig = toSignal(report, set[cfg.entryTf] ?? []);
    const current = signals.map((s) => changed.find((c) => c.id === s.id) ?? s);
    if (!isDuplicate(sig, current)) {
      created = sig;
      events.push({ type: 'confirmed', signal: sig, key: `${sig.id}:confirmed` });
    }
  }
  return { report, changed, created, events };
}

/** Should this event become a push notification under the user's notification settings? */
export function shouldNotify(e: ScanEvent, cfgIn: Partial<AiConfig>, now = Math.floor(Date.now() / 1000)): { ok: boolean; reason: string } {
  const cfg = mergeConfig(cfgIn);
  const n = cfg.notify;
  const s = e.signal;
  if (e.type === 'confirmed') {
    if (s.side === 'BUY' && !n.buy) return { ok: false, reason: 'BUY notifications off' };
    if (s.side === 'SELL' && !n.sell) return { ok: false, reason: 'SELL notifications off' };
    if (s.score.total < n.minScore) return { ok: false, reason: `score ${s.score.total} < ${n.minScore}` };
    if (n.timeframes.length && !n.timeframes.includes(s.entryTf)) return { ok: false, reason: `${s.entryTf} not selected` };
    if (n.strategies !== 'all' && !n.strategies.includes(s.strategy)) return { ok: false, reason: 'strategy not selected' };
  }
  if (e.type === 'invalidated' && !n.invalidation) return { ok: false, reason: 'invalidation alerts off' };
  if (e.type === 'expired' && !n.expiry) return { ok: false, reason: 'expiry alerts off' };
  if (e.type === 'outcome') return { ok: false, reason: 'outcomes are recorded, not pushed' };
  if (n.quietStart && n.quietEnd && inQuietHours(now, n.quietStart, n.quietEnd, cfg.timezone)) return { ok: false, reason: 'quiet hours' };
  return { ok: true, reason: 'ok' };
}

export function inQuietHours(now: number, start: string, end: string, tz: string): boolean {
  const local = new Date((now + tzOffset(tz, now)) * 1000);
  const mins = local.getUTCHours() * 60 + local.getUTCMinutes();
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
  const a = toMin(start), b = toMin(end);
  return a <= b ? mins >= a && mins < b : mins >= a || mins < b; // supports overnight windows
}
