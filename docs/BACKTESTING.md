# Running backtests

**Backtest** (sidebar / bottom bar) → configure → **Run backtest**.

1. **Market & period** — timeframe (M1…MN1) and date range in your timezone. Candles come from the active feed:
   Exness MT5 history via the bridge (preferred) or Twelve Data (labelled *not Exness*). Downloaded candles are
   cached in IndexedDB so re-runs are instant.
2. **Strategy** — a built-in (EMA crossover, RSI mean reversion, Donchian breakout, Supertrend, MACD cross,
   Bollinger reversion) or any of your own scripts. Edit parameters; choose long/short/both; exit on opposite
   signal; or reverse.
3. **Account & costs** — balance, leverage (margin check), fixed lots or % risk (lots = risk $ ÷ (SL distance × 100 oz),
   rounded down to 0.01), spread in $ (0.20 = 20 points on a 2-digit quote), slippage, commission per lot (round turn).
4. **Stop loss** — ATR multiple, fixed $ distance, from script, or none.
5. **Take profit** — R multiple, ATR, fixed $, from script; up to 4 partial levels (`close %`; the last closes the rest).
6. **Management** — break-even at *x* R (+ offset), trailing stop (ATR or $, starts at *x* R), intrabar assumption.

## Execution model (what is and isn't simulated)

| | |
|---|---|
| Signal timing | Indicators computed on bar close (causal); orders fill at **next bar open** — no look-ahead |
| Prices | Candles are **bid** (as MT5). Longs buy at ask = bid + spread, sell at bid. Shorts sell at bid; their SL/TP trigger on ask |
| Stops | Fill at the stop − slippage; if a bar **gaps** past the stop, fill at the open |
| Targets | Limit fills at the level |
| Same-candle SL & TP | Unknown with OHLC data → *Pessimistic* (stop first, default), *Optimistic*, or *OHLC path* |
| Break-even | Triggered intrabar along the assumed path |
| Trailing | Recalculated at bar close, effective from the next bar |
| Margin | Trade skipped if notional ÷ leverage > balance; account stops out at equity ≤ 0 |
| **Not modelled** | Tick-by-tick path, variable spread/news spikes, swaps, requotes, partial fills |

**Tick-level accuracy is not available** (neither data source provides historical ticks to the browser). Use a
lower timeframe for more realistic intrabar behaviour — e.g. test an H1 strategy on M5 data with scaled parameters.

## Results

Net/gross profit & loss, profit factor, max equity drawdown ($ and %), win rate, average win/loss and their ratio,
average R, expected payoff, largest win/loss, consecutive wins/losses, recovery factor, long/short split,
equity & balance curves, monthly table/chart and the full trade list (with each fill and its reason).

* **Show on chart** — draws every entry/exit on the chart; the 👁 icon on a trade focuses it with entry/SL/TP/exit lines.
* **Replay** — on the chart toolbar press ⏪, click a bar, then play/step candles one by one.
* **Save** — stores config, stats, curve and up to 2,000 trades in Firestore (`users/{uid}/backtests`).
* **Compare** — select saved results to overlay % equity curves and compare stats (best values highlighted).
* **CSV** — exports the trade list. Link saved results to entries in the **Strategy Library**.

The engine is pure TypeScript (`src/backtest/engine.ts`) with unit tests in `engine.test.ts`.
