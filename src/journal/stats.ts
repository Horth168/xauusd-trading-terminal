import type { BaseDoc } from '../lib/db';
import { dayKey, startOfDayKey, tzOffset } from '../lib/time';

export type Emotion = 'calm' | 'confident' | 'fearful' | 'greedy' | 'impatient' | 'revenge' | 'tired' | 'fomo' | 'neutral';

export interface JournalTrade extends BaseDoc {
  date: number; // close time (unix sec) — used for P&L attribution
  openTime?: number;
  instrument: string;
  side: 'buy' | 'sell';
  entry: number;
  exit: number;
  lots: number;
  sl?: number | null;
  tp?: number | null;
  pnl: number; // gross P&L in USD as reported by the broker (before fees)
  fees: number; // commission + swap + other costs, as a positive cost (negative = rebate)
  strategy?: string;
  screenshots?: string[];
  notes?: string;
  emotion?: Emotion;
  result?: 'win' | 'loss' | 'breakeven';
  source?: 'manual' | 'mt5' | 'csv';
  mt5PositionId?: number;
}

export interface CashFlow extends BaseDoc {
  type: 'deposit' | 'withdrawal';
  date: number;
  amount: number; // positive, in `currency`
  currency: 'USD' | 'KHR';
  khrPerUsd?: number; // FX used for KHR amounts
  amountUsd: number; // positive USD value
  method?: string;
  reference?: string;
  notes?: string;
  source?: 'manual' | 'mt5';
  mt5DealId?: number;
}

export const netOf = (t: Pick<JournalTrade, 'pnl' | 'fees'>) => t.pnl - (t.fees || 0);
export const resultOf = (t: JournalTrade): 'win' | 'loss' | 'breakeven' => t.result ?? (netOf(t) > 0 ? 'win' : netOf(t) < 0 ? 'loss' : 'breakeven');

export type Period = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | '3m' | '6m' | 'thisYear' | 'all' | 'custom';

export const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' }, { id: 'yesterday', label: 'Yesterday' }, { id: 'thisWeek', label: 'This week' }, { id: 'lastWeek', label: 'Last week' },
  { id: 'thisMonth', label: 'This month' }, { id: 'lastMonth', label: 'Last month' }, { id: '3m', label: '3 months' }, { id: '6m', label: '6 months' },
  { id: 'thisYear', label: 'This year' }, { id: 'all', label: 'All time' }, { id: 'custom', label: 'Custom' },
];

/** [from, to) in unix seconds for a period, computed in the user's timezone. Weeks start Monday. */
export function periodRange(p: Period, tz: string, now = Date.now() / 1000, custom?: { from: number; to: number }): [number, number] {
  const today = startOfDayKey(dayKey(now, tz), tz);
  const localNow = new Date((now + tzOffset(tz, now)) * 1000);
  const y = localNow.getUTCFullYear(), m = localNow.getUTCMonth();
  const dow = (localNow.getUTCDay() + 6) % 7; // Monday = 0
  const ymd = (yy: number, mm: number, dd = 1) => {
    const d = new Date(Date.UTC(yy, mm, dd));
    return startOfDayKey(d.toISOString().slice(0, 10), tz);
  };
  const addDays = (t: number, d: number) => startOfDayKey(dayKey(t + d * 86400 + 43200, tz), tz);
  switch (p) {
    case 'today': return [today, addDays(today, 1)];
    case 'yesterday': return [addDays(today, -1), today];
    case 'thisWeek': return [addDays(today, -dow), addDays(today, 7 - dow)];
    case 'lastWeek': return [addDays(today, -dow - 7), addDays(today, -dow)];
    case 'thisMonth': return [ymd(y, m), ymd(y, m + 1)];
    case 'lastMonth': return [ymd(y, m - 1), ymd(y, m)];
    case '3m': return [ymd(y, m - 2), addDays(today, 1)];
    case '6m': return [ymd(y, m - 5), addDays(today, 1)];
    case 'thisYear': return [ymd(y, 0), ymd(y + 1, 0)];
    case 'custom': return custom ? [custom.from, custom.to] : [0, Infinity];
    default: return [0, Infinity];
  }
}

export interface JournalSummary {
  totalTrades: number; wins: number; losses: number; breakeven: number; winRate: number;
  tradingProfits: number; tradingLosses: number; tradingCosts: number; netPnl: number;
  avgProfit: number; avgLoss: number; maxDrawdown: number; bestDay: { day: string; pnl: number } | null; worstDay: { day: string; pnl: number } | null;
  profitFactor: number; avgRR: number; largestWin: number; largestLoss: number; lots: number;
}

/**
 * Net Trading P&L = Trading Profits − Trading Losses − Trading Costs.
 * Profits/losses are gross broker P&L; costs are commissions/swaps/fees. Deposits/withdrawals never enter here.
 */
