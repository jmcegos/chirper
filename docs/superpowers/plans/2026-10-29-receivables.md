# Receivables (Money Owed to Me) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Track people who owe the user money and record partial payments of any amount until a debt is paid off.
- Expected receivables appear on the runway as money in on their promised date.

**Architecture:**
- A pure `lib/domain/receivables.ts` holds the maths: remaining, status and totals, all in centavos.
- `lib/db.ts` gets two new tables and their reads and writes.
- `lib/commands.ts` gets five commands, wired into both `app/actions.ts` and `lib/agent/tools.ts`.
- `buildLedger` turns expected receivables into `'receivable'` inflow events.
- A new "Owed to me" tab in `ManageTabs` hosts the panel.

**Tech stack:**
- Next.js 15 App Router (server components and Server Actions)
- better-sqlite3 12
- TypeScript (strict)
- Vitest
- Tailwind
- lucide-react

**Spec:** `docs/superpowers/specs/2026-10-29-receivables-design.md`. Read it first. Wording and rules below come from it.

## Global Constraints

- **No new npm dependencies.**
- **Money:**
  - Compute in integer centavos (`toCentavos`/`toPesos`/`roundPesos` in `lib/domain/money.ts`).
  - Display with `formatPeso`.
- **Dates:**
  - ISO strings and `lib/domain/calendar.ts`.
  - "Today" is `todayLocal()`, never `new Date()` in domain code.
- **Layers:**
  - `lib/domain/*` stays pure (no `server-only`).
  - Every mutation is a command that throws `CommandError` on bad input and returns a one-line summary.
- **Schema:**
  - New tables use `CREATE TABLE IF NOT EXISTS` in `SCHEMA`.
  - Add them to `TABLES`, with `receivable_payments` before `receivables`.
- **Tests:**
  - Use `TODAY = '2026-10-17'` and the existing `todayLocal` mock.
  - DB tests `chdir` into a temp dir before importing `db` (see `lib/agent/tools.test.ts`).
- **UI:**
  - Light theme classes from `app/globals.css` (`.card`, `.btn-*`, `.field`, `.field-money`, `.chip`).
  - Wallet button wording matches `SettleToggle`: `Add ₱X to wallet` / `Record only`.

## Review Focus

1. **Centavo drift.** Three payments of ₱333.33 against ₱1,000 leave ₱0.01, not ₱0.0100000002. Task 1 test: `sums partial payments in centavos`.
2. **Overpayment.** Paying more than remaining throws and the wallet is untouched. Task 4 test: `rejects a payment above the remaining amount`.
3. **Undo symmetry.** Undo moves the wallet only if that payment raised it (`wallet_synced`). Task 4 test: `undo reverses the wallet only for a synced payment`.
4. **Runway honesty.** A receivable that isn't expected, or has no promised date, adds nothing to the ledger. Task 3 test: `ignores receivables that are not expected`.
5. **Partial shrinks inflow.** After a partial payment, the ledger inflow equals the remaining amount, not the total. Task 3 test: `shows only the remaining amount as money in`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/domain/types.ts` | `Receivable`, `ReceivablePayment` types; `receivables` on `FinanceSnapshot` |
| `lib/domain/receivables.ts` (new) | Pure rules: paid, remaining, status, last payment, totals, sort order |
| `lib/domain/receivables.test.ts` (new) | Domain tests |
| `lib/db.ts` | Tables, mapping, `getReceivable`, insert/update/delete, add/remove payment |
| `lib/domain/ledger.ts` | `'receivable'` kind, `receivableDrafts`, completed items |
| `lib/domain/ledger.test.ts` | Ledger tests |
| `lib/commands.ts` | Five receivable commands |
| `app/actions.ts` | Server Action wrappers |
| `lib/agent/tools.ts`, `state.ts`, `agent.ts` | Tools, state report, prompt line |
| `lib/agent/tools.test.ts` | Command/tool tests against a temp DB |
| `components/receivables/ReceivablePanel.tsx`, `ReceivableCard.tsx`, `ReceivableForm.tsx`, `AddReceivable.tsx`, `RecordPayment.tsx` (new) | UI |
| `components/ui/uiEvents.ts`, `components/layout/ManageTabs.tsx`, `app/page.tsx`, `components/ledger/LedgerRow.tsx` | Tab, page wiring, icon |
| `lib/fixtures/sampleData.ts`, `lib/seed.ts` | `receivables: []` in the snapshot shape |

---

## Phase 1: Domain and data

### Task 1: Types and pure rules

**Files:** `lib/domain/types.ts`, `lib/domain/receivables.ts`, `lib/domain/receivables.test.ts`

- [ ] **Step 1: Add the types**

```ts
export interface ReceivablePayment {
  id: number;            // insertion order; undo removes the highest
  amount: number;
  paidOn: IsoDate;
  walletSynced: boolean;
}

