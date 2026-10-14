import test from "node:test";
import assert from "node:assert/strict";
import { activity } from "./activity.js";

const thread = (id: string, fields: Partial<Parameters<typeof activity>[0]["threads"][number]> = {}) =>
  ({ id, title: id, status: "idle", archived: false, ...fields });

test("Status bar activity: waiting beats running, archived and provider subagents count nowhere, queued runs", () => {
  const request = { id: "r1", kind: "command", createdAt: "2026-10-14T00:00:00.000Z" };
  const state = activity({ phase: "ready", threads: [
    thread("both", { status: "running", pendingRuntimeRequest: request }),
    thread("archived", { status: "running", archived: true, pendingRuntimeRequest: request }),
    thread("subagent", { status: "running", providerNativeSubagent: true }),
    thread("queued", { status: "queued" }),
    thread("idle"),
  ] });
  assert.deepEqual(state.wait.map((item) => item.id), ["both"]);
  assert.deepEqual(state.run.map((item) => item.id), ["queued"]);
  assert.equal(state.command, "t3-vscode.ours.statusbar.open");
  assert.deepEqual(state.args, ["both"]);
});

test("Status bar activity: each connection phase says what it is, pairing has no click", () => {
  assert.equal(activity({ phase: "ready", threads: [thread("idle")] }).text, "T3");
  assert.equal(activity({ phase: "pairing", threads: [] }).command, undefined);
  assert.equal(activity({ phase: "error", threads: [] }).text, "T3: connection problem");
  assert.equal(activity({ phase: "no-server", threads: [] }).text, "T3: not running");
  assert.equal(activity({ phase: "discovering", threads: [] }).text, "$(sync~spin) T3: connecting");
  assert.deepEqual(activity({ phase: "connecting", notice: "Connection lost.", threads: [] }).lines[0], "Connection lost.");
});

test("Status bar activity: one running thread shows its minutes, in the text and the hover", () => {
  const now = Date.parse("2026-10-14T12:03:30.000Z");
  const state = activity({ phase: "ready", threads: [thread("build", { status: "running", workingStartedAt: "2026-10-14T12:00:00.000Z" })] }, now);
  assert.equal(state.text, "$(sync~spin) T3: running 3m");
  assert.deepEqual(state.lines, ["build: running 3m"]);
  assert.equal(activity({ phase: "ready", threads: [thread("build", { status: "running" })] }, now).text, "$(sync~spin) T3: running");
});
