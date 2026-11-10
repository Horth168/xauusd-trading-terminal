/**
 * Technical-analysis primitives. Every function is causal: value[i] only uses inputs[0..i],
 * so indicators never look ahead and never repaint closed bars. Undefined values are NaN.
 */
import type { Bar } from '../market/types';

export type Series = number[];

const nanArray = (n: number) => new Array<number>(n).fill(NaN);

export function sma(src: Series, len: number): Series {
  const out = nanArray(src.length);
  let sum = 0, count = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (!Number.isNaN(v)) { sum += v; count++; }
    if (i >= len) { const old = src[i - len]; if (!Number.isNaN(old)) { sum -= old; count--; } }
    if (i >= len - 1 && count === len) out[i] = sum / len;
  }
  return out;
}

export function ema(src: Series, len: number): Series {
  const out = nanArray(src.length);
  const k = 2 / (len + 1);
  let prev = NaN, seed = 0, seen = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (Number.isNaN(v)) continue;
    if (Number.isNaN(prev)) {
      seed += v; seen++;
      if (seen === len) { prev = seed / len; out[i] = prev; }
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/** Wilder's smoothing (RMA), used by RSI, ATR, ADX. */
export function rma(src: Series, len: number): Series {
  const out = nanArray(src.length);
  let prev = NaN, seed = 0, seen = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (Number.isNaN(v)) continue;
    if (Number.isNaN(prev)) {
      seed += v; seen++;
      if (seen === len) { prev = seed / len; out[i] = prev; }
    } else {
      prev = (prev * (len - 1) + v) / len;
      out[i] = prev;
    }
  }
  return out;
}

export function wma(src: Series, len: number): Series {
  const out = nanArray(src.length);
  const denom = (len * (len + 1)) / 2;
  for (let i = len - 1; i < src.length; i++) {
    let s = 0, ok = true;
    for (let j = 0; j < len; j++) { const v = src[i - j]; if (Number.isNaN(v)) { ok = false; break; } s += v * (len - j); }
    if (ok) out[i] = s / denom;
  }
  return out;
}

export function stdev(src: Series, len: number): Series {
  const mean = sma(src, len);
  const out = nanArray(src.length);
  for (let i = len - 1; i < src.length; i++) {
    if (Number.isNaN(mean[i])) continue;
    let s = 0;
    for (let j = 0; j < len; j++) s += (src[i - j] - mean[i]) ** 2;
    out[i] = Math.sqrt(s / len);
  }
  return out;
}

export function highest(src: Series, len: number): Series {
  const out = nanArray(src.length);
  for (let i = len - 1; i < src.length; i++) { let m = -Infinity; for (let j = 0; j < len; j++) m = Math.max(m, src[i - j]); out[i] = m; }
  return out;
}

export function lowest(src: Series, len: number): Series {
  const out = nanArray(src.length);
  for (let i = len - 1; i < src.length; i++) { let m = Infinity; for (let j = 0; j < len; j++) m = Math.min(m, src[i - j]); out[i] = m; }
  return out;
}

export function change(src: Series, len = 1): Series {
  return src.map((v, i) => (i >= len ? v - src[i - len] : NaN));
}

export function trueRange(bars: Bar[]): Series {
  return bars.map((b, i) => (i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))));
}

export function atr(bars: Bar[], len: number): Series {
  return rma(trueRange(bars), len);
}

export function rsi(src: Series, len: number): Series {
  const up = src.map((v, i) => (i === 0 ? NaN : Math.max(v - src[i - 1], 0)));
  const dn = src.map((v, i) => (i === 0 ? NaN : Math.max(src[i - 1] - v, 0)));
  const ru = rma(up, len), rd = rma(dn, len);
  return ru.map((u, i) => (Number.isNaN(u) ? NaN : rd[i] === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / rd[i])));
}

export function macd(src: Series, fast: number, slow: number, signal: number) {
  const f = ema(src, fast), s = ema(src, slow);
  const line = f.map((v, i) => v - s[i]);
  const sig = ema(line, signal);
  const hist = line.map((v, i) => v - sig[i]);
  return { line, signal: sig, hist };
}

export function stoch(bars: Bar[], kLen: number, kSmooth: number, dLen: number) {
  const hi = highest(bars.map((b) => b.high), kLen), lo = lowest(bars.map((b) => b.low), kLen);
  const raw = bars.map((b, i) => (hi[i] === lo[i] ? 50 : (100 * (b.close - lo[i])) / (hi[i] - lo[i])));
  const k = sma(raw, kSmooth);
  const d = sma(k, dLen);
  return { k, d };
}

export function cci(bars: Bar[], len: number): Series {
  const tp = bars.map((b) => (b.high + b.low + b.close) / 3);
  const m = sma(tp, len);
  const out = nanArray(bars.length);
  for (let i = len - 1; i < bars.length; i++) {
    let dev = 0;
    for (let j = 0; j < len; j++) dev += Math.abs(tp[i - j] - m[i]);
    dev /= len;
    out[i] = dev === 0 ? 0 : (tp[i] - m[i]) / (0.015 * dev);
  }
  return out;
}

