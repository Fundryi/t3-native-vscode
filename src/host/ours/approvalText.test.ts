import test from "node:test";
import assert from "node:assert/strict";
import { NodeId, ProviderSessionId, RuntimeRequestId, type OrchestrationV2RuntimeRequest, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import { v2Now, v2Projection } from "../../../vendor/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { approvalToast, isAlreadyAnswered } from "./approvalText.js";

const id = RuntimeRequestId.make("approval");
const request: OrchestrationV2RuntimeRequest = { id, nodeId: NodeId.make("node"), providerTurnId: null, nativeRequestRef: null, kind: "command", status: "pending", responseCapability: { type: "live", providerSessionId: ProviderSessionId.make("session") }, createdAt: v2Now, resolvedAt: null };
const ref = { driver: "codex", nativeId: "item-1", strength: "strong" } as const;
const base = { threadId: v2Projection.thread.id, runId: null, nodeId: null, providerThreadId: null, providerTurnId: null, nativeItemRef: ref, parentItemId: null, ordinal: 0, status: "waiting", title: null, startedAt: null, completedAt: null, updatedAt: v2Now } as const;
const ask = (extra: object = {}) => ({ ...base, id: "ask", type: "approval_request", requestId: id, requestKind: "command", prompt: "Needs network", ...extra }) as unknown as OrchestrationV2TurnItem;
const run = { ...base, id: "run", type: "command_execution", input: "pnpm  install" } as unknown as OrchestrationV2TurnItem;
const projection = (items: OrchestrationV2TurnItem[], changes: Partial<OrchestrationV2RuntimeRequest> = {}) => ({ ...v2Projection, runtimeRequests: [{ ...request, ...changes }], turnItems: items });

test("The approval toast offers only the decisions T3 offers, and Approve only with the real command", () => {
  assert.deepEqual(approvalToast("Fix", "command", id, projection([ask(), run])), { text: 'T3: "Fix" needs approval (command): pnpm install', buttons: ["Approve", "Deny", "Show"] });
  assert.deepEqual(approvalToast("Fix", "command", id, projection([ask({ options: [{ decision: "decline", label: "No" }] }), run])).buttons, ["Deny", "Show"]);
  assert.deepEqual(approvalToast("Fix", "command", id, projection([ask(), run], { responseCapability: { type: "not_resumable", reason: "ended" } })).buttons, ["Show"]);
  // Only a reason, no command item: Show only (owner default 5).
  const reason = approvalToast("Fix", "command", id, projection([ask()]));
  assert.deepEqual([reason.text, reason.buttons], ['T3: "Fix" needs approval (command): reason: Needs network', ["Show"]]);
  assert.deepEqual(approvalToast("", "command", id, null).buttons, ["Show"]);
  assert.equal(isAlreadyAnswered("Runtime request approval is resolved."), true);
  assert.equal(isAlreadyAnswered("Provider session session was not found."), false);
});
