/**
 * XAUUSD AI background scanner — runs 24/5 on the machine that runs Exness MT5 + mt5-bridge.
 *
 *   mt5-bridge (read-only)  →  src/ai engine (same code as app & backtester)  →  Firestore  →  Web Push
 *
 * It works without any browser open. It NEVER places, modifies or closes orders: the bridge exposes no such API
 * and this service only reads prices and writes analysis records/notifications.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import webpush from 'web-push';
import { scanStep, shouldNotify, type ScanEvent } from '../src/ai/monitor';
import { bridgeClient } from './bridge';
import { mergeConfig, type AiConfig } from '../src/ai/config';
import { notificationText, lifecycleText, reportSummary } from '../src/ai/explain';
import { scriptStrategy, type StrategyDef } from '../src/ai/strategies';
import type { SignalRecord } from '../src/ai/types';

const here = dirname(fileURLToPath(import.meta.url));
const VERSION = '1.0.0';

// ---------------- env ----------------
function loadEnv(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] == null) process.env[m[1]] = m[2];
  }
}
loadEnv(resolve(here, '.env'));
loadEnv(resolve(here, '../mt5-bridge/.env')); // reuse the bridge token so it is never copied around
const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v == null || v === '') throw new Error(`Missing ${k} in scanner/.env (see scanner/.env.example)`);
  return v;
};

const BRIDGE_URL = env('BRIDGE_URL', 'http://127.0.0.1:8765').replace(/\/$/, '');
const BRIDGE_TOKEN = env('BRIDGE_TOKEN');
const UID = env('SCANNER_UID');
const APP_URL = env('APP_URL', 'https://xauusd-trading-terminal.vercel.app');
const HEALTH_PORT = Number(env('HEALTH_PORT', '8770'));

// ---------------- Firebase (service account stays on this machine) ----------------
const saPath = resolve(here, env('FIREBASE_SERVICE_ACCOUNT', './service-account.json'));
if (!existsSync(saPath)) throw new Error(`Service account file not found at ${saPath}. Download it from Firebase Console → Project settings → Service accounts.`);
const sa = JSON.parse(readFileSync(saPath, 'utf8'));
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore();
const userDoc = db.collection('xau_users').doc(UID);
const col = (name: string) => userDoc.collection(name);

webpush.setVapidDetails(env('VAPID_SUBJECT', 'mailto:alerts@example.com'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));

// ---------------- bridge client (read-only endpoints) ----------------
const { bridge, loadCandles, loadMarket } = bridgeClient(BRIDGE_URL, BRIDGE_TOKEN);

// ---------------- state ----------------
let cfg: AiConfig = mergeConfig(null);
let extra: StrategyDef[] = [];
let active: SignalRecord[] = [];
const status: Record<string, unknown> = { version: VERSION, startedAt: Date.now(), online: true, bridge: 'unknown', lastScan: null, lastError: null, lastDecision: null };
let lastReportKey = '';
let lastHeartbeat = 0;
let busy = false;

const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'number' && !Number.isFinite(x) ? null : x === undefined ? null : x)));
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

// live config + custom strategies from the app
userDoc.collection('settings').doc('ai').onSnapshot((s) => {
  cfg = mergeConfig((s.data()?.data as Partial<AiConfig>) ?? null);
  log('config loaded', `minScore=${cfg.minScore} minRR=${cfg.minRR} entryTf=${cfg.entryTf}`);
}, (e) => log('config listener error', e.message));
col('indicators').onSnapshot((snap) => {
  extra = snap.docs.map((d) => d.data()).filter((d) => d.kind === 'strategy' && cfg.strategies[`custom:${d.id}`]?.enabled)
    .map((d) => scriptStrategy(d.id, d.name, d.code));
}, (e) => log('scripts listener error', e.message));

async function loadActive() {
  const snap = await col('ai_signals').where('outcome', 'in', ['PENDING_ENTRY', 'OPEN', 'TP1_HIT']).get();
  active = snap.docs.map((d) => d.data() as SignalRecord).filter((s) => s.status === 'CONFIRMED');
  log(`tracking ${active.length} active signal(s)`);
}

// ---------------- push ----------------
interface SubDoc { id: string; endpoint: string; keys: { p256dh: string; auth: string } }

async function sendToAll(payload: { title: string; body: string; url: string; tag: string }) {
  const subs = (await col('push_subscriptions').get()).docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SubDoc, 'id'>) }));
  const results: { device: string; status: number | string }[] = [];
  for (const s of subs) {
    let attempt = 0, done = false;
    while (!done && attempt < 3) {
      attempt++;
      try {
        const r = await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 1800, urgency: 'high', topic: payload.tag.slice(0, 32).replace(/[^A-Za-z0-9_-]/g, '') });
        results.push({ device: s.id.slice(0, 8), status: r.statusCode }); done = true;
      } catch (e: any) {
        const code = e?.statusCode ?? 'error';
        if (code === 404 || code === 410) { await col('push_subscriptions').doc(s.id).delete(); results.push({ device: s.id.slice(0, 8), status: `${code} removed` }); done = true; }
        else if (attempt >= 3) results.push({ device: s.id.slice(0, 8), status: String(code) });
        else await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }
  return { results, devices: subs.length };
}

async function notify(e: ScanEvent) {
  const decision = shouldNotify(e, cfg);
  const logRef = col('notification_log').doc(e.key);
  const text = e.type === 'confirmed' ? notificationText(e.signal) : lifecycleText(e.signal);
  // Duplicate prevention: the log document id is the event key; create() fails if it was already sent.
  try {
    await logRef.create(clean({ id: e.key, key: e.key, type: e.type, signalId: e.signal.id, title: text.title, body: text.body, createdAt: Math.floor(Date.now() / 1000), status: decision.ok ? 'sending' : `skipped: ${decision.reason}` }));
  } catch { return; } // already handled
  if (!decision.ok) return;
  const { results, devices } = await sendToAll({ ...text, url: `${APP_URL}/signals/${encodeURIComponent(e.signal.id)}`, tag: e.signal.id });
  await logRef.update(clean({ status: devices ? 'sent' : 'no devices', results, sentAt: Math.floor(Date.now() / 1000) }));
  if (e.type === 'confirmed') await col('ai_signals').doc(e.signal.id).set({ notified: true }, { merge: true });
  log(`push ${e.type} ${e.signal.id} → ${devices} device(s)`, JSON.stringify(results));
}

// test notifications requested from the app (Notifications page → "Send test")
col('push_requests').where('status', '==', 'pending').onSnapshot(async (snap) => {
  for (const d of snap.docs) {
    await d.ref.update({ status: 'sending' });
    const r = await sendToAll({ title: 'XAUUSD Analyst — test', body: 'Background notifications are working. This was sent by your scanner, not the browser.', url: `${APP_URL}/notifications`, tag: `test-${d.id}` });
    await d.ref.update(clean({ status: 'done', results: r.results, devices: r.devices, doneAt: Math.floor(Date.now() / 1000) }));
  }
}, (e) => log('push request listener error', e.message));

// ---------------- scan loop ----------------
async function heartbeat(extraFields: Record<string, unknown> = {}) {
  Object.assign(status, extraFields);
  if (Date.now() - lastHeartbeat < 20_000 && !extraFields.force) return;
  lastHeartbeat = Date.now();
  await col('ai_status').doc('scanner').set(clean({ id: 'scanner', createdAt: Math.floor(Date.now() / 1000), ...status, updatedAt: Math.floor(Date.now() / 1000) }), { merge: true });
}

async function scan() {
  if (busy) return;
  busy = true;
  try {
    const health = await bridge<{ terminal_connected: boolean; server?: string; symbol: string }>('/health', 5000);
    if (!health.terminal_connected) { await heartbeat({ bridge: 'terminal disconnected', live: false }); return; }
    const { market, tickAge } = await loadMarket();
    const now = market.updatedAt;
    const set = await loadCandles();
    const r = scanStep(set, market, cfg, active, { asOf: now, extraStrategies: extra });
    // persist signal changes
    const batch = db.batch();
    for (const c of r.changed) batch.set(col('ai_signals').doc(c.id), clean(c), { merge: true });
    if (r.created) batch.set(col('ai_signals').doc(r.created.id), clean(r.created));
    // latest report (only when something meaningful changed) + archive of confirmed reports
    const key = `${r.report.barTime}|${r.report.status}|${r.report.decision}|${r.report.strategy}`;
    if (key !== lastReportKey) {
      lastReportKey = key;
      const doc = clean({ ...r.report, id: 'latest', reportId: r.report.id, summary: reportSummary(r.report) });
      batch.set(col('ai_reports').doc('latest'), doc);
      if (r.report.status === 'CONFIRMED') batch.set(col('ai_reports').doc(r.report.id), clean({ ...r.report, summary: reportSummary(r.report) }));
    }
    await batch.commit();
    active = active.map((s) => r.changed.find((c) => c.id === s.id) ?? s).filter((s) => s.status === 'CONFIRMED' && ['PENDING_ENTRY', 'OPEN', 'TP1_HIT'].includes(s.outcome));
    if (r.created) active.push(r.created);
    for (const e of r.events) await notify(e);
    await heartbeat({ bridge: 'connected', live: market.live, server: market.server, lastScan: now, lastDecision: r.report.decision, lastStatus: r.report.status, lastBarTime: r.report.barTime, lastError: null, activeSignals: active.length, tickAgeSec: tickAge });
    if (r.created) log(`CONFIRMED ${r.created.side} ${r.created.strategyName} score ${r.created.score.total}`);
  } catch (e: any) {
    log('scan error:', e.message);
    await heartbeat({ bridge: /bridge/.test(e.message) || e.name === 'TimeoutError' || e.cause ? 'unreachable' : status.bridge, lastError: String(e.message).slice(0, 300), live: false }).catch(() => {});
  } finally {
    busy = false;
  }
}

// ---------------- health endpoint (local only) ----------------
createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, ...status, active: active.length }));
}).listen(HEALTH_PORT, '127.0.0.1');

async function main() {
  if (process.argv.includes('--test-push')) {
    const r = await sendToAll({ title: 'XAUUSD Analyst — test', body: 'Test from the scanner command line.', url: `${APP_URL}/notifications`, tag: 'cli-test' });
    log('test push', JSON.stringify(r));
    process.exit(0);
  }
  log(`XAUUSD AI scanner ${VERSION} — bridge ${BRIDGE_URL}, user ${UID.slice(0, 6)}…, health http://127.0.0.1:${HEALTH_PORT}/health`);
  log('Analysis only: this service never places, modifies or closes trades.');
  await loadActive();
  await heartbeat({ force: true, online: true });
  await scan();
  const loop = async () => { await scan(); setTimeout(loop, Math.max(10, cfg.scanIntervalSec) * 1000); };
  setTimeout(loop, Math.max(10, cfg.scanIntervalSec) * 1000);
}
process.on('SIGINT', async () => { await heartbeat({ force: true, online: false }).catch(() => {}); process.exit(0); });
main().catch((e) => { console.error(e); process.exit(1); });

