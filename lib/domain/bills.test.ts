import { describe, expect, it } from 'vitest';
import {
  billDueDate,
  billFrequencyLabel,
  isBillDone,
  isBillSettledThrough,
  isScheduledDate,
  lastBillPayment,
  nextUnpaidOccurrence,
  occurrencesThrough,
  overdueOccurrences,
} from './bills';
import type { Bill } from './types';

function bill(overrides: Partial<Bill> = {}): Bill {
  return { id: 1, name: 'Rent', frequency: 'monthly', nextDueDate: '2026-01-31', estimatedAmount: 1000, notes: '', records: [], ...overrides };
}

const record = (dueDate: string, fields: { actualAmount?: number; paidAmount?: number; paidAt?: number } = {}) => ({
  dueDate,
  actualAmount: fields.actualAmount ?? null,
  paidAmount: fields.paidAmount ?? null,
  paidAt: fields.paidAt ?? null,
});

describe('bill due dates', () => {
  it('keeps the day for monthly bills, clamping short months', () => {
    expect([1, 2, 3].map((n) => billDueDate(bill(), n))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('spaces every-15-days bills 15 days apart', () => {
    expect([1, 2, 3].map((n) => billDueDate(bill({ frequency: 'every_15_days', nextDueDate: '2026-10-25' }), n))).toEqual([
      '2026-10-25',
      '2026-11-09',
      '2026-11-24',
    ]);
  });

  it('repeats yearly bills on the same date, Feb 29 falling on Feb 28', () => {
    const leap = bill({ frequency: 'yearly', nextDueDate: '2028-02-29' });
    expect([1, 2, 3].map((n) => billDueDate(leap, n))).toEqual(['2028-02-29', '2029-02-28', '2030-02-28']);
  });

  it('has a single due date for one-time expenses', () => {
    const repair = bill({ frequency: 'one_time', nextDueDate: '2026-11-12' });
    expect(billDueDate(repair, 1)).toBe('2026-11-12');
    expect(billDueDate(repair, 2)).toBeNull();
  });

  it('labels the frequency', () => {
    expect(billFrequencyLabel(bill({ nextDueDate: '2026-11-05' }))).toBe('Monthly · 5th');
    expect(billFrequencyLabel(bill({ frequency: 'every_15_days' }))).toBe('Every 15 days');
    expect(billFrequencyLabel(bill({ frequency: 'yearly', nextDueDate: '2027-03-03' }))).toBe('Yearly · Mar 3');
    expect(billFrequencyLabel(bill({ frequency: 'one_time', nextDueDate: '2026-11-12' }))).toBe('One-time · Nov 12, 2026');
  });

  it('knows which dates are on the schedule', () => {
    const rent = bill({ nextDueDate: '2026-10-05' });
    expect(isScheduledDate(rent, '2026-12-05')).toBe(true);
    expect(isScheduledDate(rent, '2026-12-06')).toBe(false);
    expect(isScheduledDate(rent, '2026-09-05')).toBe(false);
  });
});

describe('bill amounts and payments', () => {
  const meralco = bill({
    name: 'Meralco',
    nextDueDate: '2026-09-20',
    estimatedAmount: 2350,
    records: [record('2026-09-20', { actualAmount: 2100, paidAmount: 2100, paidAt: 1 }), record('2026-10-20', { actualAmount: 2812.4 })],
  });

  it('uses the billed amount when known and the estimate otherwise', () => {
    expect(occurrencesThrough(meralco, '2026-11-30')).toEqual([
      { dueDate: '2026-09-20', amount: 2100, isEstimate: false, paid: true, paidAmount: 2100 },
      { dueDate: '2026-10-20', amount: 2812.4, isEstimate: false, paid: false, paidAmount: null },
      { dueDate: '2026-11-20', amount: 2350, isEstimate: true, paid: false, paidAmount: null },
    ]);
  });

  it('flags unpaid due dates before today as overdue and pays the oldest first', () => {
    expect(overdueOccurrences(meralco, '2026-10-26').map((item) => item.dueDate)).toEqual(['2026-10-20']);
    expect(nextUnpaidOccurrence(meralco)).toMatchObject({ dueDate: '2026-10-20', amount: 2812.4 });
  });

  it('finds the most recent payment for undo', () => {
    expect(lastBillPayment(meralco)).toEqual({ dueDate: '2026-09-20', paidAmount: 2100 });
    expect(lastBillPayment(bill())).toBeNull();
  });

  it('is settled through a date only when everything due by then is paid', () => {
    expect(isBillSettledThrough(meralco, '2026-09-30')).toBe(true);
    expect(isBillSettledThrough(meralco, '2026-10-31')).toBe(false);
  });

  it('finishes a one-time expense once it is paid', () => {
    const repair = bill({ frequency: 'one_time', nextDueDate: '2026-11-12' });
    expect(isBillDone(repair)).toBe(false);
    const paid = { ...repair, records: [record('2026-11-12', { paidAmount: 1000, paidAt: 1 })] };
    expect(isBillDone(paid)).toBe(true);
    expect(nextUnpaidOccurrence(paid)).toBeNull();
  });
});
