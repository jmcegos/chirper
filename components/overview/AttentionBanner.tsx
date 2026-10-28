'use client';

import { AlertCircle } from 'lucide-react';
import { toggleIncomeReceived } from '@/app/actions';
import { SettleToggle } from '@/components/ui/SettleToggle';
import { openManageTab, type ManageTab } from '@/components/ui/uiEvents';
import { formatShortDate, type IsoDate } from '@/lib/domain/calendar';
import { formatPeso } from '@/lib/domain/money';

export interface AttentionItem {
  id: string;
  title: string;
  amount: number;
  scheduledDate: IsoDate;
  /** Set for overdue income, which can be marked received right here. */
  incomeId: number | null;
  tab: ManageTab;
}

function message(item: AttentionItem): string {
  const when = formatShortDate(item.scheduledDate);
  return item.amount > 0
    ? `${item.title} hasn't been marked received. ${formatPeso(item.amount)} was expected on ${when}.`
    : `${item.title} is overdue. ${formatPeso(-item.amount)} was due on ${when}.`;
}

/** Overdue items, each with the one action that clears it. */
export function AttentionBanner({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Needs attention" className="divide-y divide-amber-200/70 rounded-2xl border border-amber-200 bg-amber-50">
      {items.map((item) => (
        <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <p className="flex min-w-0 items-start gap-2.5 text-sm text-amber-900">
            <AlertCircle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-700" />
            <span>{message(item)}</span>
          </p>
          {item.incomeId !== null ? (
            <SettleToggle
              settled={false}
              settledLabel="Received"
              pendingLabel="Mark received"
              amount={item.amount}
              direction="in"
              onToggle={toggleIncomeReceived.bind(null, item.incomeId)}
            />
          ) : (
            <button type="button" className="btn-neutral" onClick={() => openManageTab(item.tab)}>
              Review
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
