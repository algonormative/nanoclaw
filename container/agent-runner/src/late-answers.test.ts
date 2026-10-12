import { describe, expect, it } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import type { MessageInRow } from "./db/messages-in.js";
import { markDone, markWaiting, surfaceLateAnswers } from "./late-answers.js";

const row = (questionId: string, value: string): MessageInRow => ({
  id: `qr-${questionId}`,
  seq: 2,
  kind: "system",
  timestamp: "2026-10-12T17:00:00Z",
  status: "pending",
  process_after: null,
  recurrence: null,
  series_id: null,
  tries: 0,
  trigger: 1,
  platform_id: "telegram:1",
  channel_type: "telegram",
  thread_id: null,
  content: JSON.stringify({
    type: "question_response",
    questionId,
    selectedOption: value,
  }),
  source_session_id: null,
  on_wake: 0,
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "q-"));
const marker = {
  title: "Which Sun card?",
  options: [{ label: "Standard (~24 min)", value: "sun-std" }],
};

describe("surfaceLateAnswers", () => {
  it("leaves a response the tool is still waiting for", () => {
    const dir = tmp();
    markWaiting("q1", marker, dir);
    expect(surfaceLateAnswers([row("q1", "sun-std")], dir)[0].kind).toBe(
      "system",
    );
  });

  it("turns a response after the timeout into a chat line with the label and title", () => {
    const dir = tmp();
    markWaiting("q1", marker, dir);
    markDone("q1", true, dir);
    const out = surfaceLateAnswers([row("q1", "sun-std")], dir)[0];
    expect(out.kind).toBe("chat");
    expect(out.trigger).toBe(1);
    expect(JSON.parse(out.content).text).toContain(
      '"Standard (~24 min)" on your earlier question "Which Sun card?"',
    );
  });

  it("surfaces a response with no marker (container restarted)", () => {
    const out = surfaceLateAnswers([row("gone", "sun-std")], tmp())[0];
    expect(out.kind).toBe("chat");
    expect(JSON.parse(out.content).text).toContain('"sun-std"');
  });

  it("removes the marker once answered in time, and ignores other rows", () => {
    const dir = tmp();
    markWaiting("q1", marker, dir);
    markDone("q1", false, dir);
    expect(fs.readdirSync(dir)).toEqual([]);
    const other = {
      ...row("x", "y"),
      content: JSON.stringify({ type: "cli_response" }),
    };
    expect(surfaceLateAnswers([other], dir)[0]).toBe(other);
  });
});
