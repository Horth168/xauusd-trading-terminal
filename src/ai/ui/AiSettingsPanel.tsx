import { Field } from '../../components/ui';
import { useAiConfigLoaded } from '../client';
import { BUILTIN_AI_STRATEGIES } from '../strategies';
import { useScripts } from '../../indicators/registry';
import type { AiConfig } from '../config';

/** AI analyst configuration, saved to Firestore (settings/ai) and used by both the app and the scanner. */
export function AiSettingsPanel() {
  const { cfg, save } = useAiConfigLoaded();
  const scripts = useScripts((s) => s.scripts.filter((x) => x.kind === 'strategy'));
  const num = (k: keyof AiConfig, v: string) => save({ [k]: Number(v) } as Partial<AiConfig>);
  const per = (k: keyof AiConfig['periods'], v: string) => save({ periods: { ...cfg.periods, [k]: Math.max(1, Math.round(Number(v))) } });
  const strat = (id: string, enabled: boolean) => save({ strategies: { ...cfg.strategies, [id]: { enabled } } });
  return (
    <section className="card space-y-4 p-4">
      <div>
        <h2 className="font-semibold text-ink-100">AI analyst</h2>
        <p className="text-xs text-ink-400">Rules used for every analysis, signal, notification and AI backtest. Saved to your account and picked up by the scanner automatically.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Entry timeframe"><select className="input" value={cfg.entryTf} onChange={(e) => save({ entryTf: e.target.value as AiConfig['entryTf'] })}><option value="M5">M5</option><option value="M15">M15</option></select></Field>
        <Field label="Minimum evidence score" hint="0–100 checklist"><input type="number" className="input" min={40} max={100} value={cfg.minScore} onChange={(e) => num('minScore', e.target.value)} /></Field>
        <Field label="Minimum risk : reward"><input type="number" step={0.5} min={1} className="input" value={cfg.minRR} onChange={(e) => num('minRR', e.target.value)} /></Field>
        <Field label="ATR stop multiplier"><input type="number" step={0.1} min={0.5} className="input" value={cfg.atrSlMult} onChange={(e) => num('atrSlMult', e.target.value)} /></Field>
        <Field label="Max stop width (ATR)"><input type="number" step={0.5} min={1} className="input" value={cfg.maxSlAtr} onChange={(e) => num('maxSlAtr', e.target.value)} /></Field>
        <Field label="Maximum spread ($)" hint="0.40 = 40 pts on XAUUSDm"><input type="number" step={0.05} min={0} className="input" value={cfg.maxSpread} onChange={(e) => num('maxSpread', e.target.value)} /></Field>
        <Field label="Signal expiry (candles)"><input type="number" min={1} className="input" value={cfg.expiryBars} onChange={(e) => num('expiryBars', e.target.value)} /></Field>
        <Field label="Trigger window (candles)"><input type="number" min={1} max={10} className="input" value={cfg.triggerLookback} onChange={(e) => num('triggerLookback', e.target.value)} /></Field>
        <Field label="Scan every (seconds)"><input type="number" min={10} className="input" value={cfg.scanIntervalSec} onChange={(e) => num('scanIntervalSec', e.target.value)} /></Field>
      </div>
      <div>
        <span className="label">Indicator periods</span>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {(['emaFast', 'emaSlow', 'stochK', 'stochSmooth', 'stochD', 'cci', 'atr', 'rsi', 'adx'] as const).map((k) => (
            <label key={k} className="block"><span className="mb-0.5 block text-[11px] text-ink-400">{k}</span><input type="number" min={1} className="input py-1.5" value={cfg.periods[k]} onChange={(e) => per(k, e.target.value)} /></label>
          ))}
        </div>
      </div>
      <div>
        <span className="label">Strategies</span>
        <div className="space-y-1.5">
          {[...BUILTIN_AI_STRATEGIES.map((s) => ({ id: s.id, name: s.name, d: s.description })), ...scripts.map((s) => ({ id: `custom:${s.id}`, name: `${s.name} (my script)`, d: 'Custom XTS strategy' }))].map((s) => {
            const on = cfg.strategies[s.id]?.enabled ?? !s.id.startsWith('custom:');
            return (
              <label key={s.id} className="flex cursor-pointer items-start gap-3 rounded-xl bg-white/[0.03] p-3">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-gold-500" checked={on} onChange={(e) => strat(s.id, e.target.checked)} />
                <span><span className="block text-sm text-ink-100">{s.name}</span><span className="block text-xs text-ink-400">{s.d}</span></span>
              </label>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(['asia', 'london', 'newyork'] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 rounded-xl bg-white/[0.03] p-2.5 text-sm text-ink-200"><input type="checkbox" className="accent-gold-500" checked={cfg.sessions[k]} onChange={(e) => save({ sessions: { ...cfg.sessions, [k]: e.target.checked } })} />{k === 'newyork' ? 'New York' : k[0].toUpperCase() + k.slice(1)}</label>
        ))}
      </div>
      <Field label="AI explanation model" hint="Rule-based answers always work. A model adds natural-language explanations (needs ANTHROPIC_API_KEY on Vercel).">
        <select className="input" value={cfg.ai.provider} onChange={(e) => save({ ai: { ...cfg.ai, provider: e.target.value as AiConfig['ai']['provider'] } })}><option value="none">Rule-based only</option><option value="anthropic">Anthropic Claude</option></select>
      </Field>
      <label className="flex items-center gap-2 text-sm text-ink-300"><input type="checkbox" className="accent-gold-500" checked={cfg.allowFormingCandle} onChange={(e) => save({ allowFormingCandle: e.target.checked })} /> Allow signals from the still-forming candle (not recommended — can repaint)</label>
    </section>
  );
}
