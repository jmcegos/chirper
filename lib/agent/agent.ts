import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { appendAgentMessages, getAgentThread, type StoredAgentMessage } from '@/lib/db';
import { todayLocal, type IsoDate } from '@/lib/domain/calendar';
import { AGENT_TOOLS, runAgentTool } from './tools';
import type { AgentImage } from './types';

const MODEL = 'claude-opus-5-5';
const MAX_TOKENS = 16000;
/** Hard stop for one user message: reads + writes rarely need more than a handful of rounds. */
const MAX_ROUNDS = 12;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const THINKING_BINDING_BETA = 'thinking-binding-controls-2026-08-01';

const SYSTEM_PROMPT = `You are the user's personal cash-flow agent for their local Fin Tracker app. The user talks only to you; you keep the app's data current with your tools. They do not want to press buttons or type data into forms.

What the app tracks (Philippine pesos, Asia/Manila time):
- A live wallet balance (their real bank balance right now).
- Monthly incomes. Payroll cutoffs lose a fixed amount per absence day, only when absences are entered.
- Installment loans with a loan date, due dates (monthly or every 15 days) and which installments are paid; unpaid past ones are overdue.
- Credit cards: the statement day moves no cash; cash leaves on the due day.
- Bills and planned expenses (monthly, every 15 days, yearly or one-time) with an estimated amount; record the actual amount with set_bill_amount when a bill arrives.
- Pocket expenses that come straight out of the wallet.
- A forward running-balance ledger that shows the balance after every future event and flags any shortfall.
"This month" means the app's current cycle month, shown in the state.

How to work:
- Call get_financial_state before your first change in a conversation and whenever you need fresh numbers. Use ids from it; never guess one.
- Turn what the user tells you into tool calls. One message can mean several changes ("got paid, paid my car loan, spent 250 on lunch" is three).
- sync_wallet: if the user gave their new exact balance, set it with set_wallet_balance and flag items with sync_wallet false. Otherwise use sync_wallet true so the wallet moves with the payment or income.
- Screenshots (bank app, loan app, card statement): read the figures, use them, and state the figures you used.
- If an amount, date, or which item they mean is unclear, ask one short question instead of guessing.
- Loans have a loan date, a first due date and a frequency (monthly or every 15 days), plus an optional on-time rebate and late penalty (flat pesos per installment; no grace period). When adding one, past installments count as paid; if the user says some past ones are still unpaid, list them in unpaid_past_installments. If you don't know the first due date or frequency, ask.
- Ask for confirmation before deleting anything or starting a new month cycle.
- After changes, reply in a few short lines: what changed, the new wallet balance, and the lowest upcoming balance (with its date) from get_financial_state. Call out any shortfall and how much buffer is needed.
- Answer questions about their runway from the state. Keep replies short and plain text (no tables or headings); the user dislikes wordy answers. Use ₱ amounts with two decimals.`;

export class AgentUnavailableError extends Error {}

export function agentConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' });

function userMessage(text: string, images: AgentImage[], today: IsoDate): Anthropic.Beta.BetaMessageParam {
  const weekday = WEEKDAY.format(new Date(`${today}T00:00:00Z`));
  return {
    role: 'user',
    content: [
      ...images.map((image) => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: image.mediaType, data: image.base64 },
      })),
      { type: 'text', text: `[Today is ${weekday}, ${today}]\n\n${text}` },
    ],
  };
}

function toolResults(response: Anthropic.Beta.BetaMessage, today: IsoDate): Anthropic.Beta.BetaMessageParam {
  return {
    role: 'user',
    content: response.content
      .filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use')
      .map((block) => {
        const result = runAgentTool(block.name, block.input, today);
        return { type: 'tool_result' as const, tool_use_id: block.id, content: result.content, is_error: result.isError };
      }),
  };
}

/**
 * Runs one user message through the agent loop. Today's conversation is one
 * append-only thread in SQLite. Replies and tool results are stored as soon as
 * they exist, so a failure mid-turn never leaves a tool call without its result.
 */
export async function runAgentTurn(text: string, images: AgentImage[]): Promise<void> {
  if (!agentConfigured()) throw new AgentUnavailableError('Add ANTHROPIC_API_KEY to .env.local and restart the app.');

  const client = new Anthropic();
  const today = todayLocal();
  const messages = getAgentThread(today) as Anthropic.Beta.BetaMessageParam[];
  // The user's message is saved with the first reply, so a failed first call leaves nothing to retry around.
  let unsaved: Anthropic.Beta.BetaMessageParam[] = [userMessage(text, images, today)];
  messages.push(...unsaved);
  const append = (message: Anthropic.Beta.BetaMessageParam) => {
    messages.push(message);
    appendAgentMessages(today, [...unsaved, message] as StoredAgentMessage[]);
    unsaved = [];
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: AGENT_TOOLS,
      messages,
      // The day's thread is stored and replayed, so it can outlive a change to the
      // system prompt or tools (an app update). Thinking blocks are bound to the
      // prompt and tools they were made under: drop the stale ones instead of
      // failing the whole request with a 400.
      thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      betas: [FALLBACK_BETA, THINKING_BINDING_BETA],
      fallbacks: 'default',
    });

    append({ role: 'assistant', content: response.content });
    // Only a clean tool_use stop has complete tool inputs worth running.
    if (response.stop_reason !== 'tool_use') return;
    append(toolResults(response, today));
  }
}
