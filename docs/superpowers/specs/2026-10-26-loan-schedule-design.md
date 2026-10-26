# Loan dates, 15-day loans and past-due installments: design

Date: 2026-10-26
Status: approved in chat, awaiting written-spec review

## Goal

When a loan is added, the user gives its loan date, its first due date and how often it is paid (monthly or every 15 days). The app derives every due date from those. Installments whose due date has already passed are paid by default. The user can untick any past installment they have not paid, and it then shows as overdue.

## Decisions (from the user)

- "15 days" means **every 15 days from the first due date** (Oct 18, Nov 2, Nov 17…), not twice a month on fixed days.
- The user **enters the first due date**. Later due dates follow the frequency from it.
- Past installments are **paid by default**. Unticking one makes it unpaid, and it shows as overdue.
- Adding or editing a loan **never moves the wallet**. Past payments are assumed to be in the wallet balance already.

## Today's model and why it changes

`debt_schedules` stores `due_day`, `paid_installments` (a count) and `paid_this_month`. All dates are computed relative to the cycle month (`lib/domain/loans.ts` → `scheduledInstallments`). That model can't express:

- a start date,
- a 15-day cadence (more than one installment a month, on drifting days), or
- "#2 unpaid but #3 paid" (a count can only say how many).

## 1. Data

### `debt_schedules`: new columns

| column | type | meaning |
| --- | --- | --- |
| `loan_date` | TEXT (ISO date) | When the loan was taken. Informational, shown on the card. |
| `first_due_date` | TEXT (ISO date) | Due date of installment #1. |
| `frequency` | TEXT | `'monthly'` or `'every_15_days'`. |

- `due_day` stays in the table (NOT NULL), so old databases keep working. On every write it is set to the day of `first_due_date`. Nothing reads it any more.
- `paid_installments` and `paid_this_month` also stay but are no longer read or written.
- `monthly_amount` keeps its column name, but it now means "amount per installment".

### New table `loan_payments`

```sql
CREATE TABLE IF NOT EXISTS loan_payments (
  debt_id            INTEGER NOT NULL REFERENCES debt_schedules(id) ON DELETE CASCADE,
  installment_number INTEGER NOT NULL,
  paid_at            INTEGER NOT NULL,   -- insertion order, used by "undo last payment"
  PRIMARY KEY (debt_id, installment_number)
);
```

A row means that installment is paid. `paid_at` is a monotonically increasing counter, taken from `MAX(paid_at) + 1`, so undo removes the most recent payment.

### Migration (in `lib/db.ts`, run on open)

The app has no migration system. Add a small `migrate(db)` step after `db.exec(SCHEMA)`:

1. For each new column missing from `PRAGMA table_info(debt_schedules)`, run `ALTER TABLE … ADD COLUMN`. `loan_date` and `first_due_date` are nullable here; `frequency` defaults to `'monthly'`.
2. Convert every row where `first_due_date IS NULL` (an old-style loan) using its old fields:
   - The month of installment #1 is `cycle − (paid_this_month ? paid − 1 : paid)` months. With `paid = 0` and `paid_this_month = 1` ("no installment due this month"), this gives the next month, which is correct.
   - `first_due_date` = that month on `due_day` (clamped to the end of the month). `loan_date` = one month earlier.
   - Insert `loan_payments` rows for installments 1…`paid_installments`.

### Domain type

```ts
type LoanFrequency = 'monthly' | 'every_15_days';

interface DebtSchedule {
  id; name; lender; notes;
  loanDate: IsoDate;
  firstDueDate: IsoDate;
  frequency: LoanFrequency;
  installmentAmount: number;          // renamed from monthlyAmount
  totalInstallments: number;
  paidInstallmentNumbers: number[];   // sorted ascending
}
```

`dueDay`, `paidInstallments` and `paidThisMonth` are removed from the type. The paid count is `paidInstallmentNumbers.length`.

## 2. Schedule rules (`lib/domain/loans.ts`, pure)

- `dueDateOf(debt, n)`:
  - **monthly:** the day of `firstDueDate`, `n − 1` months later. If the month is shorter, use its last day (Jan 31 → Feb 28 → Mar 31, so the original day is kept, not drifted).
  - **every_15_days:** `firstDueDate + 15 × (n − 1)` days.
