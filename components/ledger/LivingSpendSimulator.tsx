'use client';

import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { formatShortDate } from '@/lib/domain/calendar';
import type { SpendCeiling } from '@/lib/domain/insights';
import { formatPeso } from '@/lib/domain/money';

const STEP = 100;

interface SimulatorProps {
  value: number;
  onChange: (value: number) => void;
  ceiling: SpendCeiling;
}

/** "What if I spend ₱X a month on food and gas?" Folded away until asked for. */
export function LivingSpendSimulator({ value, onChange, ceiling }: SimulatorProps) {
  const [open, setOpen] = useState(value > 0);
  const max = Math.max(20_000, Math.ceil((ceiling.monthlyCeiling * 2) / 1000) * 1000);
  const overCeiling = value > ceiling.monthlyCeiling;

  return (
    <div className="rounded-xl bg-gray-50">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 px-4 text-left text-[13px] font-medium text-gray-700"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-gray-500" />
          {value > 0 ? `Simulating ${formatPeso(value)}/mo living spend` : 'What if I spend on food, gas and daily needs?'}
        </span>
        <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-2 px-4 pb-4">
          <div className="flex items-center gap-3">
            <label htmlFor="living-spend" className="sr-only">
              Monthly living spend slider
            </label>
            <input
              id="living-spend"
              type="range"
              min={0}
              max={max}
              step={STEP}
              value={Math.min(value, max)}
              onChange={(event) => onChange(Number(event.target.value))}
              className="flex-1 accent-indigo-600"
            />
            <input
              type="number"
              min={0}
              step={STEP}
              value={value}
              onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
              aria-label="Monthly living spend in pesos"
              className="field-money h-9 w-28 text-right"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className={overCeiling ? 'text-rose-700' : 'text-gray-600'}>
              Max safe: <span className="font-semibold text-gray-900">{formatPeso(ceiling.monthlyCeiling)}/mo</span> (about{' '}
              {formatPeso(ceiling.monthlyCeiling / 30)}/day)
              {ceiling.bindingEvent && `, tightest on ${formatShortDate(ceiling.bindingEvent.date)}`}
            </span>
            <span className="flex gap-1.5">
              <button type="button" className="btn-neutral min-h-[32px]" onClick={() => onChange(Math.floor(ceiling.monthlyCeiling / STEP) * STEP)}>
                Use max
              </button>
              <button type="button" className="btn-neutral min-h-[32px]" onClick={() => onChange(0)}>
                Clear
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
