import { LineStyle, type IPriceLine, type ISeriesApi, type SeriesMarker, type SeriesType, type Time } from 'lightweight-charts';
import type { Bar } from '../../market/types';
import type { AiOverlay } from '../types';

/** Price lines for AI levels (S/R, entry, SL, TP1, TP2). Returns them so callers can remove them. */
export function addOverlayLines(series: ISeriesApi<SeriesType>, ov: AiOverlay): IPriceLine[] {
  const lines: IPriceLine[] = [];
  for (const l of ov.levels.slice(0, 6)) {
    lines.push(series.createPriceLine({ price: l.price, color: l.kind === 'support' ? 'rgba(34,176,125,0.55)' : 'rgba(229,72,77,0.55)', lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: false, title: `AI ${l.kind === 'support' ? 'S' : 'R'}${l.touches > 1 ? `×${l.touches}` : ''}` }));
  }
  for (const pool of ov.pools.slice(0, 4)) {
    lines.push(series.createPriceLine({ price: pool.price, color: 'rgba(198,120,221,0.7)', lineStyle: LineStyle.SparseDotted, lineWidth: 1, axisLabelVisible: false, title: `${pool.side === 'buy' ? 'BSL' : 'SSL'}` }));
  }
  const p = ov.plan;
  if (p) {
    lines.push(series.createPriceLine({ price: p.entryRef, color: '#e8c25a', lineStyle: LineStyle.Solid, lineWidth: 2, title: `AI ${p.side} entry` }));
    lines.push(series.createPriceLine({ price: p.sl, color: '#e5484d', lineStyle: LineStyle.Dashed, lineWidth: 2, title: 'SL' }));
    lines.push(series.createPriceLine({ price: p.tp1, color: '#22b07d', lineStyle: LineStyle.Dashed, lineWidth: 2, title: 'TP1' }));
    lines.push(series.createPriceLine({ price: p.tp2, color: '#22b07d', lineStyle: LineStyle.Dotted, lineWidth: 2, title: 'TP2' }));
  }
  return lines;
}

/** Markers for BOS / CHOCH and liquidity sweeps, snapped to bars present on the chart. */
export function overlayMarkers(ov: AiOverlay, bars: Bar[], tfSeconds: number): SeriesMarker<Time>[] {
  const times = bars.map((b) => b.time);
  const snap = (t: number) => {
    const bucket = Math.floor(t / tfSeconds) * tfSeconds;
    return times.includes(bucket) ? bucket : null;
  };
  const out: SeriesMarker<Time>[] = [];
  for (const e of ov.events) {
    const t = snap(e.time);
    if (t != null) out.push({ time: t as Time, position: e.direction === 'bullish' ? 'belowBar' : 'aboveBar', shape: 'square', color: e.kind === 'CHOCH' ? '#c678dd' : '#2f9bff', text: e.kind });
  }
  for (const s of ov.sweeps) {
    const t = snap(s.time);
    if (t != null) out.push({ time: t as Time, position: s.side === 'buy' ? 'aboveBar' : 'belowBar', shape: 'circle', color: '#ff9f43', text: 'Sweep' });
  }
  return out;
}
