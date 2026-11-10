export interface Bar {
  time: number; // unix seconds, UTC, bar open time
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number; // MT5: tick volume. Twelve Data forex: unavailable
}

export interface Tick {
  time: number; // unix ms
  bid: number;
  ask?: number;
  last?: number;
}

export type FeedKind = 'mt5' | 'twelvedata';

/** Truthful connection state shown in the UI. */
export type FeedStatus =
  | { state: 'connecting'; source: FeedKind }
  | { state: 'live'; source: FeedKind; detail: string }
  | { state: 'delayed'; source: FeedKind; detail: string }
  | { state: 'reconnecting'; source: FeedKind; detail: string; attempt: number }
  | { state: 'offline'; source: FeedKind | null; detail: string }
  | { state: 'error'; source: FeedKind | null; detail: string };

export interface SymbolInfo {
  symbol: string;
  digits: number;
  contractSize: number; // oz per 1.0 lot
  spreadPoints?: number;
  point: number;
  description?: string;
  server?: string;
}
