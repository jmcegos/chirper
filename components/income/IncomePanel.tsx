import { toggleIncomeReceived } from '@/app/actions';
import { Money } from '@/components/ui/Money';
import { Panel } from '@/components/ui/Panel';
import { SettleToggle } from '@/components/ui/SettleToggle';
import { addMonths, formatMonthLabel, formatMonthShort, ordinal, type YearMonth } from '@/lib/domain/calendar';
import { formatPeso, roundPesos } from '@/lib/domain/money';
import { absenceDeduction, netPay, STATUTORY_DEDUCTIONS, statutoryBreakdownMatches } from '@/lib/domain/payroll';
import type { IncomeRule } from '@/lib/domain/types';
import { AbsenceStepper } from './AbsenceStepper';

function PayrollBreakdown({ rule, absences }: { rule: IncomeRule; absences: number }) {
  const lines = statutoryBreakdownMatches(rule)
    ? ` (${STATUTORY_DEDUCTIONS.map((line) => `${line.label} ₱${line.amount.toLocaleString('en-PH')}`).join(', ')})`
    : '';
  const absenceCut = absenceDeduction(rule, absences);
  return (
    <p className="text-xs leading-relaxed text-gray-500">
      {formatPeso(rule.grossAmount)} base − {formatPeso(rule.fixedDeductions)} gov/HMO{lines}
      {absenceCut > 0 && <span className="text-amber-700"> − {formatPeso(absenceCut)} absences</span>}
    </p>
  );
}

function IncomeRow({ rule, cycle }: { rule: IncomeRule; cycle: YearMonth }) {
  const currentNet = netPay(rule, rule.currentAbsences);
  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{rule.name}</p>
          <p className="text-[13px] text-gray-500">
            Every {ordinal(rule.dayOfMonth)} · <Money value={currentNet} tone="inflow" className="font-medium" />
            {rule.isPayroll ? ' net' : ''}
          </p>
        </div>
        <SettleToggle
          settled={rule.receivedThisMonth}
          settledLabel="Received"
          pendingLabel="Mark received"
          amount={currentNet}
          direction="in"
          onToggle={toggleIncomeReceived.bind(null, rule.id)}
        />
      </div>
      {rule.isPayroll && (
        <div className="space-y-2 rounded-xl bg-gray-50 p-3">
          <PayrollBreakdown rule={rule} absences={rule.currentAbsences} />
          <AbsenceStepper
            incomeId={rule.id}
            period="current"
            monthLabel={formatMonthShort(cycle)}
            absences={rule.currentAbsences}
            absenceRate={rule.absenceRate}
          />
          <AbsenceStepper
            incomeId={rule.id}
            period="next"
            monthLabel={formatMonthShort(addMonths(cycle, 1))}
            absences={rule.nextMonthAbsences}
            absenceRate={rule.absenceRate}
          />
        </div>
      )}
    </li>
  );
}

export function IncomePanel({ incomes, cycle }: { incomes: IncomeRule[]; cycle: YearMonth }) {
  const expected = roundPesos(incomes.reduce((sum, rule) => sum + netPay(rule, rule.currentAbsences), 0));
  const received = roundPesos(incomes.filter((rule) => rule.receivedThisMonth).reduce((sum, rule) => sum + netPay(rule, rule.currentAbsences), 0));

  return (
    <Panel
      title={`${formatMonthLabel(cycle).split(' ')[0]} income`}
      subtitle={incomes.length === 0 ? 'No income sources yet. Ask Fin to add your payroll.' : `${formatPeso(received)} of ${formatPeso(expected)} received`}
    >
      {incomes.length > 0 && (
        <ul className="-mt-1 divide-y divide-gray-100">
          {incomes.map((rule) => (
            <IncomeRow key={rule.id} rule={rule} cycle={cycle} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
