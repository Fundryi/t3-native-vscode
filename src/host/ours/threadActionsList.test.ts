import assert from "node:assert/strict";
import { test } from "node:test";
import { threadActionEntries } from "./threadActionsList.js";

const idle = { archived: false, branch: null, parentThreadId: null, relationshipToParent: null, status: "idle", activityRunStatus: null };
const ids = (...args: Parameters<typeof threadActionEntries>) => threadActionEntries(...args).map((entry) => entry.id);

test("threadActions: each server flag shows its action, an absent flag hides it", () => {
  assert.deepEqual(ids(idle, null), ["allChanges", "copyId"]);
  assert.deepEqual(ids(idle, { threadSnooze: true, threadTitleRegeneration: true, threadVisitedTracking: true }), ["allChanges", "snooze", "regenerateTitle", "markUnread", "copyId"]);
  assert.deepEqual(ids(idle, { threadSnooze: false, threadVisitedTracking: true }), ["allChanges", "markUnread", "copyId"]);
  assert.deepEqual(ids({ ...idle, archived: true, branch: "main" }, { threadSnooze: true }), ["allChanges", "copyBranch", "copyId"]);
  // P14: Open Worktree in New Window only for a chat that runs in a worktree.
  assert.deepEqual(ids({ ...idle, branch: "t3/x" }, null, null, "/repo-worktrees/x"), ["allChanges", "copyBranch", "openWorktree", "copyId"]);
  assert.deepEqual(ids(idle, null, null, null), ["allChanges", "copyId"]);
});

test("threadActions: Stop subagent only on a working subagent thread; Show all changes on every thread", () => {
  const child = { ...idle, relationshipToParent: "subagent" as const, parentThreadId: "parent" };
  assert.deepEqual(ids(child, null), ["allChanges", "copyId"]);
  assert.deepEqual(ids({ ...child, activityRunStatus: "running" }, null), ["allChanges", "stopSubagent", "copyId"]);
  assert.deepEqual(ids({ ...idle, status: "running" }, null), ["allChanges", "copyId"]);
});

test("contnative: Continue in and Copy session ID only for Claude Code and Codex chats", () => {
  assert.deepEqual(ids(idle, null, "claudeAgent"), ["continueNative", "allChanges", "copyId", "copySessionId"]);
  assert.equal(threadActionEntries(idle, null, "codex")[0]?.label, "Continue in Codex...");
  assert.deepEqual(ids(idle, null, "opencode"), ["allChanges", "copyId"]);
  assert.deepEqual(ids(idle, null, null), ["allChanges", "copyId"]);
  assert.deepEqual(ids(idle, null, "toString"), ["allChanges", "copyId"]);
});

test("mergeback: Merge back only on a fork", () => {
  assert.deepEqual(ids({ ...idle, relationshipToParent: "fork", parentThreadId: null }, null), ["allChanges", "mergeBack", "copyId"]);
  assert.deepEqual(ids({ ...idle, relationshipToParent: "subagent", parentThreadId: "parent" }, null), ["allChanges", "copyId"]);
});
