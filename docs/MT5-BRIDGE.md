# Exness MT5 bridge — exact Exness XAUUSD prices

Exness does not offer a public market-data API or WebSocket feed. The only authorised way to get the exact
prices your Exness account trades on is your own MetaTrader 5 terminal. `mt5-bridge/bridge.py` reads the
terminal through MetaQuotes' official [`MetaTrader5` Python package](https://www.mql5.com/en/docs/python_metatrader5)
and serves it to the web app.

```
 Exness MT5 server ──► MetaTrader 5 terminal (your PC) ──► bridge.py :8765 ──HTTP/WS──► web app (browser/PWA)
```

* **Read-only.** The bridge has no order endpoints. It cannot open, modify or close trades.
* **Token-protected.** Every request needs the token generated on first run (stored in `mt5-bridge/.env`).
* **Your broker password never leaves the terminal.** You log in inside MetaTrader 5 as usual.
* A Vercel serverless function cannot keep a permanent MT5 connection — that is why the bridge runs next to MT5.

## 1. One-time setup (Windows)

1. Install **MetaTrader 5 from Exness** (Exness Personal Area → Trading → MT5 download), log in to your account.
2. Install **Python 3.9–3.12 (64-bit)** from python.org (tick "Add python to PATH").
3. In MT5: *Tools → Options → Charts → Max bars in chart* → set to **Unlimited** (or 500000) so deep history is available.
4. Open a chart of `XAUUSD` once (or `XAUUSDm` on Standard/Cent accounts). If your symbol has a suffix, edit
   `mt5-bridge/.env` → `SYMBOL=XAUUSDm`.

## 2. Run the bridge

Double-click `mt5-bridge/start-bridge.bat`. The first run creates a virtual env and installs dependencies. It prints:

```
 Symbol: XAUUSD   Listening: http://127.0.0.1:8765
 Token:  <your token>
```

In the web app: **Settings → Market data feed** → Bridge URL `http://127.0.0.1:8765`, paste the token → **Test** → **Save**.
The status bar shows **LIVE · Exness MT5 · <server>** with bid/ask and spread.

Chrome and Edge allow the HTTPS app to reach `http://127.0.0.1` (the bridge answers Private Network Access preflights).

## 3. Use it on your iPhone (outside your PC)

Your phone cannot reach `127.0.0.1` on your PC. Expose the bridge over HTTPS with a free **Cloudflare Tunnel**:

```
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://127.0.0.1:8765
```

It prints `https://<random>.trycloudflare.com`. Use that as the Bridge URL on the phone (same token).
For a permanent hostname create a named tunnel in the Cloudflare dashboard (Zero Trust → Networks → Tunnels).
The bridge stays protected by the token; keep it secret.

## 4. Auto-start (optional)

Task Scheduler → Create Task → Trigger "At log on" → Action: start `mt5-bridge\start-bridge.bat`.
MT5 must be running and logged in; the bridge reconnects automatically when the terminal comes back.

## Settings (`mt5-bridge/.env`)

| Key | Default | Meaning |
|---|---|---|
| `SYMBOL` | `XAUUSD` | Exact symbol name in your terminal (`XAUUSDm` for Standard accounts) |
| `PORT` / `HOST` | `8765` / `127.0.0.1` | Listen address. Keep `127.0.0.1` and use a tunnel for remote access |
| `MT5_PATH` | auto | Path to `terminal64.exe` if you have several terminals |
| `SERVER_UTC_OFFSET_HOURS` | `0` | Exness servers run on GMT+0. Other brokers: their server offset |
| `ALLOWED_ORIGINS` | Vercel app + localhost | Comma-separated origins allowed by CORS |

## What the app gets from the bridge

* History for all MT5 timeframes natively: M1 M2 M3 M5 M10 M15 M30 H1 H2 H4 H6 H8 H12 D1 W1 MN1 (custom timeframes are aggregated from these).
* Live ticks (bid/ask, every ~200 ms when price changes) and the forming candle for each subscribed timeframe.
* Tick volume (MT5's "volume" for CFDs — not exchange volume).
* Account history for the journal: closed positions and deposits/withdrawals (Journal → Import → Sync from MT5).

## Troubleshooting

* **"MT5 terminal not connected"** — open MetaTrader 5 and log in; check the bottom-right connection indicator.
* **Symbol not found** — set `SYMBOL` to the exact name shown in Market Watch.
* **History stops early** — raise *Max bars in chart*, then scroll the MT5 chart back once to download more.
* **401 unauthorized** — token mismatch; copy it again from the bridge window or `mt5-bridge/.env`.