- `installments(debt)`: every installment 1…total, as `{ number, date, paid }`.
- `unpaidInstallments(debt)` returns the unpaid ones in order. `overdueInstallments(debt, today)` returns the unpaid ones with `date < today`.
- `remainingBalance` = unpaid count × amount. `isFullyPaid` = no unpaid installments left.
- `payoffOf(debt)`: the final payment date is the due date of the last unpaid installment. `freedFromMonth` is the month after that date. It no longer needs the cycle month.
- `pastInstallments(input, today)`: the installments due on or before today, for a draft loan that isn't saved yet. The form uses it for its checklist, and the commands use it for the default-paid rule.

`lib/domain/calendar.ts` gains `addDays(date, n)`, plus a month-add that keeps the original day and clamps it to the month's end (the existing `dateOf` already clamps).

## 3. Ledger and insights

`debtDrafts` in `lib/domain/ledger.ts` is rewritten to work from dates:

- **Unpaid installment due before the ledger start:** an event with `scheduledDate` = its due date. The existing roll-over moves it to the start date and flags it overdue. This now applies to any past month, not only the cycle month.
- **Unpaid installment due inside the window** (start date … end of cycle month + 2): a normal event on its due date. Its title is `Name (n/total)`, and the last installment's detail says "FINAL installment".
- **Paid installment due inside the cycle month:** a completed item, `n/total Paid ✓`.

Also updated:
- `activeLoanCount`: loans that still have unpaid installments.
- `insights.ts` `liberationMilestones` uses the new `payoffOf` and sums `installmentAmount`.
- `debtServiceByMonth` already reads ledger events, so it's unchanged.

`startNewMonthCycle` (db) stops touching `debt_schedules`.

## 4. Commands (`lib/commands.ts`)

- `addLoan(input)` takes `{ name, lender, loanDate, firstDueDate, frequency, installmentAmount, totalInstallments, notes, unpaidPastInstallments?: number[] }`.
  - Validation: valid ISO dates; `firstDueDate >= loanDate`; frequency is one of the two values.
  - It inserts the loan and then marks paid every installment due on or before today, except those listed in `unpaidPastInstallments`.
  - It never moves the wallet.
- `updateLoan(id, changes)`: same fields, partial. If any schedule field or `unpaidPastInstallments` is sent, the paid state is rebuilt:
  - past installments are paid unless listed;
  - installments paid ahead of their due date (prepayments) stay paid if their number still exists;
  - numbers greater than the new total are dropped.
- `payNextInstallment(id, syncWallet)` marks the oldest unpaid installment paid. If `syncWallet` is set, the wallet goes down by the amount.
- `undoLastLoanPayment(id, syncWallet)` removes the most recent `paid_at` row. If `syncWallet` is set, the wallet goes back up.
- `setLoanPaid(id, paid, sync)` stays as the toggle the UI and agent call. `paid=true` maps to pay-next and `paid=false` to undo-last.

## 5. UI

**`LoanForm`** fields: name, lender, loan date, first due date, frequency (select: Monthly / Every 15 days), amount per installment, total installments, notes.

- **Past due dates checklist:** below the fields, built live from `pastInstallments(draft, todayLocal())`. Each row reads `#n · Oct 18, 2026 · ₱X` with a checkbox labelled "Paid", ticked by default.
- **Editing:** the checkboxes show the loan's current paid state.
- **Submit:** the unticked numbers are sent as a hidden `unpaidPastInstallments` field.

**`LoanCard`**:
- **Badges:** a frequency badge ("Monthly · 20th" or "Every 15 days"), plus a red "N overdue" badge when any are overdue.
- **Header:** the amount is labelled "per installment", with the loan date in the subtitle.
- **Progress:** paid/total.
- **Next:** shows the next unpaid date, with "(overdue)" when it's in the past.
- **Paid toggle:** `settled` means every installment due on or before the end of the cycle month is paid. When unsettled, clicking pays the next installment; when settled, it undoes the last one. The existing wallet-sync prompt stays.

**`LoanPanel`**: the subtitle becomes "`x/y` loans clear through <month>", using the same `settled` rule.

## 6. Agent (`lib/agent/tools.ts`, `state.ts`)

- `add_loan` takes:
  - `loan_date` and `first_due_date` (YYYY-MM-DD)
  - `frequency` (enum)
  - `installment_amount` and `total_installments`
  - `lender` and `notes`
  - `unpaid_past_installments` (an optional integer array)

  `due_day` and `paid_installments` are removed.
