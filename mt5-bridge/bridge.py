"""
XAUUSD Terminal — MT5 market-data bridge (READ-ONLY)

Runs on the Windows PC where your Exness MetaTrader 5 terminal is installed and logged in.
It reads prices and history through the official `MetaTrader5` Python package and serves them to the
web app over HTTP + WebSocket. It never places, modifies or closes orders.

Endpoints (all require `Authorization: Bearer <BRIDGE_TOKEN>`, WebSocket uses ?token=):
  GET  /health                         bridge + terminal status
  GET  /symbol                         symbol specification (digits, contract size, spread...)
  GET  /history?timeframe=M15&count=1500[&end=unix]   or  &start=unix&end=unix
  GET  /deals?start=unix&end=unix      closed positions + balance operations (for journal import)
  WS   /stream?token=...               ticks (bid/ask) + live bars for subscribed timeframes
"""
from __future__ import annotations

import asyncio
import json
import os
import secrets
import threading
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Set, Tuple
from pathlib import Path

import MetaTrader5 as mt5
import uvicorn
from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

HERE = Path(__file__).parent
ENV_FILE = HERE / ".env"


def load_env() -> None:
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


load_env()
if not os.environ.get("BRIDGE_TOKEN"):
    token = secrets.token_urlsafe(24)
    with ENV_FILE.open("a") as f:
        f.write(f"BRIDGE_TOKEN={token}\n")
    os.environ["BRIDGE_TOKEN"] = token

TOKEN = os.environ["BRIDGE_TOKEN"]
SYMBOL = os.environ.get("SYMBOL", "XAUUSD")  # Exness Standard accounts may use "XAUUSDm"
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8765"))
TERMINAL_PATH = os.environ.get("MT5_PATH") or None
# Exness MT5 servers run on GMT+0. For other brokers set the server's UTC offset in hours.
SERVER_OFFSET = int(float(os.environ.get("SERVER_UTC_OFFSET_HOURS", "0")) * 3600)
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get(
    "ALLOWED_ORIGINS",
    "https://xauusd-trading-terminal.vercel.app,http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173",
).split(",") if o.strip()]

TF = {
    "M1": mt5.TIMEFRAME_M1, "M2": mt5.TIMEFRAME_M2, "M3": mt5.TIMEFRAME_M3, "M5": mt5.TIMEFRAME_M5,
    "M10": mt5.TIMEFRAME_M10, "M15": mt5.TIMEFRAME_M15, "M30": mt5.TIMEFRAME_M30, "H1": mt5.TIMEFRAME_H1,
    "H2": mt5.TIMEFRAME_H2, "H4": mt5.TIMEFRAME_H4, "H6": mt5.TIMEFRAME_H6, "H8": mt5.TIMEFRAME_H8,
    "H12": mt5.TIMEFRAME_H12, "D1": mt5.TIMEFRAME_D1, "W1": mt5.TIMEFRAME_W1, "MN1": mt5.TIMEFRAME_MN1,
}

lock = threading.Lock()  # the MetaTrader5 package is not thread-safe


def ensure_terminal() -> bool:
    with lock:
        info = mt5.terminal_info()
        if info is None:
            ok = mt5.initialize(path=TERMINAL_PATH) if TERMINAL_PATH else mt5.initialize()
            if not ok:
                return False
            info = mt5.terminal_info()
        if info is None or not info.connected:
            return False
        mt5.symbol_select(SYMBOL, True)
        return True


def to_utc(server_ts: int) -> int:
    return int(server_ts) - SERVER_OFFSET


def to_server_dt(utc_ts: int) -> datetime:
    return datetime.fromtimestamp(int(utc_ts) + SERVER_OFFSET, tz=timezone.utc)


def rates_to_bars(rates) -> List[dict]:
    if rates is None:
        return []
    return [
        {"time": to_utc(r["time"]), "open": float(r["open"]), "high": float(r["high"]),
         "low": float(r["low"]), "close": float(r["close"]), "tick_volume": int(r["tick_volume"])}
        for r in rates
    ]


app = FastAPI(title="XAUUSD Terminal MT5 Bridge", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https://.*\.trycloudflare\.com|https://xauusd-trading-terminal.*\.vercel\.app",
    allow_methods=["GET"],
    allow_headers=["Authorization"],
)


@app.middleware("http")
async def auth_and_pna(request: Request, call_next):
    # Chrome Private Network Access preflight (HTTPS site -> localhost)
    if request.method == "OPTIONS":
        response = await call_next(request)
        response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {TOKEN}":
        return JSONResponse({"error": "unauthorized"}, status_code=401,
                            headers={"Access-Control-Allow-Origin": request.headers.get("origin", "*")})
    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


@app.get("/health")
def health():
    connected = ensure_terminal()
    with lock:
        acc = mt5.account_info() if connected else None
    return {"ok": True, "symbol": SYMBOL, "terminal_connected": connected,
            "server": acc.server if acc else None, "read_only": True}


@app.get("/symbol")
def symbol():
    if not ensure_terminal():
        raise HTTPException(503, "MT5 terminal not connected")
    with lock:
        s = mt5.symbol_info(SYMBOL)
        acc = mt5.account_info()
    if s is None:
        raise HTTPException(404, f"Symbol {SYMBOL} not found. Set SYMBOL in mt5-bridge/.env (e.g. XAUUSDm)")
    return {"name": s.name, "description": s.description, "digits": s.digits, "point": s.point,
            "spread": s.spread, "trade_contract_size": s.trade_contract_size,
            "volume_min": s.volume_min, "volume_step": s.volume_step, "server": acc.server if acc else None}


