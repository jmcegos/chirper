import { describe, expect, it } from 'vitest';
import { parseYearMonthKey } from './calendar';
import { currentBill } from './creditCard';
import { debtServiceByMonth, liberationMilestones, maxSafeLivingSpend, nextInflow, nextOutflow, safeSpendUntilPayday, simulateLivingSpend } from './insights';
import { allEvents, buildLedger } from './ledger';
import { remainingBalance } from './loans';
import { netPay } from './payroll';
import type { CreditCard, DebtSchedule, FinanceSnapshot, IncomeRule, LoanFrequency, Receivable } from './types';
import { SEED_CREDIT_CARDS, SEED_DEBT_SCHEDULES, SEED_INCOME_RULES, SEED_LOAN_PAYMENTS, seedSettings } from '../fixtures/sampleData';

const TODAY = '2026-10-17';

function seedSnapshot(): FinanceSnapshot {
  const incomes: IncomeRule[] = SEED_INCOME_RULES.map((row, index) => ({
    id: index + 1,
    name: row.name,
    dayOfMonth: row.day_of_month,
    grossAmount: row.gross_amount,
    fixedDeductions: row.fixed_deductions,
    isPayroll: row.is_payroll === 1,
    absenceRate: row.absence_rate,
    currentAbsences: row.current_absences,
    nextMonthAbsences: row.next_month_absences,
    receivedThisMonth: row.received_this_month === 1,
  }));
  const debts: DebtSchedule[] = SEED_DEBT_SCHEDULES.map((row, index) => ({
    id: index + 1,
    name: row.name,
    lender: row.lender,
    loanDate: row.loan_date,
    firstDueDate: row.first_due_date,
    frequency: row.frequency as LoanFrequency,
    installmentAmount: row.monthly_amount,
    totalInstallments: row.total_installments,
    paidInstallmentNumbers: SEED_LOAN_PAYMENTS.filter((payment) => payment.debt_id === index + 1).map((payment) => payment.installment_number),
    rebateAmount: 0,
    penaltyAmount: 0,
    lastPayment: null,
    notes: row.notes,
  }));
  const cards: CreditCard[] = SEED_CREDIT_CARDS.map((row, index) => ({
    id: index + 1,
    name: row.name,
    statementDay: row.statement_day,
    dueDay: row.due_day,
    unbilledAmount: row.unbilled_amount,
    statementBalance: row.statement_balance,
    minimumDue: row.minimum_due,
    paidThisMonth: row.paid_this_month === 1,
    projectedMonthlySpend: row.projected_monthly_spend,
    lastSettledDue: row.last_settled_due,
    lastPaidAmount: row.last_paid_amount,
  }));
  const settings = seedSettings();
  return {
    settings: {
      walletBalance: Number(settings.wallet_balance),
      walletName: String(settings.wallet_name),
      currentMonthLabel: String(settings.current_month_label),
      cycleMonth: parseYearMonthKey(String(settings.cycle_month)),
    },
    incomes,
    debts,
    cards,
    bills: [],
    receivables: [],
    expenses: [],
  };
}

const rows = (snapshot: FinanceSnapshot) =>
  allEvents(buildLedger(snapshot, TODAY)).map((event) => [event.date, event.amount, event.runningBalance]);

describe('payroll', () => {
  it('nets ₱13,454.00 with zero absences and deducts ₱986.30 per absence day', () => {
    const payroll = seedSnapshot().incomes[1];
    expect(netPay(payroll, 0)).toBe(13454);
    expect(netPay(payroll, 1.5)).toBe(11974.55);
  });
});

