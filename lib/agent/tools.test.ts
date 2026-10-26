import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const TODAY = '2026-10-17';
vi.mock('@/lib/domain/calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/domain/calendar')>()),
  todayLocal: () => TODAY,
}));
// The app starts empty; these tests run against the Oct 17 sample state.
vi.mock('@/lib/seed', () => import('@/lib/fixtures/sampleData'));

type Tools = typeof import('./tools');
type Db = typeof import('@/lib/db');
let tools: Tools;
let db: Db;

const run = (name: string, input: unknown = {}) => tools.runAgentTool(name, input, TODAY);
const wallet = () => db.getSnapshot().settings.walletBalance;

beforeAll(async () => {
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'fin-agent-')));
  tools = await import('./tools');
  db = await import('@/lib/db');
});

describe('agent tools against a seeded database', () => {
  it('reads the full state with ids and the runway', () => {
    const state = JSON.parse(run('get_financial_state').content);
    expect(state.wallet.balance).toBe(1145.65);
    expect(state.loans).toHaveLength(4);
    expect(state.runway.lowestPoint).toEqual({ date: '2026-10-17', balance: 1145.65 });
  });

  it('logs an expense and deducts it from the wallet', () => {
    expect(run('log_expense', { description: 'Lunch', amount: 250 })).toEqual({ content: 'Logged expense #1 Lunch: -₱250.00', isError: false });
    expect(wallet()).toBe(895.65);
  });

  it('marks payroll received and moves the wallet when asked to', () => {
    run('set_income_received', { income_id: 4, received: true, sync_wallet: true });
    expect(wallet()).toBe(14349.65);
  });

  it('pays the card statement and the ledger moves to the next statement', () => {
    run('set_card_statement_paid', { card_id: 1, paid: true, sync_wallet: true });
    expect(wallet()).toBe(3770.05);
    const state = JSON.parse(run('get_financial_state').content);
    expect(state.creditCards[0].upcomingBill).toMatchObject({ dueDate: '2026-12-01', amount: 0 });
  });

  it('updates only the loan fields that were sent', () => {
    run('update_loan', { loan_id: 2, notes: 'Renegotiated' });
    expect(db.getDebtSchedule(2)).toMatchObject({ name: '₱3k Bridge Loan', installmentAmount: 1100.49, notes: 'Renegotiated', paidInstallmentNumbers: [] });
  });

  it('adds a dated loan with past installments paid and the wallet untouched', () => {
    const before = wallet();
    const result = run('add_loan', {
      name: 'Cash Advance', lender: 'Lender', loan_date: '2026-09-01', first_due_date: '2026-09-15',
      frequency: 'every_15_days', installment_amount: 500, total_installments: 6,
    });
    // Sep 15, Sep 30 and Oct 15 are on or before Oct 17.
    expect(result).toEqual({ content: 'Added loan #5 Cash Advance (₱500.00 every 15 days, 3/6 paid)', isError: false });
    expect(db.getDebtSchedule(5)?.paidInstallmentNumbers).toEqual([1, 2, 3]);
    expect(wallet()).toBe(before);
  });

  it('leaves listed past installments unpaid so they show as overdue', () => {
    run('add_loan', {
      name: 'Phone', lender: 'Shop', loan_date: '2026-07-05', first_due_date: '2026-08-05',
      frequency: 'monthly', installment_amount: 1000, total_installments: 6, unpaid_past_installments: [3],
    });
    expect(db.getDebtSchedule(6)?.paidInstallmentNumbers).toEqual([1, 2]);
    const state = JSON.parse(run('get_financial_state').content);
    expect(state.loans.find((loan: { id: number }) => loan.id === 6).overdue).toEqual([{ number: 3, date: '2026-10-05', amountDue: 1000 }]);
  });

  it('pays the oldest unpaid installment and undoes the latest payment', () => {
    const before = wallet();
    run('set_loan_paid', { loan_id: 6, paid: true, sync_wallet: true });
    expect(db.getDebtSchedule(6)?.paidInstallmentNumbers).toEqual([1, 2, 3]);
    expect(wallet()).toBeCloseTo(before - 1000, 2);
    run('set_loan_paid', { loan_id: 6, paid: false, sync_wallet: true });
    expect(db.getDebtSchedule(6)?.paidInstallmentNumbers).toEqual([1, 2]);
    expect(wallet()).toBe(before);
  });

  it('pays a late installment with its penalty and refunds exactly that on undo', () => {
    run('add_loan', {
      name: 'Motor', lender: 'Dealer', loan_date: '2026-09-01', first_due_date: '2026-10-05', frequency: 'monthly',
      installment_amount: 5200, total_installments: 3, rebate_amount: 500, penalty_amount: 300, unpaid_past_installments: [1],
    });
    const state = JSON.parse(run('get_financial_state').content);
    const motor = state.loans.find((loan: { name: string }) => loan.name === 'Motor');
    expect(motor.overdue).toEqual([{ number: 1, date: '2026-10-05', amountDue: 5500 }]);

    const before = wallet();
    expect(run('set_loan_paid', { loan_id: motor.id, paid: true, sync_wallet: true }).content).toContain('₱5,500.00');
    expect(wallet()).toBeCloseTo(before - 5500, 2);
    run('set_loan_paid', { loan_id: motor.id, paid: false, sync_wallet: true });
    expect(wallet()).toBe(before);
  });

  it('pays an upcoming installment with the on-time rebate', () => {
    const motor = JSON.parse(run('get_financial_state').content).loans.find((loan: { name: string }) => loan.name === 'Motor');
    run('set_loan_paid', { loan_id: motor.id, paid: true, sync_wallet: false }); // #1, late
    expect(JSON.parse(run('get_financial_state').content).loans.find((loan: { id: number }) => loan.id === motor.id).nextInstallment)
      .toMatchObject({ number: 2, date: '2026-11-05', amountDue: 4700 });
    const before = wallet();
    run('set_loan_paid', { loan_id: motor.id, paid: true, sync_wallet: true }); // #2, on time
    expect(wallet()).toBeCloseTo(before - 4700, 2);
  });

  it('rejects a rebate that is not less than the installment', () => {
    const result = run('add_loan', {
      name: 'Bad', loan_date: '2026-10-01', first_due_date: '2026-11-01', frequency: 'monthly',
      installment_amount: 100, total_installments: 2, rebate_amount: 100,
    });
    expect(result).toEqual({ content: 'On-time rebate must be less than the installment amount.', isError: true });
  });

  it('rejects a first due date before the loan date', () => {
    const result = run('add_loan', {
      name: 'Bad', lender: '', loan_date: '2026-10-10', first_due_date: '2026-10-01',
      frequency: 'monthly', installment_amount: 100, total_installments: 2,
    });
    expect(result).toEqual({ content: 'First due date cannot be before the loan date.', isError: true });
  });

  it('sets absences in half-day steps', () => {
    run('set_absences', { income_id: 2, period: 'next', days: 1.4 });
    expect(db.getIncomeRule(2)?.nextMonthAbsences).toBe(1.5);
  });

  it('returns tool errors instead of throwing on bad input', () => {
    expect(run('log_expense', { description: 'Gas', amount: -5 }).isError).toBe(true);
    expect(run('set_loan_paid', { loan_id: 99, paid: true, sync_wallet: false })).toEqual({ content: 'Loan not found.', isError: true });
    expect(run('set_absences', { income_id: 1, period: 'current', days: 1 }).isError).toBe(true);
    expect(run('no_such_tool').isError).toBe(true);
  });
});

