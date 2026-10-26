import { formatMonthLabel, todayLocal, yearMonthKey, yearMonthOf } from './domain/calendar';

/**
 * Starting state for a new database: an empty ₱0 wallet whose cycle month is
 * the current month. Incomes, loans and cards are added from the dashboard or
 * through the agent. (Tests seed a full sample state from `lib/fixtures/sampleData.ts`.)
 */
export function seedSettings(): Record<string, string | number> {
  const month = yearMonthOf(todayLocal());
  return {
    wallet_balance: 0,
    wallet_name: 'Wallet',
    current_month_label: formatMonthLabel(month),
    cycle_month: yearMonthKey(month),
  };
}

export const SEED_INCOME_RULES: Array<Record<string, unknown>> = [];

export const SEED_DEBT_SCHEDULES: Array<Record<string, unknown>> = [];

export const SEED_LOAN_PAYMENTS: Array<Record<string, unknown>> = [];

export const SEED_CREDIT_CARDS: Array<Record<string, unknown>> = [];
