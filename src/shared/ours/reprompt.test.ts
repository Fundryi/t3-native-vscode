import test from "node:test";
import assert from "node:assert/strict";
import type { TranscriptItem } from "../bridge.js";
import { formatComposerMessage, insertFileReference } from "../composerContext.js";
import { promptBefore, promptEntries, recallText, stepPrompt } from "./reprompt.js";

const row = (key: string, item: Record<string, unknown>) => ({ key, sourceThreadId: "t", item, toolLabel: null, output: null, needsDetail: false }) as unknown as TranscriptItem;
const user = (key: string, text: string) => row(key, { type: "user_message", text });
const transcript = [user("a", "first"), row("r1", { type: "assistant_message", text: "ok" }), user("b", "Ultrathink:\nsecond"), user("c", "second"),
  user("d", ""), row("e", { type: "error", failure: { message: "boom" } })];

test("Recall keeps the typed text, drops the snapshot sections and the ultrathink prefix", () => {
  // A real composer send with a selection snapshot, as messageReferences.test.ts builds it.
  const draft = insertFileReference("look at ", [], { type: "file", uri: "file:///x/a.ts", path: "a.ts", label: "a.ts", range: { start: { line: 1, column: 1 }, end: { line: 2, column: 1 } }, text: "const a = 1;" }, { start: 8, end: 8 });
  const sent = formatComposerMessage(draft.text, draft.contexts);
  assert.ok(sent.includes("const a = 1;"));
  assert.equal(recallText("  hi  "), "hi");
  assert.equal(recallText("Ultrathink:\nthink hard"), "think hard");
  assert.equal(recallText(sent), "look at [@a.ts:1](file:///x/a.ts#L1)");
});

test("Entries collapse consecutive duplicates and skip attachment-only sends", () => {
  assert.deepEqual(promptEntries(transcript), [{ id: "a", prompt: "first" }, { id: "c", prompt: "second" }]);
});

test("ArrowUp walks back from an empty box, ArrowDown forward, past the newest the box empties", () => {
  const entries = promptEntries(transcript);
  const one = stepPrompt("backward", entries, null, "");
  assert.deepEqual(one, { position: { id: "c", recalled: "second" }, prompt: "second" });
  const two = stepPrompt("backward", entries, one!.position, "second");
  assert.equal(two?.prompt, "first");
  assert.equal(stepPrompt("backward", entries, two!.position, "first"), null); // oldest: the caret moves as usual
  assert.equal(stepPrompt("forward", entries, two!.position, "first")?.prompt, "second");
  assert.deepEqual(stepPrompt("forward", entries, one!.position, "second"), { position: null, prompt: "" });
  assert.equal(stepPrompt("backward", entries, null, "typed"), null); // a typed draft never steps
  assert.equal(stepPrompt("backward", entries, one!.position, "second edited"), null);
  assert.equal(stepPrompt("forward", entries, null, ""), null);
});

test("Retry finds the prompt the failed turn answered", () => {
  assert.equal(promptBefore(transcript, "e"), "second");
  assert.equal(promptBefore(transcript, "a"), "first");
  assert.equal(promptBefore(transcript, "missing"), undefined);
});
