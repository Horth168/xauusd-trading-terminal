import { create } from 'zustand';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { Bar, FeedKind, FeedStatus, SymbolInfo, Tick } from './types';
import { getTimeframe, bucketStart, TIMEFRAMES, type Timeframe } from './timeframes';
import { aggregate, mergeBars, upsertBar } from './aggregate';
import { Mt5Client, MT5_TIMEFRAMES } from './providers/mt5';
import { tdConfigured, tdHistory, TD_TIMEFRAMES, TwelveDataError } from './providers/twelvedata';
import { getSettings, useSettings } from '../store/settings';

interface FeedState {
  status: FeedStatus;
  source: FeedKind | null;
  tick: Tick | null;
  prevBid: number | null;
  symbol: SymbolInfo;
  generation: number; // increments when the data source changes; charts reload on change
  lastUpdate: number | null;
}

const DEFAULT_SYMBOL: SymbolInfo = { symbol: 'XAUUSD', digits: 2, contractSize: 100, point: 0.01 };

export const useFeed = create<FeedState>(() => ({
  status: { state: 'connecting', source: 'mt5' },
  source: null,
  tick: null,
  prevBid: null,
  symbol: DEFAULT_SYMBOL,
  generation: 0,
  lastUpdate: null,
}));

type BarListener = (bar: Bar) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function nativeSet(kind: FeedKind) {
  return new Set(kind === 'mt5' ? MT5_TIMEFRAMES : TD_TIMEFRAMES);
}

/** Pick the native timeframe a (possibly derived/custom) timeframe is aggregated from. */
export function basePlan(tfId: string, kind: FeedKind): { base: Timeframe; target: Timeframe; derived: boolean } {
  const target = getTimeframe(tfId);
  const natives = nativeSet(kind);
  if (natives.has(tfId)) return { base: target, target, derived: false };
  const candidates = TIMEFRAMES.filter((t) => natives.has(t.id) && !t.calendar && target.seconds % t.seconds === 0 && t.seconds < target.seconds);
  const base = candidates.sort((a, b) => b.seconds - a.seconds)[0];
  if (!base) throw new Error(`Cannot build ${tfId} from ${kind} data`);
  return { base, target, derived: true };
}

class FeedManager {
  private kind: FeedKind | null = null;
  private mt5: Mt5Client | null = null;
  private stream: ReturnType<Mt5Client['stream']> | null = null;
  private base = new Map<string, Bar[]>(); // native tf -> bars (memory)
  private listeners = new Map<string, Set<BarListener>>(); // target tf -> listeners
  private pollTimers = new Map<string, number>();
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private probeTimer: number | null = null;
  private started = false;
  private exhausted = new Set<string>(); // native tfs with no older history

