import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ChartType = 'candles' | 'heikin' | 'bars' | 'line' | 'area';
export type LayoutMode = '1' | '2h' | '2v' | '4';

export interface IndicatorInstance {
  uid: string;
  type: string; // builtin id or 'custom:<id>'
  params: Record<string, number | string | boolean>;
  colors: Record<string, string>;
  lineWidth: number;
  visible: boolean;
}

export interface ChartConfig {
  tf: string;
  chartType: ChartType;
  indicators: IndicatorInstance[];
}

export interface SavedLayout {
  id: string;
  name: string;
  layout: LayoutMode;
  charts: ChartConfig[];
}

export interface IndicatorTemplate {
  id: string;
  name: string;
  indicators: IndicatorInstance[];
}

export interface Settings {
  timezone: string;
  feedMode: 'auto' | 'mt5' | 'twelvedata';
  bridgeUrl: string;
  bridgeToken: string;
  pollSeconds: number;
  layout: LayoutMode;
  charts: ChartConfig[];
  activeChart: number;
  savedLayouts: SavedLayout[];
  indicatorTemplates: IndicatorTemplate[];
  drawingsVisible: boolean;
  magnet: boolean;
  khrPerUsd: number;
  showSessions: boolean;
  sidebarCollapsed: boolean;
  contractSize: number;
  customTimeframes: number[]; // minutes
}

const defaultChart = (tf: string): ChartConfig => ({ tf, chartType: 'candles', indicators: [] });

export const DEFAULT_SETTINGS: Settings = {
  timezone: 'Asia/Phnom_Penh',
  feedMode: 'auto',
  bridgeUrl: 'http://127.0.0.1:8765',
  bridgeToken: '',
  pollSeconds: 120,
  layout: '1',
  charts: [defaultChart('M15'), defaultChart('H1'), defaultChart('H4'), defaultChart('D1')],
  activeChart: 0,
  savedLayouts: [],
  indicatorTemplates: [],
  drawingsVisible: true,
  magnet: false,
  khrPerUsd: 4100,
  showSessions: true,
  sidebarCollapsed: false,
  contractSize: 100,
  customTimeframes: [],
};

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void;
  updateChart: (index: number, patch: Partial<ChartConfig>) => void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (patch) => set(patch),
      updateChart: (index, patch) =>
        set((s) => ({ charts: s.charts.map((c, i) => (i === index ? { ...c, ...patch } : c)) })),
    }),
    { name: 'xau-settings', version: 1 },
  ),
);

export const getSettings = () => useSettings.getState();

/** Settings worth syncing to the cloud (excludes the bridge token, which stays on each device). */
export function syncableSettings(s: Settings): Partial<Settings> {
  const { bridgeToken, ...rest } = s;
  void bridgeToken;
  return rest;
}
