import type { ReactNode } from 'react';
import { Money, type Tone } from '@/components/ui/Money';
import { daysBetween, formatMonthLabel, formatMonthShort, formatShortDate, type IsoDate } from '@/lib/domain/calendar';
import { TIGHT_BALANCE, type LiberationMilestone, type MonthlyDebtService } from '@/lib/domain/insights';
import { allEvents, type Ledger, type LedgerEvent } from '@/lib/domain/ledger';
import { formatPeso } from '@/lib/domain/money';

export function relativeDay(from: IsoDate, to: IsoDate): string {
  const days = daysBetween(from, to);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

function Stat({ label, children, detail }: { label: string; children: ReactNode; detail: string }) {
  return (
    <section className="card flex flex-col gap-1.5 px-5 py-[18px]">
      <h2 className="eyebrow">{label}</h2>
      <div className="text-[22px] font-semibold leading-tight">{children}</div>
      <p className="text-[13px] text-gray-600">{detail}</p>
    </section>
  );
}

function EventStat({ label, event, today, empty }: { label: string; event: LedgerEvent | null; today: IsoDate; empty: string }) {
  if (!event) return <Stat label={label} detail={empty}>—</Stat>;
  return (
    <Stat label={label} detail={`${event.title} · ${formatShortDate(event.date)} (${relativeDay(today, event.date)})`}>
      <Money value={event.amount} tone={event.amount > 0 ? 'inflow' : 'plain'} signed />
    </Stat>
  );
}

function lowestTone(balance: number): Tone {
  if (balance < 0) return 'danger';
  return balance < TIGHT_BALANCE ? 'warning' : 'plain';
}

interface StatCardsProps {
  ledger: Ledger;
  inflow: LedgerEvent | null;
  outflow: LedgerEvent | null;
  service: MonthlyDebtService[];
  milestones: LiberationMilestone[];
}

export function StatCards({ ledger, inflow, outflow, service, milestones }: StatCardsProps) {
  const today = ledger.startDate;
  const { date: lowDate, balance: lowBalance } = ledger.lowestPoint;
  const lowEvent = allEvents(ledger).find((event) => event.date === lowDate && event.runningBalance === lowBalance);
  const lowDetail = lowBalance < 0 ? `Short by ${formatPeso(-lowBalance)} on ${formatShortDate(lowDate)}` : lowEvent ? `${formatShortDate(lowDate)}, after ${lowEvent.title}` : 'Today';
  const [nextMonth] = service;
  const [firstPayoff] = milestones;

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
      <EventStat label="Next money in" event={inflow} today={today} empty="No income scheduled in range" />
      <EventStat label="Next payment" event={outflow} today={today} empty="Nothing due in range" />
      <Stat label="Lowest point ahead" detail={lowDetail}>
        <Money value={lowBalance} tone={lowestTone(lowBalance)} />
      </Stat>
      <Stat
        label={nextMonth ? `Loans in ${formatMonthLabel(nextMonth.month).split(' ')[0]}` : 'Loans'}
        detail={
          firstPayoff
            ? `Drops by ${formatPeso(firstPayoff.freedMonthly)}/mo from ${formatMonthShort(firstPayoff.freedFromMonth)} ${firstPayoff.freedFromMonth.year}`
            : 'No loans left to pay'
        }
      >
        <Money value={nextMonth?.total ?? 0} />
      </Stat>
    </div>
  );
}
