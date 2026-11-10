import type { VercelRequest, VercelResponse } from '@vercel/node';

// Server-side proxy for Twelve Data so the API key is never exposed to the browser.
// Twelve Data is the FALLBACK feed: spot XAU/USD aggregated from liquidity providers, NOT Exness prices.
const INTERVALS = new Set(['1min', '5min', '15min', '30min', '1h', '2h', '4h', '8h', '1day', '1week', '1month']);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) {
    res.status(503).json({ error: 'not_configured', message: 'TWELVEDATA_API_KEY is not set on the server.' });
    return;
  }
  const interval = String(req.query.interval ?? '');
  if (!INTERVALS.has(interval)) {
    res.status(400).json({ error: 'bad_interval' });
    return;
  }
  const outputsize = Math.min(5000, Math.max(1, Number(req.query.outputsize ?? 500) || 500));
  const params = new URLSearchParams({
    symbol: 'XAU/USD',
    interval,
    outputsize: String(outputsize),
    timezone: 'UTC',
    order: 'ASC',
    format: 'JSON',
    apikey: key,
  });
  const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(v) ? v : null);
  const start = iso(req.query.start_date);
  const end = iso(req.query.end_date);
  if (start) params.set('start_date', start);
  if (end) params.set('end_date', end);

  try {
    const r = await fetch(`https://api.twelvedata.com/time_series?${params}`);
    const j: any = await r.json();
    if (j.status === 'error' || !Array.isArray(j.values)) {
      const code = Number(j.code) || 502;
      res.status(code === 429 ? 429 : code >= 400 && code < 600 ? code : 502).json({ error: 'upstream', message: j.message ?? 'Upstream error' });
      return;
    }
    const bars = j.values.map((v: any) => ({
      time: Math.floor(Date.parse(v.datetime.length === 10 ? `${v.datetime}T00:00:00Z` : `${v.datetime.replace(' ', 'T')}Z`) / 1000),
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
    }));
    // Past-only ranges can be cached at the edge; anything touching "now" must stay fresh.
    res.setHeader('Cache-Control', end ? 's-maxage=86400' : 'no-store');
    res.status(200).json({ source: 'twelvedata', symbol: 'XAU/USD', interval, bars });
  } catch (e: any) {
    res.status(502).json({ error: 'fetch_failed', message: String(e?.message ?? e) });
  }
}