describe('seeded runway ledger (Oct 17 → Nov 25)', () => {
  it('matches the expected running balance to the centavo', () => {
    expect(rows(seedSnapshot()).filter(([date]) => String(date) <= '2026-11-25')).toEqual([
      ['2026-10-22', 0, 1145.65],
      ['2026-10-25', 13454, 14599.65],
      ['2026-11-01', -10579.6, 4020.05],
      ['2026-11-04', 5000, 9020.05],
      ['2026-11-10', 13454, 22474.05],
      ['2026-11-13', -8520.52, 13953.53],
      ['2026-11-15', 3500, 17453.53],
      ['2026-11-17', -1100.49, 16353.04],
      ['2026-11-20', -2977, 13376.04],
      ['2026-11-22', 0, 13376.04],
      ['2026-11-22', -10885, 2491.04],
      ['2026-11-25', 13454, 15945.04],
    ]);
  });

  it('ends December after the final ₱30k installment on Dec 22', () => {
    const december = buildLedger(seedSnapshot(), TODAY).months[2];
    const final = december.events.find((event) => event.title.startsWith('3-Month Cash Loan'));
    expect(final?.title).toBe('3-Month Cash Loan (₱30k) (3/3)');
    expect(final?.date).toBe('2026-12-22');
    expect(december.events.at(-1)).toMatchObject({ date: '2026-12-25', runningBalance: 27870.03 });
  });

  it('reports the October items as completed without touching starting cash', () => {
    const ledger = buildLedger(seedSnapshot(), TODAY);
    expect(ledger.startingBalance).toBe(1145.65);
    expect(ledger.completed.map((item) => item.title)).toContain('Installment Loan (₱74.2k)');
    // Oct installments paid: Installment Loan #3, GLoan #3, cash loan #1 (paid early). The bridge loan starts Nov 17.
    expect(ledger.completed.filter((item) => item.id.startsWith('debt'))).toHaveLength(3);
    expect(ledger.bufferNeeded).toBe(0);
  });
});

describe('dated loans', () => {
  it('rolls unpaid installments from earlier months onto today as overdue', () => {
    const snapshot = seedSnapshot();
    snapshot.debts[2].paidInstallmentNumbers = [1, 3]; // GLoan #2 (Sep 20) was never paid
    const overdue = allEvents(buildLedger(snapshot, TODAY)).filter((event) => event.overdue);
    expect(overdue).toMatchObject([{ date: TODAY, scheduledDate: '2026-09-20', title: 'GLoan (JKKO8771) (2/12)', amount: -2977 }]);
  });

  it('places every-15-days installments on their own dates', () => {
    const snapshot = seedSnapshot();
    snapshot.debts = [
      {
        id: 9, name: 'Cash Advance', lender: 'Lender', loanDate: '2026-10-10', firstDueDate: '2026-10-25',
        frequency: 'every_15_days', installmentAmount: 500, totalInstallments: 4, paidInstallmentNumbers: [], notes: '',
        rebateAmount: 0, penaltyAmount: 0, lastPayment: null,
      },
    ];
    const dates = allEvents(buildLedger(snapshot, TODAY)).filter((event) => event.kind === 'debt').map((event) => event.date);
    expect(dates).toEqual(['2026-10-25', '2026-11-09', '2026-11-24', '2026-12-09']);
  });

  it('charges the penalty on overdue installments and applies the rebate to upcoming ones', () => {
    const snapshot = seedSnapshot();
    snapshot.debts = [
      {
        id: 9, name: 'Motor Loan', lender: 'Dealer', loanDate: '2026-09-01', firstDueDate: '2026-10-05',
        frequency: 'monthly', installmentAmount: 5200, totalInstallments: 3, paidInstallmentNumbers: [], notes: '',
        rebateAmount: 500, penaltyAmount: 300, lastPayment: null,
      },
    ];
    const motor = allEvents(buildLedger(snapshot, TODAY)).filter((event) => event.kind === 'debt');
    expect(motor.map((event) => [event.date, event.amount, event.overdue, event.detail])).toEqual([
      [TODAY, -5500, true, 'Dealer • includes ₱300.00 late penalty, rebate lost'],
      ['2026-11-05', -4700, false, 'Dealer • includes ₱500.00 on-time rebate'],
      ['2026-12-05', -4700, false, 'Dealer • FINAL installment • includes ₱500.00 on-time rebate'],
    ]);
  });
});

