import { create } from 'zustand';
import type { Bar } from '../market/types';
import { subscribeCollection, useAuth, type BaseDoc } from '../lib/db';
import { BUILTIN_MAP, resolveColors } from './builtins';
import { runScriptAsync } from './scriptClient';
import type { IndicatorOutput, InputDef } from './types';
import type { IndicatorInstance } from '../store/settings';

export interface CustomScript extends BaseDoc {
  name: string;
  code: string;
  kind: 'indicator' | 'strategy';
  overlay: boolean;
  inputs: InputDef[];
  plots?: { id: string; title: string; color: string }[];
  description?: string;
}

export const useScripts = create<{ scripts: CustomScript[] }>(() => ({ scripts: [] }));

let unsub: (() => void) | null = null;
export function startScriptRegistry() {
  const attach = () => {
    unsub?.();
    unsub = subscribeCollection<CustomScript>('indicators', (scripts) => useScripts.setState({ scripts }));
  };
  attach();
  useAuth.subscribe((s, prev) => { if (s.user?.uid !== prev.user?.uid) attach(); });
}

export interface IndicatorMeta {
  name: string;
  shortName: string;
  overlay: boolean;
  inputs: InputDef[];
  colors: Record<string, string>;
  transformsCandles?: boolean;
  missing?: boolean;
}

export function indicatorMeta(type: string): IndicatorMeta {
  if (type.startsWith('custom:')) {
    const s = useScripts.getState().scripts.find((x) => x.id === type.slice(7));
    if (!s) return { name: 'Missing custom script', shortName: '?', overlay: true, inputs: [], colors: {}, missing: true };
    return { name: s.name, shortName: s.name, overlay: s.overlay, inputs: s.inputs, colors: Object.fromEntries((s.plots ?? []).map((p) => [p.id, p.color])) };
  }
  const d = BUILTIN_MAP.get(type);
  if (!d) return { name: type, shortName: type, overlay: true, inputs: [], colors: {}, missing: true };
  return { name: d.name, shortName: d.shortName, overlay: d.overlay, inputs: d.inputs, colors: d.colors, transformsCandles: d.transformsCandles };
}

/** Computes an indicator instance on closed+forming bars. Builtins run synchronously; scripts in a worker. */
export async function computeInstance(inst: IndicatorInstance, bars: Bar[], tzOffsetSec: number): Promise<IndicatorOutput> {
  const meta = indicatorMeta(inst.type);
  const colors = { ...meta.colors, ...inst.colors };
  let out: IndicatorOutput;
  if (inst.type.startsWith('custom:')) {
    const s = useScripts.getState().scripts.find((x) => x.id === inst.type.slice(7));
    if (!s) throw new Error('Custom script not found (deleted?)');
    out = (await runScriptAsync(s.code, bars, inst.params)).output;
  } else {
    const def = BUILTIN_MAP.get(inst.type)!;
    out = def.compute(bars, inst.params, { tzOffsetSec });
  }
  resolveColors(out.plots, colors);
  return out;
}
