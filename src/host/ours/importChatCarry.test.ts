import test from "node:test";
import assert from "node:assert/strict";
import { carryText, claudeTurns, codexTurns } from "./importChatCarry.js";

const line = (value: unknown) => JSON.stringify(value);
const HEADING = "Earlier conversation carried over from Claude Code (session s-1, 2026-01-02) for context. Read it, answer with one short line that you are caught up, then wait for my next message.";

test("Claude: text in order, tools, thinking, meta, sidechain and injected blocks left out", () => {
  const turns = claudeTurns([
    line({ type: "user", isMeta: true, message: { content: "<command-name>/x</command-name>" } }),
    line({ type: "user", message: { content: [{ type: "text", text: "<ide_selection>sel</ide_selection>" }, { type: "text", text: "Paint the fence" }] } }),
    line({ type: "assistant", message: { id: "m1", content: [{ type: "thinking", thinking: "hmm" }] } }),
    line({ type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Which colour?" }] } }),
    line({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", name: "Bash" }] } }),
    line({ type: "user", message: { content: [{ type: "tool_result", content: "done" }] } }),
    line({ type: "assistant", message: { id: "m2", content: [{ type: "text", text: "Or green?" }] } }),
    line({ type: "user", isSidechain: true, message: { content: "agent prompt" } }),
    line({ type: "user", message: { content: "<task-notification>t</task-notification>" } }),
    line({ type: "attachment", attachment: { type: "queued_command", commandMode: "task-notification", prompt: "<task-notification>t</task-notification>" } }),
    line({ type: "attachment", attachment: { type: "queued_command", commandMode: "prompt", prompt: [{ type: "text", text: "Blue <system-reminder>r</system-reminder>" }] } }),
    line({ type: "system", content: "x" }), line({ type: "progress" }), "{broken",
  ]);
  assert.deepEqual(turns, [
    { role: "user", text: "Paint the fence" },
    { role: "assistant", text: "Which colour?\n\nOr green?" },
    { role: "user", text: "Blue" },
  ]);
});

test("Codex: user and assistant messages, developer and AGENTS.md left out", () => {
  const turns = codexTurns([
    line({ type: "session_meta", payload: { id: "c-1" } }),
    line({ type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "rules" }] } }),
    line({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions for x" }, { type: "input_text", text: "<environment_context>e</environment_context>" }] } }),
    line({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Rename foo" }, { type: "input_image", image_url: "x" }] } }),
    line({ type: "response_item", payload: { type: "function_call", name: "shell" } }),
    line({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "## Done\nRenamed." }] } }),
  ]);
  assert.deepEqual(turns, [{ role: "user", text: "Rename foo" }, { role: "assistant", text: "## Done\nRenamed." }]);
});

test("Context message: heading, User/Assistant blocks, newest kept under the budget", () => {
  const modified = Date.UTC(2026, 0, 2, 12);
  const turns = [{ role: "user", text: "One  two\nthree" }, { role: "assistant", text: "A".repeat(50) }, { role: "user", text: "Last" }] as const;
  const full = carryText(turns, "claudeAgent", "s-1", modified);
  assert.equal(full.text, `${HEADING}\n\nUser: One  two\nthree\n\nAssistant: ${"A".repeat(50)}\n\nUser: Last`);
  assert.equal(full.turns, 3);
  assert.equal(full.firstPrompt, "One two three");
  const trimmed = carryText(turns, "claudeAgent", "s-1", modified, 80);
  assert.equal(trimmed.text, `${HEADING}\n\n(earlier part left out)\n\nAssistant: ${"A".repeat(50)}\n\nUser: Last`);
  assert.equal(trimmed.turns, 2);
  // The newest turn alone over the budget: its end is kept.
  const tail = carryText([{ role: "assistant", text: `start${"B".repeat(100)}end` }], "codex", "c-1", modified, 40);
  assert.ok(tail.text.startsWith("Earlier conversation carried over from Codex (session c-1, 2026-01-02)"));
  assert.ok(tail.text.endsWith(`\n\n(earlier part left out)\n\nAssistant: ...${"B".repeat(17)}end`));
  assert.equal(tail.firstPrompt, undefined);
});