describe('bills', () => {
  const meralco = {
    id: 1, name: 'Meralco', frequency: 'monthly' as const, nextDueDate: '2026-09-20', estimatedAmount: 2350, notes: '',
    records: [{ dueDate: '2026-09-20', actualAmount: 2100, paidAmount: 2100, paidAt: 1 }],
  };

  it('uses the billed amount when known and projects the rest at the estimate', () => {
    const snapshot = { ...seedSnapshot(), bills: [{ ...meralco, records: [...meralco.records, { dueDate: '2026-10-20', actualAmount: 2812.4, paidAmount: null, paidAt: null }] }] };
    const events = allEvents(buildLedger(snapshot, TODAY)).filter((event) => event.kind === 'bill');
    expect(events.map((event) => [event.date, event.amount, event.overdue, event.detail])).toEqual([
      ['2026-10-20', -2812.4, false, 'Billed'],
      ['2026-11-20', -2350, false, 'Est. ₱2,350.00'],
      ['2026-12-20', -2350, false, 'Est. ₱2,350.00'],
    ]);
  });

  it('flags a bill whose due date has passed unpaid as overdue', () => {
    const rent = { ...meralco, name: 'Rent', nextDueDate: '2026-10-05', estimatedAmount: 8000, records: [] };
    const first = allEvents(buildLedger({ ...seedSnapshot(), bills: [rent] }, TODAY)).find((event) => event.kind === 'bill');
    expect(first).toMatchObject({ date: TODAY, scheduledDate: '2026-10-05', overdue: true, amount: -8000 });
  });

  it('lists a bill paid in the cycle month as completed', () => {
    const paidInOctober = { ...meralco, nextDueDate: '2026-10-01', records: [{ dueDate: '2026-10-01', actualAmount: null, paidAmount: 2350, paidAt: 1 }] };
    const ledger = buildLedger({ ...seedSnapshot(), bills: [paidInOctober] }, TODAY);
    expect(ledger.completed.find((item) => item.id.startsWith('bill'))).toMatchObject({ title: 'Meralco', amount: -2350, note: 'Paid ✓' });
  });
});

describe('receivables', () => {
  const ana: Receivable = {
    id: 7, person: 'Ana', description: 'Phone repair', amount: 2000, lentDate: '2026-10-01', promisedDate: '2026-10-22', expected: true, notes: '',
    payments: [],
  };
  const pay = (id: number, amount: number, paidOn = '2026-10-12') => ({ id, amount, paidOn, walletSynced: true });
  const receivableEvents = (receivables: Receivable[]) =>
    allEvents(buildLedger({ ...seedSnapshot(), receivables }, TODAY)).filter((event) => event.kind === 'receivable');

  it('adds an expected receivable as money in on its promised date', () => {
    expect(receivableEvents([ana])).toEqual([
      expect.objectContaining({ id: 'receivable-7', date: '2026-10-22', amount: 2000, title: 'Ana pays back', detail: 'Phone repair', overdue: false }),
    ]);
  });

  it('shows only the remaining amount as money in', () => {
    const [event] = receivableEvents([{ ...ana, payments: [pay(1, 500)] }]);
    expect(event.amount).toBe(1500);
    expect(event.detail).toBe('Phone repair • ₱500.00 of ₱2,000.00 received');
  });

  it('ignores receivables that are not expected', () => {
    expect(receivableEvents([{ ...ana, expected: false }, { ...ana, id: 8, promisedDate: null }])).toEqual([]);
  });

  it('rolls a past promised date onto the start as overdue', () => {
    expect(receivableEvents([{ ...ana, promisedDate: '2026-10-10' }])[0]).toMatchObject({ date: TODAY, scheduledDate: '2026-10-10', overdue: true });
  });

  it('drops paid-off receivables and those promised past the ledger end', () => {
    expect(receivableEvents([{ ...ana, payments: [pay(1, 2000)] }, { ...ana, id: 8, promisedDate: '2027-03-01' }])).toEqual([]);
  });

  it('lists cycle-month payments as completed', () => {
    const ledger = buildLedger({ ...seedSnapshot(), receivables: [{ ...ana, payments: [pay(1, 500, '2026-09-28'), pay(2, 700), pay(3, 800)] }] }, TODAY);
    expect(ledger.completed.filter((item) => item.id.startsWith('receivable')).map((item) => [item.amount, item.note])).toEqual([
      [700, 'Partial ✓'],
      [800, 'Received ✓'],
    ]);
  });

  it('orders a receivable after income on the same day', () => {
    const sameDay = allEvents(buildLedger({ ...seedSnapshot(), receivables: [{ ...ana, promisedDate: '2026-10-25' }] }, TODAY)).filter(
      (event) => event.date === '2026-10-25',
    );
    expect(sameDay.map((event) => event.kind).slice(0, 2)).toEqual(['income', 'receivable']);
  });
});

