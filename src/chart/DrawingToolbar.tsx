import { useState } from 'react';
import {
  AlarmClock, ArrowDownRight, ArrowUpRight, Baseline, Brush, Circle, Copy, Eye, EyeOff, GitCommitHorizontal, Lock, LockOpen, Magnet,
  MousePointer2, MoveHorizontal, MoveVertical, PencilRuler, Redo2, Ruler, Square, Trash2, Triangle, Type, Undo2, TrendingUp, Spline,
  Rows3, Pin, CalendarRange, Target, ShieldAlert, Flag, Radius, Waypoints, ChevronsRight, Minus, SeparatorVertical,
} from 'lucide-react';
import { TOOLS, useDrawings, type Drawing, type ToolId, type ToolSpec } from './drawings/model';
import { useSettings } from '../store/settings';

const ICONS: Record<ToolId, any> = {
  cursor: MousePointer2, trend: TrendingUp, hline: Minus, vline: SeparatorVertical, ray: ChevronsRight, extended: MoveHorizontal,
  channel: Rows3, regression: Spline, fib: Baseline, fibext: Waypoints, fibchannel: GitCommitHorizontal, fibfan: Radius,
  rect: Square, circle: Circle, triangle: Triangle, brush: Brush, text: Type, pricerange: MoveVertical, daterange: CalendarRange,
  long: ArrowUpRight, short: ArrowDownRight, entry: Target, stoploss: ShieldAlert, takeprofit: Flag, alert: AlarmClock,
};

const GROUPS: ToolSpec['group'][] = ['Cursor', 'Lines', 'Fibonacci', 'Shapes', 'Trading'];

