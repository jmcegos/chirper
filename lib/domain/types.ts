import type { IsoDate, YearMonth } from './calendar';

export interface IncomeRule {
  id: number;
  name: string;
  dayOfMonth: number;
  grossAmount: number;
  fixedDeductions: number;
  isPayroll: boolean;
  absenceRate: number;
  currentAbsences: number;
  nextMonthAbsences: number;
  receivedThisMonth: boolean;
}

export type LoanFrequency = 'monthly' | 'every_15_days';

export interface DebtSchedule {
  id: number;
  name: string;
  lender: string;
  loanDate: IsoDate;
  /** Due date of installment #1; later ones follow `frequency`. */
  firstDueDate: IsoDate;
  frequency: LoanFrequency;
  installmentAmount: number;
  totalInstallments: number;
  /** Installment numbers already paid, ascending. */
  paidInstallmentNumbers: number[];
  /** Taken off an installment paid on or before its due date. */
  rebateAmount: number;
  /** Added once to an installment paid after its due date. */
  penaltyAmount: number;
  /** The most recent payment; `amountPaid` is null when it was assumed paid on entry. */
  lastPayment: { number: number; amountPaid: number | null } | null;
  notes: string;
}

export interface CreditCard {
  id: number;
  name: string;
  statementDay: number;
  dueDay: number;
  unbilledAmount: number;
  statementBalance: number;
  minimumDue: number;
  paidThisMonth: boolean;
  projectedMonthlySpend: number;
  lastSettledDue: IsoDate | null;
  lastPaidAmount: number;
}

export interface QuickExpense {
  id: number;
  description: string;
  amount: number;
  dateLogged: IsoDate;
}

export interface FinanceSettings {
  walletBalance: number;
  walletName: string;
  currentMonthLabel: string;
  cycleMonth: YearMonth;
}

export interface FinanceSnapshot {
  settings: FinanceSettings;
  incomes: IncomeRule[];
  debts: DebtSchedule[];
  cards: CreditCard[];
  expenses: QuickExpense[];
}