export interface Receivable {
  id: number;
  person: string;
  description: string;
  amount: number;        // total owed
  lentDate: IsoDate;
  promisedDate: IsoDate | null;
  expected: boolean;     // count on the runway
  notes: string;
  payments: ReceivablePayment[];
}
```

Add `receivables: Receivable[]` to `FinanceSnapshot`, and `receivables: []` wherever a snapshot is built: the sample fixture, and any test helper that builds one. `npm run typecheck` lists them.

- [ ] **Step 2: Write failing tests** in `lib/domain/receivables.test.ts`:
  - `sums partial payments in centavos`: ₱1,000 minus 3 × ₱333.33 leaves `remaining` = 0.01.
  - `never reports negative remaining`
  - `reports open, partial, paid and overdue`. Today is 2026-10-17. Promised 2026-10-10 and unpaid → overdue. Paid off with a past promise → paid, not overdue.
  - `finds the latest payment by id`
  - `totals outstanding and expected amounts`: skips paid-off receivables, and counts only expected ones in the expected total.
  - `orders overdue first, then by promised date, undated last`

- [ ] **Step 3: Run the tests and see them fail**: `npx vitest run lib/domain/receivables.test.ts`.

- [ ] **Step 4: Implement `lib/domain/receivables.ts`**

```ts
import type { IsoDate } from './calendar';
import { toCentavos, toPesos } from './money';
import type { Receivable, ReceivablePayment } from './types';

export type ReceivableStatus = 'open' | 'partial' | 'paid' | 'overdue';

export function paidTotal(r: Receivable): number {
  return toPesos(r.payments.reduce((sum, p) => sum + toCentavos(p.amount), 0));
}

export function remaining(r: Receivable): number {
  return toPesos(Math.max(0, toCentavos(r.amount) - toCentavos(paidTotal(r))));
}

export function isPaidOff(r: Receivable): boolean {
  return remaining(r) === 0;
}

export function receivableStatus(r: Receivable, today: IsoDate): ReceivableStatus {
  if (isPaidOff(r)) return 'paid';
  if (r.promisedDate !== null && r.promisedDate < today) return 'overdue';
  return r.payments.length > 0 ? 'partial' : 'open';
}

export function lastPayment(r: Receivable): ReceivablePayment | null {
  return r.payments.reduce<ReceivablePayment | null>((latest, p) => (latest === null || p.id > latest.id ? p : latest), null);
}

export function outstandingTotal(list: Receivable[], { expectedOnly = false } = {}): number {
  return toPesos(list.filter((r) => !expectedOnly || r.expected).reduce((sum, r) => sum + toCentavos(remaining(r)), 0));
}

