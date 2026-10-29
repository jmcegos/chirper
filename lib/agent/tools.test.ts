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

describe('receivables', () => {
  type ReceivableState = { id: number; person: string; paid: number; remaining: number; status: string; payments: unknown[] };
  const state = () => JSON.parse(run('get_financial_state').content);
  const receivableOf = (person: string): ReceivableState => state().receivables.find((r: ReceivableState) => r.person === person);
  const add = (fields: Record<string, unknown>) => run('add_receivable', { lent_date: '2026-10-01', deduct_from_wallet: false, ...fields });

  it('adds a receivable and deducts the wallet only when asked', () => {
    const before = wallet();
    expect(add({ person: 'Ana', amount: 3000, promised_date: '2026-10-30', expected: true })).toEqual({
      content: 'Added #1: Ana owes ₱3,000.00, promised Oct 30, 2026 (wallet unchanged)',
      isError: false,
    });
    expect(wallet()).toBeCloseTo(before, 2);
    expect(add({ person: 'Ben', amount: 500, deduct_from_wallet: true }).content).toContain('wallet -₱500.00');
    expect(wallet()).toBeCloseTo(before - 500, 2);
    expect(state().runway.upcoming).toContainEqual(expect.objectContaining({ date: '2026-10-30', title: 'Ana pays back', amount: 3000 }));
  });

  it('records partial payments until paid off', () => {
    const before = wallet();
    expect(run('record_receivable_payment', { receivable_id: 1, amount: 1000, sync_wallet: true }).content).toBe(
      'Ana paid ₱1,000.00 — ₱2,000.00 left (wallet +₱1,000.00)',
    );
    expect(wallet()).toBeCloseTo(before + 1000, 2);
    run('record_receivable_payment', { receivable_id: 1, amount: 500, sync_wallet: false, paid_on: '2026-10-15' });
    expect(receivableOf('Ana')).toMatchObject({ paid: 1500, remaining: 1500, status: 'partial' });
    expect(state().runway.upcoming).toContainEqual(expect.objectContaining({ title: 'Ana pays back', amount: 1500 }));
    expect(run('record_receivable_payment', { receivable_id: 1, amount: 1500, sync_wallet: false }).content).toContain('paid off');
    expect(receivableOf('Ana')).toMatchObject({ remaining: 0, status: 'paid' });
    expect(state().runway.upcoming.some((event: { title: string }) => event.title === 'Ana pays back')).toBe(false);
  });

  it('rejects a payment above the remaining amount', () => {
    const before = wallet();
    expect(run('record_receivable_payment', { receivable_id: 2, amount: 600, sync_wallet: true })).toEqual({ content: 'Ben only owes ₱500.00.', isError: true });
    expect(run('record_receivable_payment', { receivable_id: 1, amount: 1, sync_wallet: true }).content).toBe('Ana has already paid in full.');
    expect(wallet()).toBeCloseTo(before, 2);
    expect(receivableOf('Ben').payments).toHaveLength(0);
  });

  it('rejects zero, future-dated and pre-lent-date payments', () => {
    expect(run('record_receivable_payment', { receivable_id: 2, amount: 0, sync_wallet: false }).isError).toBe(true);
    expect(run('record_receivable_payment', { receivable_id: 2, amount: 100, sync_wallet: false, paid_on: '2026-10-18' }).content).toBe(
      "Payment date can't be in the future.",
    );
    expect(run('record_receivable_payment', { receivable_id: 2, amount: 100, sync_wallet: false, paid_on: '2026-09-30' }).content).toBe(
      "Payment date can't be before the lent date.",
    );
  });

  it('undo reverses the wallet only for a synced payment', () => {
    const before = wallet();
    run('record_receivable_payment', { receivable_id: 2, amount: 100, sync_wallet: false });
    run('record_receivable_payment', { receivable_id: 2, amount: 200, sync_wallet: true });
    expect(wallet()).toBeCloseTo(before + 200, 2);
    expect(run('undo_receivable_payment', { receivable_id: 2 }).content).toContain('wallet -₱200.00');
    expect(wallet()).toBeCloseTo(before, 2);
    expect(run('undo_receivable_payment', { receivable_id: 2 }).content).toContain('wallet unchanged');
    expect(wallet()).toBeCloseTo(before, 2);
    expect(run('undo_receivable_payment', { receivable_id: 2 }).content).toBe('Ben has no payments to undo');
  });

  it('validates the promise and the amount', () => {
    expect(add({ person: 'Cy', amount: 100, expected: true }).content).toBe('A receivable you count on needs a promised date.');
    expect(add({ person: 'Cy', amount: 100, promised_date: '2026-09-01' }).content).toBe("Promised date can't be before the lent date.");
    run('record_receivable_payment', { receivable_id: 2, amount: 300, sync_wallet: false });
    expect(run('update_receivable', { receivable_id: 2, amount: 250 }).content).toBe("Amount owed can't be less than the ₱300.00 already paid.");
    expect(run('update_receivable', { receivable_id: 2, amount: 400, notes: 'Lowered' }).isError).toBe(false);
    expect(receivableOf('Ben')).toMatchObject({ remaining: 100 });
  });

  it('deletes a receivable with its payments', () => {
    expect(run('delete_receivable', { receivable_id: 2 })).toEqual({ content: "Deleted Ben's receivable of ₱400.00", isError: false });
    expect(receivableOf('Ben')).toBeUndefined();
    expect(state().receivableTotals).toEqual({ outstanding: 0, expected: 0 });
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
