import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, BarChart2, Download, Eye, GitCompare, Info, Loader2, Play, Plus, Save, Trash2, X } from 'lucide-react';
import { Field, Modal, PageHeader, Segmented, Stat } from '../components/ui';
import { EquityChart, MultiLine, PnlBars, downsample } from '../components/charts';
import { InputControl } from '../chart/IndicatorDialogs';
import { STRATEGIES } from '../backtest/strategies';
import { DEFAULT_CONFIG, type BacktestConfig, type BacktestResult, type Stats, type Trade } from '../backtest/engine';
import { runBacktestInWorker } from '../backtest/client';
import { useScripts } from '../indicators/registry';
import { defaultParams } from '../indicators/builtins';
import { feed, useFeed } from '../market/feed';
import { TIMEFRAMES } from '../market/timeframes';
import { useSettings } from '../store/settings';
import { useChartMarks } from '../store/chartMarks';
import { removeDoc, saveDoc, useCollection, type BaseDoc } from '../lib/db';
import { fmtDate, fmtDateTime, fromLocalInput, toLocalInput } from '../lib/time';
import { downloadText, num, pct, pnlClass, signedUsd, toCsv, usd } from '../lib/format';

export interface SavedBacktest extends BaseDoc {
  name: string;
  strategy: { type: string; params: Record<string, any>; name: string };
  tf: string;
  from: number;
  to: number;
  source: string;
  config: BacktestConfig;
  stats: Stats;
  monthly: BacktestResult['monthly'];
  curve: { time: number; equity: number; balance: number }[];
  trades: Trade[];
  barsCount: number;
}

const DAY = 86400;

