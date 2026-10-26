import 'server-only';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { addMonths, dateOf, dayOf, formatMonthLabel, parseYearMonthKey, yearMonthKey, yearMonthOf, type IsoDate } from './domain/calendar';
import { legacyFirstDueDate } from './domain/loans';
import type { CreditCard, DebtSchedule, FinanceSettings, FinanceSnapshot, IncomeRule, LoanFrequency, QuickExpense } from './domain/types';
import { SEED_CREDIT_CARDS, SEED_DEBT_SCHEDULES, SEED_INCOME_RULES, SEED_LOAN_PAYMENTS, seedSettings } from './seed';

const DB_PATH = path.join(process.cwd(), 'finance.db');
const BACKUP_DIR = path.join(process.cwd(), 'backups');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value
  );
  CREATE TABLE IF NOT EXISTS income_rules (
    id                  INTEGER PRIMARY KEY,
    name                TEXT    NOT NULL,
    day_of_month        INTEGER NOT NULL,
    gross_amount        REAL    NOT NULL,
    fixed_deductions    REAL    NOT NULL DEFAULT 0,
    is_payroll          INTEGER NOT NULL DEFAULT 0,
    absence_rate        REAL    NOT NULL DEFAULT 0,
    current_absences    REAL    NOT NULL DEFAULT 0,
    next_month_absences REAL    NOT NULL DEFAULT 0,
    received_this_month INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS debt_schedules (
    id                 INTEGER PRIMARY KEY,
    name               TEXT    NOT NULL,
    lender             TEXT    NOT NULL DEFAULT '',
    due_day            INTEGER NOT NULL,
    monthly_amount     REAL    NOT NULL,
    total_installments INTEGER NOT NULL,
    paid_installments  INTEGER NOT NULL DEFAULT 0,  -- legacy; superseded by loan_payments
    paid_this_month    INTEGER NOT NULL DEFAULT 0,  -- legacy; superseded by loan_payments
    notes              TEXT    NOT NULL DEFAULT '',
    loan_date          TEXT,
    first_due_date     TEXT,
    frequency          TEXT    NOT NULL DEFAULT 'monthly',
    rebate_amount      REAL    NOT NULL DEFAULT 0,
    penalty_amount     REAL    NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS loan_payments (
    debt_id            INTEGER NOT NULL REFERENCES debt_schedules (id) ON DELETE CASCADE,
    installment_number INTEGER NOT NULL,
    paid_at            INTEGER NOT NULL,  -- insertion order, so undo removes the latest payment
    amount_paid        REAL,              -- cash actually paid; NULL when assumed paid on entry
    PRIMARY KEY (debt_id, installment_number)
  );
  CREATE TABLE IF NOT EXISTS credit_cards (
    id                      INTEGER PRIMARY KEY,
    name                    TEXT    NOT NULL,
    statement_day           INTEGER NOT NULL,
    due_day                 INTEGER NOT NULL,
    unbilled_amount         REAL    NOT NULL DEFAULT 0,
    statement_balance       REAL    NOT NULL DEFAULT 0,
    minimum_due             REAL    NOT NULL DEFAULT 0,
    paid_this_month         INTEGER NOT NULL DEFAULT 0,
    projected_monthly_spend REAL    NOT NULL DEFAULT 0,
    last_settled_due        TEXT,
    last_paid_amount        REAL    NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS quick_expenses (
    id          INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    amount      REAL NOT NULL,
    date_logged TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agent_messages (
    id          INTEGER PRIMARY KEY,
    thread_date TEXT NOT NULL,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS agent_messages_thread ON agent_messages (thread_date, id);
`;

const TABLES = ['settings', 'income_rules', 'loan_payments', 'debt_schedules', 'credit_cards', 'quick_expenses'] as const;

/* ───────────────────────────── connection ───────────────────────────── */

const globalForDb = globalThis as unknown as { financeDb?: Database.Database };

function open(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  if (isEmpty(db)) seed(db);
  return db;
}

/* ───────────────────────────── migrations ───────────────────────────── */

/** Columns added after the first release, per table. `CREATE TABLE IF NOT EXISTS` never adds them to an old table. */
const COLUMNS_ADDED: Record<string, Record<string, string>> = {
  debt_schedules: {
    loan_date: 'TEXT',
    first_due_date: 'TEXT',
    frequency: "TEXT NOT NULL DEFAULT 'monthly'",
    rebate_amount: 'REAL NOT NULL DEFAULT 0',
    penalty_amount: 'REAL NOT NULL DEFAULT 0',
  },
  loan_payments: { amount_paid: 'REAL' },
};

function addMissingColumns(db: Database.Database): void {
  for (const [table, columns] of Object.entries(COLUMNS_ADDED)) {
    const existing = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
    for (const [column, type] of Object.entries(columns)) {
      if (!existing.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }
}

/**
 * Brings an older database up to date: adds missing columns, then converts
 * each undated loan's due day, paid count and `paid_this_month` flag into a
 * first due date and paid installment rows.
 */
function migrate(db: Database.Database): void {
  addMissingColumns(db);

  const undated = db.prepare('SELECT id, due_day, paid_installments, paid_this_month FROM debt_schedules WHERE first_due_date IS NULL').all() as Row[];
  if (undated.length === 0) return;
  const cycle = readSettings(db).cycleMonth;
  db.transaction(() => {
    for (const row of undated) {
      const firstDue = legacyFirstDueDate(num(row.due_day), num(row.paid_installments), bool(row.paid_this_month), cycle);
      db.prepare('UPDATE debt_schedules SET first_due_date = ?, loan_date = ? WHERE id = ?').run(firstDue, dateOfPreviousMonth(firstDue), row.id);
      for (let n = 1; n <= num(row.paid_installments); n++) {
        db.prepare('INSERT OR IGNORE INTO loan_payments (debt_id, installment_number, paid_at) VALUES (?, ?, ?)').run(row.id, n, n);
      }
    }
  })();
}

function dateOfPreviousMonth(date: IsoDate): IsoDate {
  return dateOf(addMonths(yearMonthOf(date), -1), dayOf(date));
}

function connection(): Database.Database {
  globalForDb.financeDb ??= open();
  return globalForDb.financeDb;
}

function isEmpty(db: Database.Database): boolean {
  const row = db.prepare('SELECT COUNT(*) AS count FROM settings').get() as { count: number };
  return row.count === 0;
}

/* ─────────────────────────────── seeding ────────────────────────────── */

function insertRows(db: Database.Database, table: string, rows: Array<Record<string, unknown>>): void {
  for (const row of rows) {
    const columns = Object.keys(row);
    const placeholders = columns.map((column) => `@${column}`).join(', ');
    db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).run(row);
  }
}

function seed(db: Database.Database): void {
  db.transaction(() => {
    insertRows(db, 'settings', Object.entries(seedSettings()).map(([key, value]) => ({ key, value })));
    insertRows(db, 'income_rules', SEED_INCOME_RULES);
    insertRows(db, 'debt_schedules', SEED_DEBT_SCHEDULES);
    insertRows(db, 'loan_payments', SEED_LOAN_PAYMENTS);
    insertRows(db, 'credit_cards', SEED_CREDIT_CARDS);
  })();
}

export function resetToSeed(): void {
  const db = connection();
  db.transaction(() => {
    for (const table of TABLES) db.prepare(`DELETE FROM ${table}`).run();
    seed(db);
  })();
}

/* ─────────────────────────────── mapping ────────────────────────────── */

type Row = Record<string, unknown>;
const num = (value: unknown) => Number(value ?? 0);
const bool = (value: unknown) => Number(value) === 1;
const str = (value: unknown) => String(value ?? '');

function toIncomeRule(row: Row): IncomeRule {
  return {
    id: num(row.id),
    name: str(row.name),
    dayOfMonth: num(row.day_of_month),
    grossAmount: num(row.gross_amount),
    fixedDeductions: num(row.fixed_deductions),
    isPayroll: bool(row.is_payroll),
    absenceRate: num(row.absence_rate),
    currentAbsences: num(row.current_absences),
    nextMonthAbsences: num(row.next_month_absences),
    receivedThisMonth: bool(row.received_this_month),
  };
}

interface LoanPayments {
  paidInstallmentNumbers: number[];
  lastPayment: DebtSchedule['lastPayment'];
}

const NO_PAYMENTS: LoanPayments = { paidInstallmentNumbers: [], lastPayment: null };

function toDebtSchedule(row: Row, payments: LoanPayments): DebtSchedule {
  return {
    id: num(row.id),
    name: str(row.name),
    lender: str(row.lender),
    loanDate: str(row.loan_date),
    firstDueDate: str(row.first_due_date),
    frequency: str(row.frequency) as LoanFrequency,
    installmentAmount: num(row.monthly_amount),
    totalInstallments: num(row.total_installments),
    paidInstallmentNumbers: [...payments.paidInstallmentNumbers],
    rebateAmount: num(row.rebate_amount),
    penaltyAmount: num(row.penalty_amount),
    lastPayment: payments.lastPayment,
    notes: str(row.notes),
  };
}

/** Paid installment numbers (ascending) and the latest payment, per loan id. */
function paymentsByDebt(db: Database.Database, debtId?: number): Map<number, LoanPayments> {
  const rows = (
    debtId === undefined
      ? db.prepare('SELECT * FROM loan_payments ORDER BY installment_number').all()
      : db.prepare('SELECT * FROM loan_payments WHERE debt_id = ? ORDER BY installment_number').all(debtId)
  ) as Row[];
  const byDebt = new Map<number, LoanPayments & { lastPaidAt: number }>();
  for (const row of rows) {
    const entry = byDebt.get(num(row.debt_id)) ?? { paidInstallmentNumbers: [], lastPayment: null, lastPaidAt: -1 };
    entry.paidInstallmentNumbers.push(num(row.installment_number));
    if (num(row.paid_at) > entry.lastPaidAt) {
      entry.lastPaidAt = num(row.paid_at);
      entry.lastPayment = { number: num(row.installment_number), amountPaid: row.amount_paid === null ? null : num(row.amount_paid) };
    }
    byDebt.set(num(row.debt_id), entry);
  }
  return byDebt;
}

function toCreditCard(row: Row): CreditCard {
  return {
    id: num(row.id),
    name: str(row.name),
    statementDay: num(row.statement_day),
    dueDay: num(row.due_day),
    unbilledAmount: num(row.unbilled_amount),
    statementBalance: num(row.statement_balance),
    minimumDue: num(row.minimum_due),
    paidThisMonth: bool(row.paid_this_month),
    projectedMonthlySpend: num(row.projected_monthly_spend),
    lastSettledDue: row.last_settled_due ? str(row.last_settled_due) : null,
    lastPaidAmount: num(row.last_paid_amount),
  };
}

function toQuickExpense(row: Row): QuickExpense {
  return { id: num(row.id), description: str(row.description), amount: num(row.amount), dateLogged: str(row.date_logged) };
}

/* ─────────────────────────────── queries ────────────────────────────── */

function readSettings(db: Database.Database): FinanceSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: unknown }>;
  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    walletBalance: num(map.get('wallet_balance')),
    walletName: str(map.get('wallet_name')),
    currentMonthLabel: str(map.get('current_month_label')),
    cycleMonth: parseYearMonthKey(str(map.get('cycle_month'))),
  };
}

export function getSnapshot(): FinanceSnapshot {
  const db = connection();
  const payments = paymentsByDebt(db);
  return {
    settings: readSettings(db),
    incomes: (db.prepare('SELECT * FROM income_rules ORDER BY day_of_month, id').all() as Row[]).map(toIncomeRule),
    debts: (db.prepare('SELECT * FROM debt_schedules ORDER BY first_due_date, id').all() as Row[]).map((row) => toDebtSchedule(row, payments.get(num(row.id)) ?? NO_PAYMENTS)),
    cards: (db.prepare('SELECT * FROM credit_cards ORDER BY id').all() as Row[]).map(toCreditCard),
    expenses: (db.prepare('SELECT * FROM quick_expenses ORDER BY date_logged DESC, id DESC').all() as Row[]).map(toQuickExpense),
  };
}

export function getIncomeRule(id: number): IncomeRule | null {
  const row = connection().prepare('SELECT * FROM income_rules WHERE id = ?').get(id) as Row | undefined;
  return row ? toIncomeRule(row) : null;
}

export function getDebtSchedule(id: number): DebtSchedule | null {
  const db = connection();
  const row = db.prepare('SELECT * FROM debt_schedules WHERE id = ?').get(id) as Row | undefined;
  return row ? toDebtSchedule(row, paymentsByDebt(db, id).get(id) ?? NO_PAYMENTS) : null;
}

export function getCreditCard(id: number): CreditCard | null {
  const row = connection().prepare('SELECT * FROM credit_cards WHERE id = ?').get(id) as Row | undefined;
  return row ? toCreditCard(row) : null;
}

/* ────────────────────────────── mutations ───────────────────────────── */

function adjustWalletWith(db: Database.Database, delta: number): void {
  db.prepare("UPDATE settings SET value = ROUND(value + ?, 2) WHERE key = 'wallet_balance'").run(delta);
}

export function setWalletBalance(balance: number): void {
  connection().prepare("UPDATE settings SET value = ROUND(?, 2) WHERE key = 'wallet_balance'").run(balance);
}

export interface IncomeInput {
  name: string;
  dayOfMonth: number;
  grossAmount: number;
  fixedDeductions: number;
  isPayroll: boolean;
  absenceRate: number;
}

function incomeParams(input: IncomeInput) {
  return {
    name: input.name,
    day_of_month: input.dayOfMonth,
    gross_amount: input.grossAmount,
    fixed_deductions: input.fixedDeductions,
    is_payroll: input.isPayroll ? 1 : 0,
    absence_rate: input.absenceRate,
  };
}

export function insertIncome(input: IncomeInput): number {
  const result = connection()
    .prepare(
      `INSERT INTO income_rules (name, day_of_month, gross_amount, fixed_deductions, is_payroll, absence_rate)
       VALUES (@name, @day_of_month, @gross_amount, @fixed_deductions, @is_payroll, @absence_rate)`,
    )
    .run(incomeParams(input));
  return Number(result.lastInsertRowid);
}

export function updateIncome(id: number, input: IncomeInput): void {
  connection()
    .prepare(
      `UPDATE income_rules SET name = @name, day_of_month = @day_of_month, gross_amount = @gross_amount,
         fixed_deductions = @fixed_deductions, is_payroll = @is_payroll, absence_rate = @absence_rate
       WHERE id = @id`,
    )
    .run({ ...incomeParams(input), id });
}

export function setAbsences(incomeId: number, period: 'current' | 'next', absences: number): void {
  const column = period === 'current' ? 'current_absences' : 'next_month_absences';
  connection().prepare(`UPDATE income_rules SET ${column} = ? WHERE id = ?`).run(absences, incomeId);
}

/** Flips the received flag; `walletDelta` is applied atomically (0 = no sync). */
export function setIncomeReceived(incomeId: number, received: boolean, walletDelta: number): void {
  const db = connection();
  db.transaction(() => {
    db.prepare('UPDATE income_rules SET received_this_month = ? WHERE id = ?').run(received ? 1 : 0, incomeId);
    adjustWalletWith(db, walletDelta);
  })();
}

/** `amountPaid` is null for installments assumed paid when the loan was entered. */
function insertLoanPayment(db: Database.Database, debtId: number, installmentNumber: number, amountPaid: number | null): void {
  const { next } = db.prepare('SELECT COALESCE(MAX(paid_at), 0) + 1 AS next FROM loan_payments').get() as { next: number };
  db.prepare('INSERT OR IGNORE INTO loan_payments (debt_id, installment_number, paid_at, amount_paid) VALUES (?, ?, ?, ?)').run(
    debtId,
    installmentNumber,
    next,
    amountPaid,
  );
}

/** Marks one installment paid at `amountPaid`; `walletDelta` is applied atomically (0 = no sync). */
export function addLoanPayment(debtId: number, installmentNumber: number, amountPaid: number, walletDelta: number): void {
  const db = connection();
  db.transaction(() => {
    insertLoanPayment(db, debtId, installmentNumber, amountPaid);
    adjustWalletWith(db, walletDelta);
  })();
}

export function removeLoanPayment(debtId: number, installmentNumber: number, walletDelta: number): void {
  const db = connection();
  db.transaction(() => {
    db.prepare('DELETE FROM loan_payments WHERE debt_id = ? AND installment_number = ?').run(debtId, installmentNumber);
    adjustWalletWith(db, walletDelta);
  })();
}

export interface DebtInput {
  name: string;
  lender: string;
  loanDate: IsoDate;
  firstDueDate: IsoDate;
  frequency: LoanFrequency;
  installmentAmount: number;
  totalInstallments: number;
  rebateAmount: number;
  penaltyAmount: number;
  notes: string;
}

function debtParams(input: DebtInput) {
  return {
    name: input.name,
    lender: input.lender,
    loan_date: input.loanDate,
    first_due_date: input.firstDueDate,
    frequency: input.frequency,
    // Legacy NOT NULL column; nothing reads it any more.
    due_day: dayOf(input.firstDueDate),
    monthly_amount: input.installmentAmount,
    total_installments: input.totalInstallments,
    rebate_amount: input.rebateAmount,
    penalty_amount: input.penaltyAmount,
    notes: input.notes,
  };
}

/**
 * Makes a loan's paid installments exactly `paidNumbers`. Rows that stay keep
 * their recorded amount; new ones are entered as assumed paid (no amount).
 */
function writePaidNumbers(db: Database.Database, debtId: number, paidNumbers: number[]): void {
  const keep = new Set(paidNumbers);
  const existing = (db.prepare('SELECT installment_number FROM loan_payments WHERE debt_id = ?').all(debtId) as Row[]).map((row) => num(row.installment_number));
  for (const n of existing) {
    if (!keep.has(n)) db.prepare('DELETE FROM loan_payments WHERE debt_id = ? AND installment_number = ?').run(debtId, n);
  }
  for (const n of [...keep].sort((a, b) => a - b)) insertLoanPayment(db, debtId, n, null);
}

/** Inserts the loan with its paid installments. Never touches the wallet. */
export function insertDebt(input: DebtInput, paidNumbers: number[]): number {
  const db = connection();
  return db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO debt_schedules (name, lender, loan_date, first_due_date, frequency, due_day, monthly_amount, total_installments, rebate_amount, penalty_amount, notes)
         VALUES (@name, @lender, @loan_date, @first_due_date, @frequency, @due_day, @monthly_amount, @total_installments, @rebate_amount, @penalty_amount, @notes)`,
      )
      .run(debtParams(input));
    const id = Number(result.lastInsertRowid);
    writePaidNumbers(db, id, paidNumbers);
    return id;
  })();
}

/** Updates the loan; `paidNumbers` (when given) replaces its paid installments. */
export function updateDebt(id: number, input: DebtInput, paidNumbers?: number[]): void {
  const db = connection();
  db.transaction(() => {
    db.prepare(
      `UPDATE debt_schedules SET name = @name, lender = @lender, loan_date = @loan_date, first_due_date = @first_due_date,
         frequency = @frequency, due_day = @due_day, monthly_amount = @monthly_amount, total_installments = @total_installments,
         rebate_amount = @rebate_amount, penalty_amount = @penalty_amount, notes = @notes
       WHERE id = @id`,
    ).run({ ...debtParams(input), id });
    if (paidNumbers) writePaidNumbers(db, id, paidNumbers);
  })();
}

export function deleteDebt(id: number): void {
  connection().prepare('DELETE FROM debt_schedules WHERE id = ?').run(id);
}

export interface CardInput {
  statementBalance: number;
  unbilledAmount: number;
  minimumDue: number;
  projectedMonthlySpend: number;
}

export function updateCard(id: number, input: CardInput): void {
  connection()
    .prepare(
      `UPDATE credit_cards SET statement_balance = @statement_balance, unbilled_amount = @unbilled_amount,
         minimum_due = @minimum_due, projected_monthly_spend = @projected_monthly_spend
       WHERE id = @id`,
    )
    .run({
      id,
      statement_balance: input.statementBalance,
      unbilled_amount: input.unbilledAmount,
      minimum_due: input.minimumDue,
      projected_monthly_spend: input.projectedMonthlySpend,
    });
}

/** Paying a statement zeroes it and remembers what was paid so it can be undone. */
export function settleCardStatement(id: number, dueDate: IsoDate, amount: number, walletDelta: number): void {
  const db = connection();
  db.transaction(() => {
    db.prepare(
      `UPDATE credit_cards SET paid_this_month = 1, last_settled_due = ?, last_paid_amount = ?, statement_balance = 0, minimum_due = 0
       WHERE id = ?`,
    ).run(dueDate, amount, id);
    adjustWalletWith(db, walletDelta);
  })();
}

export function undoCardSettlement(id: number, walletDelta: number): void {
  const db = connection();
  db.transaction(() => {
    db.prepare(
      `UPDATE credit_cards SET paid_this_month = 0, last_settled_due = NULL, statement_balance = last_paid_amount,
         minimum_due = last_paid_amount, last_paid_amount = 0
       WHERE id = ?`,
    ).run(id);
    adjustWalletWith(db, walletDelta);
  })();
}

export function addQuickExpense(description: string, amount: number, dateLogged: IsoDate): number {
  const db = connection();
  return db.transaction(() => {
    const result = db.prepare('INSERT INTO quick_expenses (description, amount, date_logged) VALUES (?, ?, ?)').run(description, amount, dateLogged);
    adjustWalletWith(db, -amount);
    return Number(result.lastInsertRowid);
  })();
}

/** Removing a logged expense refunds it to the wallet. Returns the refunded expense. */
export function deleteQuickExpense(id: number): QuickExpense | null {
  const db = connection();
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM quick_expenses WHERE id = ?').get(id) as Row | undefined;
    if (!row) return null;
    db.prepare('DELETE FROM quick_expenses WHERE id = ?').run(id);
    adjustWalletWith(db, num(row.amount));
    return toQuickExpense(row);
  })();
}

