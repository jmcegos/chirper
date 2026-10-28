'use client';

import { Loader2, Trash2 } from 'lucide-react';
import { useRef, useTransition } from 'react';
import { logQuickExpense, removeQuickExpense } from '@/app/actions';
import { Money } from '@/components/ui/Money';
import { Panel } from '@/components/ui/Panel';
import { formatShortDate } from '@/lib/domain/calendar';
import { formatPeso } from '@/lib/domain/money';
import type { QuickExpense } from '@/lib/domain/types';

const VISIBLE_EXPENSES = 8;

interface QuickExpensePanelProps {
  expenses: QuickExpense[];
  dailySafeSpend: number;
  cycleKey: string;
  paydayLabel: string;
}

export function QuickExpensePanel({ expenses, dailySafeSpend, cycleKey, paydayLabel }: QuickExpensePanelProps) {
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const cycleTotal = expenses.filter((expense) => expense.dateLogged.startsWith(cycleKey)).reduce((sum, expense) => sum + expense.amount, 0);

  return (
    <Panel title="Log a quick expense" subtitle="Comes straight out of your wallet balance.">
      <form
        ref={formRef}
        action={(form) =>
          startTransition(async () => {
            await logQuickExpense(form);
            formRef.current?.reset();
          })
        }
        className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2.5"
      >
        <label>
          <span className="label">What</span>
          <input name="description" required placeholder="Groceries, gas, load…" className="field" />
        </label>
        <label>
          <span className="label">Amount</span>
          <input name="amount" type="number" step="0.01" min="0.01" required inputMode="decimal" placeholder="₱0.00" className="field-money" />
        </label>
        <button type="submit" className="btn-primary col-span-2 h-10" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Add expense
        </button>
      </form>

      {expenses.length === 0 ? (
        <p className="mt-4 rounded-xl bg-gray-50 p-3.5 text-[13px] text-gray-600">
          Nothing logged this cycle. Staying under {formatPeso(dailySafeSpend)} a day keeps you safe until {paydayLabel}.
        </p>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-gray-100 text-sm">
            {expenses.slice(0, VISIBLE_EXPENSES).map((expense) => (
              <li key={expense.id} className="flex min-h-[44px] items-center gap-3">
                <span className="w-14 shrink-0 text-[13px] text-gray-500">{formatShortDate(expense.dateLogged)}</span>
                <span className="min-w-0 flex-1 truncate">{expense.description}</span>
                <Money value={-expense.amount} />
                <button
                  type="button"
                  aria-label={`Delete ${expense.description} and refund wallet`}
                  className="btn-icon border-transparent text-gray-500 hover:text-rose-700"
                  onClick={() => startTransition(() => removeQuickExpense(expense.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-right text-[13px] text-gray-500">
            This cycle: <Money value={-cycleTotal} className="font-medium" />
          </p>
        </>
      )}
    </Panel>
  );
}
