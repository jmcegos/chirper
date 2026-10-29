import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import * as commands from '@/lib/commands';
import type { IsoDate } from '@/lib/domain/calendar';
import { BILL_FREQUENCIES } from '@/lib/domain/bills';
import type { BillFrequency, LoanFrequency } from '@/lib/domain/types';
import { financialState } from './state';

type Schema = Anthropic.Beta.BetaTool['input_schema'];
type Input = Record<string, unknown>;

/** Reads a tool input field, rejecting the wrong type so a bad call becomes a tool error. */
class ToolInput {
  constructor(private readonly input: Input) {}

  number(key: string): number {
    const value = this.input[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new commands.CommandError(`"${key}" must be a number.`);
    return value;
  }

  string(key: string): string {
    const value = this.input[key];
    if (typeof value !== 'string') throw new commands.CommandError(`"${key}" must be a string.`);
    return value;
  }

  boolean(key: string): boolean {
    const value = this.input[key];
    if (typeof value !== 'boolean') throw new commands.CommandError(`"${key}" must be true or false.`);
    return value;
  }

  frequency(key: string): LoanFrequency {
    const value = this.string(key);
    if (value !== 'monthly' && value !== 'every_15_days') throw new commands.CommandError(`"${key}" must be "monthly" or "every_15_days".`);
    return value;
  }

  /** An optional list of integers; undefined when the model left it out. */
  integers(key: string): number[] | undefined {
    const value = this.input[key];
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value) || !value.every((item) => Number.isInteger(item))) throw new commands.CommandError(`"${key}" must be a list of whole numbers.`);
    return value as number[];
  }

  billFrequency(key: string): BillFrequency {
    const value = this.string(key);
    if (!(BILL_FREQUENCIES as readonly string[]).includes(value)) {
      throw new commands.CommandError(`"${key}" must be one of: ${BILL_FREQUENCIES.join(', ')}.`);
    }
    return value as BillFrequency;
  }

  period(key: string): 'current' | 'next' {
    const value = this.string(key);
    if (value !== 'current' && value !== 'next') throw new commands.CommandError(`"${key}" must be "current" or "next".`);
    return value;
  }

  /** Only the fields the model actually sent, so partial updates never blank out others. */
  present<T extends string>(keys: Record<T, 'number' | 'string' | 'boolean'>): Partial<Record<T, number | string | boolean>> {
    const result: Partial<Record<T, number | string | boolean>> = {};
    for (const [key, type] of Object.entries(keys) as Array<[T, 'number' | 'string' | 'boolean']>) {
      if (this.input[key] === undefined || this.input[key] === null) continue;
      result[key] = type === 'number' ? this.number(key) : type === 'string' ? this.string(key) : this.boolean(key);
    }
    return result;
  }
}

interface AgentTool {
  definition: Anthropic.Beta.BetaTool;
  run: (input: ToolInput, today: IsoDate) => string;
}

const id = (description: string) => ({ type: 'integer', description });
const pesos = (description: string) => ({ type: 'number', description: `${description} (pesos)` });
const isoDate = (description: string) => ({ type: 'string', description: `${description} (YYYY-MM-DD)` });
const frequency = { type: 'string', enum: ['monthly', 'every_15_days'], description: 'How often an installment is due, counted from first_due_date' };
const billFrequency = { type: 'string', enum: [...BILL_FREQUENCIES], description: 'How often the bill repeats; one_time for a single planned expense' };
const rebate = pesos('On-time rebate taken off an installment paid on or before its due date, e.g. motor loans. 0 if none');
const penalty = pesos('Late penalty added once to an installment paid after its due date. 0 if none');
const unpaidPast = {
  type: 'array',
  items: { type: 'integer' },
  description:
    'Installment numbers whose due date has passed but the user has NOT paid. Every other past installment counts as paid. Omit when all past ones are paid.',
};
const syncWallet = {
  type: 'boolean',
  description:
    'true = also move the live wallet balance by this amount. false = flag only (use when the user already gave you their new exact balance, or the wallet already reflects it).',
};

function schema(properties: Record<string, unknown>, required: string[] = Object.keys(properties)): Schema {
  return { type: 'object', properties, required, additionalProperties: false };
}

