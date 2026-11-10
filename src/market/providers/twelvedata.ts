import type { Bar } from '../types';

/** Fallback feed through our /api/history proxy. Spot XAU/USD from Twelve Data — NOT Exness prices. */
export const TD_INTERVAL: Record<string, string> = {
  M1: '1min',
  M5: '5min',
  M15: '15min',
  M30: '30min',
  H1: '1h',
  H2: '2h',
  H4: '4h',
  H8: '8h',
  D1: '1day',
  W1: '1week',
  MN1: '1month',
};
export const TD_TIMEFRAMES = Object.keys(TD_INTERVAL);

const fmt = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 19).replace('T', ' ');

export class TwelveDataError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function tdConfigured(): Promise<boolean> {
  try {
    const r = await fetch('/api/status');
    if (!r.ok) return false;
    return (await r.json()).twelvedata === true;
  } catch {
    return false;
  }
}

export async function tdHistory(tf: string, opts: { outputsize?: number; start?: number; end?: number }): Promise<Bar[]> {
  const interval = TD_INTERVAL[tf];
  if (!interval) throw new Error(`Twelve Data has no native ${tf}`);
  const q = new URLSearchParams({ interval, outputsize: String(opts.outputsize ?? 5000) });
  if (opts.start) q.set('start_date', fmt(opts.start));
  if (opts.end) q.set('end_date', fmt(opts.end));
  const r = await fetch(`/api/history?${q}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new TwelveDataError(r.status, j.message ?? `HTTP ${r.status}`);
  return j.bars as Bar[];
}
