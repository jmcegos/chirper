'use client';

import { CheckCircle2, ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { balanceTone, flowTone, Money } from '@/components/ui/Money';
import { formatShortDate } from '@/lib/domain/calendar';
import { maxSafeLivingSpend, simulateLivingSpend, TIGHT_BALANCE } from '@/lib/domain/insights';
import type { CompletedItem, Ledger, LedgerEvent, LedgerMonth } from '@/lib/domain/ledger';
import { BalanceChart } from './BalanceChart';
import { LedgerRow } from './LedgerRow';
import { LivingSpendSimulator } from './LivingSpendSimulator';

type Filter = 'all' | 'in' | 'out';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'in', label: 'Money in' },
  { id: 'out', label: 'Money out' },
];

function matches(event: LedgerEvent, filter: Filter): boolean {
  if (filter === 'in') return event.amount > 0;
  if (filter === 'out') return event.amount < 0;
  return true;
}

function CompletedSummary({ items, title }: { items: CompletedItem[]; title: string }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  return (
    <div className="border-t border-gray-100">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 px-5 text-left text-[13px] font-medium text-emerald-800 hover:bg-gray-50"
      >
        <span className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> {title}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="space-y-1.5 px-5 pb-4 text-[13px]">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-gray-600">
                <span className="text-gray-400">{formatShortDate(item.date)}</span> {item.title}
              </span>
              {item.amount !== 0 && <Money value={item.amount} tone={flowTone(item.amount)} signed />}
            </li>
          ))}
          <li className="pt-1 text-xs text-gray-500">Already in your wallet balance, so not counted again.</li>
        </ul>
      )}
    </div>
  );
}

function MonthSection({
  month,
  filter,
  balances,
  simulated,
  collapsible,
}: {
  month: LedgerMonth;
  filter: Filter;
  balances: Map<string, number>;
  simulated: boolean;
  collapsible: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  const events = month.events.filter((event) => matches(event, filter));
  const closing = month.events.at(-1);
  const closingBalance = closing ? balances.get(closing.id) : undefined;

  return (
    <section>
      <button
        type="button"
        disabled={!collapsible}
        aria-expanded={collapsible ? open : undefined}
        onClick={() => setOpen(!open)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 px-5 pt-3 text-left enabled:hover:bg-gray-50"
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {collapsible && <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />}
          {month.label}
          {collapsible && !open && <span className="font-normal normal-case tracking-normal">· {events.length} events</span>}
        </span>
        {closingBalance !== undefined && (
          <span className="text-xs text-gray-500">
            ends at <Money value={closingBalance} tone={closingBalance < 0 ? balanceTone(closingBalance) : 'muted'} />
          </span>
        )}
      </button>
      {open && (
        <ol className="mt-1">
          {events.length === 0 && <li className="border-t border-gray-100 px-5 py-3.5 text-[13px] text-gray-500">Nothing scheduled.</li>}
          {events.map((event) => (
            <LedgerRow key={event.id} event={event} balance={balances.get(event.id) ?? event.runningBalance} simulated={simulated} />
          ))}
        </ol>
      )}
    </section>
  );
}

export function RunwayLedger({ ledger, completedTitle }: { ledger: Ledger; completedTitle: string }) {
  const [livingSpend, setLivingSpend] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const ceiling = useMemo(() => maxSafeLivingSpend(ledger), [ledger]);
  const simulation = useMemo(() => simulateLivingSpend(ledger, livingSpend), [ledger, livingSpend]);
  const balances = useMemo(() => new Map(simulation.map((row) => [row.event.id, row.simulatedBalance])), [simulation]);
  const points = useMemo(
    () => simulation.filter((row) => row.event.amount !== 0).map((row) => ({ date: row.event.date, balance: row.simulatedBalance })),
    [simulation],
  );

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pb-2 pt-5">
        <div>
          <h2 className="text-lg font-semibold">Upcoming runway</h2>
          <p className="mt-0.5 text-[13px] text-gray-500">
            Your balance after every scheduled event, {formatShortDate(ledger.startDate)} to {formatShortDate(ledger.endDate)}
          </p>
        </div>
        <div role="group" aria-label="Filter events" className="flex gap-1.5">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filter === option.id}
              className={filter === option.id ? 'chip chip-on' : 'chip'}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <div className="px-5 pb-3 pt-2">
        <BalanceChart start={ledger.startDate} end={ledger.endDate} startingBalance={ledger.startingBalance} points={points} tightLevel={TIGHT_BALANCE} />
      </div>

      <div className="px-5 pb-4">
        <LivingSpendSimulator value={livingSpend} onChange={setLivingSpend} ceiling={ceiling} />
      </div>

      <CompletedSummary items={ledger.completed} title={completedTitle} />

      <div className="pb-2">
        {ledger.months.map((month, index) => (
          <MonthSection
            key={month.key}
            month={month}
            filter={filter}
            balances={balances}
            simulated={livingSpend > 0}
            collapsible={index === ledger.months.length - 1}
          />
        ))}
      </div>
    </section>
  );
}
