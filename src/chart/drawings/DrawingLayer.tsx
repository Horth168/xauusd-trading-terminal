import { useCallback, useEffect, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi, Logical, SeriesType } from 'lightweight-charts';
import type { Bar } from '../../market/types';
import { FIB_EXT_LEVELS, FIB_LEVELS, TOOL_MAP, useDrawings, type Drawing, type Point } from './model';
import { useSettings } from '../../store/settings';
import { num } from '../../lib/format';

interface Props {
  chart: IChartApi;
  series: ISeriesApi<SeriesType>;
  getBars: () => Bar[];
  tfSeconds: number;
  digits: number;
  contractSize: number;
  active: boolean;
  onAlert: (price: number) => void;
}

/** Converts between chart pixel space and (time, price) so drawings survive timeframe changes. */
class Mapper {
  constructor(private chart: IChartApi, private series: ISeriesApi<SeriesType>, private bars: Bar[], private tf: number) {}
  logical(t: number): number {
    const b = this.bars;
    if (!b.length) return 0;
    if (t <= b[0].time) return (t - b[0].time) / this.tf;
    const last = b.length - 1;
    if (t >= b[last].time) return last + (t - b[last].time) / this.tf;
    let lo = 0, hi = last;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (b[mid].time <= t) lo = mid; else hi = mid; }
    return lo + (t - b[lo].time) / (b[hi].time - b[lo].time);
  }
  timeOf(l: number): number {
    const b = this.bars;
    if (!b.length) return 0;
    const last = b.length - 1;
    if (l <= 0) return b[0].time + l * this.tf;
    if (l >= last) return b[last].time + (l - last) * this.tf;
    const i = Math.floor(l);
    return b[i].time + (l - i) * (b[i + 1].time - b[i].time);
  }
  x(t: number) { return this.chart.timeScale().logicalToCoordinate(this.logical(t) as Logical) ?? -9999; }
  y(p: number) { return this.series.priceToCoordinate(p) ?? -9999; }
  toPoint(x: number, y: number, magnet: boolean): Point {
    const l = (this.chart.timeScale().coordinateToLogical(x) ?? 0) as number;
    let price = (this.series.coordinateToPrice(y) ?? 0) as number;
    let time = this.timeOf(l);
    if (magnet) {
      const i = Math.round(l);
      const bar = this.bars[i];
      if (bar) {
        time = bar.time;
        price = [bar.open, bar.high, bar.low, bar.close].reduce((a, c) => (Math.abs(c - price) < Math.abs(a - price) ? c : a));
      }
    }
    return { time, price };
  }
  barsBetween(t0: number, t1: number) {
    const [a, b] = t0 < t1 ? [t0, t1] : [t1, t0];
    return this.bars.filter((x) => x.time >= a && x.time <= b);
  }
}

const dash = (s: Drawing['style'], w: number) => (s === 'dashed' ? `${w * 4} ${w * 3}` : s === 'dotted' ? `${w} ${w * 2}` : undefined);

/** Extend segment (x0,y0)->(x1,y1) to the viewport edges. */
function extend(x0: number, y0: number, x1: number, y1: number, W: number, both: boolean) {
  const dx = x1 - x0, dy = y1 - y0;
  if (Math.abs(dx) < 1e-6) return both ? [x0, -1e4, x1, 1e4] : [x0, y0, x1, dy > 0 ? 1e4 : -1e4];
  const k = dy / dx;
  const xr = dx > 0 ? W : 0;
  const end = [xr, y0 + k * (xr - x0)];
  if (!both) return [x0, y0, end[0], end[1]];
  const xl = dx > 0 ? 0 : W;
  return [xl, y0 + k * (xl - x0), end[0], end[1]];
}