export function adx(bars: Bar[], len: number) {
  const plusDM = bars.map((b, i) => { if (!i) return NaN; const up = b.high - bars[i - 1].high, dn = bars[i - 1].low - b.low; return up > dn && up > 0 ? up : 0; });
  const minusDM = bars.map((b, i) => { if (!i) return NaN; const up = b.high - bars[i - 1].high, dn = bars[i - 1].low - b.low; return dn > up && dn > 0 ? dn : 0; });
  const tr = rma(trueRange(bars).map((v, i) => (i ? v : NaN)), len);
  const pdi = rma(plusDM, len).map((v, i) => (100 * v) / tr[i]);
  const mdi = rma(minusDM, len).map((v, i) => (100 * v) / tr[i]);
  const dx = pdi.map((p, i) => { const s = p + mdi[i]; return s === 0 ? 0 : (100 * Math.abs(p - mdi[i])) / s; });
  return { adx: rma(dx, len), plusDI: pdi, minusDI: mdi };
}

export function bollinger(src: Series, len: number, mult: number) {
  const basis = sma(src, len), dev = stdev(src, len);
  return { basis, upper: basis.map((b, i) => b + mult * dev[i]), lower: basis.map((b, i) => b - mult * dev[i]) };
}

/** Session VWAP anchored at each day start in the given UTC offset (seconds). Uses tick volume when present. */
export function vwap(bars: Bar[], anchorOffsetSec = 0): Series {
  const out = nanArray(bars.length);
  let day = -1, pv = 0, vol = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const d = Math.floor((b.time + anchorOffsetSec) / 86400);
    if (d !== day) { day = d; pv = 0; vol = 0; }
    const v = b.volume && b.volume > 0 ? b.volume : 1;
    pv += ((b.high + b.low + b.close) / 3) * v;
    vol += v;
    out[i] = pv / vol;
  }
  return out;
}

export function ichimoku(bars: Bar[], conv: number, base: number, spanB: number, displacement: number) {
  const hi = bars.map((b) => b.high), lo = bars.map((b) => b.low);
  const mid = (len: number) => { const h = highest(hi, len), l = lowest(lo, len); return h.map((v, i) => (v + l[i]) / 2); };
  const tenkan = mid(conv), kijun = mid(base);
  const a = tenkan.map((v, i) => (v + kijun[i]) / 2);
  const b = mid(spanB);
  // Spans are plotted `displacement - 1` bars forward; returned unshifted with offset metadata for the renderer.
  return { tenkan, kijun, spanA: a, spanB: b, chikou: bars.map((x) => x.close), displacement };
}

export function supertrend(bars: Bar[], len: number, mult: number) {
  const a = atr(bars, len);
  const n = bars.length;
  const line = nanArray(n), dir = nanArray(n);
  let upper = NaN, lower = NaN, d = 1;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(a[i])) continue;
    const hl2 = (bars[i].high + bars[i].low) / 2;
    const bu = hl2 + mult * a[i], bl = hl2 - mult * a[i];
    const prevClose = i ? bars[i - 1].close : bars[i].close;
    upper = Number.isNaN(upper) || bu < upper || prevClose > upper ? bu : upper;
    lower = Number.isNaN(lower) || bl > lower || prevClose < lower ? bl : lower;
    if (bars[i].close > upper) d = 1;
    else if (bars[i].close < lower) d = -1;
    dir[i] = d;
    line[i] = d === 1 ? lower : upper;
  }
  return { line, dir };
}

export function heikinAshi(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const close = (b.open + b.high + b.low + b.close) / 4;
    const open = i === 0 ? (b.open + b.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({ time: b.time, open, close, high: Math.max(b.high, open, close), low: Math.min(b.low, open, close), volume: b.volume });
  }
  return out;
}

export function crossover(a: Series, b: Series | number, i: number): boolean {
  const bv = (k: number) => (typeof b === 'number' ? b : b[k]);
  return i > 0 && a[i] > bv(i) && a[i - 1] <= bv(i - 1);
}

export function crossunder(a: Series, b: Series | number, i: number): boolean {
  const bv = (k: number) => (typeof b === 'number' ? b : b[k]);
  return i > 0 && a[i] < bv(i) && a[i - 1] >= bv(i - 1);
}

/** Series-wide versions returning boolean arrays. */
export const crossoverSeries = (a: Series, b: Series | number) => a.map((_, i) => crossover(a, b, i));
export const crossunderSeries = (a: Series, b: Series | number) => a.map((_, i) => crossunder(a, b, i));

export const ta = { sma, ema, rma, wma, stdev, highest, lowest, change, trueRange, atr, rsi, macd, stoch, cci, adx, bollinger, vwap, ichimoku, supertrend, heikinAshi, crossover, crossunder, crossoverSeries, crossunderSeries };
