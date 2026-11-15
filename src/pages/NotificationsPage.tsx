import { useEffect, useState } from 'react';
import { Bell, BellOff, CheckCircle2, Copy, Loader2, Send, Server, Smartphone, Trash2, XCircle } from 'lucide-react';
import { PageHeader } from '../components/ui';
import { currentSubscription, disablePush, enablePush, isIOS, isStandalone, pushSupport, testPushDirect, testPushViaScanner } from '../lib/push';
import { useAiConfigLoaded, useAiData } from '../ai/client';
import { removeDoc, useAuth, useCollection, type BaseDoc } from '../lib/db';
import { fmtDateTime } from '../lib/time';
import { useSettings } from '../store/settings';
import type { AnalysisTf } from '../ai/types';
import { BUILTIN_AI_STRATEGIES } from '../ai/strategies';

interface LogDoc extends BaseDoc { title: string; body: string; status: string; type: string; sentAt?: number }
interface DeviceDoc extends BaseDoc { device?: string; endpoint: string }

function Toggle({ on, onChange, label, sub }: { on: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <button onClick={() => onChange(!on)} className="flex w-full items-center gap-3 py-2.5 text-left">
      <span className="min-w-0 flex-1"><span className="block text-sm text-ink-100">{label}</span>{sub && <span className="block text-xs text-ink-400">{sub}</span>}</span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${on ? 'bg-gold-500' : 'bg-ink-600'}`}><span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform duration-200 ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} /></span>
    </button>
  );
}

export default function NotificationsPage() {
  const tz = useSettings((s) => s.timezone);
  const uid = useAuth((s) => s.user?.uid);
  const { cfg, save } = useAiConfigLoaded();
  const { scanner, scannerOnline } = useAiData();
  const devices = useCollection<DeviceDoc>('push_subscriptions');
  const logs = useCollection<LogDoc>('notification_log');
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sup = pushSupport();
  const n = cfg.notify;

  useEffect(() => { currentSubscription().then((s) => setSubscribed(!!s)).catch(() => setSubscribed(false)); }, []);
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); } catch (e: any) { setMsg({ ok: false, text: String(e.message ?? e) }); } finally { setBusy(''); }
  };
  const setN = (patch: Partial<typeof n>) => save({ notify: { ...n, ...patch } });
  const toggleTf = (tf: AnalysisTf) => setN({ timeframes: n.timeframes.includes(tf) ? n.timeframes.filter((x) => x !== tf) : [...n.timeframes, tf] });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Notifications" subtitle="Get BUY/SELL alerts on your phone even when the app is closed. Alerts never place trades." />

      <section className="card p-5">
        <div className="flex items-start gap-4">
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${subscribed ? 'bg-up/15 text-up' : 'bg-white/[0.05] text-ink-300'}`}>{subscribed ? <Bell size={22} /> : <BellOff size={22} />}</span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-ink-100">{subscribed ? 'This device receives notifications' : 'Notifications are off on this device'}</h2>
            <p className="mt-0.5 text-sm text-ink-400">{sup.ok ? (subscribed ? 'Signals from the background scanner will arrive here.' : 'Tap Enable and allow notifications when asked.') : sup.reason}</p>
          </div>
        </div>
        {isIOS() && !isStandalone() && (
          <ol className="mt-4 list-decimal space-y-1 rounded-2xl bg-white/[0.03] p-4 pl-8 text-sm text-ink-300">
            <li>Open this site in <b>Safari</b> (iOS 16.4 or newer).</li><li>Tap <b>Share</b> → <b>Add to Home Screen</b>.</li><li>Open XAU Terminal from the Home Screen icon.</li><li>Come back to this page and tap <b>Enable notifications</b>.</li>
          </ol>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {!subscribed
            ? <button className="btn-gold h-11 px-5" disabled={!sup.ok || !!busy} onClick={() => act('enable', async () => { await enablePush(); setSubscribed(true); }, 'Notifications enabled on this device.')}>{busy === 'enable' ? <Loader2 size={16} className="animate-spin" /> : <Bell size={16} />} Enable notifications</button>
            : <button className="btn h-11" disabled={!!busy} onClick={() => act('disable', async () => { await disablePush(); setSubscribed(false); }, 'Notifications disabled on this device.')}><BellOff size={16} /> Disable on this device</button>}
          {subscribed && <button className="btn h-11" disabled={!!busy} onClick={() => act('test', () => testPushDirect(), 'Test sent — it should appear within a few seconds.')}>{busy === 'test' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Send test</button>}
          {subscribed && <button className="btn h-11" disabled={!!busy} onClick={() => act('test10', () => testPushDirect(15), 'Close the app now — a test arrives in about 15 seconds.')}><Smartphone size={16} /> Test with app closed (15 s)</button>}
          {subscribed && <button className="btn h-11" disabled={!!busy || !scannerOnline} title={scannerOnline ? '' : 'Scanner is offline'} onClick={() => act('scan', testPushViaScanner, 'Requested — the scanner will send it within seconds.')}><Server size={16} /> Test via scanner</button>}
        </div>
        {msg && <p className={`mt-3 flex items-start gap-2 text-sm ${msg.ok ? 'text-up' : 'text-down'}`}>{msg.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}{msg.text}</p>}
      </section>

      <section className="card p-5">
        <h2 className="mb-1 font-semibold text-ink-100">What to notify</h2>
        <div className="divide-y divide-white/5">
          <Toggle on={n.buy} onChange={(v) => setN({ buy: v })} label="BUY signals" />
          <Toggle on={n.sell} onChange={(v) => setN({ sell: v })} label="SELL signals" />
          <Toggle on={n.invalidation} onChange={(v) => setN({ invalidation: v })} label="Signal invalidated" sub="when structure breaks before entry" />
          <Toggle on={n.expiry} onChange={(v) => setN({ expiry: v })} label="Signal expired / missed entry" />
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="block"><span className="label">Minimum evidence score: <b className="text-gold-300">{n.minScore}</b></span><input type="range" min={50} max={95} step={5} value={n.minScore} onChange={(e) => setN({ minScore: Number(e.target.value) })} className="w-full accent-gold-500" /></label>
          <div><span className="label">Timeframes</span><div className="flex gap-1.5">{(['M5', 'M15'] as AnalysisTf[]).map((tf) => <button key={tf} onClick={() => toggleTf(tf)} className={`chip h-9 border border-white/5 px-3 ${n.timeframes.includes(tf) ? 'on' : ''}`}>{tf}</button>)}</div></div>
          <div className="sm:col-span-2"><span className="label">Strategies</span><div className="flex flex-wrap gap-1.5">
            <button onClick={() => setN({ strategies: 'all' })} className={`chip h-9 border border-white/5 px-3 ${n.strategies === 'all' ? 'on' : ''}`}>All</button>
            {BUILTIN_AI_STRATEGIES.map((s) => { const sel = n.strategies !== 'all' && n.strategies.includes(s.id); return <button key={s.id} onClick={() => setN({ strategies: sel ? (n.strategies as string[]).filter((x) => x !== s.id) : [...(n.strategies === 'all' ? [] : n.strategies), s.id] })} className={`chip h-9 border border-white/5 px-3 ${sel ? 'on' : ''}`}>{s.name}</button>; })}
          </div></div>
          <label className="block"><span className="label">Quiet hours from ({tz})</span><input type="time" className="input" value={n.quietStart ?? ''} onChange={(e) => setN({ quietStart: e.target.value || null })} /></label>
          <label className="block"><span className="label">Quiet hours until</span><input type="time" className="input" value={n.quietEnd ?? ''} onChange={(e) => setN({ quietEnd: e.target.value || null })} /></label>
        </div>
        <p className="mt-3 text-[11px] text-ink-400">Only new CONFIRMED signals are pushed, once each. Settings sync to the background scanner within seconds.</p>
      </section>

      <section className="card p-5">
        <h2 className="mb-2 flex items-center gap-2 font-semibold text-ink-100"><Server size={17} /> Background scanner</h2>
        <div className={`rounded-2xl p-3 text-sm ${scannerOnline ? 'bg-up/10 text-up' : 'bg-white/[0.03] text-ink-300'}`}>
          {scannerOnline ? `Online · ${scanner?.server ?? ''} · last scan ${scanner?.lastScan ? fmtDateTime(scanner.lastScan, tz) : '—'} · tracking ${scanner?.activeSignals ?? 0} signal(s)` : `Offline${scanner?.updatedAt ? ` since ${fmtDateTime(scanner.updatedAt, tz)}` : ' — not set up yet'}${scanner?.lastError ? ` · ${scanner.lastError}` : ''}`}
        </div>
        <p className="mt-2 text-xs text-ink-400">The scanner runs on the always-on PC or VPS that runs Exness MT5. Setup: docs/AI-SCANNER.md. Your scanner user id:</p>
        <div className="mt-1 flex items-center gap-2"><code className="flex-1 truncate rounded-lg bg-ink-900 px-2 py-1.5 text-xs text-ink-200">{uid ?? 'sign in first'}</code>{uid && <button className="btn-icon" onClick={() => navigator.clipboard?.writeText(uid)} title="Copy"><Copy size={14} /></button>}</div>
      </section>

      <section className="card p-5">
        <h2 className="mb-2 font-semibold text-ink-100">Devices ({devices.items.length})</h2>
        {devices.items.map((d) => <div key={d.id} className="flex items-center gap-2 border-b border-white/5 py-2 text-sm last:border-0"><Smartphone size={15} className="shrink-0 text-ink-400" /><span className="min-w-0 flex-1 truncate text-ink-200">{d.device ?? d.endpoint.slice(0, 40)}</span><button className="btn-icon hover:text-down" onClick={() => removeDoc('push_subscriptions', d.id)} title="Remove"><Trash2 size={14} /></button></div>)}
        {!devices.items.length && <p className="text-sm text-ink-400">No devices registered yet.</p>}
      </section>

      <section className="card p-5">
        <h2 className="mb-2 font-semibold text-ink-100">Notification log</h2>
        {logs.items.slice(0, 30).map((l) => (
          <div key={l.id} className="border-b border-white/5 py-2 last:border-0">
            <div className="flex items-center gap-2 text-sm"><span className="font-medium text-ink-100">{l.title}</span><span className="ml-auto text-[11px] text-ink-400">{fmtDateTime(l.createdAt ?? 0, tz)}</span></div>
            <div className="text-xs text-ink-400">{l.status}</div>
          </div>
        ))}
        {!logs.items.length && <p className="text-sm text-ink-400">Nothing sent yet.</p>}
      </section>
    </div>
  );
}
