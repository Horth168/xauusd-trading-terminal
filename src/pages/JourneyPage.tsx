import { useMemo, useRef, useState } from 'react';
import { Download, FileUp, Image as ImageIcon, Plus, RefreshCw, Search } from 'lucide-react';
import { Empty, Field, Modal, PageHeader, Segmented, Stat } from '../components/ui';
import { EquityChart, PnlBars } from '../components/charts';
import { useCollection } from '../lib/db';
import { useSettings } from '../store/settings';
import { useFeed } from '../market/feed';
import { cashSummary, dailyPnl, equitySeries, groupPnl, netOf, periodRange, PERIODS, resultOf, summarize, type CashFlow, type JournalTrade, type Period } from '../journal/stats';
import { TradeForm, EMOTIONS } from '../journal/TradeForm';
import { importCsv, importFromMt5 } from '../journal/importers';
import { fmtDate, fmtDateTime, fromLocalInput, toLocalInput } from '../lib/time';
import { downloadText, num, pct, pnlClass, signedUsd, toCsv, usd } from '../lib/format';

export default function JourneyPage() {
  const tz = useSettings((s) => s.timezone);
  const source = useFeed((s) => s.source);
  const trades = useCollection<JournalTrade>('trades');
  const flows = useCollection<CashFlow>('cashflows');
  const [period, setPeriod] = useState<Period>('thisMonth');
  const [custom, setCustom] = useState({ from: Math.floor(Date.now() / 1000 - 30 * 86400), to: Math.floor(Date.now() / 1000) });
  const [chartBy, setChartBy] = useState<'day' | 'week' | 'month'>('day');
  const [editing, setEditing] = useState<Partial<JournalTrade> | null>(null);
  const [q, setQ] = useState('');
  const [stratFilter, setStratFilter] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  const [from, to] = periodRange(period, tz, Date.now() / 1000, custom);
  const inPeriod = useMemo(() => trades.items.filter((t) => t.date >= from && t.date < to), [trades.items, from, to]);
  const filtered = useMemo(() => inPeriod
    .filter((t) => !stratFilter || t.strategy === stratFilter)
    .filter((t) => !q || `${t.instrument} ${t.strategy ?? ''} ${t.notes ?? ''} ${t.side}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.date - a.date), [inPeriod, q, stratFilter]);
  const s = useMemo(() => summarize(filtered, tz), [filtered, tz]);
  const cash = useMemo(() => cashSummary(flows.items), [flows.items]);
  const allNet = useMemo(() => summarize(trades.items, tz).netPnl, [trades.items, tz]);
  const strategies = useMemo(() => [...new Set(trades.items.map((t) => t.strategy).filter(Boolean))] as string[], [trades.items]);

  const bars = chartBy === 'day' ? dailyPnl(filtered, tz).map((d) => ({ label: d.day.slice(5), pnl: d.pnl })) : groupPnl(filtered, tz, chartBy);
  const curve = useMemo(() => {
    let cum = 0;
    return [...filtered].sort((a, b) => a.date - b.date).map((t) => { cum += netOf(t); return { label: fmtDate(t.date, tz), equity: cum }; });
  }, [filtered, tz]);
  const accountCurve = useMemo(() => equitySeries(trades.items, flows.items).map((p) => ({ label: fmtDate(p.time, tz), equity: p.equity, balance: p.contribution })), [trades.items, flows.items, tz]);

  const byEmotion = useMemo(() => EMOTIONS.map((e) => {
    const ts = filtered.filter((t) => (t.emotion ?? 'neutral') === e.id);
    return { ...e, n: ts.length, pnl: ts.reduce((a, t) => a + netOf(t), 0), wr: ts.length ? (ts.filter((t) => resultOf(t) === 'win').length / ts.length) * 100 : 0 };
  }).filter((e) => e.n), [filtered]);
  const byStrategy = useMemo(() => strategies.map((name) => {
    const ts = filtered.filter((t) => t.strategy === name);
    return { name, n: ts.length, pnl: ts.reduce((a, t) => a + netOf(t), 0), wr: ts.length ? (ts.filter((t) => resultOf(t) === 'win').length / ts.length) * 100 : 0 };
  }).filter((x) => x.n).sort((a, b) => b.pnl - a.pnl), [filtered, strategies]);

  const exportCsv = () => downloadText('trading-journal.csv', toCsv(filtered.map((t) => ({
    date: new Date(t.date * 1000).toISOString(), instrument: t.instrument, side: t.side, entry: t.entry, exit: t.exit, lots: t.lots, sl: t.sl ?? '', tp: t.tp ?? '',
    pnl: t.pnl, fees: t.fees, net: netOf(t).toFixed(2), strategy: t.strategy ?? '', emotion: t.emotion ?? '', result: resultOf(t), notes: t.notes ?? '',
  }))));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="My Trading Journey" subtitle="Trading performance only — deposits and withdrawals are tracked separately"
        actions={<>
          <button className="btn" onClick={() => setImportOpen(true)}><FileUp size={14} /> Import</button>
          <button className="btn" onClick={exportCsv}><Download size={14} /> Export</button>
          <button className="btn-gold" onClick={() => setEditing({})}><Plus size={14} /> Record trade</button>
        </>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p.id, label: p.label }))} />
        {period === 'custom' && (
          <div className="flex items-center gap-1 text-xs">
            <input type="date" className="input w-36 py-1" value={toLocalInput(custom.from, tz).slice(0, 10)} onChange={(e) => setCustom((c) => ({ ...c, from: fromLocalInput(e.target.value + 'T00:00', tz) }))} />
            <span>→</span>
            <input type="date" className="input w-36 py-1" value={toLocalInput(custom.to - 1, tz).slice(0, 10)} onChange={(e) => setCustom((c) => ({ ...c, to: fromLocalInput(e.target.value + 'T00:00', tz) + 86400 }))} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Net trading P&L" value={signedUsd(s.netPnl)} tone={s.netPnl >= 0 ? 'up' : 'down'} sub="profits − losses − costs" />
        <Stat label="Total profit" value={usd(s.tradingProfits)} tone="up" />
        <Stat label="Total loss" value={usd(-s.tradingLosses)} tone="down" />
        <Stat label="Trading costs" value={usd(s.tradingCosts)} sub="commission, swap, fees" />
        <Stat label="Win rate" value={pct(s.winRate)} sub={`${s.wins} W · ${s.losses} L · ${s.breakeven} BE`} />
        <Stat label="Total trades" value={s.totalTrades} sub={`${num(s.lots)} lots`} />
        <Stat label="Avg profit / win" value={usd(s.avgProfit)} tone="up" />
        <Stat label="Avg loss / loss" value={usd(-s.avgLoss)} tone="down" />
        <Stat label="Profit factor" value={Number.isFinite(s.profitFactor) ? num(s.profitFactor) : '∞'} sub={`avg W/L ${num(s.avgRR)}`} />
        <Stat label="Max drawdown" value={usd(s.maxDrawdown)} tone="down" sub="on cumulative P&L" />
        <Stat label="Best day" value={s.bestDay ? signedUsd(s.bestDay.pnl) : '—'} sub={s.bestDay?.day} tone="up" />
        <Stat label="Worst day" value={s.worstDay ? signedUsd(s.worstDay.pnl) : '—'} sub={s.worstDay?.day} tone="down" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink-100">Performance by {chartBy}</h3>
            <Segmented value={chartBy} onChange={setChartBy} options={[{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }]} />
          </div>
          {bars.length ? <PnlBars data={bars} /> : <p className="py-16 text-center text-sm text-ink-400">No trades in this period</p>}
        </div>
        <div className="card p-3">
          <h3 className="mb-2 text-sm font-semibold text-ink-100">Cumulative trading P&L (equity curve)</h3>
          {curve.length ? <EquityChart data={curve} showBalance={false} height={220} /> : <p className="py-16 text-center text-sm text-ink-400">No trades in this period</p>}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card p-3 lg:col-span-2">
          <h3 className="mb-1 text-sm font-semibold text-ink-100">Estimated account equity (all time)</h3>
          <p className="mb-2 text-[11px] text-ink-400">Gold = net cash contribution + net trading P&L · Blue = net cash contribution only</p>
          {accountCurve.length ? <EquityChart data={accountCurve} height={200} /> : <p className="py-10 text-center text-sm text-ink-400">Add trades and deposits to see your account curve.</p>}
        </div>
        <div className="card space-y-2 p-3 text-sm">
          <h3 className="font-semibold text-ink-100">Account (all time)</h3>
          <Row l="Net cash contribution" v={usd(cash.netContribution)} />
          <Row l="Net trading P&L" v={signedUsd(allNet)} cls={pnlClass(allNet)} />
          <div className="border-t border-ink-700 pt-2"><Row l="Estimated account equity" v={usd(cash.netContribution + allNet)} cls="text-gold-300 font-semibold" /></div>
          {byEmotion.length > 0 && <>
            <h4 className="pt-2 text-xs font-semibold text-ink-300">By emotion (this period)</h4>
            {byEmotion.map((e) => <Row key={e.id} l={`${e.label} · ${e.n} · ${pct(e.wr, 0)}`} v={signedUsd(e.pnl)} cls={pnlClass(e.pnl)} />)}
          </>}
          {byStrategy.length > 0 && <>
            <h4 className="pt-2 text-xs font-semibold text-ink-300">By strategy (this period)</h4>
            {byStrategy.map((e) => <Row key={e.name} l={`${e.name} · ${e.n} · ${pct(e.wr, 0)}`} v={signedUsd(e.pnl)} cls={pnlClass(e.pnl)} />)}
          </>}
        </div>
      </div>

      <div className="card mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <h3 className="text-sm font-semibold text-ink-100">Trades ({filtered.length})</h3>
          <div className="relative ml-auto"><Search size={14} className="absolute left-2 top-2 text-ink-400" /><input className="input w-48 pl-7 py-1" placeholder="Search notes, strategy…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select className="input w-40 py-1" value={stratFilter} onChange={(e) => setStratFilter(e.target.value)}><option value="">All strategies</option>{strategies.map((x) => <option key={x}>{x}</option>)}</select>
        </div>
        {trades.loading ? <p className="p-6 text-center text-sm text-ink-400">Loading…</p> : !filtered.length ? (
          <div className="p-4"><Empty>No trades in this period. <button className="text-gold-300 hover:underline" onClick={() => setEditing({})}>Record your first trade</button> or import from MT5.</Empty></div>
        ) : (
          <div className="max-h-[560px] overflow-auto">
            <table className="table-x text-xs">
              <thead><tr><th>Date</th><th>Symbol</th><th>Side</th><th>Lots</th><th>Entry</th><th>Exit</th><th>SL</th><th>TP</th><th>P&L</th><th>Fees</th><th>Net</th><th>Strategy</th><th>Emotion</th><th /></tr></thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className="cursor-pointer" onClick={() => setEditing(t)}>
                    <td>{fmtDateTime(t.date, tz)}</td><td>{t.instrument}</td>
                    <td className={t.side === 'buy' ? 'text-up' : 'text-down'}>{t.side.toUpperCase()}</td>
                    <td className="font-mono">{t.lots}</td><td className="font-mono">{num(t.entry)}</td><td className="font-mono">{num(t.exit)}</td>
                    <td className="font-mono text-ink-400">{t.sl ? num(t.sl) : '—'}</td><td className="font-mono text-ink-400">{t.tp ? num(t.tp) : '—'}</td>
                    <td className={`font-mono ${pnlClass(t.pnl)}`}>{signedUsd(t.pnl)}</td><td className="font-mono text-ink-400">{usd(t.fees || 0)}</td>
                    <td className={`font-mono font-semibold ${pnlClass(netOf(t))}`}>{signedUsd(netOf(t))}</td>
                    <td className="max-w-[140px] truncate">{t.strategy}</td><td>{EMOTIONS.find((e) => e.id === t.emotion)?.label}</td>
                    <td>{t.screenshots?.length ? <ImageIcon size={13} className="text-ink-400" /> : null}{t.source === 'mt5' && <span className="ml-1 rounded bg-ink-700 px-1 text-[9px]">MT5</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && <TradeForm trade={editing} onClose={() => setEditing(null)} />}
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} mt5={source === 'mt5'} trades={trades.items} flows={flows.items} />
    </div>
  );
}

function Row({ l, v, cls = '' }: { l: string; v: string; cls?: string }) {
  return <div className="flex justify-between gap-2 text-xs"><span className="text-ink-400">{l}</span><span className={`font-mono ${cls}`}>{v}</span></div>;
}

function ImportDialog({ open, onClose, mt5, trades, flows }: { open: boolean; onClose: () => void; mt5: boolean; trades: JournalTrade[]; flows: CashFlow[] }) {
  const tz = useSettings((s) => s.timezone);
  const [from, setFrom] = useState(Math.floor(Date.now() / 1000 - 90 * 86400));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const runMt5 = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await importFromMt5(from, Math.floor(Date.now() / 1000) + 86400, { trades, flows });
      setMsg(`Read ${r.positions} closed positions: ${r.trades} new trades, ${r.flows} new deposits/withdrawals. Existing MT5 trades were updated (your notes kept).`);
    } catch (e: any) { setMsg(`Import failed: ${e.message}`); } finally { setBusy(false); }
  };
  const runCsv = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try { setMsg(`Imported ${await importCsv(await f.text())} trades from CSV.`); } catch (e: any) { setMsg(`CSV import failed: ${e.message}`); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Import trades">
      <div className="space-y-5 text-sm">
        <div>
          <h3 className="mb-1 font-semibold text-ink-100">From Exness MT5 (via bridge)</h3>
          <p className="mb-2 text-xs text-ink-400">Reads closed positions and balance operations from your MT5 account history. Read-only; nothing is sent to your broker. {mt5 ? '' : 'Requires the MT5 bridge to be running and connected.'}</p>
          <div className="flex items-end gap-2">
            <Field label={`From (${tz})`}><input type="date" className="input" value={toLocalInput(from, tz).slice(0, 10)} onChange={(e) => setFrom(fromLocalInput(e.target.value + 'T00:00', tz))} /></Field>
            <button className="btn-gold" disabled={!mt5 || busy} onClick={runMt5}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Sync from MT5</button>
          </div>
        </div>
        <div>
          <h3 className="mb-1 font-semibold text-ink-100">From CSV</h3>
          <p className="mb-2 text-xs text-ink-400">Columns: date, side, entry, exit, lots, pnl — optional: symbol, sl, tp, commission, swap, strategy, notes, emotion. Dates in UTC unless they include an offset.</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => runCsv(e.target.files?.[0])} />
          <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}><FileUp size={14} /> Choose CSV file</button>
        </div>
        {msg && <p className="rounded-md bg-ink-800 p-2 text-xs text-ink-200">{msg}</p>}
      </div>
    </Modal>
  );
}
