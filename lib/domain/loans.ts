import { addDays, addMonths, addMonthsKeepingDay, dateOf, dayOf, ordinal, yearMonthOf, type IsoDate, type YearMonth } from './calendar';
import { roundPesos } from './money';
import type { DebtSchedule, LoanFrequency } from './types';

export const LOAN_FREQUENCIES: readonly LoanFrequency[] = ['monthly', 'every_15_days'];

const FIFTEEN_DAYS = 15;

/** The parts of a loan that decide its due dates. */
export type LoanTerms = Pick<DebtSchedule, 'firstDueDate' | 'frequency' | 'totalInstallments'>;

/**
 * Due date of installment `n` (1-based). Monthly loans keep the first due
 * date's day, clamped in short months (Jan 31 → Feb 28 → Mar 31).
 */
export function dueDateOf(terms: Pick<LoanTerms, 'firstDueDate' | 'frequency'>, n: number): IsoDate {
  if (terms.frequency === 'every_15_days') return addDays(terms.firstDueDate, FIFTEEN_DAYS * (n - 1));
  return addMonthsKeepingDay(terms.firstDueDate, n - 1);
}

export function frequencyLabel(terms: Pick<LoanTerms, 'firstDueDate' | 'frequency'>): string {
  return terms.frequency === 'every_15_days' ? 'Every 15 days' : `Monthly · ${ordinal(dayOf(terms.firstDueDate))}`;
}

export interface Installment {
  number: number;
  date: IsoDate;
  paid: boolean;
}

export function installments(debt: DebtSchedule): Installment[] {
  const paid = new Set(debt.paidInstallmentNumbers);
  return Array.from({ length: debt.totalInstallments }, (_, index) => ({
    number: index + 1,
    date: dueDateOf(debt, index + 1),
    paid: paid.has(index + 1),
  }));
}

export function unpaidInstallments(debt: DebtSchedule): Installment[] {
  return installments(debt).filter((installment) => !installment.paid);
}

/** Unpaid installments whose due date is before `today`. */
export function overdueInstallments(debt: DebtSchedule, today: IsoDate): Installment[] {
  return unpaidInstallments(debt).filter((installment) => installment.date < today);
}

/** The installment a payment goes to: the oldest unpaid one. */
export function nextUnpaid(debt: DebtSchedule): Installment | null {
  return unpaidInstallments(debt)[0] ?? null;
}

export function paidCount(debt: DebtSchedule): number {
  return installments(debt).filter((installment) => installment.paid).length;
}

export function remainingInstallments(debt: DebtSchedule): number {
  return unpaidInstallments(debt).length;
}

/**
 * Cash needed to pay an installment on `payDate`: the on-time rebate comes off
 * when paid on or before the due date; after it, the rebate is lost and the
 * late penalty is added once. No grace period.
 */
export function amountDueOn(debt: DebtSchedule, installment: Pick<Installment, 'date'>, payDate: IsoDate): number {
  return payDate <= installment.date
    ? roundPesos(debt.installmentAmount - debt.rebateAmount)
    : roundPesos(debt.installmentAmount + debt.penaltyAmount);
}

/** What paying on time costs: the installment less the rebate. */
export function onTimeAmount(debt: DebtSchedule): number {
  return roundPesos(debt.installmentAmount - debt.rebateAmount);
}

/** Unpaid installments at what each costs if paid today (overdue ones carry the penalty). */
export function remainingBalance(debt: DebtSchedule, today: IsoDate): number {
  return roundPesos(unpaidInstallments(debt).reduce((sum, installment) => sum + amountDueOn(debt, installment, today), 0));
}

export function isFullyPaid(debt: DebtSchedule): boolean {
  return remainingInstallments(debt) === 0;
}

/** True when every installment due on or before `date` is paid. */
export function isSettledThrough(debt: DebtSchedule, date: IsoDate): boolean {
  return installments(debt).every((installment) => installment.paid || installment.date > date);
}

/** Installment numbers due on or before `today`: the ones a new loan treats as already paid. */
export function pastDueNumbers(terms: LoanTerms, today: IsoDate): number[] {
  const numbers: number[] = [];
  for (let n = 1; n <= terms.totalInstallments && dueDateOf(terms, n) <= today; n++) numbers.push(n);
  return numbers;
}

/**
 * First due date for a loan saved before loans had dates. The old model kept
 * a due day, a paid count and a "paid this month" flag relative to the cycle
 * month: installment #paid fell in the cycle month when it was flagged paid,
 * otherwise #paid+1 did.
 */
export function legacyFirstDueDate(dueDay: number, paidInstallments: number, paidThisMonth: boolean, cycle: YearMonth): IsoDate {
  const monthsBack = paidThisMonth ? paidInstallments - 1 : paidInstallments;
  return dateOf(addMonths(cycle, -monthsBack), dueDay);
}

export interface LoanPayoff {
  debt: DebtSchedule;
  installmentsLeft: number;
  finalPaymentDate: IsoDate;
  freedFromMonth: YearMonth;
}

export function payoffOf(debt: DebtSchedule): LoanPayoff | null {
  const unpaid = unpaidInstallments(debt);
  const last = unpaid.at(-1);
  if (!last) return null;
  return {
    debt,
    installmentsLeft: unpaid.length,
    finalPaymentDate: last.date,
    freedFromMonth: addMonths(yearMonthOf(last.date), 1),
  };
}

export function payoffsByDate(debts: DebtSchedule[]): LoanPayoff[] {
  return debts
    .map((debt) => payoffOf(debt))
    .filter((payoff): payoff is LoanPayoff => payoff !== null)
    .sort((a, b) => a.finalPaymentDate.localeCompare(b.finalPaymentDate));
}
