import test from "node:test";
import assert from "node:assert/strict";
import { turnEdges, turnOutcome } from "./finishedEdge.js";

const thread = (id: string, status: string, fields: Record<string, unknown> = {}) => ({ id, status, archived: false, ...fields });

test("Finished toasts: a turn that stops is an edge once; queued still works; subagents and user stops get nothing", () => {
  const first = turnEdges(new Set(), [thread("a", "running"), thread("b", "queued"), thread("sub", "running", { providerNativeSubagent: true })]);
  assert.deepEqual([...first.working], ["a", "b"]);
  assert.deepEqual(first.stopped, []);
  const next = turnEdges(first.working, [thread("a", "completed"), thread("b", "running")]);
  assert.deepEqual(next.stopped, ["a"]);
  assert.deepEqual(turnEdges(next.working, [thread("b", "cancelled")]).stopped, ["b"]);
  assert.equal(turnOutcome(thread("a", "completed")), "finished");
  assert.equal(turnOutcome(thread("a", "failed")), "failed");
  assert.equal(turnOutcome(thread("a", "cancelled")), undefined);
  assert.equal(turnOutcome(thread("a", "interrupted")), undefined);
  assert.equal(turnOutcome(thread("a", "completed", { archived: true })), undefined);
  assert.equal(turnOutcome(thread("a", "completed", { activityRunStatus: "running" })), undefined);
});
