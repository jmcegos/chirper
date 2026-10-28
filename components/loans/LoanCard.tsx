'use client';

import { Pencil, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { removeDebt, toggleDebtPaid } from '@/app/actions';
import { Badge } from '@/components/ui/Badge';
import { Money } from '@/components/ui/Money';
import { SettleToggle } from '@/components/ui/SettleToggle';
import { formatShortDate, type IsoDate } from '@/lib/domain/calendar';
import { amountDueOn, frequencyLabel, onTimeAmount, type Installment } from '@/lib/domain/loans';
import { formatPeso } from '@/lib/domain/money';
import type { DebtSchedule } from '@/lib/domain/types';
import { LoanForm } from './LoanForm';

export interface LoanCardProps {
  debt: DebtSchedule;
  cycleMonthShort: string;
  /** Every installment due through the end of the cycle month is paid. */
  settled: boolean;
  remainingBalance: number;
  nextInstallment: Installment | null;
  overdueCount: number;
  today: IsoDate;
}

export function LoanCard({ debt, cycleMonthShort, settled, remainingBalance, nextInstallment, overdueCount, today }: LoanCardProps) {
  const [editing, setEditing] = useState(false);
  const [isDeleting, startDelete] = useTransition();
  const paid = debt.paidInstallmentNumbers.length;
  const progress = Math.min(100, (paid / debt.totalInstallments) * 100);
  const finished = nextInstallment === null;
  const nextOverdue = nextInstallment !== null && nextInstallment.date < today;
  const payAmount = nextInstallment ? amountDueOn(debt, nextInstallment, today) : 0;
  const undoAmount = debt.lastPayment ? (debt.lastPayment.amountPaid ?? onTimeAmount(debt)) : 0;
  const terms = [
    debt.rebateAmount > 0 && `${formatPeso(debt.rebateAmount)} off if paid on time`,
    debt.penaltyAmount > 0 && `${formatPeso(debt.penaltyAmount)} late penalty`,
  ].filter(Boolean);

  if (editing) {
    return (
      <li className="py-4">
        <LoanForm debt={debt} onDone={() => setEditing(false)} />
      </li>
    );
  }

  const confirmDelete = () => {
    if (window.confirm(`Delete "${debt.name}"? This cannot be undone.`)) startDelete(() => removeDebt(debt.id));
  };

  return (
    <li className={`space-y-3 py-4 ${isDeleting ? 'opacity-40' : ''}`}>
      <div className="flex justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{debt.name}</p>
            {overdueCount > 0 && <Badge tone="outflow">{overdueCount} overdue</Badge>}
          </div>
          <p className={`text-[13px] ${nextOverdue ? 'text-rose-700' : 'text-gray-500'}`}>
            {[debt.lender, frequencyLabel(debt)].filter(Boolean).join(' · ')}
            {nextInstallment ? ` · Next ${formatShortDate(nextInstallment.date)}${nextOverdue ? ' (overdue)' : ''}` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Money value={debt.installmentAmount} className="text-sm font-semibold" />
          <p className="text-xs text-gray-500">per installment</p>
        </div>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-label={`${debt.name} progress`} aria-valuenow={paid} aria-valuemin={0} aria-valuemax={debt.totalInstallments}>
        <div className={`h-full rounded-full ${finished ? 'bg-emerald-600' : 'bg-gray-900'}`} style={{ width: `${progress}%` }} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-gray-600">
          {paid} of {debt.totalInstallments} paid ·{' '}
          {finished ? <span className="text-emerald-700">Fully paid</span> : <>{formatPeso(remainingBalance)} left</>}
        </p>
        <div className="flex items-center gap-1.5">
          <SettleToggle
            settled={settled}
            settledLabel={`Paid for ${cycleMonthShort}`}
            pendingLabel={`Pay #${nextInstallment?.number ?? ''} · ${formatPeso(payAmount)}`}
            // Settled → undo refunds the last payment; otherwise pay the next one at today's amount.
            amount={settled ? undoAmount : payAmount}
            direction="out"
            onToggle={(syncWallet) => toggleDebtPaid(debt.id, syncWallet)}
          />
          <button type="button" className="btn-icon" aria-label={`Edit ${debt.name}`} onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" />
          </button>
          <button type="button" className="btn-icon hover:text-rose-700" aria-label={`Delete ${debt.name}`} onClick={confirmDelete} disabled={isDeleting}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {(terms.length > 0 || debt.notes) && <p className="text-xs text-gray-500">{[...terms, debt.notes].filter(Boolean).join(' · ')}</p>}
    </li>
  );
}
