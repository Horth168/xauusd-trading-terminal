import { useCallback, useEffect, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, type IChartApi, type ISeriesApi, type SeriesType, type Time } from 'lightweight-charts';
import type { Bar } from '../../market/types';
import type { AiOverlay } from '../types';
import { TF_SECONDS } from '../config';
import { addOverlayLines, overlayMarkers } from './overlayMarks';
import { AiZones } from './AiZones';
import { fmtDateTime } from '../../lib/time';
import { useSettings } from '../../store/settings';

/** Self-contained chart of the candles a signal/report was based on, with the AI annotations. */
export function SignalChart({ bars, overlay, height = 320, markTime }: { bars: Bar[]; overlay: AiOverlay | null; height?: number; markTime?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<{ chart: IChartApi; series: ISeriesApi<SeriesType> } | null>(null);
  const tz = useSettings((s) => s.timezone);
  const barsRef = useRef(bars);
  barsRef.current = bars;
  const getBars = useCallback(() => barsRef.current, []);
  const tfSec = overlay ? TF_SECONDS[overlay.tf] : 300;

  useEffect(() => {
    const chart = createChart(el.current!, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#0b0b0d' }, textColor: '#9a9aa5', fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: '#16161a' }, horzLines: { color: '#16161a' } },
      rightPriceScale: { borderColor: '#1e1e23' },
      timeScale: { borderColor: '#1e1e23', timeVisible: true, rightOffset: 6 },
      localization: { timeFormatter: (t: Time) => fmtDateTime(t as number, tz) },
    });
    const series = chart.addSeries(CandlestickSeries, { upColor: '#22b07d', downColor: '#e5484d', borderVisible: false, wickUpColor: '#22b07d', wickDownColor: '#e5484d' });
    setApi({ chart, series });
    return () => { chart.remove(); setApi(null); };
  }, [tz]);

  useEffect(() => {
    if (!api) return;
    api.series.setData(bars.map((b) => ({ time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close })));
    const lines = overlay ? addOverlayLines(api.series, overlay) : [];
    const marks = overlay ? overlayMarkers(overlay, bars, tfSec) : [];
    if (markTime) {
      const t = Math.floor(markTime / tfSec) * tfSec;
      if (bars.some((b) => b.time === t)) marks.push({ time: t as Time, position: overlay?.plan?.side === 'SELL' ? 'aboveBar' : 'belowBar', shape: overlay?.plan?.side === 'SELL' ? 'arrowDown' : 'arrowUp', color: '#e8c25a', text: 'Signal' });
    }
    marks.sort((a, b) => (a.time as number) - (b.time as number));
    const m = createSeriesMarkers(api.series, marks);
    api.chart.timeScale().fitContent();
    return () => { lines.forEach((l) => api.series.removePriceLine(l)); m.detach(); };
  }, [api, bars, overlay, tfSec, markTime]);

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-white/5" style={{ height }}>
      <div ref={el} className="absolute inset-0" />
      {api && <AiZones chart={api.chart} series={api.series} getBars={getBars} tfSeconds={tfSec} overlay={overlay} />}
      {!bars.length && <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-400">No candles stored for this analysis.</div>}
    </div>
  );
}
