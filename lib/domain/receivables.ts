import type { IsoDate } from './calendar';
import { toCentavos, toPesos } from './money';
import type { Receivable, ReceivablePayment } from './types';

export type ReceivableStatus = 'open' | 'partial' | 'paid' | 'overdue';

const NO_DATE = '9999-12-31';

export function paidTotal(receivable: Receivable): number {
  return toPesos(receivable.payments.reduce((sum, payment) => sum + toCentavos(payment.amount), 0));
}

/** What is still owed; never below zero. */
export function remaining(receivable: Receivable): number {
  return toPesos(Math.max(0, toCentavos(receivable.amount) - toCentavos(paidTotal(receivable))));
}

export function isPaidOff(receivable: Receivable): boolean {
  return remaining(receivable) === 0;
}

export function receivableStatus(receivable: Receivable, today: IsoDate): ReceivableStatus {
  if (isPaidOff(receivable)) return 'paid';
  if (receivable.promisedDate !== null && receivable.promisedDate < today) return 'overdue';
  return receivable.payments.length > 0 ? 'partial' : 'open';
}

/** The most recently recorded payment, which undo removes. */
export function lastPayment(receivable: Receivable): ReceivablePayment | null {
  return receivable.payments.reduce<ReceivablePayment | null>((latest, payment) => (latest === null || payment.id > latest.id ? payment : latest), null);
}

/** Total still owed across the list; with `expectedOnly`, just what the runway counts on. */
export function outstandingTotal(receivables: Receivable[], { expectedOnly = false } = {}): number {
  return toPesos(
    receivables.filter((receivable) => !expectedOnly || receivable.expected).reduce((sum, receivable) => sum + toCentavos(remaining(receivable)), 0),
  );
}

/** Overdue first, then the soonest promise, undated last. */
export function compareReceivables(today: IsoDate) {
  return (a: Receivable, b: Receivable): number => {
    const overdueFirst = Number(receivableStatus(b, today) === 'overdue') - Number(receivableStatus(a, today) === 'overdue');
    return overdueFirst || (a.promisedDate ?? NO_DATE).localeCompare(b.promisedDate ?? NO_DATE) || a.id - b.id;
  };
}
