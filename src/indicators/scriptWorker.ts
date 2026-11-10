/// <reference lib="webworker" />
import { runScript } from './runtime';

self.onmessage = (ev: MessageEvent) => {
  const { id, code, bars, params } = ev.data;
  try {
    const res = runScript(code, bars, params);
    (self as any).postMessage({ id, ok: true, result: res });
  } catch (e: any) {
    (self as any).postMessage({ id, ok: false, error: String(e?.message ?? e), stack: String(e?.stack ?? '') });
  }
};
