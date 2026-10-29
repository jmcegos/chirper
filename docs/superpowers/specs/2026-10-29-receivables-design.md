# Receivables (money owed to me): design

Date: 2026-10-29
Status: draft, decisions confirmed in chat

## Goal

Track people who owe me money and how much is left. They can pay back in parts, any amount, any time. If I'm counting on a payment, it shows up on the runway as money in on the promised date. A late payer is flagged overdue.

## Decisions (from the user)

- **Runway:** a receivable counts as money in **only when it is marked "expected"**. A doubtful one is still tracked but never inflates the balance.
- **Schedule:** one total amount, plus an optional promised date. There is no installment schedule. Each payment is any amount up to what is left.
- **Wallet:** every money action asks first, the same way income and loans do: "Add ₱X to wallet" or "Record only". This keeps a hand-synced wallet from being counted twice.

## Terms

- **Receivable:** one debt owed to me. It has a person, what the money was for, the total, and the date I lent it.
- **Payment:** one amount received against a receivable, on a date.
- **Remaining:** total − sum of payments, computed in centavos. The receivable is **paid off** when remaining is 0.

## Data

```sql
CREATE TABLE IF NOT EXISTS receivables (
  id            INTEGER PRIMARY KEY,
  person        TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',   -- what it was for
  amount        REAL    NOT NULL,              -- total owed
  lent_date     TEXT    NOT NULL,              -- ISO date the money went out
  promised_date TEXT,                          -- when they said they'd pay; NULL = no date
  expected      INTEGER NOT NULL DEFAULT 0,    -- 1 = count it on the runway
  notes         TEXT    NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS receivable_payments (
  id            INTEGER PRIMARY KEY,           -- insertion order, so undo removes the latest
  receivable_id INTEGER NOT NULL REFERENCES receivables (id) ON DELETE CASCADE,
  amount        REAL    NOT NULL,
  paid_on       TEXT    NOT NULL,              -- ISO date received
  wallet_synced INTEGER NOT NULL DEFAULT 0     -- 1 = the wallet was raised, so undo lowers it
);
```

- Both tables are new, so `CREATE TABLE IF NOT EXISTS` is enough and no migration is needed.
- Clear All Data clears both tables. `receivable_payments` is cleared before `receivables`.
- Start New Month Cycle doesn't touch either table.
- `wallet_synced` is stored per payment. Undo then reverses exactly what the payment did, without asking again.

## Rules (`lib/domain/receivables.ts`, pure)

- `paidTotal(r)` adds up the payments and `remaining(r)` is the total minus that, both in centavos. Remaining is never negative.
- `status(r, today)` is one of the following:
  - `paid`: remaining = 0.
  - `overdue`: remaining > 0 and `promisedDate < today`.
  - `partial`: some has been paid, but neither of the above applies.
  - `open`: nothing paid yet.
- `lastPayment(r)` is the payment with the highest id. Undo uses it.
- `outstandingTotal(list)` adds up remaining over the receivables that aren't paid off. `expectedTotal(list)` does the same but only for the expected ones.

## Ledger

- New event kind `'receivable'`, an inflow. Same-day order: right after income (`KIND_ORDER` 0).
- **One event per receivable** with `expected`, a `promisedDate` and remaining > 0:
  - **Amount:** +remaining. A partial payment therefore shrinks the expected inflow.
  - **Date:** the promised date. If that is before the ledger start, it moves to the start date and is flagged overdue (the existing roll-over).
  - **Dropped:** if the promised date is after the ledger end.
  - **Title:** `{person} pays back`.
  - **Detail:** `{description} • ₱paid of ₱total received`, with the second part only when something has been paid.
  - **Id:** `receivable-{id}`.
- Payments received in the cycle month go to the completed list. The note is `Received ✓` when the payment paid it off, otherwise `Partial ✓`.
- Payments never change the starting balance (the existing rule for completed items).

## Commands (`lib/commands.ts`)

