import { describe, expect, it } from 'vitest';
import { addDays } from './calendar';
import {
  amountDueOn,
  dueDateOf,
  frequencyLabel,
  installments,
  isSettledThrough,
  legacyFirstDueDate,
  nextUnpaid,
  overdueInstallments,
  pastDueNumbers,
  payoffOf,
  remainingBalance,
} from './loans';
import type { DebtSchedule } from './types';

function loan(overrides: Partial<DebtSchedule> = {}): DebtSchedule {
  return {
    id: 1,
    name: 'Test Loan',
    lender: 'Lender',
    loanDate: '2026-01-01',
    firstDueDate: '2026-01-31',
    frequency: 'monthly',
    installmentAmount: 1000,
    totalInstallments: 4,
    paidInstallmentNumbers: [],
    rebateAmount: 0,
    penaltyAmount: 0,
    lastPayment: null,
    notes: '',
    ...overrides,
  };
}

describe('calendar', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-10-18', 15)).toBe('2026-11-02');
    expect(addDays('2026-12-25', 15)).toBe('2027-01-09');
    expect(addDays('2028-02-20', 10)).toBe('2028-03-01');
  });
});

describe('due dates', () => {
  it('keeps the original day for monthly loans, clamping short months', () => {
    const debt = loan();
    expect([1, 2, 3, 4].map((n) => dueDateOf(debt, n))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('spaces 15-day loans exactly 15 days apart', () => {
    const debt = loan({ firstDueDate: '2026-10-18', frequency: 'every_15_days' });
    expect([1, 2, 3, 4].map((n) => dueDateOf(debt, n))).toEqual(['2026-10-18', '2026-11-02', '2026-11-17', '2026-12-02']);
  });

  it('labels the frequency', () => {
    expect(frequencyLabel(loan({ firstDueDate: '2026-08-20' }))).toBe('Monthly · 20th');
    expect(frequencyLabel(loan({ frequency: 'every_15_days' }))).toBe('Every 15 days');
  });
});

describe('paid and overdue installments', () => {
  const debt = loan({ firstDueDate: '2026-08-20', paidInstallmentNumbers: [1, 3] });

  it('marks each installment paid or unpaid by number', () => {
    expect(installments(debt).map((item) => [item.number, item.date, item.paid])).toEqual([
      [1, '2026-08-20', true],
      [2, '2026-09-20', false],
      [3, '2026-10-20', true],
      [4, '2026-11-20', false],
    ]);
  });

  it('flags unpaid installments due before today as overdue', () => {
    expect(overdueInstallments(debt, '2026-10-25').map((item) => item.number)).toEqual([2]);
    expect(overdueInstallments(debt, '2026-09-20')).toEqual([]);
  });

  it('pays the oldest unpaid installment next', () => {
    expect(nextUnpaid(debt)?.number).toBe(2);
    expect(nextUnpaid(loan({ paidInstallmentNumbers: [1, 2, 3, 4] }))).toBeNull();
  });

  it('counts the remaining balance from unpaid installments only', () => {
    expect(remainingBalance(debt, '2026-08-01')).toBe(2000);
  });

  it('is settled through a date only when everything due by then is paid', () => {
    expect(isSettledThrough(debt, '2026-08-31')).toBe(true);
    expect(isSettledThrough(debt, '2026-10-31')).toBe(false);
  });
});

describe('past due dates for a new loan', () => {
  it('lists installments due on or before today', () => {
    const terms = { firstDueDate: '2026-10-18', frequency: 'every_15_days' as const, totalInstallments: 6 };
    expect(pastDueNumbers(terms, '2026-11-17')).toEqual([1, 2, 3]);
    expect(pastDueNumbers(terms, '2026-10-17')).toEqual([]);
  });

  it('never lists more than the total installments', () => {
    expect(pastDueNumbers({ firstDueDate: '2025-01-05', frequency: 'monthly', totalInstallments: 3 }, '2026-10-26')).toEqual([1, 2, 3]);
  });
});

describe('payoff', () => {
  it('ends on the last unpaid installment and frees the following month', () => {
    expect(payoffOf(loan({ firstDueDate: '2026-10-22', totalInstallments: 3, paidInstallmentNumbers: [1] }))).toMatchObject({
      installmentsLeft: 2,
      finalPaymentDate: '2026-12-22',
      freedFromMonth: { year: 2027, month: 1 },
    });
    expect(payoffOf(loan({ paidInstallmentNumbers: [1, 2, 3, 4] }))).toBeNull();
  });
});

describe('legacy loans', () => {
  const october = { year: 2026, month: 10 };

  it('puts installment #paid in the cycle month when paid this month', () => {
    expect(legacyFirstDueDate(13, 3, true, october)).toBe('2026-08-13');
  });

  it('puts installment #paid+1 in the cycle month when not yet paid', () => {
    expect(legacyFirstDueDate(20, 3, false, october)).toBe('2026-07-20');
  });

  it('starts next month when nothing was due this month', () => {
    expect(legacyFirstDueDate(17, 0, true, october)).toBe('2026-11-17');
  });
});

describe('on-time rebate and late penalty', () => {
  const motor = loan({ firstDueDate: '2026-10-20', installmentAmount: 5200, rebateAmount: 500, penaltyAmount: 300, totalInstallments: 3 });
  const first = installments(motor)[0];

  it('earns the rebate when paid on or before the due date', () => {
    expect(amountDueOn(motor, first, '2026-10-19')).toBe(4700);
    expect(amountDueOn(motor, first, '2026-10-20')).toBe(4700);
  });

  it('loses the rebate and adds the penalty from the day after', () => {
    expect(amountDueOn(motor, first, '2026-10-21')).toBe(5500);
  });

  it('counts the remaining balance at what each unpaid installment costs today', () => {
    // #1 (Oct 20) is overdue on Oct 26; #2 and #3 are still payable on time.
    expect(remainingBalance(motor, '2026-10-26')).toBe(5500 + 4700 + 4700);
  });
});
