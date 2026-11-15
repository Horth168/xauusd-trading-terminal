/**
 * Dry run: bridge → analysis engine, printed to the console. No Firebase, no notifications.
 * Use it to check your PC setup:  npm run dry-run
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridgeClient } from './bridge';
import { scanStep } from '../src/ai/monitor';
import { reportSummary } from '../src/ai/explain';

const here = dirname(fileURLToPath(import.meta.url));
for (const f of [resolve(here, '.env'), resolve(here, '../mt5-bridge/.env')]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] == null) process.env[m[1]] = m[2];
  }
}
const url = (process.env.BRIDGE_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
const token = process.env.BRIDGE_TOKEN;
if (!token) { console.error('BRIDGE_TOKEN not found (mt5-bridge/.env or scanner/.env)'); process.exit(1); }
const { bridge, loadCandles, loadMarket } = bridgeClient(url, token);

const health = await bridge<{ terminal_connected: boolean; server?: string; symbol: string }>('/health').catch((e) => {
  console.error(`Cannot reach the MT5 bridge at ${url} (${e.cause?.code ?? e.message}). Start mt5-bridge/start-bridge.bat first.`);
  process.exit(3);
});
console.log('bridge:', url, JSON.stringify(health));
if (!health.terminal_connected) { console.error('MT5 terminal is not connected.'); process.exit(2); }
const { market, tickAge } = await loadMarket();
const set = await loadCandles();
console.log(`market: ${market.symbol} bid ${market.bid} ask ${market.ask} spread ${market.spread} (tick ${tickAge}s old, live=${market.live})`);
console.log('candles:', Object.entries(set).map(([tf, b]) => `${tf}=${b!.length}`).join(' '));
const t0 = performance.now();
const r = scanStep(set, market, {}, [], { asOf: market.updatedAt });
console.log(`analysis: ${(performance.now() - t0).toFixed(0)} ms`);
console.log('decision:', r.report.decision, '|', r.report.status, '| score', r.report.score.total);
console.log('summary :', reportSummary(r.report));
for (const a of r.report.agents) console.log(` - ${a.title}: ${a.summary}`);
for (const w of r.report.waitReasons.slice(0, 6)) console.log('   wait:', w);
console.log('dry run OK — nothing was written and no notification was sent.');
