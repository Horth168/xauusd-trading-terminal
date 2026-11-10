import { useEffect, useRef, useState } from 'react';
import { BookOpen, Download, FilePlus2, Loader2, Play, Save, Trash2, Upload } from 'lucide-react';
import { PageHeader, Field } from '../components/ui';
import { removeDoc, saveDoc } from '../lib/db';
import { useScripts, type CustomScript } from '../indicators/registry';
import { runScriptAsync } from '../indicators/scriptClient';
import type { ScriptResult } from '../indicators/runtime';
import { feed, useFeed } from '../market/feed';
import { TIMEFRAMES } from '../market/timeframes';
import { EXAMPLES, API_DOC } from '../indicators/examples';
import { downloadText } from '../lib/format';
import { useSettings } from '../store/settings';
import { newId } from '../lib/db';
import { defaultParams } from '../indicators/builtins';

export default function IndicatorsPage() {
  const scripts = useScripts((s) => s.scripts);
  const source = useFeed((s) => s.source);
  const [current, setCurrent] = useState<Partial<CustomScript>>({ code: EXAMPLES[0].code });
  const [tf, setTf] = useState('H1');
  const [result, setResult] = useState<ScriptResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  const [docs, setDocs] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setResult(null); setErr(null); }, [current.id]);

  const test = async (): Promise<ScriptResult | null> => {
    setBusy(true); setErr(null);
    try {
      const bars = source ? await feed.load(tf, 1000) : [];
      if (!bars.length) throw new Error('No market data connected — connect a feed to test against real candles.');
      const r = await runScriptAsync(current.code ?? '', bars, {});
      setResult(r);
      return r;
    } catch (e: any) { setErr(String(e.message ?? e)); setResult(null); return null; } finally { setBusy(false); }
  };

  const save = async () => {
    const r = await test();
    if (!r) return;
    const doc = await saveDoc<CustomScript>('indicators', {
      ...current, code: current.code ?? '', name: r.meta.name, kind: r.meta.kind, overlay: r.meta.overlay, inputs: r.meta.inputs,
      plots: r.output.plots.map((p) => ({ id: p.id, title: p.title, color: p.color })),
    } as CustomScript);
    setCurrent(doc);
    setSaved(`Saved "${doc.name}"`);
    setTimeout(() => setSaved(''), 2500);
  };

  const addToChart = () => {
    if (!current.id) return;
    const s = useSettings.getState();
    const meta = scripts.find((x) => x.id === current.id);
    if (!meta) return;
    s.updateChart(s.activeChart, { indicators: [...s.charts[s.activeChart].indicators, { uid: newId(), type: `custom:${meta.id}`, params: defaultParams(meta), colors: {}, lineWidth: 2, visible: true }] });
    setSaved('Added to the active chart');
    setTimeout(() => setSaved(''), 2500);
  };

  const exportFile = () => downloadText(`${(result?.meta.name ?? current.name ?? 'indicator').replace(/\W+/g, '-')}.xts.json`, JSON.stringify({ format: 'xts-1', name: current.name ?? result?.meta.name, code: current.code }, null, 2), 'application/json');
  const importFile = async (f?: File) => {
    if (!f) return;
    const text = await f.text();
    try {
      const j = JSON.parse(text);
      if (typeof j.code !== 'string') throw new Error('missing code');
      setCurrent({ code: j.code, name: j.name });
    } catch { setCurrent({ code: text }); } // plain .js file
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget, s = el.selectionStart, end = el.selectionEnd;
      const v = el.value.slice(0, s) + '  ' + el.value.slice(end);
      setCurrent((c) => ({ ...c, code: v }));
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); test(); }
  };

  const lines = (current.code ?? '').split('\n').length;
  const nSignals = result ? result.output.signals.long.filter(Boolean).length + result.output.signals.short.filter(Boolean).length : 0;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="My Indicators & Strategies" subtitle="Write JavaScript indicators with a Pine-inspired API. Not Pine Script — see the API reference."
        actions={<>
          <button className="btn" onClick={() => setDocs(!docs)}><BookOpen size={14} /> API reference</button>
          <button className="btn" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import</button>
          <input ref={fileRef} type="file" accept=".json,.js,.txt" className="hidden" onChange={(e) => importFile(e.target.files?.[0])} />
          <button className="btn" onClick={exportFile}><Download size={14} /> Export</button>
        </>} />

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="space-y-3">
          <div className="card p-2">
            <div className="mb-1 flex items-center justify-between px-1"><h3 className="text-xs font-semibold text-ink-300">My scripts</h3><button className="btn-icon" title="New" onClick={() => setCurrent({ code: "indicator('My indicator', { overlay: true });\nconst len = input.int('Length', 20);\nplot(ta.sma(close, len), 'SMA');\n" })}><FilePlus2 size={14} /></button></div>
            {scripts.map((s) => (
              <button key={s.id} className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-ink-800 ${current.id === s.id ? 'bg-ink-800 text-gold-300' : 'text-ink-200'}`} onClick={() => setCurrent(s)}>
                <span className="truncate">{s.name}</span><span className="text-[10px] text-ink-400">{s.kind}</span>
              </button>
            ))}
            {!scripts.length && <p className="px-2 py-1 text-[11px] text-ink-400">None yet — start from an example below and press Save.</p>}
          </div>
          <div className="card p-2">
            <h3 className="mb-1 px-1 text-xs font-semibold text-ink-300">Examples</h3>
            {EXAMPLES.map((ex) => <button key={ex.name} className="w-full rounded-md px-2 py-1.5 text-left text-xs text-ink-200 hover:bg-ink-800" onClick={() => setCurrent({ code: ex.code })}>{ex.name}</button>)}
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-ink-700 px-3 py-2">
              <span className="text-sm font-semibold text-ink-100">{current.id ? current.name : 'Unsaved script'}</span>
              <div className="ml-auto flex items-center gap-2">
                <Field label="" className="!mb-0"><select className="input py-1 text-xs" value={tf} onChange={(e) => setTf(e.target.value)}>{TIMEFRAMES.map((t) => <option key={t.id}>{t.id}</option>)}</select></Field>
                <button className="btn" onClick={test} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Test (Ctrl+Enter)</button>
                <button className="btn-gold" onClick={save} disabled={busy}><Save size={14} /> Save (Ctrl+S)</button>
                {current.id && <button className="btn" onClick={addToChart}>Add to chart</button>}
                {current.id && <button className="btn-icon hover:text-down" title="Delete" onClick={async () => { if (confirm('Delete script? Charts using it will show "missing".')) { await removeDoc('indicators', current.id!); setCurrent({ code: '' }); } }}><Trash2 size={14} /></button>}
              </div>
            </div>
            <div className="relative flex h-[460px] bg-ink-950 font-mono text-[12.5px] leading-5">
              <div ref={gutterRef} className="select-none overflow-hidden border-r border-ink-800 px-2 py-2 text-right text-ink-500">
                {Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}
              </div>
              <textarea ref={taRef} spellCheck={false} className="flex-1 resize-none bg-transparent p-2 text-ink-100 outline-none" value={current.code ?? ''} onKeyDown={onKeyDown}
                onScroll={(e) => { if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop; }}
                onChange={(e) => setCurrent((c) => ({ ...c, code: e.target.value }))} />
            </div>
          </div>
          {saved && <p className="text-xs text-up">{saved}</p>}
          {err && <pre className="card overflow-x-auto whitespace-pre-wrap border-down/40 p-3 text-xs text-down">{err}</pre>}
          {result && (
            <div className="card grid gap-3 p-3 text-xs md:grid-cols-3">
              <div><div className="text-ink-400">Declared</div><div className="text-ink-100">{result.meta.kind}: {result.meta.name} ({result.meta.overlay ? 'overlay' : 'separate pane'})</div></div>
              <div><div className="text-ink-400">Inputs</div><div className="text-ink-100">{result.meta.inputs.map((i) => `${i.label}=${i.default}`).join(', ') || '—'}</div></div>
              <div><div className="text-ink-400">Output on {tf} test data</div><div className="text-ink-100">{result.output.plots.length} plots · {result.output.markers.length} markers · {nSignals} signals · {result.output.alerts.length} alerts</div></div>
              {result.logs.length > 0 && <pre className="max-h-40 overflow-auto rounded bg-ink-900 p-2 text-ink-300 md:col-span-3">{result.logs.join('\n')}</pre>}
            </div>
          )}
          {docs && <pre className="card overflow-x-auto p-4 text-xs leading-5 text-ink-200">{API_DOC}</pre>}
        </div>
      </div>
    </div>
  );
}
