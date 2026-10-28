'use client';

import { Loader2 } from 'lucide-react';
import { useTransition } from 'react';
import { syncWalletBalance } from '@/app/actions';
import { balanceTone, Money } from '@/components/ui/Money';

export function WalletCard({ walletName, balance }: { walletName: string; balance: number }) {
  const [isPending, startTransition] = useTransition();

  return (
    <section className="card flex h-full flex-col gap-3.5 p-6">
      <h2 className="eyebrow">{/^wallet$/i.test(walletName.trim()) ? 'Wallet' : `Wallet · ${walletName}`}</h2>
      <Money value={balance} tone={balanceTone(balance)} className="text-[32px] font-bold leading-none tracking-tight" />
      <form action={(form) => startTransition(() => syncWalletBalance(form))} className="mt-auto flex gap-2">
        <label htmlFor="wallet-balance" className="sr-only">
          Exact wallet balance
        </label>
        <input
          id="wallet-balance"
          key={balance}
          name="balance"
          type="number"
          step="0.01"
          inputMode="decimal"
          defaultValue={balance.toFixed(2)}
          className="field-money"
        />
        <button type="submit" className="btn-neutral h-10 shrink-0" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Update
        </button>
      </form>
      <p className="text-xs text-gray-500">Type your real bank balance to keep the runway exact.</p>
    </section>
  );
}
