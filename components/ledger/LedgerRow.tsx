import { ArrowDownLeft, ArrowUpRight, CreditCard, FileText, HandCoins, Landmark, Receipt } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { balanceTone, flowTone, Money } from '@/components/ui/Money';
import { dayOf, formatMonthShort, formatShortDate, yearMonthOf } from '@/lib/domain/calendar';
import { TIGHT_BALANCE } from '@/lib/domain/insights';
import type { LedgerEvent, LedgerEventKind } from '@/lib/domain/ledger';
import { formatPeso } from '@/lib/domain/money';

const KIND_ICON: Record<LedgerEventKind, typeof Landmark> = {
  income: ArrowDownLeft,
  receivable: HandCoins,
  debt: Landmark,
  bill: Receipt,
  'card-due': CreditCard,
  'card-statement': FileText,
};

const KIND_STYLE: Record<LedgerEventKind, string> = {
  income: 'bg-emerald-50 text-emerald-700',
  receivable: 'bg-emerald-50 text-emerald-700',
  debt: 'bg-gray-100 text-gray-700',
  bill: 'bg-gray-100 text-gray-700',
  'card-due': 'bg-gray-100 text-gray-700',
  'card-statement': 'bg-indigo-50 text-indigo-700',
};

function StatusBadge({ event, balance }: { event: LedgerEvent; balance: number }) {
  if (balance < 0) return <Badge tone="outflow">Short by {formatPeso(-balance)}</Badge>;
  if (event.overdue) return <Badge tone="warning">{event.amount >= 0 ? 'Expected' : 'Overdue'} since {formatShortDate(event.scheduledDate)}</Badge>;
  if (event.amount < 0 && balance < TIGHT_BALANCE) return <Badge tone="warning">Tight buffer</Badge>;
  return null;
}

interface LedgerRowProps {
  event: LedgerEvent;
  /** Balance after this row including simulated living spend. */
  balance: number;
  simulated: boolean;
}

export function LedgerRow({ event, balance, simulated }: LedgerRowProps) {
  const Icon = event.kind === 'receivable' ? HandCoins : event.amount > 0 ? ArrowDownLeft : event.kind === 'income' ? ArrowUpRight : KIND_ICON[event.kind];
  const shortfall = balance < 0;
  const tight = !shortfall && balance < TIGHT_BALANCE;

  return (
    <li className={`flex items-center gap-3.5 border-t border-gray-100 px-5 py-3.5 ${shortfall ? 'bg-rose-50/60' : 'hover:bg-gray-50/70'}`}>
      <div className="w-10 shrink-0 text-center">
        <div className="text-[11px] font-semibold uppercase text-gray-500">{formatMonthShort(yearMonthOf(event.date))}</div>
        <div className="text-xl font-semibold leading-tight">{dayOf(event.date)}</div>
      </div>
      <span className={`hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg sm:flex ${KIND_STYLE[event.kind]}`}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{event.title}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-gray-500">
          <span>{event.kind === 'card-statement' ? 'Statement cuts · no cash moves' : event.detail}</span>
          <StatusBadge event={event} balance={balance} />
        </div>
      </div>
      <div className="shrink-0 text-right">
        {event.amount === 0 ? (
          <span className="text-sm text-gray-400">—</span>
        ) : (
          <Money value={event.amount} tone={flowTone(event.amount)} signed className="text-sm font-semibold" />
        )}
        <div className="text-[13px]">
          <Money value={balance} tone={shortfall ? balanceTone(balance) : tight ? 'warning' : 'muted'} />
        </div>
        {simulated && <p className="text-[11px] text-gray-400">w/o spend {formatPeso(event.runningBalance)}</p>}
      </div>
    </li>
  );
}
