import { useEffect, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi, Logical, SeriesType } from 'lightweight-charts';
import type { Bar } from '../../market/types';
import type { AiOverlay } from '../types';

/**
 * Draws time/price rectangles (FVG, order blocks, entry zone, invalidation zone) over a Lightweight Chart.
 * Pointer events are disabled, so all chart interactions and drawing tools keep working underneath.
 */
export function AiZones({ chart, series, getBars, tfSeconds, overlay }: { chart: IChartApi; series: ISeriesApi<SeriesType>; getBars: () => Bar[]; tfSeconds: number; overlay: AiOverlay | null }) {
  const ref = useRef<SVGSVGElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    let raf = 0, sig = '';
    const loop = () => {
      const r = ref.current?.getBoundingClientRect();
      const range = chart.timeScale().getVisibleLogicalRange();
      const s = `${range?.from},${range?.to},${series.priceToCoordinate(1000)},${series.priceToCoordinate(5000)},${r?.width},${r?.height},${getBars().length}`;
      if (s !== sig) { sig = s; force((x) => x + 1); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [chart, series, getBars]);

  if (!overlay) return <svg ref={ref} className="pointer-events-none absolute inset-0 z-[5] h-full w-full" />;
  const bars = getBars();
  const logical = (t: number) => {
    if (!bars.length) return 0;
    const last = bars.length - 1;
    if (t >= bars[last].time) return last + (t - bars[last].time) / tfSeconds;
    if (t <= bars[0].time) return (t - bars[0].time) / tfSeconds;
    let lo = 0, hi = last;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (bars[m].time <= t) lo = m; else hi = m; }
    return lo + (t - bars[lo].time) / Math.max(1, bars[hi].time - bars[lo].time);
  };
  const x = (t: number) => chart.timeScale().logicalToCoordinate(logical(t) as Logical) ?? -9999;
  const y = (p: number) => series.priceToCoordinate(p) ?? -9999;
  const W = ref.current?.getBoundingClientRect().width ?? 2000;
  const rect = (key: string, t0: number, top: number, bottom: number, fill: string, stroke: string, label: string) => {
    const x0 = Math.max(-10, x(t0)), y0 = y(top), y1 = y(bottom);
    if (y0 < -5000 || y1 < -5000) return null;
    return (
      <g key={key}>
        <rect x={x0} y={Math.min(y0, y1)} width={Math.max(0, W - x0)} height={Math.max(1, Math.abs(y1 - y0))} fill={fill} stroke={stroke} strokeWidth={0.8} strokeDasharray="3 3" />
        <text x={Math.max(4, x0 + 4)} y={Math.min(y0, y1) + 11} fill={stroke} fontSize={10} fontWeight={600}>{label}</text>
      </g>
    );
  };
  const p = overlay.plan;
  const lastT = bars[bars.length - 1]?.time ?? 0;
  return (
    <svg ref={ref} className="pointer-events-none absolute inset-0 z-[5] h-full w-full overflow-hidden">
      {overlay.zones.map((z, i) => rect(`z${i}`, z.time, z.top, z.bottom, z.direction === 'bullish' ? 'rgba(34,176,125,0.10)' : 'rgba(229,72,77,0.10)', z.direction === 'bullish' ? '#22b07d' : '#e5484d', `${z.direction === 'bullish' ? 'Bull' : 'Bear'} ${z.kind}`))}
      {p && rect('entry', lastT - tfSeconds * 6, p.entryHigh, p.entryLow, 'rgba(232,194,90,0.18)', '#e8c25a', `AI ${p.side} entry zone`)}
      {p && rect('inval', lastT - tfSeconds * 6, p.sl, p.side === 'BUY' ? p.sl - p.risk * 0.25 : p.sl + p.risk * 0.25, 'rgba(229,72,77,0.16)', '#e5484d', 'Invalidation')}
    </svg>
  );
}
