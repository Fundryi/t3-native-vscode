import assert from "node:assert/strict";
import { test } from "node:test";
import type { TranscriptItem, WireTurnItem } from "../bridge.js";
import { clock, currentStep, minutes, runTotal } from "./working.js";

const row = (key: string, type: string, fields: Record<string, unknown> = {}): TranscriptItem => ({ key, sourceThreadId: "thread", toolLabel: null, output: null, needsDetail: false,
  item: { id: key, type, status: "completed", text: key, attachments: [], ...fields } as unknown as WireTurnItem });
const t = (seconds: number) => new Date(Date.UTC(2026, 9, 14, 12, 0, seconds)).toISOString();

test("working: clock counts seconds, the status bar counts minutes", () => {
  assert.deepEqual([clock(-5), clock(45_900), clock(72_000), clock(3_780_000)], ["0s", "45s", "1m 12s", "1h 3m"]);
  assert.deepEqual([minutes(59_000), minutes(180_000), minutes(3_780_000)], ["<1m", "3m", "1h 3m"]);
});

test("working: a run's total spans its first start to its last finish, never the prompt, never while a step runs", () => {
  const rows = [
    row("prompt", "user_message", { runId: "r1", startedAt: t(0), completedAt: t(0) }),
    row("cmd", "command_execution", { runId: "r1", input: "ls", startedAt: t(5), completedAt: t(30) }),
    row("answer", "assistant_message", { runId: "r1", startedAt: t(40), completedAt: t(139) }),
    row("other", "assistant_message", { runId: "r2", startedAt: t(200), completedAt: t(300) }),
  ];
  assert.equal(runTotal(rows, "answer"), 134_000);
  assert.equal(runTotal([...rows, row("late", "reasoning", { runId: "r1", status: "running", startedAt: t(140) })], "answer"), undefined);
  assert.equal(runTotal(rows, "missing"), undefined);
});

test("working: the current step is the newest running step of the active run only", () => {
  const rows = [
    row("stale", "command_execution", { runId: "old", status: "running", input: "old thing" }),
    row("done", "command_execution", { runId: "r1", input: "ls" }),
    row("build", "command_execution", { runId: "r1", status: "running", input: "npm test\n--watch" }),
  ];
  assert.equal(currentStep(rows, "r1"), "npm test");
  assert.equal(currentStep(rows, "r2"), undefined);
  assert.equal(currentStep(rows, null), undefined);
});