export default function BacktestPage() {
  const nav = useNavigate();
  const tz = useSettings((s) => s.timezone);
  const contractSize = useSettings((s) => s.contractSize);
  const source = useFeed((s) => s.source);
  const scripts = useScripts((s) => s.scripts);
  const saved = useCollection<SavedBacktest>('backtests');

  const [tf, setTf] = useState('H1');
  const [from, setFrom] = useState(() => Math.floor(Date.now() / 1000 - 180 * DAY));
  const [to, setTo] = useState(() => Math.floor(Date.now() / 1000));
  const [stratType, setStratType] = useState('ema_cross');
  const [params, setParams] = useState<Record<string, any>>(() => defaultParams(STRATEGIES[0]));
  const [cfg, setCfg] = useState<BacktestConfig>({ ...DEFAULT_CONFIG, contractSize });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(BacktestResult & { source: string; barsCount: number; firstBar: number; lastBar: number }) | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [sort, setSort] = useState<{ key: keyof Trade; dir: 1 | -1 }>({ key: 'id', dir: 1 });

  const strategyOptions = useMemo(() => [
    ...STRATEGIES.map((s) => ({ id: s.id, name: s.name, inputs: s.inputs, code: undefined as string | undefined })),
    { id: 'supertrend', name: 'Supertrend indicator signals', inputs: [{ id: 'length', label: 'ATR length', type: 'int' as const, default: 10 }, { id: 'mult', label: 'Factor', type: 'float' as const, default: 3 }], code: undefined },
    ...scripts.map((s) => ({ id: `custom:${s.id}`, name: `${s.name} (my ${s.kind})`, inputs: s.inputs, code: s.code })),
  ], [scripts]);
  const strat = strategyOptions.find((s) => s.id === stratType) ?? strategyOptions[0];

  const c = (patch: Partial<BacktestConfig>) => setCfg((x) => ({ ...x, ...patch }));

  const run = async () => {
    setRunning(true); setError(null); setResult(null);
    try {
      setProgress('Loading historical candles…');
      const { bars, source: src } = await feed.range(tf, from, to, setProgress);
      if (bars.length < 50) throw new Error(`Only ${bars.length} candles available for this range — choose a longer range or another timeframe.`);
      setProgress(`Simulating ${bars.length.toLocaleString()} candles…`);
      const r = await runBacktestInWorker(bars, cfg, { type: strat.id, params }, strat.code);
      setResult({ ...r, source: src, barsCount: bars.length, firstBar: bars[0].time, lastBar: bars[bars.length - 1].time });
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setRunning(false); setProgress('');
    }
  };

  const showOnChart = (focus?: Trade) => {
    if (!result) return;
    const marks = result.trades.map((t) => ({ id: t.id, side: t.side, entryTime: t.entryTime, entryPrice: t.entryPrice, exitTime: t.exitTime, exitPrice: t.exitPrice, sl: t.initialSl, tp: t.tps[0] ?? 0, pnl: t.pnl }));
    useChartMarks.getState().set({ label: strat.name, tf, trades: marks, focus: focus ? marks.find((m) => m.id === focus.id) ?? null : null });
    const s = useSettings.getState();
    s.updateChart(s.activeChart, { tf });
    nav('/');
  };

  const save = async () => {
    if (!result) return;
    const name = prompt('Name this backtest', `${strat.name} ${tf} ${fmtDate(from, tz)}–${fmtDate(to, tz)}`);
    if (!name) return;
    await saveDoc<SavedBacktest>('backtests', {
      name, strategy: { type: strat.id, params, name: strat.name }, tf, from, to, source: result.source, config: cfg, stats: sanitize(result.stats), monthly: result.monthly,
      curve: downsample(result.curve, 400), trades: result.trades.slice(0, 2000).map((t) => ({ ...t, fills: t.fills.slice(0, 6) })), barsCount: result.barsCount,
    });
  };

  const exportCsv = () => {
    if (!result) return;
    downloadText(`backtest-${strat.id}-${tf}.csv`, toCsv(result.trades.map((t) => ({
      id: t.id, side: t.side, signal_time: iso(t.signalTime), entry_time: iso(t.entryTime), entry_price: t.entryPrice.toFixed(2), lots: t.lots,
      stop_loss: Number.isFinite(t.initialSl) ? t.initialSl.toFixed(2) : '', take_profits: t.tps.map((x) => x.toFixed(2)).join(' '), exit_time: iso(t.exitTime),
      exit_price: t.exitPrice.toFixed(2), exit_reason: t.exitReason, gross_pnl: t.grossPnl.toFixed(2), commission: t.commission.toFixed(2), net_pnl: t.pnl.toFixed(2),
      r_multiple: Number.isFinite(t.rMultiple) ? t.rMultiple.toFixed(2) : '', bars: t.bars, mfe: t.mfe.toFixed(2), mae: t.mae.toFixed(2), balance_after: t.balanceAfter.toFixed(2),
    }))));
  };

  const sortedTrades = useMemo(() => {
    if (!result) return [];
    return [...result.trades].sort((a, b) => ((a[sort.key] as number) - (b[sort.key] as number)) * sort.dir);
  }, [result, sort]);

  const st = result?.stats;
  const range = (d: number) => { setTo(Math.floor(Date.now() / 1000)); setFrom(Math.floor(Date.now() / 1000 - d * DAY)); };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Strategy Tester" subtitle="Real historical candles · signals on bar close · fills on next bar open"
        actions={<button className="btn" onClick={() => setCompareOpen(true)}><GitCompare size={14} /> Compare saved ({saved.items.length})</button>} />

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {/* Config */}
        <div className="card space-y-4 p-4">
          <Section title="Market & period">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Symbol"><input className="input" value={source === 'twelvedata' ? 'XAU/USD (Twelve Data)' : 'XAUUSD (Exness)'} disabled /></Field>
              <Field label="Timeframe">
                <select className="input" value={tf} onChange={(e) => setTf(e.target.value)}>{TIMEFRAMES.map((t) => <option key={t.id} value={t.id}>{t.id}</option>)}</select>
              </Field>
              <Field label={`From (${tz})`}><input type="datetime-local" className="input" value={toLocalInput(from, tz)} onChange={(e) => setFrom(fromLocalInput(e.target.value, tz))} /></Field>
              <Field label="To"><input type="datetime-local" className="input" value={toLocalInput(to, tz)} onChange={(e) => setTo(fromLocalInput(e.target.value, tz))} /></Field>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">{[[30, '1M'], [90, '3M'], [180, '6M'], [365, '1Y'], [730, '2Y']].map(([d, l]) => <button key={l} className="chip" onClick={() => range(d as number)}>{l}</button>)}</div>
          </Section>

          <Section title="Strategy">
            <select className="input" value={stratType} onChange={(e) => { setStratType(e.target.value); const s = strategyOptions.find((x) => x.id === e.target.value); setParams(s ? defaultParams(s) : {}); }}>
              {strategyOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {strat.inputs.map((d) => <Field key={d.id} label={d.label}><InputControl def={d} value={params[d.id] ?? d.default} onChange={(v) => setParams((p) => ({ ...p, [d.id]: v }))} /></Field>)}
            </div>
            <Field label="Direction" className="mt-2"><Segmented value={cfg.direction} onChange={(v) => c({ direction: v })} options={[{ value: 'both', label: 'Long & Short' }, { value: 'long', label: 'Long only' }, { value: 'short', label: 'Short only' }]} /></Field>
            <label className="mt-2 flex items-center gap-2 text-xs text-ink-300"><input type="checkbox" className="accent-gold-500" checked={cfg.exitOnSignal} onChange={(e) => c({ exitOnSignal: e.target.checked })} /> Exit on strategy exit/opposite signal</label>
            <label className="mt-1 flex items-center gap-2 text-xs text-ink-300"><input type="checkbox" className="accent-gold-500" checked={cfg.reverseOnOpposite} onChange={(e) => c({ reverseOnOpposite: e.target.checked })} /> Reverse position on opposite signal</label>
          </Section>

          <Section title="Account & costs">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Initial balance ($)"><Num v={cfg.initialBalance} on={(v) => c({ initialBalance: v })} /></Field>
              <Field label="Leverage (1:x)"><Num v={cfg.leverage} on={(v) => c({ leverage: v })} /></Field>
              <Field label="Sizing">
                <select className="input" value={cfg.sizing.mode} onChange={(e) => c({ sizing: e.target.value === 'fixed' ? { mode: 'fixed', lots: 0.1 } : { mode: 'risk', riskPct: 1 } })}>
                  <option value="risk">% risk per trade</option><option value="fixed">Fixed lots</option>
                </select>
              </Field>
              {cfg.sizing.mode === 'fixed'
                ? <Field label="Lots"><Num v={cfg.sizing.lots} step={0.01} on={(v) => c({ sizing: { mode: 'fixed', lots: v } })} /></Field>
                : <Field label="Risk %"><Num v={cfg.sizing.riskPct} step={0.1} on={(v) => c({ sizing: { mode: 'risk', riskPct: v } })} /></Field>}
              <Field label="Spread ($)" hint="0.20 = 20 pts"><Num v={cfg.spread} step={0.01} on={(v) => c({ spread: v })} /></Field>
              <Field label="Slippage ($)"><Num v={cfg.slippage} step={0.01} on={(v) => c({ slippage: v })} /></Field>
              <Field label="Commission $/lot"><Num v={cfg.commissionPerLot} step={0.5} on={(v) => c({ commissionPerLot: v })} /></Field>
              <Field label="Contract (oz/lot)"><Num v={cfg.contractSize} on={(v) => c({ contractSize: v })} /></Field>
            </div>
          </Section>

          <Section title="Stop loss">
            <div className="grid grid-cols-2 gap-2">
              <select className="input" value={cfg.sl.mode} onChange={(e) => c({ sl: { ...cfg.sl, mode: e.target.value as any } })}>
                <option value="atr">ATR multiple</option><option value="points">Fixed $ distance</option><option value="signal">From script (sl)</option><option value="none">None</option>
              </select>
              {(cfg.sl.mode === 'atr' || cfg.sl.mode === 'points') && <Num v={cfg.sl.value} step={0.1} on={(v) => c({ sl: { ...cfg.sl, value: v } })} />}
            </div>
          </Section>

          <Section title="Take profit">
            <select className="input" value={cfg.tp.mode} onChange={(e) => c({ tp: { ...cfg.tp, mode: e.target.value as any } })}>
              <option value="rr">Risk:Reward multiple</option><option value="atr">ATR multiple</option><option value="points">Fixed $ distance</option><option value="signal">From script (tp)</option><option value="none">None</option>
            </select>
            {['rr', 'atr', 'points'].includes(cfg.tp.mode) && (
              <div className="mt-2 space-y-1">
                {cfg.tp.levels.map((lv, i) => (
                  <div key={i} className="flex items-center gap-1 text-xs">
                    <span className="w-8 text-ink-400">TP{i + 1}</span>
                    <Num v={lv.value} step={0.1} on={(v) => c({ tp: { ...cfg.tp, levels: cfg.tp.levels.map((x, k) => (k === i ? { ...x, value: v } : x)) } })} />
                    <span className="text-ink-400">close</span>
                    <Num v={lv.closePct} step={5} on={(v) => c({ tp: { ...cfg.tp, levels: cfg.tp.levels.map((x, k) => (k === i ? { ...x, closePct: v } : x)) } })} />
                    <span className="text-ink-400">%</span>
                    {cfg.tp.levels.length > 1 && <button className="btn-icon" onClick={() => c({ tp: { ...cfg.tp, levels: cfg.tp.levels.filter((_, k) => k !== i) } })}><X size={12} /></button>}
                  </div>
                ))}
                {cfg.tp.levels.length < 4 && <button className="chip" onClick={() => c({ tp: { ...cfg.tp, levels: [...cfg.tp.levels.map((l) => ({ ...l, closePct: 50 })), { value: (cfg.tp.levels.at(-1)?.value ?? 1) + 1, closePct: 50 }] } })}><Plus size={12} className="inline" /> add level</button>}
                <p className="text-[10px] text-ink-400">The last level closes whatever remains.</p>
              </div>
            )}
          </Section>

          <Section title="Trade management">
            <label className="flex items-center gap-2 text-xs text-ink-300"><input type="checkbox" className="accent-gold-500" checked={cfg.breakeven.enabled} onChange={(e) => c({ breakeven: { ...cfg.breakeven, enabled: e.target.checked } })} /> Move SL to break-even</label>
            {cfg.breakeven.enabled && (
              <div className="mt-1 grid grid-cols-2 gap-2">
                <Field label="Trigger at R"><Num v={cfg.breakeven.triggerR} step={0.1} on={(v) => c({ breakeven: { ...cfg.breakeven, triggerR: v } })} /></Field>
                <Field label="Offset ($)"><Num v={cfg.breakeven.offset} step={0.05} on={(v) => c({ breakeven: { ...cfg.breakeven, offset: v } })} /></Field>
              </div>
            )}
            <label className="mt-2 flex items-center gap-2 text-xs text-ink-300"><input type="checkbox" className="accent-gold-500" checked={cfg.trailing.enabled} onChange={(e) => c({ trailing: { ...cfg.trailing, enabled: e.target.checked } })} /> Trailing stop (updated at bar close)</label>
            {cfg.trailing.enabled && (
              <div className="mt-1 grid grid-cols-3 gap-2">
                <Field label="Mode"><select className="input" value={cfg.trailing.mode} onChange={(e) => c({ trailing: { ...cfg.trailing, mode: e.target.value as any } })}><option value="atr">ATR×</option><option value="points">$</option></select></Field>
                <Field label="Distance"><Num v={cfg.trailing.distance} step={0.1} on={(v) => c({ trailing: { ...cfg.trailing, distance: v } })} /></Field>
                <Field label="Start at R"><Num v={cfg.trailing.activateR} step={0.1} on={(v) => c({ trailing: { ...cfg.trailing, activateR: v } })} /></Field>
              </div>
            )}
            <Field label="Intrabar assumption (SL & TP in same candle)" className="mt-2">
              <select className="input" value={cfg.intrabar} onChange={(e) => c({ intrabar: e.target.value as any })}>
                <option value="pessimistic">Pessimistic — stop first (recommended)</option>
                <option value="ohlc">OHLC path — O→L→H→C if bullish candle</option>
                <option value="optimistic">Optimistic — target first</option>
              </select>
            </Field>
          </Section>

          <button className="btn-gold w-full py-2" onClick={run} disabled={running || !source}>
            {running ? <><Loader2 size={15} className="animate-spin" /> {progress || 'Running…'}</> : <><Play size={15} /> Run backtest</>}
          </button>
          {!source && <p className="text-xs text-down">No data source connected. Start the MT5 bridge or configure Twelve Data in Settings.</p>}
        </div>

        {/* Results */}
        <div className="min-w-0 space-y-4">
          {error && <div className="card flex items-start gap-2 border-down/40 p-3 text-sm text-down"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{error}</div>}
          {!result && !error && (
            <div className="card p-6 text-sm text-ink-300">
              <h3 className="mb-2 flex items-center gap-2 font-semibold text-ink-100"><Info size={16} className="text-gold-400" /> How this tester works</h3>
              <ul className="list-disc space-y-1 pl-5 text-ink-400">
                <li>Uses real OHLC candles from your active feed ({source === 'mt5' ? 'Exness MT5 history' : source === 'twelvedata' ? 'Twelve Data — not Exness prices' : 'none connected'}). Nothing is simulated or randomised.</li>
                <li>Signals are computed on the candle close with causal indicators; orders fill at the next candle's open. No look-ahead, no repainting.</li>
                <li>Candle prices are bid. Longs pay the spread on entry; shorts' stops and targets trigger on ask.</li>
                <li><b className="text-ink-200">Tick-level accuracy is unavailable.</b> When SL and TP fall inside one candle the outcome is decided by your intrabar assumption. Use a lower timeframe for finer results.</li>
                <li>Swap/overnight financing is not modelled.</li>
              </ul>
            </div>
          )}
          {result && st && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
                <span className="rounded bg-ink-800 px-2 py-1">Data: {result.source === 'mt5' ? 'Exness MT5' : 'Twelve Data (not Exness)'}</span>
                <span className="rounded bg-ink-800 px-2 py-1">{result.barsCount.toLocaleString()} {tf} candles · {fmtDate(result.firstBar, tz)} → {fmtDate(result.lastBar, tz)}</span>
                <span className="rounded bg-ink-800 px-2 py-1">Intrabar: {cfg.intrabar}</span>
                <div className="ml-auto flex gap-2">
                  <button className="btn" onClick={() => showOnChart()}><Eye size={14} /> Show on chart</button>
                  <button className="btn" onClick={exportCsv}><Download size={14} /> CSV</button>
                  <button className="btn-gold" onClick={save}><Save size={14} /> Save</button>
                </div>
              </div>
              {[...result.warnings, ...(result.skipped.length ? [`${result.skipped.length} signals skipped (e.g. "${result.skipped[0].reason}")`] : [])].map((w) => (
                <div key={w} className="flex items-center gap-2 rounded-lg border border-gold-600/30 bg-gold-500/5 px-3 py-2 text-xs text-gold-300"><AlertTriangle size={14} />{w}</div>
              ))}
              <StatsGrid st={st} initial={cfg.initialBalance} />
              <div className="card p-3">
                <h3 className="mb-2 text-sm font-semibold text-ink-100">Equity & balance</h3>
                <EquityChart data={downsample(result.curve).map((p) => ({ label: fmtDate(p.time, tz), equity: p.equity, balance: p.balance }))} />
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="card p-3">
                  <h3 className="mb-2 text-sm font-semibold text-ink-100">Monthly performance</h3>
                  <PnlBars data={result.monthly.map((m) => ({ label: m.month, pnl: m.pnl }))} />
                </div>
                <div className="card max-h-[300px] overflow-auto">
                  <table className="table-x">
                    <thead><tr><th>Month</th><th>Trades</th><th>Win %</th><th>P&L</th><th>Return</th></tr></thead>
                    <tbody>{result.monthly.map((m) => <tr key={m.month}><td>{m.month}</td><td>{m.trades}</td><td>{pct(m.winRate)}</td><td className={pnlClass(m.pnl)}>{signedUsd(m.pnl)}</td><td className={pnlClass(m.pnl)}>{pct(m.returnPct, 2)}</td></tr>)}</tbody>
                  </table>
                </div>
              </div>
              <div className="card overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2"><h3 className="text-sm font-semibold text-ink-100">Trades ({result.trades.length})</h3><span className="text-[11px] text-ink-400">click column to sort · eye = inspect on chart</span></div>
                <div className="max-h-[480px] overflow-auto">
                  <table className="table-x font-mono text-xs">
                    <thead><tr>
                      {([['id', '#'], ['entryTime', 'Entry'], ['entryPrice', 'Price'], ['lots', 'Lots'], ['initialSl', 'SL'], ['exitTime', 'Exit'], ['exitPrice', 'Exit px'], ['pnl', 'Net P&L'], ['rMultiple', 'R'], ['bars', 'Bars']] as [keyof Trade, string][]).map(([k, l]) => (
                        <th key={k} className="cursor-pointer hover:text-gold-300" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (-s.dir as 1 | -1) : 1 }))}>{l}{sort.key === k ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</th>
                      ))}
                      <th>Side</th><th>Reason</th><th />
                    </tr></thead>
                    <tbody>
                      {sortedTrades.map((t) => (
                        <tr key={t.id}>
                          <td>{t.id}</td><td>{fmtDateTime(t.entryTime, tz)}</td><td>{num(t.entryPrice)}</td><td>{t.lots.toFixed(2)}</td>
                          <td>{Number.isFinite(t.initialSl) ? num(t.initialSl) : '—'}</td><td>{fmtDateTime(t.exitTime, tz)}</td><td>{num(t.exitPrice)}</td>
                          <td className={pnlClass(t.pnl)}>{signedUsd(t.pnl)}</td><td className={pnlClass(t.rMultiple)}>{Number.isFinite(t.rMultiple) ? t.rMultiple.toFixed(2) : '—'}</td><td>{t.bars}</td>
                          <td className={t.side === 'long' ? 'text-up' : 'text-down'}>{t.side}</td><td>{t.fills.map((f) => f.reason).join('+')}</td>
                          <td><button className="btn-icon" title="Inspect on chart" onClick={() => showOnChart(t)}><Eye size={13} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {saved.items.length > 0 && (
            <div className="card overflow-hidden">
              <h3 className="px-3 py-2 text-sm font-semibold text-ink-100">Saved backtests</h3>
              <div className="max-h-72 overflow-auto">
                <table className="table-x text-xs">
                  <thead><tr><th>Name</th><th>TF</th><th>Trades</th><th>Win %</th><th>Net</th><th>PF</th><th>Max DD</th><th>Data</th><th /></tr></thead>
                  <tbody>{saved.items.map((b) => (
                    <tr key={b.id}>
                      <td className="max-w-[240px] truncate">{b.name}</td><td>{b.tf}</td><td>{b.stats.totalTrades}</td><td>{pct(b.stats.winRate)}</td>
                      <td className={pnlClass(b.stats.netProfit)}>{signedUsd(b.stats.netProfit)}</td><td>{num(b.stats.profitFactor)}</td><td>{pct(b.stats.maxDrawdownPct)}</td><td>{b.source}</td>
                      <td className="flex gap-1">
                        <button className="btn-icon" title="Load result" onClick={() => {
                          setTf(b.tf); setFrom(b.from); setTo(b.to); setCfg(b.config); setStratType(b.strategy.type); setParams(b.strategy.params);
                          setResult({ trades: b.trades, curve: b.curve, stats: b.stats, monthly: b.monthly, skipped: [], warnings: ['Loaded from saved result (trade list may be truncated to 2,000).'], source: b.source, barsCount: b.barsCount, firstBar: b.from, lastBar: b.to });
                        }}><BarChart2 size={13} /></button>
                        <button className="btn-icon hover:text-down" title="Delete" onClick={() => confirm(`Delete "${b.name}"?`) && removeDoc('backtests', b.id)}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
      <CompareDialog open={compareOpen} onClose={() => setCompareOpen(false)} items={saved.items} />
    </div>
  );
}

function StatsGrid({ st, initial }: { st: Stats; initial: number }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      <Stat label="Net profit" value={signedUsd(st.netProfit)} sub={pct(st.returnPct, 2)} tone={st.netProfit >= 0 ? 'up' : 'down'} />
      <Stat label="Total trades" value={st.totalTrades} sub={`${st.longTrades} long · ${st.shortTrades} short`} />
      <Stat label="Win rate" value={pct(st.winRate)} sub={`${st.wins} W · ${st.losses} L`} />
      <Stat label="Profit factor" value={Number.isFinite(st.profitFactor) ? num(st.profitFactor) : '∞'} />
      <Stat label="Max drawdown" value={usd(st.maxDrawdown)} sub={pct(st.maxDrawdownPct, 2) + ' equity'} tone="down" />
      <Stat label="Final balance" value={usd(st.finalBalance)} sub={`from ${usd(initial)}`} tone="gold" />
      <Stat label="Gross profit" value={usd(st.grossProfit)} tone="up" />
      <Stat label="Gross loss" value={usd(-st.grossLoss)} tone="down" />
      <Stat label="Avg win" value={usd(st.avgWin)} tone="up" />
      <Stat label="Avg loss" value={usd(-st.avgLoss)} tone="down" />
      <Stat label="Avg win / avg loss" value={num(st.avgRR)} sub={`avg R ${Number.isFinite(st.avgR) ? num(st.avgR) : '—'}`} />
      <Stat label="Expected payoff" value={signedUsd(st.expectedPayoff)} sub="per trade" />
      <Stat label="Largest win" value={usd(st.largestWin)} tone="up" />
      <Stat label="Largest loss" value={usd(st.largestLoss)} tone="down" />
      <Stat label="Max consec. wins" value={st.maxConsecWins} />
      <Stat label="Max consec. losses" value={st.maxConsecLosses} />
      <Stat label="Commission" value={usd(st.commission)} />
      <Stat label="Recovery factor" value={num(st.recoveryFactor)} sub={`avg ${st.avgBars.toFixed(1)} bars/trade`} />
    </div>
  );
}

function CompareDialog({ open, onClose, items }: { open: boolean; onClose: () => void; items: SavedBacktest[] }) {
  const [sel, setSel] = useState<string[]>([]);
  const chosen = items.filter((i) => sel.includes(i.id));
  const colors = ['#e8c25a', '#6b8afd', '#22b07d', '#e5484d', '#c678dd', '#2f9bff'];
  const curveData = useMemo(() => {
    // Normalise each equity curve to % return on its own initial balance, sampled on a shared index.
    const N = 200;
    return Array.from({ length: N }, (_, k) => {
      const row: Record<string, any> = { label: `${Math.round((k / (N - 1)) * 100)}%` };
      chosen.forEach((b) => {
        const p = b.curve[Math.floor((k / (N - 1)) * (b.curve.length - 1))];
        if (p) row[b.id] = ((p.equity - b.config.initialBalance) / b.config.initialBalance) * 100;
      });
      return row;
    });
  }, [chosen]);
  const rows: [string, (s: Stats) => string][] = [
    ['Net profit', (s) => signedUsd(s.netProfit)], ['Return', (s) => pct(s.returnPct, 2)], ['Trades', (s) => String(s.totalTrades)], ['Win rate', (s) => pct(s.winRate)],
    ['Profit factor', (s) => num(s.profitFactor)], ['Max DD %', (s) => pct(s.maxDrawdownPct, 2)], ['Expected payoff', (s) => signedUsd(s.expectedPayoff)],
    ['Avg win/loss', (s) => num(s.avgRR)], ['Max consec. losses', (s) => String(s.maxConsecLosses)], ['Recovery factor', (s) => num(s.recoveryFactor)],
  ];
  const best = (f: (s: Stats) => number, hi = true) => { if (!chosen.length) return null; const v = chosen.map((c) => f(c.stats)); const m = hi ? Math.max(...v) : Math.min(...v); return chosen[v.indexOf(m)]?.id; };
  const winners: Record<string, string | null> = { 'Net profit': best((s) => s.netProfit), 'Profit factor': best((s) => s.profitFactor), 'Max DD %': best((s) => s.maxDrawdownPct, false), 'Expected payoff': best((s) => s.expectedPayoff), 'Recovery factor': best((s) => s.recoveryFactor) };
  return (
    <Modal open={open} onClose={onClose} title="Compare strategies" wide>
      <div className="mb-3 flex flex-wrap gap-1">
        {items.map((b) => <button key={b.id} className={`chip ${sel.includes(b.id) ? 'on' : ''}`} onClick={() => setSel((s) => (s.includes(b.id) ? s.filter((x) => x !== b.id) : [...s, b.id]))}>{b.name}</button>)}
        {!items.length && <p className="text-sm text-ink-400">Save a few backtests first.</p>}
      </div>
      {chosen.length > 0 && (
        <>
          <MultiLine data={curveData} series={chosen.map((b, i) => ({ key: b.id, name: b.name, color: colors[i % colors.length] }))} yFormat={(v) => `${v.toFixed(0)}%`} />
          <p className="mb-3 text-[11px] text-ink-400">Equity as % return, x-axis = share of each test's period (tests may cover different dates).</p>
          <div className="overflow-x-auto">
            <table className="table-x text-xs">
              <thead><tr><th />{chosen.map((b) => <th key={b.id}>{b.name}<div className="font-normal text-ink-400">{b.tf} · {b.source}</div></th>)}</tr></thead>
              <tbody>{rows.map(([l, f]) => <tr key={l}><td className="text-ink-400">{l}</td>{chosen.map((b) => <td key={b.id} className={winners[l] === b.id ? 'font-semibold text-gold-300' : ''}>{f(b.stats)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gold-400">{title}</h3>{children}</div>;
}

function Num({ v, on, step = 1 }: { v: number; on: (v: number) => void; step?: number }) {
  return <input type="number" className="input" value={Number.isFinite(v) ? v : ''} step={step} onChange={(e) => on(parseFloat(e.target.value || '0'))} />;
}

const iso = (s: number) => new Date(s * 1000).toISOString().replace('T', ' ').slice(0, 19);
function sanitize(s: Stats): Stats {
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Number.isFinite(v) ? v : v === Infinity ? 999999 : 0])) as unknown as Stats;
}
