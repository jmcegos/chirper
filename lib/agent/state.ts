import 'server-only';
import { getSnapshot } from '@/lib/db';
import { formatMonthLabel, yearMonthKey, type IsoDate } from '@/lib/domain/calendar';
import { billFrequencyLabel, isBillDone, nextUnpaidOccurrence, overdueOccurrences, type BillOccurrence } from '@/lib/domain/bills';
import { currentBill } from '@/lib/domain/creditCard';
import { debtServiceByMonth, liberationMilestones, safeSpendUntilPayday } from '@/lib/domain/insights';
import { allEvents, buildLedger } from '@/lib/domain/ledger';
import { amountDueOn, nextUnpaid, overdueInstallments, paidCount, payoffOf, remainingBalance, type Installment } from '@/lib/domain/loans';
import type { DebtSchedule } from '@/lib/domain/types';
import { netPay } from '@/lib/domain/payroll';
import { outstandingTotal, paidTotal, receivableStatus, remaining } from '@/lib/domain/receivables';

const RECENT_EXPENSES = 15;

function withAmountDue(debt: DebtSchedule, installment: Installment | null, today: IsoDate) {
  return installment && { number: installment.number, date: installment.date, amountDue: amountDueOn(debt, installment, today) };
}

function billOccurrenceView(occurrence: BillOccurrence | null) {
  return occurrence && { dueDate: occurrence.dueDate, amount: occurrence.amount, isEstimate: occurrence.isEstimate };
}

/** Everything the agent needs to reason about the user's money, with ids for its tools. */
export function financialState(today: IsoDate) {
  const snapshot = getSnapshot();
  const { settings, incomes, debts, cards, expenses } = snapshot;
  const ledger = buildLedger(snapshot, today);
  const safeSpend = safeSpendUntilPayday(ledger);

  return {
    today,
    cycleMonth: settings.currentMonthLabel,
    wallet: { name: settings.walletName, balance: settings.walletBalance },
    incomes: incomes.map((rule) => ({
      id: rule.id,
      name: rule.name,
      dayOfMonth: rule.dayOfMonth,
      grossAmount: rule.grossAmount,
      fixedDeductions: rule.fixedDeductions,
      isPayroll: rule.isPayroll,
      absenceRate: rule.absenceRate,
      currentMonthAbsences: rule.currentAbsences,
      nextMonthAbsences: rule.nextMonthAbsences,
      netPayThisMonth: netPay(rule, rule.currentAbsences),
      receivedThisMonth: rule.receivedThisMonth,
    })),
    loans: debts.map((debt) => ({
      id: debt.id,
      name: debt.name,
      lender: debt.lender,
      loanDate: debt.loanDate,
      firstDueDate: debt.firstDueDate,
      frequency: debt.frequency,
      installmentAmount: debt.installmentAmount,
      rebateAmount: debt.rebateAmount,
      penaltyAmount: debt.penaltyAmount,
      installmentsPaid: `${paidCount(debt)}/${debt.totalInstallments}`,
      overdue: overdueInstallments(debt, today).map(({ number, date }) => ({ number, date, amountDue: amountDueOn(debt, { date }, today) })),
      remainingBalance: remainingBalance(debt, today),
      nextInstallment: withAmountDue(debt, nextUnpaid(debt), today),
      finalPaymentDate: payoffOf(debt)?.finalPaymentDate ?? null,
      notes: debt.notes,
    })),
    bills: snapshot.bills.map((bill) => ({
      id: bill.id,
      name: bill.name,
      frequency: bill.frequency,
      schedule: billFrequencyLabel(bill),
      estimatedAmount: bill.estimatedAmount,
      nextDue: billOccurrenceView(nextUnpaidOccurrence(bill)),
      overdue: overdueOccurrences(bill, today).map(({ dueDate, amount }) => ({ dueDate, amount })),
      done: isBillDone(bill),
      notes: bill.notes,
    })),
    receivables: snapshot.receivables.map((receivable) => ({
      id: receivable.id,
      person: receivable.person,
      description: receivable.description,
      amount: receivable.amount,
      paid: paidTotal(receivable),
      remaining: remaining(receivable),
      lentDate: receivable.lentDate,
      promisedDate: receivable.promisedDate,
      expected: receivable.expected,
      status: receivableStatus(receivable, today),
      payments: receivable.payments.map(({ amount, paidOn }) => ({ amount, paidOn })),
      notes: receivable.notes,
    })),
    receivableTotals: {
      outstanding: outstandingTotal(snapshot.receivables),
      expected: outstandingTotal(snapshot.receivables, { expectedOnly: true }),
    },
    creditCards: cards.map((card) => ({
      id: card.id,
      name: card.name,
      statementDay: card.statementDay,
      dueDay: card.dueDay,
      statementBalance: card.statementBalance,
      unbilledAmount: card.unbilledAmount,
      minimumDue: card.minimumDue,
      projectedMonthlySpend: card.projectedMonthlySpend,
      statementPaidThisCycle: card.paidThisMonth,
      upcomingBill: currentBill(card, ledger.startDate),
    })),
    recentExpenses: expenses.slice(0, RECENT_EXPENSES),
    runway: {
      lowestPoint: ledger.lowestPoint,
      bufferNeededToAvoidShortfall: ledger.bufferNeeded,
      dailySafeSpendUntilNextPayday: safeSpend.dailySafeSpend,
      nextPayday: safeSpend.payday?.date ?? null,
      completedThisCycle: ledger.completed.map(({ date, title, amount, note }) => ({ date, title, amount, note })),
      upcoming: allEvents(ledger).map((event) => ({
        date: event.date,
        title: event.title,
        amount: event.amount,
        balanceAfter: event.runningBalance,
        ...(event.overdue ? { overdueSince: event.scheduledDate } : {}),
      })),
    },
    loanServicePerMonth: debtServiceByMonth(ledger).map((row) => ({ month: formatMonthLabel(row.month), total: row.total })),
    payoffMilestones: liberationMilestones(debts).map((milestone) => ({
      finalPaymentDate: milestone.finalPaymentDate,
      loans: milestone.loans.map((loan) => loan.name),
      freedMonthly: milestone.freedMonthly,
      freedFrom: yearMonthKey(milestone.freedFromMonth),
    })),
  };
}
