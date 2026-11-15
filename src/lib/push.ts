/** Web Push subscription management (iOS 16.4+ Home-Screen app, Android, desktop). */
import { idToken, removeDoc, saveDoc } from './db';

export const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '';

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function pushSupport(): { ok: boolean; reason: string } {
  if (!VAPID_PUBLIC_KEY) return { ok: false, reason: 'Push keys are not configured on the server yet.' };
  if (isIOS() && !isStandalone()) return { ok: false, reason: 'On iPhone, open the app from your Home Screen (Safari → Share → Add to Home Screen), then enable notifications there.' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { ok: false, reason: 'This browser does not support Web Push (iPhone needs iOS 16.4 or newer).' };
  return { ok: true, reason: '' };
}

function b64ToBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function subscriptionId(endpoint: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(h)).slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Must be called from a user tap (iOS requirement). */
export async function enablePush(): Promise<PushSubscription> {
  const sup = pushSupport();
  if (!sup.ok) throw new Error(sup.reason);
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notification permission was not granted. Enable it in iPhone Settings → Notifications → XAU Terminal.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
  const json = sub.toJSON();
  await saveDoc('push_subscriptions', {
    id: await subscriptionId(sub.endpoint),
    endpoint: sub.endpoint,
    keys: json.keys,
    device: `${isIOS() ? 'iPhone/iPad' : /Android/.test(navigator.userAgent) ? 'Android' : 'Desktop'} · ${navigator.userAgent.slice(0, 80)}`,
  } as any);
  return sub;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await removeDoc('push_subscriptions', await subscriptionId(sub.endpoint)).catch(() => {});
  await sub.unsubscribe();
}

/** Direct test via the Vercel endpoint (works without the scanner). */
export async function testPushDirect(delaySec = 0): Promise<string> {
  const sub = await currentSubscription();
  if (!sub) throw new Error('Enable notifications first.');
  const token = await idToken();
  const r = await fetch('/api/push-test', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ subscription: sub.toJSON(), delaySec }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.message || j.error || `HTTP ${r.status}`);
  return 'Test notification sent.';
}

/** Test through the background scanner (proves the full server-side path). */
export async function testPushViaScanner() {
  await saveDoc('push_requests', { status: 'pending' } as any);
}
