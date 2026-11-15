/**
 * Deterministic answers to common questions, built only from a stored report and signal history.
 * Used when no LLM is configured, and as the trusted baseline next to LLM answers.
 */
import type { AnalysisReport, SignalRecord } from './types';

export const PRESET_QUESTIONS = [
  'Analyze XAUUSD right now',
  'What is the current H1 direction?',
  'Is there a valid M5 entry?',
  'Why is the market showing WAIT?',
  'Where is the nearest liquidity?',
  'Has price swept liquidity?',
  'What must happen before a BUY entry?',
  'What must happen before a SELL entry?',
  'Why was the previous signal invalidated?',
  'Explain the SL placement',
  'Is the current entry too late?',
  'Compare the current setup with previous signals',
];

const f = (v: number | undefined | null, d = 2) => (v == null || !Number.isFinite(v) ? 'n/a' : v.toFixed(d));
const utc = (t: number) => new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

export function dataFooter(r: AnalysisReport): string {
  const src = r.market.source === 'mt5' ? `Exness MT5${r.market.server ? ` (${r.market.server})` : ''}${r.market.live ? ', live' : ', not live'}` : 'Twelve Data (delayed, not Exness)';
  return `Data: ${src} · market time ${utc(r.market.updatedAt)} · entry timeframe ${r.entryTf} · last closed candle ${utc(r.barTime)}. Limitation: ${r.limitations[0]}`;
}

