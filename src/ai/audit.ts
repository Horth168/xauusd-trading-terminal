/**
 * Number audit for AI-written text (pattern from Vibe-Trading's report_audit): every price-like number in an LLM
 * answer must exist in the analysis report it was grounded on. Unknown numbers are flagged to the user.
 */
export function collectNumbers(obj: unknown, out = new Set<number>()): Set<number> {
  if (typeof obj === 'number' && Number.isFinite(obj)) out.add(obj);
  else if (typeof obj === 'string') for (const m of obj.matchAll(/-?\d[\d,]*\.?\d*/g)) { const v = Number(m[0].replace(/,/g, '')); if (Number.isFinite(v)) out.add(v); }
  else if (Array.isArray(obj)) obj.forEach((x) => collectNumbers(x, out));
  else if (obj && typeof obj === 'object') Object.values(obj).forEach((x) => collectNumbers(x, out));
  return out;
}

/** Returns price-like numbers (≥ 100, e.g. gold prices) in `text` that are not within `tol` of any report number. */
export function auditNumbers(text: string, report: unknown, tol = 0.051): number[] {
  const known = [...collectNumbers(report)];
  const found = [...text.matchAll(/\d{3,5}(?:,\d{3})*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, ''))).filter((v) => v >= 100);
  return [...new Set(found)].filter((v) => !known.some((k) => Math.abs(k - v) <= tol));
}
