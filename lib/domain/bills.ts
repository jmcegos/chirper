import { addDays, addMonthsKeepingDay, dayOf, formatLongDate, formatShortDate, ordinal, type IsoDate } from './calendar';
import type { Bill, BillFrequency, BillRecord } from './types';

export const BILL_FREQUENCIES: readonly BillFrequency[] = ['monthly', 'every_15_days', 'yearly', 'one_time'];

const FIFTEEN_DAYS = 15;
const MONTHS_PER_YEAR = 12;

type BillSchedule = Pick<Bill, 'frequency' | 'nextDueDate'>;

/** Due date `n` (1-based) counted from the next due date, or null past a one-time expense's only date. */
export function billDueDate(bill: BillSchedule, n: number): IsoDate | null {
  switch (bill.frequency) {
    case 'one_time':
      return n === 1 ? bill.nextDueDate : null;
    case 'every_15_days':
      return addDays(bill.nextDueDate, FIFTEEN_DAYS * (n - 1));
    case 'yearly':
      return addMonthsKeepingDay(bill.nextDueDate, MONTHS_PER_YEAR * (n - 1));
    case 'monthly':
      return addMonthsKeepingDay(bill.nextDueDate, n - 1);
  }
}

export function billFrequencyLabel(bill: BillSchedule): string {
  switch (bill.frequency) {
    case 'one_time':
      return `One-time · ${formatLongDate(bill.nextDueDate)}`;
    case 'every_15_days':
      return 'Every 15 days';
    case 'yearly':
      return `Yearly · ${formatShortDate(bill.nextDueDate)}`;
    case 'monthly':
      return `Monthly · ${ordinal(dayOf(bill.nextDueDate))}`;
  }
}

/** Every scheduled due date on or before `end`, in order. */
function dueDatesThrough(bill: BillSchedule, end: IsoDate): IsoDate[] {
  const dates: IsoDate[] = [];
  for (let n = 1; ; n++) {
    const date = billDueDate(bill, n);
    if (date === null || date > end) return dates;
    dates.push(date);
  }
}

export function isScheduledDate(bill: BillSchedule, date: IsoDate): boolean {
  return dueDatesThrough(bill, date).includes(date);
}

export interface BillOccurrence {
  dueDate: IsoDate;
  /** The billed amount when recorded, otherwise the estimate. */
  amount: number;
  isEstimate: boolean;
  paid: boolean;
  paidAmount: number | null;
}

function occurrenceOn(bill: Bill, dueDate: IsoDate, records: Map<IsoDate, BillRecord>): BillOccurrence {
  const record = records.get(dueDate);
  const actual = record?.actualAmount ?? null;
  const paidAmount = record?.paidAmount ?? null;
  return { dueDate, amount: actual ?? bill.estimatedAmount, isEstimate: actual === null, paid: paidAmount !== null, paidAmount };
}

export function occurrencesThrough(bill: Bill, end: IsoDate): BillOccurrence[] {
  const records = new Map(bill.records.map((record) => [record.dueDate, record]));
  return dueDatesThrough(bill, end).map((dueDate) => occurrenceOn(bill, dueDate, records));
}

/** The occurrence a payment goes to: the oldest unpaid one (null once a one-time expense is paid). */
export function nextUnpaidOccurrence(bill: Bill): BillOccurrence | null {
  const records = new Map(bill.records.map((record) => [record.dueDate, record]));
  // Only recorded dates can be paid, so the first unpaid one is within the first records + 1 due dates.
  for (let n = 1; n <= bill.records.length + 1; n++) {
    const date = billDueDate(bill, n);
    if (date === null) return null;
    const occurrence = occurrenceOn(bill, date, records);
    if (!occurrence.paid) return occurrence;
  }
  return null;
}

/** Unpaid due dates before `today`. */
export function overdueOccurrences(bill: Bill, today: IsoDate): BillOccurrence[] {
  return occurrencesThrough(bill, addDays(today, -1)).filter((occurrence) => !occurrence.paid);
}

export function isBillSettledThrough(bill: Bill, date: IsoDate): boolean {
  return occurrencesThrough(bill, date).every((occurrence) => occurrence.paid);
}

export function isBillDone(bill: Bill): boolean {
  return bill.frequency === 'one_time' && nextUnpaidOccurrence(bill) === null;
}

/** The most recent payment, for undo. */
export function lastBillPayment(bill: Bill): { dueDate: IsoDate; paidAmount: number } | null {
  const paid = bill.records.filter((record) => record.paidAmount !== null && record.paidAt !== null);
  if (paid.length === 0) return null;
  const last = paid.reduce((latest, record) => ((record.paidAt ?? 0) > (latest.paidAt ?? 0) ? record : latest));
  return { dueDate: last.dueDate, paidAmount: last.paidAmount ?? 0 };
}
