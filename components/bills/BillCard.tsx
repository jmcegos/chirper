'use client';

import { CalendarClock, Check, Loader2, Pencil, Trash2, X } from 'lucide-react';
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
      className="mt-2 flex flex-wrap items-center gap-1.5"
    >
      <span className="text-[11px] text-slate-400">Billed for {formatShortDate(next.dueDate)}:</span>
      <input name="amount" type="number" step="0.01" min="0" required autoFocus defaultValue={next.amount} className="field-money w-32" />
      <button type="submit" className="btn-primary px-1.5" aria-label="Save billed amount" disabled={isPending}>
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      </button>
      <button type="button" className="btn-neutral px-1.5" aria-label="Cancel" onClick={onDone} disabled={isPending}>
        <X className="h-3.5 w-3.5" />
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
      <li className="rounded-lg border border-sky-500/30 bg-slate-950/60 p-3">
        <BillForm bill={bill} onDone={() => setEditing(false)} />
      </li>
    );
  }

  const confirmDelete = () => {
    if (window.confirm(`Delete "${bill.name}"? This cannot be undone.`)) startDelete(() => removeBill(bill.id));
  };

  return (
    <li className={`rounded-lg border border-slate-800 bg-slate-950/40 p-3 ${isDeleting ? 'opacity-40' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="info">{billFrequencyLabel(bill)}</Badge>
            {overdueCount > 0 && <Badge tone="outflow">{overdueCount} overdue</Badge>}
            {done && <Badge tone="inflow">Done ✓</Badge>}
            <span className="text-sm font-medium text-slate-100">{bill.name}</span>
          </div>
          {bill.notes && <p className="mt-0.5 text-xs text-slate-500">{bill.notes}</p>}
        </div>
        {next && (
          <div className="text-right">
            <Money value={next.amount} tone="outflow" className="text-lg font-semibold" />
            <p className="text-[11px] text-slate-500">{next.isEstimate ? 'estimated' : 'billed'}</p>
          </div>
        )}
      </div>

      {settingAmount && next && <BilledAmountForm billId={bill.id} next={next} onDone={() => setSettingAmount(false)} />}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className={`flex items-center gap-1 text-[11px] ${nextIsOverdue ? 'text-rose-400' : 'text-slate-400'}`}>
          <CalendarClock className="h-3.5 w-3.5" />
          {next ? `Next: ${formatShortDate(next.dueDate)}${nextIsOverdue ? ' — overdue' : ''}` : 'Nothing left to pay'}
          {next && !settingAmount && (
            <button type="button" className="ml-1 text-sky-400 underline-offset-2 hover:underline" onClick={() => setSettingAmount(true)}>
              {next.isEstimate ? 'Set billed amount' : 'Change amount'}
            </button>
          )}
        </span>
        <div className="flex items-center gap-1.5">
          <SettleToggle
            settled={settled}
            settledLabel={done ? 'Paid ✓' : `Paid ${cycleMonthShort} ✓`}
            pendingLabel={next ? `Pay ${formatPeso(next.amount)}` : 'Pay'}
            // Settled → undo refunds the latest payment; otherwise pay the next due date.
            amount={settled ? lastPaidAmount : (next?.amount ?? 0)}
            direction="out"
            onToggle={(syncWallet) => toggleBillPaid(bill.id, syncWallet)}
          />
          <button type="button" className="btn-neutral px-1.5" aria-label="Edit bill" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="btn-danger px-1.5" aria-label="Delete bill" onClick={confirmDelete} disabled={isDeleting}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}
