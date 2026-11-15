# AI Gold Analyst — acceptance status

What has been verified, how, and what still needs your setup to verify. Nothing is marked done only because a UI exists.

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Existing live chart works | ✅ | Browser test on branch: candles, live bid/ask, EMA + RSI panes, AI overlay toggle, no console errors |
| 2 | Exness MT5 connection works | ⏳ | Bridge unchanged except new read-only `/tick`; stand-in test passes. Restart your bridge and run `npm run dry-run` to confirm on real Exness data |
| 3 | Existing indicators work | ✅ | Chart legend renders EMA/RSI; original tests pass |
| 4 | Drawing tools work | ✅ | Trend line drawn in browser test on the branch |
| 5 | Strategy tester works | ✅ | EMA Crossover backtest ran in UI (9 trades); 11 original engine tests pass |
| 6 | Trading journal works | ✅ | Journey page renders; journal maths tests pass |
| 7 | AI analysis uses real market data | ✅ / ⏳ | Uses the same feed as the chart (MT5 or delayed fallback, never mixed); confirmed only on LIVE MT5. Real-data run pending your bridge |
| 8 | Indicator values calculated correctly | ✅ | Reuses tested causal `ta.ts`; no-look-ahead tests |
| 9 | Signals only when mandatory rules met | ✅ | Property test over thousands of simulated scans: every CONFIRMED has all mandatory rules, RR ≥ min, risk pass, score ≥ min |
| 10 | Entry / SL / TP correct | ✅ | Level-engine tests (ASK/BID, structural/ATR stop, 2R/3R, blocking structure) |
| 11 | Detailed explanation per signal | ✅ | Reasons for/against, invalidation, calculation steps, agent reports stored with each signal |
| 12 | WAIT when no valid setup | ✅ | Default; tests; live UI shows WAIT with reasons (e.g. sessions closed) |
| 13 | Invalidated signals handled | ✅ | Lifecycle tests: invalidation, missed entry, stale expiry |
| 14 | Duplicate signals prevented | ✅ | Deterministic ids + overlap check + notification_log create-once; scan test creates each signal once |
| 15 | Background scanning without browser | ⏳ | Scanner built, type-checked and dry-run tested against the bridge; needs your service account + `SCANNER_UID` to run |
| 16 | Push arrives with PWA closed | ⏳ | VAPID keys generated, SW push handler shipped, subscription + delivery code done; must be confirmed on your iPhone |
| 17 | Signal history saved in Firebase | ⏳ | Writes implemented (`ai_signals`, `ai_reports`); confirm once scanner runs |
| 18 | AI performance separate from P&L | ✅ | Separate `ai_signals` collection and Signals → Performance page; journal untouched |
| 19 | No automatic trading | ✅ | Bridge has GET endpoints only; no order code anywhere; scanner/LLM have no trade path |
| 20 | Works on desktop and iPhone | ✅ / ⏳ | Desktop + 393×852 phone layout tested in browser; real-iPhone check pending deploy |

Test suite: 42 tests (engine, AI analysis, signals, validation, journal). Production build OK.
