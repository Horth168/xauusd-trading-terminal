/// <reference lib="webworker" />
import { runBacktest } from './engine';
import { STRATEGY_MAP } from './strategies';
import { BUILTIN_MAP } from '../indicators/builtins';
import { runScript } from '../indicators/runtime';

self.onmessage = (ev: MessageEvent) => {
  const { id, bars, config, strategy, code } = ev.data;
  try {
    let signals;
    if (code) signals = runScript(code, bars, strategy.params).output.signals;
    else {
      const def = STRATEGY_MAP.get(strategy.type) ?? BUILTIN_MAP.get(strategy.type);
      if (!def) throw new Error(`Unknown strategy ${strategy.type}`);
      signals = def.compute(bars, strategy.params, { tzOffsetSec: 0 }).signals;
    }
    const nSignals = signals.long.filter(Boolean).length + signals.short.filter(Boolean).length;
    const result = runBacktest(bars, signals, config);
    if (!nSignals) result.warnings.push('The strategy produced no entry signals on this data.');
    (self as any).postMessage({ id, ok: true, result });
  } catch (e: any) {
    (self as any).postMessage({ id, ok: false, error: String(e?.message ?? e) });
  }
};
