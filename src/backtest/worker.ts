/// <reference lib="webworker" />
import type { Bar } from '../market/types';
import type { SignalOutput } from '../indicators/types';
import { runBacktest } from './engine';
import { STRATEGY_MAP } from './strategies';
import { BUILTIN_MAP } from '../indicators/builtins';
import { runScript } from '../indicators/runtime';
import { AI_STRATEGY_PREFIX, aiSignals } from './aiStrategy';
import { lookAheadCheck, monteCarlo, outOfSample, overfittingWarnings, walkForward } from './validation';

self.onmessage = (ev: MessageEvent) => {
  const { id, bars, config, strategy, code, aiConfig, validate } = ev.data;
  try {
    const compute = (b: Bar[]): SignalOutput => {
      if (code) return runScript(code, b, strategy.params).output.signals;
      if (String(strategy.type).startsWith(AI_STRATEGY_PREFIX)) return aiSignals(b, aiConfig ?? {}, strategy.type.slice(AI_STRATEGY_PREFIX.length), config.spread);
      const def = STRATEGY_MAP.get(strategy.type) ?? BUILTIN_MAP.get(strategy.type);
      if (!def) throw new Error(`Unknown strategy ${strategy.type}`);
      return def.compute(b, strategy.params, { tzOffsetSec: 0 }).signals;
    };
    const signals = compute(bars);
    const nSignals = signals.long.filter(Boolean).length + signals.short.filter(Boolean).length;
    const result = runBacktest(bars, signals, config);
    if (!nSignals) result.warnings.push('The strategy produced no entry signals on this data.');
    let validation = null;
    if (validate) {
      const oos = outOfSample(bars, signals, config);
      const wf = walkForward(bars, signals, config, 5);
      const mc = monteCarlo(result.trades, config.initialBalance);
      const la = lookAheadCheck(bars, compute, signals);
      validation = { oos, wf, mc, lookAhead: la, warnings: overfittingWarnings(result.stats, oos, wf, mc, config.initialBalance) };
    }
    (self as any).postMessage({ id, ok: true, result, validation });
  } catch (e: any) {
    (self as any).postMessage({ id, ok: false, error: String(e?.message ?? e) });
  }
};