export function answerLocally(q: string, r: AnalysisReport, signals: SignalRecord[] = []): string {
  const s = q.toLowerCase();
  const agent = (id: string) => r.agents.find((a) => a.agent === id);
  const lines: string[] = [];
  const conds = (side: 'BUY' | 'SELL') => r.candidates.filter((c) => c.side === side);

  if (/h1|h4|m15|direction|trend|bias/.test(s) && !/analy/.test(s)) {
    const mtf = agent('mtf');
    lines.push(`Timeframe bias: ${(['H4', 'H1', 'M15', 'M5'] as const).map((tf) => `${tf} ${r.biases[tf] ?? 'n/a'}`).join(' · ')}.`);
    for (const e of mtf?.evidence ?? []) lines.push(`• ${e.label}: ${e.detail}`);
  } else if (/liquidity|sweep/.test(s)) {
    const smc = agent('smc'), st = agent('structure');
    const pools = r.overlay.pools;
    if (/sweep/.test(s)) {
      const sw = r.overlay.sweeps;
      lines.push(sw.length ? `Recent sweeps on ${r.entryTf}:` : `No liquidity sweep in the recent ${r.entryTf} window.`);
      for (const x of sw.slice(-4)) lines.push(`• ${x.side === 'buy' ? 'Buy-side (highs)' : 'Sell-side (lows)'} swept at ${f(x.level)}, wick to ${f(x.extreme)}, closed back inside (${utc(x.time)}).`);
    } else {
      const price = r.market.bid;
      const sorted = [...pools].sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price));
      lines.push(sorted.length ? `Resting liquidity (equal highs/lows not yet taken) nearest to ${f(price)}:` : 'No untaken equal highs/lows in the recent window.');
      for (const p of sorted.slice(0, 4)) lines.push(`• ${p.side === 'buy' ? 'Buy-side above' : 'Sell-side below'}: ${f(p.price)} (${f(Math.abs(p.price - price))} away)`);
    }
    for (const e of [...(smc?.evidence ?? []), ...(st?.evidence ?? [])].filter((e) => /liquidity|sweep/i.test(e.label)).slice(0, 4)) lines.push(`• ${e.label}: ${e.detail}`);
  } else if (/before a (buy|sell)|must happen/.test(s)) {
    const side = /sell/.test(s) ? 'SELL' : 'BUY';
    const c = conds(side);
    lines.push(`For a ${side}, each strategy currently has:`);
    for (const x of c) lines.push(`• ${x.strategy}: ${x.met}/${x.total} conditions met (${x.status.replace('_', ' ').toLowerCase()}).`);
    const missing = r.waitReasons.filter((w) => w.includes(` ${side}:`));
    if (missing.length) { lines.push('Still missing:'); for (const m of missing) lines.push(`• ${m}`); }
    else if (r.decision === side) lines.push(`A ${side} is already confirmed.`);
    lines.push(`Then the plan must reach at least 1:${r.plan ? f(r.plan.rr1, 1) : 'min'} RR without opposing structure in the way, spread within your maximum, and evidence ≥ ${r.minScore}/100.`);
  } else if (/invalidated|previous signal/.test(s) && !/compare/.test(s)) {
    const prev = signals.find((x) => x.status === 'INVALIDATED' || x.status === 'EXPIRED' || ['SL_HIT', 'AMBIGUOUS'].includes(x.outcome));
    if (!prev) lines.push('No previous signal has been invalidated or expired yet.');
    else lines.push(`${prev.side} signal from ${utc(prev.createdAt)} (${prev.strategyName}) → ${prev.status === 'CONFIRMED' ? prev.outcome.replace('_', ' ') : prev.status}: ${prev.statusReason}. Its invalidation rule was: ${prev.plan.invalidation}`);
  } else if (/sl|stop/.test(s)) {
    if (!r.plan) lines.push('There is no active trade plan, so no stop has been calculated. The stop is computed only when a strategy has its core conditions in place.');
    else { lines.push(`Stop loss ${f(r.plan.sl)} — ${r.plan.slMethod}.`); for (const c of r.plan.calc) lines.push(`• ${c}`); }
  } else if (/late|chas/.test(s)) {
    if (!r.plan) lines.push('No entry is planned right now, so there is nothing to chase. Waiting is the default.');
    else {
      const cur = r.plan.side === 'BUY' ? r.market.ask : r.market.bid;
      const run = (cur - r.plan.entryRef) * (r.plan.side === 'BUY' ? 1 : -1);
      lines.push(`Current ${r.plan.side === 'BUY' ? 'ask' : 'bid'} ${f(cur)} vs planned entry ${f(r.plan.entryLow)}–${f(r.plan.entryHigh)}: ${run <= 0 ? 'price is still at or better than the entry.' : `price has moved ${f(run)} (${(run / r.plan.risk).toFixed(2)}R) past the entry.`} ${run > 0.5 * r.plan.risk ? 'That is late — the rules reject entries more than 0.5R past the zone. Do not chase.' : 'Still within the allowed 0.5R.'}`);
    }
  } else if (/compare/.test(s)) {
    const recent = signals.slice(0, 5);
    lines.push(`Current: ${r.decision} (${r.status.replace('_', ' ').toLowerCase()}), evidence ${r.score.total}/100.`);
    if (!recent.length) lines.push('No previous signals stored yet.');
    for (const x of recent) lines.push(`• ${utc(x.createdAt)} ${x.side} ${x.strategyName}: score ${x.score.total}, RR 1:${f(x.plan.rr1, 1)} → ${x.status === 'CONFIRMED' ? x.outcome.replace('_', ' ') : x.status}`);
  } else if (/valid|entry/.test(s) && !/analy/.test(s)) {
    if (r.decision !== 'WAIT' && r.plan) lines.push(`Yes — ${r.decision} on ${r.entryTf} via ${r.strategyName}: entry ${f(r.plan.entryLow)}–${f(r.plan.entryHigh)}, SL ${f(r.plan.sl)}, TP1 ${f(r.plan.tp1)}, TP2 ${f(r.plan.tp2)}, RR 1:${f(r.plan.rr1, 2)}, evidence ${r.score.total}/100.`);
    else { lines.push(`No — the decision is WAIT (${r.status.replace('_', ' ').toLowerCase()}).`); for (const w of r.waitReasons.slice(0, 5)) lines.push(`• ${w}`); }
  } else if (/wait/.test(s)) {
    if (r.decision !== 'WAIT') lines.push(`The current decision is ${r.decision}, not WAIT.`);
    else { lines.push('WAIT is the default unless every mandatory rule is satisfied. Right now:'); for (const w of r.waitReasons.slice(0, 6)) lines.push(`• ${w}`); }
  } else {
    // full analysis
    lines.push(r.decision !== 'WAIT' && r.plan
      ? `${r.decision} — ${r.strategyName} on ${r.entryTf}. Entry ${f(r.plan.entryLow)}–${f(r.plan.entryHigh)}, SL ${f(r.plan.sl)}, TP1 ${f(r.plan.tp1)}, TP2 ${f(r.plan.tp2)} (RR 1:${f(r.plan.rr1, 2)} / 1:${f(r.plan.rr2, 2)}). Evidence ${r.score.total}/100.`
      : `WAIT (${r.status.replace('_', ' ').toLowerCase()}). ${r.waitReasons[0] ?? ''}`);
    lines.push(`Price: bid ${f(r.market.bid)}, ask ${f(r.market.ask)}, spread ${f(r.market.spread)}.`);
    for (const a of r.agents.filter((x) => x.agent !== 'reviewer')) lines.push(`• ${a.title}: ${a.summary}`);
    if (r.reasonsAgainst.length) { lines.push('Against / risks:'); for (const x of r.reasonsAgainst.slice(0, 4)) lines.push(`• ${x}`); }
  }
  lines.push('', dataFooter(r));
  return lines.join('\n');
}
