import { Panel } from '@/components/ui/Panel';
import { formatMonthShort, lastDayOf, type IsoDate, type YearMonth } from '@/lib/domain/calendar';
import { activeLoanCount, clearedLoanCount } from '@/lib/domain/ledger';
import { isSettledThrough, nextUnpaid, overdueInstallments, remainingBalance } from '@/lib/domain/loans';
import { formatPeso, roundPesos } from '@/lib/domain/money';
import type { DebtSchedule } from '@/lib/domain/types';
import { AddLoan } from './AddLoan';
import { LoanCard } from './LoanCard';

export function LoanPanel({ debts, cycle, today }: { debts: DebtSchedule[]; cycle: YearMonth; today: IsoDate }) {
  const totalRemaining = roundPesos(debts.reduce((sum, debt) => sum + remainingBalance(debt, today), 0));
  const active = activeLoanCount(debts, cycle);

  return (
    <Panel
      title={debts.length === 0 ? 'No loans yet' : `${debts.length} loan${debts.length === 1 ? '' : 's'} · ${formatPeso(totalRemaining)} left to pay`}
      subtitle={
        debts.length === 0
          ? 'Add a loan to see each installment in your runway.'
          : `${clearedLoanCount(debts, cycle)} of ${active} paid for ${formatMonthShort(cycle)}`
      }
      actions={<AddLoan />}
    >
      {debts.length > 0 && (
        <ul className="-mt-1 divide-y divide-gray-100">
          {debts.map((debt) => (
            <LoanCard
              key={debt.id}
              debt={debt}
              cycleMonthShort={formatMonthShort(cycle)}
              settled={isSettledThrough(debt, lastDayOf(cycle))}
              remainingBalance={remainingBalance(debt, today)}
              nextInstallment={nextUnpaid(debt)}
              overdueCount={overdueInstallments(debt, today).length}
              today={today}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}
