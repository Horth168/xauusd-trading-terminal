import type { Bar } from '../market/types';

export type InputType = 'int' | 'float' | 'bool' | 'string' | 'select' | 'color';

export interface InputDef {
  id: string;
  label: string;
  type: InputType;
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export type PlotStyle = 'line' | 'histogram' | 'area' | 'step' | 'dots';

export interface PlotOutput {
  id: string;
  title: string;
  values: number[];
  color: string;
  /** Optional per-bar colors (e.g. histogram up/down, supertrend direction). */
  colors?: (string | undefined)[];
  style: PlotStyle;
  lineWidth?: number;
  /** Shift plot forward/backward by N bars (Ichimoku). */
  offset?: number;
  /** 'overlay' draws on the price pane; any other string groups plots into one separate pane. */
  pane: 'overlay' | 'separate';
}

export interface MarkerOutput {
  index: number;
  position: 'aboveBar' | 'belowBar' | 'inBar';
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  color: string;
  text?: string;
}

export interface SignalOutput {
  long: boolean[];
  short: boolean[];
  exitLong: boolean[];
  exitShort: boolean[];
  /** Optional absolute SL/TP prices suggested by the script at the signal bar. */
  sl: number[];
  tp: number[];
}

export interface IndicatorOutput {
  plots: PlotOutput[];
  markers: MarkerOutput[];
  hlines: { price: number; title: string; color: string }[];
  alerts: { index: number; message: string }[];
  signals: SignalOutput;
}

export interface IndicatorDef {
  id: string;
  name: string;
  shortName: string;
  overlay: boolean;
  inputs: InputDef[];
  /** Default colors keyed by plot id; user can override per instance. */
  colors: Record<string, string>;
  compute: (bars: Bar[], params: Record<string, any>, ctx: { tzOffsetSec: number }) => IndicatorOutput;
  /** Transforms the main candles instead of plotting (Heikin Ashi). */
  transformsCandles?: boolean;
}

export function emptySignals(n: number): SignalOutput {
  return {
    long: new Array(n).fill(false),
    short: new Array(n).fill(false),
    exitLong: new Array(n).fill(false),
    exitShort: new Array(n).fill(false),
    sl: new Array(n).fill(NaN),
    tp: new Array(n).fill(NaN),
  };
}

export function emptyOutput(n: number): IndicatorOutput {
  return { plots: [], markers: [], hlines: [], alerts: [], signals: emptySignals(n) };
}
