import { HandCoins } from 'lucide-react';
import { Money } from '@/components/ui/Money';
import { Panel } from '@/components/ui/Panel';
import { formatMonthShort, lastDayOf, type IsoDate, type YearMonth } from '@/lib/domain/calendar';
import { activeLoanCount, clearedLoanCount } from '@/lib/domain/ledger';
import { isSettledThrough, nextUnpaid, overdueInstallments, remainingBalance } from '@/lib/domain/loans';
import { roundPesos } from '@/lib/domain/money';
import type { DebtSchedule } from '@/lib/domain/types';
import { AddLoan } from './AddLoan';
import { LoanCard } from './LoanCard';

export function LoanPanel({ debts, cycle, today }: { debts: DebtSchedule[]; cycle: YearMonth; today: IsoDate }) {
  const totalRemaining = roundPesos(debts.reduce((sum, debt) => sum + remainingBalance(debt, today), 0));

  return (
    <Panel
      title="Loan Amortization & Installment Tracker"
      subtitle={`${clearedLoanCount(debts, cycle)}/${activeLoanCount(debts, cycle)} loans clear through ${formatMonthShort(cycle)}`}
      icon={HandCoins}
      actions={
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Total remaining</p>
          <Money value={totalRemaining} tone="warning" className="text-sm font-semibold" />
        </div>
      }
    >
      <ul className="space-y-3">
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
      <div className="mt-3">
        <AddLoan />
      </div>
    </Panel>
  );
}
