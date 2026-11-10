import { create } from 'zustand';
import { feed, useFeed } from '../market/feed';
import type { Bar } from '../market/types';
import { saveDoc, subscribeCollection, useAuth, type BaseDoc } from '../lib/db';
import { computeInstance } from '../indicators/registry';
import { useDrawings } from '../chart/drawings/model';
import { getSettings } from '../store/settings';
import { tzOffset } from '../lib/time';

export interface AlertDoc extends BaseDoc {
  kind: 'price' | 'indicator' | 'signal';
  active: boolean;
  message: string;
  once: boolean;
  // price
  price?: number;
  condition?: 'above' | 'below' | 'cross';
  // indicator: plot value crossing a level / signal: script or builtin signal on bar close
  tf?: string;
  indicator?: { type: string; params: Record<string, any> };
  plotId?: string;
  level?: number;
  signal?: 'long' | 'short' | 'any' | 'script-alert';
  lastTriggered?: number;
  triggerCount?: number;
}

export interface Toast { id: number; title: string; body: string; time: number }

interface AlertState {
  alerts: AlertDoc[];
  toasts: Toast[];
  log: Toast[];
  drawingAlerts: boolean;
  pushToast: (title: string, body: string) => void;
  dismiss: (id: number) => void;
  setDrawingAlerts: (v: boolean) => void;
}

let toastSeq = 0;
export const useAlerts = create<AlertState>((set) => ({
  alerts: [],
  toasts: [],
  log: [],
  drawingAlerts: localStorage.getItem('xau-drawing-alerts') === '1',
  pushToast: (title, body) => {
    const t = { id: ++toastSeq, title, body, time: Date.now() };
    set((s) => ({ toasts: [...s.toasts.slice(-4), t], log: [t, ...s.log].slice(0, 200) }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), 9000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  setDrawingAlerts: (v) => { localStorage.setItem('xau-drawing-alerts', v ? '1' : '0'); set({ drawingAlerts: v }); },
}));

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

async function notify(title: string, body: string) {
  useAlerts.getState().pushToast(title, body);
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, icon: '/pwa-192x192.png', badge: '/pwa-64x64.png', tag: `${title}-${body}` });
    else new Notification(title, { body, icon: '/pwa-192x192.png' });
  } catch (e) {
    console.warn('Notification failed', e);
  }
}

async function fire(a: AlertDoc, detail: string) {
  await notify('XAUUSD alert', `${a.message || detail}${a.message ? ` — ${detail}` : ''}`);
  await saveDoc<AlertDoc>('alerts', { ...a, lastTriggered: Date.now(), triggerCount: (a.triggerCount ?? 0) + 1, active: a.once ? false : a.active });
}

export async function createPriceAlert(price: number, current?: number) {
  const condition = current == null ? 'cross' : price > current ? 'above' : 'below';
  await saveDoc<AlertDoc>('alerts', { kind: 'price', active: true, once: true, price: Math.round(price * 100) / 100, condition, message: `Price ${condition === 'above' ? 'rises above' : condition === 'below' ? 'falls below' : 'crosses'} ${price.toFixed(2)}` });
  await requestNotificationPermission();
}

// ---------------- evaluation loop ----------------
let prevPrice: number | null = null;
const drawingState = new Map<string, number>(); // drawing id+level -> last side
const barSubs = new Map<string, { unsub: () => void; bars: Bar[]; lastClosed: number }>();

function crossed(prev: number, cur: number, level: number, cond: 'above' | 'below' | 'cross') {
  const up = prev < level && cur >= level, dn = prev > level && cur <= level;
  return cond === 'above' ? up : cond === 'below' ? dn : up || dn;
}

function onPrice(price: number) {
  const p = prevPrice;
  prevPrice = price;
  if (p == null) return;
  for (const a of useAlerts.getState().alerts) {
    if (a.kind !== 'price' || !a.active || a.price == null) continue;
    if (crossed(p, price, a.price, a.condition ?? 'cross')) fire(a, `price ${price.toFixed(2)} hit ${a.price.toFixed(2)}`);
  }
  if (useAlerts.getState().drawingAlerts) {
    for (const d of useDrawings.getState().items) {
      const levels: [string, number][] = [];
      if (d.type === 'stoploss' || d.type === 'takeprofit' || d.type === 'entry') levels.push([d.type, d.points[0].price]);
      if ((d.type === 'long' || d.type === 'short') && d.points.length === 3) levels.push(['entry', d.points[0].price], ['stoploss', d.points[1].price], ['takeprofit', d.points[2].price]);
      for (const [name, level] of levels) {
        const key = `${d.id}:${name}`;
        const side = Math.sign(price - level);
        const before = drawingState.get(key);
        drawingState.set(key, side);
        if (before != null && before !== 0 && side !== before) {
          notify(`${name === 'stoploss' ? 'Stop loss' : name === 'takeprofit' ? 'Take profit' : 'Entry'} level hit`, `XAUUSD ${price.toFixed(2)} crossed ${level.toFixed(2)}`);
        }
      }
    }
  }
}

