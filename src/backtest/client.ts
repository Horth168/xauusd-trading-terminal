import type { Bar } from '../market/types';
import type { BacktestConfig, BacktestResult } from './engine';
import type { MonteCarloResult, WindowResult } from './validation';
import type { AiConfig } from '../ai/config';

export interface ValidationResult {
  oos: { inSample: WindowResult; outSample: WindowResult };
  wf: WindowResult[];
  mc: MonteCarloResult | null;
  lookAhead: { passed: boolean; checked: number; mismatches: number[] };
  warnings: string[];
}

export function runBacktestInWorker(bars: Bar[], config: BacktestConfig, strategy: { type: string; params: Record<string, any> }, code?: string, extra: { aiConfig?: AiConfig; validate?: boolean } = {}): Promise<BacktestResult & { validation?: ValidationResult | null }> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const timeoutMs = strategy.type.startsWith('ai:') || extra.validate ? 600000 : 120000;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { worker.terminate(); reject(new Error(`Backtest timed out after ${timeoutMs / 1000} s`)); }, timeoutMs);
    worker.onmessage = (ev) => {
      clearTimeout(timer);
      worker.terminate();
      if (ev.data.ok) resolve({ ...ev.data.result, validation: ev.data.validation });
      else reject(new Error(ev.data.error));
    };
    worker.onerror = (e) => { clearTimeout(timer); worker.terminate(); reject(new Error(e.message)); };
    worker.postMessage({ id: 1, bars, config, strategy, code, aiConfig: extra.aiConfig, validate: extra.validate });
  });
}
