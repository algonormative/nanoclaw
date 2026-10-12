/**
 * Lemon fork (vault-1t1qn): catch turns that end on a promise with no tool
 * call. The local model sometimes answers "Let me check that photo and add
 * it…" and ends the turn without doing anything. The poll loop counts tool
 * calls per turn; when a turn made none and its final text opens a sentence
 * with a promise, it pushes one corrective prompt.
 */

/** A sentence (or message body) that opens with a promise of action. */
const PROMISE_RE =
  /(?:^|[.!?\n>]\s*|🍋\s*)(?:let me(?! know)|i'll|i will|i'm going to|going to|on it|one sec|give me a (?:sec|moment|minute)|i'm checking|checking|looking (?:into|at) (?:it|that|this))\b/i;

/** Final texts longer than this are real answers that happen to offer more. */
const MAX_PROMISE_TEXT = 400;

/** Max promise nudges per query, so a model that keeps promising can't loop. */
export const MAX_PROMISE_NUDGES = 2;

export const PROMISE_NUDGE =
  '<system>You said you would do something, but this turn ended without any tool call, so nothing happened. ' +
  'Do it now: call the tools, then send the result. If you cannot do it, say exactly what is missing.</system>';

function visibleText(text: string): string {
  return text
    .replace(/<internal>[\s\S]*?<\/internal>/gi, ' ')
    .replace(/<\/?message[^>]*>/gi, '\n')
    .trim();
}

/**
 * A reply that reports a completed action ("logged", "updated", "queued"…).
 * In a turn with zero tool calls such a claim cannot be true: 2026-10-11 evals
 * caught "Got it — 3 SR44 spares logged 🍋" with nothing written.
 */
const CLAIM_RE =
  /\b(?:logged|updated|added|saved|recorded|filed|queued|pushed|synced|created|deleted|cancelled|scheduled|committed|stored)\b/i;

export const CLAIM_NUDGE =
  '<system>Your reply says something was done, but no tool ran this turn, so nothing was actually changed. ' +
  'Do it now with the tools and then confirm, or correct your reply.</system>';

/** True when a zero-tool turn claims an action happened. */
export function isUnbackedClaim(resultText: string, toolCalls: number): boolean {
  if (toolCalls > 0) return false;
  const text = visibleText(resultText);
  return Boolean(text) && text.length <= MAX_PROMISE_TEXT && CLAIM_RE.test(text);
}

/**
 * True when a turn with zero tool calls ended on a promise rather than an answer.
 * Promises after tool calls are deliberately not nudged: evals on 2026-10-12
 * (nudges-v2-x2, 5/16 vs 9/16) showed the local model spiralling into repeated
 * promises and extra messages when nudged mid-task.
 */
export function isPromiseOnly(resultText: string, toolCalls: number): boolean {
  if (toolCalls > 0) return false;
  const text = visibleText(resultText);
  return Boolean(text) && text.length <= MAX_PROMISE_TEXT && PROMISE_RE.test(text);
}

/**
 * Tool-call markup written as plain text (`<skill name="plotter">…</skill>`).
 * The local model sometimes types the call instead of making it; nothing runs.
 */
const FAKE_TOOL_RE = /<(skill|invoke|function_calls|parameter|tool_use|tool_call)\b/i;

export function isFakeToolCall(resultText: string, toolCalls: number): boolean {
  return toolCalls === 0 && FAKE_TOOL_RE.test(resultText);
}

export const FAKE_TOOL_NUDGE =
  '<system>That was text, not a tool call: writing <skill …> or similar markup runs nothing and sends nothing. ' +
  'Call the tool itself (skills load through the Skill tool), do what was asked, then reply in a <message> block.</system>';

/**
 * A chat turn that ran no tool and delivered nothing: the sender asked for
 * something and got silence. clean-x2 (2026-10-12): "queue the Sun card" ended
 * twice on an <internal> plan alone. One nudge per query.
 */
export const MAX_SILENT_NUDGES = 1;

export function buildSilentNudge(destinations: string): string {
  return (
    '<system>This turn ran no tool and sent nothing, so the person who wrote to you got no answer. ' +
    'Do what they asked now with your tools, then reply in <message to="name"> ' +
    `(your destinations: ${destinations}). If you cannot do it, say what is missing.</system>`
  );
}

/** True when a chat turn with zero tool calls delivered nothing at all. */
export function isSilentTurn(toolCalls: number, delivered: boolean): boolean {
  return toolCalls === 0 && !delivered;
}

/**
 * Plain text for an unwrapped chat reply that survived the wrap nudge, or ''
 * when it shouldn't be delivered. The local model sometimes keeps answering
 * without <message> tags; in a chat turn the only reader is the sender, so the
 * visible text goes to them instead of vanishing. Botched tool-call syntax is
 * never delivered.
 */
export function plainReplyText(resultText: string): string {
  if (FAKE_TOOL_RE.test(resultText)) return '';
  const text = resultText
    .replace(/<internal>[\s\S]*?<\/internal>/gi, ' ')
    .replace(/<to>[\s\S]*?<\/to>/gi, ' ')
    .replace(/<\/?[a-z_][^>]*>/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  return text.length >= 2 ? text : '';
}
