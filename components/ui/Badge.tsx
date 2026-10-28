import type { ReactNode } from 'react';

export type BadgeTone = 'inflow' | 'outflow' | 'warning' | 'info' | 'neutral';

const BADGE_TONE: Record<BadgeTone, string> = {
  inflow: 'bg-emerald-50 text-emerald-800',
  outflow: 'bg-rose-50 text-rose-700',
  warning: 'bg-amber-50 text-amber-800',
  info: 'bg-indigo-50 text-indigo-700',
  neutral: 'bg-gray-100 text-gray-700',
};

export function Badge({ tone = 'neutral', children, className = '' }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_TONE[tone]} ${className}`}>
      {children}
    </span>
  );
}
