'use client';

import { Check, Clock, Loader2, X } from 'lucide-react';
import { useState, useTransition } from 'react';
import { formatPeso } from '@/lib/domain/money';

interface SettleToggleProps {
  settled: boolean;
  settledLabel: string;
  pendingLabel: string;
  /** Peso amount the wallet moves by when the flag flips to settled. */
  amount: number;
  direction: 'in' | 'out';
  onToggle: (syncWallet: boolean) => Promise<void>;
}

/**
 * Flips a received/paid flag. Before flipping it asks whether the live wallet
 * balance should move too, so a manually-synced wallet is never double counted.
 */
export function SettleToggle({ settled, settledLabel, pendingLabel, amount, direction, onToggle }: SettleToggleProps) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  const walletMovesUp = (direction === 'in') !== settled;
  const walletLabel = `${walletMovesUp ? 'Add' : 'Deduct'} ${formatPeso(amount)} ${walletMovesUp ? 'to' : 'from'} wallet`;

  const run = (syncWallet: boolean) =>
    startTransition(async () => {
      await onToggle(syncWallet);
      setConfirming(false);
    });

  if (isPending) {
    return (
      <span className="btn-neutral">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving
      </span>
    );
  }

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {amount > 0 && (
          <button type="button" className="btn-primary" onClick={() => run(true)}>
            {walletLabel}
          </button>
        )}
        <button type="button" className="btn-neutral" onClick={() => run(false)}>
          {settled ? 'Unmark only' : 'Mark only'}
        </button>
        <button type="button" className="btn-icon" aria-label="Cancel" onClick={() => setConfirming(false)}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className={
        settled ? 'btn border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100' : 'btn-neutral'
      }
    >
      {settled ? <Check className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
      {settled ? settledLabel : pendingLabel}
    </button>
  );
}