function tool(name: string, description: string, input_schema: Schema, run: AgentTool['run']): AgentTool {
  return { definition: { name, description, input_schema }, run };
}

const TOOLS: AgentTool[] = [
  tool(
    'get_financial_state',
    'Read the full current state: wallet, incomes, loans, credit cards, recent expenses, and the forward running-balance ledger with the lowest point and any shortfall. Call it before making changes and whenever you need current numbers.',
    schema({}),
    (_input, today) => JSON.stringify(financialState(today)),
  ),
  tool(
    'set_wallet_balance',
    'Overwrite the live wallet balance with the exact amount the user reports from their bank app.',
    schema({ balance: pesos('Exact current wallet balance') }),
    (input) => commands.setWalletBalance(input.number('balance')),
  ),
  tool(
    'log_expense',
    'Log a one-off pocket expense (food, gas, load, etc.). Deducts it from the wallet immediately.',
    schema({ description: { type: 'string' }, amount: pesos('Amount spent') }),
    (input) => commands.logExpense(input.string('description'), input.number('amount')),
  ),
  tool(
    'delete_expense',
    'Delete a logged pocket expense by id and refund it to the wallet.',
    schema({ expense_id: id('Expense id') }),
    (input) => commands.deleteExpense(input.number('expense_id')),
  ),
  tool(
    'set_income_received',
    'Mark an income as received (or back to pending) for the current cycle month.',
    schema({ income_id: id('Income id'), received: { type: 'boolean' }, sync_wallet: syncWallet }),
    (input) => commands.setIncomeReceived(input.number('income_id'), input.boolean('received'), input.boolean('sync_wallet')),
  ),
  tool(
    'set_absences',
    'Set absence days for a payroll cutoff. period "current" = this cycle month, "next" = next month. Half days allowed (0.5 steps). 0 clears them.',
    schema({ income_id: id('Payroll income id'), period: { type: 'string', enum: ['current', 'next'] }, days: { type: 'number' } }),
    (input) => commands.setAbsences(input.number('income_id'), input.period('period'), input.number('days')),
  ),
  tool(
    'add_income',
    'Add a new recurring monthly income.',
    schema({
      name: { type: 'string' },
      day_of_month: { type: 'integer' },
      gross_amount: pesos('Gross amount per occurrence'),
      fixed_deductions: pesos('Fixed deductions per occurrence, 0 if none'),
      is_payroll: { type: 'boolean', description: 'true if absences can reduce it' },
      absence_rate: pesos('Deduction per absence day, 0 if not payroll'),
    }),
    (input) =>
      commands.addIncome({
        name: input.string('name'),
        dayOfMonth: input.number('day_of_month'),
        grossAmount: input.number('gross_amount'),
        fixedDeductions: input.number('fixed_deductions'),
        isPayroll: input.boolean('is_payroll'),
        absenceRate: input.number('absence_rate'),
      }),
  ),
  tool(
    'update_income',
    'Change fields of an existing income. Send only the fields that change.',
    schema(
      {
        income_id: id('Income id'),
        name: { type: 'string' },
        day_of_month: { type: 'integer' },
        gross_amount: pesos('Gross amount'),
        fixed_deductions: pesos('Fixed deductions'),
        absence_rate: pesos('Deduction per absence day'),
      },
      ['income_id'],
    ),
    (input) => {
      const fields = input.present({ name: 'string', day_of_month: 'number', gross_amount: 'number', fixed_deductions: 'number', absence_rate: 'number' });
      return commands.updateIncome(input.number('income_id'), {
        name: fields.name as string | undefined,
        dayOfMonth: fields.day_of_month as number | undefined,
        grossAmount: fields.gross_amount as number | undefined,
        fixedDeductions: fields.fixed_deductions as number | undefined,
        absenceRate: fields.absence_rate as number | undefined,
      });
    },
  ),
  tool(
    'set_loan_paid',
    "paid=true pays the loan's oldest unpaid installment (overdue ones first). paid=false undoes the most recent payment.",
    schema({ loan_id: id('Loan id'), paid: { type: 'boolean' }, sync_wallet: syncWallet }),
    (input) => commands.setLoanPaid(input.number('loan_id'), input.boolean('paid'), input.boolean('sync_wallet')),
  ),
  tool(
    'add_loan',
    'Add a new installment loan. Installments due on or before today count as paid unless listed in unpaid_past_installments. Never moves the wallet.',
    schema(
      {
        name: { type: 'string' },
        lender: { type: 'string' },
        loan_date: isoDate('When the loan was taken'),
        first_due_date: isoDate('Due date of installment #1'),
        frequency,
        installment_amount: pesos('Amount per installment'),
        rebate_amount: rebate,
        penalty_amount: penalty,
        total_installments: { type: 'integer' },
        unpaid_past_installments: unpaidPast,
        notes: { type: 'string' },
      },
      ['name', 'loan_date', 'first_due_date', 'frequency', 'installment_amount', 'total_installments'],
    ),
    (input) =>
      commands.addLoan({
        name: input.string('name'),
        lender: (input.present({ lender: 'string' }).lender as string | undefined) ?? '',
        loanDate: input.string('loan_date'),
        firstDueDate: input.string('first_due_date'),
        frequency: input.frequency('frequency'),
        installmentAmount: input.number('installment_amount'),
        rebateAmount: (input.present({ rebate_amount: 'number' }).rebate_amount as number | undefined) ?? 0,
        penaltyAmount: (input.present({ penalty_amount: 'number' }).penalty_amount as number | undefined) ?? 0,
        totalInstallments: input.number('total_installments'),
        unpaidPastInstallments: input.integers('unpaid_past_installments'),
        notes: (input.present({ notes: 'string' }).notes as string | undefined) ?? '',
      }),
  ),
  tool(
    'update_loan',
    'Change fields of an existing loan. Send only the fields that change. Sending unpaid_past_installments sets exactly which past installments are unpaid.',
    schema(
      {
        loan_id: id('Loan id'),
        name: { type: 'string' },
        lender: { type: 'string' },
        loan_date: isoDate('When the loan was taken'),
        first_due_date: isoDate('Due date of installment #1'),
        frequency,
        installment_amount: pesos('Amount per installment'),
        rebate_amount: rebate,
        penalty_amount: penalty,
        total_installments: { type: 'integer' },
        unpaid_past_installments: unpaidPast,
        notes: { type: 'string' },
      },
      ['loan_id'],
    ),
    (input) => {
      const fields = input.present({
        name: 'string',
        lender: 'string',
        loan_date: 'string',
        first_due_date: 'string',
        installment_amount: 'number',
        total_installments: 'number',
        rebate_amount: 'number',
        penalty_amount: 'number',
        notes: 'string',
      });
      return commands.updateLoan(input.number('loan_id'), {
        name: fields.name as string | undefined,
        lender: fields.lender as string | undefined,
        loanDate: fields.loan_date as string | undefined,
        firstDueDate: fields.first_due_date as string | undefined,
        frequency: input.present({ frequency: 'string' }).frequency === undefined ? undefined : input.frequency('frequency'),
        installmentAmount: fields.installment_amount as number | undefined,
        rebateAmount: fields.rebate_amount as number | undefined,
        penaltyAmount: fields.penalty_amount as number | undefined,
        totalInstallments: fields.total_installments as number | undefined,
        unpaidPastInstallments: input.integers('unpaid_past_installments'),
        notes: fields.notes as string | undefined,
      });
    },
  ),
  tool(
    'delete_loan',
    'Permanently delete a loan. Only after the user explicitly confirms.',
    schema({ loan_id: id('Loan id') }),
    (input) => commands.deleteLoan(input.number('loan_id')),
  ),
  tool(
    'add_bill',
    'Add a bill (rent, electricity, internet, subscription) or a planned one-off expense. It becomes an outflow on each due date in the runway.',
    schema(
      {
        name: { type: 'string' },
        frequency: billFrequency,
        next_due_date: isoDate('The next due date to track (earlier ones are ignored)'),
        estimated_amount: pesos('Usual or expected amount, used until the actual bill is known'),
        notes: { type: 'string' },
      },
      ['name', 'frequency', 'next_due_date', 'estimated_amount'],
    ),
    (input) =>
      commands.addBill({
        name: input.string('name'),
        frequency: input.billFrequency('frequency'),
        nextDueDate: input.string('next_due_date'),
        estimatedAmount: input.number('estimated_amount'),
        notes: (input.present({ notes: 'string' }).notes as string | undefined) ?? '',
      }),
  ),
  tool(
    'update_bill',
    'Change fields of an existing bill. Send only the fields that change.',
    schema(
      {
        bill_id: id('Bill id'),
        name: { type: 'string' },
        frequency: billFrequency,
        next_due_date: isoDate('The next due date to track'),
        estimated_amount: pesos('Usual or expected amount'),
        notes: { type: 'string' },
      },
      ['bill_id'],
    ),
    (input) => {
      const fields = input.present({ name: 'string', next_due_date: 'string', estimated_amount: 'number', notes: 'string' });
      return commands.updateBill(input.number('bill_id'), {
        name: fields.name as string | undefined,
        frequency: input.present({ frequency: 'string' }).frequency === undefined ? undefined : input.billFrequency('frequency'),
        nextDueDate: fields.next_due_date as string | undefined,
        estimatedAmount: fields.estimated_amount as number | undefined,
        notes: fields.notes as string | undefined,
      });
    },
  ),
  tool(
    'delete_bill',
    'Permanently delete a bill. Only after the user explicitly confirms.',
    schema({ bill_id: id('Bill id') }),
    (input) => commands.deleteBill(input.number('bill_id')),
  ),
  tool(
    'set_bill_amount',
    "Record the actual billed amount when a bill arrives (e.g. this month's electricity). Applies to the oldest unpaid due date unless due_date is given.",
    schema(
      { bill_id: id('Bill id'), amount: pesos('Actual billed amount'), due_date: isoDate('Which due date this amount is for (optional)') },
      ['bill_id', 'amount'],
    ),
    (input) =>
      commands.setBillAmount(input.number('bill_id'), input.number('amount'), input.present({ due_date: 'string' }).due_date as string | undefined),
  ),
  tool(
    'set_bill_paid',
    "paid=true pays the bill's oldest unpaid due date (overdue first) at its billed amount or estimate. paid=false undoes the most recent payment.",
    schema({ bill_id: id('Bill id'), paid: { type: 'boolean' }, sync_wallet: syncWallet }),
    (input) => commands.setBillPaid(input.number('bill_id'), input.boolean('paid'), input.boolean('sync_wallet')),
  ),
  tool(
    'add_receivable',
    'Record money someone owes the user (the user lent it to them). If expected is true it shows as money in on the promised date in the runway.',
    schema(
      {
        person: { type: 'string', description: 'Who owes the money' },
        amount: pesos('Total amount owed'),
        lent_date: isoDate('When the user lent the money'),
        description: { type: 'string', description: 'What the money was for' },
        promised_date: isoDate('When they promised to pay back. Omit if none'),
        expected: { type: 'boolean', description: 'true = the user is counting on it; needs promised_date. Default false' },
        notes: { type: 'string' },
        deduct_from_wallet: { type: 'boolean', description: 'true = the lent cash just came out of the wallet, so lower it by the amount' },
      },
      ['person', 'amount', 'lent_date', 'deduct_from_wallet'],
    ),
    (input) => {
      const fields = input.present({ description: 'string', promised_date: 'string', expected: 'boolean', notes: 'string' });
      return commands.addReceivable(
        {
          person: input.string('person'),
          amount: input.number('amount'),
          lentDate: input.string('lent_date'),
          description: (fields.description as string | undefined) ?? '',
          promisedDate: (fields.promised_date as string | undefined) ?? null,
          expected: (fields.expected as boolean | undefined) ?? false,
          notes: (fields.notes as string | undefined) ?? '',
        },
        input.boolean('deduct_from_wallet'),
      );
    },
  ),
  tool(
    'update_receivable',
    'Change fields of money owed to the user. Send only the fields that change; send promised_date "" to clear it.',
    schema(
      {
        receivable_id: id('Receivable id'),
        person: { type: 'string' },
        amount: pesos('Total amount owed'),
        lent_date: isoDate('When the money was lent'),
        description: { type: 'string' },
        promised_date: isoDate('When they promised to pay back, or "" for none'),
        expected: { type: 'boolean' },
        notes: { type: 'string' },
      },
      ['receivable_id'],
    ),
    (input) => {
      const fields = input.present({ person: 'string', amount: 'number', lent_date: 'string', description: 'string', promised_date: 'string', expected: 'boolean', notes: 'string' });
      const promised = fields.promised_date as string | undefined;
      return commands.updateReceivable(input.number('receivable_id'), {
        person: fields.person as string | undefined,
        amount: fields.amount as number | undefined,
        lentDate: fields.lent_date as string | undefined,
        description: fields.description as string | undefined,
        promisedDate: promised === undefined ? undefined : promised.trim() === '' ? null : promised,
        expected: fields.expected as boolean | undefined,
        notes: fields.notes as string | undefined,
      });
    },
  ),
  tool(
    'delete_receivable',
    'Permanently delete money owed to the user, with its payment history. Only after the user explicitly confirms.',
    schema({ receivable_id: id('Receivable id') }),
    (input) => commands.deleteReceivable(input.number('receivable_id')),
  ),
  tool(
    'record_receivable_payment',
    'Record a payment (partial or full) from someone who owes the user. Cannot exceed what is still owed.',
    schema(
      {
        receivable_id: id('Receivable id'),
        amount: pesos('Amount received'),
        paid_on: isoDate('When it was received. Default today'),
        sync_wallet: syncWallet,
      },
      ['receivable_id', 'amount', 'sync_wallet'],
    ),
    (input) =>
      commands.recordReceivablePayment(
        input.number('receivable_id'),
        input.number('amount'),
        input.boolean('sync_wallet'),
        input.present({ paid_on: 'string' }).paid_on as string | undefined,
      ),
  ),
  tool(
    'undo_receivable_payment',
    'Remove the most recent payment on a receivable. The wallet moves back only if that payment had moved it.',
    schema({ receivable_id: id('Receivable id') }),
    (input) => commands.undoLastReceivablePayment(input.number('receivable_id')),
  ),
  tool(
    'update_credit_card',
    'Update credit card figures. Send only the fields that change.',
    schema(
      {
        card_id: id('Card id'),
        statement_balance: pesos('Amount payable on the next due date'),
        unbilled_amount: pesos('Spend not yet on a statement'),
        minimum_due: pesos('Minimum amount due'),
        projected_monthly_spend: pesos('Expected spend for each future statement'),
      },
      ['card_id'],
    ),
    (input) => {
      const fields = input.present({ statement_balance: 'number', unbilled_amount: 'number', minimum_due: 'number', projected_monthly_spend: 'number' });
      return commands.updateCard(input.number('card_id'), {
        statementBalance: fields.statement_balance as number | undefined,
        unbilledAmount: fields.unbilled_amount as number | undefined,
        minimumDue: fields.minimum_due as number | undefined,
        projectedMonthlySpend: fields.projected_monthly_spend as number | undefined,
      });
    },
  ),
  tool(
    'set_card_statement_paid',
    "Mark the card's upcoming statement as paid (zeroes it) or undo that.",
    schema({ card_id: id('Card id'), paid: { type: 'boolean' }, sync_wallet: syncWallet }),
    (input) => commands.setCardStatementPaid(input.number('card_id'), input.boolean('paid'), input.boolean('sync_wallet')),
  ),
  tool(
    'start_new_month_cycle',
    'Roll to the next month cycle: clears received/paid flags, keeps installment counts, moves next-month absences to current. Only after the user confirms.',
    schema({}),
    () => commands.startNewMonthCycle(),
  ),
];

const BY_NAME = new Map(TOOLS.map((entry) => [entry.definition.name, entry]));

export const AGENT_TOOLS: Anthropic.Beta.BetaTool[] = TOOLS.map((entry) => entry.definition);

/** Tools that change data (everything except the read). */
export function isMutation(name: string): boolean {
  return name !== 'get_financial_state';
}

export function runAgentTool(name: string, input: unknown, today: IsoDate): { content: string; isError: boolean } {
  const entry = BY_NAME.get(name);
  if (!entry) return { content: `Unknown tool "${name}".`, isError: true };
  try {
    return { content: entry.run(new ToolInput((input ?? {}) as Input), today), isError: false };
  } catch (error) {
    if (error instanceof commands.CommandError) return { content: error.message, isError: true };
    throw error;
  }
}
