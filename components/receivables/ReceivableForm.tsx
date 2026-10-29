'use client';

import { Loader2, Save, X } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import { saveReceivable } from '@/app/actions';
import { todayLocal } from '@/lib/domain/calendar';
import { formatPeso } from '@/lib/domain/money';
import type { Receivable } from '@/lib/domain/types';

/** Add or edit money someone owes. Adding asks whether the lent cash came out of the wallet. */
export function ReceivableForm({ receivable, onDone }: { receivable?: Receivable; onDone: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(receivable ? String(receivable.amount) : '');
  const [promisedDate, setPromisedDate] = useState(receivable?.promisedDate ?? '');
  const [expected, setExpected] = useState(receivable?.expected ?? false);
  // Set by whichever submit button was pressed, read when the action runs.
  const deductFromWallet = useRef(false);
  const amountLabel = Number(amount) > 0 ? formatPeso(Number(amount)) : 'it';

  return (
    <form
      action={(form) =>
        startTransition(async () => {
          const message = await saveReceivable(form, deductFromWallet.current);
          setError(message);
          if (message === null) onDone();
        })
      }
      className="grid grid-cols-2 gap-2.5 sm:grid-cols-6"
    >
      <input type="hidden" name="id" value={receivable?.id ?? 0} />
      <label className="col-span-2 sm:col-span-3">
        <span className="label">Who owes you</span>
        <input name="person" required defaultValue={receivable?.person} placeholder="e.g. Ana" className="field" />
      </label>
      <label className="col-span-2 sm:col-span-3">
        <span className="label">Amount owed ₱</span>
        <input
          name="amount"
          type="number"
          step="0.01"
          min="0.01"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className="field-money"
        />
      </label>
      <label className="col-span-2 sm:col-span-6">
        <span className="label">What it was for</span>
        <input name="description" defaultValue={receivable?.description} placeholder="e.g. Phone repair" className="field" />
      </label>
      <label className="sm:col-span-3">
        <span className="label">Lent on</span>
        <input name="lentDate" type="date" required defaultValue={receivable?.lentDate ?? todayLocal()} className="field" />
      </label>
      <label className="sm:col-span-3">
        <span className="label">Promised to pay by</span>
        <input
          name="promisedDate"
          type="date"
          value={promisedDate}
          onChange={(event) => {
            setPromisedDate(event.target.value);
            if (!event.target.value) setExpected(false);
          }}
          className="field"
        />
      </label>
      <label className={`col-span-2 flex items-start gap-2.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 sm:col-span-6 ${promisedDate ? '' : 'opacity-60'}`}>
        <input
          name="expected"
          type="checkbox"
          checked={expected}
          disabled={!promisedDate}
          onChange={(event) => setExpected(event.target.checked)}
          className="mt-0.5 h-4 w-4 accent-indigo-600"
        />
        <span>
          <span className="block text-sm font-medium">Count on it in my runway</span>
          <span className="block text-[13px] text-gray-500">
            {promisedDate ? 'Shows as money in on the promised date.' : 'Set a promised date first.'}
          </span>
        </span>
      </label>
      <label className="col-span-2 sm:col-span-6">
        <span className="label">Notes</span>
        <input name="notes" defaultValue={receivable?.notes} className="field" />
      </label>
      {error && <p className="col-span-2 text-[13px] text-rose-700 sm:col-span-6">{error}</p>}
      <div className="col-span-2 flex flex-wrap justify-end gap-2 sm:col-span-6">
        <button type="button" className="btn-neutral" onClick={onDone} disabled={isPending}>
          <X className="h-4 w-4" /> Cancel
        </button>
        {receivable ? (
          <button type="submit" className="btn-primary" disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </button>
        ) : (
          <>
            <button type="submit" className="btn-neutral" disabled={isPending} onClick={() => (deductFromWallet.current = false)}>
              Record only
            </button>
            <button type="submit" className="btn-primary" disabled={isPending} onClick={() => (deductFromWallet.current = true)}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />} Deduct {amountLabel} from wallet
            </button>
          </>
        )}
      </div>
    </form>
  );
}
