import { useState } from 'react';
import { ImagePlus, Loader2, Trash2, X } from 'lucide-react';
import { Field, Modal } from '../components/ui';
import { saveDoc, uploadImage, useCollection, removeDoc } from '../lib/db';
import { useSettings } from '../store/settings';
import { fromLocalInput, toLocalInput } from '../lib/time';
import { netOf, type Emotion, type JournalTrade } from './stats';
import { signedUsd, pnlClass } from '../lib/format';

export const EMOTIONS: { id: Emotion; label: string }[] = [
  { id: 'calm', label: '😌 Calm' }, { id: 'confident', label: '💪 Confident' }, { id: 'neutral', label: '😐 Neutral' }, { id: 'fearful', label: '😨 Fearful' },
  { id: 'greedy', label: '🤑 Greedy' }, { id: 'impatient', label: '⏱️ Impatient' }, { id: 'fomo', label: '🏃 FOMO' }, { id: 'revenge', label: '😤 Revenge' }, { id: 'tired', label: '🥱 Tired' },
];

const blank = (): Partial<JournalTrade> => ({ date: Math.floor(Date.now() / 1000), instrument: 'XAUUSD', side: 'buy', lots: 0.1, fees: 0, screenshots: [], emotion: 'neutral', source: 'manual' });

