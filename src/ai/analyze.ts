/**
 * Orchestrates the multi-agent analysis and the Final Signal Reviewer.
 * Pure and deterministic: same candles + market snapshot + config ⇒ same report. Used by the app, the background
 * scanner and the backtester, so live signals and backtests follow identical rules. Analysis only — never trades.
 */
import { sessionState } from '../lib/time';
import { agentsFor } from './agentSet';
import { hashConfig, mergeConfig, TF_SECONDS, type AiConfig } from './config';
import { buildContext, type AnalysisContext } from './context';
import { buildPlan } from './levels';
import { fairValueGaps, orderBlocks } from './smc';
import { BUILTIN_AI_STRATEGIES, type StrategyDef } from './strategies';
import type { AgentReport, AiOverlay, AnalysisReport, Candidate, CandleSet, MarketSnapshot, ScoreBreakdown, Side, SignalStatus, TradePlan } from './types';

export interface AnalyzeOptions {
  /** analysis time (unix s). Defaults to the market snapshot time. Bars must have closed by then. */
  asOf?: number;
  /** extra strategies (custom scripts) */
  extraStrategies?: StrategyDef[];
}

interface Evaluated { cand: Candidate; met: number; total: number; mandatoryMet: boolean; plan: TradePlan | null; agents: AgentReport[]; score: ScoreBreakdown }

/** number of mandatory conditions still missing */
const missing = (e: Evaluated) => e.cand.conditions.filter((c) => c.mandatory && !c.met).length;

const ZERO: ScoreBreakdown = { trend: 0, structure: 0, indicators: 0, liquidity: 0, risk: 0, total: 0 };

function scoreOf(agents: AgentReport[]): ScoreBreakdown {
  const g = (a: AgentReport['agent']) => agents.find((x) => x.agent === a)?.score ?? 0;
  const s = { trend: g('mtf'), structure: g('structure'), indicators: g('indicators'), liquidity: g('smc'), risk: g('risk') };
  return { ...s, total: s.trend + s.structure + s.indicators + s.liquidity + s.risk };
}

export function enabledStrategies(cfg: AiConfig, extra: StrategyDef[] = []): StrategyDef[] {
  return [...BUILTIN_AI_STRATEGIES, ...extra].filter((s) => cfg.strategies[s.id]?.enabled !== false);
}

export function sessionOpen(cfg: AiConfig, t: number): { open: boolean; names: string[] } {
  const ss = sessionState(t).filter((s) => s.isOpen).map((s) => s.name);
  const ok = (cfg.sessions.asia && (ss.includes('Tokyo') || ss.includes('Sydney'))) || (cfg.sessions.london && ss.includes('London')) || (cfg.sessions.newyork && ss.includes('New York'));
  return { open: ok, names: ss };
}

function overlayFor(ctx: AnalysisContext, plan: TradePlan | null): AiOverlay {
  const tf = ctx.entryTf;
  const st = ctx.structure[tf];
  const bars = ctx.bars[tf] ?? [];
  const zones = st && bars.length > 30 ? [...fairValueGaps(bars, ctx.entry.atr), ...orderBlocks(bars, st.events)].filter((z) => !z.mitigated).slice(-8) : [];
  return { tf, levels: st?.levels ?? [], events: (st?.events ?? []).slice(-8), sweeps: (st?.sweeps ?? []).slice(-6), zones, pools: st?.pools ?? [], plan };
}