/** Overdue first, then soonest promise, undated last; paid-off ones are the caller's to split out. */
export function compareReceivables(today: IsoDate) {
  return (a: Receivable, b: Receivable): number => {
    const late = Number(receivableStatus(b, today) === 'overdue') - Number(receivableStatus(a, today) === 'overdue');
    return late || (a.promisedDate ?? '9999-12-31').localeCompare(b.promisedDate ?? '9999-12-31') || a.id - b.id;
  };
}
```

- [ ] **Step 5: Run the tests and see them pass**, then run `npm run typecheck`.
- [ ] **Step 6: Commit**: `feat(receivables): domain rules for money owed to me`.

### Task 2: Database

**Files:** `lib/db.ts`

- [ ] **Step 1:** Add both `CREATE TABLE` blocks from the spec to `SCHEMA`. Add `'receivable_payments', 'receivables'` to `TABLES` before `'quick_expenses'`, so payments are cleared first.
- [ ] **Step 2:** Add `receivablePaymentsById(db, id?)`, built like `billRecordsById` with `ORDER BY id`, and `toReceivable(row, payments)`. In the mapping:
  - `promised_date` NULL → `null`;
  - `expected` and `wallet_synced` go through `bool`.
- [ ] **Step 3:** In `getSnapshot()`, add `receivables`, ordered by `COALESCE(promised_date, '9999-12-31'), id`. Add `getReceivable(id)`.
- [ ] **Step 4:** Add the writes. Each runs in a transaction with `adjustWalletWith`:
  - `export interface ReceivableInput { person; description; amount; lentDate; promisedDate: IsoDate | null; expected; notes }`
  - `insertReceivable(input, walletDelta): number`
  - `updateReceivable(id, input)`
  - `deleteReceivable(id)`. The payments go with it through `ON DELETE CASCADE`, because `foreign_keys = ON` is set at connect.
  - `addReceivablePayment(receivableId, amount, paidOn, walletSynced, walletDelta)`
  - `removeReceivablePayment(paymentId, walletDelta)`
- [ ] **Step 5:** `npm run typecheck`. Commit: `feat(receivables): store receivables and their payments`.

### Task 3: Ledger

**Files:** `lib/domain/ledger.ts`, `lib/domain/ledger.test.ts`

- [ ] **Step 1: Write failing tests** (use the existing snapshot builder in `ledger.test.ts` with `receivables: [...]`):
  - `adds an expected receivable as money in on its promised date`: amount +2,000, kind `'receivable'`, title `Ana pays back`.
  - `shows only the remaining amount as money in`: ₱2,000 with ₱500 paid → +1,500, and the detail contains `₱500.00 of ₱2,000.00 received`.
  - `ignores receivables that are not expected`: no event; this applies to `expected: false` and also to `promisedDate: null`.
  - `rolls a past promised date onto the start as overdue`
  - `drops paid-off receivables`
  - `lists cycle-month payments as completed`: notes `Partial ✓`, then `Received ✓` on the payment that pays it off.
  - `orders a receivable after income on the same day`
- [ ] **Step 2:** Run them and see them fail.
- [ ] **Step 3: Implement**
  - Extend `LedgerEventKind` with `'receivable'`, and add `receivable: 0` to `KIND_ORDER`. The sort ties break on `scheduledDate` and then input order. Put the receivable drafts after the income drafts so income comes first.
  - Add `receivableDrafts(r, cycle, end, completed)`:
    - **Completed list:** walk the payments in id order with a running centavo sum. Each payment whose `paidOn` is in the cycle month is pushed as `{ id: \`receivable-${r.id}-pay-${p.id}\`, date: p.paidOn, title: r.person, amount: +p.amount, note: <the running sum hits the total> ? 'Received ✓' : 'Partial ✓' }`.
    - **Early return:** stop there if `!r.expected || r.promisedDate === null || isPaidOff(r) || r.promisedDate > end`.
    - **Event:** otherwise push one draft as the spec describes (`detail` joins the description and the paid part with ` • `, then filters out empty parts).
  - Call it in `buildLedger` right after the income drafts.
- [ ] **Step 4:** Run the ledger tests and the full `npm test`. Fix any exhaustive `Record<LedgerEventKind, …>` maps that typecheck now flags:
  - `KIND_TAB` in `app/page.tsx`: `receivable: 'owed'`. This needs Task 7's `ManageTab`, so add `'owed'` to the type now.
  - `KIND_ICON` in `LedgerRow.tsx`: `receivable: HandCoins`.
- [ ] **Step 5: Commit**: `feat(receivables): expected receivables flow into the runway`.

## Phase 2: Commands and agent

### Task 4: Commands

**Files:** `lib/commands.ts`, `lib/agent/tools.test.ts`

- [ ] **Step 1: Write failing tests** in `tools.test.ts` (temp DB, through the tools or the commands directly, following the existing bill tests):
  - `adds a receivable and deducts the wallet when asked`. A second add without the deduction leaves the wallet unchanged.
  - `records partial payments until paid off`: ₱3,000; pay 1,000 (synced) → `₱2,000.00 left`, wallet +1,000; pay 500 (not synced); pay 1,500 → `paid off`.
  - `rejects a payment above the remaining amount`: the message contains the remaining amount, and the wallet and payments are unchanged.
  - `rejects zero, negative, future-dated and pre-lent-date payments`
  - `undo reverses the wallet only for a synced payment`
  - `rejects expected without a promised date`
  - `rejects a promised date before the lent date`
  - `rejects lowering the amount below what is already paid`
  - `deletes a receivable with its payments`
- [ ] **Step 2:** Run them and see them fail.
- [ ] **Step 3: Implement** in a new `/* ── receivables ── */` section:
  - `validReceivable(input)` uses `nonEmpty`, `pesos(…, { allowZero: false })` and `isoDate`. It throws `CommandError('A receivable you count on needs a promised date.')` and `CommandError('Promised date can't be before the lent date.')`.
  - `addReceivable(input, deductFromWallet)` has the wallet delta `-amount` when deducting. The summary reads `Added #id: {person} owes ₱X{, promised …}{ (wallet -₱X)}`.
  - `updateReceivable(id, changes)`: `found(...)`, merges with `defined(changes)`, validates, and checks that the amount is ≥ `paidTotal`.
  - `deleteReceivable(id)`
  - `recordReceivablePayment(id, amount, syncWallet, paidOn = todayLocal())`. Compare centavos to centavos for the check against `remaining`. The summary follows the spec.
  - `undoLastReceivablePayment(id)`. If there's no payment it returns `{person} has no payments to undo`. The wallet delta is `-amount` when `walletSynced`.
- [ ] **Step 4:** Run the tests and see them pass. Commit: `feat(receivables): commands for lending and partial payments`.

### Task 5: Server Actions and agent

**Files:** `app/actions.ts`, `lib/agent/tools.ts`, `lib/agent/state.ts`, `lib/agent/agent.ts`, `lib/agent/tools.test.ts`

- [ ] **Step 1:** In `app/actions.ts`, add thin wrappers that call `revalidatePath('/')`, one per command, using the same signature style as the bill actions.
- [ ] **Step 2:** Add the tools, with snake_case inputs mapped to the commands:
  - `add_receivable`: `person`, `amount`, `lent_date`, `description?`, `promised_date?`, `expected?`, `notes?`, `deduct_from_wallet`.
  - `update_receivable`: send only the fields that change.
  - `delete_receivable`: the description says "Only after the user explicitly confirms."
  - `record_receivable_payment`: `receivable_id`, `amount`, `paid_on?`, `sync_wallet`.
  - `undo_receivable_payment`
- [ ] **Step 3:** Add `receivables` and `receivableTotals` to the state report in `state.ts`, as the spec lists them, using `receivableStatus` with today.
- [ ] **Step 4:** Add the spec's prompt line to the system prompt in `agent.ts`.
- [ ] **Step 5:** Add a test, `reports receivables in the financial state`. Run `npm test` and `npm run typecheck`. Commit: `feat(agent): manage receivables from chat`.

## Phase 3: UI

### Task 6: Components

**Files:** `components/receivables/*` (new)

- [ ] **Step 1: `RecordPayment.tsx`** (client) is an inline form:
  - a `field-money` amount, defaulting to remaining, with `max` = remaining;
  - a `field` date, defaulting to today, with `max` = today and `min` = lent date;
  - the submit buttons `Add ₱{amount} to wallet` (`btn-primary`) and `Record only` (`btn-neutral`), plus a cancel `btn-icon`.
  - It uses `useTransition` and shows the `CommandError` message inline on failure, the same way `BillForm` does.
- [ ] **Step 2: `ReceivableForm.tsx`** (client) handles both add and edit. It has the fields from the spec. The `expected` checkbox is disabled, and cleared, while the promised date is empty. The helper text reads "Shows as money in on the promised date." When adding, the submit buttons are `Deduct ₱X from wallet` / `Record only`. When editing, there is a single Save button.
- [ ] **Step 3: `ReceivableCard.tsx`** contains:
  - the person, which is the title;
  - the description, muted;
  - the badges Overdue (rose), Expected (indigo) and Paid off (emerald);
  - a progress bar (`h-1.5 rounded-full bg-gray-100` with an emerald fill at `paid/amount`);
  - `₱paid of ₱total` and a bold `₱remaining left`;
  - the promised date via `relativeDay`;
  - the actions Record payment, Undo last (only when there are payments), Edit and Delete (with confirm);
  - a `<details>` "Payments (n)" list.
- [ ] **Step 4: `ReceivablePanel.tsx`** (server) uses `Panel` with:
  - title `Owed to me`;
  - subtitle `₱X outstanding · ₱Y expected`;
  - actions `<AddReceivable />`;
  - the open receivables sorted by `compareReceivables(today)`, then `<details>` "Paid off (n)";
  - the empty state "No one owes you right now."
- [ ] **Step 5:** `npm run typecheck`. Commit: `feat(ui): receivables panel and forms`.

### Task 7: Wire into the dashboard

**Files:** `components/ui/uiEvents.ts`, `components/layout/ManageTabs.tsx`, `app/page.tsx`, `components/ledger/LedgerRow.tsx`

- [ ] **Step 1:** `ManageTab` gains `'owed'`, and `TABS` gains `{ id: 'owed', label: 'Owed to me' }` after Bills. `isManageTab` accepts it, so a stored `manage-tab` value still restores.
- [ ] **Step 2:** In `page.tsx`, pass `owed: <ReceivablePanel receivables={snapshot.receivables} today={today} />`. `attentionItems` already picks up overdue `'receivable'` events through `KIND_TAB`. Check that the banner says "Review" and opens the Owed tab.
- [ ] **Step 3:** Check the tab row with 6 tabs at 390px and with the agent dock open at 1280px. It must scroll sideways, not wrap; `shrink-0` is already in place.
- [ ] **Step 4: Verify in the browser.** Stop any dev server first, because `next build` must not run while it is up. Then run `npm test`, `npm run typecheck` and `npm run build`. Start `npx next dev -p 3010` and work through this list:
  - Add "Ana · ₱3,000 · promised in 5 days · expected". The runway shows +₱3,000 on that date.
  - Record ₱1,000 with Add to wallet. The wallet goes up by 1,000, the runway inflow drops to ₱2,000, and the completed list shows Partial ✓.
  - Undo. Everything reverts.
  - Overpay. You get an inline error.
  - Pay the rest. The card moves to Paid off, and the runway event disappears.
  - Uncheck expected. The runway event disappears.
- [ ] **Step 5: Commit**: `feat(ui): owed-to-me tab on the dashboard`.

## Done when

- All tests pass, and typecheck and build are clean.
- The browser checklist in Task 7 passes at desktop and phone widths.
- Each phase is merged to `main` on its own (`--no-ff`), following the existing branches.
