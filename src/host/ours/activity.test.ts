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
  assert.equal(activity({ phase: "ready", threads: [thread("idle")] }).text, undefined);
  assert.equal(activity({ phase: "pairing", threads: [] }).command, "t3-vscode.pair");
});
