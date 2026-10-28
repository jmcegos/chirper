'use client';

import { Check, Loader2, Pencil, Trash2, X } from 'lucide-react';
import { useState, useTransition } from 'react';
import { removeBill, setBillAmount, toggleBillPaid } from '@/app/actions';
import { Badge } from '@/components/ui/Badge';
import { Money } from '@/components/ui/Money';
import { SettleToggle } from '@/components/ui/SettleToggle';
import { billFrequencyLabel, type BillOccurrence } from '@/lib/domain/bills';
import { formatShortDate, type IsoDate } from '@/lib/domain/calendar';
import { formatPeso } from '@/lib/domain/money';
import type { Bill } from '@/lib/domain/types';
import { BillForm } from './BillForm';

export interface BillCardProps {
  bill: Bill;
  cycleMonthShort: string;
  /** Every due date through the end of the cycle month is paid (or the one-time expense is done). */
  settled: boolean;
  done: boolean;
  next: BillOccurrence | null;
  overdueCount: number;
  /** Refunded by undo: the latest payment's amount. */
  lastPaidAmount: number;
  today: IsoDate;
}

/** Inline "the bill arrived" form for the next unpaid due date. */
function BilledAmountForm({ billId, next, onDone }: { billId: number; next: BillOccurrence; onDone: () => void }) {
  const [isPending, startTransition] = useTransition();
  return (
    <form
      action={(form) =>
        startTransition(async () => {
          await setBillAmount(billId, next.dueDate, form);
          onDone();
        })
      }
      className="flex flex-wrap items-center gap-2 rounded-xl bg-gray-50 p-3"
    >
      <label htmlFor={`billed-${billId}`} className="text-[13px] text-gray-600">
        Billed amount for {formatShortDate(next.dueDate)}
      </label>
      <input id={`billed-${billId}`} name="amount" type="number" step="0.01" min="0" required autoFocus defaultValue={next.amount} className="field-money w-36" />
      <button type="submit" className="btn-icon" aria-label="Save billed amount" disabled={isPending}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </button>
      <button type="button" className="btn-icon" aria-label="Cancel" onClick={onDone} disabled={isPending}>
        <X className="h-4 w-4" />
      </button>
    </form>
  );
}

export function BillCard({ bill, cycleMonthShort, settled, done, next, overdueCount, lastPaidAmount, today }: BillCardProps) {
  const [editing, setEditing] = useState(false);
  const [settingAmount, setSettingAmount] = useState(false);
  const [isDeleting, startDelete] = useTransition();
  const nextIsOverdue = next !== null && next.dueDate < today;

  if (editing) {
    return (
      <li className="py-4">
        <BillForm bill={bill} onDone={() => setEditing(false)} />
      </li>
    );
  }

  const confirmDelete = () => {
    if (window.confirm(`Delete "${bill.name}"? This cannot be undone.`)) startDelete(() => removeBill(bill.id));
  };

  return (
    <li className={`space-y-3 py-4 ${isDeleting ? 'opacity-40' : ''}`}>
      <div className="flex justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{bill.name}</p>
            {overdueCount > 0 && <Badge tone="outflow">{overdueCount} overdue</Badge>}
            {done && <Badge tone="inflow">Done</Badge>}
          </div>
          <p className={`text-[13px] ${nextIsOverdue ? 'text-rose-700' : 'text-gray-500'}`}>
            {billFrequencyLabel(bill)}
            {next ? ` · Next ${formatShortDate(next.dueDate)}${nextIsOverdue ? ' (overdue)' : ''}` : ' · Nothing left to pay'}
          </p>
        </div>
        {next && (
          <div className="shrink-0 text-right">
            <Money value={next.amount} className="text-sm font-semibold" />
            <p className="text-xs text-gray-500">{next.isEstimate ? 'estimated' : 'billed'}</p>
          </div>
        )}
      </div>

      {settingAmount && next && <BilledAmountForm billId={bill.id} next={next} onDone={() => setSettingAmount(false)} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {next && !settingAmount ? (
          <button type="button" className="text-[13px] font-medium text-indigo-700 hover:underline" onClick={() => setSettingAmount(true)}>
            {next.isEstimate ? 'Set billed amount' : 'Change amount'}
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1.5">
          <SettleToggle
            settled={settled}
            settledLabel={done ? 'Paid' : `Paid for ${cycleMonthShort}`}
            pendingLabel={next ? `Pay ${formatPeso(next.amount)}` : 'Pay'}
            // Settled → undo refunds the latest payment; otherwise pay the next due date.
            amount={settled ? lastPaidAmount : (next?.amount ?? 0)}
            direction="out"
            onToggle={(syncWallet) => toggleBillPaid(bill.id, syncWallet)}
          />
          <button type="button" className="btn-icon" aria-label={`Edit ${bill.name}`} onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" />
          </button>
          <button type="button" className="btn-icon hover:text-rose-700" aria-label={`Delete ${bill.name}`} onClick={confirmDelete} disabled={isDeleting}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {bill.notes && <p className="text-xs text-gray-500">{bill.notes}</p>}
    </li>
  );
}
