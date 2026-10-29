import { AgentDock } from '@/components/agent/AgentDock';
import { BillPanel } from '@/components/bills/BillPanel';
import { CreditCardPanel, type CardInsight } from '@/components/card/CreditCardPanel';
import { QuickExpensePanel } from '@/components/expenses/QuickExpensePanel';
import { IncomePanel } from '@/components/income/IncomePanel';
import { ManageTabs } from '@/components/layout/ManageTabs';
import { ReceivablePanel } from '@/components/receivables/ReceivablePanel';
import { TopBar } from '@/components/layout/TopBar';
import { RunwayLedger } from '@/components/ledger/RunwayLedger';
import { LoanPanel } from '@/components/loans/LoanPanel';
import { AttentionBanner, type AttentionItem } from '@/components/overview/AttentionBanner';
import { SafeSpendCard } from '@/components/overview/SafeSpendCard';
import { StatCards } from '@/components/overview/StatCards';
import { WalletCard } from '@/components/overview/WalletCard';
import type { ManageTab } from '@/components/ui/uiEvents';
import { agentConfigured } from '@/lib/agent/agent';
import { todaysTranscript } from '@/lib/agent/transcript';
import { getSnapshot } from '@/lib/db';
import { addMonths, formatMonthLabel, formatMonthShort, formatShortDate, todayLocal, yearMonthKey } from '@/lib/domain/calendar';
import { upcomingBills } from '@/lib/domain/creditCard';
import { debtServiceByMonth, liberationMilestones, lowestBalanceFrom, nextInflow, nextOutflow, safeSpendUntilPayday } from '@/lib/domain/insights';
import { activeLoanCount, allEvents, buildLedger, clearedLoanCount, type Ledger, type LedgerEventKind } from '@/lib/domain/ledger';
import { roundPesos } from '@/lib/domain/money';
import type { CreditCard } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' });

const KIND_TAB: Record<LedgerEventKind, ManageTab> = {
  income: 'income',
  receivable: 'owed',
  debt: 'loans',
  bill: 'bills',
  'card-due': 'card',
  'card-statement': 'card',
};

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

/** Overdue ledger rows, phrased as things to do. Income ids look like `income-<ruleId>-<monthOffset>`. */
function attentionItems(ledger: Ledger): AttentionItem[] {
  return allEvents(ledger)
    .filter((event) => event.overdue && event.amount !== 0)
    .map((event) => {
      const income = event.kind === 'income' ? /^income-(\d+)-0$/.exec(event.id) : null;
      return {
        id: event.id,
        title: event.title,
        amount: event.amount,
        scheduledDate: event.scheduledDate,
        incomeId: income ? Number(income[1]) : null,
        tab: KIND_TAB[event.kind],
      };
    });
}

export default function DashboardPage() {
  const snapshot = getSnapshot();
  const { settings, incomes, debts, cards, bills, expenses } = snapshot;
  const today = todayLocal();
  const ledger = buildLedger(snapshot, today);
  const cycle = settings.cycleMonth;
  const safeSpend = safeSpendUntilPayday(ledger);
  const completedTitle = `Done in ${formatMonthShort(cycle)} · ${clearedLoanCount(debts, cycle)} of ${activeLoanCount(debts, cycle)} loans paid`;
  const paydayLabel = safeSpend.payday ? formatShortDate(safeSpend.payday.date) : `${formatMonthShort(cycle)} payday`;

  return (
    <>
      <TopBar
        todayLabel={`${WEEKDAY.format(new Date(`${today}T00:00:00Z`))}, ${formatShortDate(today)}, ${today.slice(0, 4)}`}
        cycleLabel={settings.currentMonthLabel}
        nextCycleLabel={formatMonthLabel(addMonths(cycle, 1))}
      />
      <main className="mx-auto flex max-w-[1320px] flex-col gap-6 px-4 pb-24 pt-6 sm:px-6 sm:pt-7 xl:pb-16">
        <AttentionBanner items={attentionItems(ledger)} />

        {/* Rows wrap on available width, not viewport width, so they also reflow when the agent sidebar opens. */}
        <div className="flex flex-wrap gap-4">
          <div className="min-w-0 flex-[3_1_420px]">
            <SafeSpendCard safeSpend={safeSpend} walletBalance={settings.walletBalance} />
          </div>
          <div className="min-w-0 flex-[2_1_300px]">
            <WalletCard walletName={settings.walletName} balance={settings.walletBalance} />
          </div>
        </div>

        <StatCards
          ledger={ledger}
          inflow={nextInflow(ledger)}
          outflow={nextOutflow(ledger)}
          service={debtServiceByMonth(ledger)}
          milestones={liberationMilestones(debts)}
        />

        <div className="flex flex-wrap items-start gap-6">
          <div className="min-w-0 flex-[7_1_540px]">
            <RunwayLedger ledger={ledger} completedTitle={completedTitle} />
          </div>
          <div className="min-w-0 flex-[5_1_400px]">
            <ManageTabs
            panels={{
              loans: <LoanPanel debts={debts} cycle={cycle} today={today} />,
              income: <IncomePanel incomes={incomes} cycle={cycle} />,
              bills: <BillPanel bills={bills} cycle={cycle} today={today} />,
              owed: <ReceivablePanel receivables={snapshot.receivables} today={today} />,
              card: <CreditCardPanel insights={cards.map((card) => cardInsight(card, ledger))} />,
              spending: (
                <QuickExpensePanel expenses={expenses} dailySafeSpend={safeSpend.dailySafeSpend} cycleKey={yearMonthKey(cycle)} paydayLabel={paydayLabel} />
              ),
            }}
            />
          </div>
        </div>
      </main>
      <AgentDock turns={todaysTranscript()} configured={agentConfigured()} />
    </>
  );
}
