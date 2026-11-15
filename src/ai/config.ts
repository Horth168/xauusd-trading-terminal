import type { AnalysisTf } from './types';

/** All tunables in one serialisable object, stored in Firestore (settings/ai) and read by the app and the scanner. */
export interface AiConfig {
  entryTf: AnalysisTf; // main trading timeframe
  strategies: Record<string, { enabled: boolean }>;
  periods: { emaFast: number; emaSlow: number; stochK: number; stochSmooth: number; stochD: number; cci: number; atr: number; rsi: number; adx: number };
  swingLookback: number; // bars each side to confirm a swing (no repaint)
  minScore: number; // 0..100
  minRR: number; // e.g. 2
  atrSlMult: number; // ATR stop distance multiplier
  slBufferAtr: number; // extra buffer beyond structure, in ATR
  maxSpread: number; // price units ($)
  maxSlAtr: number; // reject stops wider than this many ATR
  triggerLookback: number; // closed bars a trigger cross remains valid
  expiryBars: number; // signal expires if entry not reached within N entry-TF bars
  sessions: { asia: boolean; london: boolean; newyork: boolean };
  allowFormingCandle: boolean;
  timezone: string;
  notify: {
    buy: boolean; sell: boolean; minScore: number; timeframes: AnalysisTf[]; strategies: string[] | 'all';
    quietStart: string | null; quietEnd: string | null; invalidation: boolean; expiry: boolean;
  };
  ai: { provider: 'none' | 'anthropic'; model: string };
  scanIntervalSec: number;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  entryTf: 'M5',
  strategies: { ema_stoch_cci: { enabled: true }, smc: { enabled: true }, mtf_trend: { enabled: true } },
  periods: { emaFast: 12, emaSlow: 26, stochK: 5, stochSmooth: 3, stochD: 3, cci: 14, atr: 14, rsi: 14, adx: 14 },
  swingLookback: 3,
  minScore: 70,
  minRR: 2,
  atrSlMult: 1.5,
  slBufferAtr: 0.15,
  maxSpread: 0.4,
  maxSlAtr: 3,
  triggerLookback: 3,
  expiryBars: 6,
  sessions: { asia: true, london: true, newyork: true },
  allowFormingCandle: false,
  timezone: 'Asia/Phnom_Penh',
  notify: { buy: true, sell: true, minScore: 70, timeframes: ['M5', 'M15'], strategies: 'all', quietStart: null, quietEnd: null, invalidation: true, expiry: false },
  ai: { provider: 'none', model: 'claude-sonnet-5-5' },
  scanIntervalSec: 15,
};

export function mergeConfig(partial?: Partial<AiConfig> | null): AiConfig {
  const p = partial ?? {};
  return {
    ...DEFAULT_AI_CONFIG,
    ...p,
    strategies: { ...DEFAULT_AI_CONFIG.strategies, ...(p.strategies ?? {}) },
    periods: { ...DEFAULT_AI_CONFIG.periods, ...(p.periods ?? {}) },
    sessions: { ...DEFAULT_AI_CONFIG.sessions, ...(p.sessions ?? {}) },
    notify: { ...DEFAULT_AI_CONFIG.notify, ...(p.notify ?? {}) },
    ai: { ...DEFAULT_AI_CONFIG.ai, ...(p.ai ?? {}) },
  };
}

/** Stable short hash so every report records exactly which settings produced it (reproducibility). */
export function hashConfig(c: AiConfig): string {
  const s = JSON.stringify(c, Object.keys(c).sort());
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const TF_SECONDS: Record<AnalysisTf, number> = { M1: 60, M5: 300, M15: 900, H1: 3600, H4: 14400 };
export const HIGHER_TFS: AnalysisTf[] = ['H4', 'H1', 'M15'];