| Command | Behaviour |
| --- | --- |
| `addReceivable(input, deductFromWallet)` | Validates: person is not empty, amount > 0, lent date is an ISO date, promised date (if given) is an ISO date on or after the lent date, and `expected` requires a promised date. If `deductFromWallet`, the amount is subtracted from the wallet (I just handed over cash). |
| `updateReceivable(id, changes)` | Partial update with the same checks. The amount can't go below what's already been paid. |
| `deleteReceivable(id)` | Removes it and its payments. The wallet is unchanged. |
| `recordReceivablePayment(id, amount, syncWallet, paidOn?)` | The amount must be > 0 and ≤ remaining; overpaying is rejected with the remaining amount in the message. `paidOn` defaults to today and can't be in the future or before the lent date. If synced, the wallet goes up by the amount. The summary reads, e.g., `Juan paid ₱500.00 — ₱1,500.00 left (wallet +₱500.00)` or `… — paid off`. |
| `undoLastReceivablePayment(id)` | Removes the latest payment. The wallet goes down only if that payment had `wallet_synced`. |

There is no toggle. "Paid off" is the result of payments, not a flag.

## UI

- **New tab "Owed to me"** (`ManageTab` `'owed'`), placed after Bills.
- **`ReceivablePanel`**
  - Subtitle: `₱X outstanding · ₱Y expected`.
  - Order: overdue first, then by promised date (no date last). A folded "Paid off (n)" section lists the paid-off ones at the bottom.
  - An empty state.
- **`ReceivableCard`**
  - Shows the person, the description, and badges: Overdue / Expected / Paid off.
  - A progress bar for paid vs total, with `₱paid of ₱total` and **₱remaining left**.
  - The promised date, using `relativeDay` ("in 5 days", "3 days late").
  - Buttons:
    - **Record payment** opens an inline form: the amount (prefilled with remaining, so a full payment is one tap) and a date (today). It submits with `Add ₱X to wallet` / `Record only`, matching `SettleToggle`'s wording.
    - **Undo last**, Edit and Delete (with confirm).
  - A folded payment history (date and amount).
- **`ReceivableForm`** (add/edit) fields:
  - person, description, amount, lent date (defaults to today), promised date (optional);
  - an "Count on it in my runway" checkbox, disabled until a promised date is set;
  - notes.
  - When adding, the submit offers `Deduct ₱X from wallet` / `Record only`.
- **Ledger row:** a `HandCoins` icon for `'receivable'`. Like all inflows it uses the in arrow, so the icon shows in the kind map only.
- **AttentionBanner:** overdue expected receivables appear with **Review**, which opens the `'owed'` tab. Overdue receivables that aren't expected are not banner items (they aren't on the runway); they show only as an Overdue badge in the panel.

## Agent

- Tools:
  - `add_receivable`, `update_receivable`;
  - `delete_receivable`, only after the user confirms;
  - `record_receivable_payment` (amount, optional `paid_on`, `sync_wallet`);
  - `undo_receivable_payment`.
- `get_financial_state` adds `receivables`. Each has `{ id, person, description, amount, paid, remaining, lentDate, promisedDate, expected, status }`, plus totals `{ outstanding, expected }`.
- System prompt line: "Money owed *to* the user is a receivable, not a loan. Record partial payments with `record_receivable_payment`."

## Testing

- **Domain:** remaining across several partial payments with centavo amounts (no drift), status transitions (open → partial → paid; overdue only while unpaid), and remaining never going below 0.
- **Ledger:**
  - an expected receivable is an inflow on its promised date for the remaining amount;
  - one that isn't expected (or has no date) produces no event;
  - a past promised date rolls to the start as overdue;
  - one that is paid off produces no event;
  - cycle-month payments appear in completed as Partial/Received;
  - the running balance includes the inflow.
- **Commands/tools against a temp DB:**
  - add with and without a wallet deduction;
  - two partial payments, then a third that pays it off;
  - an overpayment is rejected;
  - undo restores the wallet only when the payment had synced it;
  - lowering the amount below what's paid is rejected;
  - `expected` without a date is rejected;
  - delete cascades to the payments.

## Out of scope

- Interest
- Installment schedules
- Reminders or messages to the person
- Write-off / forgive. For now, delete the receivable or lower its amount to what's been paid.
- Grouping by person across several receivables
- Attachments (receipts)
