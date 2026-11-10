import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Trash2 } from 'lucide-react';
import { Modal } from '../components/ui';
import { useDrawings, type Drawing } from './drawings/model';
import { useFeed } from '../market/feed';
import { useSettings } from '../store/settings';
import { getTimeframe } from '../market/timeframes';
import { num } from '../lib/format';

/**
 * Exact-price editor for Long/Short position drawings: type the entry, stop loss, take profit and lot size,
 * see risk/reward in $ and R, and the drawing on the chart updates to match.
 */
export function PositionDialog() {
  const dlg = useDrawings((s) => s.positionDialog);
  const items = useDrawings((s) => s.items);
  const { update, add, remove, select } = useDrawings();
  const tick = useFeed((s) => s.tick);
  const digits = useFeed((s) => s.symbol.digits);
  const contract = useSettings((s) => s.contractSize);
  const tf = useSettings((s) => s.charts[s.activeChart]?.tf ?? 'M15');

  const existing = dlg?.id ? items.find((d) => d.id === dlg.id) : undefined;
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [entry, setEntry] = useState('');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [lots, setLots] = useState('0.10');

  useEffect(() => {
    if (!dlg) return;
    const f = (v: number) => v.toFixed(digits);
    if (existing && existing.points.length >= 3) {
      setSide(existing.type === 'short' ? 'short' : 'long');
      setEntry(f(existing.points[0].price));
      setSl(f(existing.points[1].price));
      setTp(f(existing.points[2].price));
      setLots(String(existing.lots ?? 0.1));
    } else {
      // New position from exact prices: default to the current market (ask for longs, bid for shorts), 1:2.
      const s = dlg.side ?? 'long';
      const px = tick ? (s === 'long' ? tick.ask ?? tick.bid : tick.bid) : 0;
      const risk = px * 0.0025;
      setSide(s);
      setEntry(px ? f(px) : '');
      setSl(px ? f(s === 'long' ? px - risk : px + risk) : '');
      setTp(px ? f(s === 'long' ? px + 2 * risk : px - 2 * risk) : '');
      setLots('0.10');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dlg]);

  if (!dlg) return null;
  const close = () => useDrawings.setState({ positionDialog: null });

  const e = parseFloat(entry), s = parseFloat(sl), t = parseFloat(tp), l = parseFloat(lots);
  const valid = [e, s, t, l].every(Number.isFinite) && l > 0;
  const dir = side === 'long' ? 1 : -1;
  const riskPx = valid ? (e - s) * dir : NaN;
  const rewardPx = valid ? (t - e) * dir : NaN;
  const riskUsd = riskPx * l * contract, rewardUsd = rewardPx * l * contract;
  const rr = riskPx > 0 ? rewardPx / riskPx : NaN;
  const pts = (v: number) => Math.round(Math.abs(v) * 10 ** digits);
  const wrongSide = valid && (riskPx <= 0 || rewardPx <= 0);

  const setRR = (r: number) => { if (Number.isFinite(e) && Number.isFinite(s)) setTp((e + dir * Math.abs(e - s) * r).toFixed(digits)); };
  const flip = (next: 'long' | 'short') => {
    if (next === side) return;
    setSide(next);
    // Mirror SL/TP around the entry so the levels stay on the correct side.
    if (Number.isFinite(e) && Number.isFinite(s) && Number.isFinite(t)) { setSl((2 * e - s).toFixed(digits)); setTp((2 * e - t).toFixed(digits)); }
  };

  const save = () => {
    if (!valid || wrongSide) return;
    const color = side === 'long' ? '#22b07d' : '#e5484d';
    if (existing) {
      const [p0, p1] = existing.points;
      update(existing.id, { type: side, color, lots: l, points: [{ time: p0.time, price: e }, { time: p1.time, price: s }, { time: p1.time, price: t }] });
    } else {
      const secs = getTimeframe(tf).seconds;
      const now = Math.floor(Date.now() / 1000 / secs) * secs;
      const end = now + secs * 25;
      const d = add({ type: side, color, width: 1, style: 'solid', fill: 0.12, lots: l, points: [{ time: now, price: e }, { time: end, price: s }, { time: end, price: t }] } as Omit<Drawing, 'id'>);
      select(d.id);
    }
    close();
  };

  const input = 'h-11 w-full rounded-xl border border-ink-600/70 bg-ink-900 px-3 text-right font-mono text-[15px] text-ink-100 outline-none transition-all focus:border-gold-500 focus:ring-4 focus:ring-gold-500/10';
  const row = (label: string, value: string, set: (v: string) => void, hint?: React.ReactNode, tone = '') => (
    <label className="grid grid-cols-[96px_1fr] items-center gap-3">
      <span className={`text-sm font-medium ${tone || 'text-ink-300'}`}>{label}</span>
      <div>
        <input className={input} inputMode="decimal" value={value} onChange={(ev) => set(ev.target.value.replace(',', '.'))} />
        {hint && <div className="mt-1 text-right text-[11px] text-ink-400">{hint}</div>}
      </div>
    </label>
  );

  return (
    <Modal open onClose={close} title={existing ? 'Position settings' : 'New position'}
      footer={<>
        {existing && <button className="btn-danger mr-auto" onClick={() => { remove(existing.id); close(); }}><Trash2 size={15} /> Delete</button>}
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn-gold" disabled={!valid || wrongSide} onClick={save}>{existing ? 'Apply' : 'Place on chart'}</button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => flip('long')} className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all active:scale-[0.98] ${side === 'long' ? 'bg-up text-ink-950' : 'bg-ink-800 text-ink-300'}`}><ArrowUpRight size={17} /> Long / Buy</button>
          <button onClick={() => flip('short')} className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all active:scale-[0.98] ${side === 'short' ? 'bg-down text-white' : 'bg-ink-800 text-ink-300'}`}><ArrowDownRight size={17} /> Short / Sell</button>
        </div>

        {row('Entry price', entry, setEntry, tick ? <button className="text-gold-400" onClick={() => setEntry((side === 'long' ? tick.ask ?? tick.bid : tick.bid).toFixed(digits))}>Use market {num(side === 'long' ? tick.ask ?? tick.bid : tick.bid, digits)}</button> : undefined)}
        {row('Stop loss', sl, setSl, Number.isFinite(riskPx) ? `${num(Math.abs(riskPx), digits)} · ${pts(riskPx)} pts` : undefined, 'text-down')}
        {row('Take profit', tp, setTp, Number.isFinite(rewardPx) ? `${num(Math.abs(rewardPx), digits)} · ${pts(rewardPx)} pts` : undefined, 'text-up')}
        <div className="flex justify-end gap-1.5">
          {[1, 1.5, 2, 3].map((r) => <button key={r} className="chip border border-white/5" onClick={() => setRR(r)}>TP {r}R</button>)}
        </div>
        {row('Lot size', lots, setLots, `${contract} oz per lot`)}

        <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/5 bg-ink-900 p-3 text-center">
          <div><div className="text-[11px] uppercase tracking-wider text-ink-400">Risk</div><div className="mt-1 font-semibold tabular-nums text-down">{Number.isFinite(riskUsd) ? `-$${num(Math.abs(riskUsd))}` : '—'}</div></div>
          <div><div className="text-[11px] uppercase tracking-wider text-ink-400">Reward</div><div className="mt-1 font-semibold tabular-nums text-up">{Number.isFinite(rewardUsd) ? `+$${num(Math.abs(rewardUsd))}` : '—'}</div></div>
          <div><div className="text-[11px] uppercase tracking-wider text-ink-400">R : R</div><div className="mt-1 font-semibold tabular-nums text-gold-300">{Number.isFinite(rr) && rr > 0 ? `1 : ${rr.toFixed(2)}` : '—'}</div></div>
        </div>
        {wrongSide && <p className="rounded-xl bg-down/10 px-3 py-2 text-sm text-down">For a {side}, the stop loss must be {side === 'long' ? 'below' : 'above'} the entry and the take profit {side === 'long' ? 'above' : 'below'} it.</p>}
        <p className="text-[11px] text-ink-400">This is a planning tool on your chart — it does not place an order with your broker.</p>
      </div>
    </Modal>
  );
}
