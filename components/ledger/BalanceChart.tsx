import { addDays, daysBetween, formatShortDate, type IsoDate } from '@/lib/domain/calendar';
import { formatPeso } from '@/lib/domain/money';

const WIDTH = 640;
const HEIGHT = 140;
const TOP_PAD = 10;
const TICKS = 4;

export interface BalancePoint {
  date: IsoDate;
  balance: number;
}

interface BalanceChartProps {
  start: IsoDate;
  end: IsoDate;
  startingBalance: number;
  points: BalancePoint[];
  /** Dashed guide for the "tight buffer" level. */
  tightLevel: number;
}

/** Step chart of the running balance: flat between events, a jump on each one. */
export function BalanceChart({ start, end, startingBalance, points, tightLevel }: BalanceChartProps) {
  const span = Math.max(1, daysBetween(start, end));
  const balances = [startingBalance, ...points.map((point) => point.balance)];
  const low = Math.min(0, ...balances);
  const high = Math.max(tightLevel * 2, ...balances);
  const x = (date: IsoDate) => (daysBetween(start, date) / span) * WIDTH;
  const y = (value: number) => TOP_PAD + ((high - value) / (high - low)) * (HEIGHT - TOP_PAD);

  let line = `M0 ${y(startingBalance)}`;
  for (const point of points) line += ` H${x(point.date)} V${y(point.balance)}`;
  line += ` H${WIDTH}`;
  const area = `${line} V${y(low)} H0 Z`;

  const lowest = points.reduce<BalancePoint>((min, point) => (point.balance < min.balance ? point : min), { date: start, balance: startingBalance });
  const ticks = Array.from({ length: TICKS + 1 }, (_, index) => addDays(start, Math.round((span * index) / TICKS)));
  const summary = `Projected balance from ${formatPeso(startingBalance)} today to ${formatPeso(balances.at(-1) ?? startingBalance)} on ${formatShortDate(end)}, lowest ${formatPeso(lowest.balance)} on ${formatShortDate(lowest.date)}`;

  return (
    <figure className="m-0">
      <svg role="img" aria-label={summary} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="block h-[140px] w-full">
        <path d={area} className="fill-indigo-50" />
        {low < 0 && <line x1="0" x2={WIDTH} y1={y(0)} y2={y(0)} className="stroke-rose-300" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        <line x1="0" x2={WIDTH} y1={y(tightLevel)} y2={y(tightLevel)} className="stroke-amber-300" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        <path d={line} fill="none" className="stroke-indigo-600" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="flex justify-between pt-1.5 text-xs text-gray-500">
        {ticks.map((tick, index) => (
          <span key={tick}>{index === 0 ? 'Today' : formatShortDate(tick)}</span>
        ))}
      </figcaption>
    </figure>
  );
}
