'use server';

import Anthropic from '@anthropic-ai/sdk';
import { revalidatePath } from 'next/cache';
import { AgentUnavailableError, runAgentTurn } from '@/lib/agent/agent';
import type { AgentImage } from '@/lib/agent/types';
import type { LoanFrequency } from '@/lib/domain/types';
import { roundPesos } from '@/lib/domain/money';
import * as commands from '@/lib/commands';

/* Thin FormData/argument adapters over lib/commands; every mutation refreshes the dashboard. */

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

function pesos(form: FormData, key: string): number {
  return roundPesos(Number(text(form, key).replace(/[₱,\s]/g, '')));
}

function integer(form: FormData, key: string): number {
  return Number(text(form, key));
}

function refresh(): void {
  revalidatePath('/');
}

/* ─────────────────────────────── wallet ────────────────────────────── */

export async function syncWalletBalance(form: FormData): Promise<void> {
  commands.setWalletBalance(pesos(form, 'balance'));
  refresh();
}

/* ─────────────────────────────── income ────────────────────────────── */

export async function stepAbsences(incomeId: number, period: 'current' | 'next', delta: number): Promise<void> {
  commands.stepAbsences(incomeId, period, delta);
  refresh();
}

export async function toggleIncomeReceived(incomeId: number, syncWallet: boolean): Promise<void> {
  commands.toggleIncomeReceived(incomeId, syncWallet);
  refresh();
}

/* ─────────────────────────────── loans ─────────────────────────────── */

export async function toggleDebtPaid(debtId: number, syncWallet: boolean): Promise<void> {
  commands.toggleLoanPaid(debtId, syncWallet);
  refresh();
}

export async function saveDebt(form: FormData): Promise<void> {
  const id = integer(form, 'id');
  const unpaid = text(form, 'unpaidPastInstallments');
  const input = {
    name: text(form, 'name'),
    lender: text(form, 'lender'),
    loanDate: text(form, 'loanDate'),
    firstDueDate: text(form, 'firstDueDate'),
    frequency: text(form, 'frequency') as LoanFrequency,
    installmentAmount: pesos(form, 'installmentAmount'),
    rebateAmount: pesos(form, 'rebateAmount'),
    penaltyAmount: pesos(form, 'penaltyAmount'),
    totalInstallments: integer(form, 'totalInstallments'),
    notes: text(form, 'notes'),
    // The form always sends the full list (possibly empty) of past installments left unticked.
    unpaidPastInstallments: unpaid ? unpaid.split(',').map(Number) : [],
  };
  if (id > 0) commands.updateLoan(id, input);
  else commands.addLoan(input);
  refresh();
}

export async function removeDebt(debtId: number): Promise<void> {
  commands.deleteLoan(debtId);
  refresh();
}

/* ──────────────────────────── credit cards ─────────────────────────── */

export async function saveCard(form: FormData): Promise<void> {
  commands.updateCard(integer(form, 'id'), {
    statementBalance: pesos(form, 'statementBalance'),
    unbilledAmount: pesos(form, 'unbilledAmount'),
    minimumDue: pesos(form, 'minimumDue'),
    projectedMonthlySpend: pesos(form, 'projectedMonthlySpend'),
  });
  refresh();
}

export async function toggleCardPaid(cardId: number, syncWallet: boolean): Promise<void> {
  commands.toggleCardStatementPaid(cardId, syncWallet);
  refresh();
}

/* ─────────────────────────── quick expenses ────────────────────────── */

export async function logQuickExpense(form: FormData): Promise<void> {
  commands.logExpense(text(form, 'description'), pesos(form, 'amount'));
  refresh();
}

export async function removeQuickExpense(expenseId: number): Promise<void> {
  commands.deleteExpense(expenseId);
  refresh();
}

/* ──────────────────────────── cycle control ────────────────────────── */

export async function startNewMonthCycle(): Promise<void> {
  commands.startNewMonthCycle();
  refresh();
}

export async function resetToSeed(): Promise<void> {
  commands.resetToSeed();
  refresh();
}

export async function backupDatabase(): Promise<string> {
  return commands.backupDatabase();
}

/* ──────────────────────────────── agent ────────────────────────────── */

export interface AgentReplyResult {
  error?: string;
}

function agentErrorMessage(error: unknown): string {
  if (error instanceof AgentUnavailableError) return error.message;
  if (error instanceof Anthropic.AuthenticationError) return 'The API key was rejected. Check ANTHROPIC_API_KEY in .env.local.';
  if (error instanceof Anthropic.PermissionDeniedError) return 'This API key has no access to the model. Check your Console workspace.';
  if (error instanceof Anthropic.RateLimitError) return 'Rate limited by the API. Wait a moment and send again.';
  if (error instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API. Check your internet connection.';
  if (error instanceof Anthropic.APIError) return `Claude API error ${error.status ?? ''}: ${error.message}`;
  throw error;
}

export async function askAgent(message: string, images: AgentImage[]): Promise<AgentReplyResult> {
  const text = message.trim();
  if (!text && images.length === 0) return {};
  try {
    await runAgentTurn(text || 'See the attached screenshot.', images);
    return {};
  } catch (error) {
    return { error: agentErrorMessage(error) };
  } finally {
    refresh();
  }
}