@app.get("/history")
def history(timeframe: str, count: Optional[int] = Query(None, le=100000), start: Optional[int] = None, end: Optional[int] = None):
    if timeframe not in TF:
        raise HTTPException(400, "bad timeframe")
    if not ensure_terminal():
        raise HTTPException(503, "MT5 terminal not connected")
    with lock:
        if count is not None:
            end_dt = to_server_dt(end) if end else datetime.now(tz=timezone.utc) + timedelta(days=1)
            rates = mt5.copy_rates_from(SYMBOL, TF[timeframe], end_dt, count)
        elif start is not None:
            end_dt = to_server_dt(end) if end else datetime.now(tz=timezone.utc) + timedelta(days=1)
            rates = mt5.copy_rates_range(SYMBOL, TF[timeframe], to_server_dt(start), end_dt)
        else:
            raise HTTPException(400, "pass count or start")
        err = mt5.last_error()
    if rates is None:
        raise HTTPException(500, f"MT5 error {err}. Tip: raise Tools > Options > Charts > 'Max bars in chart'.")
    return {"symbol": SYMBOL, "timeframe": timeframe, "bars": rates_to_bars(rates)}


@app.get("/deals")
def deals(start: int, end: int):
    if not ensure_terminal():
        raise HTTPException(503, "MT5 terminal not connected")
    with lock:
        ds = mt5.history_deals_get(to_server_dt(start), to_server_dt(end)) or ()
        orders = mt5.history_orders_get(to_server_dt(start), to_server_dt(end)) or ()
    sltp: Dict[int, Tuple[float, float]] = {}
    for o in orders:
        if o.sl or o.tp:
            sltp[o.position_id] = (o.sl, o.tp)
    positions: Dict[int, dict] = {}
    balance = []
    for d in ds:
        if d.type == mt5.DEAL_TYPE_BALANCE:
            balance.append({"deal_id": d.ticket, "time": to_utc(d.time), "amount": d.profit, "comment": d.comment})
            continue
        if d.type not in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL):
            continue
        p = positions.setdefault(d.position_id, {
            "position_id": d.position_id, "symbol": d.symbol, "type": None, "volume": 0.0, "open_time": None,
            "close_time": None, "open_price": None, "close_price": None, "profit": 0.0, "commission": 0.0,
            "swap": 0.0, "fee": 0.0, "comment": d.comment, "_close_vol": 0.0, "_close_px": 0.0})
        p["commission"] += d.commission
        p["swap"] += d.swap
        p["fee"] += getattr(d, "fee", 0.0)
        p["profit"] += d.profit
        if d.entry == mt5.DEAL_ENTRY_IN:
            p["type"] = "buy" if d.type == mt5.DEAL_TYPE_BUY else "sell"
            p["volume"] += d.volume
            p["open_time"] = to_utc(d.time)
            p["open_price"] = d.price
        elif d.entry in (mt5.DEAL_ENTRY_OUT, mt5.DEAL_ENTRY_OUT_BY, mt5.DEAL_ENTRY_INOUT):
            p["close_time"] = to_utc(d.time)
            p["_close_vol"] += d.volume
            p["_close_px"] += d.price * d.volume
    out = []
    for p in positions.values():
        if p["open_time"] is None or p["close_time"] is None:
            continue  # still open or opened before the range
        p["close_price"] = p["_close_px"] / p["_close_vol"] if p["_close_vol"] else None
        p["sl"], p["tp"] = sltp.get(p["position_id"], (0.0, 0.0))
        del p["_close_vol"], p["_close_px"]
        out.append(p)
    return {"positions": out, "balance": balance}


@app.websocket("/stream")
async def stream(ws: WebSocket, token: str = ""):
    if token != TOKEN:
        await ws.close(code=4401)
        return
    await ws.accept()
    subs: Set[str] = set()
    last_msc = 0
    last_beat = 0.0
    loop = asyncio.get_running_loop()

    async def reader():
        while True:
            msg = json.loads(await ws.receive_text())
            if "subscribe" in msg:
                subs.clear()
                subs.update(t for t in msg["subscribe"] if t in TF)

    reader_task = asyncio.create_task(reader())
    try:
        connected = await loop.run_in_executor(None, ensure_terminal)
        with lock:
            acc = mt5.account_info() if connected else None
        await ws.send_text(json.dumps({"type": "hello", "symbol": SYMBOL, "server": acc.server if acc else None}))
        while True:
            if reader_task.done():
                break
            with lock:
                tick = mt5.symbol_info_tick(SYMBOL)
            now = loop.time()
            if tick is not None and tick.time_msc != last_msc:
                last_msc = tick.time_msc
                await ws.send_text(json.dumps({"type": "tick", "bid": tick.bid, "ask": tick.ask, "last": tick.last,
                                               "time_msc": tick.time_msc - SERVER_OFFSET * 1000}))
                for tf in list(subs):
                    with lock:
                        rates = mt5.copy_rates_from_pos(SYMBOL, TF[tf], 0, 2)
                    for bar in rates_to_bars(rates):
                        await ws.send_text(json.dumps({"type": "bar", "timeframe": tf, "bar": bar}))
            if now - last_beat > 5:
                last_beat = now
                await ws.send_text(json.dumps({"type": "heartbeat"}))
            await asyncio.sleep(0.2)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        reader_task.cancel()


if __name__ == "__main__":
    print("=" * 64)
    print(" XAUUSD Terminal MT5 bridge (read-only)")
    print(f" Symbol: {SYMBOL}   Listening: http://{HOST}:{PORT}")
    print(f" Token:  {TOKEN}")
    print(" Paste the URL and token into the web app: Settings > Data feed")
    print("=" * 64)
    if not ensure_terminal():
        print("WARNING: MT5 terminal not connected yet. Open MetaTrader 5 and log in to Exness.")
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