  start() {
    if (this.started) return;
    this.started = true;
    window.addEventListener('online', () => this.restart());
    window.addEventListener('offline', () => {
      this.teardown();
      useFeed.setState({ status: { state: 'offline', source: this.kind, detail: 'Device is offline — no live prices. Chart shows the last loaded history.' } });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.kind === 'twelvedata') this.pollAllNow();
    });
    let prev = getSettings();
    useSettings.subscribe((s) => {
      if (s.feedMode !== prev.feedMode || s.bridgeUrl !== prev.bridgeUrl || s.bridgeToken !== prev.bridgeToken || s.pollSeconds !== prev.pollSeconds) {
        prev = s;
        this.restart();
      }
    });
    this.restart();
  }

  private teardown() {
    this.stream?.close();
    this.stream = null;
    for (const t of this.pollTimers.values()) clearInterval(t);
    this.pollTimers.clear();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.probeTimer) clearInterval(this.probeTimer);
    this.reconnectTimer = this.probeTimer = null;
  }

  async restart() {
    this.teardown();
    if (!navigator.onLine) {
      useFeed.setState({ status: { state: 'offline', source: null, detail: 'Device is offline — no live prices.' } });
      return;
    }
    const s = getSettings();
    useFeed.setState({ status: { state: 'connecting', source: s.feedMode === 'twelvedata' ? 'twelvedata' : 'mt5' } });
    if (s.feedMode !== 'twelvedata') {
      const ok = await this.tryMt5();
      if (ok) return;
      if (s.feedMode === 'mt5') {
        this.scheduleMt5Reconnect();
        return;
      }
    }
    await this.useTwelveData();
    if (s.feedMode === 'auto') this.startMt5Probe();
  }

  private async tryMt5(): Promise<boolean> {
    const s = getSettings();
    const client = new Mt5Client(s.bridgeUrl, s.bridgeToken);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const h = await client.health(ctrl.signal);
      clearTimeout(t);
      if (!h.terminal_connected) throw new Error('MT5 terminal not connected');
      const info = await client.symbolInfo();
      this.mt5 = client;
      this.switchSource('mt5');
      useFeed.setState({ symbol: info });
      this.openStream();
      return true;
    } catch {
      return false;
    }
  }

  private openStream() {
    if (!this.mt5) return;
    const tfs = this.subscribedBases();
    this.stream = this.mt5.stream(tfs, {
      onOpen: (info) => {
        this.reconnectAttempt = 0;
        useFeed.setState({ status: { state: 'live', source: 'mt5', detail: `Exness MT5 · ${info.server ?? ''} · ${info.symbol}` } });
      },
      onTick: (tick) => {
        const prev = useFeed.getState().tick;
        useFeed.setState({ tick, prevBid: prev?.bid ?? null, lastUpdate: Date.now() });
      },
      onBar: (tf, bar) => this.ingest(tf, bar),
      onClose: (reason) => {
        this.stream = null;
        this.scheduleMt5Reconnect(reason);
      },
    });
  }

  private scheduleMt5Reconnect(reason = 'bridge unreachable') {
    const s = getSettings();
    this.reconnectAttempt++;
    if (s.feedMode === 'auto' && this.reconnectAttempt > 3) {
      // Fall back to the hosted feed but keep probing for the bridge.
      this.reconnectAttempt = 0;
      this.useTwelveData().then(() => this.startMt5Probe());
      return;
    }
    const delay = Math.min(30000, 1000 * 2 ** this.reconnectAttempt);
    useFeed.setState({ status: { state: 'reconnecting', source: 'mt5', attempt: this.reconnectAttempt, detail: `MT5 bridge: ${reason}. Retrying in ${Math.round(delay / 1000)}s` } });
    this.reconnectTimer = window.setTimeout(async () => {
      const ok = await this.tryMt5();
      if (!ok) this.scheduleMt5Reconnect(reason);
    }, delay);
  }

  private startMt5Probe() {
    if (this.probeTimer) clearInterval(this.probeTimer);
    this.probeTimer = window.setInterval(async () => {
      const s = getSettings();
      const client = new Mt5Client(s.bridgeUrl, s.bridgeToken);
      try {
        const h = await client.health(AbortSignal.timeout(2000));
        if (h.terminal_connected) this.restart();
      } catch {
        /* still unavailable */
      }
    }, 30000);
  }

  private async useTwelveData() {
    for (const t of this.pollTimers.values()) clearInterval(t);
    this.pollTimers.clear();
    const configured = await tdConfigured();
    if (!configured) {
      this.switchSource(null);
      useFeed.setState({
        status: { state: 'offline', source: null, detail: 'No data source. Start the MT5 bridge (Settings → Data feed) or set TWELVEDATA_API_KEY on Vercel.' },
      });
      return;
    }
    this.switchSource('twelvedata');
    useFeed.setState({ symbol: { ...DEFAULT_SYMBOL, symbol: 'XAU/USD' } });
    this.setTdStatus();
    for (const tf of this.subscribedBases()) this.startPoll(tf);
  }

  private setTdStatus(extra = '') {
    const s = getSettings();
    useFeed.setState({
      status: { state: 'delayed', source: 'twelvedata', detail: `Twelve Data spot XAU/USD (not Exness) · polled every ${s.pollSeconds}s${extra}` },
    });
  }

  private switchSource(kind: FeedKind | null) {
    if (kind !== this.kind) {
      this.kind = kind;
      this.base.clear();
      this.exhausted.clear();
      useFeed.setState((st) => ({ source: kind, generation: st.generation + 1, tick: null, prevBid: null }));
    }
  }

  private subscribedBases(): string[] {
    if (!this.kind) return [];
    const set = new Set<string>();
    for (const tf of this.listeners.keys()) {
      if ((this.listeners.get(tf)?.size ?? 0) === 0) continue;
      try {
        set.add(basePlan(tf, this.kind).base.id);
      } catch {
        /* unsupported */
      }
    }
    return [...set];
  }

  private refreshSubscriptions() {
    const bases = this.subscribedBases();
    if (this.kind === 'mt5') this.stream?.subscribe(bases);
    if (this.kind === 'twelvedata') {
      for (const [tf, t] of this.pollTimers) if (!bases.includes(tf)) { clearInterval(t); this.pollTimers.delete(tf); }
      for (const tf of bases) if (!this.pollTimers.has(tf)) this.startPoll(tf);
    }
  }

  private startPoll(tf: string) {
    const s = getSettings();
    const run = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const bars = await tdHistory(tf, { outputsize: 2 });
        for (const b of bars) this.ingest(tf, b);
        const last = bars[bars.length - 1];
        if (last) useFeed.setState((st) => ({ tick: { time: Date.now(), bid: last.close }, prevBid: st.tick?.bid ?? null, lastUpdate: Date.now() }));
        this.setTdStatus();
      } catch (e) {
        if (e instanceof TwelveDataError && e.status === 429) this.setTdStatus(' · rate-limited, waiting');
      }
    };
    this.pollTimers.set(tf, window.setInterval(run, Math.max(15, s.pollSeconds) * 1000));
  }

  private pollAllNow() {
    for (const tf of this.pollTimers.keys()) {
      tdHistory(tf, { outputsize: 2 }).then((bars) => bars.forEach((b) => this.ingest(tf, b))).catch(() => {});
    }
  }

  /** Apply a native bar update and notify listeners of every timeframe derived from it. */
  private ingest(baseTf: string, bar: Bar) {
    const series = this.base.get(baseTf);
    if (series) upsertBar(series, bar);
    for (const [tfId, ls] of this.listeners) {
      if (!ls.size || !this.kind) continue;
      let plan;
      try { plan = basePlan(tfId, this.kind); } catch { continue; }
      if (plan.base.id !== baseTf) continue;
      let out = bar;
      if (plan.derived) {
        const start = bucketStart(bar.time, plan.target);
        const src = (series ?? [bar]).filter((b) => b.time >= start && b.time < start + plan.target.seconds);
        out = aggregate(src, plan.target)[0] ?? bar;
      }
      ls.forEach((l) => l(out));
    }
  }

  subscribe(tfId: string, l: BarListener): () => void {
    if (!this.listeners.has(tfId)) this.listeners.set(tfId, new Set());
    this.listeners.get(tfId)!.add(l);
    this.refreshSubscriptions();
    return () => {
      this.listeners.get(tfId)?.delete(l);
      this.refreshSubscriptions();
    };
  }

  get currentKind() {
    return this.kind;
  }

  private async fetchNative(tf: string, opts: { count: number; end?: number }): Promise<Bar[]> {
    if (this.kind === 'mt5' && this.mt5) return this.mt5.history(tf, { count: opts.count, end: opts.end });
    if (this.kind === 'twelvedata') return tdHistory(tf, { outputsize: Math.min(5000, opts.count), end: opts.end });
    throw new Error('No data source connected');
  }

  /** Initial chart data: the most recent `count` bars of the requested timeframe. */
  async load(tfId: string, count = 1500): Promise<Bar[]> {
    if (!this.kind) throw new Error('No data source connected');
    const { base, target, derived } = basePlan(tfId, this.kind);
    const ratio = derived ? Math.ceil(target.seconds / base.seconds) : 1;
    const needed = Math.min(this.kind === 'mt5' ? 50000 : 5000, count * ratio);
    let series = this.base.get(base.id);
    if (!series || series.length < needed) {
      const fetched = await this.fetchNative(base.id, { count: needed });
      series = mergeBars(series ?? [], fetched);
      this.base.set(base.id, series);
    }
    return derived ? aggregate(series, target) : series.slice();
  }

  /** Load older history (scrolling left). Returns the full series for the timeframe. */
  async loadOlder(tfId: string, count = 1500): Promise<Bar[] | null> {
    if (!this.kind) return null;
    const { base, target, derived } = basePlan(tfId, this.kind);
    if (this.exhausted.has(base.id)) return null;
    const series = this.base.get(base.id);
    if (!series?.length) return null;
    const ratio = derived ? Math.ceil(target.seconds / base.seconds) : 1;
    const older = await this.fetchNative(base.id, { count: Math.min(this.kind === 'mt5' ? 50000 : 5000, count * ratio), end: series[0].time - 1 });
    const fresh = older.filter((b) => b.time < series[0].time);
    if (!fresh.length) {
      this.exhausted.add(base.id);
      return null;
    }
    const merged = mergeBars(fresh, series);
    this.base.set(base.id, merged);
    return derived ? aggregate(merged, target) : merged.slice();
  }

  /**
   * Historical range for backtests. Cached in IndexedDB per source/timeframe so repeated runs are fast.
   * onProgress reports human-readable progress.
   */
  async range(tfId: string, from: number, to: number, onProgress?: (msg: string) => void): Promise<{ bars: Bar[]; source: FeedKind }> {
    if (!this.kind) throw new Error('No data source connected. Start the MT5 bridge or configure Twelve Data.');
    const kind = this.kind;
    const { base, target, derived } = basePlan(tfId, kind);
    const key = `bars:${kind}:${base.id}`;
    let cached: Bar[] = (await idbGet(key)) ?? [];
    const have = (t0: number, t1: number) => cached.length > 0 && cached[0].time <= t0 && cached[cached.length - 1].time >= t1 - base.seconds * 2;

    if (!have(from, Math.min(to, Date.now() / 1000 - base.seconds))) {
      if (kind === 'mt5' && this.mt5) {
        onProgress?.(`Downloading ${base.id} from Exness MT5…`);
        const bars = await this.mt5.history(base.id, { start: from, end: to });
        cached = mergeBars(cached, bars);
      } else {
        // Twelve Data: page backwards 5000 bars at a time (free plan: 8 requests/minute).
        let end = to;
        let page = 0;
        while (end > from) {
          page++;
          onProgress?.(`Downloading ${base.id} page ${page} from Twelve Data…`);
          let bars: Bar[];
          try {
            bars = await tdHistory(base.id, { outputsize: 5000, start: from, end });
          } catch (e) {
            if (e instanceof TwelveDataError && e.status === 429) {
              onProgress?.('Twelve Data rate limit reached — waiting 60s…');
              await sleep(61000);
              continue;
            }
            throw e;
          }
          if (!bars.length) break;
          cached = mergeBars(cached, bars);
          if (bars[0].time <= from || bars.length < 5000) break;
          end = bars[0].time - 1;
          await sleep(8000);
        }
      }
      await idbSet(key, cached.slice(-400000));
    }
    const slice = cached.filter((b) => b.time >= from && b.time <= to);
    return { bars: derived ? aggregate(slice, target) : slice, source: kind };
  }

  mt5Client() {
    const s = getSettings();
    return new Mt5Client(s.bridgeUrl, s.bridgeToken);
  }
}

export const feed = new FeedManager();
