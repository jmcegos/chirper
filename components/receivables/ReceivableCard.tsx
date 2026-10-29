'use client';

import { HandCoins, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { removeReceivable, undoReceivablePayment } from '@/app/actions';
import { Badge } from '@/components/ui/Badge';
import { Money } from '@/components/ui/Money';
import { daysBetween, formatShortDate, type IsoDate } from '@/lib/domain/calendar';
import { formatPeso } from '@/lib/domain/money';
import { lastPayment, paidTotal, receivableStatus, remaining } from '@/lib/domain/receivables';
import type { Receivable } from '@/lib/domain/types';
import { ReceivableForm } from './ReceivableForm';
import { RecordPayment } from './RecordPayment';

function promiseLabel(promisedDate: IsoDate | null, today: IsoDate): string {
  if (promisedDate === null) return 'No promised date';
  const days = daysBetween(today, promisedDate);
  if (days < 0) return `Promised ${formatShortDate(promisedDate)} · ${-days} day${days === -1 ? '' : 's'} late`;
  if (days === 0) return 'Promised today';
  if (days === 1) return 'Promised tomorrow';
  return `Promised ${formatShortDate(promisedDate)} · in ${days} days`;
}

export function ReceivableCard({ receivable, today }: { receivable: Receivable; today: IsoDate }) {
  const [editing, setEditing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [isBusy, startBusy] = useTransition();

  const paid = paidTotal(receivable);
  const left = remaining(receivable);
  const status = receivableStatus(receivable, today);
  const latest = lastPayment(receivable);
  const percentPaid = receivable.amount > 0 ? Math.min(100, (paid / receivable.amount) * 100) : 0;

  if (editing) {
    return (
      <li className="py-4">
        <ReceivableForm receivable={receivable} onDone={() => setEditing(false)} />
      </li>
    );
  }

  const confirmDelete = () => {
    if (window.confirm(`Delete what ${receivable.person} owes, with its payment history? This cannot be undone.`)) {
      startBusy(() => removeReceivable(receivable.id));
    }
  };

  const confirmUndo = () => {
    if (!latest) return;
    const wallet = latest.walletSynced ? ` and take ${formatPeso(latest.amount)} back out of the wallet` : '';
    if (window.confirm(`Remove the ${formatPeso(latest.amount)} payment of ${formatShortDate(latest.paidOn)}${wallet}?`)) {
      startBusy(() => undoReceivablePayment(receivable.id));
    }
  };

  return (
    <li className={`space-y-3 py-4 ${isBusy ? 'opacity-40' : ''}`}>
      <div className="flex justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{receivable.person}</p>
            {status === 'overdue' && <Badge tone="outflow">Overdue</Badge>}
            {status === 'paid' && <Badge tone="inflow">Paid off</Badge>}
            {receivable.expected && status !== 'paid' && <Badge tone="info">Expected</Badge>}
          </div>
          {receivable.description && <p className="text-[13px] text-gray-600">{receivable.description}</p>}
          {status !== 'paid' && (
            <p className={`text-[13px] ${status === 'overdue' ? 'text-rose-700' : 'text-gray-500'}`}>{promiseLabel(receivable.promisedDate, today)}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <Money value={left} className="text-sm font-semibold" />
          <p className="text-xs text-gray-500">{status === 'paid' ? 'nothing left' : 'left'}</p>
        </div>
      </div>

      <div>
        <div className="h-1.5 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={Math.round(percentPaid)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${percentPaid}%` }} />
        </div>
        <p className="mt-1 text-xs text-gray-500">
          <span className="tabular-nums">{formatPeso(paid)}</span> of <span className="tabular-nums">{formatPeso(receivable.amount)}</span> paid back
        </p>
      </div>

      {recording && <RecordPayment receivableId={receivable.id} remaining={left} lentDate={receivable.lentDate} today={today} onDone={() => setRecording(false)} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {status !== 'paid' && !recording ? (
          <button type="button" className="btn-neutral" onClick={() => setRecording(true)}>
            <HandCoins className="h-4 w-4" /> Record payment
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1.5">
          {latest && (
            <button type="button" className="btn-icon" aria-label="Undo last payment" title="Undo last payment" onClick={confirmUndo} disabled={isBusy}>
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          <button type="button" className="btn-icon" aria-label={`Edit ${receivable.person}`} onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" />
          </button>
          <button type="button" className="btn-icon hover:text-rose-700" aria-label={`Delete ${receivable.person}`} onClick={confirmDelete} disabled={isBusy}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {receivable.payments.length > 0 && (
        <details className="group text-[13px]">
          <summary className="cursor-pointer select-none text-gray-500 hover:text-gray-700">
            Payments ({receivable.payments.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {[...receivable.payments].reverse().map((payment) => (
              <li key={payment.id} className="flex justify-between gap-3 text-gray-600">
                <span>
                  {formatShortDate(payment.paidOn)}
                  {payment.walletSynced ? '' : ' · not in wallet'}
                </span>
                <span className="tabular-nums text-emerald-700">+{formatPeso(payment.amount)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {receivable.notes && <p className="text-xs text-gray-500">{receivable.notes}</p>}
    </li>
  );
}