describe('absences', () => {
  it('only reduce the cutoff they were entered for', () => {
    const snapshot = seedSnapshot();
    snapshot.incomes[3].currentAbsences = 1;
    const oct25 = allEvents(buildLedger(snapshot, TODAY)).find((event) => event.date === '2026-10-25');
    expect(oct25?.amount).toBe(12467.7);
    expect(oct25?.runningBalance).toBe(13613.35);
  });
});

describe('shortfall detection', () => {
  it('computes the buffer needed when the balance dips below zero', () => {
    const snapshot = seedSnapshot();
    snapshot.settings.walletBalance = 0;
    snapshot.incomes[3].currentAbsences = 4;
    const ledger = buildLedger(snapshot, TODAY);
    // Oct 25: 13,454 − 3,945.20 = 9,508.80; Nov 1: 9,508.80 − 10,579.60 = −1,070.80
    expect(allEvents(ledger).find((event) => event.date === '2026-11-01')?.runningBalance).toBe(-1070.8);
    // The deficit carries forward and bottoms out after the Nov 22 installment.
    expect(ledger.lowestPoint).toEqual({ date: '2026-11-22', balance: -2599.81 });
    expect(ledger.bufferNeeded).toBe(2599.81);
  });
});

describe('credit card two-date logic', () => {
  it('bills on the 22nd and deducts on the 1st of the following month', () => {
    const bill = currentBill(seedSnapshot().cards[0], TODAY);
    expect(bill).toMatchObject({ statementDate: '2026-10-22', dueDate: '2026-11-01', amount: 10579.6 });
  });

  it('moves to the next statement once the current one is settled', () => {
    const card = { ...seedSnapshot().cards[0], statementBalance: 0, lastSettledDue: '2026-11-01', projectedMonthlySpend: 2500 };
    expect(currentBill(card, TODAY)).toMatchObject({ statementDate: '2026-11-22', dueDate: '2026-12-01', amount: 2500 });
  });
});

describe('KPIs', () => {
  const ledger = buildLedger(seedSnapshot(), TODAY);

  it('daily safe spend = wallet ÷ days until the Oct 25 payday', () => {
    const safe = safeSpendUntilPayday(ledger);
    expect(safe.payday?.date).toBe('2026-10-25');
    expect(safe.daysUntilPayday).toBe(8);
    expect(safe.dailySafeSpend).toBe(143.2);
  });

  it('finds the next inflow and outflow', () => {
    expect(nextInflow(ledger)).toMatchObject({ date: '2026-10-25', amount: 13454 });
    expect(nextOutflow(ledger)).toMatchObject({ date: '2026-11-01', amount: -10579.6 });
  });

  it('sums ₱23,483.01/mo of loan service in Nov and Dec', () => {
    expect(debtServiceByMonth(ledger).map((month) => month.total)).toEqual([23483.01, 23483.01]);
  });

  it('frees ₱10,885/mo after Dec 22 and ₱1,100.49/mo after Jan 17', () => {
    const [first, second] = liberationMilestones(seedSnapshot().debts);
    expect(first).toMatchObject({ finalPaymentDate: '2026-12-22', installmentsLeft: 2, freedMonthly: 10885, freedFromMonth: { year: 2027, month: 1 } });
    expect(second).toMatchObject({ finalPaymentDate: '2027-01-17', freedMonthly: 1100.49 });
  });

  it('reports remaining loan balances', () => {
    expect(remainingBalance(seedSnapshot().debts[0], TODAY)).toBe(76684.68);
  });

  it('caps living spend so Nov 22 never dips below zero', () => {
    const ceiling = maxSafeLivingSpend(ledger);
    expect(ceiling.bindingEvent?.date).toBe('2026-11-22');
    const simulated = simulateLivingSpend(ledger, ceiling.monthlyCeiling);
    expect(Math.min(...simulated.map((row) => row.simulatedBalance))).toBeGreaterThanOrEqual(0);
    expect(Math.min(...simulateLivingSpend(ledger, ceiling.monthlyCeiling + 1).map((row) => row.simulatedBalance))).toBeLessThan(0);
  });
});
