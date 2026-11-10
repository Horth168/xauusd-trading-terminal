# Writing your own indicators and strategies (XTS)

Open **My Indicators** (sidebar → `</>`). Scripts are plain **JavaScript** with a **Pine-inspired API**.

> **This is not Pine Script.** Pine syntax (`//@version=5`, `:=`, `ta.ema(close, 9)` without arrays, series
> auto-indexing like `close[1]` meaning *previous bar*) is **not** parsed. Porting a Pine script means rewriting it
> in JavaScript using the API below. Vectorised arrays are used instead of Pine's per-bar execution model.

## Minimal indicator

```js
indicator('My SMA', { overlay: true });
const len = input.int('Length', 20, { min: 1 });
plot(ta.sma(close, len), 'SMA', { color: '#e8c25a' });
```

Press **Test** (runs on real candles from your active feed), then **Save**, then **Add to chart**
(or chart toolbar → *Indicators* → your script). Inputs appear in the chart's indicator settings.

## Signals, markers and alerts

```js
indicator('EMA Cross', { overlay: true });
const f = ta.ema(close, input.int('Fast', 9));
const s = ta.ema(close, input.int('Slow', 21));
plot(f, 'Fast'); plot(s, 'Slow');
for (let i = 1; i < bar_count; i++) {
  if (ta.crossover(f, s, i))  { buy(i, 'Buy');  alert(i, 'Bullish cross'); }
  if (ta.crossunder(f, s, i)) { sell(i, 'Sell'); alert(i, 'Bearish cross'); }
}
```

* `buy(i)` / `sell(i)` draw a marker **and** emit a long/short signal → the script can be backtested directly.
* `alert(i, msg)` fires in **Alerts → Strategy/entry signal → Script alert()** when bar `i` is the latest *closed* bar.

## Strategies with their own SL/TP

```js
strategy('Breakout', { overlay: true });
const n = input.int('Lookback', 20);
const hh = ta.highest(high, n), ll = ta.lowest(low, n);
for (let i = n; i < bar_count; i++) {
  if (close[i] > hh[i - 1]) strategy.entry('long', i, { sl: ll[i - 1], tp: close[i] + 2 * (close[i] - ll[i - 1]) });
  if (close[i] < ll[i - 1]) strategy.entry('short', i, { sl: hh[i - 1], tp: close[i] - 2 * (hh[i - 1] - close[i]) });
}
```

In the Strategy Tester choose SL = *From script* and TP = *From script* to use these levels.

## Full API

See the **API reference** button in the editor (same text as `src/indicators/examples.ts → API_DOC`).

| Category | Functions |
|---|---|
| Series | `open high low close volume time hl2 hlc3 ohlc4` (arrays), `bar_count` |
| Declare | `indicator(name, {overlay})`, `strategy(name, {overlay})` |
| Inputs | `input.int / float / bool / string / select / color` |
| TA | `ta.sma ema rma wma stdev highest lowest change rsi macd bollinger crossover crossunder` and bar-based `ta.atr(len) trueRange() cci(len) adx(len) stoch(k,s,d) supertrend(len,m) vwap() ichimoku() heikinAshi()` |
| Output | `plot hline buy sell marker alert strategy.entry strategy.exit log` |

## Rules that keep backtests honest

* All `ta.*` functions are causal: value `[i]` uses bars `0..i` only (unit-tested).
* A signal at bar `i` is executed at bar `i+1`'s open by the tester. **Never read `close[i + 1]`** — it is future data.
* The last bar on a live chart is still forming; its values change until it closes (alerts ignore it).
* Scripts run in a Web Worker with a 5 s timeout. `fetch`, `WebSocket`, `indexedDB`, `postMessage` and friends are
  shadowed so imported scripts can't send your data anywhere (best-effort sandbox — only import scripts you trust).

## Import / export

*Export* saves `name.xts.json` (`{ format: 'xts-1', name, code }`). *Import* accepts that file or a plain `.js` file.
Saved scripts sync across devices through Firestore (`users/{uid}/indicators`).
