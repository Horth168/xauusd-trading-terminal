import { create } from 'zustand';
import { getOne, newId, saveDoc } from '../../lib/db';

export type ToolId =
  | 'cursor' | 'trend' | 'hline' | 'vline' | 'ray' | 'extended' | 'channel' | 'regression'
  | 'fib' | 'fibext' | 'fibchannel' | 'fibfan'
  | 'rect' | 'circle' | 'triangle' | 'brush' | 'text' | 'pricerange' | 'daterange'
  | 'long' | 'short' | 'entry' | 'stoploss' | 'takeprofit' | 'alert';

export interface Point { time: number; price: number }

export interface Drawing {
  id: string;
  type: Exclude<ToolId, 'cursor' | 'alert'>;
  points: Point[];
  color: string;
  width: number;
  style: 'solid' | 'dashed' | 'dotted';
  fill: number; // 0..1 opacity for areas
  text?: string;
  locked?: boolean;
  hidden?: boolean;
  lots?: number; // position tools
}

export interface ToolSpec {
  id: ToolId;
  label: string;
  group: 'Cursor' | 'Lines' | 'Fibonacci' | 'Shapes' | 'Trading';
  points: number; // anchors to place; 0 = freehand
  color: string;
}

export const TOOLS: ToolSpec[] = [
  { id: 'cursor', label: 'Cursor', group: 'Cursor', points: 0, color: '' },
  { id: 'trend', label: 'Trend Line', group: 'Lines', points: 2, color: '#e8c25a' },
  { id: 'hline', label: 'Horizontal Line', group: 'Lines', points: 1, color: '#6b8afd' },
  { id: 'vline', label: 'Vertical Line', group: 'Lines', points: 1, color: '#6b8afd' },
  { id: 'ray', label: 'Ray', group: 'Lines', points: 2, color: '#e8c25a' },
  { id: 'extended', label: 'Extended Line', group: 'Lines', points: 2, color: '#e8c25a' },
  { id: 'channel', label: 'Parallel Channel', group: 'Lines', points: 3, color: '#2f9bff' },
  { id: 'regression', label: 'Regression Trend', group: 'Lines', points: 2, color: '#c678dd' },
  { id: 'fib', label: 'Fib Retracement', group: 'Fibonacci', points: 2, color: '#e8c25a' },
  { id: 'fibext', label: 'Trend-Based Fib Extension', group: 'Fibonacci', points: 3, color: '#e8c25a' },
  { id: 'fibchannel', label: 'Fib Channel', group: 'Fibonacci', points: 3, color: '#e8c25a' },
  { id: 'fibfan', label: 'Fib Speed Fan', group: 'Fibonacci', points: 2, color: '#e8c25a' },
  { id: 'rect', label: 'Rectangle', group: 'Shapes', points: 2, color: '#6b8afd' },
  { id: 'circle', label: 'Circle', group: 'Shapes', points: 2, color: '#6b8afd' },
  { id: 'triangle', label: 'Triangle', group: 'Shapes', points: 3, color: '#6b8afd' },
  { id: 'brush', label: 'Brush', group: 'Shapes', points: 0, color: '#f3d98b' },
  { id: 'text', label: 'Text', group: 'Shapes', points: 1, color: '#ececf1' },
  { id: 'pricerange', label: 'Price Range', group: 'Shapes', points: 2, color: '#2f9bff' },
  { id: 'daterange', label: 'Date Range', group: 'Shapes', points: 2, color: '#2f9bff' },
  { id: 'long', label: 'Long Position', group: 'Trading', points: 2, color: '#22b07d' },
  { id: 'short', label: 'Short Position', group: 'Trading', points: 2, color: '#e5484d' },
  { id: 'entry', label: 'Entry Price', group: 'Trading', points: 1, color: '#e8c25a' },
  { id: 'stoploss', label: 'Stop Loss', group: 'Trading', points: 1, color: '#e5484d' },
  { id: 'takeprofit', label: 'Take Profit', group: 'Trading', points: 1, color: '#22b07d' },
  { id: 'alert', label: 'Price Alert', group: 'Trading', points: 1, color: '#ff9f43' },
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.id, t]));

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
export const FIB_EXT_LEVELS = [0, 0.618, 1, 1.272, 1.618, 2, 2.618];

const DOC_ID = 'XAUUSD';

interface DrawingState {
  items: Drawing[];
  tool: ToolId;
  selected: string | null;
  past: Drawing[][];
  future: Drawing[][];
  loaded: boolean;
  stayInTool: boolean;
  setTool: (t: ToolId) => void;
  select: (id: string | null) => void;
  commit: (items: Drawing[]) => void; // with undo history
  setLive: (items: Drawing[]) => void; // during drags (no history)
  add: (d: Omit<Drawing, 'id'>) => Drawing;
  update: (id: string, patch: Partial<Drawing>) => void;
  remove: (id: string) => void;
  undo: () => void;
  redo: () => void;
  load: () => Promise<void>;
}

let saveTimer: number | undefined;
function persist(items: Drawing[]) {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveDoc('drawings', { id: DOC_ID, items } as any).catch((e) => console.error('Saving drawings failed', e));
  }, 600);
}

export const useDrawings = create<DrawingState>((set, get) => ({
  items: [],
  tool: 'cursor',
  selected: null,
  past: [],
  future: [],
  loaded: false,
  stayInTool: false,
  setTool: (tool) => set({ tool, selected: null }),
  select: (selected) => set({ selected }),
  commit: (items) => {
    set((s) => ({ items, past: [...s.past.slice(-99), s.items], future: [] }));
    persist(items);
  },
  setLive: (items) => set({ items }),
  add: (d) => {
    const item = { ...d, id: newId() } as Drawing;
    get().commit([...get().items, item]);
    return item;
  },
  update: (id, patch) => get().commit(get().items.map((d) => (d.id === id ? { ...d, ...patch } : d))),
  remove: (id) => {
    get().commit(get().items.filter((d) => d.id !== id));
    if (get().selected === id) set({ selected: null });
  },
  undo: () => {
    const { past, items, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({ items: prev, past: past.slice(0, -1), future: [items, ...future] });
    persist(prev);
  },
  redo: () => {
    const { past, items, future } = get();
    if (!future.length) return;
    const next = future[0];
    set({ items: next, past: [...past, items], future: future.slice(1) });
    persist(next);
  },
  load: async () => {
    const d = await getOne<any>('drawings', DOC_ID).catch(() => null);
    set({ items: d?.items ?? [], loaded: true, past: [], future: [] });
  },
}));
