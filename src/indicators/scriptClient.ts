import type { Bar } from '../market/types';
import type { ScriptResult } from './runtime';

/** Runs user scripts in an isolated worker with a hard timeout so a bad loop can't freeze the app. */
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (r: ScriptResult) => void; reject: (e: Error) => void; timer: number }>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./scriptWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.result);
      else p.reject(new Error(ev.data.error));
    };
  }
  return worker;
}

export function runScriptAsync(code: string, bars: Bar[], params: Record<string, any> = {}, timeoutMs = 5000): Promise<ScriptResult> {
  const id = ++seq;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      // Kill the stuck worker; all other pending runs are rejected and retried by callers on next update.
      worker?.terminate();
      worker = null;
      for (const [, p] of pending) p.reject(new Error('Script worker restarted'));
      pending.clear();
      reject(new Error(`Script timed out after ${timeoutMs} ms (infinite loop?)`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ id, code, bars, params });
  });
}
