import assert from "node:assert/strict";
import { test } from "node:test";
import type { ComposerSuggestion } from "../../shared/bridge.js";
import { withPlanSuggestions } from "./planModeSuggestions.js";

const item = (id: string, kind: ComposerSuggestion["kind"], label: string): ComposerSuggestion => ({ id, kind, label, value: "", description: "" });
const his = [item("model", "model", "/model"), item("usage", "usage", "/usage-limits"), item("command:plan", "command", "/plan"), item("command:review", "command", "/review")];

test("planMode: /plan and /default follow /model and /usage-limits and replace a provider command of the same name", () => {
  assert.deepEqual(withPlanSuggestions(his, "").map((entry) => entry.id), ["model", "usage", "ours:plan", "ours:default", "command:review"]);
});

test("planMode: the query filters ours and leaves his list alone when nothing matches", () => {
  assert.deepEqual(withPlanSuggestions(his, "/def").map((entry) => entry.id), ["model", "usage", "ours:default", "command:review"]);
  assert.deepEqual(withPlanSuggestions(his, "zzz").map((entry) => entry.id), his.map((entry) => entry.id));
  assert.deepEqual(withPlanSuggestions([], "pla").map((entry) => entry.id), ["ours:plan"]);
});