describe('bills and planned expenses', () => {
  type BillState = { id: number; name: string; nextDue: unknown; overdue: unknown[]; done: boolean };
  const billNamed = (name: string): BillState => JSON.parse(run('get_financial_state').content).bills.find((bill: BillState) => bill.name === name);

  it('adds a monthly bill and flags a past due date as overdue', () => {
    const result = run('add_bill', { name: 'Rent', frequency: 'monthly', next_due_date: '2026-10-05', estimated_amount: 8000 });
    expect(result).toEqual({ content: 'Added bill #1 Rent (₱8,000.00, Monthly · 5th, next due Oct 5, 2026)', isError: false });
    expect(billNamed('Rent')).toMatchObject({
      nextDue: { dueDate: '2026-10-05', amount: 8000, isEstimate: true },
      overdue: [{ dueDate: '2026-10-05', amount: 8000 }],
      done: false,
    });
  });

  it('replaces the estimate with the billed amount for the next unpaid due date', () => {
    run('add_bill', { name: 'Meralco', frequency: 'monthly', next_due_date: '2026-10-20', estimated_amount: 2350 });
    expect(run('set_bill_amount', { bill_id: 2, amount: 2812.4 }).isError).toBe(false);
    expect(billNamed('Meralco').nextDue).toEqual({ dueDate: '2026-10-20', amount: 2812.4, isEstimate: false });
  });

  it('pays the oldest unpaid due date and undoes it, moving the wallet both ways', () => {
    const before = wallet();
    expect(run('set_bill_paid', { bill_id: 2, paid: true, sync_wallet: true }).content).toContain('₱2,812.40');
    expect(wallet()).toBeCloseTo(before - 2812.4, 2);
    expect(billNamed('Meralco').nextDue).toEqual({ dueDate: '2026-11-20', amount: 2350, isEstimate: true });
    run('set_bill_paid', { bill_id: 2, paid: false, sync_wallet: true });
    expect(wallet()).toBeCloseTo(before, 2);
    expect(billNamed('Meralco').nextDue).toMatchObject({ dueDate: '2026-10-20', amount: 2812.4 });
  });

  it('finishes a one-time expense once paid', () => {
    run('add_bill', { name: 'Aircon repair', frequency: 'one_time', next_due_date: '2026-11-12', estimated_amount: 1500 });
    run('set_bill_paid', { bill_id: 3, paid: true, sync_wallet: false });
    expect(billNamed('Aircon repair')).toMatchObject({ nextDue: null, done: true });
    expect(run('set_bill_paid', { bill_id: 3, paid: true, sync_wallet: false }).content).toBe('Aircon repair is already paid');
  });

  it('rejects amounts for dates that are not on the bill schedule, and bad frequencies', () => {
    expect(run('set_bill_amount', { bill_id: 2, amount: 100, due_date: '2026-10-21' })).toEqual({
      content: '2026-10-21 is not a due date of Meralco.',
      isError: true,
    });
    expect(run('add_bill', { name: 'X', frequency: 'weekly', next_due_date: '2026-11-01', estimated_amount: 1 }).isError).toBe(true);
  });

  it('deletes a bill', () => {
    expect(run('delete_bill', { bill_id: 3 })).toEqual({ content: 'Deleted bill Aircon repair', isError: false });
    expect(billNamed('Aircon repair')).toBeUndefined();
  });
});

describe('transcript view', () => {
  it('folds the raw API thread into chat bubbles with change chips', async () => {
    const { todaysTranscript } = await import('./transcript');
    db.appendAgentMessages(TODAY, [
      { role: 'user', content: [{ type: 'text', text: '[Today is Saturday, 2026-10-17]\n\nSpent 100 on load' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'get_financial_state', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'log_expense', input: { description: 'Load', amount: 100 } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'Logged expense #2 Load: -₱100.00' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Logged ₱100.00 load.' }] },
    ]);
    expect(todaysTranscript()).toEqual([
      { id: 'u0', role: 'user', text: 'Spent 100 on load', imageCount: 0, changes: [] },
      {
        id: 'a1',
        role: 'assistant',
        text: 'Logged ₱100.00 load.',
        imageCount: 0,
        changes: [{ text: 'Logged expense #2 Load: -₱100.00', failed: false }],
      },
    ]);
  });
});
