'use client';

import { CalendarPlus, DatabaseBackup, Loader2, RotateCcw, Settings2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { backupDatabase, resetToSeed, startNewMonthCycle } from '@/app/actions';
import { KpiCard } from './KpiCard';

type Pending = 'cycle' | 'seed' | 'backup' | null;

export function CycleControlsCard({ cycleLabel, nextCycleLabel }: { cycleLabel: string; nextCycleLabel: string }) {
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState<Pending>(null);
  const [message, setMessage] = useState('');

  const run = (kind: Exclude<Pending, null>, confirmText: string | null, task: () => Promise<string>) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setRunning(kind);
    startTransition(async () => {
      try {
        setMessage(await task());
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setRunning(null);
      }
    });
  };

  const spinner = (kind: Pending) => isPending && running === kind;

  return (
    <KpiCard label="Cycle & Backup Controls" icon={Settings2}>
      <p className="text-sm text-slate-300">
        Active cycle: <span className="font-semibold text-slate-100">{cycleLabel}</span>
      </p>
      <div className="mt-3 grid gap-2">
        <button
          type="button"
          disabled={isPending}
          className="btn-primary justify-start"
          onClick={() =>
            run('cycle', `Start the ${nextCycleLabel} cycle? Received/paid flags reset; installment counts stay.`, async () => {
              await startNewMonthCycle();
              return `${nextCycleLabel} cycle started.`;
            })
          }
        >
          {spinner('cycle') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5" />}
          Start New Month Cycle
        </button>
        <button
          type="button"
          disabled={isPending}
          className="btn-neutral justify-start"
          onClick={() =>
            run('backup', null, async () => `Saved ${await backupDatabase()}`)
          }
        >
          {spinner('backup') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DatabaseBackup className="h-3.5 w-3.5" />}
          Backup Database
        </button>
        <button
          type="button"
          disabled={isPending}
          className="btn-danger justify-start"
          onClick={() =>
            run('seed', 'Wipe all data and start over with an empty ₱0 wallet?', async () => {
              await resetToSeed();
              return 'All data cleared.';
            })
          }
        >
          {spinner('seed') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          Clear All Data
        </button>
      </div>
      {message && <p className="mt-2 break-all text-[11px] text-slate-400">{message}</p>}
    </KpiCard>
  );
}
