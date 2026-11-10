/**
 * XTS — "XAU Terminal Script": a Pine-inspired JavaScript API for custom indicators and strategies.
 * It is NOT Pine Script and does not parse Pine syntax. Scripts are plain JavaScript evaluated with
 * vectorised series (arrays) and the helpers below. Runs inside a Web Worker (see scriptWorker.ts).
 *
 * Available globals inside a script:
 *   open high low close volume time hl2 hlc3 ohlc4 : number[]   bar_count : number
 *   indicator(name, { overlay })  |  strategy(name, { overlay })
 *   input.int(label, def, {min,max,step}) input.float(...) input.bool(label, def)
 *   input.string(label, def) input.select(label, def, options[]) input.color(label, def)
 *   ta.sma/ema/rma/wma/stdev/highest/lowest/change/atr/rsi/macd/stoch/cci/adx/bollinger/vwap/supertrend/
 *      crossover(a,b,i)/crossunder(a,b,i)/crossoverSeries/crossunderSeries ...
 *   plot(series, title, { color, lineWidth, style: 'line'|'histogram'|'area'|'step'|'dots', pane: 'overlay'|'separate', colors })
 *   hline(price, title, { color })
 *   buy(i, text?) / sell(i, text?)                     -> chart marker + long/short signal at bar i
 *   marker(i, { position, shape, color, text })
 *   alert(i, message)                                    -> alert when bar i is the latest CLOSED bar
 *   strategy.entry('long'|'short', i, { sl, tp })        -> entry signal at close of bar i (filled next bar open)
 *   strategy.exit('long'|'short'|'all', i)               -> exit signal at close of bar i
 *   nz(x, replacement=0) na(x)  math helpers via Math
 */
import type { Bar } from '../market/types';
import { ta } from './ta';
import { emptyOutput, type IndicatorOutput, type InputDef, type PlotOutput } from './types';

export interface ScriptMeta {
  kind: 'indicator' | 'strategy';
  name: string;
  overlay: boolean;
  inputs: InputDef[];
}

