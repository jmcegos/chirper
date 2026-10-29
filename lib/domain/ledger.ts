import {
  addMonths,
  dateOf,
  firstDayOf,
  formatMonthLabel,
  formatShortDate,
  isSameYearMonth,
  ordinal,
  lastDayOf,
  maxDate,
  yearMonthKey,
  yearMonthOf,
  type IsoDate,
  type YearMonth,
} from './calendar';
import { occurrencesThrough } from './bills';
import { upcomingBills } from './creditCard';
import { amountDueOn, installments, isSettledThrough, remainingInstallments, type Installment } from './loans';
import { formatPeso, toCentavos, toPesos } from './money';
import { absenceDeduction, netPay } from './payroll';
import { isPaidOff, paidTotal, remaining } from './receivables';
import type { Bill, CreditCard, DebtSchedule, FinanceSnapshot, IncomeRule, Receivable } from './types';

/** Current cycle month + the next two (the second one is the expandable view). */
export const MONTHS_AHEAD = 2;

export type LedgerEventKind = 'income' | 'receivable' | 'debt' | 'bill' | 'card-due' | 'card-statement';

export interface LedgerEvent {
  id: string;
  date: IsoDate;
  /** Original schedule date when the item is past due and rolled onto `date`. */
  scheduledDate: IsoDate;
  kind: LedgerEventKind;
  title: string;
  detail: string;
  /** Signed cash movement in pesos: + inflow, - outflow, 0 informational. */
  amount: number;
  runningBalance: number;
  overdue: boolean;
  isPayroll: boolean;
}

export interface LedgerMonth {
  key: string;
  label: string;
  events: LedgerEvent[];
}

export interface CompletedItem {
  id: string;
  date: IsoDate;
  title: string;
  amount: number;
  note: string;
}

export interface Ledger {
  startDate: IsoDate;
  endDate: IsoDate;
  cycleMonth: YearMonth;
  startingBalance: number;
  months: LedgerMonth[];
  completed: CompletedItem[];
  lowestPoint: { date: IsoDate; balance: number };
  bufferNeeded: number;
}

type DraftEvent = Omit<LedgerEvent, 'runningBalance' | 'date' | 'overdue'>;

/** Same-day ordering: money lands, then info, then money leaves. */
const KIND_ORDER: Record<LedgerEventKind, number> = { income: 0, receivable: 0, 'card-statement': 1, debt: 2, bill: 2, 'card-due': 2 };

function incomeAbsencesFor(rule: IncomeRule, monthOffset: number): number {
  if (monthOffset === 0) return rule.currentAbsences;
  if (monthOffset === 1) return rule.nextMonthAbsences;
  return 0;
}

function incomeDetail(rule: IncomeRule, absences: number): string {
  if (!rule.isPayroll) return 'Fixed side income';
  const deduction = absenceDeduction(rule, absences);
  return deduction > 0 ? `Net after ${absences} absence day(s)` : 'Net pay • 0 absences';
}

function incomeDrafts(rule: IncomeRule, cycle: YearMonth, completed: CompletedItem[]): DraftEvent[] {
  const drafts: DraftEvent[] = [];
  for (let offset = 0; offset <= MONTHS_AHEAD; offset++) {
    const scheduledDate = dateOf(addMonths(cycle, offset), rule.dayOfMonth);
    const absences = incomeAbsencesFor(rule, offset);
    const amount = netPay(rule, absences);
    const id = `income-${rule.id}-${offset}`;
    if (offset === 0 && rule.receivedThisMonth) {
      completed.push({ id, date: scheduledDate, title: rule.name, amount, note: 'Received ✓' });
      continue;
    }
    drafts.push({ id, scheduledDate, kind: 'income', title: rule.name, detail: incomeDetail(rule, absences), amount, isPayroll: rule.isPayroll });
  }
  return drafts;
}

/**
 * Paid installments due in the cycle month are reported as completed. Every
 * unpaid one up to `end` becomes an event; one due before the ledger start
 * (any earlier month) is rolled onto the start date as overdue by `buildLedger`.
 */
function debtDetail(debt: DebtSchedule, installment: Installment, start: IsoDate): string {
  const parts = [debt.lender, installment.number === debt.totalInstallments ? 'FINAL installment' : ''];
  if (installment.date < start && debt.penaltyAmount > 0) parts.push(`includes ${formatPeso(debt.penaltyAmount)} late penalty, rebate lost`);
  else if (installment.date >= start && debt.rebateAmount > 0) parts.push(`includes ${formatPeso(debt.rebateAmount)} on-time rebate`);
  return parts.filter(Boolean).join(' • ');
}

