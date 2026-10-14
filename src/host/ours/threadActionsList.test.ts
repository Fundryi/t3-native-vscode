import assert from "node:assert/strict";
import { test } from "node:test";
import { threadActionEntries } from "./threadActionsList.js";

const idle = { archived: false, branch: null, parentThreadId: null, relationshipToParent: null, status: "idle", activityRunStatus: null };
const ids = (...args: Parameters<typeof threadActionEntries>) => threadActionEntries(...args).map((entry) => entry.id);

test("threadActions: each server flag shows its action, an absent flag hides it", () => {
  assert.deepEqual(ids(idle, null), ["copyId"]);
  assert.deepEqual(ids(idle, { threadSnooze: true, threadTitleRegeneration: true, threadVisitedTracking: true }), ["snooze", "regenerateTitle", "markUnread", "copyId"]);
  assert.deepEqual(ids(idle, { threadSnooze: false, threadVisitedTracking: true }), ["markUnread", "copyId"]);
  assert.deepEqual(ids({ ...idle, archived: true, branch: "main" }, { threadSnooze: true }), ["copyBranch", "copyId"]);
});

test("threadActions: Stop subagent only on a working subagent thread", () => {
  const child = { ...idle, relationshipToParent: "subagent" as const, parentThreadId: "parent" };
  assert.deepEqual(ids(child, null), ["copyId"]);
  assert.deepEqual(ids({ ...child, activityRunStatus: "running" }, null), ["stopSubagent", "copyId"]);
  assert.deepEqual(ids({ ...idle, status: "running" }, null), ["copyId"]);
});
