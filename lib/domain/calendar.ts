/**
 * Timezone-free calendar arithmetic. Every date is an ISO `YYYY-MM-DD`
 * string so comparisons are plain string comparisons.
 */
export type IsoDate = string;

export interface YearMonth {
  year: number;
  month: number; // 1-12
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MS_PER_DAY = 86_400_000;
const LOCAL_TIMEZONE = 'Asia/Manila';

const pad2 = (n: number) => String(n).padStart(2, '0');

export function daysInMonth({ year, month }: YearMonth): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Clamps the day so a "31st" rule lands on Feb 28/29, Apr 30, etc. */
export function dateOf(ym: YearMonth, day: number): IsoDate {
  const clamped = Math.min(Math.max(1, day), daysInMonth(ym));
  return `${ym.year}-${pad2(ym.month)}-${pad2(clamped)}`;
}

export function firstDayOf(ym: YearMonth): IsoDate {
  return dateOf(ym, 1);
}

export function lastDayOf(ym: YearMonth): IsoDate {
  return dateOf(ym, daysInMonth(ym));
}

export function addMonths({ year, month }: YearMonth, count: number): YearMonth {
  const index = year * 12 + (month - 1) + count;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function yearMonthOf(date: IsoDate): YearMonth {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

export function dayOf(date: IsoDate): number {
  return Number(date.slice(8, 10));
}

export function yearMonthKey({ year, month }: YearMonth): string {
  return `${year}-${pad2(month)}`;
}

export function parseYearMonthKey(key: string): YearMonth {
  const [year, month] = key.split('-').map(Number);
  return { year, month };
}

export function isSameYearMonth(a: YearMonth, b: YearMonth): boolean {
  return a.year === b.year && a.month === b.month;
}

function toUtcMillis(date: IsoDate): number {
  const ym = yearMonthOf(date);
  return Date.UTC(ym.year, ym.month - 1, dayOf(date));
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMillis(to) - toUtcMillis(from)) / MS_PER_DAY);
}

/** Moves a date by whole months, keeping its day (clamped in short months: Jan 31 + 1 → Feb 28). */
export function addMonthsKeepingDay(date: IsoDate, count: number): IsoDate {
  return dateOf(addMonths(yearMonthOf(date), count), dayOf(date));
}

export function addDays(date: IsoDate, count: number): IsoDate {
  const shifted = new Date(toUtcMillis(date) + count * MS_PER_DAY);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** A real calendar date in `YYYY-MM-DD` form (rejects 2026-02-30). */
export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value;
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a > b ? a : b;
}

/** First date strictly after `after` whose day-of-month is `day` (clamped). */
export function nextOccurrenceAfter(after: IsoDate, day: number): IsoDate {
  const ym = yearMonthOf(after);
  const sameMonth = dateOf(ym, day);
  return sameMonth > after ? sameMonth : dateOf(addMonths(ym, 1), day);
}

export function todayLocal(now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LOCAL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** "Oct 17" */
export function formatShortDate(date: IsoDate): string {
  return `${MONTH_SHORT[yearMonthOf(date).month - 1]} ${dayOf(date)}`;
}

/** "Oct 17, 2026" */
export function formatLongDate(date: IsoDate): string {
  return `${formatShortDate(date)}, ${yearMonthOf(date).year}`;
}

/** "October 2026" */
export function formatMonthLabel(ym: YearMonth): string {
  return `${MONTH_LONG[ym.month - 1]} ${ym.year}`;
}

/** "Oct" */
export function formatMonthShort(ym: YearMonth): string {
  return MONTH_SHORT[ym.month - 1];
}

/** 1 → "1st", 22 → "22nd" */
export function ordinal(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
  return `${day}${suffix}`;
}