function debtDrafts(debt: DebtSchedule, cycle: YearMonth, start: IsoDate, end: IsoDate, completed: CompletedItem[]): DraftEvent[] {
  const drafts: DraftEvent[] = [];
  for (const installment of installments(debt)) {
    if (installment.paid) {
      if (isSameYearMonth(yearMonthOf(installment.date), cycle)) {
        completed.push({
          id: `debt-${debt.id}-${installment.number}`,
          date: installment.date,
          title: debt.name,
          amount: -debt.installmentAmount,
          note: `${installment.number}/${debt.totalInstallments} Paid ✓`,
        });
      }
      continue;
    }
    if (installment.date > end) break;
    drafts.push({
      id: `debt-${debt.id}-${installment.number}`,
      scheduledDate: installment.date,
      kind: 'debt',
      title: `${debt.name} (${installment.number}/${debt.totalInstallments})`,
      detail: debtDetail(debt, installment, start),
      // Overdue (before the start date): rebate lost + penalty. Otherwise assume it is paid on time.
      amount: -amountDueOn(debt, installment, start),
      isPayroll: false,
    });
  }
  return drafts;
}

/**
 * Every unpaid due date up to `end` is an outflow at its billed amount (or the
 * estimate); one due before the ledger start is rolled onto it as overdue.
 * Due dates paid in the cycle month are reported as completed.
 */
function billDrafts(bill: Bill, cycle: YearMonth, end: IsoDate, completed: CompletedItem[]): DraftEvent[] {
  const drafts: DraftEvent[] = [];
  for (const occurrence of occurrencesThrough(bill, end)) {
    const id = `bill-${bill.id}-${occurrence.dueDate}`;
    if (occurrence.paid) {
      if (isSameYearMonth(yearMonthOf(occurrence.dueDate), cycle)) {
        completed.push({ id, date: occurrence.dueDate, title: bill.name, amount: -(occurrence.paidAmount ?? 0), note: 'Paid ✓' });
      }
      continue;
    }
    const amountNote = occurrence.isEstimate ? `Est. ${formatPeso(occurrence.amount)}` : 'Billed';
    drafts.push({
      id,
      scheduledDate: occurrence.dueDate,
      kind: 'bill',
      title: bill.name,
      detail: [amountNote, bill.notes].filter(Boolean).join(' • '),
      amount: -occurrence.amount,
      isPayroll: false,
    });
  }
  return drafts;
}

/**
 * An expected receivable with a promised date is money in for what is still
 * owed; one promised before the ledger start is rolled onto it as overdue.
 * Payments received in the cycle month are reported as completed.
 */
function receivableDrafts(receivable: Receivable, cycle: YearMonth, end: IsoDate, completed: CompletedItem[]): DraftEvent[] {
  let received = 0;
  for (const payment of receivable.payments) {
    received += toCentavos(payment.amount);
    if (!isSameYearMonth(yearMonthOf(payment.paidOn), cycle)) continue;
    completed.push({
      id: `receivable-${receivable.id}-pay-${payment.id}`,
      date: payment.paidOn,
      title: receivable.person,
      amount: payment.amount,
      note: received >= toCentavos(receivable.amount) ? 'Received ✓' : 'Partial ✓',
    });
  }
  if (!receivable.expected || receivable.promisedDate === null || isPaidOff(receivable) || receivable.promisedDate > end) return [];
  const paid = paidTotal(receivable);
  const progress = paid > 0 ? `${formatPeso(paid)} of ${formatPeso(receivable.amount)} received` : '';
  return [
    {
      id: `receivable-${receivable.id}`,
      scheduledDate: receivable.promisedDate,
      kind: 'receivable',
      title: `${receivable.person} pays back`,
      detail: [receivable.description, progress].filter(Boolean).join(' • '),
      amount: remaining(receivable),
      isPayroll: false,
    },
  ];
}

