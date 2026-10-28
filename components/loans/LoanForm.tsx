'use client';

import { Loader2, Save, X } from 'lucide-react';
import { useMemo, useState, useTransition } from 'react';
import { saveDebt } from '@/app/actions';
import { formatLongDate, isIsoDate, todayLocal } from '@/lib/domain/calendar';
import { dueDateOf, pastDueNumbers } from '@/lib/domain/loans';
import { formatPeso } from '@/lib/domain/money';
import type { DebtSchedule, LoanFrequency } from '@/lib/domain/types';

const MAX_INSTALLMENTS = 600;

export function LoanForm({ debt, onDone }: { debt?: DebtSchedule; onDone: () => void }) {
  const [isPending, startTransition] = useTransition();
  const today = todayLocal();
  const [firstDueDate, setFirstDueDate] = useState(debt?.firstDueDate ?? '');
  const [frequency, setFrequency] = useState<LoanFrequency>(debt?.frequency ?? 'monthly');
  const [totalInstallments, setTotalInstallments] = useState(debt?.totalInstallments ?? 12);
  const [installmentAmount, setInstallmentAmount] = useState(debt?.installmentAmount ?? 0);
  const [penaltyAmount, setPenaltyAmount] = useState(debt?.penaltyAmount ?? 0);
  // Past installments are paid by default; this holds the ones the user unticked.
  const [unpaid, setUnpaid] = useState<Set<number>>(() => {
    if (!debt) return new Set();
    const paid = new Set(debt.paidInstallmentNumbers);
    return new Set(pastDueNumbers(debt, today).filter((n) => !paid.has(n)));
  });

  const past = useMemo(() => {
    const total = Math.min(MAX_INSTALLMENTS, Math.max(0, Math.floor(totalInstallments)));
    if (!isIsoDate(firstDueDate) || total < 1) return [];
    return pastDueNumbers({ firstDueDate, frequency, totalInstallments: total }, today);
  }, [firstDueDate, frequency, totalInstallments, today]);

  const toggle = (n: number) =>
    setUnpaid((current) => {
      const next = new Set(current);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  const unpaidPast = past.filter((n) => unpaid.has(n));

  return (
    <form
      action={(form) =>
        startTransition(async () => {
          await saveDebt(form);
          onDone();
        })
      }
      className="grid grid-cols-2 gap-2.5 sm:grid-cols-6"
    >
      <input type="hidden" name="id" value={debt?.id ?? 0} />
      <input type="hidden" name="unpaidPastInstallments" value={unpaidPast.join(',')} />
      <label className="col-span-2 sm:col-span-3">
        <span className="label">Loan name</span>
        <input name="name" required defaultValue={debt?.name} className="field" />
      </label>
      <label className="col-span-2 sm:col-span-3">
        <span className="label">Lender</span>
        <input name="lender" defaultValue={debt?.lender} className="field" />
      </label>
      <label className="sm:col-span-2">
        <span className="label">Loan date</span>
        <input name="loanDate" type="date" required defaultValue={debt?.loanDate ?? today} className="field" />
      </label>
      <label className="sm:col-span-2">
        <span className="label">First due date</span>
        <input name="firstDueDate" type="date" required value={firstDueDate} onChange={(event) => setFirstDueDate(event.target.value)} className="field" />
      </label>
      <label className="col-span-2 sm:col-span-2">
        <span className="label">Frequency</span>
        <select name="frequency" value={frequency} onChange={(event) => setFrequency(event.target.value as LoanFrequency)} className="field">
          <option value="monthly">Monthly</option>
          <option value="every_15_days">Every 15 days</option>
        </select>
      </label>
      <label className="sm:col-span-3">
        <span className="label">Amount per installment ₱</span>
        <input
          name="installmentAmount"
          type="number"
          step="0.01"
          min="0.01"
          required
          defaultValue={debt?.installmentAmount}
          onChange={(event) => setInstallmentAmount(Number(event.target.value))}
          className="field-money"
        />
      </label>
      <label className="sm:col-span-3">
        <span className="label">Total installments</span>
        <input
          name="totalInstallments"
          type="number"
          min="1"
          max={MAX_INSTALLMENTS}
          required
          value={totalInstallments}
          onChange={(event) => setTotalInstallments(Number(event.target.value))}
          className="field-money"
        />
      </label>

      <label className="sm:col-span-3">
        <span className="label">On-time rebate ₱ (optional)</span>
        <input name="rebateAmount" type="number" step="0.01" min="0" defaultValue={debt?.rebateAmount || ''} placeholder="0.00" className="field-money" />
      </label>
      <label className="sm:col-span-3">
        <span className="label">Late penalty ₱ per late installment (optional)</span>
        <input
          name="penaltyAmount"
          type="number"
          step="0.01"
          min="0"
          defaultValue={debt?.penaltyAmount || ''}
          placeholder="0.00"
          onChange={(event) => setPenaltyAmount(Number(event.target.value))}
          className="field-money"
        />
      </label>

      {past.length > 0 && (
        <fieldset className="col-span-2 rounded-md border border-gray-200 p-3 sm:col-span-6">
          <legend className="label px-1">Past due dates — untick any you haven&apos;t paid</legend>
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {past.map((n) => (
              <li key={n}>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={!unpaid.has(n)} onChange={() => toggle(n)} className="h-3.5 w-3.5 accent-gray-900" />
                  <span className="w-8 text-gray-500">#{n}</span>
                  <span className="text-gray-700">{formatLongDate(dueDateOf({ firstDueDate, frequency }, n))}</span>
                  {unpaid.has(n) ? (
                    <span className="text-rose-700">
                      Unpaid — overdue
                      {installmentAmount > 0 && ` · ${formatPeso(installmentAmount + penaltyAmount)}`}
                      {penaltyAmount > 0 && ` (incl. ${formatPeso(penaltyAmount)} penalty)`}
                    </span>
                  ) : (
                    <span className="text-emerald-700">Paid</span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      <label className="col-span-2 sm:col-span-6">
        <span className="label">Notes</span>
        <input name="notes" defaultValue={debt?.notes} className="field" />
      </label>
      <div className="col-span-2 flex justify-end gap-2 sm:col-span-6">
        <button type="button" className="btn-neutral" onClick={onDone} disabled={isPending}>
          <X className="h-4 w-4" /> Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {debt ? 'Save loan' : 'Add loan'}
        </button>
      </div>
    </form>
  );
}
