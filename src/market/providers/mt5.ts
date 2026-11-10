import type { Bar, SymbolInfo, Tick } from '../types';

/**
 * Client for the local MT5 bridge (mt5-bridge/bridge.py). The bridge reads the Exness MT5 terminal via the
 * official MetaTrader5 Python package. It is read-only: it cannot place orders.
 */
export const MT5_TIMEFRAMES = ['M1', 'M2', 'M3', 'M5', 'M10', 'M15', 'M30', 'H1', 'H2', 'H4', 'H6', 'H8', 'H12', 'D1', 'W1', 'MN1'];

export interface Mt5Handlers {
  onTick: (t: Tick) => void;
  onBar: (tf: string, bar: Bar) => void;
  onOpen: (info: { symbol: string; server?: string }) => void;
  onClose: (reason: string) => void;
}

export interface Mt5Position {
  position_id: number;
  type: 'buy' | 'sell';
  symbol: string;
  volume: number;
  open_time: number;
  close_time: number;
  open_price: number;
  close_price: number;
  sl: number;
  tp: number;
  profit: number;
  commission: number;
  swap: number;
  fee: number;
  comment: string;
}

export interface Mt5Balance {
  deal_id: number;
  time: number;
  amount: number;
  comment: string;
}

export class Mt5Client {
  constructor(private baseUrl: string, private token: string) {}

  private headers(): HeadersInit | undefined {
    return this.token ? { Authorization: `Bearer ${this.token}` } : undefined;
  }

  private url(path: string) {
    return `${this.baseUrl.replace(/\/$/, '')}${path}`;
  }

  async health(signal?: AbortSignal): Promise<{ ok: boolean; symbol: string; server?: string; terminal_connected: boolean }> {
    const r = await fetch(this.url('/health'), { headers: this.headers(), signal });
    if (!r.ok) throw new Error(`Bridge HTTP ${r.status}`);
    return r.json();
  }

  async symbolInfo(): Promise<SymbolInfo> {
    const r = await fetch(this.url('/symbol'), { headers: this.headers() });
    if (!r.ok) throw new Error(`Bridge HTTP ${r.status}`);
    const j = await r.json();
    return {
      symbol: j.name,
      digits: j.digits,
      contractSize: j.trade_contract_size,
      point: j.point,
      spreadPoints: j.spread,
      description: j.description,
      server: j.server,
    };
  }

  /** Either a range (start+end) or the `count` bars ending at `end` (default: now). */
  async history(tf: string, opts: { start?: number; end?: number; count?: number }): Promise<Bar[]> {
    const q = new URLSearchParams({ timeframe: tf });
    if (opts.start != null) q.set('start', String(Math.floor(opts.start)));
    if (opts.end != null) q.set('end', String(Math.floor(opts.end)));
    if (opts.count != null) q.set('count', String(Math.floor(opts.count)));
    const r = await fetch(this.url(`/history?${q}`), { headers: this.headers() });
    if (!r.ok) throw new Error(`Bridge history HTTP ${r.status}: ${await r.text()}`);
    const j = await r.json();
    return (j.bars as any[]).map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.tick_volume }));
  }

  /** Closed positions and balance operations (deposits/withdrawals) from the MT5 account history. */
  async accountHistory(from: number, to: number): Promise<{ positions: Mt5Position[]; balance: Mt5Balance[] }> {
    const r = await fetch(this.url(`/deals?start=${Math.floor(from)}&end=${Math.floor(to)}`), { headers: this.headers() });
    if (!r.ok) throw new Error(`Bridge deals HTTP ${r.status}: ${await r.text()}`);
    return r.json();
  }

  /** Opens the WebSocket stream. Reconnect policy lives in the FeedManager. */
  stream(tfs: string[], h: Mt5Handlers) {
    const wsUrl = this.url(`/stream?token=${encodeURIComponent(this.token)}`).replace(/^http/, 'ws');
    const ws = new WebSocket(wsUrl);
    let lastMsg = Date.now();
    let closed = false;
    const watchdog = setInterval(() => {
      if (Date.now() - lastMsg > 15000) ws.close(4000, 'heartbeat timeout');
    }, 5000);
    ws.onopen = () => ws.send(JSON.stringify({ subscribe: tfs }));
    ws.onmessage = (ev) => {
      lastMsg = Date.now();
      const msg = JSON.parse(ev.data);
      if (msg.type === 'hello') h.onOpen({ symbol: msg.symbol, server: msg.server });
      else if (msg.type === 'tick') h.onTick({ time: msg.time_msc, bid: msg.bid, ask: msg.ask, last: msg.last });
      else if (msg.type === 'bar') {
        const b = msg.bar;
        h.onBar(msg.timeframe, { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.tick_volume });
      }
    };
    ws.onclose = (ev) => {
      clearInterval(watchdog);
      if (!closed) h.onClose(ev.reason || `connection closed (${ev.code})`);
    };
    return {
      subscribe: (list: string[]) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ subscribe: list }));
      },
      close: () => {
        closed = true;
        clearInterval(watchdog);
        ws.close();
      },
    };
  }
}
