# AI background scanner & push notifications — setup

The scanner watches XAUUSD 24/5 **without any browser open**, runs the six-agent analysis on every scan, stores
signals in Firebase and pushes CONFIRMED BUY/SELL signals to your phone. It is analysis-only: it reads prices from
the read-only MT5 bridge and can never place, modify or close a trade.

```
Exness MT5 ──► mt5-bridge (read-only) ──► scanner (this folder) ──► Firestore + Web Push ──► iPhone / Android
```

## Why it runs on your PC (or a VPS), not in the cloud
Exact Exness prices exist only inside your MT5 terminal. The scanner must run on the same always-on machine:
* **Your PC** — free; signals only arrive while the PC, MT5 and the scanner are running (sleep = no signals).
* **Windows VPS** — runs 24/5 (~$5–20/month; Exness offers a free VPS to clients meeting its conditions —
  Personal Area → VPS). Install MT5 + this repo on the VPS and follow the same steps.
The app shows **Background scanner: Online/Offline** on the Dashboard and Notifications page.

## One-time setup (≈10 minutes)

1. **Install Node.js 22 LTS** from nodejs.org (if not installed).
2. **Service account (lets the scanner write your signals):**
   Firebase Console → project *V88 car rental contract* → ⚙ Project settings → **Service accounts** →
   **Generate new private key** → save the file as `scanner/service-account.json`.
   Keep it private — it is git-ignored and must never be uploaded or shared.
3. **Your user id:** open the app → **Notifications** → copy the id under *Background scanner* and put it in
   `scanner/.env` as `SCANNER_UID=...`.
4. `scanner/.env` already contains the Web Push keys (generated for you; the private key exists only in this file).
   The bridge token is read automatically from `mt5-bridge/.env`.
5. **Restart the MT5 bridge** once (close its window, run `mt5-bridge/start-bridge.bat`) so it loads the new
   read-only `/tick` endpoint.
6. **Check the connection without writing anything:**
   ```bash
   cd scanner && npm install && npm run dry-run
   ```
   It prints the live bid/ask, candle counts and the current analysis decision.
7. **Start the scanner:** double-click `scanner/start-scanner.bat` (restarts automatically if it stops).

To start it with Windows: Task Scheduler → Create Task → *At log on* → Action: start `scanner\start-scanner.bat`
(after the bridge task). Keep the PC from sleeping while you want signals (Settings → Power → Sleep: Never).

## Enable notifications on iPhone (iOS 16.4+)
1. Open https://xauusd-trading-terminal.vercel.app in **Safari** → Share → **Add to Home Screen**.
2. Open **XAU Terminal** from the Home Screen and sign in.
3. **Notifications** tab → **Enable notifications** → Allow.
4. Tap **Test via scanner** (scanner must be online). Then lock the phone / close the app and wait for a real signal,
   or use the test again while the app is closed.

## What gets notified
Only **new CONFIRMED** signals that pass your notification settings (BUY/SELL toggles, minimum evidence score,
timeframes, strategies, quiet hours in Cambodia time). Each signal is sent once — the `notification_log` document id
is the event key, so restarts or retries cannot send duplicates. Invalidation and expiry alerts are optional.
Outcomes (TP1/TP2/SL/ambiguous) are recorded for the performance tracker, not pushed.

## Firestore records (all private under `xau_users/{uid}/`)
| Collection | Written by | Contents |
|---|---|---|
| `ai_signals` | scanner | signal, plan, evidence, stored candles, lifecycle & outcome, MFE/MAE |
| `ai_reports` | scanner | `latest` analysis + archived report of every confirmed signal |
| `ai_status/scanner` | scanner | heartbeat, bridge state, last scan, errors |
| `push_subscriptions` | app | your devices' push endpoints |
| `push_requests` | app | test notification requests |
| `notification_log` | scanner | every notification attempt and its delivery result |
| `settings/ai` | app | AI settings (read live by the scanner) |

## Troubleshooting
* `Cannot reach the MT5 bridge` — start `mt5-bridge/start-bridge.bat`.
* `bridge /tick → HTTP 404` — the bridge is an old version; restart it.
* Scanner shows *terminal disconnected* — open MT5 and log in to Exness.
* No notification on iPhone — check iPhone Settings → Notifications → XAU Terminal is allowed, Focus modes, and that the
  device appears under **Notifications → Devices** in the app. Health: http://127.0.0.1:8770/health on the PC.