export function DrawingToolbar({ vertical = true }: { vertical?: boolean }) {
  const { tool, setTool, undo, redo, past, future, items, commit, stayInTool } = useDrawings();
  const { magnet, drawingsVisible, set } = useSettings();
  const [open, setOpen] = useState<string | null>(null);
  const [lastByGroup, setLast] = useState<Record<string, ToolId>>({ Lines: 'trend', Fibonacci: 'fib', Shapes: 'rect', Trading: 'long' });
  const allLocked = items.length > 0 && items.every((d) => d.locked);

  const pick = (t: ToolSpec) => { setTool(t.id); setLast((l) => ({ ...l, [t.group]: t.id })); setOpen(null); };

  return (
    <div className={`relative z-30 flex shrink-0 gap-0.5 border-ink-700 bg-ink-900 p-1 ${vertical ? 'w-10 flex-col border-r' : 'h-10 flex-row overflow-x-auto border-t'}`}>
      {GROUPS.map((g) => {
        const tools = TOOLS.filter((t) => t.group === g);
        const current = g === 'Cursor' ? 'cursor' : lastByGroup[g];
        const Icon = ICONS[current];
        const isActive = tools.some((t) => t.id === tool);
        return (
          <div key={g} className="relative">
            <button
              className={`btn-icon ${isActive ? 'on' : ''}`}
              title={g === 'Cursor' ? 'Cursor' : `${g} — ${TOOLS.find((t) => t.id === current)?.label}`}
              onClick={() => (g === 'Cursor' ? setTool('cursor') : tool === current ? setOpen(open === g ? null : g) : setTool(current))}
              onContextMenu={(e) => { e.preventDefault(); setOpen(g); }}
            >
              <Icon size={16} />
            </button>
            {g !== 'Cursor' && (
              <button className="absolute -right-0.5 bottom-0 h-2.5 w-2.5 text-[8px] leading-none text-ink-400 hover:text-gold-300" onClick={() => setOpen(open === g ? null : g)} aria-label={`More ${g} tools`}>▸</button>
            )}
            {open === g && (
              <div className={`animate-in absolute z-40 min-w-[200px] rounded-lg border border-ink-600 bg-ink-850 p-1 shadow-xl ${vertical ? 'left-10 top-0' : 'bottom-10 left-0'}`}>
                <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-ink-400">{g}</div>
                {tools.map((t) => {
                  const I = ICONS[t.id];
                  return (
                    <button key={t.id} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-ink-700 ${tool === t.id ? 'text-gold-300' : 'text-ink-200'}`} onClick={() => pick(t)}>
                      <I size={14} /> {t.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <div className={vertical ? 'my-1 h-px bg-ink-700' : 'mx-1 w-px bg-ink-700'} />
      <button className={`btn-icon ${magnet ? 'on' : ''}`} title="Magnet: snap to OHLC" onClick={() => set({ magnet: !magnet })}><Magnet size={16} /></button>
      <button className={`btn-icon ${stayInTool ? 'on' : ''}`} title="Stay in drawing mode" onClick={() => useDrawings.setState({ stayInTool: !stayInTool })}><Pin size={16} /></button>
      <button className="btn-icon" title="Undo (Ctrl+Z)" disabled={!past.length} onClick={undo}><Undo2 size={16} className={past.length ? '' : 'opacity-30'} /></button>
      <button className="btn-icon" title="Redo (Ctrl+Y)" disabled={!future.length} onClick={redo}><Redo2 size={16} className={future.length ? '' : 'opacity-30'} /></button>
      <button className={`btn-icon ${!drawingsVisible ? 'on' : ''}`} title={drawingsVisible ? 'Hide all drawings' : 'Show all drawings'} onClick={() => set({ drawingsVisible: !drawingsVisible })}>{drawingsVisible ? <Eye size={16} /> : <EyeOff size={16} />}</button>
      <button className={`btn-icon ${allLocked ? 'on' : ''}`} title={allLocked ? 'Unlock all drawings' : 'Lock all drawings'} onClick={() => commit(items.map((d) => ({ ...d, locked: !allLocked })))}>{allLocked ? <Lock size={16} /> : <LockOpen size={16} />}</button>
      <button className="btn-icon hover:text-down" title="Delete all drawings" onClick={() => items.length && confirm(`Delete all ${items.length} drawings? You can undo this.`) && commit([])}><Trash2 size={16} /></button>
    </div>
  );
}

const SWATCHES = ['#e8c25a', '#f3d98b', '#ececf1', '#6b8afd', '#2f9bff', '#22b07d', '#e5484d', '#ff9f43', '#c678dd'];

export function DrawingProps() {
  const { items, selected, update, remove, add, select } = useDrawings();
  const d = items.find((x) => x.id === selected);
  if (!d) return null;
  const p = (patch: Partial<Drawing>) => update(d.id, patch);
  return (
    <div className="animate-in absolute left-1/2 top-9 z-30 flex max-w-[95%] -translate-x-1/2 flex-wrap items-center gap-1 rounded-lg border border-ink-600 bg-ink-850/95 px-2 py-1 shadow-xl backdrop-blur">
      {SWATCHES.map((c) => (
        <button key={c} className={`h-4 w-4 rounded-full border ${d.color === c ? 'border-white' : 'border-transparent'}`} style={{ background: c }} onClick={() => p({ color: c })} aria-label={`Color ${c}`} />
      ))}
      <input type="color" className="h-5 w-6 bg-transparent" value={d.color} onChange={(e) => p({ color: e.target.value })} />
      <select className="rounded bg-ink-800 px-1 text-xs" value={d.width} onChange={(e) => p({ width: Number(e.target.value) })} title="Line width">{[1, 2, 3, 4].map((w) => <option key={w} value={w}>{w}px</option>)}</select>
      <select className="rounded bg-ink-800 px-1 text-xs" value={d.style} onChange={(e) => p({ style: e.target.value as Drawing['style'] })} title="Line style">
        <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
      </select>
      {['rect', 'circle', 'triangle', 'channel', 'pricerange', 'daterange', 'regression'].includes(d.type) && (
        <input type="range" min={0} max={0.6} step={0.02} value={d.fill} onChange={(e) => p({ fill: Number(e.target.value) })} title="Fill opacity" className="w-16 accent-gold-500" />
      )}
      {d.type === 'text' && <input className="w-32 rounded bg-ink-800 px-1 text-xs" value={d.text ?? ''} onChange={(e) => p({ text: e.target.value })} />}
      {(d.type === 'long' || d.type === 'short') && (
        <label className="flex items-center gap-1 text-xs text-ink-300">lots<input type="number" step={0.01} min={0.01} className="w-16 rounded bg-ink-800 px-1" value={d.lots ?? 0.1} onChange={(e) => p({ lots: Number(e.target.value) })} /></label>
      )}
      <button className="btn-icon" title={d.locked ? 'Unlock' : 'Lock'} onClick={() => p({ locked: !d.locked })}>{d.locked ? <Lock size={14} /> : <LockOpen size={14} />}</button>
      <button className="btn-icon" title="Hide" onClick={() => { p({ hidden: true }); select(null); }}><EyeOff size={14} /></button>
      <button className="btn-icon" title="Clone" onClick={() => { const { id, ...rest } = d; void id; const c = add({ ...rest, points: rest.points.map((q) => ({ ...q, price: q.price * 1.0005 })) }); select(c.id); }}><Copy size={14} /></button>
      <button className="btn-icon hover:text-down" title="Delete (Del)" onClick={() => remove(d.id)}><Trash2 size={14} /></button>
    </div>
  );
}

export function HiddenDrawingsNotice() {
  const { items, commit } = useDrawings();
  const hidden = items.filter((d) => d.hidden).length;
  if (!hidden) return null;
  return (
    <button className="absolute bottom-2 left-2 z-20 flex items-center gap-1 rounded bg-ink-800/90 px-2 py-0.5 text-[11px] text-ink-300 hover:text-gold-300" onClick={() => commit(items.map((d) => ({ ...d, hidden: false })))}>
      <PencilRuler size={12} /> {hidden} hidden drawing{hidden > 1 ? 's' : ''} · show <Ruler size={12} className="hidden" />
    </button>
  );
}
