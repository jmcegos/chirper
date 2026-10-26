import 'server-only';
import { firstDayOf, formatLongDate, isIsoDate, lastDayOf, maxDate, todayLocal, type IsoDate } from './domain/calendar';
import { currentBill } from './domain/creditCard';
import { LOAN_FREQUENCIES, amountDueOn, frequencyLabel, isSettledThrough, nextUnpaid, onTimeAmount, pastDueNumbers } from './domain/loans';
import type { DebtSchedule } from './domain/types';
import { formatPeso, roundPesos } from './domain/money';
import { netPay, normalizeAbsences } from './domain/payroll';
import * as db from './db';

/**
 * Application use cases. Both the dashboard's Server Actions and the agent's
 * tools go through here, so every mutation follows the same rules. Each
 * command validates its input and returns a one-line summary of what changed.
 */

export class CommandError extends Error {}

/* ─────────────────────────────── guards ─────────────────────────────── */

function pesos(value: number, label: string, { allowZero = true } = {}): number {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new CommandError(`${label} must be a ${allowZero ? 'non-negative' : 'positive'} peso amount.`);
  }
  return roundPesos(value);
}

function wholeNumber(value: number, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new CommandError(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

function nonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new CommandError(`${label} is required.`);
  return trimmed;
}

function found<T>(value: T | null, label: string): T {
  if (value === null) throw new CommandError(`${label} not found.`);
  return value;
}

/** Drops undefined fields so a partial update never blanks out existing values. */
function defined<T extends object>(changes: T): Partial<T> {
  return Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function ledgerStart(): IsoDate {
  return maxDate(todayLocal(), firstDayOf(db.getSnapshot().settings.cycleMonth));
}

const walletNote = (delta: number) => (delta === 0 ? 'wallet unchanged' : `wallet ${delta > 0 ? '+' : '-'}${formatPeso(Math.abs(delta))}`);

/* ─────────────────────────────── wallet ────────────────────────────── */

export function setWalletBalance(balance: number): string {
  if (!Number.isFinite(balance)) throw new CommandError('Balance must be a number.');
  db.setWalletBalance(roundPesos(balance));
  return `Wallet balance set to ${formatPeso(balance)}`;
}

/* ─────────────────────────────── income ────────────────────────────── */

export function setAbsences(incomeId: number, period: 'current' | 'next', days: number): string {
  const rule = found(db.getIncomeRule(incomeId), 'Income');
  if (!rule.isPayroll) throw new CommandError(`${rule.name} is not a payroll income; absences do not apply.`);
  const absences = normalizeAbsences(days);
  db.setAbsences(incomeId, period, absences);
  return `${rule.name}: ${absences} absence day(s) for the ${period === 'current' ? 'current' : 'next'} month`;
}

export function stepAbsences(incomeId: number, period: 'current' | 'next', delta: number): string {
  const rule = found(db.getIncomeRule(incomeId), 'Income');
  const current = period === 'current' ? rule.currentAbsences : rule.nextMonthAbsences;
  return setAbsences(incomeId, period, current + delta);
}

export function setIncomeReceived(incomeId: number, received: boolean, syncWallet: boolean): string {
  const rule = found(db.getIncomeRule(incomeId), 'Income');
  if (rule.receivedThisMonth === received) return `${rule.name} already ${received ? 'received' : 'pending'}`;
  const amount = netPay(rule, rule.currentAbsences);
  const delta = syncWallet ? (received ? amount : -amount) : 0;
  db.setIncomeReceived(incomeId, received, delta);
  return `${rule.name} marked ${received ? 'received' : 'pending'} (${walletNote(delta)})`;
}

export function toggleIncomeReceived(incomeId: number, syncWallet: boolean): string {
  const rule = found(db.getIncomeRule(incomeId), 'Income');
  return setIncomeReceived(incomeId, !rule.receivedThisMonth, syncWallet);
}

export interface IncomeFields {
  name: string;
  dayOfMonth: number;
  grossAmount: number;
  fixedDeductions: number;
  isPayroll: boolean;
  absenceRate: number;
}

function validIncome(input: IncomeFields): db.IncomeInput {
  return {
    name: nonEmpty(input.name, 'Income name'),
    dayOfMonth: wholeNumber(input.dayOfMonth, 'Day of month', 1, 31),
    grossAmount: pesos(input.grossAmount, 'Gross amount', { allowZero: false }),
    fixedDeductions: pesos(input.fixedDeductions, 'Fixed deductions'),
    isPayroll: input.isPayroll,
    absenceRate: pesos(input.absenceRate, 'Absence rate'),
  };
}

export function addIncome(input: IncomeFields): string {
  const id = db.insertIncome(validIncome(input));
  return `Added income #${id} ${input.name} (${formatPeso(input.grossAmount)} on day ${input.dayOfMonth})`;
}

export function updateIncome(incomeId: number, changes: Partial<IncomeFields>): string {
  const rule = found(db.getIncomeRule(incomeId), 'Income');
  db.updateIncome(incomeId, validIncome({ ...rule, ...defined(changes) }));
  return `Updated income ${rule.name}`;
}

/* ─────────────────────────────── loans ─────────────────────────────── */

function rebateOrPenaltyNote(debt: DebtSchedule, onTime: boolean): string {
  if (onTime && debt.rebateAmount > 0) return ` incl. ${formatPeso(debt.rebateAmount)} rebate`;
  if (!onTime && debt.penaltyAmount > 0) return ` incl. ${formatPeso(debt.penaltyAmount)} late penalty`;
  return '';
}

/**
 * Pays the oldest unpaid installment (overdue ones first) at what it costs
 * today: less the rebate when on time, plus the penalty when late.
 */
export function payNextInstallment(debtId: number, syncWallet: boolean): string {
  const debt = found(db.getDebtSchedule(debtId), 'Loan');
  const next = nextUnpaid(debt);
  if (!next) return `${debt.name} is already fully paid`;
  const today = todayLocal();
  const amount = amountDueOn(debt, next, today);
  const delta = syncWallet ? -amount : 0;
  db.addLoanPayment(debtId, next.number, amount, delta);
  const note = rebateOrPenaltyNote(debt, today <= next.date);
  return `${debt.name} installment ${next.number}/${debt.totalInstallments} (due ${formatLongDate(next.date)}) paid ${formatPeso(amount)}${note} (${walletNote(delta)})`;
}

/** Un-marks the most recently paid installment, refunding what was recorded for it. */
export function undoLastLoanPayment(debtId: number, syncWallet: boolean): string {
  const debt = found(db.getDebtSchedule(debtId), 'Loan');
  const last = debt.lastPayment;
  if (last === null) return `${debt.name} has no payments to undo`;
  const delta = syncWallet ? (last.amountPaid ?? onTimeAmount(debt)) : 0;
  db.removeLoanPayment(debtId, last.number, delta);
  return `${debt.name} installment ${last.number}/${debt.totalInstallments} marked unpaid (${walletNote(delta)})`;
}

export function setLoanPaid(debtId: number, paid: boolean, syncWallet: boolean): string {
  return paid ? payNextInstallment(debtId, syncWallet) : undoLastLoanPayment(debtId, syncWallet);
}

/** The card's toggle: pay the next installment until the cycle month is settled, then undo. */
export function toggleLoanPaid(debtId: number, syncWallet: boolean): string {
  const debt = found(db.getDebtSchedule(debtId), 'Loan');
  const settled = isSettledThrough(debt, lastDayOf(db.getSnapshot().settings.cycleMonth));
  return setLoanPaid(debtId, !settled, syncWallet);
}

function isoDate(value: string, label: string): IsoDate {
  const trimmed = value.trim();
  if (!isIsoDate(trimmed)) throw new CommandError(`${label} must be a date (YYYY-MM-DD).`);
  return trimmed;
}

function validLoan(input: db.DebtInput): db.DebtInput {
  const loanDate = isoDate(input.loanDate, 'Loan date');
  const firstDueDate = isoDate(input.firstDueDate, 'First due date');
  if (firstDueDate < loanDate) throw new CommandError('First due date cannot be before the loan date.');
  if (!LOAN_FREQUENCIES.includes(input.frequency)) throw new CommandError('Frequency must be "monthly" or "every_15_days".');
  const installmentAmount = pesos(input.installmentAmount, 'Installment amount', { allowZero: false });
  const rebateAmount = pesos(input.rebateAmount, 'On-time rebate');
  if (rebateAmount >= installmentAmount) throw new CommandError('On-time rebate must be less than the installment amount.');
  return {
    name: nonEmpty(input.name, 'Loan name'),
    lender: input.lender.trim(),
    loanDate,
    firstDueDate,
    frequency: input.frequency,
    installmentAmount,
    totalInstallments: wholeNumber(input.totalInstallments, 'Total installments', 1, 600),
    rebateAmount,
    penaltyAmount: pesos(input.penaltyAmount, 'Late penalty'),
    notes: input.notes.trim(),
  };
}

/** Installment numbers the user says are still unpaid even though their due date has passed. */
function unpaidList(numbers: number[] | undefined, totalInstallments: number): Set<number> {
  return new Set((numbers ?? []).map((n) => wholeNumber(n, 'Unpaid installment', 1, totalInstallments)));
}

export interface LoanChanges extends Partial<db.DebtInput> {
  unpaidPastInstallments?: number[];
}

/**
 * Adds a loan. Installments due on or before today count as paid unless
 * listed in `unpaidPastInstallments`. The wallet never moves: past payments
 * are assumed to be in the balance already.
 */
export function addLoan(input: db.DebtInput & { unpaidPastInstallments?: number[] }): string {
  const loan = validLoan(input);
  const unpaid = unpaidList(input.unpaidPastInstallments, loan.totalInstallments);
  const past = pastDueNumbers(loan, todayLocal());
  const paid = past.filter((n) => !unpaid.has(n));
  const id = db.insertDebt(loan, paid);
  const overdue = past.length > paid.length ? `, ${past.length - paid.length} overdue` : '';
  return `Added loan #${id} ${loan.name} (${formatPeso(loan.installmentAmount)} ${frequencyLabel(loan).toLowerCase()}, ${paid.length}/${loan.totalInstallments} paid${overdue})`;
}

/**
 * Changes a loan. When its schedule or `unpaidPastInstallments` changes, the
 * paid installments are rebuilt: past ones are paid unless listed as unpaid
 * (an omitted list keeps today's unpaid ones), and installments paid ahead of
 * their due date stay paid while they still exist.
 */
export function updateLoan(debtId: number, changes: LoanChanges): string {
  const debt = found(db.getDebtSchedule(debtId), 'Loan');
  const { unpaidPastInstallments, ...fields } = changes;
  const loan = validLoan({ ...debt, ...defined(fields) });
  const scheduleChanged =
    loan.firstDueDate !== debt.firstDueDate || loan.frequency !== debt.frequency || loan.totalInstallments !== debt.totalInstallments;
  if (!scheduleChanged && unpaidPastInstallments === undefined) {
    db.updateDebt(debtId, loan);
    return `Updated loan ${loan.name}`;
  }

  const today = todayLocal();
  const wasPaid = new Set(debt.paidInstallmentNumbers);
  const past = pastDueNumbers(loan, today);
  const unpaid = unpaidPastInstallments === undefined ? new Set(past.filter((n) => !wasPaid.has(n))) : unpaidList(unpaidPastInstallments, loan.totalInstallments);
  const paidAhead = debt.paidInstallmentNumbers.filter((n) => n > past.length && n <= loan.totalInstallments);
  const paid = [...past.filter((n) => !unpaid.has(n)), ...paidAhead];
  db.updateDebt(debtId, loan, paid);
  return `Updated loan ${loan.name} (${paid.length}/${loan.totalInstallments} paid)`;
}

export function deleteLoan(debtId: number): string {
  const debt = found(db.getDebtSchedule(debtId), 'Loan');
  db.deleteDebt(debtId);
  return `Deleted loan ${debt.name}`;
}

/* ──────────────────────────── credit cards ─────────────────────────── */

export function updateCard(cardId: number, changes: Partial<db.CardInput>): string {
  const card = found(db.getCreditCard(cardId), 'Card');
  const merged = { ...card, ...defined(changes) };
  db.updateCard(cardId, {
    statementBalance: pesos(merged.statementBalance, 'Statement balance'),
    unbilledAmount: pesos(merged.unbilledAmount, 'Unbilled amount'),
    minimumDue: pesos(merged.minimumDue, 'Minimum due'),
    projectedMonthlySpend: pesos(merged.projectedMonthlySpend, 'Projected spend'),
  });
  return `Updated ${card.name}`;
}

export function setCardStatementPaid(cardId: number, paid: boolean, syncWallet: boolean): string {
  const card = found(db.getCreditCard(cardId), 'Card');
  if (card.paidThisMonth === paid) return `${card.name} statement already ${paid ? 'paid' : 'unpaid'}`;
  if (!paid) {
    const delta = syncWallet ? card.lastPaidAmount : 0;
    db.undoCardSettlement(cardId, delta);
    return `${card.name} statement marked unpaid (${walletNote(delta)})`;
  }
  const bill = currentBill(card, ledgerStart());
  if (!bill) throw new CommandError(`${card.name} has no upcoming statement to settle.`);
  const delta = syncWallet ? -bill.amount : 0;
  db.settleCardStatement(cardId, bill.dueDate, bill.amount, delta);
  return `${card.name} statement due ${bill.dueDate} paid: ${formatPeso(bill.amount)} (${walletNote(delta)})`;
}

export function toggleCardStatementPaid(cardId: number, syncWallet: boolean): string {
  const card = found(db.getCreditCard(cardId), 'Card');
  return setCardStatementPaid(cardId, !card.paidThisMonth, syncWallet);
}

/* ─────────────────────────── quick expenses ────────────────────────── */

export function logExpense(description: string, amount: number): string {
  const value = pesos(amount, 'Expense amount', { allowZero: false });
  const id = db.addQuickExpense(nonEmpty(description, 'Description'), value, todayLocal());
  return `Logged expense #${id} ${description}: -${formatPeso(value)}`;
}

export function deleteExpense(expenseId: number): string {
  const expense = found(db.deleteQuickExpense(expenseId), 'Expense');
  return `Deleted expense ${expense.description}; refunded ${formatPeso(expense.amount)} to wallet`;
}

/* ──────────────────────────── cycle control ────────────────────────── */

export function startNewMonthCycle(): string {
  db.startNewMonthCycle();
  return `Started ${db.getSnapshot().settings.currentMonthLabel} cycle`;
}

export function resetToSeed(): string {
  db.resetToSeed();
  return 'Cleared all data; wallet reset to ₱0.00';
}

export function backupDatabase(): Promise<string> {
  return db.backupDatabase();
}
