import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries, BarSeries, CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, LineType,
  createChart, createSeriesMarkers,
  type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type SeriesType, type Time, type UTCTimestamp,
} from 'lightweight-charts';
import { ChevronsLeft, ChevronsRight, Eye, EyeOff, Loader2, Pause, Play, Settings2, X } from 'lucide-react';
import { feed, useFeed } from '../market/feed';
import { upsertBar } from '../market/aggregate';
import { bucketStart, getTimeframe } from '../market/timeframes';
import type { Bar } from '../market/types';
import { useSettings, type IndicatorInstance } from '../store/settings';
import { computeInstance, indicatorMeta, useScripts } from '../indicators/registry';
import { heikinAshi } from '../indicators/ta';
import type { IndicatorOutput } from '../indicators/types';
import { fmtDateTime, fmtTime, fmtDate, tzOffset } from '../lib/time';
import { num } from '../lib/format';
import { DrawingLayer } from './drawings/DrawingLayer';
import { useDrawings } from './drawings/model';
import { useChartMarks } from '../store/chartMarks';
import { useAlerts, createPriceAlert } from '../alerts/engine';

interface Props {
  index: number;
  active: boolean;
  onActivate: () => void;
  onEditIndicator: (chartIndex: number, uid: string) => void;
  registerApi?: (api: PaneApi | null) => void;
}

export interface PaneApi {
  screenshot: () => Promise<Blob | null>;
  startReplay: () => void;
}

const COLORS = { up: '#22b07d', down: '#e5484d', bg: '#0b0b0d', grid: '#16161a', text: '#9a9aa5' };

interface IndRender {
  key: string;
  series: ISeriesApi<SeriesType>[];
  lines: IPriceLine[];
}

const t = (x: number) => x as UTCTimestamp;

