import { HandCoins } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import type { IsoDate } from '@/lib/domain/calendar';
import { formatPeso } from '@/lib/domain/money';
import { compareReceivables, isPaidOff, outstandingTotal } from '@/lib/domain/receivables';
import type { Receivable } from '@/lib/domain/types';
import { AddReceivable } from './AddReceivable';
import { ReceivableCard } from './ReceivableCard';

export function ReceivablePanel({ receivables, today }: { receivables: Receivable[]; today: IsoDate }) {
  const open = receivables.filter((receivable) => !isPaidOff(receivable)).sort(compareReceivables(today));
  const paidOff = receivables.filter(isPaidOff);

  if (receivables.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-600">
          <HandCoins className="h-[22px] w-[22px]" />
        </span>
        <h2 className="text-[15px] font-semibold">No one owes you right now</h2>
        <p className="max-w-xs text-sm text-gray-500">
          Lent someone money? Add it here and record what they pay back, a little at a time if they need to.
        </p>
        <div className="flex w-full flex-wrap justify-center">
          <AddReceivable />
        </div>
      </div>
    );
  }

  const expected = outstandingTotal(receivables, { expectedOnly: true });

  return (
    <Panel
      title="Owed to me"
      subtitle={`${formatPeso(outstandingTotal(receivables))} outstanding${expected > 0 ? ` · ${formatPeso(expected)} expected` : ''}`}
      actions={<AddReceivable />}
    >
      {open.length > 0 ? (
        <ul className="-mt-1 divide-y divide-gray-100">
          {open.map((receivable) => (
            <ReceivableCard key={receivable.id} receivable={receivable} today={today} />
          ))}
        </ul>
      ) : (
        <p className="py-3 text-sm text-gray-500">Everyone has paid you back.</p>
      )}
      {paidOff.length > 0 && (
        <details className="mt-2 border-t border-gray-100 pt-3">
          <summary className="cursor-pointer select-none text-[13px] font-medium text-gray-600 hover:text-gray-900">Paid off ({paidOff.length})</summary>
          <ul className="divide-y divide-gray-100">
            {paidOff.map((receivable) => (
              <ReceivableCard key={receivable.id} receivable={receivable} today={today} />
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}