async function evaluateBarAlerts(tf: string, bars: Bar[]) {
  const closedIdx = bars.length - 2; // only CLOSED bars trigger: no repainting alerts
  if (closedIdx < 1) return;
  const tzOff = tzOffset(getSettings().timezone, bars[closedIdx].time);
  for (const a of useAlerts.getState().alerts) {
    if (!a.active || a.tf !== tf || !a.indicator || (a.kind !== 'indicator' && a.kind !== 'signal')) continue;
    try {
      const out = await computeInstance({ uid: a.id, type: a.indicator.type, params: a.indicator.params, colors: {}, lineWidth: 1, visible: true }, bars, tzOff);
      if (a.kind === 'indicator') {
        const plot = out.plots.find((p) => p.id === a.plotId) ?? out.plots[0];
        if (!plot || a.level == null) continue;
        const v0 = plot.values[closedIdx - 1], v1 = plot.values[closedIdx];
        if (Number.isFinite(v0) && Number.isFinite(v1) && crossed(v0, v1, a.level, a.condition ?? 'cross')) fire(a, `${plot.title} ${v1.toFixed(2)} crossed ${a.level} on ${tf} close`);
      } else {
        const s = out.signals;
        const hit = a.signal === 'long' ? s.long[closedIdx] : a.signal === 'short' ? s.short[closedIdx] : a.signal === 'any' ? s.long[closedIdx] || s.short[closedIdx] : false;
        const scriptAlert = out.alerts.find((x) => x.index === closedIdx);
        if (hit) fire(a, `${s.long[closedIdx] ? 'LONG' : 'SHORT'} entry condition on ${tf} bar close`);
        else if (a.signal === 'script-alert' && scriptAlert) fire(a, scriptAlert.message);
      }
    } catch (e) {
      console.warn('Alert evaluation failed', a.id, e);
    }
  }
}

function syncBarSubscriptions(alerts: AlertDoc[]) {
  const needed = new Set(alerts.filter((a) => a.active && a.tf && (a.kind === 'indicator' || a.kind === 'signal')).map((a) => a.tf!));
  for (const [tf, s] of barSubs) if (!needed.has(tf)) { s.unsub(); barSubs.delete(tf); }
  for (const tf of needed) {
    if (barSubs.has(tf) || !useFeed.getState().source) continue;
    const entry = { unsub: () => {}, bars: [] as Bar[], lastClosed: 0 };
    barSubs.set(tf, entry);
    feed.load(tf, 600).then((bars) => {
      entry.bars = bars.slice(-600);
      entry.lastClosed = bars[bars.length - 1]?.time ?? 0;
      entry.unsub = feed.subscribe(tf, (bar) => {
        const last = entry.bars[entry.bars.length - 1];
        if (last && bar.time === last.time) entry.bars[entry.bars.length - 1] = bar;
        else if (!last || bar.time > last.time) {
          entry.bars.push(bar);
          if (entry.bars.length > 800) entry.bars.shift();
          evaluateBarAlerts(tf, entry.bars); // a new bar opened => previous bar closed
        }
      });
    }).catch(() => barSubs.delete(tf));
  }
}

let started = false;
export function startAlertEngine() {
  if (started) return;
  started = true;
  let unsub: (() => void) | null = null;
  const attach = () => {
    unsub?.();
    unsub = subscribeCollection<AlertDoc>('alerts', (alerts) => {
      useAlerts.setState({ alerts });
      syncBarSubscriptions(alerts);
    });
  };
  attach();
  useAuth.subscribe((s, p) => { if (s.user?.uid !== p.user?.uid) attach(); });
  useFeed.subscribe((s, p) => {
    if (s.tick && s.tick !== p.tick) onPrice(s.tick.bid);
    if (s.generation !== p.generation) {
      prevPrice = null;
      for (const sub of barSubs.values()) sub.unsub();
      barSubs.clear();
      syncBarSubscriptions(useAlerts.getState().alerts);
    }
  });
}
