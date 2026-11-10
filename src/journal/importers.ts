import { feed } from '../market/feed';
import { saveDoc } from '../lib/db';
import { parseCsv } from '../lib/format';
import type { CashFlow, JournalTrade } from './stats';

/**
 * Imports closed positions and balance operations from the MT5 bridge (read-only account history).
 * Uses deterministic ids so repeating an import updates instead of duplicating.
 */
export async function importFromMt5(from: number, to: number, existing: { trades: JournalTrade[]; flows: CashFlow[] }) {
  const { positions, balance } = await feed.mt5Client().accountHistory(from, to);
  const knownT = new Set(existing.trades.map((t) => t.mt5PositionId).filter(Boolean));
  const knownC = new Set(existing.flows.map((f) => f.mt5DealId).filter(Boolean));
  let trades = 0, flows = 0;
  for (const p of positions) {
    const id = `mt5-${p.position_id}`;
    const isNew = !knownT.has(p.position_id);
    await saveDoc<JournalTrade>('trades', {
      ...(isNew ? {} : existing.trades.find((t) => t.mt5PositionId === p.position_id)),
      id, date: p.close_time, openTime: p.open_time, instrument: p.symbol, side: p.type, entry: p.open_price, exit: p.close_price, lots: p.volume,
      sl: p.sl || null, tp: p.tp || null, pnl: p.profit, fees: -(p.commission + p.swap + p.fee), source: 'mt5', mt5PositionId: p.position_id,
      notes: isNew ? p.comment || '' : existing.trades.find((t) => t.mt5PositionId === p.position_id)?.notes,
    } as JournalTrade);
    if (isNew) trades++;
  }
  for (const b of balance) {
    if (knownC.has(b.deal_id) || !b.amount) continue;
    await saveDoc<CashFlow>('cashflows', {
      id: `mt5-deal-${b.deal_id}`, type: b.amount > 0 ? 'deposit' : 'withdrawal', date: b.time, amount: Math.abs(b.amount), currency: 'USD', amountUsd: Math.abs(b.amount),
      method: 'MT5 balance operation', reference: String(b.deal_id), notes: b.comment, source: 'mt5', mt5DealId: b.deal_id,
    } as CashFlow);
    flows++;
  }
  return { trades, flows, positions: positions.length };
}

/**
 * Generic CSV import. Expected headers (case-insensitive): date, side/type, entry, exit, lots/volume, pnl/profit,
 * optional: instrument/symbol, sl, tp, fees/commission, swap, strategy, notes, emotion.
 */
export async function importCsv(text: string): Promise<number> {
  const rows = parseCsv(text);
  let n = 0;
  for (const r of rows) {
    const g = (...keys: string[]) => { for (const k of Object.keys(r)) if (keys.includes(k.toLowerCase().trim())) return r[k]; return ''; };
    const date = Date.parse(g('date', 'close time', 'close_time', 'time').replace(' ', 'T') + (/(Z|[+-]\d\d:?\d\d)$/.test(g('date', 'close time', 'close_time', 'time')) ? '' : 'Z'));
    const pnl = Number(g('pnl', 'profit', 'profit/loss', 'p&l'));
    if (!Number.isFinite(date) || !Number.isFinite(pnl)) continue;
    const side = g('side', 'type', 'direction').toLowerCase().startsWith('s') ? 'sell' : 'buy';
    const num = (v: string) => (v === '' ? undefined : Number(v));
    await saveDoc<JournalTrade>('trades', {
      date: Math.floor(date / 1000), instrument: (g('instrument', 'symbol') || 'XAUUSD').toUpperCase(), side, entry: Number(g('entry', 'open price', 'open_price', 'price')),
      exit: Number(g('exit', 'close price', 'close_price')), lots: Number(g('lots', 'volume', 'size')) || 0, sl: num(g('sl', 's/l', 'stop loss')) ?? null, tp: num(g('tp', 't/p', 'take profit')) ?? null,
      pnl, fees: Math.abs(Number(g('fees', 'commission')) || 0) - (Number(g('swap')) || 0), strategy: g('strategy') || undefined, notes: g('notes', 'comment') || undefined,
      emotion: (g('emotion') || undefined) as any, source: 'csv',
    } as JournalTrade);
    n++;
  }
  return n;
}
