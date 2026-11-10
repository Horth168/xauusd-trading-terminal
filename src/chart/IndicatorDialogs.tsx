import { useMemo, useState } from 'react';
import { Code2, Plus, Save, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Field, Modal } from '../components/ui';
import { BUILTINS, defaultParams } from '../indicators/builtins';
import { indicatorMeta, useScripts } from '../indicators/registry';
import { useSettings, type IndicatorInstance } from '../store/settings';
import { newId } from '../lib/db';
import type { InputDef } from '../indicators/types';

export function AddIndicatorDialog({ open, onClose, chartIndex }: { open: boolean; onClose: () => void; chartIndex: number }) {
  const [q, setQ] = useState('');
  const [tplName, setTplName] = useState('');
  const scripts = useScripts((s) => s.scripts);
  const { charts, updateChart, indicatorTemplates, set } = useSettings();
  const cfg = charts[chartIndex];

  const add = (type: string, inputs: InputDef[], colors: Record<string, string>) => {
    const inst: IndicatorInstance = { uid: newId(), type, params: defaultParams({ inputs }), colors: { ...colors }, lineWidth: 2, visible: true };
    updateChart(chartIndex, { indicators: [...cfg.indicators, inst] });
  };

  const items = useMemo(() => {
    const b = BUILTINS.map((d) => ({ key: d.id, name: d.name, tag: d.overlay ? 'overlay' : 'pane', onAdd: () => add(d.id, d.inputs, d.colors) }));
    const c = scripts.map((s) => ({ key: `custom:${s.id}`, name: s.name, tag: s.kind === 'strategy' ? 'my strategy' : 'my indicator', onAdd: () => add(`custom:${s.id}`, s.inputs, Object.fromEntries((s.plots ?? []).map((p) => [p.id, p.color]))) }));
    return [...c, ...b].filter((x) => x.name.toLowerCase().includes(q.toLowerCase()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scripts, q, cfg.indicators]);

  const saveTemplate = () => {
    if (!tplName.trim() || !cfg.indicators.length) return;
    set({ indicatorTemplates: [...indicatorTemplates, { id: newId(), name: tplName.trim(), indicators: cfg.indicators }] });
    setTplName('');
  };

  return (
    <Modal open={open} onClose={onClose} title="Indicators" wide>
      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
        <div>
          <input className="input mb-3" placeholder="Search indicators…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="max-h-[55vh] divide-y divide-ink-800 overflow-y-auto rounded-lg border border-ink-700">
            {items.map((it) => (
              <button key={it.key} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-ink-800" onClick={it.onAdd}>
                <span className="text-ink-100">{it.name}</span>
                <span className="flex items-center gap-2 text-[11px] text-ink-400">{it.tag}<Plus size={14} className="text-gold-400" /></span>
              </button>
            ))}
          </div>
          <Link to="/indicators" onClick={onClose} className="mt-3 inline-flex items-center gap-1.5 text-xs text-gold-300 hover:underline"><Code2 size={14} /> Write your own indicator or strategy</Link>
        </div>
        <div className="space-y-3">
          <div>
            <h3 className="label">On this chart ({cfg.indicators.length})</h3>
            <div className="space-y-1">
              {cfg.indicators.map((i) => (
                <div key={i.uid} className="flex items-center justify-between rounded-md bg-ink-800 px-2 py-1 text-xs">
                  <span>{indicatorMeta(i.type).shortName}</span>
                  <button className="text-ink-400 hover:text-down" onClick={() => updateChart(chartIndex, { indicators: cfg.indicators.filter((x) => x.uid !== i.uid) })}><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="label">Templates</h3>
            <div className="flex gap-1">
              <input className="input" placeholder="Template name" value={tplName} onChange={(e) => setTplName(e.target.value)} />
              <button className="btn" onClick={saveTemplate} title="Save current indicators as template"><Save size={14} /></button>
            </div>
            <div className="mt-2 space-y-1">
              {indicatorTemplates.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-md bg-ink-800 px-2 py-1 text-xs">
                  <button className="text-left text-ink-100 hover:text-gold-300" onClick={() => updateChart(chartIndex, { indicators: t.indicators.map((i) => ({ ...i, uid: newId() })) })}>{t.name} <span className="text-ink-400">({t.indicators.length})</span></button>
                  <button className="text-ink-400 hover:text-down" onClick={() => set({ indicatorTemplates: indicatorTemplates.filter((x) => x.id !== t.id) })}><Trash2 size={12} /></button>
                </div>
              ))}
              {!indicatorTemplates.length && <p className="text-[11px] text-ink-400">Save a set of indicators to re-apply it on any chart.</p>}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function InputControl({ def, value, onChange }: { def: InputDef; value: any; onChange: (v: any) => void }) {
  if (def.type === 'bool') return <input type="checkbox" className="h-4 w-4 accent-gold-500" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
  if (def.type === 'select') return <select className="input" value={String(value)} onChange={(e) => onChange(e.target.value)}>{def.options?.map((o) => <option key={o}>{o}</option>)}</select>;
  if (def.type === 'color') return <input type="color" className="h-8 w-16 rounded bg-transparent" value={String(value)} onChange={(e) => onChange(e.target.value)} />;
  if (def.type === 'string') return <input className="input" value={String(value)} onChange={(e) => onChange(e.target.value)} />;
  return <input type="number" className="input" value={value} min={def.min} max={def.max} step={def.step ?? (def.type === 'int' ? 1 : 0.1)} onChange={(e) => onChange(def.type === 'int' ? parseInt(e.target.value || '0') : parseFloat(e.target.value || '0'))} />;
}

export function EditIndicatorDialog({ target, onClose }: { target: { chart: number; uid: string } | null; onClose: () => void }) {
  const { charts, updateChart } = useSettings();
  const inst = target ? charts[target.chart]?.indicators.find((i) => i.uid === target.uid) : null;
  if (!target || !inst) return null;
  const meta = indicatorMeta(inst.type);
  const patch = (p: Partial<IndicatorInstance>) => updateChart(target.chart, { indicators: charts[target.chart].indicators.map((i) => (i.uid === inst.uid ? { ...i, ...p } : i)) });
  const colorKeys = Object.keys({ ...meta.colors, ...inst.colors });
  return (
    <Modal open onClose={onClose} title={`${meta.name} settings`} footer={<button className="btn-gold" onClick={onClose}>Done</button>}>
      <div className="grid grid-cols-2 gap-3">
        {meta.inputs.map((def) => (
          <Field key={def.id} label={def.label}>
            <InputControl def={def} value={inst.params[def.id] ?? def.default} onChange={(v) => patch({ params: { ...inst.params, [def.id]: v } })} />
          </Field>
        ))}
        <Field label="Line width">
          <select className="input" value={inst.lineWidth} onChange={(e) => patch({ lineWidth: Number(e.target.value) })}>{[1, 2, 3, 4].map((w) => <option key={w}>{w}</option>)}</select>
        </Field>
      </div>
      {colorKeys.length > 0 && (
        <div className="mt-4">
          <h3 className="label">Colors</h3>
          <div className="flex flex-wrap gap-3">
            {colorKeys.map((k) => (
              <label key={k} className="flex items-center gap-2 text-xs text-ink-300">
                <input type="color" className="h-7 w-10 rounded bg-transparent" value={toHex(inst.colors[k] ?? meta.colors[k] ?? '#e8c25a')} onChange={(e) => patch({ colors: { ...inst.colors, [k]: e.target.value } })} />
                {k}
              </label>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

function toHex(c: string) {
  if (c.startsWith('#')) return c.slice(0, 7);
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  return m ? '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('') : '#e8c25a';
}