export function ChartPane({ index, active, onActivate, onEditIndicator, registerApi }: Props) {
  const cfg = useSettings((s) => s.charts[index]);
  const tz = useSettings((s) => s.timezone);
  const contractSize = useSettings((s) => s.contractSize);
  const updateChart = useSettings((s) => s.updateChart);
  const { generation, source } = useFeed((s) => ({ generation: s.generation, source: s.source }));
  const digits = useFeed((s) => s.symbol.digits);
  const scripts = useScripts((s) => s.scripts);
  const alerts = useAlerts((s) => s.alerts);
  const marks = useChartMarks();

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const barsRef = useRef<Bar[]>([]);
  const indRef = useRef(new Map<string, IndRender>());
  const outputsRef = useRef(new Map<string, IndicatorOutput>());
  const askLineRef = useRef<IPriceLine | null>(null);
  const alertLinesRef = useRef<IPriceLine[]>([]);
  const loadingOlder = useRef(false);
  const [chartReady, setChartReady] = useState<{ chart: IChartApi; series: ISeriesApi<SeriesType> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [legendIdx, setLegendIdx] = useState<number | null>(null);
  const [indErrors, setIndErrors] = useState<Record<string, string>>({});
  const [, bump] = useState(0);

  // Replay state
  const [replay, setReplay] = useState<{ mode: 'off' | 'pick' | 'on'; cursor: number; playing: boolean; speed: number }>({ mode: 'off', cursor: 0, playing: false, speed: 1 });
  const replayRef = useRef(replay);
  replayRef.current = replay;

  const tf = useMemo(() => getTimeframe(cfg.tf), [cfg.tf]);
  const isHA = cfg.chartType === 'heikin' || cfg.indicators.some((i) => i.type === 'heikin' && i.visible);

  const displayBars = useCallback((): Bar[] => {
    const r = replayRef.current;
    const b = barsRef.current;
    return r.mode === 'on' ? b.slice(0, r.cursor + 1) : b;
  }, []);

  // ---------- chart lifecycle ----------
  useEffect(() => {
    const el = containerRef.current!;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: COLORS.bg }, textColor: COLORS.text, fontSize: 11, panes: { separatorColor: '#1e1e23', separatorHoverColor: '#2a2a31' }, attributionLogo: false },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#6b6b76', labelBackgroundColor: '#2a2a31' }, horzLine: { color: '#6b6b76', labelBackgroundColor: '#2a2a31' } },
      rightPriceScale: { borderColor: '#1e1e23', scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: '#1e1e23', timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 7 },
      kineticScroll: { touch: true, mouse: false },
    });
    chartRef.current = chart;
    chart.subscribeCrosshairMove((p) => {
      if (p.logical == null || p.time == null) { setLegendIdx(null); return; }
      setLegendIdx(Math.round(p.logical as number));
    });
    chart.subscribeClick((p) => {
      const r = replayRef.current;
      if (r.mode === 'pick' && p.logical != null) {
        const cursor = Math.max(10, Math.min(barsRef.current.length - 1, Math.round(p.logical as number)));
        setReplay({ mode: 'on', cursor, playing: false, speed: r.speed });
        return;
      }
      if (useDrawings.getState().tool === 'cursor') useDrawings.getState().select(null);
    });
    return () => {
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
      markersRef.current = null;
      indRef.current.clear();
      setChartReady(null);
    };
  }, []);

  // timezone-aware axis labels
  useEffect(() => {
    chartRef.current?.applyOptions({
      localization: { timeFormatter: (time: Time) => fmtDateTime(time as number, tz), priceFormatter: (p: number) => num(p, digits) },
      timeScale: {
        tickMarkFormatter: (time: Time, type: number) => {
          const s = time as number;
          if (type === 0) return new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric' }).format(s * 1000);
          if (type === 1) return new Intl.DateTimeFormat('en-GB', { timeZone: tz, month: 'short' }).format(s * 1000);
          if (type === 2) return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'short' }).format(s * 1000);
          return fmtTime(s, tz, type === 4);
        },
      },
    });
  }, [tz, digits]);

  // main series (recreated when chart type changes)
  useEffect(() => {
    const chart = chartRef.current!;
    if (mainRef.current) { chart.removeSeries(mainRef.current); markersRef.current = null; }
    const fmt = { type: 'price' as const, precision: digits, minMove: 1 / 10 ** digits };
    let s: ISeriesApi<SeriesType>;
    if (cfg.chartType === 'line') s = chart.addSeries(LineSeries, { color: '#e8c25a', lineWidth: 2, priceFormat: fmt });
    else if (cfg.chartType === 'area') s = chart.addSeries(AreaSeries, { lineColor: '#e8c25a', topColor: 'rgba(232,194,90,0.3)', bottomColor: 'rgba(232,194,90,0)', priceFormat: fmt });
    else if (cfg.chartType === 'bars') s = chart.addSeries(BarSeries, { upColor: COLORS.up, downColor: COLORS.down, priceFormat: fmt });
    else s = chart.addSeries(CandlestickSeries, { upColor: COLORS.up, downColor: COLORS.down, borderVisible: false, wickUpColor: COLORS.up, wickDownColor: COLORS.down, priceFormat: fmt });
    mainRef.current = s;
    markersRef.current = createSeriesMarkers(s, []);
    askLineRef.current = null;
    alertLinesRef.current = [];
    setChartReady({ chart, series: s });
    if (barsRef.current.length) applyMain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.chartType, digits]);

  const toSeriesData = useCallback((bars: Bar[]) => {
    const src = isHA ? heikinAshi(bars) : bars;
    if (cfg.chartType === 'line' || cfg.chartType === 'area') return src.map((b) => ({ time: t(b.time), value: b.close }));
    return src.map((b) => ({ time: t(b.time), open: b.open, high: b.high, low: b.low, close: b.close }));
  }, [isHA, cfg.chartType]);

  const applyMain = useCallback(() => {
    const s = mainRef.current;
    if (!s) return;
    s.setData(toSeriesData(displayBars()) as any);
  }, [toSeriesData, displayBars]);

  // ---------- indicators ----------
  const indTimer = useRef<number | null>(null);
  const runIndicators = useCallback(async () => {
    const chart = chartRef.current;
    if (!chart || !mainRef.current) return;
    const bars = displayBars();
    if (!bars.length) return;
    const tzOff = tzOffset(tz, bars[bars.length - 1].time);
    const visible = cfg.indicators.filter((i) => i.visible && i.type !== 'heikin');
    const results = await Promise.all(visible.map((inst) => computeInstance(inst, bars, tzOff).then((o) => ({ inst, o, err: null as string | null })).catch((e) => ({ inst, o: null, err: String(e.message ?? e) }))));
    if (chartRef.current !== chart) return;
    const errs: Record<string, string> = {};
    results.forEach((r) => { if (r.err) errs[r.inst.uid] = r.err; });
    setIndErrors(errs);
    outputsRef.current = new Map(results.filter((r) => r.o).map((r) => [r.inst.uid, r.o!]));

    // structure signature: when it changes, rebuild all indicator series (keeps pane indexes consistent)
    const sig = results.map((r) => `${r.inst.uid}:${r.inst.lineWidth}:${r.o ? r.o.plots.map((p) => `${p.id}/${p.style}/${p.pane}/${p.color}`).join(',') + '|' + r.o.hlines.map((h) => h.price).join(',') : 'x'}`).join(';');
    const current = [...indRef.current.values()].map((r) => r.key).join(';');
    if (sig !== current || indRef.current.size !== results.length) {
      for (const r of indRef.current.values()) r.series.forEach((s) => chart.removeSeries(s));
      indRef.current.clear();
      let paneCounter = 0;
      for (const r of results) {
        const entry: IndRender = { key: '', series: [], lines: [] };
        if (r.o) {
          const separate = r.o.plots.some((p) => p.pane === 'separate');
          const pane = separate ? ++paneCounter : 0;
          for (const p of r.o.plots) {
            const color = r.inst.colors[p.id] ?? p.color;
            const common = { priceLineVisible: false, lastValueVisible: true, title: '', priceFormat: { type: 'price' as const, precision: pane ? 2 : digits, minMove: pane ? 0.01 : 1 / 10 ** digits } };
            let s: ISeriesApi<SeriesType>;
            if (p.style === 'histogram') s = chart.addSeries(HistogramSeries, { ...common, color }, pane);
            else if (p.style === 'area') s = chart.addSeries(AreaSeries, { ...common, lineColor: color, topColor: color + '55', bottomColor: color + '00', lineWidth: (p.lineWidth ?? r.inst.lineWidth) as any }, pane);
            else s = chart.addSeries(LineSeries, { ...common, color, lineWidth: (p.lineWidth ?? r.inst.lineWidth) as any, lineType: p.style === 'step' ? LineType.WithSteps : LineType.Simple, lineVisible: p.style !== 'dots', pointMarkersVisible: p.style === 'dots', crosshairMarkerVisible: false }, pane);
            entry.series.push(s);
          }
          if (entry.series[0]) for (const h of r.o.hlines) entry.lines.push(entry.series[0].createPriceLine({ price: h.price, color: h.color, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: h.title }));
        }
        entry.key = `${r.inst.uid}:${r.inst.lineWidth}:${r.o ? r.o.plots.map((p) => `${p.id}/${p.style}/${p.pane}/${p.color}`).join(',') + '|' + r.o.hlines.map((h) => h.price).join(',') : 'x'}`;
        indRef.current.set(r.inst.uid, entry);
      }
      // Main price pane gets most of the space; each oscillator pane an equal share of the rest.
      const panes = chart.panes();
      if (panes.length > 1) {
        panes[0].setStretchFactor(Math.max(2, 6 - panes.length));
        panes.slice(1).forEach((p) => p.setStretchFactor(1));
      }
    }
    // data
    const last = bars[bars.length - 1].time;
    for (const r of results) {
      const entry = indRef.current.get(r.inst.uid);
      if (!entry || !r.o) continue;
      r.o.plots.forEach((p, k) => {
        const s = entry.series[k];
        if (!s) return;
        const off = p.offset ?? 0;
        const data: any[] = [];
        for (let i = 0; i < p.values.length; i++) {
          const j = i + off;
          if (j < 0) continue;
          const time = j < bars.length ? bars[j].time : last + (j - bars.length + 1) * tf.seconds;
          const v = p.values[i];
          if (!Number.isFinite(v)) { data.push({ time: t(time) }); continue; }
          const c = p.colors?.[i];
          data.push(c ? { time: t(time), value: v, color: c } : { time: t(time), value: v });
        }
        data.sort((a, b) => a.time - b.time);
        s.setData(dedupe(data));
      });
    }
    updateMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.indicators, tz, digits, displayBars, tf.seconds, scripts]);

  const scheduleIndicators = useCallback((delay = 400) => {
    if (indTimer.current) return;
    indTimer.current = window.setTimeout(() => { indTimer.current = null; runIndicators(); }, delay);
  }, [runIndicators]);

  useEffect(() => { if (chartReady && barsRef.current.length) runIndicators(); }, [chartReady, runIndicators]);

  // ---------- markers (indicator signals + backtest trades) ----------
  const updateMarkers = useCallback(() => {
    const m = markersRef.current;
    if (!m) return;
    const bars = displayBars();
    const times = new Set(bars.map((b) => b.time));
    const out: SeriesMarker<Time>[] = [];
    for (const o of outputsRef.current.values()) for (const mk of o.markers) {
      const b = bars[mk.index];
      if (b) out.push({ time: t(b.time), position: mk.position, shape: mk.shape, color: mk.color, text: mk.text });
    }
    const st = useChartMarks.getState();
    for (const tr of st.trades) {
      const et = bucketStart(tr.entryTime, tf), xt = bucketStart(tr.exitTime, tf);
      const long = tr.side === 'long';
      if (times.has(et)) out.push({ time: t(et), position: long ? 'belowBar' : 'aboveBar', shape: long ? 'arrowUp' : 'arrowDown', color: long ? COLORS.up : COLORS.down, text: `#${tr.id} ${long ? 'L' : 'S'}` });
      if (times.has(xt)) out.push({ time: t(xt), position: long ? 'aboveBar' : 'belowBar', shape: 'circle', color: tr.pnl >= 0 ? COLORS.up : COLORS.down, text: `${tr.pnl >= 0 ? '+' : ''}${tr.pnl.toFixed(0)}` });
    }
    out.sort((a, b) => (a.time as number) - (b.time as number));
    m.setMarkers(out);
  }, [displayBars, tf]);

  useEffect(() => { updateMarkers(); }, [marks.trades, updateMarkers]);

  // Focused backtest trade: SL/TP/entry price lines + scroll to it
  useEffect(() => {
    const s = mainRef.current, chart = chartRef.current;
    if (!s || !chart || !marks.focus) return;
    const f = marks.focus;
    const lines = [
      s.createPriceLine({ price: f.entryPrice, color: '#ececf1', lineStyle: LineStyle.Solid, lineWidth: 1, title: `#${f.id} entry` }),
      f.sl ? s.createPriceLine({ price: f.sl, color: COLORS.down, lineStyle: LineStyle.Dashed, lineWidth: 1, title: 'SL' }) : null,
      f.tp ? s.createPriceLine({ price: f.tp, color: COLORS.up, lineStyle: LineStyle.Dashed, lineWidth: 1, title: 'TP' }) : null,
      s.createPriceLine({ price: f.exitPrice, color: f.pnl >= 0 ? COLORS.up : COLORS.down, lineStyle: LineStyle.Dotted, lineWidth: 1, title: 'exit' }),
    ].filter(Boolean) as IPriceLine[];
    const bars = barsRef.current;
    const i = bars.findIndex((b) => b.time >= bucketStart(f.entryTime, tf));
    if (i >= 0) chart.timeScale().setVisibleLogicalRange({ from: i - 60, to: i + 60 });
    return () => lines.forEach((l) => s.removePriceLine(l));
  }, [marks.focus, chartReady, tf, loading]);

  // Alert lines on chart
  useEffect(() => {
    const s = mainRef.current;
    if (!s) return;
    alertLinesRef.current.forEach((l) => s.removePriceLine(l));
    alertLinesRef.current = alerts
      .filter((a) => a.kind === 'price' && a.active && a.price != null)
      .map((a) => s.createPriceLine({ price: a.price!, color: '#ff9f43', lineStyle: LineStyle.LargeDashed, lineWidth: 1, title: `⏰ ${a.condition === 'above' ? '↑' : a.condition === 'below' ? '↓' : '↕'}` }));
  }, [alerts, chartReady]);

  // ---------- data loading + live updates ----------
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReplay((r) => ({ ...r, mode: 'off', playing: false }));
    barsRef.current = [];
    if (!source) {
      setLoading(false);
      setError('No market data source connected.');
      mainRef.current?.setData([]);
      return;
    }
    feed.load(cfg.tf, 1500).then((bars) => {
      if (cancelled) return;
      barsRef.current = bars;
      applyMain();
      const n = bars.length;
      chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 160), to: n + 6 });
      setLoading(false);
      runIndicators();
      bump((x) => x + 1);
    }).catch((e) => { if (!cancelled) { setLoading(false); setError(String(e.message ?? e)); } });

    const unsub = feed.subscribe(cfg.tf, (bar) => {
      if (cancelled || !barsRef.current.length) return;
      const arr = barsRef.current;
      const lastTime = arr[arr.length - 1].time;
      if (bar.time < lastTime) {
        // A just-closed candle re-sent by the feed: ignore if unchanged, otherwise redraw everything
        // (lightweight-charts can only update() the latest bar).
        const old = arr.find((b) => b.time === bar.time);
        if (old && old.open === bar.open && old.high === bar.high && old.low === bar.low && old.close === bar.close && old.volume === bar.volume) return;
        upsertBar(arr, bar);
        if (replayRef.current.mode !== 'on') { applyMain(); scheduleIndicators(800); }
        return;
      }
      upsertBar(arr, bar);
      if (replayRef.current.mode === 'on') return;
      const s = mainRef.current;
      if (s) {
        const src = isHA ? heikinAshi(barsRef.current.slice(-2)).slice(-1)[0] : bar;
        if (cfg.chartType === 'line' || cfg.chartType === 'area') s.update({ time: t(src.time), value: src.close });
        else s.update({ time: t(src.time), open: src.open, high: src.high, low: src.low, close: src.close });
      }
      scheduleIndicators(800);
      bump((x) => x + 1);
    });

    const onRange = (range: { from: number; to: number } | null) => {
      if (!range || range.from > 40 || loadingOlder.current || replayRef.current.mode !== 'off' || !barsRef.current.length) return;
      loadingOlder.current = true;
      const before = barsRef.current.length;
      feed.loadOlder(cfg.tf).then((merged) => {
        if (cancelled || !merged) return;
        const added = merged.length - before;
        barsRef.current = merged;
        const ts = chartRef.current?.timeScale();
        const vr = ts?.getVisibleLogicalRange();
        applyMain();
        if (vr && ts) ts.setVisibleLogicalRange({ from: vr.from + added, to: vr.to + added });
        runIndicators();
      }).catch(() => {}).finally(() => { loadingOlder.current = false; });
    };
    chartRef.current?.timeScale().subscribeVisibleLogicalRangeChange(onRange as any);
    return () => {
      cancelled = true;
      unsub();
      chartRef.current?.timeScale().unsubscribeVisibleLogicalRangeChange(onRange as any);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.tf, generation, source]);

  useEffect(() => { applyMain(); runIndicators(); }, [isHA]); // eslint-disable-line react-hooks/exhaustive-deps

  // ask line from MT5 ticks
  useEffect(() => useFeed.subscribe((st) => {
    const s = mainRef.current;
    if (!s || replayRef.current.mode === 'on') return;
    const ask = st.tick?.ask;
    if (ask == null) return;
    if (!askLineRef.current) askLineRef.current = s.createPriceLine({ price: ask, color: '#2f9bff', lineStyle: LineStyle.Dotted, lineWidth: 1, title: 'Ask', axisLabelVisible: true });
    else askLineRef.current.applyOptions({ price: ask });
  }), [chartReady]);

  // ---------- replay ----------
  useEffect(() => {
    applyMain();
    runIndicators();
    if (replay.mode === 'off') {
      const n = barsRef.current.length;
      chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 160), to: n + 6 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay.mode, replay.cursor]);

  useEffect(() => {
    if (!replay.playing || replay.mode !== 'on') return;
    const id = window.setInterval(() => {
      setReplay((r) => (r.cursor >= barsRef.current.length - 1 ? { ...r, playing: false } : { ...r, cursor: r.cursor + 1 }));
    }, 1000 / replay.speed);
    return () => clearInterval(id);
  }, [replay.playing, replay.speed, replay.mode]);

  // ---------- pane API (screenshot, replay) ----------
  useEffect(() => {
    registerApi?.({
      screenshot: async () => {
        const chart = chartRef.current;
        if (!chart) return null;
        const canvas = chart.takeScreenshot();
        const svg = containerRef.current?.parentElement?.querySelector('svg.absolute') as SVGSVGElement | null;
        if (svg) {
          const xml = new XMLSerializer().serializeToString(svg);
          const img = new Image();
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
          await new Promise((r) => { img.onload = r; img.onerror = r; });
          canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        }
        return new Promise((r) => canvas.toBlob(r, 'image/png'));
      },
      startReplay: () => setReplay((r) => ({ ...r, mode: 'pick', playing: false })),
    });
    return () => registerApi?.(null);
  }, [registerApi]);

  // ---------- legend ----------
  const bars = displayBars();
  const li = legendIdx != null && legendIdx >= 0 && legendIdx < bars.length ? legendIdx : bars.length - 1;
  const lb = bars[li];
  const prev = bars[li - 1];
  const chg = lb && prev ? lb.close - prev.close : 0;

  const toggleInd = (inst: IndicatorInstance) => updateChart(index, { indicators: cfg.indicators.map((i) => (i.uid === inst.uid ? { ...i, visible: !i.visible } : i)) });
  const removeInd = (inst: IndicatorInstance) => updateChart(index, { indicators: cfg.indicators.filter((i) => i.uid !== inst.uid) });

  return (
    <div className={`relative h-full w-full overflow-hidden ${active ? 'ring-1 ring-gold-600/50' : ''}`} onPointerDownCapture={onActivate}>
      <div ref={containerRef} className="absolute inset-0" />
      {chartReady && (
        <DrawingLayer
          chart={chartReady.chart}
          series={chartReady.series}
          getBars={displayBars}
          tfSeconds={tf.seconds}
          digits={digits}
          contractSize={contractSize}
          active={active}
          onAlert={(price) => createPriceAlert(price, barsRef.current[barsRef.current.length - 1]?.close)}
        />
      )}

      {/* Legend */}
      <div className="pointer-events-none absolute left-2 top-1.5 z-20 max-w-[calc(100%-80px)] select-none text-[11px] leading-5">
        <div className="flex flex-wrap items-center gap-x-2 font-mono">
          <span className="font-sans font-semibold text-ink-100">{source === 'twelvedata' ? 'XAU/USD' : 'XAUUSD'} · {tf.label}</span>
          {replay.mode === 'on' && <span className="rounded bg-gold-500/20 px-1 text-gold-300">REPLAY</span>}
          {lb && (
            <>
              <span className="text-ink-400">{fmtDateTime(lb.time, tz)}</span>
              <span>O <b className={chg >= 0 ? 'text-up' : 'text-down'}>{num(lb.open, digits)}</b></span>
              <span>H <b className={chg >= 0 ? 'text-up' : 'text-down'}>{num(lb.high, digits)}</b></span>
              <span>L <b className={chg >= 0 ? 'text-up' : 'text-down'}>{num(lb.low, digits)}</b></span>
              <span>C <b className={chg >= 0 ? 'text-up' : 'text-down'}>{num(lb.close, digits)}</b></span>
              <span className={chg >= 0 ? 'text-up' : 'text-down'}>{chg >= 0 ? '+' : ''}{num(chg, digits)} ({prev ? ((chg / prev.close) * 100).toFixed(2) : '0.00'}%)</span>
              {lb.volume != null && <span className="text-ink-400">Vol {lb.volume}</span>}
            </>
          )}
        </div>
        {cfg.indicators.map((inst) => {
          const meta = indicatorMeta(inst.type);
          const o = outputsRef.current.get(inst.uid);
          return (
            <div key={inst.uid} className="pointer-events-auto group flex items-center gap-1.5 text-ink-300">
              <span className={inst.visible ? '' : 'opacity-40'}>{meta.shortName} {meta.inputs.filter((i) => i.type === 'int' || i.type === 'float').map((i) => inst.params[i.id]).join(' ')}</span>
              {inst.visible && o?.plots.slice(0, 4).map((p) => {
                const v = p.values[li - (p.offset ?? 0)];
                return <span key={p.id} className="font-mono" style={{ color: inst.colors[p.id] ?? p.color }}>{Number.isFinite(v) ? num(v, p.pane === 'overlay' ? digits : 2) : '—'}</span>;
              })}
              {indErrors[inst.uid] && <span className="text-down" title={indErrors[inst.uid]}>error: {indErrors[inst.uid].slice(0, 60)}</span>}
              <span className="flex gap-1 opacity-60 group-hover:opacity-100 sm:opacity-0">
                <button className="hover:text-gold-300" title={inst.visible ? 'Hide' : 'Show'} onClick={() => toggleInd(inst)}>{inst.visible ? <Eye size={12} /> : <EyeOff size={12} />}</button>
                <button className="hover:text-gold-300" title="Settings" onClick={() => onEditIndicator(index, inst.uid)}><Settings2 size={12} /></button>
                <button className="hover:text-down" title="Remove" onClick={() => removeInd(inst)}><X size={12} /></button>
              </span>
            </div>
          );
        })}
        {marks.trades.length > 0 && (
          <div className="pointer-events-auto flex items-center gap-1.5 text-ink-300">
            <span className="text-gold-300">Backtest: {marks.label} ({marks.trades.length} trades)</span>
            <button className="hover:text-down" onClick={() => useChartMarks.getState().clear()}><X size={12} /></button>
          </div>
        )}
      </div>

      {loading && <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink-950/40"><Loader2 className="animate-spin text-gold-400" /></div>}
      {error && !loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-6 text-center">
          <div className="max-w-sm rounded-lg border border-ink-700 bg-ink-850 p-4 text-sm text-ink-200">
            <p className="mb-1 font-semibold text-down">Chart data unavailable</p>
            <p className="text-ink-300">{error}</p>
            <p className="mt-2 text-xs text-ink-400">No candles are shown rather than simulated ones. Configure a data feed in Settings.</p>
          </div>
        </div>
      )}

      {replay.mode === 'pick' && (
        <div className="absolute left-1/2 top-10 z-30 -translate-x-1/2 rounded-md bg-gold-500 px-3 py-1.5 text-xs font-medium text-ink-950 shadow-lg">
          Click a bar to start replay from · <button className="underline" onClick={() => setReplay((r) => ({ ...r, mode: 'off' }))}>cancel</button>
        </div>
      )}
      {replay.mode === 'on' && (
        <ReplayBar
          playing={replay.playing}
          speed={replay.speed}
          label={bars[bars.length - 1] ? fmtDate(bars[bars.length - 1].time, tz) + ' ' + fmtTime(bars[bars.length - 1].time, tz) : ''}
          canBack={replay.cursor > 10}
          canForward={replay.cursor < barsRef.current.length - 1}
          onTogglePlay={() => setReplay((r) => ({ ...r, playing: !r.playing }))}
          onStep={(n) => setReplay((r) => ({ ...r, playing: false, cursor: Math.max(10, Math.min(barsRef.current.length - 1, r.cursor + n)) }))}
          onSpeed={(speed) => setReplay((r) => ({ ...r, speed }))}
          onExit={() => setReplay((r) => ({ ...r, mode: 'off', playing: false }))}
        />
      )}
    </div>
  );
}

