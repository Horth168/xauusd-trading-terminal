import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3, CandlestickChart, Camera, ChevronDown, Columns2, FlaskConical, LayoutGrid, LineChart, Maximize, Minimize, PencilRuler, Rewind, Rows2, Save, Square, AreaChart, Trash2, Plus,
} from 'lucide-react';
import { ChartPane, type PaneApi } from '../chart/ChartPane';
import { DrawingProps, DrawingToolbar, HiddenDrawingsNotice } from '../chart/DrawingToolbar';
import { AddIndicatorDialog, EditIndicatorDialog } from '../chart/IndicatorDialogs';
import { PositionDialog } from '../chart/PositionDialog';
import { FeedBadge, PriceTicker, StatusBar } from '../components/FeedStatus';
import { Modal } from '../components/ui';
import { TIMEFRAMES, customTimeframe } from '../market/timeframes';
import { useSettings, type ChartType, type LayoutMode } from '../store/settings';
import { useDrawings } from '../chart/drawings/model';
import { newId } from '../lib/db';
import { useFeed } from '../market/feed';

const FAVORITE_TFS = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
const CHART_TYPES: { id: ChartType; label: string; icon: any }[] = [
  { id: 'candles', label: 'Candles', icon: CandlestickChart },
  { id: 'heikin', label: 'Heikin Ashi', icon: CandlestickChart },
  { id: 'bars', label: 'Bars', icon: BarChart3 },
  { id: 'line', label: 'Line', icon: LineChart },
  { id: 'area', label: 'Area', icon: AreaChart },
];
const LAYOUTS: { id: LayoutMode; icon: any; n: number; label: string }[] = [
  { id: '1', icon: Square, n: 1, label: 'Single chart' },
  { id: '2h', icon: Columns2, n: 2, label: 'Two side by side' },
  { id: '2v', icon: Rows2, n: 2, label: 'Two stacked' },
  { id: '4', icon: LayoutGrid, n: 4, label: 'Four charts' },
];

