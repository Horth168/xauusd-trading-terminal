import { useMemo, useState } from 'react';
import { ImagePlus, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Empty, Field, Modal, PageHeader } from '../components/ui';
import { removeDoc, saveDoc, uploadImage, useCollection, type BaseDoc } from '../lib/db';
import { useSettings } from '../store/settings';
import { summarize, type JournalTrade } from '../journal/stats';
import type { SavedBacktest } from './BacktestPage';
import { num, pct, pnlClass, signedUsd } from '../lib/format';
import { TIMEFRAMES } from '../market/timeframes';

export interface StrategyDoc extends BaseDoc {
  name: string;
  description: string;
  entry: string;
  exit: string;
  indicators: string;
  timeframe: string;
  rr: string;
  backtestIds: string[];
  screenshots: string[];
}

export default function StrategiesPage() {
  const tz = useSettings((s) => s.timezone);
  const strategies = useCollection<StrategyDoc>('strategies');
  const trades = useCollection<JournalTrade>('trades');
  const backtests = useCollection<SavedBacktest>('backtests');
  const [editing, setEditing] = useState<Partial<StrategyDoc> | null>(null);

  const rows = useMemo(() => strategies.items.map((s) => {
    const live = summarize(trades.items.filter((t) => t.strategy === s.name), tz);
    const bts = backtests.items.filter((b) => s.backtestIds?.includes(b.id));
    const bestBt = bts.sort((a, b) => b.stats.netProfit - a.stats.netProfit)[0];
    return { s, live, bts, bestBt };
  }).sort((a, b) => b.live.netPnl - a.live.netPnl), [strategies.items, trades.items, backtests.items, tz]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Strategy Library" subtitle="Your playbook — live journal results vs. backtests" actions={<button className="btn-gold" onClick={() => setEditing({})}><Plus size={14} /> New strategy</button>} />

      {rows.length > 1 && (
        <div className="card mb-4 overflow-x-auto">
          <table className="table-x text-xs">
            <thead><tr><th>Strategy (ranked by live net P&L)</th><th>Live trades</th><th>Live win %</th><th>Live net</th><th>Live PF</th><th>Best backtest net</th><th>Backtest PF</th><th>Backtest max DD</th></tr></thead>
            <tbody>{rows.map(({ s, live, bestBt }, i) => (
              <tr key={s.id}>
                <td className="font-medium text-ink-100">{i === 0 && live.totalTrades > 0 ? '🏆 ' : ''}{s.name}</td><td>{live.totalTrades}</td><td>{pct(live.winRate)}</td>
                <td className={pnlClass(live.netPnl)}>{signedUsd(live.netPnl)}</td><td>{num(live.profitFactor)}</td>
                <td className={bestBt ? pnlClass(bestBt.stats.netProfit) : ''}>{bestBt ? signedUsd(bestBt.stats.netProfit) : '—'}</td>
                <td>{bestBt ? num(bestBt.stats.profitFactor) : '—'}</td><td>{bestBt ? pct(bestBt.stats.maxDrawdownPct) : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {!rows.length ? <Empty>No strategies yet. Document your setups here, then tag journal trades with the strategy name to track live performance.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ s, live, bts }) => (
            <div key={s.id} className="card flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-ink-100">{s.name}</h3>
                  <p className="text-[11px] text-ink-400">{s.timeframe} · R:R {s.rr || '—'} · {s.indicators || 'no indicators'}</p>
                </div>
                <button className="btn-icon" onClick={() => setEditing(s)}><Pencil size={14} /></button>
              </div>
              {s.screenshots?.[0] && <img src={s.screenshots[0]} alt="" className="mt-3 h-32 w-full rounded-md object-cover" />}
              <p className="mt-3 line-clamp-3 text-xs text-ink-300">{s.description}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div><div className="text-ink-400">Entry</div><p className="line-clamp-3 text-ink-200">{s.entry || '—'}</p></div>
                <div><div className="text-ink-400">Exit</div><p className="line-clamp-3 text-ink-200">{s.exit || '—'}</p></div>
              </div>
              <div className="mt-auto grid grid-cols-3 gap-2 border-t border-ink-700 pt-3 text-center text-xs">
                <div><div className="text-ink-400">Live trades</div><div className="font-mono text-ink-100">{live.totalTrades}</div></div>
                <div><div className="text-ink-400">Win rate</div><div className="font-mono text-ink-100">{pct(live.winRate)}</div></div>
                <div><div className="text-ink-400">Net P&L</div><div className={`font-mono ${pnlClass(live.netPnl)}`}>{signedUsd(live.netPnl)}</div></div>
              </div>
              {bts.length > 0 && (
                <div className="mt-2 space-y-0.5 text-[11px]">
                  {bts.map((b) => <div key={b.id} className="flex justify-between text-ink-400"><span className="truncate">⚗ {b.name}</span><span className={pnlClass(b.stats.netProfit)}>{signedUsd(b.stats.netProfit)} · PF {num(b.stats.profitFactor)}</span></div>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {editing && <StrategyForm s={editing} backtests={backtests.items} onClose={() => setEditing(null)} />}
    </div>
  );
}

function StrategyForm({ s, backtests, onClose }: { s: Partial<StrategyDoc>; backtests: SavedBacktest[]; onClose: () => void }) {
  const [f, setF] = useState<Partial<StrategyDoc>>({ name: '', description: '', entry: '', exit: '', indicators: '', timeframe: 'M15', rr: '1:2', backtestIds: [], screenshots: [], ...s });
  const [up, setUp] = useState(false);
  const p = (x: Partial<StrategyDoc>) => setF((o) => ({ ...o, ...x }));
  const save = async () => { if (!f.name?.trim()) return; await saveDoc<StrategyDoc>('strategies', f as StrategyDoc); onClose(); };
  return (
    <Modal open onClose={onClose} title={f.id ? 'Edit strategy' : 'New strategy'} wide footer={<>
      {f.id && <button className="btn-danger mr-auto" onClick={async () => { if (confirm('Delete strategy? Journal trades keep their strategy name.')) { await removeDoc('strategies', f.id!); onClose(); } }}><Trash2 size={14} /></button>}
      <button className="btn" onClick={onClose}>Cancel</button><button className="btn-gold" onClick={save}>Save</button>
    </>}>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Strategy name" className="md:col-span-2"><input className="input" value={f.name} onChange={(e) => p({ name: e.target.value })} /></Field>
        <Field label="Timeframe"><select className="input" value={f.timeframe} onChange={(e) => p({ timeframe: e.target.value })}>{TIMEFRAMES.map((t) => <option key={t.id}>{t.id}</option>)}</select></Field>
        <Field label="Description" className="md:col-span-3"><textarea className="input min-h-[70px]" value={f.description} onChange={(e) => p({ description: e.target.value })} /></Field>
        <Field label="Entry conditions" className="md:col-span-3 lg:col-span-1"><textarea className="input min-h-[110px]" value={f.entry} onChange={(e) => p({ entry: e.target.value })} /></Field>
        <Field label="Exit conditions" className="md:col-span-3 lg:col-span-1"><textarea className="input min-h-[110px]" value={f.exit} onChange={(e) => p({ exit: e.target.value })} /></Field>
        <div className="space-y-3 md:col-span-3 lg:col-span-1">
          <Field label="Indicators used"><input className="input" value={f.indicators} onChange={(e) => p({ indicators: e.target.value })} placeholder="EMA 21/50, RSI 14" /></Field>
          <Field label="Risk : reward"><input className="input" value={f.rr} onChange={(e) => p({ rr: e.target.value })} /></Field>
        </div>
        <div className="md:col-span-3">
          <span className="label">Linked backtest results</span>
          <div className="flex flex-wrap gap-1">
            {backtests.map((b) => <button key={b.id} className={`chip ${f.backtestIds?.includes(b.id) ? 'on' : ''}`} onClick={() => p({ backtestIds: f.backtestIds?.includes(b.id) ? f.backtestIds.filter((x) => x !== b.id) : [...(f.backtestIds ?? []), b.id] })}>{b.name}</button>)}
            {!backtests.length && <span className="text-xs text-ink-400">Save a result in the Strategy Tester to link it here.</span>}
          </div>
        </div>
        <div className="md:col-span-3">
          <span className="label">Screenshots / examples</span>
          <div className="flex flex-wrap gap-2">
            {f.screenshots?.map((u, i) => <div key={i} className="group relative"><img src={u} alt="" className="h-20 w-32 rounded-md object-cover" /><button className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-down p-0.5 group-hover:block" onClick={() => p({ screenshots: f.screenshots!.filter((_, k) => k !== i) })}><X size={12} /></button></div>)}
            <label className="flex h-20 w-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-ink-500 text-xs text-ink-400 hover:border-gold-500">
              {up ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />} Add
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; setUp(true); try { const r = await uploadImage(file); p({ screenshots: [...(f.screenshots ?? []), r.url] }); } finally { setUp(false); } }} />
            </label>
          </div>
        </div>
      </div>
    </Modal>
  );
}