const STEP_PRESETS = [1, 5, 10, 20, 50];

/** Replay controls: jump back / forward by a chosen number of candles, play, speed, exit. */
function ReplayBar(p: { playing: boolean; speed: number; label: string; canBack: boolean; canForward: boolean; onTogglePlay: () => void; onStep: (n: number) => void; onSpeed: (s: number) => void; onExit: () => void }) {
  const [step, setStep] = useState<number>(() => { try { return Number(localStorage.getItem('xau-replay-step')) || 5; } catch { return 5; } });
  const [custom, setCustom] = useState(false);
  const choose = (n: number) => { const v = Math.max(1, Math.min(1000, Math.round(n) || 1)); setStep(v); try { localStorage.setItem('xau-replay-step', String(v)); } catch { /* private mode */ } };
  const btn = 'flex h-10 min-w-[64px] items-center justify-center gap-1 rounded-xl bg-white/[0.06] px-3 text-sm font-semibold text-ink-100 transition-all active:scale-95 disabled:opacity-30';
  return (
    <div className="animate-in absolute inset-x-2 bottom-3 z-30 mx-auto max-w-md rounded-2xl border border-white/10 bg-ink-850/95 p-2.5 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <button className={btn} disabled={!p.canBack} onClick={() => p.onStep(-step)} title={`Back ${step} candles`}><ChevronsLeft size={18} />{step}</button>
        <button className="flex h-10 w-12 shrink-0 items-center justify-center rounded-xl bg-gold-500 text-ink-950 transition-all active:scale-95" onClick={p.onTogglePlay} title={p.playing ? 'Pause' : 'Play'}>{p.playing ? <Pause size={18} /> : <Play size={18} />}</button>
        <button className={btn} disabled={!p.canForward} onClick={() => p.onStep(step)} title={`Forward ${step} candles`}>{step}<ChevronsRight size={18} /></button>
        <div className="ml-auto flex items-center gap-1">
          <select className="h-10 rounded-xl bg-white/[0.06] px-2 text-xs text-ink-200 outline-none" value={p.speed} onChange={(e) => p.onSpeed(Number(e.target.value))} title="Play speed">
            {[0.5, 1, 2, 4, 10].map((s) => <option key={s} value={s} className="bg-ink-850">{s}x</option>)}
          </select>
          <button className="flex h-10 w-10 items-center justify-center rounded-xl text-down transition-all hover:bg-down/10 active:scale-95" title="Exit replay" onClick={p.onExit}><X size={18} /></button>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <span className="shrink-0 text-[11px] text-ink-400">Step</span>
        {STEP_PRESETS.map((n) => (
          <button key={n} onClick={() => { setCustom(false); choose(n); }} className={`h-7 min-w-[34px] rounded-lg px-2 text-xs font-medium transition-colors ${step === n && !custom ? 'bg-gold-500/20 text-gold-300' : 'bg-white/[0.04] text-ink-300'}`}>{n}</button>
        ))}
        {custom || !STEP_PRESETS.includes(step)
          ? <input autoFocus={custom} type="number" inputMode="numeric" min={1} max={1000} className="h-7 w-16 rounded-lg bg-white/[0.06] px-2 text-center text-xs text-gold-300 outline-none ring-1 ring-gold-500/40" value={step} onChange={(e) => choose(Number(e.target.value))} />
          : <button onClick={() => setCustom(true)} className="h-7 rounded-lg bg-white/[0.04] px-2 text-xs text-ink-300">Custom</button>}
        <span className="ml-auto truncate font-mono text-[11px] text-ink-400">{p.label}</span>
      </div>
    </div>
  );
}

function dedupe(data: { time: number }[]) {
  const out: any[] = [];
  for (const d of data) {
    if (out.length && out[out.length - 1].time === d.time) out[out.length - 1] = d;
    else out.push(d);
  }
  return out;
}
