'use client';

import { CalendarDays, CalendarPlus, ChevronDown, DatabaseBackup, Loader2, MessageCircle, RotateCcw, TrendingUp } from 'lucide-react';
import { useRef, useState, useTransition, type ReactNode } from 'react';
import { backupDatabase, resetToSeed, startNewMonthCycle } from '@/app/actions';
import { openAgent } from '@/components/ui/uiEvents';

type Pending = 'cycle' | 'seed' | 'backup' | null;

interface TopBarProps {
  todayLabel: string;
  cycleLabel: string;
  nextCycleLabel: string;
}

export function TopBar({ todayLabel, cycleLabel, nextCycleLabel }: TopBarProps) {
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState<Pending>(null);
  const [message, setMessage] = useState('');
  const menuRef = useRef<HTMLDetailsElement>(null);

  const run = (kind: Exclude<Pending, null>, confirmText: string | null, task: () => Promise<string>) => {
    menuRef.current?.removeAttribute('open');
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

  const icon = (kind: Pending, Idle: typeof CalendarPlus) =>
    isPending && running === kind ? <Loader2 className="h-4 w-4 animate-spin" /> : <Idle className="h-4 w-4" />;

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-900 text-white">
            <TrendingUp className="h-[18px] w-[18px]" />
          </span>
          <div>
            <h1 className="text-base font-semibold leading-tight">Fin Tracker</h1>
            <p className="text-xs text-gray-500">{todayLabel}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <details ref={menuRef} className="relative">
            <summary className="btn-neutral cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              <CalendarDays className="h-4 w-4" />
              {cycleLabel} cycle
              <ChevronDown className="h-4 w-4 text-gray-500" />
            </summary>
            <div className="absolute right-0 z-40 mt-2 w-64 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
              <MenuItem
                disabled={isPending}
                onClick={() =>
                  run('cycle', `Start the ${nextCycleLabel} cycle? Received/paid flags reset; loans and bills stay as they are.`, async () => {
                    await startNewMonthCycle();
                    return `${nextCycleLabel} cycle started.`;
                  })
                }
              >
                {icon('cycle', CalendarPlus)} Start {nextCycleLabel}
              </MenuItem>
              <MenuItem disabled={isPending} onClick={() => run('backup', null, async () => `Saved ${await backupDatabase()}`)}>
                {icon('backup', DatabaseBackup)} Back up database
              </MenuItem>
              <div className="my-1 border-t border-gray-100" />
              <MenuItem
                danger
                disabled={isPending}
                onClick={() =>
                  run('seed', 'Wipe all data and start over with an empty ₱0 wallet?', async () => {
                    await resetToSeed();
                    return 'All data cleared.';
                  })
                }
              >
                {icon('seed', RotateCcw)} Clear all data
              </MenuItem>
            </div>
          </details>
          <button type="button" className="btn-primary" onClick={openAgent}>
            <MessageCircle className="h-4 w-4" /> Ask Fin
          </button>
        </div>
      </div>
      {message && (
        <p role="status" className="mx-auto max-w-[1320px] break-all px-4 pb-3 text-xs text-gray-500 sm:px-6">
          {message}
        </p>
      )}
    </header>
  );
}

function MenuItem({ children, onClick, disabled, danger = false }: { children: ReactNode; onClick: () => void; disabled: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-[40px] w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm disabled:opacity-50 ${
        danger ? 'text-rose-700 hover:bg-rose-50' : 'text-gray-800 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  );
}
