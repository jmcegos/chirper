# Bills and planned expenses: design

Date: 2026-10-26
Status: approved in chat

## Goal

Track bills that aren't loans (rent, utilities, subscriptions) and planned one-off costs. Each due date is a ledger outflow that lowers the projected balance. Unpaid past ones are overdue. Paying works like it does for loans.

## Decisions (from the user)

- Frequencies: monthly, every 15 days, yearly, one-time.
- Amounts: an **estimate** for future due dates. When the bill arrives, the **actual** amount for that date replaces the estimate.

## Data

```sql
CREATE TABLE IF NOT EXISTS bills (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  frequency        TEXT NOT NULL,           -- monthly | every_15_days | yearly | one_time
  next_due_date    TEXT NOT NULL,           -- first due date tracked; earlier dates are ignored
  estimated_amount REAL NOT NULL,
  notes            TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS bill_occurrences (  -- sparse: only due dates with something recorded
  bill_id       INTEGER NOT NULL REFERENCES bills (id) ON DELETE CASCADE,
  due_date      TEXT NOT NULL,
  actual_amount REAL,                        -- the billed amount, when known
  paid_amount   REAL,                        -- set when paid; NULL = unpaid
  paid_at       INTEGER,                     -- insertion order for undo
  PRIMARY KEY (bill_id, due_date)
);
```

Both tables are created by `CREATE TABLE IF NOT EXISTS`, so existing databases need no column migration. Clear All Data clears both.

## Rules (`lib/domain/bills.ts`, pure)

- Due date *n* (1-based) from `nextDueDate`:
  - **monthly:** the same day, *n − 1* months later, clamped in short months;
  - **every_15_days:** + 15 × (*n − 1*) days;
  - **yearly:** + 12 × (*n − 1*) months with the same clamping, so Feb 29 → Feb 28;
  - **one_time:** only *n* = 1.
- `occurrencesThrough(bill, end)` lists the due dates ≤ `end`, each with:
  - `amount` (actual ?? estimate) and `isEstimate`;
  - `paid` and `paidAmount`.
- Overdue: unpaid with date < today. The next payment goes to the oldest unpaid occurrence.
- A one-time bill is done once its occurrence is paid.

## Ledger

- New event kind `'bill'`, an outflow ordered with loans on the same day.
- Unpaid occurrences up to the ledger end become events. Those before the ledger start move to the start date as overdue (the existing roll-over).
- Event detail: `Est. ₱X` or `Billed`, plus notes.
- Paid occurrences due in the cycle month go to the completed list as "Paid ✓" at the paid amount.

## Commands

- `addBill` / `updateBill`: validate name, frequency, ISO date and an estimate > 0. Changing the next due date or frequency drops recorded occurrences that are no longer on the schedule.
- `deleteBill`.
- `setBillAmount(billId, dueDate?, amount)`: `dueDate` defaults to the oldest unpaid occurrence, and must be one of the bill's due dates.
- `payNextBill(billId, sync)`: pays the oldest unpaid occurrence at its amount and records `paid_amount`; the wallet moves if synced.
- `undoLastBillPayment(billId, sync)`: refunds `paid_amount` if synced.
- `setBillPaid(billId, paid, sync)` and `toggleBillPaid` mirror the loan commands. A bill is "settled" when everything due through the end of the cycle month is paid.

## UI

- **`BillPanel`** sits beside `LoanPanel`, with a total due this cycle month. Each `BillCard` shows:
  - the frequency badge and an overdue badge;
  - the next due date and its amount (est./billed);
  - a "Set amount" inline edit for the next unpaid occurrence;
  - a Pay/Undo toggle, Edit and Delete.
- **`BillForm`** fields: name, frequency, next due date, estimated amount, notes.

## Agent

- Tools: `add_bill`, `update_bill`, `delete_bill` (only after confirmation), `set_bill_amount` and `set_bill_paid`.
- The state report lists bills with `nextDue` `{ date, amount, isEstimate }` and `overdue`.

## Testing

- Domain: dates for all four frequencies (month-end, Feb 29, one-time), actual versus estimated amounts, overdue, and one-time completion.
- Ledger: bill events, overdue roll-over, and completed items.
- Agent tools against a temp DB: add, set amount, pay/undo with the wallet, one-time done, and validation errors.

## Out of scope

Reminders and notifications, categories and reports, subscription end dates, and partial payments.
