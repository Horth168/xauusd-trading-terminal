# AI Gold Analyst upgrade — audit report & implementation plan

Branch: `feature/ai-analyst` (production `main` untouched until verified).

## 1. Audit of the existing application (verified against source, 15/15 tests passing, build OK)

| Area | Implementation | Status |
|---|---|---|
| Exness MT5 data | `mt5-bridge/bridge.py` (FastAPI, read-only, token auth, CORS/PNA): `/health`, `/symbol`, `/history` (all MT5 TFs), `/deals`, WebSocket `/stream` (bid/ask ticks + forming bars). No order endpoints. | Works (verified live: Exness-MT5Real8, XAUUSDm) |
| Feed manager | `src/market/feed.ts`: Auto/MT5/Twelve Data, reconnect with backoff, fallback after 3 failures, 30 s MT5 probe, `generation` counter so sources never mix, derived TFs via `aggregate.ts`, IndexedDB range cache for backtests. | Works |
| Fallback feed | `api/history.ts` (Twelve Data, server-side key), labelled DELAYED. | Works |
| Chart | `src/chart/ChartPane.tsx` (Lightweight Charts v5), indicators in panes, markers, replay, backtest trade overlay, alert lines. `DrawingLayer.tsx` time/price-anchored drawings. | Works |
| Indicators | `src/indicators/ta.ts` (causal EMA/SMA/RMA/RSI/MACD/Stoch/CCI/ATR/ADX/BB/VWAP/Ichimoku/Supertrend/HA), `builtins.ts`. | Works, unit-tested causality |
| Custom scripts | `src/indicators/runtime.ts` (XTS, sandboxed worker), signals with SL/TP. | Works |
| Backtester | `src/backtest/engine.ts` (next-open fills, bid/ask, gaps, partial TPs, BE, trailing, intrabar modes, stats, monthly), worker, `BacktestPage.tsx` (save/compare/CSV). | Works, 7 tests |
| Alerts | `src/alerts/engine.ts` — **evaluated in the browser only**; notifications via the page's service worker, only while the app is open. | Limitation → upgrade |
| Journal / cash / calendar / strategies | `src/journal/*`, pages. Net P&L formulas tested. | Works |
| Persistence | `src/lib/db.ts` → Firestore `xau_users/{uid}/{collection}`, local fallback, image upload fallback. Rules (published): owner-only on `xau_users/{uid}/**`. | Works; new collections need no rule change |
| PWA | `vite-plugin-pwa` generateSW, icons, iOS meta (solid status bar). | Works; **no push handler** |
| Auth | Firebase Auth (Google + email, remember device). | Works |

### Missing (what this upgrade adds)
1. Market-structure, SMC, multi-timeframe analysis — none existed.
2. Signal engine with statuses, entry/SL/TP engine, evidence score, lifecycle, dedupe.
3. Server-side scanner independent of the browser.
4. Web Push (VAPID, subscriptions, SW push handler, delivery, logs).
5. AI Analyst page, dashboard, signal pages, chart AI overlay.
6. Signal outcome tracking & analytics (separate from journal P&L).
7. Walk-forward / out-of-sample / Monte Carlo / look-ahead checks in the tester.

## 2. Vibe-Trading (HKUDS, MIT) — what we take and why

Vibe-Trading is a Python ≥3.11 LangGraph/LangChain platform (~70 dependencies, 123 tools, 89 skills, swarm DAG presets).
**Direct integration is impractical**: the existing bridge runs Python 3.9; the stack is very heavy for a single-symbol
analysis-only app; its data loaders target equities/crypto with an MT5 loader we already exceed (live WebSocket). We
therefore **re-implement its proven concepts** in this codebase (no code copied, so no MIT notice is required; credit
is given here and in the README):

| Vibe-Trading concept | Our implementation |
|---|---|
| Swarm "investment committee" (specialists → risk review → final decision) | 5 specialist agents + Final Reviewer (`src/ai/agents/*`) |
| Deterministic quant engines, LLM only interprets | All numbers from `src/ai/*` pure functions; LLM explains |
| `report_audit` (numbers in LLM text must match engine output) | `src/ai/audit.ts` — flags numbers in AI answers not present in the report |
| Run manifest / hashed, reproducible runs | Every report stores config hash, data source, candle timestamps |
| Walk-forward, Monte Carlo, out-of-sample validation | `src/backtest/validation.ts` on the existing engine |
| Persistent research records | Firestore `ai_reports`, `ai_signals` |

## 3. Architecture

```
Exness MT5 (always-on Windows PC or VPS)
   └─ mt5-bridge (existing, read-only)            ← unchanged API
        └─ scanner/ (NEW, Node + TS, same machine)
              ├─ uses src/ai/* (same code as the app & backtester)
              ├─ Firestore (firebase-admin, service account on that machine only)
              └─ Web Push (VAPID private key on that machine only) ──► iPhone/Android PWA
Vercel (existing): React app + api/history (Twelve Data) + api/analyst (NEW, LLM Q&A, Firebase-token protected)
```

**Why the scanner runs next to MT5, not on Railway/Render:** exact Exness prices exist only in your MT5 terminal. A cloud
scanner could only use Twelve Data, and the rules forbid Exness-style entries from fallback data. So the scanner lives on
the always-on machine that runs MT5 (your PC, or a Windows VPS for 24/5 coverage).

## 4. Signal rules (deterministic, shared by app, scanner and backtester)
* Completed candles only (forming bar dropped); swings confirmed after N bars (no repaint).
* Strategies A (EMA+Stoch+CCI), B (SMC), C (MTF trend), D (custom XTS scripts) produce *candidates*.
* Entry/SL/TP engine: structural or ATR stop + spread buffer; TP1 = 2R, TP2 = 3R; reject if opposing structure blocks < min RR.
* Evidence score 100 = trend 20 + structure 20 + indicators 20 + liquidity/PA 20 + risk 20 (configurable minimum).
* CONFIRMED requires: all mandatory strategy rules, RR ≥ min, spread ≤ max, LIVE Exness data, score ≥ min. Otherwise WAIT / SETUP FORMING.
* Lifecycle: CONFIRMED → (entry touched) OPEN → TP1/TP2/SL/AMBIGUOUS; or INVALIDATED / EXPIRED (stale or missed entry). Deterministic IDs prevent duplicates.

## 5. Phases & files
| Phase | Files |
|---|---|
| 3 Analysis engine | `src/ai/{types,config,context,structure,smc,levels,scoring}.ts`, `src/ai/agents/*.ts`, `src/ai/analyze.ts` + tests |
| 4 Signal engine | `src/ai/{strategies,signals,outcome,explain,audit}.ts` + tests |
| 5 Frontend | `src/pages/{Dashboard,AiAnalyst,Signals,SignalDetail,Notifications}Page.tsx`, `src/chart/AiOverlay.tsx`, nav changes |
| 6 Scanner | `scanner/*` (Node service, reuses `src/ai`) |
| 7 Push | `public/push-sw.js`, `src/lib/push.ts`, scanner push sender, `api/analyst.ts` |
| 8 Backtest/perf | `src/backtest/{aiStrategy,validation}.ts`, BacktestPage panel, signal analytics |
| 9–10 | tests, build, deploy, docs |

## 6. Risks
* Scanner uptime depends on the MT5 machine being on — documented, status shown in the app.
* iOS web push requires iOS 16.4+, Home-Screen install, permission; Apple may throttle delivery.
* LLM answers are constrained to stored reports and audited; decisions never come from the LLM.
* Nothing in this upgrade can place, modify or close orders.
