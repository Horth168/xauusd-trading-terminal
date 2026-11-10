import type { Bar } from '../market/types';
import type { BacktestConfig, BacktestResult } from './engine';

export function runBacktestInWorker(bars: Bar[], config: BacktestConfig, strategy: { type: string; params: Record<string, any> }, code?: string): Promise<BacktestResult> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Backtest timed out after 120 s')); }, 120000);
    worker.onmessage = (ev) => {
      clearTimeout(timer);
      worker.terminate();
      if (ev.data.ok) resolve(ev.data.result);
      else reject(new Error(ev.data.error));
    };
    worker.onerror = (e) => { clearTimeout(timer); worker.terminate(); reject(new Error(e.message)); };
    worker.postMessage({ id: 1, bars, config, strategy, code });
  });
}
