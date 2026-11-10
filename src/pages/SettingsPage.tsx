import { useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import { CheckCircle2, CloudUpload, Loader2, LogOut, PlugZap, XCircle } from 'lucide-react';
import { Field, PageHeader, Segmented } from '../components/ui';
import { FeedBadge } from '../components/FeedStatus';
import { useSettings } from '../store/settings';
import { feed, useFeed } from '../market/feed';
import { Mt5Client } from '../market/providers/mt5';
import { tdConfigured } from '../market/providers/twelvedata';
import { TIMEZONES } from '../lib/time';
import { auth, firebaseConfig, firebaseEnabled } from '../lib/firebase';
import { cloudActive, localCounts, migrateLocalToCloud, useAuth } from '../lib/db';

export default function SettingsPage() {
  const s = useSettings();
  const user = useAuth((a) => a.user);
  const symbol = useFeed((f) => f.symbol);
  const [url, setUrl] = useState(s.bridgeUrl);
  const [token, setToken] = useState(s.bridgeToken);
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [td, setTd] = useState<boolean | null>(null);
  const [mig, setMig] = useState('');
  const counts = localCounts();
  const localTotal = Object.values(counts).reduce((a, b) => a + b, 0);

  useEffect(() => { tdConfigured().then(setTd); }, []);

  const testBridge = async () => {
    setTesting(true); setTest(null);
    try {
      const c = new Mt5Client(url, token);
      const h = await c.health(AbortSignal.timeout(4000));
      if (!h.terminal_connected) setTest({ ok: false, msg: 'Bridge reachable, but the MT5 terminal is not connected. Open MetaTrader 5 and log in to Exness.' });
      else {
        const info = await c.symbolInfo();
        setTest({ ok: true, msg: `Connected to ${h.server} · ${info.symbol} · ${info.digits} digits · contract ${info.contractSize} · spread ${info.spreadPoints} pts` });
      }
    } catch (e: any) {
      setTest({ ok: false, msg: `${e.message}. Is bridge.py running? From this HTTPS site Chrome/Edge can reach http://127.0.0.1; on iPhone use a Cloudflare Tunnel https URL.` });
    } finally { setTesting(false); }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Settings" />

      <section className="card space-y-3 p-4">
        <div className="flex items-center justify-between"><h2 className="font-semibold text-ink-100">Market data feed</h2><FeedBadge compact /></div>
        <Field label="Source">
          <Segmented value={s.feedMode} onChange={(v) => s.set({ feedMode: v })} options={[{ value: 'auto', label: 'Auto (MT5 → fallback)' }, { value: 'mt5', label: 'Exness MT5 only' }, { value: 'twelvedata', label: 'Twelve Data only' }]} />
        </Field>
        <div className="rounded-lg border border-ink-700 bg-ink-900 p-3 text-xs text-ink-300">
          <p className="mb-2 font-semibold text-ink-100">Exness MT5 bridge — exact Exness prices, live bid/ask, tick volume</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Field label="Bridge URL"><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:8765" /></Field>
            <Field label="Bridge token"><input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="printed by bridge.py" /></Field>
            <div className="flex items-end gap-1">
              <button className="btn" onClick={testBridge} disabled={testing}>{testing ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} Test</button>
              <button className="btn-gold" onClick={() => s.set({ bridgeUrl: url.trim(), bridgeToken: token.trim() })}>Save</button>
            </div>
          </div>
          {test && <p className={`mt-2 flex items-start gap-1.5 ${test.ok ? 'text-up' : 'text-down'}`}>{test.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}{test.msg}</p>}
          <p className="mt-2 text-ink-400">The token is stored only on this device. The bridge is read-only and cannot trade. See docs/MT5-BRIDGE.md for setup.</p>
        </div>
        <div className="rounded-lg border border-ink-700 bg-ink-900 p-3 text-xs text-ink-300">
          <p className="font-semibold text-ink-100">Twelve Data fallback — {td == null ? 'checking…' : td ? <span className="text-up">configured on server</span> : <span className="text-down">not configured</span>}</p>
          <p className="mt-1 text-ink-400">Spot XAU/USD from Twelve Data, labelled DELAYED. Prices differ slightly from Exness; no bid/ask or volume. The API key lives only in Vercel's server environment (TWELVEDATA_API_KEY).</p>
          <Field label="Poll interval (seconds)" className="mt-2 max-w-[200px]" hint="Free plan: 800 requests/day per key">
            <input type="number" min={15} className="input" value={s.pollSeconds} onChange={(e) => s.set({ pollSeconds: Math.max(15, Number(e.target.value)) })} />
          </Field>
        </div>
        <button className="btn" onClick={() => feed.restart()}>Reconnect now</button>
      </section>

      <section className="card grid gap-3 p-4 sm:grid-cols-2">
        <h2 className="font-semibold text-ink-100 sm:col-span-2">Chart & trading</h2>
        <Field label="Timezone (chart labels, sessions, journal days)"><select className="input" value={s.timezone} onChange={(e) => s.set({ timezone: e.target.value })}>{TIMEZONES.map((z) => <option key={z.id} value={z.id}>{z.label} ({z.id})</option>)}</select></Field>
        <Field label="XAUUSD contract size (oz per lot)" hint={`Broker reports: ${symbol.contractSize}`}><input type="number" className="input" value={s.contractSize} onChange={(e) => s.set({ contractSize: Number(e.target.value) })} /></Field>
        <Field label="KHR per USD (display & default rate)"><input type="number" className="input" value={s.khrPerUsd} onChange={(e) => s.set({ khrPerUsd: Number(e.target.value) })} /></Field>
      </section>

      <section className="card space-y-2 p-4 text-sm">
        <h2 className="font-semibold text-ink-100">Account & cloud storage</h2>
        {!firebaseEnabled ? (
          <p className="text-xs text-gold-300">Local mode: Firebase web config is not set, so records are stored only in this browser. Add the VITE_FIREBASE_* variables on Vercel to enable sign-in, sync and screenshot storage.</p>
        ) : (
          <>
            <p className="text-xs text-ink-300">Signed in as <b>{user?.email}</b> · project <code>{firebaseConfig.projectId}</code> · {cloudActive() ? 'syncing with Firestore (offline cache on)' : 'not syncing'}</p>
            {localTotal > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-ink-400">{localTotal} records exist in local mode on this device.</span>
                <button className="btn py-1 text-xs" onClick={async () => { try { setMig(`Uploaded ${await migrateLocalToCloud()} records.`); } catch (e: any) { setMig(e.message); } }}><CloudUpload size={14} /> Upload to cloud</button>
                {mig && <span>{mig}</span>}
              </div>
            )}
            <button className="btn" onClick={() => signOut(auth!)}><LogOut size={14} /> Sign out</button>
          </>
        )}
      </section>
    </div>
  );
}
