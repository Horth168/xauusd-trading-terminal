# XAUUSD Trading Terminal

A personal XAUUSD (gold) trading platform: a live chart with professional drawing tools and indicators,
your own scripted indicators and strategies, a candle-based strategy tester, and a trading journal with
performance analytics, deposit/withdrawal tracking and a P&L calendar. Installable as a PWA on iPhone/Android.

**Stack:** React 18 + TypeScript + Vite · Tailwind · TradingView Lightweight Charts v5 (Apache-2.0) · Recharts ·
Zustand · Firebase (Auth, Firestore, Storage) · Vercel (static + serverless) · Python MT5 bridge (FastAPI).

## Market data — read this first

| Source | What you get | Label in app |
|---|---|---|
| **Exness MT5 bridge** (`mt5-bridge/`) | Exact Exness prices from your own MT5 terminal: live bid/ask over WebSocket, all MT5 timeframes, tick volume, account history import | **LIVE · Exness MT5** |
| **Twelve Data** (fallback, server-side key) | Spot XAU/USD, polled (default every 120 s), no bid/ask/volume. Close to, but **not**, Exness prices | **DELAYED · Twelve Data (not Exness)** |
| none | Nothing is drawn. The app never simulates prices | **OFFLINE** |

Exness has no public market-data API; the official route is the MT5 terminal. See [docs/MT5-BRIDGE.md](docs/MT5-BRIDGE.md).
In *Auto* mode the app uses the bridge when reachable, falls back to Twelve Data after 3 failed reconnects, and keeps
probing the bridge every 30 s. Charts reload when the source changes, so prices from different sources are never mixed.

## Features

* **Chart** — candles / Heikin Ashi / bars / line / area; M1 M2 M3 M5 M10 M15 M30 H1 H2 H4 H6 H8 H12 D1 W1 MN1 plus
  custom minute timeframes (aggregated from real lower-TF candles); crosshair OHLC legend; current price + ask line;
  zoom/scroll with lazy loading of older history; 1/2/4-chart layouts; saved layouts; full screen; PNG screenshot;
  timezone selector (UTC, Cambodia, London, New York, Tokyo, …) affecting axis, sessions and journal days; bar replay.
* **Drawing tools** — trend line, horizontal/vertical line, ray, extended line, parallel channel, regression trend,
  Fib retracement / extension / channel / fan, rectangle, circle, triangle, brush, text, price range, date range,
  long/short position (R:R, $ risk/reward by lot size), entry / stop loss / take profit lines, price-alert tool.
  Colors, width, style, fill, lock, hide, clone, delete, undo/redo (Ctrl+Z / Ctrl+Y), magnet; auto-saved and shared
  across timeframes.
* **Indicators** — EMA, SMA, VWAP, Bollinger Bands, RSI, MACD, Stochastic, CCI, ATR, ADX/DMI, Volume, Ichimoku,
  Supertrend, Heikin Ashi; parameters, colors, line width, multiple instances, templates.
* **Custom scripts** — JavaScript with a Pine-inspired API (not Pine Script): inputs, plots, markers, buy/sell signals,
  alerts, strategy entries with SL/TP; sandboxed worker; import/export. [docs/INDICATORS.md](docs/INDICATORS.md)
* **Strategy tester** — real candles, next-bar-open fills, spread/slippage/commission, leverage & margin, fixed lots or
  % risk, ATR/fixed/script SL & TP, up to 4 partial TPs, break-even, trailing, intrabar assumptions, full statistics,
  equity/balance curves, monthly table, trade list → inspect on chart, save, compare, CSV. [docs/BACKTESTING.md](docs/BACKTESTING.md)
* **My Trading Journey** — manual trades (all requested fields incl. screenshots & emotions), MT5 history sync, CSV
  import/export, period filters (today … all time, custom), stats, daily/weekly/monthly charts, equity curve,
  per-emotion and per-strategy breakdown.
* **Deposits & withdrawals** — USD/KHR, method, reference, notes; kept separate from trading P&L:
  `Net Trading P&L = Profits − Losses − Costs`, `Net Cash Contribution = Deposits − Withdrawals`,
  `Estimated Equity = Contribution + Net Trading P&L`.
* **Calendar** — daily P&L heat-map, trade counts, weekly totals, best/worst days, click-through to trades.
* **Strategy library** — documentation, screenshots, linked backtests, live-vs-backtest comparison.
* **Alerts** — price, indicator level, strategy/entry signal (closed candles only), SL/TP/entry drawing alerts,
  browser notifications. Never executes trades.
* **PWA** — installable, standalone, safe-area aware, bottom navigation on mobile, offline journal (Firestore cache)
  and app shell; live chart shows OFFLINE when the device is offline.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173  (the /api proxy needs `vercel dev` or a deployment)
npm test           # engine, indicators, aggregation, script runtime, journal maths
npm run build
```

Environment variables: see [.env.example](.env.example) and [docs/FIREBASE.md](docs/FIREBASE.md).
`TWELVEDATA_API_KEY` is server-only (Vercel function `api/history.ts`) and never shipped to the browser.

## Install on iPhone

1. Open the Vercel URL in **Safari**.
2. Share → **Add to Home Screen** → Add.
3. Launch from the icon: full-screen, no browser bars, respects the Dynamic Island / notch.
4. For alerts: iOS 16.4+, open the installed app → Alerts → *Enable notifications*.
5. For live Exness prices on the phone, expose the bridge with Cloudflare Tunnel (docs/MT5-BRIDGE.md §3).

## Project layout

```
api/                 Vercel functions (Twelve Data proxy, status)
mt5-bridge/          Python read-only MT5 bridge (run on your Windows PC)
src/market/          feed manager, providers, timeframes, aggregation
src/chart/           chart pane, drawing layer & tools, indicator dialogs
src/indicators/      TA library, built-ins, script runtime + worker
src/backtest/        engine (pure, tested), strategies, worker
src/journal/         journal/cash-flow maths (tested), trade form, importers
src/alerts/          alert engine + notifications
src/lib/             Firebase, storage abstraction, time zones, formatting
firestore.rules, storage.rules, firestore.indexes.json
```

## Known limitations

* Exact Exness prices require the MT5 bridge running on a PC with MT5 logged in (Exness offers no hosted API).
* Twelve Data free plan: 800 requests/day, 8/min — the fallback is polled, not streamed, and labelled DELAYED.
* Backtests are candle-based; no tick data, no variable spread, no swaps.
* Alerts run only while the app is open (no always-on server / push service).
* Scripts are JavaScript with a Pine-like API; Pine Script source is not compatible.
