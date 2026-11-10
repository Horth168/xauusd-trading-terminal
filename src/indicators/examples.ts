export const EXAMPLES: { name: string; code: string }[] = [
  {
    name: 'EMA cross with signals (indicator)',
    code: `// XTS script — JavaScript with a Pine-inspired API (not Pine Script).
indicator('EMA Cross Signals', { overlay: true });

const fastLen = input.int('Fast length', 9, { min: 1 });
const slowLen = input.int('Slow length', 21, { min: 1 });

const fast = ta.ema(close, fastLen);
const slow = ta.ema(close, slowLen);

plot(fast, 'Fast EMA', { color: '#e8c25a', lineWidth: 2 });
plot(slow, 'Slow EMA', { color: '#6b8afd', lineWidth: 2 });

for (let i = 1; i < bar_count; i++) {
  if (ta.crossover(fast, slow, i)) { buy(i, 'Buy'); alert(i, 'EMA bullish cross'); }
  if (ta.crossunder(fast, slow, i)) { sell(i, 'Sell'); alert(i, 'EMA bearish cross'); }
}
`,
  },
  {
    name: 'London breakout (strategy with SL/TP)',
    code: `// Buys/sells a break of the Asian-session range (00:00–07:00 UTC) during London hours.
strategy('London Breakout', { overlay: true });

const rr = input.float('Reward : risk', 2, { step: 0.5 });
const bufferUsd = input.float('Breakout buffer ($)', 0.5, { step: 0.1 });

const rangeHigh = new Array(bar_count).fill(NaN);
const rangeLow = new Array(bar_count).fill(NaN);
let hi = -Infinity, lo = Infinity, day = -1, traded = false;

for (let i = 0; i < bar_count; i++) {
  const d = new Date(time[i] * 1000);
  const h = d.getUTCHours();
  if (d.getUTCDate() !== day) { day = d.getUTCDate(); hi = -Infinity; lo = Infinity; traded = false; }
  if (h < 7) { hi = Math.max(hi, high[i]); lo = Math.min(lo, low[i]); continue; }
  if (!Number.isFinite(hi)) continue;
  rangeHigh[i] = hi; rangeLow[i] = lo;
  if (traded || h >= 12) continue;
  if (close[i] > hi + bufferUsd) {
    strategy.entry('long', i, { sl: lo, tp: close[i] + (close[i] - lo) * rr }); traded = true; buy(i, 'LB');
  } else if (close[i] < lo - bufferUsd) {
    strategy.entry('short', i, { sl: hi, tp: close[i] - (hi - close[i]) * rr }); traded = true; sell(i, 'LB');
  }
  if (h === 20) strategy.exit('all', i);
}
plot(rangeHigh, 'Asia high', { color: '#22b07d', style: 'step' });
plot(rangeLow, 'Asia low', { color: '#e5484d', style: 'step' });
`,
  },
  {
    name: 'RSI divergence-style oscillator (separate pane)',
    code: `indicator('RSI + Smoothed', { overlay: false });
const len = input.int('RSI length', 14);
const smooth = input.int('Smoothing', 5);
const r = ta.rsi(close, len);
const s = ta.ema(r, smooth);
plot(r, 'RSI', { color: '#c678dd' });
plot(s, 'Signal', { color: '#e8c25a' });
hline(70, 'Overbought'); hline(30, 'Oversold');
for (let i = 1; i < bar_count; i++) {
  if (ta.crossover(r, 30, i)) marker(i, { position: 'belowBar', shape: 'circle', color: '#22b07d', text: 'OS' });
  if (ta.crossunder(r, 70, i)) marker(i, { position: 'aboveBar', shape: 'circle', color: '#e5484d', text: 'OB' });
}
`,
  },
];

export const API_DOC = `SERIES (arrays, one value per bar, oldest first)
  open high low close volume time hl2 hlc3 ohlc4    bar_count

DECLARE
  indicator(name, { overlay: true|false })
  strategy(name, { overlay })          // shows up in the Strategy Tester

INPUTS (editable in chart settings & tester)
  input.int(label, default, { min, max, step })
  input.float(label, default, { step })
  input.bool(label, default)
  input.select(label, default, ['a','b'])
  input.string(label, default)   input.color(label, '#hex')

TA (all causal — value[i] uses bars 0..i only)
  ta.sma ema rma wma stdev highest lowest change (src, len)
  ta.atr(len)  ta.trueRange()  ta.cci(len)  ta.adx(len) -> {adx, plusDI, minusDI}
  ta.stoch(k, smooth, d) -> {k, d}   ta.supertrend(len, mult) -> {line, dir}
  ta.vwap()  ta.ichimoku(9, 26, 52, 26)  ta.heikinAshi() -> bars
  ta.rsi(src, len)   ta.macd(src, f, s, sig) -> {line, signal, hist}
  ta.bollinger(src, len, mult) -> {basis, upper, lower}
  ta.crossover(a, b, i) / ta.crossunder(a, b, i)   (b may be a number)
  ta.crossoverSeries(a, b) / ta.crossunderSeries(a, b) -> boolean[]

OUTPUT
  plot(series, title, { color, lineWidth, style: 'line'|'histogram'|'area'|'step'|'dots', pane, offset })
  hline(price, title, { color })
  buy(i, text) / sell(i, text)         // marker + long/short signal
  marker(i, { position:'aboveBar'|'belowBar', shape:'arrowUp'|'arrowDown'|'circle'|'square', color, text })
  alert(i, message)                    // fires when bar i is the latest CLOSED bar
  strategy.entry('long'|'short', i, { sl, tp })   // filled at next bar open
  strategy.exit('long'|'short'|'all', i)
  log(...values)   nz(x, 0)   na(x)

RULES
  • Signals at bar i are acted on at bar i+1's open (no look-ahead).
  • Do not read close[i + 1] etc. — that is future data and makes backtests invalid.
  • Network/storage APIs (fetch, WebSocket, indexedDB...) are blocked inside scripts.
  • Scripts time out after 5 seconds.`;
