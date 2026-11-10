import { useState } from 'react';
import { Bell, BellOff, Plus, Trash2 } from 'lucide-react';
import { Empty, Field, Modal, PageHeader, Segmented } from '../components/ui';
import { removeDoc, saveDoc } from '../lib/db';
import { requestNotificationPermission, useAlerts, type AlertDoc } from '../alerts/engine';
import { BUILTINS, defaultParams } from '../indicators/builtins';
import { STRATEGIES } from '../backtest/strategies';
import { useScripts } from '../indicators/registry';
import { InputControl } from '../chart/IndicatorDialogs';
import { TIMEFRAMES } from '../market/timeframes';
import { useFeed } from '../market/feed';
import { useSettings } from '../store/settings';
import { fmtDateTime } from '../lib/time';

export default function AlertsPage() {
  const { alerts, log, drawingAlerts, setDrawingAlerts } = useAlerts();
  const tz = useSettings((s) => s.timezone);
  const [editing, setEditing] = useState<Partial<AlertDoc> | null>(null);
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Alerts" subtitle="Notifications only — this app never places or executes trades"
        actions={<button className="btn-gold" onClick={() => setEditing({ kind: 'price', condition: 'above', once: true, active: true })}><Plus size={14} /> New alert</button>} />

      <div className="card mb-4 space-y-2 p-3 text-xs text-ink-300">
        <div className="flex flex-wrap items-center gap-3">
          <span>Browser notifications: <b className={perm === 'granted' ? 'text-up' : 'text-gold-300'}>{perm}</b></span>
          {perm !== 'granted' && perm !== 'unsupported' && <button className="btn py-1 text-xs" onClick={async () => setPerm(await requestNotificationPermission() as any)}>Enable notifications</button>}
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-gold-500" checked={drawingAlerts} onChange={(e) => setDrawingAlerts(e.target.checked)} /> Alert when price crosses my Entry / Stop Loss / Take Profit / position drawings</label>
        </div>
        <p className="text-ink-400">Alerts are evaluated by this app while it is open (in a tab or the installed PWA) and connected to a live feed. Indicator and strategy alerts trigger only on <b>closed</b> candles. On iPhone, web push requires iOS 16.4+ with the app installed to the Home Screen; alerts do not fire while the app is fully closed because there is no always-on server.</p>
      </div>

      {!alerts.length ? <Empty>No alerts yet. Create one here, or use the alarm-clock tool on the chart to click a price level.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="table-x text-xs">
            <thead><tr><th>Status</th><th>Type</th><th>Condition</th><th>Message</th><th>Last triggered</th><th /></tr></thead>
            <tbody>{alerts.map((a) => (
              <tr key={a.id}>
                <td><button className={`btn-icon ${a.active ? 'text-up' : 'text-ink-500'}`} title={a.active ? 'Active — click to pause' : 'Paused — click to activate'} onClick={() => saveDoc<AlertDoc>('alerts', { ...a, active: !a.active })}>{a.active ? <Bell size={14} /> : <BellOff size={14} />}</button></td>
                <td>{a.kind}</td>
                <td className="cursor-pointer hover:text-gold-300" onClick={() => setEditing(a)}>{describe(a)}</td>
                <td className="max-w-[240px] truncate">{a.message}</td>
                <td>{a.lastTriggered ? fmtDateTime(a.lastTriggered / 1000, tz) : '—'} {a.triggerCount ? `(${a.triggerCount}×)` : ''}</td>
                <td><button className="btn-icon hover:text-down" onClick={() => removeDoc('alerts', a.id)}><Trash2 size={14} /></button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {log.length > 0 && (
        <div className="card mt-4 p-3">
          <h3 className="mb-2 text-sm font-semibold text-ink-100">Triggered this session</h3>
          {log.map((l) => <div key={l.id} className="flex gap-3 border-b border-ink-800 py-1 text-xs"><span className="text-ink-400">{fmtDateTime(l.time / 1000, tz)}</span><span className="text-gold-300">{l.title}</span><span>{l.body}</span></div>)}
        </div>
      )}
      {editing && <AlertForm a={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function describe(a: AlertDoc) {
  if (a.kind === 'price') return `Price ${a.condition} ${a.price}`;
  if (a.kind === 'indicator') return `${a.indicator?.type} ${a.plotId ?? ''} ${a.condition} ${a.level} on ${a.tf} close`;
  return `${a.indicator?.type} ${a.signal} signal on ${a.tf} close`;
}

function AlertForm({ a, onClose }: { a: Partial<AlertDoc>; onClose: () => void }) {
  const scripts = useScripts((s) => s.scripts);
  const bid = useFeed((s) => s.tick?.bid);
  const [f, setF] = useState<Partial<AlertDoc>>({ tf: 'M15', message: '', price: bid ? Math.round(bid) : undefined, ...a });
  const p = (x: Partial<AlertDoc>) => setF((o) => ({ ...o, ...x }));
  const sources = [
    ...BUILTINS.filter((b) => !b.transformsCandles).map((b) => ({ id: b.id, name: b.name, inputs: b.inputs })),
    ...STRATEGIES.map((s) => ({ id: s.id, name: `Strategy: ${s.name}`, inputs: s.inputs })),
    ...scripts.map((s) => ({ id: `custom:${s.id}`, name: `My: ${s.name}`, inputs: s.inputs })),
  ];
  const src = sources.find((s) => s.id === f.indicator?.type);
  const pickSource = (id: string) => { const s = sources.find((x) => x.id === id)!; p({ indicator: { type: id, params: defaultParams(s) } }); };
  const save = async () => {
    if (f.kind === 'price' && !Number.isFinite(f.price)) return;
    if (f.kind !== 'price' && !f.indicator) return;
    await saveDoc<AlertDoc>('alerts', { active: true, once: false, ...f } as AlertDoc);
    await requestNotificationPermission();
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={f.id ? 'Edit alert' : 'New alert'} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn-gold" onClick={save}>Save alert</button></>}>
      <div className="space-y-3">
        <Segmented value={f.kind ?? 'price'} onChange={(v) => p({ kind: v, ...(v !== 'price' && !f.indicator ? { indicator: { type: 'rsi', params: defaultParams(BUILTINS.find((b) => b.id === 'rsi')!) }, level: 70, condition: 'cross', signal: 'any' } : {}) })}
          options={[{ value: 'price', label: 'Price' }, { value: 'indicator', label: 'Indicator level' }, { value: 'signal', label: 'Strategy / entry signal' }]} />
        {f.kind === 'price' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Condition"><select className="input" value={f.condition} onChange={(e) => p({ condition: e.target.value as any })}><option value="above">Crosses above</option><option value="below">Crosses below</option><option value="cross">Crosses (either way)</option></select></Field>
            <Field label="Price" hint={bid ? `current ${bid.toFixed(2)}` : undefined}><input type="number" step="0.01" className="input" value={f.price ?? ''} onChange={(e) => p({ price: Number(e.target.value) })} /></Field>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Indicator / strategy"><select className="input" value={f.indicator?.type} onChange={(e) => pickSource(e.target.value)}>{sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              <Field label="Timeframe"><select className="input" value={f.tf} onChange={(e) => p({ tf: e.target.value })}>{TIMEFRAMES.map((t) => <option key={t.id}>{t.id}</option>)}</select></Field>
              {src?.inputs.map((d) => <Field key={d.id} label={d.label}><InputControl def={d} value={f.indicator?.params[d.id] ?? d.default} onChange={(v) => p({ indicator: { ...f.indicator!, params: { ...f.indicator!.params, [d.id]: v } } })} /></Field>)}
            </div>
            {f.kind === 'indicator' ? (
              <div className="grid grid-cols-3 gap-3">
                <Field label="Plot id" hint="e.g. rsi, macd, k, adx"><input className="input" value={f.plotId ?? ''} onChange={(e) => p({ plotId: e.target.value })} placeholder="first plot" /></Field>
                <Field label="Condition"><select className="input" value={f.condition} onChange={(e) => p({ condition: e.target.value as any })}><option value="above">Crosses above</option><option value="below">Crosses below</option><option value="cross">Crosses</option></select></Field>
                <Field label="Level"><input type="number" className="input" value={f.level ?? ''} onChange={(e) => p({ level: Number(e.target.value) })} /></Field>
              </div>
            ) : (
              <Field label="Trigger on"><select className="input" value={f.signal} onChange={(e) => p({ signal: e.target.value as any })}><option value="any">Any entry signal</option><option value="long">Long entry</option><option value="short">Short entry</option><option value="script-alert">Script alert() call</option></select></Field>
            )}
          </>
        )}
        <Field label="Message (optional)"><input className="input" value={f.message ?? ''} onChange={(e) => p({ message: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-xs text-ink-300"><input type="checkbox" className="accent-gold-500" checked={f.once ?? false} onChange={(e) => p({ once: e.target.checked })} /> Trigger once, then pause</label>
      </div>
    </Modal>
  );
}
