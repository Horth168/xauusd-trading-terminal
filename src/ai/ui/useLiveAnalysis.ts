import { useCallback, useEffect, useRef, useState } from 'react';
import { useFeed } from '../../market/feed';
import { runLocalAnalysis, useAiConfigLoaded, useAiData } from '../client';
import type { AnalysisReport } from '../types';

/**
 * Freshest available analysis: the background scanner's latest report when it is online and recent,
 * otherwise the same engine run on this device with the chart's own feed (re-run every minute).
 */
export function useLiveAnalysis(autoRefreshSec = 60) {
  const data = useAiData();
  const { cfg, loaded } = useAiConfigLoaded();
  const source = useFeed((s) => s.source);
  const generation = useFeed((s) => s.generation);
  const hasTick = useFeed((s) => !!s.tick);
  const [local, setLocal] = useState<AnalysisReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const busy = useRef(false);

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true; setRunning(true); setError(null);
    try { setLocal(await runLocalAnalysis(cfg)); } catch (e: any) { setError(String(e.message ?? e)); } finally { busy.current = false; setRunning(false); }
  }, [cfg]);

  useEffect(() => {
    if (!loaded || !source || !hasTick) return;
    run();
    const id = setInterval(run, autoRefreshSec * 1000);
    return () => clearInterval(id);
  }, [loaded, source, generation, hasTick, run, autoRefreshSec]);

  const now = Date.now() / 1000;
  const scannerFresh = data.scannerOnline && data.latest && now - (data.latest.createdAt ?? 0) < 180;
  const report: AnalysisReport | null = scannerFresh ? data.latest : local ?? data.latest;
  const origin = report ? (report === local ? 'This device' : 'Background scanner') : null;
  return { report, origin, run, running, error, ...data, cfg };
}
