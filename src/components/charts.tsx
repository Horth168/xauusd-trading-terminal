import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { usd } from '../lib/format';

const axis = { stroke: '#3a3a43', tick: { fill: '#6b6b76', fontSize: 11 }, tickLine: false };
const tooltipStyle = { contentStyle: { background: '#16161a', border: '1px solid #2a2a31', borderRadius: 8, fontSize: 12 }, labelStyle: { color: '#c9c9d1' } };

export function downsample<T>(arr: T[], max = 1200): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  out.push(arr[arr.length - 1]);
  return out;
}

export function EquityChart({ data, height = 260, showBalance = true }: { data: { label: string; equity: number; balance?: number }[]; height?: number; showBalance?: boolean }) {
  const min = Math.min(...data.map((d) => Math.min(d.equity, d.balance ?? d.equity)));
  const max = Math.max(...data.map((d) => Math.max(d.equity, d.balance ?? d.equity)));
  const pad = (max - min) * 0.05 || 1;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d4a72c" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#d4a72c" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1e1e23" vertical={false} />
        <XAxis dataKey="label" {...axis} minTickGap={40} />
        <YAxis {...axis} width={70} domain={[min - pad, max + pad]} tickFormatter={(v) => usd(v, 0)} />
        <Tooltip {...tooltipStyle} formatter={(v: number) => usd(v)} />
        <Area type="monotone" dataKey="equity" name="Equity" stroke="#e8c25a" fill="url(#eqFill)" strokeWidth={2} dot={false} isAnimationActive={false} />
        {showBalance && <Area type="stepAfter" dataKey="balance" name="Balance" stroke="#6b8afd" fill="none" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function PnlBars({ data, height = 220 }: { data: { label: string; pnl: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#1e1e23" vertical={false} />
        <XAxis dataKey="label" {...axis} minTickGap={20} />
        <YAxis {...axis} width={64} tickFormatter={(v) => usd(v, 0)} />
        <Tooltip {...tooltipStyle} formatter={(v: number) => usd(v)} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
        <ReferenceLine y={0} stroke="#3a3a43" />
        <Bar dataKey="pnl" name="P&L" isAnimationActive={false} radius={[3, 3, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? '#22b07d' : '#e5484d'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MultiLine({ data, series, height = 260, yFormat = (v: number) => usd(v, 0) }: { data: Record<string, any>[]; series: { key: string; name: string; color: string }[]; height?: number; yFormat?: (v: number) => string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#1e1e23" vertical={false} />
        <XAxis dataKey="label" {...axis} minTickGap={40} />
        <YAxis {...axis} width={64} tickFormatter={yFormat} />
        <Tooltip {...tooltipStyle} formatter={(v: number) => yFormat(v)} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {series.map((s) => <Line key={s.key} dataKey={s.key} name={s.name} stroke={s.color} dot={false} strokeWidth={1.8} isAnimationActive={false} connectNulls />)}
      </LineChart>
    </ResponsiveContainer>
  );
}
