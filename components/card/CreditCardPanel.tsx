'use client';

import { ChevronDown, Loader2, ShieldCheck } from 'lucide-react';
import { useState, useTransition, type ReactNode } from 'react';
import { saveCard, toggleCardPaid } from '@/app/actions';
import { Money } from '@/components/ui/Money';
import { Panel } from '@/components/ui/Panel';
import { SettleToggle } from '@/components/ui/SettleToggle';
import { formatShortDate, ordinal } from '@/lib/domain/calendar';
import type { CardBill } from '@/lib/domain/creditCard';
import { formatPeso } from '@/lib/domain/money';
import type { CreditCard } from '@/lib/domain/types';

export interface CardInsight {
  card: CreditCard;
  bill: CardBill | null;
  nextBill: CardBill | null;
  /** Max spend for the next statement alone that keeps the ledger ≥ ₱0. */
  nextBillCeiling: number | null;
}

function MoneyField({ name, label, value }: { name: string; label: string; value: number }) {
  return (
    <label>
      <span className="label">{label}</span>
      <input key={value} name={name} type="number" step="0.01" min="0" required defaultValue={value.toFixed(2)} className="field-money" />
    </label>
  );
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-gray-50 p-3.5">
      <p className="eyebrow">{label}</p>
      <div className="mt-1 text-lg font-semibold">{children}</div>
    </div>
  );
}

function CardRow({ card, bill, nextBill, nextBillCeiling }: CardInsight) {
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const overCeiling = nextBill !== null && nextBillCeiling !== null && nextBill.amount > nextBillCeiling;

  return (
    <li className="space-y-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{card.name}</p>
          <p className="text-[13px] text-gray-500">
            Statement on the {ordinal(card.statementDay)} · due on the {ordinal(card.dueDay)}
          </p>
        </div>
        <SettleToggle
          settled={card.paidThisMonth}
          settledLabel="Statement paid"
          pendingLabel={bill ? `Pay ${formatPeso(bill.amount)}` : 'Mark paid'}
          amount={card.paidThisMonth ? card.lastPaidAmount : (bill?.amount ?? 0)}
          direction="out"
          onToggle={(syncWallet) => toggleCardPaid(card.id, syncWallet)}
        />
      </div>

      {bill && (
        <div className="grid grid-cols-2 gap-3">
          <Tile label="Current bill">
            <Money value={bill.amount} />
          </Tile>
          <Tile label="Due">{formatShortDate(bill.dueDate)}</Tile>
        </div>
      )}

      {nextBill && nextBillCeiling !== null && (
        <p className={`flex items-start gap-2 text-[13px] ${overCeiling ? 'text-rose-700' : 'text-gray-600'}`}>
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Keep the {formatShortDate(nextBill.statementDate)} statement under <strong className="font-semibold">{formatPeso(nextBillCeiling)}</strong> so your
            balance never dips below ₱0. Projected: {formatPeso(nextBill.amount)}.
          </span>
        </p>
      )}

      <div className="rounded-xl border border-gray-200">
        <button
          type="button"
          aria-expanded={editing}
          onClick={() => setEditing(!editing)}
          className="flex min-h-[44px] w-full items-center justify-between px-4 text-left text-[13px] font-medium text-gray-700"
        >
          Update balances
          <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${editing ? 'rotate-180' : ''}`} />
        </button>
        {editing && (
          <form action={(form) => startTransition(() => saveCard(form))} className="grid grid-cols-2 gap-3 px-4 pb-4">
            <input type="hidden" name="id" value={card.id} />
            <MoneyField name="statementBalance" label="Statement balance" value={card.statementBalance} />
            <MoneyField name="unbilledAmount" label="Unbilled spend" value={card.unbilledAmount} />
            <MoneyField name="minimumDue" label="Minimum due" value={card.minimumDue} />
            <MoneyField name="projectedMonthlySpend" label="Next month projected" value={card.projectedMonthlySpend} />
            <div className="col-span-2 flex justify-end">
              <button type="submit" className="btn-primary" disabled={isPending}>
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Save card
              </button>
            </div>
          </form>
        )}
      </div>
    </li>
  );
}

export function CreditCardPanel({ insights }: { insights: CardInsight[] }) {
  return (
    <Panel
      title={insights.length === 1 ? 'Credit card' : 'Credit cards'}
      subtitle={insights.length === 0 ? 'No credit cards tracked. Ask Fin to add one.' : 'The statement date only sets the bill; cash leaves on the due date.'}
    >
      {insights.length > 0 && (
        <ul className="-mt-1 divide-y divide-gray-100">
          {insights.map((insight) => (
            <CardRow key={insight.card.id} {...insight} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
