import type { VercelRequest, VercelResponse } from '@vercel/node';
import { rateLimited, requireUser } from './_auth';
import { auditNumbers } from '../src/ai/audit';

/**
 * AI Analyst Q&A. The LLM only explains a stored, deterministic analysis report — it receives no tools, cannot
 * fetch prices and cannot trade. Every price in its answer is audited against the report.
 */
const SYSTEM = `You are an XAUUSD (gold) analysis assistant inside a personal, analysis-only trading app.
Rules:
- Use ONLY the JSON analysis report and signal history provided. Never invent prices, indicator values, news, order flow or institutional activity.
- If the report does not contain what is needed, say so plainly.
- Never instruct the user to place, modify or close a trade automatically. You may describe what the rules require before a BUY or SELL.
- The evidence score is a rule-based checklist, not a probability. Do not promise outcomes.
- Answer in clear, short paragraphs or bullet points. Quote prices exactly as given in the report.
- Always end with a "Data" line: data source, market timestamp (UTC), timeframe, and one limitation.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  const uid = await requireUser(req, res);
  if (!uid) return;
  if (rateLimited(`ai:${uid}`, 12, 60_000)) { res.status(429).json({ error: 'Rate limit: wait a minute.' }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(501).json({ error: 'not_configured', message: 'No AI model configured (ANTHROPIC_API_KEY). Rule-based answers are shown instead.' }); return; }
  const question = String(req.body?.question ?? '').slice(0, 600);
  const report = req.body?.report;
  const history = Array.isArray(req.body?.signals) ? req.body.signals.slice(0, 10) : [];
  if (!question || !report || typeof report !== 'object') { res.status(400).json({ error: 'question and report are required' }); return; }
  const context = JSON.stringify({ report, recentSignals: history }).slice(0, 60_000);
  const model = String(process.env.AI_MODEL || 'claude-sonnet-5-5');
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 900, system: SYSTEM, messages: [{ role: 'user', content: `ANALYSIS DATA (JSON):\n${context}\n\nQUESTION: ${question}` }] }),
    });
    const j: any = await r.json();
    if (!r.ok) { res.status(502).json({ error: 'model_error', message: j?.error?.message ?? `HTTP ${r.status}` }); return; }
    const answer = (j.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
    res.status(200).json({ answer, model, flagged: auditNumbers(answer, { report, history }) });
  } catch (e: any) {
    res.status(502).json({ error: 'model_unreachable', message: String(e?.message ?? e) });
  }
}