export function analyze(set: CandleSet, market: MarketSnapshot, cfgIn: Partial<AiConfig> | AiConfig, opts: AnalyzeOptions = {}): AnalysisReport {
  const cfg = mergeConfig(cfgIn);
  let asOf = opts.asOf ?? market.updatedAt ?? Math.floor(Date.now() / 1000);
  if (cfg.allowFormingCandle) asOf += TF_SECONDS[cfg.entryTf];
  const ctx = buildContext(set, asOf, cfg);
  const entryBars = ctx.entry.bars;
  const barTime = entryBars[entryBars.length - 1]?.time ?? 0;
  const configHash = hashConfig(cfg);
  const limitations = [
    'Candle-based analysis: tick order inside a candle is unknown.',
    'Smart Money Concepts are price-pattern definitions from OHLC data; no institutional order-flow data is used.',
    'The evidence score is a rule-based checklist, not a statistically verified probability of success.',
  ];
  if (!market.live) limitations.push(`Data source is ${market.source === 'twelvedata' ? 'Twelve Data (delayed, not Exness)' : 'not live'} — no Exness entry can be confirmed from it.`);

  const evaluated: Evaluated[] = [];
  for (const strat of enabledStrategies(cfg, opts.extraStrategies)) {
    for (const side of ['BUY', 'SELL'] as Side[]) {
      let cand: Candidate | null = null;
      try { cand = strat.evaluate(ctx, side); } catch (e) { cand = null; }
      if (!cand) continue;
      const mand = cand.conditions.filter((c) => c.mandatory);
      const mandatoryMet = mand.every((c) => c.met);
      const met = cand.conditions.filter((c) => c.met).length;
      const plan = mandatoryMet ? buildPlan(ctx, cand, market) : null;
      const agents = mandatoryMet ? agentsFor(ctx, side, plan, market) : [];
      evaluated.push({ cand, met, total: cand.conditions.length, mandatoryMet, plan, agents, score: mandatoryMet ? scoreOf(agents) : ZERO });
    }
  }

  const sess = sessionOpen(cfg, asOf);
  const gates: string[] = [];
  if (!market.live) gates.push('Market data is not live Exness MT5 data.');
  if (!sess.open) gates.push(`Outside your preferred sessions (open now: ${sess.names.join(', ') || 'none'}).`);
  if (entryBars.length < 60) gates.push(`Only ${entryBars.length} closed ${cfg.entryTf} candles available.`);

  const passes = (e: Evaluated) => e.mandatoryMet && !!e.plan && e.agents.find((a) => a.agent === 'risk')?.verdict === 'pass' && e.score.total >= cfg.minScore;
  const confirmed = evaluated.filter(passes).sort((a, b) => b.score.total - a.score.total);
  const sides = new Set(confirmed.map((e) => e.cand.side));

  let status: SignalStatus = 'WAIT';
  let chosen: Evaluated | null = null;
  const waitReasons: string[] = [...gates];
  if (confirmed.length && sides.size === 1 && gates.length === 0) {
    chosen = confirmed[0];
    status = 'CONFIRMED';
  } else {
    if (sides.size > 1) waitReasons.push('BUY and SELL setups conflict — waiting for clarity.');
    // best partial setup → SETUP_FORMING with the list of what is missing
    const ranked = [...evaluated].sort((a, b) => (b.mandatoryMet ? 1 : 0) - (a.mandatoryMet ? 1 : 0) || b.score.total - a.score.total || missing(a) - missing(b));
    const best = ranked[0];
    if (best && missing(best) <= 1) {
      chosen = best;
      status = 'SETUP_FORMING';
      for (const c of best.cand.conditions.filter((x) => !x.met && x.mandatory)) waitReasons.push(`${best.cand.strategyName} ${best.cand.side}: needs "${c.label}" (${c.detail}).`);
      const risk = best.agents.find((a) => a.agent === 'risk');
      if (risk?.verdict === 'fail') waitReasons.push(`${best.cand.strategyName} ${best.cand.side}: ${risk.summary}`);
      if (best.mandatoryMet && best.score.total < cfg.minScore) waitReasons.push(`Evidence score ${best.score.total} is below your minimum ${cfg.minScore}.`);
    } else {
      status = evaluated.length ? 'WATCHING' : 'WAIT';
      if (!waitReasons.length) waitReasons.push('No strategy has its core conditions in place. Waiting is the default.');
    }
  }

  const decisionSide: Side | null = status === 'CONFIRMED' && chosen ? chosen.cand.side : null;
  const agents = chosen?.agents.length ? chosen.agents : agentsFor(ctx, chosen?.cand.side ?? null, chosen?.plan ?? null, market);
  const score = chosen?.agents.length ? chosen.score : scoreOf(agents);

  // Final Signal Reviewer
  const lean = chosen?.cand.side ?? null;
  const reasonsFor: string[] = [];
  const reasonsAgainst: string[] = [];
  for (const a of agents) {
    for (const e of a.evidence) {
      if (!lean || e.supports === 'neutral') continue;
      (e.supports === lean ? reasonsFor : reasonsAgainst).push(`${a.title.replace(' Analyst', '')}: ${e.label} — ${e.detail}`);
    }
    for (const w of a.warnings) reasonsAgainst.push(`${a.title.replace(' Analyst', '')}: ${w}`);
  }
  if (chosen) for (const c of chosen.cand.conditions.filter((x) => x.met)) reasonsFor.unshift(`${chosen.cand.strategyName}: ${c.label} — ${c.detail}`);
  const reviewer: AgentReport = {
    agent: 'reviewer', title: 'Final Signal Reviewer',
    verdict: decisionSide ? (decisionSide === 'BUY' ? 'bullish' : 'bearish') : 'neutral',
    score: score.total, maxScore: 100,
    summary: decisionSide
      ? `${decisionSide} confirmed by ${chosen!.cand.strategyName}: all mandatory rules met, RR 1:${chosen!.plan!.rr1.toFixed(2)}, evidence ${score.total}/100 (min ${cfg.minScore}).`
      : `WAIT — ${waitReasons[0] ?? 'no valid setup.'}`,
    evidence: [], warnings: decisionSide ? [] : waitReasons,
  };

  const biases = (agents.find((a) => a.agent === 'mtf')?.data?.biases ?? {}) as AnalysisReport['biases'];
  return {
    id: `${cfg.entryTf}-${barTime}-${configHash}`,
    createdAt: Math.floor(Date.now() / 1000),
    symbol: market.symbol ?? 'XAUUSD',
    market,
    entryTf: cfg.entryTf,
    barTime,
    decision: decisionSide ?? 'WAIT',
    status,
    strategy: chosen?.cand.strategy ?? null,
    strategyName: chosen?.cand.strategyName ?? null,
    plan: status === 'CONFIRMED' || status === 'SETUP_FORMING' ? chosen?.plan ?? null : null,
    score,
    minScore: cfg.minScore,
    biases,
    agents: [...agents, reviewer],
    candidates: evaluated.map((e) => ({ strategy: e.cand.strategyName, side: e.cand.side, met: e.met, total: e.total, status: passes(e) ? 'CONFIRMED' : missing(e) <= 1 ? 'SETUP_FORMING' : 'WATCHING' })),
    reasonsFor,
    reasonsAgainst,
    waitReasons: decisionSide ? [] : waitReasons,
    configHash,
    limitations,
    overlay: overlayFor(ctx, chosen?.plan ?? null),
  };
}