export function summarize(trades: JournalTrade[], tz: string): JournalSummary {
  const sorted = [...trades].sort((a, b) => a.date - b.date);
  const tradingProfits = sorted.reduce((a, t) => a + Math.max(0, t.pnl), 0);
  const tradingLosses = sorted.reduce((a, t) => a + Math.max(0, -t.pnl), 0);
  const tradingCosts = sorted.reduce((a, t) => a + (t.fees || 0), 0);
  const netPnl = tradingProfits - tradingLosses - tradingCosts;
  const res = sorted.map(resultOf);
  const winsT = sorted.filter((_, i) => res[i] === 'win'), lossT = sorted.filter((_, i) => res[i] === 'loss');
  const sumWin = winsT.reduce((a, t) => a + netOf(t), 0), sumLoss = -lossT.reduce((a, t) => a + netOf(t), 0);
  let cum = 0, peak = 0, dd = 0;
  for (const t of sorted) { cum += netOf(t); peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); }
  const days = dailyPnl(sorted, tz);
  let best: JournalSummary['bestDay'] = null, worst: JournalSummary['worstDay'] = null;
  for (const d of days) {
    if (!best || d.pnl > best.pnl) best = { day: d.day, pnl: d.pnl };
    if (!worst || d.pnl < worst.pnl) worst = { day: d.day, pnl: d.pnl };
  }
  const avgProfit = winsT.length ? sumWin / winsT.length : 0, avgLoss = lossT.length ? sumLoss / lossT.length : 0;
  return {
    totalTrades: sorted.length, wins: winsT.length, losses: lossT.length, breakeven: sorted.length - winsT.length - lossT.length,
    winRate: sorted.length ? (winsT.length / sorted.length) * 100 : 0,
    tradingProfits, tradingLosses, tradingCosts, netPnl, avgProfit, avgLoss, maxDrawdown: dd, bestDay: best, worstDay: worst,
    profitFactor: sumLoss ? sumWin / sumLoss : sumWin > 0 ? Infinity : 0, avgRR: avgLoss ? avgProfit / avgLoss : 0,
    largestWin: winsT.length ? Math.max(...winsT.map(netOf)) : 0, largestLoss: lossT.length ? Math.min(...lossT.map(netOf)) : 0,
    lots: sorted.reduce((a, t) => a + (t.lots || 0), 0),
  };
}

export function dailyPnl(trades: JournalTrade[], tz: string) {
  const map = new Map<string, { pnl: number; count: number; wins: number }>();
  for (const t of trades) {
    const k = dayKey(t.date, tz);
    const e = map.get(k) ?? { pnl: 0, count: 0, wins: 0 };
    e.pnl += netOf(t); e.count++; if (resultOf(t) === 'win') e.wins++;
    map.set(k, e);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v }));
}

/** ISO week key (Monday start) in tz, e.g. 2024-W05. */
export function weekKey(sec: number, tz: string) {
  const [y, m, d] = dayKey(sec, tz).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function groupPnl(trades: JournalTrade[], tz: string, by: 'week' | 'month') {
  const map = new Map<string, number>();
  for (const t of trades) {
    const k = by === 'week' ? weekKey(t.date, tz) : dayKey(t.date, tz).slice(0, 7);
    map.set(k, (map.get(k) ?? 0) + netOf(t));
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, pnl]) => ({ label, pnl }));
}

export interface CashSummary {
  totalDeposited: number;
  totalWithdrawn: number;
  netContribution: number; // Net Cash Contribution = Deposits − Withdrawals
}

export function cashSummary(flows: CashFlow[]): CashSummary {
  const totalDeposited = flows.filter((f) => f.type === 'deposit').reduce((a, f) => a + f.amountUsd, 0);
  const totalWithdrawn = flows.filter((f) => f.type === 'withdrawal').reduce((a, f) => a + f.amountUsd, 0);
  return { totalDeposited, totalWithdrawn, netContribution: totalDeposited - totalWithdrawn };
}

/** Estimated Account Equity = Net Cash Contribution + Net Trading P&L, as a time series. */
export function equitySeries(trades: JournalTrade[], flows: CashFlow[]) {
  const events = [
    ...trades.map((t) => ({ time: t.date, pnl: netOf(t), cash: 0 })),
    ...flows.map((f) => ({ time: f.date, pnl: 0, cash: f.type === 'deposit' ? f.amountUsd : -f.amountUsd })),
  ].sort((a, b) => a.time - b.time);
  let pnl = 0, cash = 0;
  return events.map((e) => { pnl += e.pnl; cash += e.cash; return { time: e.time, tradingPnl: pnl, contribution: cash, equity: cash + pnl }; });
}

export const toUsd = (amount: number, currency: 'USD' | 'KHR', khrPerUsd: number) => (currency === 'USD' ? amount : amount / (khrPerUsd || 4100));
