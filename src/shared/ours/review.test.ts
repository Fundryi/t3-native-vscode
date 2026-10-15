import assert from "node:assert/strict";
import { test } from "node:test";
import type { ComposerSuggestion } from "../bridge.js";
import { reviewPrompt, withReviewSuggestion } from "./review.js";

const item = (id: string, kind: ComposerSuggestion["kind"], label: string): ComposerSuggestion => ({ id, kind, label, value: "", description: "" });
const his = [item("model", "model", "/model"), item("usage", "usage", "/usage-limits"), item("command:compact", "command", "/compact")];

test("review: /review follows /model and /usage-limits, and is renamed next to a provider /review", () => {
  assert.deepEqual(withReviewSuggestion(his, "").map((entry) => entry.label), ["/model", "/usage-limits", "/review", "/compact"]);
  // With a query his list arrives filtered and sorted by score.
  const theirs = [item("command:review", "command", "/review")];
  assert.deepEqual(withReviewSuggestion(theirs, "rev").map((entry) => entry.label), ["/review (VS Code)", "/review"]);
  assert.deepEqual(withReviewSuggestion(his, "zzz"), his);
  // The description no longer matches, and a non-prefix match goes last, so Enter keeps his best match.
  const compact = [item("command:compact", "command", "/compact")];
  assert.deepEqual(withReviewSuggestion(compact, "com"), compact);
  assert.deepEqual(withReviewSuggestion(compact, "view").map((entry) => entry.label), ["/compact", "/review"]);
});

test("review: the prompt names the exact git command and asks for file:line", () => {
  assert.match(reviewPrompt({ kind: "branch", base: "main" }), /git diff main\.\.\.HEAD/);
  assert.match(reviewPrompt({ kind: "commit", sha: "0123456789abcdef", subject: "Fix" }, "/repo"), /at \/repo\. Get it with `git show 0123456789abcdef`[\s\S]*file:line/);
});
