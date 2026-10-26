# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Fin Tracker: a local-first, single-user Next.js 15 (App Router) + `better-sqlite3` app that projects a forward running-balance ledger (payroll cutoffs, side income, loan installments, credit-card statement vs. due dates) so cash shortfalls show up weeks ahead. There is no auth and no cloud backend. Amounts are Philippine pesos; "today" is Asia/Manila.

## Commands

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # Vitest (lib/**/*.test.ts only)
npx vitest run lib/domain/ledger.test.ts      # single file
npx vitest run -t "reads the full state"      # single test by name
npm run typecheck    # tsc --noEmit
npm run build        # production build
```

No linter is configured. The Fin Agent chat needs `ANTHROPIC_API_KEY` in `.env.local` (copy `.env.example`), and you must restart the app after adding it. The rest of the dashboard works without a key.

## Architecture

Layers, from innermost out:

- **`lib/domain/`**: pure business rules with no I/O. The client and server both import them. `ledger.ts` builds the running-balance ledger (cycle month + 2 months); `insights.ts` derives the KPIs from it. All money math goes through `money.ts`, which uses integer centavos so long chains of additions never drift. Date math in `calendar.ts` uses ISO strings with no timezone. Get "today" from `todayLocal()`, never from `new Date()`.
- **`lib/db.ts`**: the only module that touches SQLite. `finance.db` sits at `process.cwd()` in WAL mode. The schema is `CREATE TABLE IF NOT EXISTS` run on open (there is no migration system). If `settings` is empty, the module seeds from `lib/seed.ts`. That seed is deliberately empty: a ₱0 wallet whose cycle month is the current month. The connection is cached on `globalThis` so it survives dev hot reloads. `getSnapshot()` is the read model.
- **`lib/commands.ts`**: the use-case layer. **Every mutation goes through here**, whether it comes from dashboard Server Actions or agent tools, so the validation and wallet-sync rules live in one place. Each command throws `CommandError` on bad input and returns a one-line summary string.
- **`app/actions.ts`**: thin `'use server'` wrappers around commands. They call `revalidatePath('/')` after a mutation. `askAgent` is the entry point for the chat.
- **`app/page.tsx`**: a single server-rendered dashboard (`force-dynamic`). It reads the snapshot, builds the ledger and insights, and passes plain data to the components in `components/` (client components where they need interactivity).
- **`lib/agent/`**: the Claude agent. `agent.ts` runs the tool loop (model `claude-opus-5-5`, beta Messages API, `MAX_ROUNDS = 12`) and owns the system prompt. `tools.ts` defines the tools: each one parses input through `ToolInput` and calls a command. `state.ts` builds the `get_financial_state` report. The conversation for each day is stored append-only in the `agent_messages` table, keyed by `thread_date`, so a new chat starts every day. Tool results are written as soon as they exist so no tool call is left without its result.

To add a dashboard action that the agent should also be able to perform: add a command in `lib/commands.ts`, then wire it into both `app/actions.ts` and `lib/agent/tools.ts`.

## Testing notes

- `lib/agent/tools.test.ts` mocks `server-only` and pins `todayLocal()` to `2026-10-17`, and it swaps `@/lib/seed` for the sample state in `lib/fixtures/sampleData.ts`. It then `chdir`s into a temp directory *before* dynamically importing `db`, so a fresh seeded `finance.db` is created there. Follow the same pattern for any test that touches the DB, so the real `finance.db` is never used.
- Vitest resolves the `@/` alias to the repo root (see `vitest.config.ts`).

## Domain rules (from README)

- Completed items (`received_this_month` / `paid_this_month`) are shown as done and never re-applied to the starting wallet balance.
- An unpaid cycle-month item whose date has passed is rolled onto today and flagged overdue.
- Absences deduct only when entered (> 0), in 0.5-day steps, per cutoff (current and next month).
- Credit card: the statement day is a ₱0 info row; cash leaves on the next due day. The current bill is `statement_balance`, or the projected spend if that is higher and the statement hasn't cut yet. Later bills use the next-month projected spend. Paying a statement zeroes it and remembers the amount for undo.
- Received/Paid toggles take a `syncWallet` flag so a wallet the user synced by hand is never double counted.
- Loans have a loan date, first due date and frequency (`monthly` or `every_15_days`); due dates are derived in `lib/domain/loans.ts`. `amountDueOn()` applies the flat on-time rebate (paid on or before the due date) or the flat late penalty (after it, no grace period); each payment stores `amount_paid` so undo refunds exactly that. Paid installments are rows in `loan_payments` (not a count). New loans treat installments due on or before today as paid unless listed as unpaid, and never move the wallet. Old databases are migrated on open by `migrate()` in `lib/db.ts`.
- Bills (`lib/domain/bills.ts`) are date-driven like loans: `bills` holds the schedule and estimate, `bill_occurrences` is sparse (only due dates with a billed amount or payment). Ledger kind `bill`.
- Start New Month Cycle clears income received and card paid flags and moves next-month absences into the current month. It does not touch loans or bills.
- Backup writes an online copy to `./backups/`.

## Config gotchas

- `better-sqlite3` is pinned to 12.x. Version 13.x ships no prebuilt binaries and needs Python plus the Visual C++ Build Tools to compile on Windows.
- `next.config.mjs` marks `better-sqlite3` as a server external package and raises the Server Action body limit to 8 MB so screenshots can be sent to the agent.
- Modules that use the DB or the API key import `'server-only'`. Keep `lib/domain/` free of server imports, because client components use it.
