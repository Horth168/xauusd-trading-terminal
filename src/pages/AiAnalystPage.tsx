import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Bot, Loader2, RefreshCw, Send, Sparkles, User } from 'lucide-react';
import { useLiveAnalysis } from '../ai/ui/useLiveAnalysis';
import { AgentCard, DecisionBadge, PlanCard, ReasonList, ScoreBars, StatusBadge } from '../ai/ui/components';
import { SignalChart } from '../ai/ui/SignalChart';
import { useAiOverlay } from '../ai/ui/overlayStore';
import { answerLocally, PRESET_QUESTIONS } from '../ai/answers';
import { feed, useFeed } from '../market/feed';
import { idToken } from '../lib/db';
import { fmtDateTime } from '../lib/time';
import { useSettings } from '../store/settings';
import type { Bar } from '../market/types';

interface Msg { role: 'user' | 'assistant'; text: string; via?: string; flagged?: number[] }

export default function AiAnalystPage() {
  const nav = useNavigate();
  const tz = useSettings((s) => s.timezone);
  const a = useLiveAnalysis();
  const r = a.report;
  const generation = useFeed((s) => s.generation);
  const [bars, setBars] = useState<Bar[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [asking, setAsking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!r) return;
    feed.load(r.entryTf, 200).then((b) => setBars(b.filter((x) => x.time <= r.barTime).slice(-150))).catch(() => setBars([]));
  }, [r?.id, generation]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs]);

  const ask = async (question: string) => {
    if (!r || !question.trim()) return;
    setQ('');
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    setAsking(true);
    const local = answerLocally(question, r, a.signals);
    if (a.cfg.ai.provider === 'none') { setMsgs((m) => [...m, { role: 'assistant', text: local, via: 'rule-based analyst' }]); setAsking(false); return; }
    try {
      const token = await idToken();
      const res = await fetch('/api/analyst', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ question, report: { ...r, overlay: { ...r.overlay, zones: r.overlay.zones.slice(-6) } }, signals: a.signals.slice(0, 8).map(({ candles, ...s }) => s) }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.answer) setMsgs((m) => [...m, { role: 'assistant', text: j.answer, via: j.model, flagged: j.flagged }]);
      else setMsgs((m) => [...m, { role: 'assistant', text: local, via: 'rule-based (no AI model configured)' }]);
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', text: local, via: 'rule-based (offline)' }]);
    } finally { setAsking(false); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="hidden text-2xl font-semibold tracking-tight text-ink-100 md:block">AI Gold Analyst</h1>
          <p className="text-sm text-ink-400">Six analysts review XAUUSD on real candles. Analysis only — you place every trade yourself.</p>
        </div>
        <button className="btn-gold" onClick={a.run} disabled={a.running}>{a.running ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Analyze XAUUSD now</button>
      </div>
      {a.error && <div className="flex items-center gap-2 rounded-2xl border border-down/30 bg-down/10 px-4 py-3 text-sm text-down"><AlertTriangle size={16} />{a.error}</div>}

      {r && (
        <>
          <div className="card p-5">
            <div className="flex flex-wrap items-center gap-3">
              <DecisionBadge decision={r.decision} large />
              <StatusBadge status={r.status} />
              {r.strategyName && <span className="text-sm text-ink-300">{r.strategyName} · {r.entryTf}</span>}
              <span className="ml-auto text-xs text-ink-400">{a.origin} · {fmtDateTime(r.createdAt, tz)} · {r.market.source === 'mt5' ? `Exness MT5${r.market.live ? ' live' : ''}` : 'Twelve Data (delayed)'}</span>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
              <div>
                <SignalChart bars={bars} overlay={r.overlay} markTime={r.decision !== 'WAIT' ? r.barTime : undefined} height={340} />
                <button className="mt-2 text-xs text-gold-400 hover:underline" onClick={() => { useAiOverlay.getState().show(r); nav('/chart'); }}>Open on the main chart with your drawings →</button>
              </div>
              <div className="space-y-4">
                {r.plan ? (
                  <div className={`rounded-2xl border p-3 ${r.decision !== 'WAIT' ? 'border-gold-500/25 bg-gold-500/[0.04]' : 'border-white/5 bg-white/[0.02]'}`}>
                    {r.decision === 'WAIT' && <p className="mb-1 text-xs text-ink-400">Plan for the forming setup — not confirmed:</p>}
                    <PlanCard plan={r.plan} digits={r.market.digits} />
                  </div>
                ) : <p className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 text-sm text-ink-400">No trade plan — no strategy has its core conditions in place.</p>}
                <ScoreBars score={r.score} min={r.minScore} />
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card space-y-4 p-5">
              {r.decision === 'WAIT' && <ReasonList title="Why WAIT" items={r.waitReasons} tone="muted" />}
              <ReasonList title="Evidence for" items={r.reasonsFor.slice(0, 10)} tone="up" />
              <ReasonList title="Evidence against / risks" items={r.reasonsAgainst.slice(0, 10)} tone="down" />
              {r.plan && <ReasonList title="Invalidation" items={[r.plan.invalidation]} tone="down" />}
              {r.plan && <ReasonList title="How the prices were calculated" items={r.plan.calc} tone="muted" />}
            </div>
            <div className="card p-5">
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Strategy checklist</h3>
              <div className="space-y-1.5">
                {r.candidates.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2 text-sm">
                    <span className={`w-12 font-semibold ${c.side === 'BUY' ? 'text-up' : 'text-down'}`}>{c.side}</span>
                    <span className="flex-1 truncate text-ink-200">{c.strategy}</span>
                    <span className="font-mono text-xs text-ink-400">{c.met}/{c.total}</span>
                    <StatusBadge status={c.status} />
                  </div>
                ))}
              </div>
              <h3 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Limitations</h3>
              <ul className="space-y-1 text-xs text-ink-400">{r.limitations.map((l, i) => <li key={i}>• {l}</li>)}</ul>
              <p className="mt-3 text-[10.5px] text-ink-500">Report {r.id} · config {r.configHash}</p>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Multi-agent reports</h2>
            {r.agents.map((ag) => <AgentCard key={ag.agent} a={ag} defaultOpen={ag.agent === 'reviewer'} />)}
          </div>
        </>
      )}

      {/* Ask the analyst */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-white/5 px-5 py-3"><Sparkles size={17} className="text-gold-400" /><h2 className="font-semibold text-ink-100">Ask the analyst</h2></div>
        <div className="max-h-[480px] space-y-3 overflow-y-auto px-5 py-4">
          {!msgs.length && <p className="text-sm text-ink-400">Answers use the current analysis report and your stored signals — never invented prices.</p>}
          {msgs.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : ''}`}>
              {m.role === 'assistant' && <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold-500/15 text-gold-300"><Bot size={15} /></span>}
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${m.role === 'user' ? 'bg-gold-500 text-ink-950' : 'bg-white/[0.04] text-ink-200'}`}>
                {m.text}
                {m.via && <div className="mt-2 text-[10.5px] text-ink-500">via {m.via}</div>}
                {!!m.flagged?.length && <div className="mt-1 text-[11px] text-gold-300">⚠ Numbers not found in the report: {m.flagged.join(', ')} — treat them with caution.</div>}
              </div>
              {m.role === 'user' && <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-ink-300"><User size={15} /></span>}
            </div>
          ))}
          {asking && <div className="flex items-center gap-2 text-sm text-ink-400"><Loader2 size={15} className="animate-spin" /> Thinking…</div>}
          <div ref={endRef} />
        </div>
        <div className="flex gap-2 overflow-x-auto border-t border-white/5 px-4 py-2.5 [scrollbar-width:none]">
          {PRESET_QUESTIONS.map((p) => <button key={p} disabled={!r || asking} onClick={() => ask(p)} className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-ink-200 transition-colors hover:border-gold-500/40 hover:text-gold-300 disabled:opacity-40">{p}</button>)}
        </div>
        <form className="flex gap-2 border-t border-white/5 p-3" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
          <input className="input h-11 flex-1" placeholder={r ? 'Ask about the current XAUUSD setup…' : 'Waiting for an analysis…'} value={q} onChange={(e) => setQ(e.target.value)} disabled={!r} />
          <button className="btn-gold h-11 w-11 px-0" disabled={!r || !q.trim() || asking} aria-label="Send"><Send size={16} /></button>
        </form>
      </div>
    </div>
  );
}
