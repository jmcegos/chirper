import { describe, expect, it } from 'vitest';
import { compareReceivables, isPaidOff, lastPayment, outstandingTotal, paidTotal, receivableStatus, remaining } from './receivables';
import type { Receivable } from './types';

const TODAY = '2026-10-17';

function receivable(overrides: Partial<Receivable> = {}): Receivable {
  return {
    id: 1,
    person: 'Ana',
    description: '',
    amount: 1000,
    lentDate: '2026-10-01',
    promisedDate: null,
    expected: false,
    notes: '',
    payments: [],
    ...overrides,
  };
}

const payment = (id: number, amount: number, paidOn = '2026-10-10') => ({ id, amount, paidOn, walletSynced: false });

describe('receivable amounts', () => {
  it('sums partial payments in centavos', () => {
    const r = receivable({ payments: [payment(1, 333.33), payment(2, 333.33), payment(3, 333.33)] });
    expect(paidTotal(r)).toBe(999.99);
    expect(remaining(r)).toBe(0.01);
    expect(isPaidOff(r)).toBe(false);
  });

  it('never reports negative remaining', () => {
    expect(remaining(receivable({ amount: 500, payments: [payment(1, 600)] }))).toBe(0);
  });
});

describe('receivableStatus', () => {
  it('reports open, partial, paid and overdue', () => {
    expect(receivableStatus(receivable(), TODAY)).toBe('open');
    expect(receivableStatus(receivable({ payments: [payment(1, 200)] }), TODAY)).toBe('partial');
    expect(receivableStatus(receivable({ promisedDate: '2026-10-10' }), TODAY)).toBe('overdue');
    expect(receivableStatus(receivable({ promisedDate: '2026-10-17' }), TODAY)).toBe('open');
    expect(receivableStatus(receivable({ promisedDate: '2026-10-10', payments: [payment(1, 1000)] }), TODAY)).toBe('paid');
  });
});

describe('lastPayment', () => {
  it('finds the latest payment by id', () => {
    expect(lastPayment(receivable())).toBeNull();
    expect(lastPayment(receivable({ payments: [payment(4, 100), payment(9, 50), payment(2, 10)] }))?.id).toBe(9);
  });
});

describe('totals and order', () => {
  it('totals outstanding and expected amounts', () => {
    const list = [
      receivable({ id: 1, amount: 1000, payments: [payment(1, 250)] }),
      receivable({ id: 2, amount: 500, expected: true, promisedDate: '2026-10-20' }),
      receivable({ id: 3, amount: 300, expected: true, payments: [payment(2, 300)] }),
    ];
    expect(outstandingTotal(list)).toBe(1250);
    expect(outstandingTotal(list, { expectedOnly: true })).toBe(500);
  });

  it('orders overdue first, then by promised date, undated last', () => {
    const list = [
      receivable({ id: 1, promisedDate: null }),
      receivable({ id: 2, promisedDate: '2026-11-01' }),
      receivable({ id: 3, promisedDate: '2026-10-25' }),
      receivable({ id: 4, promisedDate: '2026-10-05' }),
    ];
    expect([...list].sort(compareReceivables(TODAY)).map((r) => r.id)).toEqual([4, 3, 2, 1]);
  });
});
