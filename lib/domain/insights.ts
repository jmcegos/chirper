import { addMonths, daysBetween, yearMonthKey, type IsoDate, type YearMonth } from './calendar';
import { allEvents, type Ledger, type LedgerEvent } from './ledger';
import { onTimeAmount, payoffsByDate, type LoanPayoff } from './loans';
import { roundPesos, toCentavos, toPesos } from './money';
import type { DebtSchedule } from './types';

const DAYS_PER_MONTH = 30;

const pendingCash = (event: LedgerEvent) => event.amount !== 0;

export function nextInflow(ledger: Ledger): LedgerEvent | null {
  return allEvents(ledger).find((event) => event.amount > 0) ?? null;
}

export function nextOutflow(ledger: Ledger): LedgerEvent | null {
  return allEvents(ledger).find((event) => event.amount < 0) ?? null;
}

export interface SafeSpend {
  payday: LedgerEvent | null;
  daysUntilPayday: number;
  obligationsBeforePayday: number;
  dailySafeSpend: number;
}

/** (wallet − obligations due before payday) ÷ days until the next payroll lands. */
export function safeSpendUntilPayday(ledger: Ledger): SafeSpend {
  const events = allEvents(ledger);
  const payday = events.find((event) => event.isPayroll) ?? null;
  const daysUntilPayday = payday ? Math.max(1, daysBetween(ledger.startDate, payday.date)) : DAYS_PER_MONTH;
  const obligations = events
    .filter((event) => event.amount < 0 && (!payday || event.date < payday.date))
    .reduce((sum, event) => sum + toCentavos(event.amount), 0);
  const spendable = Math.max(0, toCentavos(ledger.startingBalance) + obligations);
  return {
    payday,
    daysUntilPayday,
    obligationsBeforePayday: toPesos(-obligations),
    dailySafeSpend: toPesos(Math.floor(spendable / daysUntilPayday)),
  };
}

export interface MonthlyDebtService {
  month: YearMonth;
  total: number;
}

/** Loan installments scheduled in each month after the cycle month. */
export function debtServiceByMonth(ledger: Ledger): MonthlyDebtService[] {
  return ledger.months.slice(1).map((month, index) => ({
    month: addMonths(ledger.cycleMonth, index + 1),
    total: toPesos(month.events.filter((event) => event.kind === 'debt').reduce((sum, event) => sum - toCentavos(event.amount), 0)),
  }));
}

export interface LiberationMilestone {
  finalPaymentDate: IsoDate;
  freedFromMonth: YearMonth;
  installmentsLeft: number;
  loans: DebtSchedule[];
  freedMonthly: number;
}

/** Loans grouped by the month they finish, earliest first. */
export function liberationMilestones(debts: DebtSchedule[]): LiberationMilestone[] {
  const groups = new Map<string, LoanPayoff[]>();
  for (const payoff of payoffsByDate(debts)) {
    const key = yearMonthKey(payoff.freedFromMonth);
    groups.set(key, [...(groups.get(key) ?? []), payoff]);
  }
  return Array.from(groups.values()).map((payoffs) => {
    const last = payoffs[payoffs.length - 1];
    return {
      finalPaymentDate: last.finalPaymentDate,
      freedFromMonth: last.freedFromMonth,
      installmentsLeft: Math.max(...payoffs.map((payoff) => payoff.installmentsLeft)),
      loans: payoffs.map((payoff) => payoff.debt),
      freedMonthly: roundPesos(payoffs.reduce((sum, payoff) => sum + onTimeAmount(payoff.debt), 0)),
    };
  });
}

export interface SimulatedEvent {
  event: LedgerEvent;
  simulatedBalance: number;
}

/** Spreads a monthly living spend evenly per day from the ledger start. */
export function simulateLivingSpend(ledger: Ledger, monthlySpend: number): SimulatedEvent[] {
  const dailyBurn = toCentavos(monthlySpend) / DAYS_PER_MONTH;
  return allEvents(ledger).map((event) => {
    const burned = Math.round(dailyBurn * daysBetween(ledger.startDate, event.date));
    return { event, simulatedBalance: toPesos(toCentavos(event.runningBalance) - burned) };
  });
}

export interface SpendCeiling {
  monthlyCeiling: number;
  bindingEvent: LedgerEvent | null;
}

/** Highest monthly living spend that keeps every future ledger row ≥ ₱0. */
export function maxSafeLivingSpend(ledger: Ledger): SpendCeiling {
  let ceiling = Number.POSITIVE_INFINITY;
  let bindingEvent: LedgerEvent | null = null;
  for (const event of allEvents(ledger).filter(pendingCash)) {
    const days = daysBetween(ledger.startDate, event.date);
    const limit = days === 0 ? (event.runningBalance < 0 ? 0 : Number.POSITIVE_INFINITY) : (event.runningBalance / days) * DAYS_PER_MONTH;
    if (limit < ceiling) {
      ceiling = limit;
      bindingEvent = event;
    }
  }
  if (!Number.isFinite(ceiling)) return { monthlyCeiling: toPesos(Math.max(0, toCentavos(ledger.startingBalance))), bindingEvent };
  return { monthlyCeiling: Math.max(0, Math.floor(ceiling * 100) / 100), bindingEvent };
}

/** Lowest running balance on/after `from`; used for "how much extra can this bill take". */
export function lowestBalanceFrom(ledger: Ledger, from: IsoDate): number | null {
  const balances = allEvents(ledger).filter((event) => event.date >= from).map((event) => event.runningBalance);
  return balances.length ? Math.min(...balances) : null;
}
