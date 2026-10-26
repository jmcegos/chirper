import { Receipt } from 'lucide-react';
import { Money } from '@/components/ui/Money';
import { Panel } from '@/components/ui/Panel';
import { isBillDone, isBillSettledThrough, lastBillPayment, nextUnpaidOccurrence, occurrencesThrough, overdueOccurrences } from '@/lib/domain/bills';
import { formatMonthShort, lastDayOf, type IsoDate, type YearMonth } from '@/lib/domain/calendar';
import { roundPesos } from '@/lib/domain/money';
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

  return (
    <Panel
      title="Bills & Planned Expenses"
      subtitle={bills.length === 0 ? 'Rent, utilities, subscriptions and one-off costs' : `${bills.length} tracked`}
      icon={Receipt}
      actions={
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Still due by end of {monthShort}</p>
          <Money value={dueThroughCycle(bills, cycle)} tone="warning" className="text-sm font-semibold" />
        </div>
      }
    >
      <ul className="space-y-3">
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
      <div className="mt-3">
        <AddBill />
      </div>
    </Panel>
  );
}
