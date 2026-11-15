import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { VercelRequest, VercelResponse } from '@vercel/node';

/** Verifies a Firebase Auth ID token (no service account needed: Google's public keys). */
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

export async function requireUser(req: VercelRequest, res: VercelResponse): Promise<string | null> {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  const h = String(req.headers.authorization ?? '');
  if (!projectId || !h.startsWith('Bearer ')) { res.status(401).json({ error: 'unauthorized' }); return null; }
  try {
    const { payload } = await jwtVerify(h.slice(7), JWKS, { issuer: `https://securetoken.google.com/${projectId}`, audience: projectId });
    if (!payload.sub) throw new Error('no subject');
    return payload.sub;
  } catch {
    res.status(401).json({ error: 'invalid token' });
    return null;
  }
}

/** Best-effort per-user rate limit (per serverless instance). */
const hits = new Map<string, number[]>();
export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > max;
}