/**
 * Rolls the cycle forward one month: clears income received and card paid
 * flags and promotes next-month absences. Loans are date-driven and untouched.
 */
export function startNewMonthCycle(): void {
  const db = connection();
  db.transaction(() => {
    const next = addMonths(readSettings(db).cycleMonth, 1);
    db.prepare('UPDATE income_rules SET received_this_month = 0, current_absences = next_month_absences, next_month_absences = 0').run();
    db.prepare('UPDATE credit_cards SET paid_this_month = 0').run();
    db.prepare("UPDATE settings SET value = ? WHERE key = 'cycle_month'").run(yearMonthKey(next));
    db.prepare("UPDATE settings SET value = ? WHERE key = 'current_month_label'").run(formatMonthLabel(next));
  })();
}

/* ──────────────────────────── agent transcript ─────────────────────────── */

export interface StoredAgentMessage {
  role: 'user' | 'assistant';
  /** JSON-encoded API content blocks, stored verbatim so history stays append-only. */
  content: unknown;
}

export function getAgentThread(threadDate: IsoDate): StoredAgentMessage[] {
  const rows = connection()
    .prepare('SELECT role, content FROM agent_messages WHERE thread_date = ? ORDER BY id')
    .all(threadDate) as Array<{ role: 'user' | 'assistant'; content: string }>;
  return rows.map((row) => ({ role: row.role, content: JSON.parse(row.content) }));
}

export function appendAgentMessages(threadDate: IsoDate, messages: StoredAgentMessage[]): void {
  const db = connection();
  const insert = db.prepare('INSERT INTO agent_messages (thread_date, role, content) VALUES (?, ?, ?)');
  db.transaction(() => {
    for (const message of messages) insert.run(threadDate, message.role, JSON.stringify(message.content));
  })();
}

/** Online, WAL-safe copy of the database into ./backups. */
export async function backupDatabase(): Promise<string> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(BACKUP_DIR, `finance-${stamp}.db`);
  await connection().backup(file);
  return path.relative(process.cwd(), file);
}
