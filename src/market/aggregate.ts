import type { Bar } from './types';
import { bucketStart, type Timeframe } from './timeframes';

/** Aggregate real lower-timeframe candles into a higher timeframe. Never invents prices. */
export function aggregate(bars: Bar[], tf: Timeframe): Bar[] {
  const out: Bar[] = [];
  let cur: Bar | null = null;
  for (const b of bars) {
    const t = bucketStart(b.time, tf);
    if (!cur || cur.time !== t) {
      if (cur) out.push(cur);
      cur = { time: t, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      if (b.volume != null) cur.volume = (cur.volume ?? 0) + b.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Merge an updated/new bar into a sorted series (in place semantics, returns same array). */
export function upsertBar(series: Bar[], bar: Bar): Bar[] {
  const last = series[series.length - 1];
  if (!last || bar.time > last.time) series.push(bar);
  else if (bar.time === last.time) series[series.length - 1] = bar;
  else {
    // out-of-order: binary search replace
    let lo = 0, hi = series.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (series[mid].time === bar.time) { series[mid] = bar; return series; }
      if (series[mid].time < bar.time) lo = mid + 1; else hi = mid - 1;
    }
    series.splice(lo, 0, bar);
  }
  return series;
}

export function mergeBars(a: Bar[], b: Bar[]): Bar[] {
  const map = new Map<number, Bar>();
  for (const x of a) map.set(x.time, x);
  for (const x of b) map.set(x.time, x);
  return [...map.values()].sort((p, q) => p.time - q.time);
}
