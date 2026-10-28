'use client';

import { useTransition } from 'react';
import { stepAbsences } from '@/app/actions';
import { formatPeso } from '@/lib/domain/money';

const STEPS = [
  { label: '−½', delta: -0.5, name: 'Remove half a day' },
  { label: '+½', delta: 0.5, name: 'Add half a day' },
  { label: '+1', delta: 1, name: 'Add a day' },
];

interface AbsenceStepperProps {
  incomeId: number;
  period: 'current' | 'next';
  monthLabel: string;
  absences: number;
  absenceRate: number;
}

export function AbsenceStepper({ incomeId, period, monthLabel, absences, absenceRate }: AbsenceStepperProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="w-28 text-[13px] text-gray-600">{monthLabel} absences</span>
      <div className="flex overflow-hidden rounded-lg border border-gray-300 bg-white">
        {STEPS.map((step) => (
          <button
            key={step.label}
            type="button"
            aria-label={`${step.name} (${monthLabel})`}
            disabled={isPending || (step.delta < 0 && absences <= 0)}
            onClick={() => startTransition(() => stepAbsences(incomeId, period, step.delta))}
            className="min-h-[32px] min-w-[40px] border-r border-gray-300 text-sm text-gray-700 last:border-r-0 hover:bg-gray-100 disabled:opacity-40"
          >
            {step.label}
          </button>
        ))}
      </div>
      <span className={`text-sm font-semibold tabular-nums ${absences > 0 ? 'text-amber-700' : 'text-gray-500'}`}>
        {absences} day{absences === 1 ? '' : 's'}
      </span>
      {absences > 0 && <span className="text-xs text-amber-700">−{formatPeso(absenceRate)} × {absences}</span>}
    </div>
  );
}