export interface ScriptResult {
  meta: ScriptMeta;
  output: IndicatorOutput;
  logs: string[];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'input';

export function runScript(code: string, bars: Bar[], params: Record<string, any> = {}): ScriptResult {
  const n = bars.length;
  const out = emptyOutput(n);
  const meta: ScriptMeta = { kind: 'indicator', name: 'Custom script', overlay: true, inputs: [] };
  const logs: string[] = [];
  const palette = ['#e8c25a', '#6b8afd', '#22b07d', '#e5484d', '#c678dd', '#2f9bff', '#ff9f43'];

  const mkInput = (type: InputDef['type']) => (label: string, def: any, opts: any = {}) => {
    const id = slug(label);
    const options = Array.isArray(opts) ? opts : opts.options;
    meta.inputs.push({ id, label, type, default: def, min: opts.min, max: opts.max, step: opts.step, options });
    const v = params[id];
    if (v === undefined) return def;
    if (type === 'int') return Math.round(Number(v));
    if (type === 'float') return Number(v);
    if (type === 'bool') return Boolean(v);
    return v;
  };

  const api = {
    open: bars.map((b) => b.open),
    high: bars.map((b) => b.high),
    low: bars.map((b) => b.low),
    close: bars.map((b) => b.close),
    volume: bars.map((b) => b.volume ?? NaN),
    time: bars.map((b) => b.time),
    hl2: bars.map((b) => (b.high + b.low) / 2),
    hlc3: bars.map((b) => (b.high + b.low + b.close) / 3),
    ohlc4: bars.map((b) => (b.open + b.high + b.low + b.close) / 4),
    bar_count: n,
    // Bar-based helpers are bound to the script's bars, so scripts call ta.atr(14) instead of ta.atr(bars, 14).
    ta: {
      ...ta,
      atr: (len: number) => ta.atr(bars, len),
      trueRange: () => ta.trueRange(bars),
      stoch: (k: number, smooth: number, d: number) => ta.stoch(bars, k, smooth, d),
      cci: (len: number) => ta.cci(bars, len),
      adx: (len: number) => ta.adx(bars, len),
      supertrend: (len: number, mult: number) => ta.supertrend(bars, len, mult),
      vwap: (anchorOffsetSec = 0) => ta.vwap(bars, anchorOffsetSec),
      ichimoku: (conv = 9, base = 26, spanB = 52, disp = 26) => ta.ichimoku(bars, conv, base, spanB, disp),
      heikinAshi: () => ta.heikinAshi(bars),
    },
    indicator: (name: string, opts: { overlay?: boolean } = {}) => { meta.kind = 'indicator'; meta.name = name; meta.overlay = opts.overlay ?? true; },
    strategy: Object.assign(
      (name: string, opts: { overlay?: boolean } = {}) => { meta.kind = 'strategy'; meta.name = name; meta.overlay = opts.overlay ?? true; },
      {
        entry: (side: 'long' | 'short', i: number, o: { sl?: number; tp?: number } = {}) => {
          if (i < 0 || i >= n) return;
          (side === 'long' ? out.signals.long : out.signals.short)[i] = true;
          if (o.sl != null) out.signals.sl[i] = o.sl;
          if (o.tp != null) out.signals.tp[i] = o.tp;
        },
        exit: (side: 'long' | 'short' | 'all', i: number) => {
          if (i < 0 || i >= n) return;
          if (side !== 'short') out.signals.exitLong[i] = true;
          if (side !== 'long') out.signals.exitShort[i] = true;
        },
      },
    ),
    input: { int: mkInput('int'), float: mkInput('float'), bool: mkInput('bool'), string: mkInput('string'), select: mkInput('select'), color: mkInput('color') },
    plot: (series: number[], title = `Plot ${out.plots.length + 1}`, o: Partial<PlotOutput> = {}) => {
      if (!Array.isArray(series) || series.length !== n) throw new Error(`plot("${title}"): series must be an array with one value per bar (${n})`);
      out.plots.push({ id: slug(title), title, values: series.map(Number), color: o.color ?? palette[out.plots.length % palette.length], colors: o.colors, style: o.style ?? 'line', lineWidth: o.lineWidth, offset: o.offset, pane: o.pane ?? (meta.overlay ? 'overlay' : 'separate') });
    },
    hline: (price: number, title = 'level', o: { color?: string } = {}) => out.hlines.push({ price, title, color: o.color ?? '#6b6b76' }),
    buy: (i: number, text = 'Buy') => { if (i >= 0 && i < n) { out.signals.long[i] = true; out.markers.push({ index: i, position: 'belowBar', shape: 'arrowUp', color: '#22b07d', text }); } },
    sell: (i: number, text = 'Sell') => { if (i >= 0 && i < n) { out.signals.short[i] = true; out.markers.push({ index: i, position: 'aboveBar', shape: 'arrowDown', color: '#e5484d', text }); } },
    marker: (i: number, o: any = {}) => { if (i >= 0 && i < n) out.markers.push({ index: i, position: o.position ?? 'aboveBar', shape: o.shape ?? 'circle', color: o.color ?? '#e8c25a', text: o.text }); },
    alert: (i: number, message: string) => out.alerts.push({ index: i, message }),
    nz: (x: number, r = 0) => (Number.isFinite(x) ? x : r),
    na: (x: number) => !Number.isFinite(x),
    log: (...a: any[]) => logs.push(a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ')),
  };

  const names = Object.keys(api);
  // Shadow network/storage globals so imported scripts cannot exfiltrate data.
  const blocked = ['fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'indexedDB', 'caches', 'postMessage', 'self', 'globalThis', 'navigator', 'EventSource'];
  const fn = new Function(...names, ...blocked, `"use strict";\n${code}\n`);
  fn(...names.map((k) => (api as any)[k]), ...blocked.map(() => undefined));

  out.markers.sort((a, b) => a.index - b.index);
  return { meta, output: out, logs };
}
