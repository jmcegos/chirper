'use client';

import { Loader2, Save, X } from 'lucide-react';
import { useTransition } from 'react';
import { saveBill } from '@/app/actions';
import { todayLocal } from '@/lib/domain/calendar';
import type { Bill } from '@/lib/domain/types';

export function BillForm({ bill, onDone }: { bill?: Bill; onDone: () => void }) {
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(form) =>
        startTransition(async () => {
          await saveBill(form);
          onDone();
        })
      }
      className="grid grid-cols-2 gap-2.5 sm:grid-cols-6"
    >
      <input type="hidden" name="id" value={bill?.id ?? 0} />
      <label className="col-span-2 sm:col-span-3">
        <span className="label">Bill or expense</span>
        <input name="name" required defaultValue={bill?.name} placeholder="e.g. Meralco, Rent, Netflix" className="field" />
      </label>
      <label className="col-span-2 sm:col-span-3">
        <span className="label">Repeats</span>
        <select name="frequency" defaultValue={bill?.frequency ?? 'monthly'} className="field">
          <option value="monthly">Monthly</option>
          <option value="every_15_days">Every 15 days</option>
          <option value="yearly">Yearly</option>
          <option value="one_time">One-time (planned expense)</option>
        </select>
      </label>
      <label className="sm:col-span-3">
        <span className="label">Next due date</span>
        <input name="nextDueDate" type="date" required defaultValue={bill?.nextDueDate ?? todayLocal()} className="field" />
      </label>
      <label className="sm:col-span-3">
        <span className="label">Estimated amount ₱</span>
        <input name="estimatedAmount" type="number" step="0.01" min="0.01" required defaultValue={bill?.estimatedAmount} className="field-money" />
      </label>
      <label className="col-span-2 sm:col-span-6">
        <span className="label">Notes</span>
        <input name="notes" defaultValue={bill?.notes} className="field" />
      </label>
      <div className="col-span-2 flex justify-end gap-2 sm:col-span-6">
        <button type="button" className="btn-neutral" onClick={onDone} disabled={isPending}>
          <X className="h-4 w-4" /> Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {bill ? 'Save bill' : 'Add bill'}
        </button>
      </div>
    </form>
  );
}
