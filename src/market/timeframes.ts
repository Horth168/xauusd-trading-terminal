export interface Timeframe {
  id: string;       // e.g. 'M1', 'H4', 'C45' (custom 45 minutes)
  label: string;
  seconds: number;  // nominal length (MN1 ~ 30d nominal; real buckets are calendar months)
  calendar?: 'week' | 'month';
}

const m = 60, h = 3600, d = 86400;
export const TIMEFRAMES: Timeframe[] = [
  { id: 'M1', label: '1m', seconds: m },
  { id: 'M2', label: '2m', seconds: 2 * m },
  { id: 'M3', label: '3m', seconds: 3 * m },
  { id: 'M5', label: '5m', seconds: 5 * m },
  { id: 'M10', label: '10m', seconds: 10 * m },
  { id: 'M15', label: '15m', seconds: 15 * m },
  { id: 'M30', label: '30m', seconds: 30 * m },
  { id: 'H1', label: '1H', seconds: h },
  { id: 'H2', label: '2H', seconds: 2 * h },
  { id: 'H4', label: '4H', seconds: 4 * h },
  { id: 'H6', label: '6H', seconds: 6 * h },
  { id: 'H8', label: '8H', seconds: 8 * h },
  { id: 'H12', label: '12H', seconds: 12 * h },
  { id: 'D1', label: 'D', seconds: d },
  { id: 'W1', label: 'W', seconds: 7 * d, calendar: 'week' },
  { id: 'MN1', label: 'M', seconds: 30 * d, calendar: 'month' },
];

/** Custom timeframes are expressed in minutes: 'C45' = 45 minutes, built by aggregating real lower-TF candles. */
export function customTimeframe(minutes: number): Timeframe {
  return { id: `C${minutes}`, label: minutes % 60 === 0 ? `${minutes / 60}H*` : `${minutes}m*`, seconds: minutes * 60 };
}

export function getTimeframe(id: string): Timeframe {
  const tf = TIMEFRAMES.find((t) => t.id === id);
  if (tf) return tf;
  const mm = /^C(\d+)$/.exec(id);
  if (mm) return customTimeframe(Number(mm[1]));
  throw new Error(`Unknown timeframe ${id}`);
}

/** Bucket start for a timestamp (UTC-aligned, like MT5 on a GMT+0 server such as Exness). */
export function bucketStart(t: number, tf: Timeframe): number {
  if (tf.calendar === 'month') {
    const dt = new Date(t * 1000);
    return Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1) / 1000;
  }
  if (tf.calendar === 'week') {
    // MT5 weeks start on Sunday 00:00 server time
    const day = Math.floor(t / 86400);
    const dow = (day + 4) % 7; // 1970-01-01 was Thursday (4); Sunday = 0
    return (day - dow) * 86400;
  }
  return Math.floor(t / tf.seconds) * tf.seconds;
}
