import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="animate-fade fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`animate-sheet flex max-h-[92dvh] w-full flex-col rounded-t-[28px] border border-white/10 bg-ink-850 shadow-2xl sm:rounded-2xl ${wide ? 'sm:max-w-4xl' : 'sm:max-w-lg'}`}>
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-ink-600 sm:hidden" />
        <div className="flex items-center justify-between px-5 pb-3 pt-3 sm:border-b sm:border-white/5 sm:pt-4">
          <h2 className="text-base font-semibold text-ink-100">{title}</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-white/5 px-5 pb-[calc(12px+var(--safe-bottom))] pt-3 sm:pb-3 [&>button]:h-10 sm:[&>button]:h-9">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, className = '' }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-ink-400">{hint}</span>}
    </label>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'up' | 'down' | 'gold' | null }) {
  const color = tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : tone === 'gold' ? 'text-gold-300' : 'text-ink-100';
  return (
    <div className="card p-3.5 transition-colors hover:border-white/10 md:p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`mt-1.5 truncate text-lg font-semibold tabular-nums tracking-tight md:text-xl ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-ink-400">{sub}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 md:mb-6">
      <div className="min-w-0">
        <h1 className="hidden text-2xl font-semibold tracking-tight text-ink-100 md:block">{title}</h1>
        {subtitle && <p className="text-sm text-ink-400 md:mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card flex flex-col items-center justify-center gap-2 p-10 text-center text-sm text-ink-400">{children}</div>;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-xl border border-white/5 bg-ink-900 p-1 [scrollbar-width:none]">
      {options.map((o) => (
        <button key={o.value} className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${value === o.value ? 'bg-ink-700 text-gold-300 shadow' : 'text-ink-400 hover:text-ink-100'}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
