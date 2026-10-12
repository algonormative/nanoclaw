/**
 * Lemon fork: button taps that arrive after ask_user_question stopped waiting.
 *
 * The tool blocks for its timeout (default 300 s) and polls for the host's
 * `question_response` system row. A later tap still lands in inbound.db, but
 * the poll loop skipped every system row, so the answer vanished. While the
 * tool waits it keeps a marker file here; a response with no live waiter
 * (timed out, or the container restarted) becomes an ordinary chat line.
 */
import fs from "fs";
import path from "path";

import type { MessageInRow } from "./db/messages-in.js";

export const QUESTION_DIR = "/tmp/nanoclaw-questions";

interface QuestionMarker {
  title: string;
  options: { label: string; value: string }[];
  expired?: boolean;
}

function markerPath(questionId: string, dir: string): string {
  return path.join(dir, `${questionId.replace(/[^\w.-]/g, "_")}.json`);
}

/** Called by ask_user_question when it starts waiting. */
export function markWaiting(
  questionId: string,
  marker: QuestionMarker,
  dir = QUESTION_DIR,
): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(markerPath(questionId, dir), JSON.stringify(marker));
  } catch {
    // Best effort: without a marker a reply is surfaced as a late answer.
  }
}

/** Called when the tool got its answer (remove) or gave up (keep, flagged expired). */
export function markDone(
  questionId: string,
  expired: boolean,
  dir = QUESTION_DIR,
): void {
  const file = markerPath(questionId, dir);
  try {
    if (!expired) return fs.rmSync(file, { force: true });
    const marker = JSON.parse(fs.readFileSync(file, "utf8")) as QuestionMarker;
    fs.writeFileSync(file, JSON.stringify({ ...marker, expired: true }));
  } catch {
    // Missing marker: the response will be surfaced without its title.
  }
}

function readMarker(
  questionId: string,
  dir: string,
): QuestionMarker | undefined {
  try {
    return JSON.parse(
      fs.readFileSync(markerPath(questionId, dir), "utf8"),
    ) as QuestionMarker;
  } catch {
    return undefined;
  }
}

/**
 * Rewrite late question responses as chat rows the agent will see. Responses
 * a live ask_user_question is still waiting for stay system rows (the tool
 * consumes them); every other system row is left untouched.
 */
export function surfaceLateAnswers(
  rows: MessageInRow[],
  dir = QUESTION_DIR,
): MessageInRow[] {
  return rows.map((row) => {
    if (row.kind !== "system") return row;
    let parsed: { type?: string; questionId?: string; selectedOption?: string };
    try {
      parsed = JSON.parse(row.content);
    } catch {
      return row;
    }
    if (parsed.type !== "question_response" || !parsed.questionId) return row;
    const marker = readMarker(parsed.questionId, dir);
    if (marker && !marker.expired) return row;
    const value = parsed.selectedOption ?? "";
    const label =
      marker?.options.find((o) => o.value === value)?.label ?? value;
    const text = marker
      ? `[Tapped "${label}" on your earlier question "${marker.title}" (after you stopped waiting). Act on it now.]`
      : `[Tapped "${label}" on one of your earlier questions (after you stopped waiting). Act on it now.]`;
    try {
      fs.rmSync(markerPath(parsed.questionId, dir), { force: true });
    } catch {
      // ignore
    }
    return {
      ...row,
      kind: "chat",
      trigger: 1,
      content: JSON.stringify({ text, sender: "Button tap" }),
    };
  });
}
