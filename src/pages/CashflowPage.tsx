import { useMemo, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Plus, Trash2 } from 'lucide-react';
import { Empty, Field, Modal, PageHeader, Segmented, Stat } from '../components/ui';
import { removeDoc, saveDoc, useCollection } from '../lib/db';
import { useSettings } from '../store/settings';
import { cashSummary, summarize, toUsd, type CashFlow, type JournalTrade } from '../journal/stats';
import { fmtDate, fromLocalInput, toLocalInput } from '../lib/time';
import { khr, pnlClass, signedUsd, usd } from '../lib/format';

const METHODS = ['Bank transfer', 'ABA Bank', 'ACLEDA', 'Wing', 'Card', 'USDT (crypto)', 'Bitcoin', 'Skrill', 'Neteller', 'Perfect Money', 'Other'];

export default function CashflowPage() {
  const tz = useSettings((s) => s.timezone);
  const khrPerUsd = useSettings((s) => s.khrPerUsd);
  const flows = useCollection<CashFlow>('cashflows');
  const trades = useCollection<JournalTrade>('trades');
  const [editing, setEditing] = useState<Partial<CashFlow> | null>(null);
  const [filter, setFilter] = useState<'all' | 'deposit' | 'withdrawal'>('all');
  const [showKhr, setShowKhr] = useState(false);

  const cash = useMemo(() => cashSummary(flows.items), [flows.items]);
  const tradingPnl = useMemo(() => summarize(trades.items, tz).netPnl, [trades.items, tz]);
  const equity = cash.netContribution + tradingPnl;
  const list = flows.items.filter((f) => filter === 'all' || f.type === filter).sort((a, b) => b.date - a.date);
  const fx = (v: number) => (showKhr ? khr(v * khrPerUsd) : usd(v));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Deposits & Withdrawals" subtitle="Money moving in and out of your account — never counted as trading profit or loss"
        actions={<>
          <Segmented value={showKhr ? 'KHR' : 'USD'} onChange={(v) => setShowKhr(v === 'KHR')} options={[{ value: 'USD', label: 'USD' }, { value: 'KHR', label: 'KHR' }]} />
          <button className="btn" onClick={() => setEditing({ type: 'withdrawal' })}><ArrowUpCircle size={14} /> Withdrawal</button>
          <button className="btn-gold" onClick={() => setEditing({ type: 'deposit' })}><ArrowDownCircle size={14} /> Deposit</button>
        </>} />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total deposited" value={fx(cash.totalDeposited)} tone="up" />
        <Stat label="Total withdrawn" value={fx(cash.totalWithdrawn)} tone="down" />
        <Stat label="Net cash contribution" value={fx(cash.netContribution)} sub="deposits − withdrawals" />
        <Stat label="Net trading P&L" value={showKhr ? khr(tradingPnl * khrPerUsd) : signedUsd(tradingPnl)} tone={tradingPnl >= 0 ? 'up' : 'down'} sub="from journal" />
        <Stat label="Est. account equity" value={fx(equity)} tone="gold" sub="contribution + trading P&L" />
        <Stat label="Return on capital" value={cash.netContribution > 0 ? `${((tradingPnl / cash.netContribution) * 100).toFixed(1)}%` : '—'} sub="trading P&L ÷ net contribution" />
      </div>
      <p className="mt-2 text-[11px] text-ink-400">KHR amounts are converted at the rate saved with each transaction; KHR display uses your current rate ({khrPerUsd.toLocaleString()} ៛/$, change in Settings). The equity estimate excludes open positions and broker adjustments not recorded here.</p>

      <div className="card mt-4 overflow-hidden">
        <div className="flex items-center justify-between p-3">
          <h3 className="text-sm font-semibold text-ink-100">History</h3>
          <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'deposit', label: 'Deposits' }, { value: 'withdrawal', label: 'Withdrawals' }]} />
        </div>
        {!list.length ? <div className="p-4"><Empty>No transactions yet.</Empty></div> : (
          <div className="overflow-x-auto">
            <table className="table-x text-xs">
              <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>USD value</th><th>Method</th><th>Reference</th><th>Notes</th><th /></tr></thead>
              <tbody>{list.map((f) => (
                <tr key={f.id} className="cursor-pointer" onClick={() => setEditing(f)}>
                  <td>{fmtDate(f.date, tz)}</td>
                  <td className={f.type === 'deposit' ? 'text-up' : 'text-down'}>{f.type === 'deposit' ? 'Deposit' : 'Withdrawal'}</td>
                  <td className="font-mono">{f.currency === 'KHR' ? khr(f.amount) : usd(f.amount)}</td>
                  <td className={`font-mono ${pnlClass(f.type === 'deposit' ? 1 : -1)}`}>{f.type === 'deposit' ? '+' : '−'}{usd(f.amountUsd)}</td>
                  <td>{f.method}</td><td className="font-mono text-ink-400">{f.reference}</td><td className="max-w-[220px] truncate text-ink-400">{f.notes}</td>
                  <td>{f.source === 'mt5' && <span className="rounded bg-ink-700 px-1 text-[9px]">MT5</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <CashForm flow={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CashForm({ flow, onClose }: { flow: Partial<CashFlow>; onClose: () => void }) {
  const tz = useSettings((s) => s.timezone);
  const khrPerUsd = useSettings((s) => s.khrPerUsd);
  const [f, setF] = useState<Partial<CashFlow>>({ date: Math.floor(Date.now() / 1000), currency: 'USD', khrPerUsd, method: 'Bank transfer', ...flow });
  const [err, setErr] = useState('');
  const p = (x: Partial<CashFlow>) => setF((o) => ({ ...o, ...x }));
  const usdValue = f.amount ? toUsd(f.amount, f.currency ?? 'USD', f.khrPerUsd ?? khrPerUsd) : 0;
  const save = async () => {
    if (!f.amount || f.amount <= 0) { setErr('Enter a positive amount.'); return; }
    await saveDoc<CashFlow>('cashflows', { ...(f as CashFlow), amountUsd: Math.round(usdValue * 100) / 100 });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={`${f.id ? 'Edit' : 'Add'} ${f.type === 'deposit' ? 'deposit' : 'withdrawal'}`}
      footer={<>
        {f.id && <button className="btn-danger mr-auto" onClick={async () => { if (confirm('Delete this transaction?')) { await removeDoc('cashflows', f.id!); onClose(); } }}><Trash2 size={14} /></button>}
        <button className="btn" onClick={onClose}>Cancel</button><button className="btn-gold" onClick={save}><Plus size={14} /> Save</button>
      </>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type" className="col-span-2"><Segmented value={f.type ?? 'deposit'} onChange={(v) => p({ type: v })} options={[{ value: 'deposit', label: 'Deposit' }, { value: 'withdrawal', label: 'Withdrawal' }]} /></Field>
        <Field label={`Date (${tz})`}><input type="date" className="input" value={toLocalInput(f.date!, tz).slice(0, 10)} onChange={(e) => p({ date: fromLocalInput(e.target.value + 'T12:00', tz) })} /></Field>
        <Field label="Currency"><select className="input" value={f.currency} onChange={(e) => p({ currency: e.target.value as any })}><option>USD</option><option>KHR</option></select></Field>
        <Field label={`Amount (${f.currency})`}><input type="number" step="0.01" className="input" value={f.amount ?? ''} onChange={(e) => p({ amount: Number(e.target.value) })} /></Field>
        {f.currency === 'KHR'
          ? <Field label="Rate (៛ per $1)" hint={`= ${usd(usdValue)}`}><input type="number" className="input" value={f.khrPerUsd ?? khrPerUsd} onChange={(e) => p({ khrPerUsd: Number(e.target.value) })} /></Field>
          : <div />}
        <Field label="Payment method"><input className="input" list="methods" value={f.method ?? ''} onChange={(e) => p({ method: e.target.value })} /><datalist id="methods">{METHODS.map((m) => <option key={m} value={m} />)}</datalist></Field>
        <Field label="Transaction reference"><input className="input" value={f.reference ?? ''} onChange={(e) => p({ reference: e.target.value })} /></Field>
        <Field label="Notes" className="col-span-2"><textarea className="input" value={f.notes ?? ''} onChange={(e) => p({ notes: e.target.value })} /></Field>
      </div>
      {err && <p className="mt-2 text-sm text-down">{err}</p>}
    </Modal>
  );
}