- `update_loan`: the same fields, all optional.
- `set_loan_paid`: description becomes "pay the oldest unpaid installment / undo the most recent payment".
- State: each loan reports:
  - `frequency`, `loanDate`, `firstDueDate` and `installmentAmount`
  - `installmentsPaid` (as `"x/y"`)
  - `overdue` (a `[{ number, date }]` list)
  - `nextInstallment` and `finalPaymentDate`
- System prompt: if the user doesn't say which past installments are unpaid, past ones count as paid. Ask when it's unclear.

## 7. Testing (TDD, Vitest)

- `lib/domain/loans.test.ts` (new):
  - monthly dates, including the Jan 31 → Feb 28 → Mar 31 clamping
  - 15-day dates across a month boundary
  - overdue detection
  - `remainingBalance` and `payoffOf`
  - `pastInstallments` boundaries (a due date equal to today counts as past)
- `lib/domain/ledger.test.ts`: the fixture moves to the new fields. The Oct 17 sample is rewritten with explicit first due dates and paid numbers so that the existing expected rows still hold. One case is added for an overdue installment from an earlier month, rolled to today.
- `lib/agent/tools.test.ts`:
  - `add_loan` with past dates defaults them to paid; `unpaid_past_installments` leaves them overdue
  - the wallet is unchanged by `add_loan`
  - `set_loan_paid` pays the oldest unpaid, and undo reverses it
- Migration test: an old-style row (`due_day`, `paid_installments`, `paid_this_month`) is converted to the expected `first_due_date` and paid set.

## Out of scope

- Interest or amortization math. The amount per installment is entered as-is.
- Other frequencies (weekly, twice-monthly on fixed days).
- Adding credit cards or incomes from the dashboard (a separate gap noted earlier).

---

# Addendum: on-time rebate and late penalty (2026-10-26, approved in chat)

## Decisions (from the user)

- **Rebate:** a fixed peso amount per installment, earned when the installment is paid **on or before** its due date. Typical for motor loans.
- **Penalty:** a fixed peso amount, charged **once** per installment paid after its due date.
- **No grace period.** The rebate is lost and the penalty applies from the day after the due date.

## Rule

`amountDueOn(debt, installment, payDate)` gives:

- `installmentAmount − rebateAmount` when `payDate <= installment.date`;
- `installmentAmount + penaltyAmount` otherwise.

## Data

- `debt_schedules` gains `rebate_amount REAL NOT NULL DEFAULT 0` and `penalty_amount REAL NOT NULL DEFAULT 0`.
- `loan_payments` gains `amount_paid REAL`, the cash actually paid. It is NULL for installments assumed paid when a loan is added; those never moved the wallet.
- Both are added by `migrate()` when missing.
- `DebtSchedule` gains:
  - `rebateAmount` and `penaltyAmount`;
  - `lastPayment: { number, amountPaid } | null`, used to label and refund an undo.

## Behavior

- **Ledger:**
  - An unpaid installment due before the ledger start is overdue at amount + penalty, with the detail "includes ₱P late penalty, rebate lost".
  - Later unpaid installments appear at amount − rebate, with the detail "includes ₱R on-time rebate".
  - Debt service, remaining balance (`remainingBalance(debt, today)`) and payoff milestones (`freedMonthly` = amount − rebate) follow the same rule.
- **Pay:** pays the oldest unpaid installment at `amountDueOn(…, today)`, stores it as `amount_paid`, and deducts it from the wallet if synced.
- **Undo:** refunds the stored `amount_paid`. When that is NULL, it refunds amount − rebate.
- **Validation:**
  - both amounts must be ≥ 0;
  - the rebate must be < the installment amount.
- **Form:** adds "On-time rebate ₱" and "Late penalty ₱" (both optional, default 0). An unticked past installment shows its overdue amount.
- **Card:**
  - when set, it shows "₱R rebate if paid on time · ₱P late penalty";
  - the Pay label shows the amount due today.
- **Agent:**
  - `add_loan` and `update_loan` take optional `rebate_amount` and `penalty_amount`;
  - in the state report, the overdue entries and the next installment include `amountDue`.

## Out of scope

Penalties that grow over time, early-payoff rebates, grace periods, and waiving a penalty for one payment.
