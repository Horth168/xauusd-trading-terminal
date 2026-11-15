/** Browser-side access to the AI analyst: settings (Firestore), on-demand analysis, stored reports/signals. */
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { feed, useFeed } from '../market/feed';
import { getOne, saveDoc, useAuth, useCollection, type BaseDoc } from '../lib/db';
import { analyze } from './analyze';
import { DEFAULT_AI_CONFIG, mergeConfig, type AiConfig } from './config';
import { scriptStrategy } from './strategies';
import { useScripts } from '../indicators/registry';
import type { AnalysisReport, AnalysisTf, CandleSet, MarketSnapshot, SignalRecord } from './types';

// ---------------- settings ----------------
interface AiConfigState { cfg: AiConfig; loaded: boolean; save: (patch: Partial<AiConfig>) => Promise<void>; load: () => Promise<void> }
export const useAiConfig = create<AiConfigState>((set, get) => ({
  cfg: DEFAULT_AI_CONFIG,
  loaded: false,
  load: async () => {
    const d = await getOne<BaseDoc & { data?: Partial<AiConfig> }>('settings', 'ai').catch(() => null);
    set({ cfg: mergeConfig(d?.data ?? null), loaded: true });
  },
  save: async (patch) => {
    const cfg = mergeConfig({ ...get().cfg, ...patch });
    set({ cfg });
    await saveDoc('settings', { id: 'ai', data: cfg } as any);
  },
}));

export function useAiConfigLoaded() {
  const uid = useAuth((s) => s.user?.uid);
  const st = useAiConfig();
  useEffect(() => { st.load(); }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps
  return st;
}

// ---------------- on-demand analysis in the app (same engine as the scanner) ----------------
const COUNTS: Record<AnalysisTf, number> = { M1: 600, M5: 500, M15: 400, H1: 400, H4: 400 };

export function currentMarket(): MarketSnapshot | null {
  const st = useFeed.getState();
  if (!st.source || !st.tick) return null;
  const live = st.source === 'mt5' && st.status.state === 'live';
  const bid = st.tick.bid;
  const ask = st.tick.ask ?? bid;
  return { source: st.source, live, bid, ask, spread: Math.max(0, ask - bid), digits: st.symbol.digits, updatedAt: Math.floor((st.lastUpdate ?? Date.now()) / 1000), server: st.symbol.server, symbol: st.symbol.symbol };
}

export async function runLocalAnalysis(cfg: AiConfig): Promise<AnalysisReport> {
  const market = currentMarket();
  if (!market) throw new Error('No market data connected. Start the MT5 bridge or wait for the feed.');
  const generation = useFeed.getState().generation;
  const set: CandleSet = {};
  for (const tf of Object.keys(COUNTS) as AnalysisTf[]) set[tf] = await feed.load(tf, COUNTS[tf]);
  // Never mix sources: if the feed switched while loading, start over.
  if (useFeed.getState().generation !== generation) throw new Error('Data source changed during analysis — please run it again.');
  const extra = useScripts.getState().scripts
    .filter((s) => s.kind === 'strategy' && cfg.strategies[`custom:${s.id}`]?.enabled)
    .map((s) => scriptStrategy(s.id, s.name, s.code));
  return analyze(set, market, cfg, { asOf: Math.floor(Date.now() / 1000), extraStrategies: extra });
}

// ---------------- stored data written by the scanner ----------------
export interface ScannerStatus extends BaseDoc {
  online?: boolean; bridge?: string; live?: boolean; server?: string; lastScan?: number | null; lastDecision?: string | null; lastStatus?: string;
  lastError?: string | null; activeSignals?: number; version?: string; updatedAt?: number; tickAgeSec?: number;
}

export function useAiData() {
  const reports = useCollection<AnalysisReport & BaseDoc & { summary?: string; reportId?: string }>('ai_reports');
  const signals = useCollection<SignalRecord & BaseDoc>('ai_signals');
  const status = useCollection<ScannerStatus>('ai_status');
  return useMemo(() => {
    const latest = reports.items.find((r) => r.id === 'latest') ?? null;
    const scanner = status.items.find((s) => s.id === 'scanner') ?? null;
    const now = Date.now() / 1000;
    const scannerOnline = !!scanner && scanner.online !== false && !!scanner.updatedAt && now - scanner.updatedAt < 120;
    const sorted = [...signals.items].sort((a, b) => b.createdAt - a.createdAt);
    return { latest, reports: reports.items, signals: sorted, scanner, scannerOnline, loading: reports.loading || signals.loading };
  }, [reports, signals, status]);
}