export function TradeForm({ trade, onClose }: { trade: Partial<JournalTrade> | null; onClose: () => void }) {
  const tz = useSettings((s) => s.timezone);
  const contract = useSettings((s) => s.contractSize);
  const strategies = useCollection<{ id: string; name: string }>('strategies');
  const [t, setT] = useState<Partial<JournalTrade>>(() => trade ?? blank());
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!trade) return null;
  const p = (patch: Partial<JournalTrade>) => setT((x) => ({ ...x, ...patch }));
  const n = (v: string) => (v === '' ? undefined : Number(v));

  const suggested = t.entry != null && t.exit != null && t.lots ? (t.exit - t.entry) * (t.side === 'buy' ? 1 : -1) * t.lots * (t.instrument?.toUpperCase().startsWith('XAU') ? contract : 1) : null;

  const addShots = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files)) urls.push((await uploadImage(f)).url);
      p({ screenshots: [...(t.screenshots ?? []), ...urls] });
    } catch (e: any) { setErr(`Upload failed: ${e.message}`); } finally { setUploading(false); }
  };

  const save = async () => {
    if (t.entry == null || t.exit == null || t.pnl == null || !t.lots) { setErr('Entry, exit, lot size and profit/loss are required.'); return; }
    setSaving(true);
    try {
      await saveDoc<JournalTrade>('trades', { ...(t as JournalTrade), fees: t.fees ?? 0 });
      onClose();
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={t.id ? 'Edit trade' : 'Record a trade'} wide
      footer={<>
        {t.id && <button className="btn-danger mr-auto" onClick={async () => { if (confirm('Delete this trade?')) { await removeDoc('trades', t.id!); onClose(); } }}><Trash2 size={14} /> Delete</button>}
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn-gold" onClick={save} disabled={saving}>{saving ? <Loader2 size={14} className="animate-spin" /> : null} Save trade</button>
      </>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label={`Close date/time (${tz})`} className="col-span-2"><input type="datetime-local" className="input" value={toLocalInput(t.date ?? Date.now() / 1000, tz)} onChange={(e) => p({ date: fromLocalInput(e.target.value, tz) })} /></Field>
        <Field label="Instrument"><input className="input" value={t.instrument ?? ''} onChange={(e) => p({ instrument: e.target.value.toUpperCase() })} /></Field>
        <Field label="Direction">
          <div className="flex gap-1">
            <button className={`flex-1 rounded-md py-1.5 text-sm ${t.side === 'buy' ? 'bg-up text-ink-950' : 'bg-ink-800 text-ink-300'}`} onClick={() => p({ side: 'buy' })}>Buy</button>
            <button className={`flex-1 rounded-md py-1.5 text-sm ${t.side === 'sell' ? 'bg-down text-white' : 'bg-ink-800 text-ink-300'}`} onClick={() => p({ side: 'sell' })}>Sell</button>
          </div>
        </Field>
        <Field label="Entry price"><input type="number" step="0.01" className="input" value={t.entry ?? ''} onChange={(e) => p({ entry: n(e.target.value) })} /></Field>
        <Field label="Exit price"><input type="number" step="0.01" className="input" value={t.exit ?? ''} onChange={(e) => p({ exit: n(e.target.value) })} /></Field>
        <Field label="Lot size"><input type="number" step="0.01" className="input" value={t.lots ?? ''} onChange={(e) => p({ lots: n(e.target.value) })} /></Field>
        <Field label="Stop loss"><input type="number" step="0.01" className="input" value={t.sl ?? ''} onChange={(e) => p({ sl: n(e.target.value) ?? null })} /></Field>
        <Field label="Take profit"><input type="number" step="0.01" className="input" value={t.tp ?? ''} onChange={(e) => p({ tp: n(e.target.value) ?? null })} /></Field>
        <Field label="Profit / loss (USD)" hint={suggested != null ? <button className="text-gold-300 hover:underline" onClick={() => p({ pnl: Math.round(suggested * 100) / 100 })}>Use calculated {signedUsd(suggested)}</button> : 'gross, before fees'}>
          <input type="number" step="0.01" className="input" value={t.pnl ?? ''} onChange={(e) => p({ pnl: n(e.target.value) })} />
        </Field>
        <Field label="Fees + commission + swap" hint="cost as positive number"><input type="number" step="0.01" className="input" value={t.fees ?? ''} onChange={(e) => p({ fees: n(e.target.value) ?? 0 })} /></Field>
        <Field label="Net result">
          <div className={`input font-mono ${pnlClass(netOf({ pnl: t.pnl ?? 0, fees: t.fees ?? 0 }))}`}>{signedUsd(netOf({ pnl: t.pnl ?? 0, fees: t.fees ?? 0 }))}</div>
        </Field>
        <Field label="Strategy" className="col-span-2">
          <input className="input" list="strategy-list" value={t.strategy ?? ''} onChange={(e) => p({ strategy: e.target.value })} placeholder="e.g. London breakout" />
          <datalist id="strategy-list">{strategies.items.map((s) => <option key={s.id} value={s.name} />)}</datalist>
        </Field>
        <Field label="Emotional condition">
          <select className="input" value={t.emotion ?? 'neutral'} onChange={(e) => p({ emotion: e.target.value as Emotion })}>{EMOTIONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
        </Field>
        <Field label="Trade result">
          <select className="input" value={t.result ?? ''} onChange={(e) => p({ result: (e.target.value || undefined) as any })}>
            <option value="">Auto (from net P&L)</option><option value="win">Win</option><option value="loss">Loss</option><option value="breakeven">Break-even</option>
          </select>
        </Field>
        <Field label="Notes" className="col-span-2 md:col-span-4"><textarea className="input min-h-[80px]" value={t.notes ?? ''} onChange={(e) => p({ notes: e.target.value })} placeholder="Why did you take it? What went well? What would you change?" /></Field>
      </div>
      <div className="mt-3">
        <span className="label">Screenshots</span>
        <div className="flex flex-wrap gap-2">
          {(t.screenshots ?? []).map((u, i) => (
            <div key={i} className="group relative">
              <a href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="h-20 w-32 rounded-md border border-ink-700 object-cover" /></a>
              <button className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-down p-0.5 text-white group-hover:block" onClick={() => p({ screenshots: t.screenshots!.filter((_, k) => k !== i) })}><X size={12} /></button>
            </div>
          ))}
          <label className="flex h-20 w-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-ink-500 text-xs text-ink-400 hover:border-gold-500 hover:text-gold-300">
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />} Add image
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addShots(e.target.files)} />
          </label>
        </div>
      </div>
      {err && <p className="mt-3 text-sm text-down">{err}</p>}
    </Modal>
  );
}
