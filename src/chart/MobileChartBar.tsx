import { useState, type ReactNode } from 'react';
import {
  Camera, Eye, EyeOff, FlaskConical, Lock, LockOpen, Magnet, MoreHorizontal, PencilRuler, Pin, Redo2, Rewind, Save, SlidersHorizontal, Trash2, Undo2, X,
} from 'lucide-react';
import { Modal } from '../components/ui';
import { TOOLS, TOOL_MAP, useDrawings, type ToolSpec } from './drawings/model';
import { ICONS } from './DrawingToolbar';
import { useSettings, type ChartType } from '../store/settings';

interface Props {
  chartTypes: { id: ChartType; label: string; icon: any }[];
  chartType: ChartType;
  onChartType: (t: ChartType) => void;
  onIndicators: () => void;
  onReplay: () => void;
  onScreenshot: () => void;
  onLayouts: () => void;
}

const GROUPS: ToolSpec['group'][] = ['Lines', 'Fibonacci', 'Shapes', 'Trading'];

function BarButton({ icon: Icon, label, onClick, active }: { icon: any; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-xl py-1.5 transition-all active:scale-95 active:bg-white/5 ${active ? 'text-gold-300' : 'text-ink-200'}`}>
      <Icon size={22} strokeWidth={1.8} />
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
}

function Tile({ icon: Icon, label, onClick, active, tone }: { icon: any; label: string; onClick: () => void; active?: boolean; tone?: string }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center justify-center gap-2 rounded-2xl px-1 py-3.5 text-center transition-all active:scale-95 ${active ? 'bg-gold-500/15 text-gold-300 ring-1 ring-gold-500/40' : 'bg-white/[0.04] text-ink-100'}`}>
      <Icon size={24} strokeWidth={1.7} className={tone} />
      <span className="text-[11.5px] font-medium leading-tight">{label}</span>
    </button>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-400 first:mt-0">{children}</h3>;
}

/** Phone-only chart controls: large buttons and full-width sheets instead of tiny desktop icons. */
export function MobileChartBar(p: Props) {
  const { tool, setTool, undo, redo, past, future, items, commit, stayInTool } = useDrawings();
  const { magnet, drawingsVisible, set } = useSettings();
  const [sheet, setSheet] = useState<'draw' | 'type' | 'more' | null>(null);
  const close = () => setSheet(null);
  const TypeIcon = p.chartTypes.find((t) => t.id === p.chartType)?.icon ?? Rewind;
  const allLocked = items.length > 0 && items.every((d) => d.locked);
  const active = tool !== 'cursor' ? TOOL_MAP.get(tool) : null;

  return (
    <>
      {active ? (
        // While a drawing tool is selected: clear instructions + big Done button.
        <div className="flex h-[60px] shrink-0 items-center gap-3 border-t border-white/[0.06] bg-ink-900 px-4">
          {(() => { const I = ICONS[active.id]; return <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold-500/15 text-gold-300"><I size={20} /></span>; })()}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink-100">{active.label}</div>
            <div className="truncate text-xs text-ink-400">{active.points === 0 ? 'Drag on the chart to draw' : `Tap the chart ${active.points === 1 ? 'once' : `${active.points} times`} to place it`}</div>
          </div>
          <button onClick={() => setTool('cursor')} className="h-10 rounded-xl bg-white/[0.08] px-4 text-sm font-semibold text-ink-100 active:scale-95">Done</button>
        </div>
      ) : (
        <div className="flex h-[60px] shrink-0 items-stretch gap-1 border-t border-white/[0.06] bg-ink-900 px-2">
          <BarButton icon={PencilRuler} label="Draw" onClick={() => setSheet('draw')} />
          <BarButton icon={FlaskConical} label="Indicators" onClick={p.onIndicators} />
          <BarButton icon={TypeIcon} label="Chart type" onClick={() => setSheet('type')} />
          <BarButton icon={Rewind} label="Replay" onClick={p.onReplay} />
          <BarButton icon={MoreHorizontal} label="Tools" onClick={() => setSheet('more')} />
        </div>
      )}

      <Modal open={sheet === 'draw'} onClose={close} title="Drawing tools">
        {GROUPS.map((g) => (
          <div key={g}>
            <SectionTitle>{g}</SectionTitle>
            <div className="grid grid-cols-4 gap-2">
              {TOOLS.filter((t) => t.group === g).map((t) => (
                <Tile key={t.id} icon={ICONS[t.id]} label={t.label.replace('Trend-Based ', '').replace('Fib ', 'Fib ')} active={tool === t.id} onClick={() => { setTool(t.id); close(); }} />
              ))}
            </div>
          </div>
        ))}
        <SectionTitle>Position with exact prices</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          {(['long', 'short'] as const).map((side) => (
            <button key={side} onClick={() => { close(); useDrawings.setState({ positionDialog: { side } }); }}
              className={`flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-semibold active:scale-[0.98] ${side === 'long' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>
              <SlidersHorizontal size={17} /> {side === 'long' ? 'Long' : 'Short'} — enter prices
            </button>
          ))}
        </div>
        <SectionTitle>Options</SectionTitle>
        <div className="grid grid-cols-4 gap-2">
          <Tile icon={Magnet} label="Magnet" active={magnet} onClick={() => set({ magnet: !magnet })} />
          <Tile icon={Pin} label="Keep tool" active={stayInTool} onClick={() => useDrawings.setState({ stayInTool: !stayInTool })} />
          <Tile icon={drawingsVisible ? Eye : EyeOff} label={drawingsVisible ? 'Hide all' : 'Show all'} onClick={() => set({ drawingsVisible: !drawingsVisible })} />
          <Tile icon={allLocked ? Lock : LockOpen} label={allLocked ? 'Unlock all' : 'Lock all'} onClick={() => commit(items.map((d) => ({ ...d, locked: !allLocked })))} />
        </div>
      </Modal>

      <Modal open={sheet === 'type'} onClose={close} title="Chart type">
        <div className="space-y-1.5">
          {p.chartTypes.map((t) => (
            <button key={t.id} onClick={() => { p.onChartType(t.id); close(); }}
              className={`flex h-14 w-full items-center gap-4 rounded-2xl px-4 text-left text-[15px] font-medium transition-all active:scale-[0.99] ${p.chartType === t.id ? 'bg-gold-500/15 text-gold-300' : 'bg-white/[0.04] text-ink-100'}`}>
              <t.icon size={22} /> {t.label}
              {p.chartType === t.id && <span className="ml-auto text-xs">Selected</span>}
            </button>
          ))}
        </div>
      </Modal>

      <Modal open={sheet === 'more'} onClose={close} title="Tools">
        <div className="grid grid-cols-4 gap-2">
          <Tile icon={Undo2} label="Undo" onClick={undo} tone={past.length ? '' : 'opacity-30'} />
          <Tile icon={Redo2} label="Redo" onClick={redo} tone={future.length ? '' : 'opacity-30'} />
          <Tile icon={Camera} label="Screenshot" onClick={() => { close(); p.onScreenshot(); }} />
          <Tile icon={Save} label="Layouts" onClick={() => { close(); p.onLayouts(); }} />
        </div>
        <button onClick={() => { if (items.length && confirm(`Delete all ${items.length} drawings? You can undo this.`)) { commit([]); close(); } }}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-down/10 text-sm font-semibold text-down active:scale-[0.98]">
          <Trash2 size={17} /> Delete all drawings ({items.length})
        </button>
        <button onClick={close} className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white/[0.04] text-sm font-medium text-ink-300"><X size={16} /> Close</button>
      </Modal>
    </>
  );
}
