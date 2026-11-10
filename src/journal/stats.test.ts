import { describe, expect, it } from 'vitest';
import { cashSummary, equitySeries, periodRange, summarize, toUsd, weekKey, type CashFlow, type JournalTrade } from './stats';

const T = (date: string, pnl: number, fees = 0): JournalTrade => ({ id: date + pnl, date: Date.parse(date) / 1000, instrument: 'XAUUSD', side: 'buy', entry: 2000, exit: 2001, lots: 0.1, pnl, fees });
const C = (type: 'deposit' | 'withdrawal', date: string, amountUsd: number): CashFlow => ({ id: date, type, date: Date.parse(date) / 1000, amount: amountUsd, currency: 'USD', amountUsd });

describe('journal summary', () => {
  it('net trading P&L = profits − losses − costs, deposits excluded', () => {
    const trades = [T('2024-03-01T05:00:00Z', 100, 2), T('2024-03-01T07:00:00Z', -40, 2), T('2024-03-02T05:00:00Z', 60, 1)];
    const s = summarize(trades, 'UTC');
    expect(s.tradingProfits).toBe(160);
    expect(s.tradingLosses).toBe(40);
    expect(s.tradingCosts).toBe(5);
    expect(s.netPnl).toBe(115);
    expect(s.wins).toBe(2);
    expect(s.winRate).toBeCloseTo(66.67, 1);
    expect(s.bestDay).toEqual({ day: '2024-03-02', pnl: 59 });
    expect(s.worstDay).toEqual({ day: '2024-03-01', pnl: 56 });
    expect(s.maxDrawdown).toBe(42);
  });

  it('keeps cash flows separate and builds equity = contribution + trading P&L', () => {
    const trades = [T('2024-03-02T00:00:00Z', 50)];
    const flows = [C('deposit', '2024-03-01T00:00:00Z', 1000), C('withdrawal', '2024-03-03T00:00:00Z', 200)];
    expect(cashSummary(flows)).toEqual({ totalDeposited: 1000, totalWithdrawn: 200, netContribution: 800 });
    const eq = equitySeries(trades, flows);
    expect(eq.at(-1)).toMatchObject({ tradingPnl: 50, contribution: 800, equity: 850 });
    expect(summarize(trades, 'UTC').netPnl).toBe(50);
  });

  it('converts KHR deposits to USD', () => {
    expect(toUsd(410000, 'KHR', 4100)).toBe(100);
  });
});

describe('periods', () => {
  it('computes Cambodia-local day and week boundaries', () => {
    const now = Date.parse('2024-03-06T20:00:00Z') / 1000; // Thu 03:00 in Phnom Penh (UTC+7)
    const [from, to] = periodRange('today', 'Asia/Phnom_Penh', now);
    expect(new Date(from * 1000).toISOString()).toBe('2024-03-06T17:00:00.000Z');
    expect(to - from).toBe(86400);
    const [wf] = periodRange('thisWeek', 'Asia/Phnom_Penh', now);
    expect(new Date(wf * 1000).toISOString()).toBe('2024-03-03T17:00:00.000Z'); // Monday 00:00 local
    const [mf, mt] = periodRange('lastMonth', 'UTC', now);
    expect(new Date(mf * 1000).toISOString().slice(0, 10)).toBe('2024-02-01');
    expect(new Date(mt * 1000).toISOString().slice(0, 10)).toBe('2024-03-01');
    expect(weekKey(Date.parse('2024-01-01T12:00:00Z') / 1000, 'UTC')).toBe('2024-W01');
  });
});
