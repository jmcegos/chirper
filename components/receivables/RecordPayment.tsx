'use client';

import { Loader2, X } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import { recordReceivablePayment } from '@/app/actions';
import type { IsoDate } from '@/lib/domain/calendar';
import { formatPeso } from '@/lib/domain/money';

interface RecordPaymentProps {
  receivableId: number;
  remaining: number;
  lentDate: IsoDate;
  today: IsoDate;
  onDone: () => void;
}

/** Inline "they paid me" form; the amount starts at what is left, so a full payment is one tap. */
export function RecordPayment({ receivableId, remaining, lentDate, today, onDone }: RecordPaymentProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(String(remaining));
  const syncWallet = useRef(true);
  const amountLabel = Number(amount) > 0 ? formatPeso(Number(amount)) : '';

  return (
    <form
      action={(form) =>
        startTransition(async () => {
          const message = await recordReceivablePayment(receivableId, syncWallet.current, form);
          setError(message);
          if (message === null) onDone();
        })
      }
      className="space-y-2.5 rounded-xl bg-gray-50 p-3"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className="label">Amount received ₱</span>
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            max={remaining}
            required
            autoFocus
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="field-money w-36"
          />
        </label>
        <label>
          <span className="label">On</span>
          <input name="paidOn" type="date" required defaultValue={today} min={lentDate} max={today} className="field w-40" />
        </label>
      </div>
      {error && <p className="text-[13px] text-rose-700">{error}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="submit" className="btn-primary" disabled={isPending} onClick={() => (syncWallet.current = true)}>
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Add {amountLabel} to wallet
        </button>
        <button type="submit" className="btn-neutral" disabled={isPending} onClick={() => (syncWallet.current = false)}>
          Record only
        </button>
        <button type="button" className="btn-icon" aria-label="Cancel" onClick={onDone} disabled={isPending}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </form>
  );
}