export function DrawingLayer({ chart, series, getBars, tfSeconds, digits, contractSize, active, onAlert }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [, force] = useState(0);
  const { items, tool, selected, setTool, select, commit, setLive, add, remove, undo, redo, stayInTool } = useDrawings();
  const { magnet, drawingsVisible } = useSettings();
  const [placing, setPlacing] = useState<Point[] | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const drag = useRef<{ id: string; anchor: number | 'all'; start: Point; before: Drawing[]; startL: number } | null>(null);
  const brush = useRef<Point[] | null>(null);
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const size = useRef({ w: 0, h: 0 });
  const dragHandlers = useRef<{ move: (e: PointerEvent) => void; end: () => void }>({ move: () => {}, end: () => {} });

  const mapper = new Mapper(chart, series, getBars(), tfSeconds);

  // Re-render whenever the visible mapping changes (scroll, zoom, autoscale, resize).
  useEffect(() => {
    let raf = 0, sig = '';
    const loop = () => {
      const el = svgRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        size.current = { w: r.width, h: r.height };
        const range = chart.timeScale().getVisibleLogicalRange();
        const s = `${range?.from},${range?.to},${series.priceToCoordinate(1000)},${series.priceToCoordinate(3000)},${r.width},${r.height},${getBars().length}`;
        if (s !== sig) { sig = s; force((x) => x + 1); }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [chart, series, getBars]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { remove(selected); e.preventDefault(); }
      else if (e.key === 'Escape') { setPlacing(null); setTool('cursor'); select(null); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.shiftKey ? redo() : undo(); e.preventDefault(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { redo(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, selected, remove, setTool, select, undo, redo]);

  useEffect(() => { setPlacing(null); }, [tool]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const finish = useCallback((pts: Point[]) => {
    const spec = TOOL_MAP.get(tool)!;
    if (tool === 'alert') { onAlert(pts[0].price); setTool('cursor'); return; }
    let points = pts;
    if (tool === 'long' || tool === 'short') {
      const [e, s] = pts;
      const end = s.time === e.time ? e.time + tfSeconds * 20 : s.time;
      const risk = e.price - s.price;
      points = [e, { time: end, price: s.price }, { time: end, price: e.price + 2 * risk }];
    }
    const d = add({ type: tool as Drawing['type'], points, color: spec.color, width: tool === 'brush' ? 2 : 1, style: 'solid', fill: 0.12, text: tool === 'text' ? 'Text' : undefined, lots: tool === 'long' || tool === 'short' ? 0.1 : undefined });
    select(d.id);
    setPlacing(null);
    if (!stayInTool) setTool('cursor');
  }, [tool, add, select, setTool, onAlert, tfSeconds, stayInTool]);

  // ---------- placement ----------
  const onPlaceDown = (e: React.PointerEvent) => {
    const { x, y } = local(e);
    const p = mapper.toPoint(x, y, magnet);
    (e.target as Element).setPointerCapture(e.pointerId);
    downAt.current = { x, y };
    if (tool === 'brush') { brush.current = [p]; return; }
    const need = TOOL_MAP.get(tool)!.points;
    const pts = [...(placing ?? []), p];
    if (pts.length >= need) finish(pts);
    else setPlacing(pts);
  };
  const onPlaceMove = (e: React.PointerEvent) => {
    const { x, y } = local(e);
    const p = mapper.toPoint(x, y, magnet);
    if (brush.current) { brush.current.push(p); force((n) => n + 1); return; }
    setHover(p);
  };
  const onPlaceUp = (e: React.PointerEvent) => {
    const { x, y } = local(e);
    if (brush.current) {
      const pts = brush.current; brush.current = null;
      if (pts.length > 1) finish(pts);
      return;
    }
    // Click-drag-release places the second anchor of 2-point tools.
    const d = downAt.current;
    if (d && placing?.length === 1 && TOOL_MAP.get(tool)!.points === 2 && Math.hypot(x - d.x, y - d.y) > 6) finish([...placing, mapper.toPoint(x, y, magnet)]);
  };

  // ---------- editing ----------
  const startDrag = (e: React.PointerEvent, d: Drawing, anchor: number | 'all') => {
    if (tool !== 'cursor') return;
    e.stopPropagation();
    select(d.id);
    if (d.locked) return;
    const { x, y } = local(e);
    drag.current = { id: d.id, anchor, start: mapper.toPoint(x, y, false), before: items, startL: (chart.timeScale().coordinateToLogical(x) ?? 0) as number };
    const move = (ev: PointerEvent) => dragHandlers.current.move(ev);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); dragHandlers.current.end(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const onDragMove = (e: { clientX: number; clientY: number }) => {
    const g = drag.current;
    if (!g) return;
    const { x, y } = local(e);
    const p = mapper.toPoint(x, y, magnet && g.anchor !== 'all');
    const dL = ((chart.timeScale().coordinateToLogical(x) ?? 0) as number) - g.startL;
    const dP = p.price - g.start.price;
    setLive(g.before.map((d) => {
      if (d.id !== g.id) return d;
      if (g.anchor === 'all') return { ...d, points: d.points.map((q) => ({ time: mapper.timeOf(mapper.logical(q.time) + dL), price: q.price + dP })) };
      const pts = d.points.slice();
      if ((d.type === 'long' || d.type === 'short')) {
        if (g.anchor === 0) return { ...d, points: d.points.map((q, i) => (i === 0 ? { time: p.time, price: p.price } : { time: q.time, price: q.price + (p.price - d.points[0].price) })) };
        if (g.anchor === 1) { pts[1] = { time: p.time, price: p.price }; pts[2] = { ...pts[2], time: p.time }; }
        if (g.anchor === 2) { pts[2] = { time: p.time, price: p.price }; pts[1] = { ...pts[1], time: p.time }; }
        return { ...d, points: pts };
      }
      pts[g.anchor] = p;
      return { ...d, points: pts };
    }));
  };
  const onDragEnd = () => {
    const g = drag.current;
    if (!g) return;
    drag.current = null;
    const after = useDrawings.getState().items;
    useDrawings.setState({ items: g.before });
    if (after !== g.before) commit(after);
  };

  dragHandlers.current = { move: onDragMove, end: onDragEnd };
  const { w: W, h: H } = size.current;
  const fmtP = (p: number) => num(p, digits);

  const render = (d: Drawing, preview = false) => {
    const pts = d.points;
    const X = (i: number) => mapper.x(pts[i].time);
    const Y = (i: number) => mapper.y(pts[i].price);
    const stroke = { stroke: d.color, strokeWidth: d.width, strokeDasharray: dash(d.style, d.width), fill: 'none' };
    const hit = preview ? {} : { onPointerDown: (e: React.PointerEvent) => startDrag(e, d, 'all'), style: { cursor: d.locked ? 'default' : 'move', pointerEvents: tool === 'cursor' ? ('auto' as const) : ('none' as const) } };
    const hitStroke = { stroke: 'transparent', strokeWidth: 12, fill: 'none' };
    const els: JSX.Element[] = [];
    const lineEl = (x0: number, y0: number, x1: number, y1: number, k: string, extra: any = {}) => (
      <g key={k}>
        <line x1={x0} y1={y0} x2={x1} y2={y1} {...stroke} {...extra} />
        <line x1={x0} y1={y0} x2={x1} y2={y1} {...hitStroke} {...hit} />
      </g>
    );
    const label = (x: number, y: number, text: string, k: string, anchor: 'start' | 'end' | 'middle' = 'start', color = d.color) => (
      <text key={k} x={x} y={y} fill={color} fontSize={11} textAnchor={anchor} className="font-mono" style={{ pointerEvents: 'none' }}>{text}</text>
    );

    switch (d.type) {
      case 'trend': els.push(lineEl(X(0), Y(0), X(1), Y(1), 'l')); break;
      case 'ray': { const [a, b, c, e] = extend(X(0), Y(0), X(1), Y(1), W, false); els.push(lineEl(a, b, c, e, 'l')); break; }
      case 'extended': { const [a, b, c, e] = extend(X(0), Y(0), X(1), Y(1), W, true); els.push(lineEl(a, b, c, e, 'l')); break; }
      case 'hline': case 'entry': case 'stoploss': case 'takeprofit': {
        const name = d.type === 'hline' ? '' : TOOL_MAP.get(d.type)!.label + ' ';
        els.push(lineEl(0, Y(0), W, Y(0), 'l'));
        els.push(label(W - 70, Y(0) - 4, `${name}${fmtP(pts[0].price)}`, 't', 'end'));
        break;
      }
      case 'vline': els.push(lineEl(X(0), 0, X(0), H, 'l')); break;
      case 'channel': {
        const off = pts.length > 2 ? Y(2) - (Y(0) + ((Y(1) - Y(0)) * (X(2) - X(0))) / (X(1) - X(0) || 1)) : 0;
        els.push(<polygon key="f" points={`${X(0)},${Y(0)} ${X(1)},${Y(1)} ${X(1)},${Y(1) + off} ${X(0)},${Y(0) + off}`} fill={d.color} fillOpacity={d.fill} stroke="none" {...hit} />);
        els.push(lineEl(X(0), Y(0), X(1), Y(1), 'a'), lineEl(X(0), Y(0) + off, X(1), Y(1) + off, 'b'));
        els.push(<line key="m" x1={X(0)} y1={Y(0) + off / 2} x2={X(1)} y2={Y(1) + off / 2} stroke={d.color} strokeDasharray="4 4" strokeOpacity={0.6} />);
        break;
      }
      case 'regression': {
        const bs = mapper.barsBetween(pts[0].time, pts[1].time);
        if (bs.length > 2) {
          const n = bs.length, xs = bs.map((_, i) => i), ys = bs.map((b) => b.close);
          const mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n;
          let sxy = 0, sxx = 0;
          xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
          const k = sxy / sxx, c = my - k * mx;
          const sd = Math.sqrt(ys.reduce((a, y, i) => a + (y - (c + k * i)) ** 2, 0) / n);
          const x0 = mapper.x(bs[0].time), x1 = mapper.x(bs[n - 1].time);
          for (const [m, key] of [[0, 'c'], [2, 'u'], [-2, 'd']] as const) {
            els.push(lineEl(x0, mapper.y(c + m * sd), x1, mapper.y(c + k * (n - 1) + m * sd), key, m ? { strokeDasharray: '5 4' } : {}));
          }
          els.push(<polygon key="f" points={`${x0},${mapper.y(c + 2 * sd)} ${x1},${mapper.y(c + k * (n - 1) + 2 * sd)} ${x1},${mapper.y(c + k * (n - 1) - 2 * sd)} ${x0},${mapper.y(c - 2 * sd)}`} fill={d.color} fillOpacity={d.fill * 0.6} {...hit} />);
        } else els.push(lineEl(X(0), Y(0), X(1), Y(1), 'l', { strokeDasharray: '4 4' }));
        break;
      }
      case 'fib': {
        const [p0, p1] = pts;
        const x0 = Math.min(X(0), X(1)), x1 = Math.max(X(0), X(1));
        FIB_LEVELS.forEach((L) => {
          const price = p1.price - (p1.price - p0.price) * L;
          els.push(lineEl(x0, mapper.y(price), x1 + 60, mapper.y(price), `f${L}`));
          els.push(label(x0 + 2, mapper.y(price) - 3, `${L} (${fmtP(price)})`, `t${L}`));
        });
        els.push(<line key="diag" x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} stroke={d.color} strokeDasharray="3 4" strokeOpacity={0.5} />);
        break;
      }
      case 'fibext': {
        if (pts.length < 3) { els.push(lineEl(X(0), Y(0), X(1), Y(1), 'l')); break; }
        const move = pts[1].price - pts[0].price;
        const x0 = X(2), x1 = Math.max(X(2), X(1)) + 120;
        els.push(<polyline key="z" points={`${X(0)},${Y(0)} ${X(1)},${Y(1)} ${X(2)},${Y(2)}`} stroke={d.color} strokeDasharray="3 4" fill="none" strokeOpacity={0.6} />);
        FIB_EXT_LEVELS.forEach((L) => {
          const price = pts[2].price + move * L;
          els.push(lineEl(x0, mapper.y(price), x1, mapper.y(price), `f${L}`));
          els.push(label(x0 + 2, mapper.y(price) - 3, `${L} (${fmtP(price)})`, `t${L}`));
        });
        break;
      }
      case 'fibchannel': {
        if (pts.length < 3) { els.push(lineEl(X(0), Y(0), X(1), Y(1), 'l')); break; }
        const off = Y(2) - (Y(0) + ((Y(1) - Y(0)) * (X(2) - X(0))) / (X(1) - X(0) || 1));
        FIB_EXT_LEVELS.slice(0, 5).concat([0.5, 0.382]).forEach((L) => {
          const [a, b, c, e] = extend(X(0), Y(0) + off * L, X(1), Y(1) + off * L, W, false);
          els.push(lineEl(a, b, c, e, `f${L}`, L === 0 || L === 1 ? {} : { strokeOpacity: 0.7 }));
          els.push(label(X(0) - 4, Y(0) + off * L - 3, String(L), `t${L}`, 'end'));
        });
        break;
      }
      case 'fibfan': {
        const [p0, p1] = pts;
        [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].forEach((L) => {
          const target = p1.price - (p1.price - p0.price) * L;
          const [a, b, c, e] = extend(X(0), Y(0), X(1), mapper.y(target), W, false);
          els.push(lineEl(a, b, c, e, `f${L}`, L === 0 || L === 1 ? {} : { strokeOpacity: 0.75 }));
          els.push(label(X(1) + 4, mapper.y(target) - 2, String(L), `t${L}`));
        });
        break;
      }
      case 'rect': case 'pricerange': case 'daterange': {
        const x = Math.min(X(0), X(1)), y = Math.min(Y(0), Y(1)), w = Math.abs(X(1) - X(0)), h = Math.abs(Y(1) - Y(0));
        els.push(<rect key="r" x={x} y={y} width={w} height={h} {...stroke} fill={d.color} fillOpacity={d.fill} {...hit} />);
        if (d.type === 'pricerange') {
          const dp = pts[1].price - pts[0].price;
          els.push(label(x + w / 2, y - 6, `${dp >= 0 ? '+' : ''}${fmtP(dp)} (${((dp / pts[0].price) * 100).toFixed(2)}%) · ${Math.round(Math.abs(dp) * 10 ** digits)} pts`, 't', 'middle'));
        }
        if (d.type === 'daterange') {
          const nBars = mapper.barsBetween(pts[0].time, pts[1].time).length;
          const secs = Math.abs(pts[1].time - pts[0].time);
          const dd = Math.floor(secs / 86400), hh = Math.floor((secs % 86400) / 3600), mm = Math.floor((secs % 3600) / 60);
          els.push(label(x + w / 2, y + h + 14, `${nBars} bars · ${dd ? `${dd}d ` : ''}${hh}h ${mm}m`, 't', 'middle'));
        }
        break;
      }
      case 'circle': {
        const r = Math.hypot(X(1) - X(0), Y(1) - Y(0));
        els.push(<circle key="c" cx={X(0)} cy={Y(0)} r={r} {...stroke} fill={d.color} fillOpacity={d.fill} {...hit} />);
        break;
      }
      case 'triangle': {
        const ptsStr = pts.map((_, i) => `${X(i)},${Y(i)}`).join(' ');
        els.push(<polygon key="t" points={ptsStr} {...stroke} fill={d.color} fillOpacity={d.fill} {...hit} />);
        break;
      }
      case 'brush': {
        const path = pts.map((_, i) => `${i ? 'L' : 'M'}${X(i)},${Y(i)}`).join(' ');
        els.push(<path key="p" d={path} {...stroke} strokeLinecap="round" strokeLinejoin="round" />, <path key="h" d={path} {...hitStroke} {...hit} />);
        break;
      }
      case 'text': {
        els.push(<text key="t" x={X(0)} y={Y(0)} fill={d.color} fontSize={12 + d.width * 2} {...hit}>{d.text}</text>);
        break;
      }
      case 'long': case 'short': {
        if (pts.length < 3) break;
        const [e, s, t] = pts;
        const x0 = X(0), x1 = Math.max(mapper.x(s.time), x0 + 20);
        const risk = Math.abs(e.price - s.price), reward = Math.abs(t.price - e.price);
        const lots = d.lots ?? 0.1;
        const rr = risk ? reward / risk : 0;
        els.push(<rect key="tp" x={x0} y={Math.min(Y(0), Y(2))} width={x1 - x0} height={Math.abs(Y(2) - Y(0))} fill="#22b07d" fillOpacity={0.18} stroke="#22b07d" strokeOpacity={0.5} {...hit} />);
        els.push(<rect key="sl" x={x0} y={Math.min(Y(0), Y(1))} width={x1 - x0} height={Math.abs(Y(1) - Y(0))} fill="#e5484d" fillOpacity={0.18} stroke="#e5484d" strokeOpacity={0.5} {...hit} />);
        els.push(<line key="e" x1={x0} y1={Y(0)} x2={x1} y2={Y(0)} stroke="#ececf1" strokeWidth={1} />);
        const lx = (x0 + x1) / 2;
        els.push(label(lx, Y(2) + (Y(2) < Y(0) ? -6 : 14), `TP ${fmtP(t.price)} · +$${num(reward * lots * contractSize)} · ${num(reward, digits)}`, 'tpl', 'middle', '#22b07d'));
        els.push(label(lx, Y(1) + (Y(1) > Y(0) ? 14 : -6), `SL ${fmtP(s.price)} · -$${num(risk * lots * contractSize)} · ${num(risk, digits)}`, 'sll', 'middle', '#e5484d'));
        els.push(label(lx, Y(0) - 4, `${d.type === 'long' ? 'LONG' : 'SHORT'} ${fmtP(e.price)} · ${lots} lot · R:R ${rr.toFixed(2)}`, 'el', 'middle', '#ececf1'));
        break;
      }
    }

    const isSel = selected === d.id && !preview;
    if (isSel && !d.locked && d.type !== 'brush') {
      const handles = d.type === 'hline' || d.type === 'entry' || d.type === 'stoploss' || d.type === 'takeprofit'
        ? [{ i: 0, x: W / 2, y: Y(0) }]
        : d.type === 'vline' ? [{ i: 0, x: X(0), y: H / 2 }]
        : pts.map((_, i) => ({ i, x: d.type === 'long' || d.type === 'short' ? (i === 0 ? X(0) : mapper.x(pts[i].time)) : X(i), y: Y(i) }));
      handles.forEach((h) => els.push(
        <circle key={`h${h.i}`} cx={h.x} cy={h.y} r={5} fill="#0b0b0d" stroke={d.color || '#e8c25a'} strokeWidth={2} style={{ cursor: 'grab', pointerEvents: 'auto' }} onPointerDown={(e) => startDrag(e, d, h.i)} />,
      ));
    }
    return <g key={d.id} opacity={preview ? 0.7 : 1}>{els}</g>;
  };

  const spec = TOOL_MAP.get(tool);
  let preview: Drawing | null = null;
  if (placing && hover && spec) {
    let pts = [...placing, hover];
    if (tool === 'long' || tool === 'short') {
      const [e, s] = pts;
      pts = [e, s, { time: s.time, price: e.price + 2 * (e.price - s.price) }];
    }
    preview = { id: 'preview', type: tool as Drawing['type'], points: pts, color: spec.color, width: 1, style: 'solid', fill: 0.1, lots: 0.1 };
  }
  if (brush.current && brush.current.length > 1) preview = { id: 'preview', type: 'brush', points: brush.current, color: spec?.color ?? '#fff', width: 2, style: 'solid', fill: 0 };

  const placingMode = tool !== 'cursor';
  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 z-10 h-full w-full overflow-hidden"
      style={{ pointerEvents: placingMode ? 'auto' : 'none', cursor: placingMode ? 'crosshair' : undefined, touchAction: placingMode ? 'none' : undefined }}
      onPointerMove={(e) => (placingMode && !drag.current ? onPlaceMove(e) : undefined)}
      onPointerUp={(e) => (placingMode && !drag.current ? onPlaceUp(e) : undefined)}
      onPointerDown={(e) => { if (placingMode) onPlaceDown(e); }}
    >
      {placingMode && <rect x={0} y={0} width="100%" height="100%" fill="transparent" />}
      {drawingsVisible && items.filter((d) => !d.hidden).map((d) => render(d))}
      {preview && render(preview, true)}
    </svg>
  );
}
