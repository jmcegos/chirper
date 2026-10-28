import { formatPeso, formatSignedPeso } from '@/lib/domain/money';

export type Tone = 'inflow' | 'outflow' | 'danger' | 'warning' | 'safe' | 'muted' | 'plain';

export const TONE_TEXT: Record<Tone, string> = {
  inflow: 'text-emerald-700',
  outflow: 'text-gray-900',
  danger: 'text-rose-700',
  warning: 'text-amber-700',
  safe: 'text-gray-900',
  muted: 'text-gray-500',
  plain: 'text-gray-900',
};

interface MoneyProps {
  value: number;
  tone?: Tone;
  signed?: boolean;
  className?: string;
}

export function Money({ value, tone = 'plain', signed = false, className = '' }: MoneyProps) {
  return (
    <span className={`tabular-nums ${TONE_TEXT[tone]} ${className}`}>
      {signed ? formatSignedPeso(value) : formatPeso(value)}
    </span>
  );
}

/** Tone for a signed cash movement: money in is green, money out stays plain. */
export function flowTone(amount: number): Tone {
  if (amount > 0) return 'inflow';
  if (amount < 0) return 'outflow';
  return 'muted';
}

/** Tone for a running balance. */
export function balanceTone(balance: number): Tone {
  return balance < 0 ? 'danger' : 'safe';
}
