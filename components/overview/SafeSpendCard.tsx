import { formatShortDate } from '@/lib/domain/calendar';
import type { SafeSpend } from '@/lib/domain/insights';
import { formatPeso, roundPesos } from '@/lib/domain/money';

/** The headline number: how much can go out each day until the next payroll without missing a payment. */
export function SafeSpendCard({ safeSpend, walletBalance }: { safeSpend: SafeSpend; walletBalance: number }) {
  const reserved = safeSpend.obligationsBeforePayday;
  const free = roundPesos(walletBalance - reserved);
  const paydayLabel = safeSpend.payday ? formatShortDate(safeSpend.payday.date) : 'next payday';
  const total = Math.max(walletBalance, reserved, 1);
  const reservedPct = Math.min(100, (reserved / total) * 100);
  const days = `${safeSpend.daysUntilPayday} day${safeSpend.daysUntilPayday === 1 ? '' : 's'}`;

  return (
    <section className="card flex h-full flex-col gap-5 p-6">
      <h2 className="eyebrow">Safe to spend</h2>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-5xl font-bold leading-none tracking-tight">{formatPeso(safeSpend.dailySafeSpend)}</span>
        <span className="text-base text-gray-600">per day until payday ({paydayLabel})</span>
      </div>

      {free < 0 ? (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Your wallet is <strong className="font-semibold">{formatPeso(-free)}</strong> short of the {formatPeso(reserved)} due before {paydayLabel}.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex h-2 overflow-hidden rounded-full bg-indigo-100" aria-hidden>
            <div className="bg-gray-900" style={{ width: `${reservedPct}%` }} />
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-[13px] text-gray-600">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-gray-900" />
              {reserved > 0 ? `${formatPeso(reserved)} set aside for payments before ${paydayLabel}` : `Nothing due before ${paydayLabel}`}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-indigo-200" />
              {formatPeso(free)} free for {days}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
