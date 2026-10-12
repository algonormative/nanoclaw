/**
 * Lemon fork (vault-1t1qn): catch turns that end on a promise with no tool
 * call. The local model sometimes answers "Let me check that photo and add
 * it…" and ends the turn without doing anything. The poll loop counts tool
 * calls per turn; when a turn made none and its final text opens a sentence
 * with a promise, it pushes one corrective prompt.
 */

/** A sentence (or message body) that opens with a promise of action. */
const PROMISE_RE =
  /(?:^|[.!?\n>]\s*|🍋\s*)(?:let me|i'll|i will|i'm going to|going to|on it|one sec|give me a (?:sec|moment|minute)|checking|looking (?:into|at) (?:it|that|this))\b/i;

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

/** True when a turn with zero tool calls ended on a promise rather than an answer. */
export function isPromiseOnly(resultText: string, toolCalls: number): boolean {
  if (toolCalls > 0) return false;
  const text = visibleText(resultText);
  if (!text || text.length > MAX_PROMISE_TEXT) return false;
  return PROMISE_RE.test(text);
}

/**
 * Plain text for an unwrapped chat reply that survived the wrap nudge, or ''
 * when it shouldn't be delivered. The local model sometimes keeps answering
 * without <message> tags; in a chat turn the only reader is the sender, so the
 * visible text goes to them instead of vanishing. Botched tool-call syntax is
 * never delivered.
 */
export function plainReplyText(resultText: string): string {
  if (/<(skill|invoke|function_calls|parameter|tool_use)\b/i.test(resultText)) return '';
  const text = resultText
    .replace(/<internal>[\s\S]*?<\/internal>/gi, ' ')
    .replace(/<to>[\s\S]*?<\/to>/gi, ' ')
    .replace(/<\/?[a-z_][^>]*>/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  return text.length >= 2 ? text : '';
}
