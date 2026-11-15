/**
 * Shared types for the AI Gold Analyst. Every number in a report comes from deterministic code in src/ai;
 * the optional LLM only explains these structures. Analysis-only: nothing here can place or modify orders.
 */
import type { Bar } from '../market/types';

export type Side = 'BUY' | 'SELL';
export type Decision = Side | 'WAIT';
export type Bias = 'bullish' | 'bearish' | 'neutral';
export type AnalysisTf = 'M1' | 'M5' | 'M15' | 'H1' | 'H4';

export type SignalStatus = 'WATCHING' | 'SETUP_FORMING' | 'CONFIRMED' | 'WAIT' | 'INVALIDATED' | 'EXPIRED';
export type SignalOutcome = 'OPEN' | 'PENDING_ENTRY' | 'TP1_HIT' | 'TP2_HIT' | 'SL_HIT' | 'EXPIRED' | 'CANCELLED' | 'AMBIGUOUS';

export type DataSourceKind = 'mt5' | 'twelvedata';

export interface MarketSnapshot {
  source: DataSourceKind;
  /** LIVE Exness data from the MT5 bridge. Only live data may produce CONFIRMED signals. */
  live: boolean;
  bid: number;
  ask: number;
  spread: number; // price units
  digits: number;
  /** unix seconds of the last market update */
  updatedAt: number;
  server?: string;
  symbol?: string;
}

/** Candles per timeframe, oldest first. May include the forming bar; the engine drops it. */
export type CandleSet = Partial<Record<AnalysisTf, Bar[]>>;

export interface Evidence {
  label: string;
  detail: string;
  /** which direction this evidence supports */
  supports: 'BUY' | 'SELL' | 'neutral';
  weight?: number;
}

export interface Swing { index: number; time: number; price: number; kind: 'high' | 'low' }

export interface StructureEvent {
  kind: 'BOS' | 'CHOCH';
  direction: 'bullish' | 'bearish';
  index: number;
  time: number;
  level: number; // broken swing level
}

export interface Level { price: number; kind: 'support' | 'resistance'; touches: number; lastTime: number }

export interface LiquidityPool { price: number; side: 'buy' | 'sell'; touches: number; firstTime: number; lastTime: number }

export interface Sweep { time: number; index: number; side: 'buy' | 'sell'; level: number; extreme: number }

export interface Zone {
  kind: 'FVG' | 'OB';
  direction: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  time: number; // creation candle time
  index: number;
  mitigated: boolean;
}

export interface TfStructure {
  tf: AnalysisTf;
  bias: Bias;
  trendLabel: string; // e.g. "HH + HL (bullish)"
  swings: Swing[];
  events: StructureEvent[];
  levels: Level[];
  pools: LiquidityPool[];
  sweeps: Sweep[];
  lastClose: number;
  lastTime: number;
}

export interface IndicatorSnapshot {
  tf: AnalysisTf;
  time: number;
  close: number;
  ema12: number;
  ema26: number;
  stochK: number;
  stochD: number;
  stochKPrev: number;
  stochDPrev: number;
  cci: number;
  cciPrev: number;
  atr: number;
  rsi: number;
  adx: number;
  plusDI: number;
  minusDI: number;
  volume: number | null;
  volumeAvg: number | null;
}

export interface AgentReport {
  agent: 'structure' | 'indicators' | 'smc' | 'mtf' | 'risk' | 'reviewer';
  title: string;
  verdict: Bias | 'pass' | 'fail';
  /** 0..20 contribution to the evidence score for the proposed side */
  score: number;
  maxScore: number;
  summary: string;
  evidence: Evidence[];
  warnings: string[];
  data?: Record<string, unknown>;
}

export interface Candidate {
  side: Side;
  strategy: string; // strategy id
  strategyName: string;
  entryType: 'market' | 'limit' | 'breakout' | 'retest';
  /** conditions checked by the strategy */
  conditions: { label: string; met: boolean; mandatory: boolean; detail: string }[];
  /** preferred entry zone from the strategy (e.g. OB/FVG), optional */
  zone?: { low: number; high: number; source: string };
  /** script/explicit stop/target if provided */
  sl?: number;
  tp?: number;
  triggerTime: number;
}

export interface TradePlan {
  side: Side;
  entryType: Candidate['entryType'];
  entryLow: number;
  entryHigh: number;
  entryRef: number; // price used for R calculations (worst side of zone incl. spread)
  sl: number;
  slMethod: string;
  tp1: number;
  tp2: number;
  tpMethod: string;
  risk: number; // price distance
  rr1: number;
  rr2: number;
  blockingLevel: number | null;
  invalidation: string;
  calc: string[]; // human-readable calculation steps
}

export interface ScoreBreakdown { trend: number; structure: number; indicators: number; liquidity: number; risk: number; total: number }

export interface AnalysisReport {
  id: string;
  createdAt: number; // unix seconds
  symbol: string;
  market: MarketSnapshot;
  entryTf: AnalysisTf;
  barTime: number; // close-time anchor: open time of last CLOSED entry-TF bar
  decision: Decision;
  status: SignalStatus;
  strategy: string | null;
  strategyName: string | null;
  plan: TradePlan | null;
  score: ScoreBreakdown;
  minScore: number;
  biases: Partial<Record<AnalysisTf, Bias>>;
  agents: AgentReport[];
  candidates: { strategy: string; side: Side | null; met: number; total: number; status: SignalStatus }[];
  reasonsFor: string[];
  reasonsAgainst: string[];
  waitReasons: string[];
  configHash: string;
  limitations: string[];
  overlay: AiOverlay;
}

/** Everything the chart needs to draw the AI analysis. */
export interface AiOverlay {
  tf: AnalysisTf;
  levels: Level[];
  events: StructureEvent[];
  sweeps: Sweep[];
  zones: Zone[];
  pools: LiquidityPool[];
  plan: TradePlan | null;
}

export interface SignalRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  side: Side;
  status: SignalStatus;
  outcome: SignalOutcome;
  strategy: string;
  strategyName: string;
  entryTf: AnalysisTf;
  barTime: number;
  plan: TradePlan;
  score: ScoreBreakdown;
  market: MarketSnapshot;
  reasonsFor: string[];
  reasonsAgainst: string[];
  biases: Partial<Record<AnalysisTf, Bias>>;
  reportId: string;
  /** recent entry-TF candles stored with the signal so its chart is reproducible */
  candles: Bar[];
  filledAt?: number | null;
  closedAt?: number | null;
  exitPrice?: number | null;
  mfe?: number; // price units
  mae?: number;
  timeToTargetSec?: number | null;
  statusReason?: string;
  notified?: boolean;
}
