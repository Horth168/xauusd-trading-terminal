import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ twelvedata: Boolean(process.env.TWELVEDATA_API_KEY), time: Date.now() });
}