function cardDrafts(card: CreditCard, start: IsoDate, end: IsoDate, completed: CompletedItem[]): DraftEvent[] {
  if (card.paidThisMonth && card.lastSettledDue) {
    completed.push({
      id: `card-${card.id}-done`,
      date: card.lastSettledDue,
      title: `${card.name} Statement`,
      amount: -card.lastPaidAmount,
      note: 'Settled ✓',
    });
  }
  const drafts: DraftEvent[] = [];
  for (const bill of upcomingBills(card, start, end)) {
    const projected = bill.isCurrentStatement ? '' : ' (projected)';
    if (bill.statementDate >= start) {
      drafts.push({
        id: `card-${card.id}-stmt-${bill.statementDate}`,
        scheduledDate: bill.statementDate,
        kind: 'card-statement',
        title: `${card.name} Statement Cuts — Due on the ${ordinal(card.dueDay)}`,
        detail: `${formatPeso(bill.amount)} billed${projected} — Payable ${formatShortDate(bill.dueDate)} • ₱0.00 cash outflow`,
        amount: 0,
        isPayroll: false,
      });
    }
    if (bill.dueDate <= end) {
      drafts.push({
        id: `card-${card.id}-due-${bill.dueDate}`,
        scheduledDate: bill.dueDate,
        kind: 'card-due',
        title: `${card.name} Payment (Deadline)`,
        detail: `Statement of ${formatShortDate(bill.statementDate)}${projected}`,
        amount: -bill.amount,
        isPayroll: false,
      });
    }
  }
  return drafts;
}

function compareEvents(a: LedgerEvent, b: LedgerEvent): number {
  return a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.scheduledDate.localeCompare(b.scheduledDate);
}

function groupByMonth(events: LedgerEvent[], cycle: YearMonth): LedgerMonth[] {
  return Array.from({ length: MONTHS_AHEAD + 1 }, (_, offset) => {
    const ym = addMonths(cycle, offset);
    const key = yearMonthKey(ym);
    return {
      key,
      label: formatMonthLabel(ym),
      events: events.filter((event) => yearMonthKey(yearMonthOf(event.date)) === key),
    };
  });
}

/**
 * Builds the forward-looking running balance. Items already received/paid in
 * the cycle month are reported as completed and never touch `starting_cash`.
 * Unpaid items whose date already passed are rolled onto today as overdue.
 */
export function buildLedger(snapshot: FinanceSnapshot, today: IsoDate): Ledger {
  const cycle = snapshot.settings.cycleMonth;
  const startDate = maxDate(today, firstDayOf(cycle));
  const endDate = lastDayOf(addMonths(cycle, MONTHS_AHEAD));
  const completed: CompletedItem[] = [];

  const drafts: DraftEvent[] = [
    ...snapshot.incomes.flatMap((rule) => incomeDrafts(rule, cycle, completed)),
    ...snapshot.receivables.flatMap((receivable) => receivableDrafts(receivable, cycle, endDate, completed)),
    ...snapshot.debts.flatMap((debt) => debtDrafts(debt, cycle, startDate, endDate, completed)),
    ...snapshot.cards.flatMap((card) => cardDrafts(card, startDate, endDate, completed)),
    ...snapshot.bills.flatMap((bill) => billDrafts(bill, cycle, endDate, completed)),
  ];

  const ordered = drafts
    .map((draft) => ({ ...draft, date: maxDate(draft.scheduledDate, startDate), overdue: draft.scheduledDate < startDate, runningBalance: 0 }))
    .sort(compareEvents);

  let balance = toCentavos(snapshot.settings.walletBalance);
  let lowest = { date: startDate, balance };
  const events = ordered.map((event) => {
    balance += toCentavos(event.amount);
    if (balance < lowest.balance) lowest = { date: event.date, balance };
    return { ...event, runningBalance: toPesos(balance) };
  });

  completed.sort((a, b) => a.date.localeCompare(b.date));

  return {
    startDate,
    endDate,
    cycleMonth: cycle,
    startingBalance: snapshot.settings.walletBalance,
    months: groupByMonth(events, cycle),
    completed,
    lowestPoint: { date: lowest.date, balance: toPesos(lowest.balance) },
    bufferNeeded: lowest.balance < 0 ? toPesos(-lowest.balance) : 0,
  };
}

export function allEvents(ledger: Ledger): LedgerEvent[] {
  return ledger.months.flatMap((month) => month.events);
}

/** Still being paid, or had an installment paid in the cycle month. */
function isActiveLoan(debt: DebtSchedule, cycle: YearMonth): boolean {
  return remainingInstallments(debt) > 0 || installments(debt).some((item) => item.paid && isSameYearMonth(yearMonthOf(item.date), cycle));
}

export function activeLoanCount(debts: DebtSchedule[], cycle: YearMonth): number {
  return debts.filter((debt) => isActiveLoan(debt, cycle)).length;
}

/** Active loans with every installment due through the end of the cycle month paid. */
export function clearedLoanCount(debts: DebtSchedule[], cycle: YearMonth): number {
  return debts.filter((debt) => isActiveLoan(debt, cycle) && isSettledThrough(debt, lastDayOf(cycle))).length;
}
