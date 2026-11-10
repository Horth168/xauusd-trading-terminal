import * as ta from '../indicators/ta';
import { emptyOutput, type IndicatorDef, type InputDef } from '../indicators/types';

/**
 * Built-in strategies. Each returns causal entry/exit signals evaluated at bar CLOSE;
 * the engine fills them at the NEXT bar's open, so there is no look-ahead.
 */
const int = (id: string, label: string, def: number): InputDef => ({ id, label, type: 'int', default: def, min: 1, max: 1000, step: 1 });
const float = (id: string, label: string, def: number, step = 0.5): InputDef => ({ id, label, type: 'float', default: def, step });

export const STRATEGIES: IndicatorDef[] = [
  {
    id: 'ema_cross', name: 'EMA Crossover', shortName: 'EMA X', overlay: true,
    inputs: [int('fast', 'Fast EMA', 9), int('slow', 'Slow EMA', 21), int('trend', 'Trend filter EMA (0 = off)', 200)],
    colors: { fast: '#e8c25a', slow: '#6b8afd', trend: '#9a9aa5' },
    compute: (bars, p) => {
      const c = bars.map((b) => b.close);
      const f = ta.ema(c, p.fast), s = ta.ema(c, p.slow), tr = p.trend > 0 ? ta.ema(c, p.trend) : null;
      const o = emptyOutput(bars.length);
      o.plots.push({ id: 'fast', title: 'Fast', values: f, color: '', style: 'line', pane: 'overlay' }, { id: 'slow', title: 'Slow', values: s, color: '', style: 'line', pane: 'overlay' });
      if (tr) o.plots.push({ id: 'trend', title: 'Trend', values: tr, color: '', style: 'line', pane: 'overlay' });
      for (let i = 1; i < bars.length; i++) {
        const up = ta.crossover(f, s, i), dn = ta.crossunder(f, s, i);
        if (up) { o.signals.exitShort[i] = true; if (!tr || c[i] > tr[i]) o.signals.long[i] = true; }
        if (dn) { o.signals.exitLong[i] = true; if (!tr || c[i] < tr[i]) o.signals.short[i] = true; }
      }
      return o;
    },
  },
  {
    id: 'rsi_reversion', name: 'RSI Mean Reversion', shortName: 'RSI MR', overlay: false,
    inputs: [int('length', 'RSI length', 14), float('os', 'Oversold', 30, 1), float('ob', 'Overbought', 70, 1), float('exit', 'Exit level', 50, 1)],
    colors: { rsi: '#c678dd' },
    compute: (bars, p) => {
      const r = ta.rsi(bars.map((b) => b.close), p.length);
      const o = emptyOutput(bars.length);
      o.plots.push({ id: 'rsi', title: 'RSI', values: r, color: '', style: 'line', pane: 'separate' });
      for (let i = 1; i < bars.length; i++) {
        if (ta.crossover(r, p.os, i)) o.signals.long[i] = true;
        if (ta.crossunder(r, p.ob, i)) o.signals.short[i] = true;
        if (ta.crossover(r, p.exit, i)) o.signals.exitLong[i] = true;
        if (ta.crossunder(r, p.exit, i)) o.signals.exitShort[i] = true;
      }
      return o;
    },
  },
  {
    id: 'donchian_breakout', name: 'Donchian Breakout', shortName: 'Breakout', overlay: true,
    inputs: [int('length', 'Channel length', 20), int('exitLength', 'Exit channel length', 10)],
    colors: { upper: '#22b07d', lower: '#e5484d' },
    compute: (bars, p) => {
      // Channel of the PREVIOUS N bars, so the breakout bar itself is not part of its own reference.
      const hi = ta.highest(bars.map((b) => b.high), p.length), lo = ta.lowest(bars.map((b) => b.low), p.length);
      const xhi = ta.highest(bars.map((b) => b.high), p.exitLength), xlo = ta.lowest(bars.map((b) => b.low), p.exitLength);
      const o = emptyOutput(bars.length);
      const upper = bars.map((_, i) => (i ? hi[i - 1] : NaN)), lower = bars.map((_, i) => (i ? lo[i - 1] : NaN));
      o.plots.push({ id: 'upper', title: 'Upper', values: upper, color: '', style: 'step', pane: 'overlay' }, { id: 'lower', title: 'Lower', values: lower, color: '', style: 'step', pane: 'overlay' });
      for (let i = 1; i < bars.length; i++) {
        if (bars[i].close > upper[i]) o.signals.long[i] = true;
        if (bars[i].close < lower[i]) o.signals.short[i] = true;
        if (bars[i].close < xlo[i - 1]) o.signals.exitLong[i] = true;
        if (bars[i].close > xhi[i - 1]) o.signals.exitShort[i] = true;
      }
      return o;
    },
  },
  {
    id: 'supertrend_follow', name: 'Supertrend Trend Following', shortName: 'ST', overlay: true,
    inputs: [int('length', 'ATR length', 10), float('mult', 'Factor', 3)],
    colors: { st: '#e8c25a' },
    compute: (bars, p) => {
      const st = ta.supertrend(bars, p.length, p.mult);
      const o = emptyOutput(bars.length);
      o.plots.push({ id: 'st', title: 'Supertrend', values: st.line, color: '', colors: st.dir.map((d) => (d === 1 ? '#22b07d' : '#e5484d')), style: 'line', pane: 'overlay' });
      for (let i = 1; i < bars.length; i++) {
        if (st.dir[i] === 1 && st.dir[i - 1] === -1) { o.signals.long[i] = true; o.signals.exitShort[i] = true; }
        if (st.dir[i] === -1 && st.dir[i - 1] === 1) { o.signals.short[i] = true; o.signals.exitLong[i] = true; }
      }
      return o;
    },
  },
  {
    id: 'macd_cross', name: 'MACD Signal Cross', shortName: 'MACD X', overlay: false,
    inputs: [int('fast', 'Fast', 12), int('slow', 'Slow', 26), int('signal', 'Signal', 9), { id: 'zero', label: 'Only trade with zero-line trend', type: 'bool', default: true }],
    colors: { macd: '#2f9bff', signal: '#ff9f43' },
    compute: (bars, p) => {
      const m = ta.macd(bars.map((b) => b.close), p.fast, p.slow, p.signal);
      const o = emptyOutput(bars.length);
      o.plots.push({ id: 'macd', title: 'MACD', values: m.line, color: '', style: 'line', pane: 'separate' }, { id: 'signal', title: 'Signal', values: m.signal, color: '', style: 'line', pane: 'separate' });
      for (let i = 1; i < bars.length; i++) {
        if (ta.crossover(m.line, m.signal, i)) { o.signals.exitShort[i] = true; if (!p.zero || m.line[i] < 0) o.signals.long[i] = true; }
        if (ta.crossunder(m.line, m.signal, i)) { o.signals.exitLong[i] = true; if (!p.zero || m.line[i] > 0) o.signals.short[i] = true; }
      }
      return o;
    },
  },
  {
    id: 'bb_reversion', name: 'Bollinger Band Reversion', shortName: 'BB MR', overlay: true,
    inputs: [int('length', 'Length', 20), float('mult', 'StdDev', 2, 0.1)],
    colors: { basis: '#e8c25a', upper: '#6b8afd', lower: '#6b8afd' },
    compute: (bars, p) => {
      const c = bars.map((b) => b.close);
      const bb = ta.bollinger(c, p.length, p.mult);
      const o = emptyOutput(bars.length);
      o.plots.push({ id: 'basis', title: 'Basis', values: bb.basis, color: '', style: 'line', pane: 'overlay' }, { id: 'upper', title: 'Upper', values: bb.upper, color: '', style: 'line', pane: 'overlay' }, { id: 'lower', title: 'Lower', values: bb.lower, color: '', style: 'line', pane: 'overlay' });
      for (let i = 1; i < bars.length; i++) {
        if (ta.crossover(c, bb.lower, i)) o.signals.long[i] = true;
        if (ta.crossunder(c, bb.upper, i)) o.signals.short[i] = true;
        if (ta.crossover(c, bb.basis, i)) o.signals.exitLong[i] = true;
        if (ta.crossunder(c, bb.basis, i)) o.signals.exitShort[i] = true;
      }
      return o;
    },
  },
];

export const STRATEGY_MAP = new Map(STRATEGIES.map((s) => [s.id, s]));
