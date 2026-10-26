import { Gauge } from 'lucide-react';
import { AgentDock } from '@/components/agent/AgentDock';
import { BillPanel } from '@/components/bills/BillPanel';
import { CreditCardPanel, type CardInsight } from '@/components/card/CreditCardPanel';
import { QuickExpensePanel } from '@/components/expenses/QuickExpensePanel';
import { IncomePanel } from '@/components/income/IncomePanel';
import { CycleControlsCard } from '@/components/kpi/CycleControlsCard';
import { DebtServiceCard } from '@/components/kpi/DebtServiceCard';
import { FlowCard } from '@/components/kpi/FlowCard';
import { WalletCard } from '@/components/kpi/WalletCard';
import { RunwayLedger } from '@/components/ledger/RunwayLedger';
import { LoanPanel } from '@/components/loans/LoanPanel';
import { agentConfigured } from '@/lib/agent/agent';
import { todaysTranscript } from '@/lib/agent/transcript';
import { getSnapshot } from '@/lib/db';
import { addMonths, formatLongDate, formatMonthLabel, formatMonthShort, formatShortDate, todayLocal, yearMonthKey } from '@/lib/domain/calendar';
import { upcomingBills } from '@/lib/domain/creditCard';
import { debtServiceByMonth, liberationMilestones, lowestBalanceFrom, nextInflow, nextOutflow, safeSpendUntilPayday } from '@/lib/domain/insights';
import { activeLoanCount, buildLedger, clearedLoanCount, type Ledger } from '@/lib/domain/ledger';
import { roundPesos } from '@/lib/domain/money';
import type { CreditCard } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

function cardInsight(card: CreditCard, ledger: Ledger): CardInsight {
  const [bill = null, nextBill = null] = upcomingBills(card, ledger.startDate, ledger.endDate);
  const lowest = nextBill ? lowestBalanceFrom(ledger, nextBill.dueDate) : null;
  return {
    card,
    bill,
    nextBill,
    nextBillCeiling: nextBill && lowest !== null ? Math.max(0, roundPesos(nextBill.amount + lowest)) : null,
  };
}

export default function DashboardPage() {
  const snapshot = getSnapshot();
  const { settings, incomes, debts, cards, bills, expenses } = snapshot;
  const ledger = buildLedger(snapshot, todayLocal());
  const cycle = settings.cycleMonth;
  const safeSpend = safeSpendUntilPayday(ledger);
  const completedTitle = `Already Paid in ${formatMonthLabel(cycle).split(' ')[0]} (${clearedLoanCount(debts, cycle)}/${activeLoanCount(debts, cycle)} Loans Cleared ✓)`;

  return (
    <>
      <main className="mx-auto max-w-[1600px] space-y-6 p-4 pb-24 lg:p-6 xl:pb-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-100">
              <Gauge className="h-5 w-5 text-sky-400" /> Cash Flow &amp; Debt Runway
            </h1>
            <p className="text-xs text-slate-500">Forward-looking running balance • every event, every centavo.</p>
          </div>
          <div className="text-right text-xs text-slate-400">
            <p>
              Cycle: <span className="font-semibold text-slate-200">{settings.currentMonthLabel}</span>
            </p>
            <p>Today: {formatLongDate(ledger.startDate)}</p>
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <WalletCard walletName={settings.walletName} balance={settings.walletBalance} safeSpend={safeSpend} />
          <FlowCard inflow={nextInflow(ledger)} outflow={nextOutflow(ledger)} start={ledger.startDate} />
          <DebtServiceCard service={debtServiceByMonth(ledger)} milestones={liberationMilestones(debts)} />
          <CycleControlsCard cycleLabel={settings.currentMonthLabel} nextCycleLabel={formatMonthLabel(addMonths(cycle, 1))} />
        </section>

        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-7">
            <IncomePanel incomes={incomes} cycle={cycle} />
            <LoanPanel debts={debts} cycle={cycle} today={todayLocal()} />
            <BillPanel bills={bills} cycle={cycle} today={todayLocal()} />
            <CreditCardPanel insights={cards.map((card) => cardInsight(card, ledger))} />
            <QuickExpensePanel
              expenses={expenses}
              walletBalance={settings.walletBalance}
              cycleKey={yearMonthKey(cycle)}
              paydayLabel={safeSpend.payday ? formatShortDate(safeSpend.payday.date) : `${formatMonthShort(cycle)} payday`}
            />
          </div>
          <aside className="lg:col-span-5">
            <div className="lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
              <RunwayLedger ledger={ledger} walletName={settings.walletName} completedTitle={completedTitle} />
            </div>
          </aside>
        </div>
      </main>
      <AgentDock turns={todaysTranscript()} configured={agentConfigured()} />
    </>
  );
}
