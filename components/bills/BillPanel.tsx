import { Receipt } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { isBillDone, isBillSettledThrough, lastBillPayment, nextUnpaidOccurrence, occurrencesThrough, overdueOccurrences } from '@/lib/domain/bills';
import { formatMonthShort, lastDayOf, type IsoDate, type YearMonth } from '@/lib/domain/calendar';
import { formatPeso, roundPesos } from '@/lib/domain/money';
import type { Bill } from '@/lib/domain/types';
import { AddBill } from './AddBill';
import { BillCard } from './BillCard';

/** Unpaid amount due on or before the end of the cycle month, overdue included. */
function dueThroughCycle(bills: Bill[], cycle: YearMonth): number {
  const end = lastDayOf(cycle);
  return roundPesos(
    bills.reduce((sum, bill) => sum + occurrencesThrough(bill, end).filter((item) => !item.paid).reduce((total, item) => total + item.amount, 0), 0),
  );
}

export function BillPanel({ bills, cycle, today }: { bills: Bill[]; cycle: YearMonth; today: IsoDate }) {
  const monthShort = formatMonthShort(cycle);

  if (bills.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-600">
          <Receipt className="h-[22px] w-[22px]" />
        </span>
        <h2 className="text-[15px] font-semibold">No bills yet</h2>
        <p className="max-w-xs text-sm text-gray-500">Add rent, utilities, subscriptions or a planned purchase so it shows up in your runway before it&apos;s due.</p>
        <div className="flex w-full flex-wrap justify-center">
          <AddBill />
        </div>
      </div>
    );
  }

  return (
    <Panel
      title={`${bills.length} bill${bills.length === 1 ? '' : 's'}`}
      subtitle={`${formatPeso(dueThroughCycle(bills, cycle))} still due by the end of ${monthShort}`}
      actions={<AddBill />}
    >
      <ul className="-mt-1 divide-y divide-gray-100">
        {bills.map((bill) => (
          <BillCard
            key={bill.id}
            bill={bill}
            cycleMonthShort={monthShort}
            settled={isBillDone(bill) || isBillSettledThrough(bill, lastDayOf(cycle))}
            done={isBillDone(bill)}
            next={nextUnpaidOccurrence(bill)}
            overdueCount={overdueOccurrences(bill, today).length}
            lastPaidAmount={lastBillPayment(bill)?.paidAmount ?? 0}
            today={today}
          />
        ))}
      </ul>
    </Panel>
  );
}
