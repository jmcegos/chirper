import { AlertOctagon, ArrowDownLeft, ArrowUpRight, CreditCard, FileText, Landmark, Receipt } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { balanceTone, flowTone, Money } from '@/components/ui/Money';
import { formatShortDate } from '@/lib/domain/calendar';
import type { LedgerEvent, LedgerEventKind } from '@/lib/domain/ledger';
import { formatPeso } from '@/lib/domain/money';

const TIGHT_BALANCE = 1000;

const KIND_ICON: Record<LedgerEventKind, typeof Landmark> = {
  income: ArrowDownLeft,
  debt: Landmark,
  bill: Receipt,
  'card-due': CreditCard,
  'card-statement': FileText,
};

const KIND_DOT: Record<LedgerEventKind, string> = {
  income: 'border-emerald-400 text-emerald-400',
  debt: 'border-rose-400 text-rose-400',
  bill: 'border-amber-400 text-amber-400',
  'card-due': 'border-rose-400 text-rose-400',
  'card-statement': 'border-sky-400 text-sky-400',
};

function StatusBadge({ event, balance }: { event: LedgerEvent; balance: number }) {
  if (balance < 0) {
    return (
      <Badge tone="outflow" className="border-rose-400/60 font-semibold">
        <AlertOctagon className="h-3 w-3" /> CRITICAL SHORTFALL: {formatPeso(balance)}
      </Badge>
    );
  }
  if (event.kind === 'card-statement') return <Badge tone="info">Info • ₱0 outflow</Badge>;
  if (event.amount < 0 && balance < TIGHT_BALANCE) return <Badge tone="warning">Tight buffer</Badge>;
  if (event.amount < 0) return <Badge tone="inflow">Safe</Badge>;
  return null;
}

interface LedgerRowProps {
  event: LedgerEvent;
  /** Balance after this row including simulated living spend. */
  balance: number;
  simulated: boolean;
}

export function LedgerRow({ event, balance, simulated }: LedgerRowProps) {
  const Icon = event.amount > 0 ? ArrowDownLeft : event.kind === 'income' ? ArrowUpRight : KIND_ICON[event.kind];
  const shortfall = balance < 0;

  return (
    <li className="relative pl-9">
      <span className={`absolute left-0 top-3 flex h-6 w-6 items-center justify-center rounded-full border bg-slate-950 ${KIND_DOT[event.kind]}`}>
        <Icon className="h-3 w-3" />
      </span>
      <div className={`relative overflow-hidden rounded-lg border px-3 py-2.5 ${shortfall ? 'border-rose-500/60' : 'border-slate-800'}`}>
        {shortfall && <div aria-hidden className="absolute inset-0 animate-pulse bg-rose-950/60" />}
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs font-semibold text-slate-400">{formatShortDate(event.date)}</span>
              {event.overdue && <Badge tone="warning">{event.amount >= 0 ? 'Expected' : 'Overdue'} since {formatShortDate(event.scheduledDate)}</Badge>}
            </div>
            <p className="mt-0.5 text-sm font-medium text-slate-100">{event.title}</p>
            <p className="text-[11px] text-slate-500">{event.detail}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <StatusBadge event={event} balance={balance} />
              {shortfall && <Badge tone="warning">Buffer needed: {formatPeso(-balance)}</Badge>}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <Money value={event.amount} tone={flowTone(event.amount)} signed={event.amount !== 0} className="text-sm font-semibold" />
            <p className="mt-0.5 text-[11px] text-slate-500">balance</p>
            <Money value={balance} tone={balanceTone(balance)} className="text-sm font-semibold" />
            {simulated && (
              <p className="text-[10px] text-slate-600">
                w/o spend <span className="font-mono tabular-nums">{formatPeso(event.runningBalance)}</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
