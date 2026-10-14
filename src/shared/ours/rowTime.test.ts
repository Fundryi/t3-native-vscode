import assert from "node:assert/strict";
import { test } from "node:test";
import type { TranscriptItem, WireTurnItem } from "../bridge.js";
import { rowTimeTitle } from "./rowTime.js";

const row = (key: string, type: string, extra: Record<string, unknown> = {}): TranscriptItem => ({ key, sourceThreadId: "t", toolLabel: null, output: null, needsDetail: false,
  item: { id: key, type, runId: "r1", status: "completed", startedAt: "2026-10-07T12:00:00Z", completedAt: "2026-10-07T12:00:10Z", ...extra } as unknown as WireTurnItem });
const iso = (time: number) => new Date(time).toISOString();

test("a user bubble shows when it was sent, an assistant message without a run when it was answered", () => {
  const rows = [row("u", "user_message", { runId: null, startedAt: null }), row("a", "assistant_message", { runId: null })];
  assert.equal(rowTimeTitle(rows, "u", "message", iso), "Sent 2026-10-07T12:00:10.000Z");
  assert.equal(rowTimeTitle(rows, "a", "message", iso), "Answered 2026-10-07T12:00:10.000Z");
  assert.equal(rowTimeTitle(rows, "missing", "message", iso), undefined);
});

test("a run header spans its rows, skips the user message and other runs, and has no finish while running", () => {
  const rows = [row("u", "user_message", { startedAt: "2026-10-07T11:00:00Z" }), row("think", "reasoning", { startedAt: "2026-10-07T12:00:01Z" }),
    row("answer", "assistant_message", { completedAt: "2026-10-07T12:05:00Z" }), row("other", "assistant_message", { runId: "r2", completedAt: "2026-10-07T13:00:00Z" })];
  assert.equal(rowTimeTitle(rows, "think", "run", iso), "Started 2026-10-07T12:00:00.000Z\nFinished 2026-10-07T12:05:00.000Z");
  assert.equal(rowTimeTitle(rows, "think", "run", iso, "r1"), "Started 2026-10-07T12:00:00.000Z", "an active run (say, waiting on an approval) shows no finish");
  assert.equal(rowTimeTitle(rows, "think", "run", iso, "r2"), "Started 2026-10-07T12:00:00.000Z\nFinished 2026-10-07T12:05:00.000Z");
  rows.push(row("cmd", "command_execution", { status: "running", completedAt: null }));
  assert.equal(rowTimeTitle(rows, "think", "run", iso), "Started 2026-10-07T12:00:00.000Z");
});