export default function ChartPage() {
  const s = useSettings();
  const { layout, charts, activeChart, set, updateChart, customTimeframes } = s;
  const source = useFeed((x) => x.source);
  const cfg = charts[activeChart] ?? charts[0];
  const [indOpen, setIndOpen] = useState(false);
  const [editInd, setEditInd] = useState<{ chart: number; uid: string } | null>(null);
  const [tfMenu, setTfMenu] = useState(false);
  const [typeMenu, setTypeMenu] = useState(false);
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const [showTools, setShowTools] = useState(() => window.innerWidth >= 768);
  const [fullscreen, setFullscreen] = useState(false);
  const [customMin, setCustomMin] = useState('');
  const areaRef = useRef<HTMLDivElement>(null);
  const apis = useRef<(PaneApi | null)[]>([]);
  const loadDrawings = useDrawings((d) => d.load);

  useEffect(() => { loadDrawings(); }, [loadDrawings]);
  useEffect(() => {
    const h = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  const n = LAYOUTS.find((l) => l.id === layout)!.n;
  const gridClass = layout === '1' ? 'grid-cols-1' : layout === '2h' ? 'grid-cols-1 md:grid-cols-2' : layout === '2v' ? 'grid-rows-2' : 'grid-cols-2 grid-rows-2';

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else areaRef.current?.requestFullscreen?.().catch(() => setFullscreen((f) => !f));
  };

  const screenshot = async () => {
    const blob = await apis.current[activeChart]?.screenshot();
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `XAUUSD-${cfg.tf}-${new Date().toISOString().slice(0, 16).replace(':', '')}.png`;
    a.click();
  };

  const register = useCallback((i: number) => (api: PaneApi | null) => { apis.current[i] = api; }, []);
  const allTfs = [...TIMEFRAMES, ...customTimeframes.map(customTimeframe)];
  const currentType = CHART_TYPES.find((t) => t.id === cfg.chartType)!;

  return (
    <div ref={areaRef} className={`flex h-full flex-col bg-ink-950 ${fullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* Top toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-ink-700 bg-ink-900 px-2">
        <button className={`btn-icon md:hidden ${showTools ? 'on' : ''}`} onClick={() => setShowTools(!showTools)} title="Drawing tools"><PencilRuler size={16} /></button>
        <div className="mr-1 flex shrink-0 items-center gap-2 pr-2">
          <span className="text-sm font-semibold text-gold-300">{source === 'twelvedata' ? 'XAU/USD' : 'XAUUSD'}</span>
          <span className="hidden text-[11px] text-ink-400 lg:inline">{source === 'mt5' ? 'Exness MT5' : source === 'twelvedata' ? 'Twelve Data (not Exness)' : 'no feed'}</span>
        </div>
        <div className="flex shrink-0 items-center">
          {FAVORITE_TFS.map((id) => (
            <button key={id} className={`chip ${cfg.tf === id ? 'on' : ''}`} onClick={() => updateChart(activeChart, { tf: id })}>{TIMEFRAMES.find((t) => t.id === id)!.label}</button>
          ))}
          <div className="relative">
            <button className={`chip flex items-center ${!FAVORITE_TFS.includes(cfg.tf) ? 'on' : ''}`} onClick={() => setTfMenu(!tfMenu)}>
              {!FAVORITE_TFS.includes(cfg.tf) ? allTfs.find((t) => t.id === cfg.tf)?.label : ''}<ChevronDown size={12} />
            </button>
            {tfMenu && (
              <div className="animate-in fixed inset-x-3 top-[calc(var(--safe-top)+92px)] z-50 rounded-2xl border border-white/10 bg-ink-850/95 p-3 shadow-2xl backdrop-blur-xl md:inset-x-auto md:top-auto md:mt-1 md:w-60 md:p-2" onMouseLeave={() => setTfMenu(false)}>
                <div className="grid grid-cols-4 gap-1.5 md:gap-1">
                  {allTfs.map((t) => (
                    <button key={t.id} className={`chip ${cfg.tf === t.id ? 'on' : ''}`} onClick={() => { updateChart(activeChart, { tf: t.id }); setTfMenu(false); }}>{t.label}</button>
                  ))}
                </div>
                <div className="mt-2 flex gap-1 border-t border-ink-700 pt-2">
                  <input className="input py-1 text-xs" placeholder="Custom minutes e.g. 45" value={customMin} onChange={(e) => setCustomMin(e.target.value.replace(/\D/g, ''))} />
                  <button className="btn px-2" onClick={() => {
                    const m = Number(customMin);
                    if (m >= 2 && m <= 10080 && !customTimeframes.includes(m)) set({ customTimeframes: [...customTimeframes, m].sort((a, b) => a - b) });
                    if (m >= 2) updateChart(activeChart, { tf: `C${m}` });
                    setCustomMin(''); setTfMenu(false);
                  }}><Plus size={14} /></button>
                </div>
                {customTimeframes.length > 0 && <button className="mt-1 text-[11px] text-ink-400 hover:text-down" onClick={() => set({ customTimeframes: [] })}>Clear custom timeframes</button>}
                <p className="mt-1 text-[10px] text-ink-400">* custom = aggregated from real lower-timeframe candles</p>
              </div>
            )}
          </div>
        </div>
        <div className="mx-1 h-5 w-px bg-ink-700" />
        <div className="relative shrink-0">
          <button className="btn-icon" title={`Chart type: ${currentType.label}`} onClick={() => setTypeMenu(!typeMenu)}><currentType.icon size={16} /></button>
          {typeMenu && (
            <div className="animate-in fixed inset-x-3 top-[calc(var(--safe-top)+92px)] z-50 rounded-2xl border border-white/10 bg-ink-850/95 p-1.5 shadow-2xl backdrop-blur-xl md:inset-x-auto md:top-auto md:mt-1 md:w-44" onMouseLeave={() => setTypeMenu(false)}>
              {CHART_TYPES.map((t) => (
                <button key={t.id} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-ink-700 ${cfg.chartType === t.id ? 'text-gold-300' : ''}`} onClick={() => { updateChart(activeChart, { chartType: t.id }); setTypeMenu(false); }}><t.icon size={14} />{t.label}</button>
              ))}
            </div>
          )}
        </div>
        <button className="btn shrink-0 border-transparent bg-transparent px-2 text-xs" onClick={() => setIndOpen(true)}><FlaskConical size={14} /> Indicators</button>
        <button className="btn-icon shrink-0" title="Bar replay" onClick={() => apis.current[activeChart]?.startReplay()}><Rewind size={16} /></button>
        <div className="mx-1 h-5 w-px bg-ink-700" />
        {LAYOUTS.map((l) => (
          <button key={l.id} className={`btn-icon shrink-0 ${layout === l.id ? 'on' : ''}`} title={l.label} onClick={() => set({ layout: l.id, activeChart: Math.min(activeChart, l.n - 1) })}><l.icon size={15} /></button>
        ))}
        <button className="btn-icon shrink-0" title="Saved layouts" onClick={() => setLayoutsOpen(true)}><Save size={15} /></button>
        <button className="btn-icon shrink-0" title="Screenshot" onClick={screenshot}><Camera size={15} /></button>
        <button className="btn-icon shrink-0" title="Full screen" onClick={toggleFull}>{fullscreen ? <Minimize size={15} /> : <Maximize size={15} />}</button>
        <div className="ml-auto hidden shrink-0 items-center gap-3 pl-3 md:flex">
          <PriceTicker />
        </div>
      </div>
      <div className="flex items-center justify-between border-b border-ink-800 bg-ink-900 px-2 py-0.5 md:hidden">
        <PriceTicker />
        <FeedBadge compact />
      </div>

      <div className="flex min-h-0 flex-1">
        {showTools && <div className="hidden md:flex"><DrawingToolbar /></div>}
        <div className={`relative grid min-h-0 flex-1 gap-px bg-ink-700 ${gridClass}`}>
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className="relative min-h-0 min-w-0 bg-ink-950">
              <ChartPane index={i} active={i === activeChart} onActivate={() => i !== activeChart && set({ activeChart: i })} onEditIndicator={(chart, uid) => setEditInd({ chart, uid })} registerApi={register(i)} />
              {i === activeChart && <DrawingProps />}
              {i === activeChart && <HiddenDrawingsNotice />}
            </div>
          ))}
        </div>
      </div>
      {showTools && <div className="md:hidden"><DrawingToolbar vertical={false} /></div>}
      <StatusBar />

      <AddIndicatorDialog open={indOpen} onClose={() => setIndOpen(false)} chartIndex={activeChart} />
      <EditIndicatorDialog target={editInd} onClose={() => setEditInd(null)} />
      <LayoutsDialog open={layoutsOpen} onClose={() => setLayoutsOpen(false)} />
      <PositionDialog />
    </div>
  );
}

function LayoutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { savedLayouts, layout, charts, set } = useSettings();
  const [name, setName] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Chart layouts">
      <div className="flex gap-2">
        <input className="input" placeholder="Layout name (e.g. Scalping M1/M5)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-gold" disabled={!name.trim()} onClick={() => { set({ savedLayouts: [...savedLayouts, { id: newId(), name: name.trim(), layout, charts }] }); setName(''); }}>Save current</button>
      </div>
      <div className="mt-4 space-y-1">
        {savedLayouts.map((l) => (
          <div key={l.id} className="flex items-center justify-between rounded-md bg-ink-800 px-3 py-2 text-sm">
            <button className="text-left hover:text-gold-300" onClick={() => { set({ layout: l.layout, charts: l.charts, activeChart: 0 }); onClose(); }}>
              {l.name} <span className="text-xs text-ink-400">· {l.charts.slice(0, LAYOUTS.find((x) => x.id === l.layout)!.n).map((c) => c.tf).join(' / ')}</span>
            </button>
            <button className="text-ink-400 hover:text-down" onClick={() => set({ savedLayouts: savedLayouts.filter((x) => x.id !== l.id) })}><Trash2 size={14} /></button>
          </div>
        ))}
        {!savedLayouts.length && <p className="text-xs text-ink-400">Saved layouts store the grid, each chart's timeframe, chart type and indicators. Drawings are shared across all layouts and timeframes.</p>}
      </div>
    </Modal>
  );
}
