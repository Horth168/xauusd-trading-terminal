import type { VercelRequest, VercelResponse } from '@vercel/node';
import webpush from 'web-push';
import { rateLimited, requireUser } from './_auth';

/**
 * Sends one test notification to the caller's own push subscription. Lets you confirm iPhone/Android delivery
 * (with the app closed) even before the background scanner is running. VAPID private key is server-side only.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  const uid = await requireUser(req, res);
  if (!uid) return;
  if (rateLimited(`push:${uid}`, 5, 60_000)) { res.status(429).json({ error: 'Too many test notifications — wait a minute.' }); return; }
  const pub = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) { res.status(503).json({ error: 'not_configured', message: 'VAPID keys are not set on the server.' }); return; }
  const sub = req.body?.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) { res.status(400).json({ error: 'invalid subscription' }); return; }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:alerts@example.com', pub, priv);
  const delay = Math.min(30, Math.max(0, Number(req.body?.delaySec) || 0));
  if (delay) await new Promise((r) => setTimeout(r, delay * 1000));
  try {
    const r = await webpush.sendNotification(sub, JSON.stringify({ title: 'XAUUSD Analyst — test', body: 'Push notifications work on this device.', url: '/notifications', tag: 'test' }), { TTL: 600, urgency: 'high' });
    res.status(200).json({ ok: true, status: r.statusCode });
  } catch (e: any) {
    res.status(502).json({ ok: false, status: e?.statusCode ?? null, message: String(e?.body || e?.message || e).slice(0, 300) });
  }
}
