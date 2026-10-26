import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

describe('migrating a database from before loans had dates', () => {
  it('derives the first due date and paid installments from the old fields', async () => {
    process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'fin-migrate-')));
    const legacy = new Database('finance.db');
    legacy.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value);
      INSERT INTO settings VALUES ('wallet_balance', 0), ('wallet_name', 'Wallet'), ('current_month_label', 'October 2026'), ('cycle_month', '2026-10');
      CREATE TABLE debt_schedules (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, lender TEXT NOT NULL DEFAULT '', due_day INTEGER NOT NULL,
        monthly_amount REAL NOT NULL, total_installments INTEGER NOT NULL, paid_installments INTEGER NOT NULL DEFAULT 0,
        paid_this_month INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT ''
      );
      INSERT INTO debt_schedules (name, lender, due_day, monthly_amount, total_installments, paid_installments, paid_this_month)
      VALUES ('GLoan', 'Fuse', 20, 2977, 12, 3, 1), ('Bridge', 'SLoan', 17, 1100.49, 3, 0, 1);
    `);
    legacy.close();

    const db = await import('./db');
    const [gloan, bridge] = db.getSnapshot().debts;
    expect(gloan).toMatchObject({ firstDueDate: '2026-08-20', loanDate: '2026-07-20', frequency: 'monthly', installmentAmount: 2977, paidInstallmentNumbers: [1, 2, 3] });
    expect(bridge).toMatchObject({ firstDueDate: '2026-11-17', paidInstallmentNumbers: [] });
  });
});
