import * as ta from './ta';
import { emptyOutput, type IndicatorDef, type InputDef, type PlotOutput } from './types';

const int = (id: string, label: string, def: number, min = 1, max = 1000): InputDef => ({ id, label, type: 'int', default: def, min, max, step: 1 });
const float = (id: string, label: string, def: number, step = 0.1): InputDef => ({ id, label, type: 'float', default: def, step });
const source: InputDef = { id: 'source', label: 'Source', type: 'select', default: 'close', options: ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'] };

const UP = '#22b07d', DOWN = '#e5484d';

function src(bars: import('../market/types').Bar[], s: string): number[] {
  switch (s) {
    case 'open': return bars.map((b) => b.open);
    case 'high': return bars.map((b) => b.high);
    case 'low': return bars.map((b) => b.low);
    case 'hl2': return bars.map((b) => (b.high + b.low) / 2);
    case 'hlc3': return bars.map((b) => (b.high + b.low + b.close) / 3);
    case 'ohlc4': return bars.map((b) => (b.open + b.high + b.low + b.close) / 4);
    default: return bars.map((b) => b.close);
  }
}

const line = (id: string, title: string, values: number[], color: string, pane: PlotOutput['pane'], extra: Partial<PlotOutput> = {}): PlotOutput => ({ id, title, values, color, style: 'line', pane, ...extra });

export const BUILTINS: IndicatorDef[] = [
  {
    id: 'ema', name: 'Exponential Moving Average', shortName: 'EMA', overlay: true,
    inputs: [int('length', 'Length', 21), source], colors: { ema: '#e8c25a' },
    compute: (bars, p) => { const o = emptyOutput(bars.length); o.plots.push(line('ema', `EMA ${p.length}`, ta.ema(src(bars, p.source), p.length), '', 'overlay')); return o; },
  },
  {
    id: 'sma', name: 'Simple Moving Average', shortName: 'SMA', overlay: true,
    inputs: [int('length', 'Length', 50), source], colors: { sma: '#6b8afd' },
    compute: (bars, p) => { const o = emptyOutput(bars.length); o.plots.push(line('sma', `SMA ${p.length}`, ta.sma(src(bars, p.source), p.length), '', 'overlay')); return o; },
  },
  {
    id: 'vwap', name: 'VWAP (session, tick volume)', shortName: 'VWAP', overlay: true,
    inputs: [{ id: 'anchor', label: 'Session anchor', type: 'select', default: 'UTC', options: ['UTC', 'Chart timezone'] }], colors: { vwap: '#c678dd' },
    compute: (bars, p, ctx) => { const o = emptyOutput(bars.length); o.plots.push(line('vwap', 'VWAP', ta.vwap(bars, p.anchor === 'UTC' ? 0 : ctx.tzOffsetSec), '', 'overlay')); return o; },
  },
  {
    id: 'bb', name: 'Bollinger Bands', shortName: 'BB', overlay: true,
    inputs: [int('length', 'Length', 20), float('mult', 'StdDev', 2), source], colors: { basis: '#e8c25a', upper: '#6b8afd', lower: '#6b8afd' },
    compute: (bars, p) => {
      const o = emptyOutput(bars.length); const b = ta.bollinger(src(bars, p.source), p.length, p.mult);
      o.plots.push(line('basis', 'Basis', b.basis, '', 'overlay'), line('upper', 'Upper', b.upper, '', 'overlay'), line('lower', 'Lower', b.lower, '', 'overlay'));
      return o;
    },
  },
  {
    id: 'ichimoku', name: 'Ichimoku Cloud', shortName: 'Ichimoku', overlay: true,
    inputs: [int('conv', 'Conversion', 9), int('base', 'Base', 26), int('spanB', 'Span B', 52), int('disp', 'Displacement', 26)],
    colors: { tenkan: '#2f9bff', kijun: '#e5484d', spanA: '#22b07d', spanB: '#e5484d', chikou: '#9a9aa5' },
    compute: (bars, p) => {
      const o = emptyOutput(bars.length); const ic = ta.ichimoku(bars, p.conv, p.base, p.spanB, p.disp);
      o.plots.push(
        line('tenkan', 'Conversion', ic.tenkan, '', 'overlay'),
        line('kijun', 'Base', ic.kijun, '', 'overlay'),
        line('spanA', 'Lead A', ic.spanA, '', 'overlay', { offset: p.disp - 1 }),
        line('spanB', 'Lead B', ic.spanB, '', 'overlay', { offset: p.disp - 1 }),
        line('chikou', 'Lagging', ic.chikou, '', 'overlay', { offset: -(p.disp - 1) }),
      );
      return o;
    },
  },
  {
    id: 'supertrend', name: 'Supertrend', shortName: 'ST', overlay: true,
    inputs: [int('length', 'ATR length', 10), float('mult', 'Factor', 3)], colors: { up: UP, down: DOWN },
    compute: (bars, p) => {
      const o = emptyOutput(bars.length); const st = ta.supertrend(bars, p.length, p.mult);
      o.plots.push(line('st', 'Supertrend', st.line, '', 'overlay', { colors: st.dir.map((d) => (d === 1 ? '$up' : d === -1 ? '$down' : undefined)) }));
      for (let i = 1; i < bars.length; i++) {
        if (st.dir[i] === 1 && st.dir[i - 1] === -1) { o.markers.push({ index: i, position: 'belowBar', shape: 'arrowUp', color: UP, text: 'ST' }); o.signals.long[i] = true; o.signals.exitShort[i] = true; }
        if (st.dir[i] === -1 && st.dir[i - 1] === 1) { o.markers.push({ index: i, position: 'aboveBar', shape: 'arrowDown', color: DOWN, text: 'ST' }); o.signals.short[i] = true; o.signals.exitLong[i] = true; }
      }
      return o;
    },
  },
  {
    id: 'heikin', name: 'Heikin Ashi (candle transform)', shortName: 'HA', overlay: true, inputs: [], colors: {}, transformsCandles: true,
    compute: (bars) => emptyOutput(bars.length),
  },
  {
    id: 'volume', name: 'Volume (tick volume)', shortName: 'Vol', overlay: false,
    inputs: [int('ma', 'MA length', 20)], colors: { up: 'rgba(34,176,125,0.6)', down: 'rgba(229,72,77,0.6)', ma: '#e8c25a' },
    compute: (bars, p) => {
      const o = emptyOutput(bars.length);
      const vol = bars.map((b) => (b.volume == null ? NaN : b.volume));
      o.plots.push({ id: 'vol', title: 'Volume', values: vol, color: '', colors: bars.map((b) => (b.close >= b.open ? '$up' : '$down')), style: 'histogram', pane: 'separate' });
      o.plots.push(line('ma', `MA ${p.ma}`, ta.sma(vol, p.ma), '', 'separate'));
      return o;
    },
  },
  {
    id: 'rsi', name: 'Relative Strength Index', shortName: 'RSI', overlay: false,
    inputs: [int('length', 'Length', 14), source, float('ob', 'Overbought', 70, 1), float('os', 'Oversold', 30, 1)], colors: { rsi: '#c678dd' },
    compute: (bars, p) => {
      const o = emptyOutput(bars.length); o.plots.push(line('rsi', `RSI ${p.length}`, ta.rsi(src(bars, p.source), p.length), '', 'separate'));
      o.hlines.push({ price: p.ob, title: 'OB', color: '#6b6b76' }, { price: p.os, title: 'OS', color: '#6b6b76' });
      return o;
    },
  },
  {
    id: 'macd', name: 'MACD', shortName: 'MACD', overlay: false,
    inputs: [int('fast', 'Fast', 12), int('slow', 'Slow', 26), int('signal', 'Signal', 9), source], colors: { macd: '#2f9bff', signal: '#ff9f43', up: 'rgba(34,176,125,0.7)', down: 'rgba(229,72,77,0.7)' },
    compute: (bars, p) => {
      const o = emptyOutput(bars.length); const m = ta.macd(src(bars, p.source), p.fast, p.slow, p.signal);
      o.plots.push({ id: 'hist', title: 'Histogram', values: m.hist, color: '', colors: m.hist.map((h) => (h >= 0 ? '$up' : '$down')), style: 'histogram', pane: 'separate' });
      o.plots.push(line('macd', 'MACD', m.line, '', 'separate'), line('signal', 'Signal', m.signal, '', 'separate'));
      return o;
    },
  },
  {
    id: 'stoch', name: 'Stochastic', shortName: 'Stoch', overlay: false,
    inputs: [int('k', '%K length', 14), int('smooth', '%K smoothing', 3), int('d', '%D length', 3)], colors: { k: '#2f9bff', d: '#ff9f43' },
    compute: (bars, p) => {
      const o = emptyOutput(bars.length); const s = ta.stoch(bars, p.k, p.smooth, p.d);
      o.plots.push(line('k', '%K', s.k, '', 'separate'), line('d', '%D', s.d, '', 'separate'));
      o.hlines.push({ price: 80, title: '80', color: '#6b6b76' }, { price: 20, title: '20', color: '#6b6b76' });
      return o;
    },
  },
  {
    id: 'cci', name: 'Commodity Channel Index', shortName: 'CCI', overlay: false,
    inputs: [int('length', 'Length', 20)], colors: { cci: '#22b07d' },
    compute: (bars, p) => {
      const o = emptyOutput(bars.length); o.plots.push(line('cci', `CCI ${p.length}`, ta.cci(bars, p.length), '', 'separate'));
      o.hlines.push({ price: 100, title: '+100', color: '#6b6b76' }, { price: -100, title: '-100', color: '#6b6b76' });
      return o;
    },
  },
  {
    id: 'atr', name: 'Average True Range', shortName: 'ATR', overlay: false,
    inputs: [int('length', 'Length', 14)], colors: { atr: '#e5484d' },
    compute: (bars, p) => { const o = emptyOutput(bars.length); o.plots.push(line('atr', `ATR ${p.length}`, ta.atr(bars, p.length), '', 'separate')); return o; },
  },
  {
    id: 'adx', name: 'ADX / DMI', shortName: 'ADX', overlay: false,
    inputs: [int('length', 'Length', 14)], colors: { adx: '#e8c25a', plus: '#22b07d', minus: '#e5484d' },
    compute: (bars, p) => {
      const o = emptyOutput(bars.length); const a = ta.adx(bars, p.length);
      o.plots.push(line('adx', 'ADX', a.adx, '', 'separate'), line('plus', '+DI', a.plusDI, '', 'separate'), line('minus', '-DI', a.minusDI, '', 'separate'));
      o.hlines.push({ price: 25, title: '25', color: '#6b6b76' });
      return o;
    },
  },
];

export const BUILTIN_MAP = new Map(BUILTINS.map((d) => [d.id, d]));

export function defaultParams(def: { inputs: InputDef[] }): Record<string, any> {
  return Object.fromEntries(def.inputs.map((i) => [i.id, i.default]));
}

/** Resolve plot colors: '' -> instance/default color by plot id; '$key' -> named color key. */
export function resolveColors(plots: PlotOutput[], colors: Record<string, string>, fallback: string[] = ['#e8c25a', '#6b8afd', '#22b07d', '#e5484d', '#c678dd']) {
  plots.forEach((pl, i) => {
    if (!pl.color || pl.color.startsWith('$')) pl.color = colors[pl.color ? pl.color.slice(1) : pl.id] ?? colors[pl.id] ?? fallback[i % fallback.length];
    if (pl.colors) pl.colors = pl.colors.map((c) => (c && c.startsWith('$') ? colors[c.slice(1)] ?? c : c));
  });
}
