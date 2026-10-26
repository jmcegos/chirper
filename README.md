# Fin Tracker — Local Cash Flow & Debt Runway Engine

Forward-looking, chronological running-balance ledger: payroll cutoffs (with absence math), side income, loan installments, and credit-card statement vs. due dates. Shows the wallet balance after every event so a mid-month shortfall is visible weeks ahead.

Local-first: Next.js (App Router) + `better-sqlite3`. No auth, no cloud.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
```

`finance.db` (WAL mode) is created at the project root on first run, starting empty: a ₱0 wallet whose cycle month is the current month. Add incomes, loans and cards from the dashboard or the chat.

## Fin Agent (talk instead of clicking)

The chat dock (right sidebar on wide screens) is a Claude agent with a tool for every dashboard action. Tell it what happened ("got my 25th payroll, MariBank is now 14,599.65", "paid GLoan", "spent 250 on lunch"), paste or drop a bank/loan screenshot, or dictate with the mic. It updates the data and replies with the new wallet and lowest upcoming balance.

Setup (once):

```bash
cp .env.example .env.local   # then paste your key from Console → API keys
```

Restart the app after adding the key. Usage is billed to your Claude Console credits (model `claude-opus-5-5`). Today's conversation is stored in `finance.db`; a new chat starts each day.

| Script | Purpose |
| --- | --- |
| `npm test` | Ledger arithmetic + agent tool tests (Vitest) |
| `npm run typecheck` | TypeScript |
| `npm run build` | Production build |

## Layout

```
lib/domain/   Pure business rules (no I/O) — shared by server and client
  calendar.ts     Timezone-free ISO date math (Asia/Manila "today")
  money.ts        Integer-centavo arithmetic, ₱ formatting (en-PH)
  payroll.ts      Net pay = gross − fixed deductions − absences × rate
  loans.ts        Installment schedule, remaining balance, payoff dates
  creditCard.ts   Statement day (₱0 info) vs. due day (cash out)
  ledger.ts       Running-balance engine (cycle month + 2 months)
  insights.ts     KPIs: safe daily spend, debt service, liberation, spend ceiling
lib/commands.ts Use cases shared by the dashboard and the agent (validation + summaries)
lib/agent/    Claude agent: system prompt + tool loop, tools, state report, transcript view
lib/db.ts     SQLite schema, seed-on-empty, parameterized queries
lib/seed.ts   Empty starting state (₱0 wallet, current month)
lib/fixtures/ Oct 17, 2026 sample state used by tests
app/actions.ts  Server Actions (all mutations → revalidatePath('/'))
app/page.tsx    Dashboard (server component)
components/     KPI cards, panels, ledger (client components where interactive)
```

## Rules

- **Completed items** (`received_this_month` / `paid_this_month`) are listed as done and never re-applied to the starting wallet balance.
- **Overdue items**: an unpaid cycle-month item whose date has passed is rolled onto today and flagged.
- **Absences** deduct only when entered (> 0), in 0.5-day steps, per cutoff (current and next month).
- **Credit card**: the statement day is an info row; cash leaves on the next due day. The current bill is `statement_balance` (or the projected spend if higher and the statement hasn't cut yet). Later bills use *Next month projected spend*. Paying a statement zeroes it and remembers the amount for undo.
- **Received/Paid toggles** ask whether to move the wallet balance too, so a manually synced wallet is never double counted.
- **Loans** have a loan date, a first due date and a frequency (monthly or every 15 days); every due date is derived from those. An optional **on-time rebate** (flat ₱) comes off an installment paid on or before its due date; an optional **late penalty** (flat ₱, once) is added after it. No grace period. Upcoming installments are projected with the rebate, overdue ones with the penalty. Paid installments are tracked one by one in `loan_payments`. When a loan is added, installments due on or before today count as paid unless unticked; unpaid past ones show as overdue. Adding a loan never moves the wallet. The Paid button pays the oldest unpaid installment; undo removes the latest payment.
- **Bills & planned expenses** repeat monthly, every 15 days, yearly, or once. Each due date is an outflow at its billed amount (set when the bill arrives) or the estimate; nothing before the next due date is tracked; unpaid past ones are overdue. Pay settles the oldest unpaid due date.
- **Start New Month Cycle** clears income received and card paid flags and moves next-month absences into the current month. Loans are date-driven and untouched.
- **Backup Database** writes an online copy to `./backups/`.
