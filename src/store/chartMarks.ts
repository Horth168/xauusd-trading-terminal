import { create } from 'zustand';

export interface MarkTrade {
  id: number;
  side: 'long' | 'short';
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  sl: number;
  tp: number;
  pnl: number;
}

/** Backtest trades projected onto the chart, plus an optional trade to focus/inspect. */
interface ChartMarksState {
  label: string | null;
  tf: string | null;
  trades: MarkTrade[];
  focus: MarkTrade | null;
  set: (p: Partial<Omit<ChartMarksState, 'set' | 'clear'>>) => void;
  clear: () => void;
}

export const useChartMarks = create<ChartMarksState>((set) => ({
  label: null,
  tf: null,
  trades: [],
  focus: null,
  set: (p) => set(p),
  clear: () => set({ label: null, tf: null, trades: [], focus: null }),
}));
