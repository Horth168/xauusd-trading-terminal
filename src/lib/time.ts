export const TIMEZONES: { id: string; label: string }[] = [
  { id: 'UTC', label: 'UTC' },
  { id: 'Asia/Phnom_Penh', label: 'Cambodia (Phnom Penh)' },
  { id: 'Asia/Bangkok', label: 'Bangkok' },
  { id: 'Asia/Ho_Chi_Minh', label: 'Ho Chi Minh' },
  { id: 'Asia/Singapore', label: 'Singapore' },
  { id: 'Asia/Hong_Kong', label: 'Hong Kong' },
  { id: 'Asia/Shanghai', label: 'Shanghai' },
  { id: 'Asia/Tokyo', label: 'Tokyo' },
  { id: 'Asia/Dubai', label: 'Dubai' },
  { id: 'Asia/Kolkata', label: 'India' },
  { id: 'Australia/Sydney', label: 'Sydney' },
  { id: 'Europe/London', label: 'London' },
  { id: 'Europe/Berlin', label: 'Frankfurt / Berlin' },
  { id: 'Europe/Moscow', label: 'Moscow' },
  { id: 'America/New_York', label: 'New York' },
  { id: 'America/Chicago', label: 'Chicago' },
  { id: 'America/Los_Angeles', label: 'Los Angeles' },
];

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, opts: Intl.DateTimeFormatOptions) {
  const key = tz + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) { f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', ...opts }); fmtCache.set(key, f); }
  return f;
}

/** UTC offset (seconds) of `tz` at unix time `sec`. */
export function tzOffset(tz: string, sec: number): number {
  const parts = fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(sec * 1000));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  return Math.round((asUtc - sec * 1000) / 1000);
}

export const fmtDateTime = (sec: number, tz: string) => fmt(tz, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(sec * 1000));
export const fmtTime = (sec: number, tz: string, seconds = false) => fmt(tz, { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) }).format(new Date(sec * 1000));
export const fmtDate = (sec: number, tz: string) => fmt(tz, { year: 'numeric', month: 'short', day: '2-digit' }).format(new Date(sec * 1000));
export const fmtMonth = (sec: number, tz: string) => fmt(tz, { year: 'numeric', month: 'short' }).format(new Date(sec * 1000));

/** YYYY-MM-DD of a unix time in tz. */
export function dayKey(sec: number, tz: string): string {
  const p = fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(sec * 1000));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

/** Unix seconds for local midnight of a YYYY-MM-DD in tz. */
export function startOfDayKey(key: string, tz: string): number {
  const [y, m, d] = key.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d) / 1000;
  return guess - tzOffset(tz, guess);
}

/** <input type="datetime-local"> helpers in a timezone. */
export function toLocalInput(sec: number, tz: string): string {
  const off = tzOffset(tz, sec);
  return new Date((sec + off) * 1000).toISOString().slice(0, 16);
}
export function fromLocalInput(v: string, tz: string): number {
  const asUtc = Date.parse(`${v}:00Z`) / 1000;
  return asUtc - tzOffset(tz, asUtc);
}

/** Major FX sessions (fixed in their local time zones, so DST is handled). */
export const SESSIONS = [
  { name: 'Sydney', tz: 'Australia/Sydney', open: 7, close: 16, color: '#6b8afd' },
  { name: 'Tokyo', tz: 'Asia/Tokyo', open: 9, close: 18, color: '#c678dd' },
  { name: 'London', tz: 'Europe/London', open: 8, close: 17, color: '#22b07d' },
  { name: 'New York', tz: 'America/New_York', open: 8, close: 17, color: '#e8c25a' },
];

export function sessionState(nowSec: number) {
  return SESSIONS.map((s) => {
    const off = tzOffset(s.tz, nowSec);
    const local = new Date((nowSec + off) * 1000);
    const h = local.getUTCHours() + local.getUTCMinutes() / 60;
    const dow = local.getUTCDay();
    const open = dow >= 1 && dow <= 5 && h >= s.open && h < s.close;
    const todayStart = Math.floor((nowSec + off) / 86400) * 86400 - off;
    return { ...s, isOpen: open, openAt: todayStart + s.open * 3600, closeAt: todayStart + s.close * 3600 };
  });
}

/** Gold trades ~Sun 22:00/23:00 UTC to Fri 21:00/22:00 UTC with a daily 1h break. Approximate. */
export function goldMarketLikelyOpen(nowSec: number): boolean {
  const d = new Date(nowSec * 1000);
  const dow = d.getUTCDay(), h = d.getUTCHours();
  if (dow === 6) return false;
  if (dow === 0) return h >= 23;
  if (dow === 5) return h < 21;
  return h !== 21;
}
