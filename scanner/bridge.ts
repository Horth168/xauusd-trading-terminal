/** Read-only client for mt5-bridge. Only GET endpoints exist on the bridge; nothing here can trade. */
import type { AnalysisTf, CandleSet, MarketSnapshot } from '../src/ai/types';
import type { Bar } from '../src/market/types';

export const COUNTS: Record<AnalysisTf, number> = { M1: 600, M5: 500, M15: 400, H1: 400, H4: 400 };

export function bridgeClient(baseUrl: string, token: string) {
  async function bridge<T>(path: string, timeoutMs = 8000): Promise<T> {
    const r = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error(`bridge ${path} → HTTP ${r.status}${r.status === 404 && path === '/tick' ? ' (restart mt5-bridge to load the new /tick endpoint)' : ''}`);
    return r.json() as Promise<T>;
  }
  async function loadCandles(): Promise<CandleSet> {
    const set: CandleSet = {};
    await Promise.all((Object.keys(COUNTS) as AnalysisTf[]).map(async (tf) => {
      const j = await bridge<{ bars: { time: number; open: number; high: number; low: number; close: number; tick_volume: number }[] }>(`/history?timeframe=${tf}&count=${COUNTS[tf]}`);
      set[tf] = j.bars.map((b): Bar => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.tick_volume }));
    }));
    return set;
  }
  /** Live market snapshot. Ticks older than 5 minutes are not "live" (market closed or feed stalled). */
  async function loadMarket(): Promise<{ market: MarketSnapshot; tickAge: number }> {
    const t = await bridge<{ bid: number; ask: number; spread: number; digits: number; time_msc: number; server: string; symbol: string }>('/tick');
    const now = Math.floor(Date.now() / 1000);
    const tickAge = now - Math.floor(t.time_msc / 1000);
    return { tickAge, market: { source: 'mt5', live: tickAge < 300, bid: t.bid, ask: t.ask, spread: t.spread, digits: t.digits, updatedAt: now, server: t.server, symbol: t.symbol } };
  }
  return { bridge, loadCandles, loadMarket };
}
