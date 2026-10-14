import test from "node:test";
import assert from "node:assert/strict";
import type { TranscriptItem } from "../bridge.js";
import { pendingSecretRequests } from "./secrets.js";

const row = (sourceThreadId: string, item: Record<string, unknown>) => ({ key: `${sourceThreadId}:${String(item.id)}`, sourceThreadId, item, toolLabel: null, output: null, needsDetail: false }) as unknown as TranscriptItem;

test("Only pending secret requests asked in the active thread can be answered there", () => {
  const transcript = [
    row("t1", { id: "a", type: "secret_request", secretStatus: "pending" }),
    row("t1", { id: "b", type: "secret_request", secretStatus: "saved" }),
    row("t0", { id: "c", type: "secret_request", secretStatus: "pending" }), // inherited through a fork
    row("t1", { id: "d", type: "notification", summary: "x" }),
  ];
  assert.deepEqual(pendingSecretRequests(transcript, "t1").map((r) => r.item.id), ["a"]);
  assert.deepEqual(pendingSecretRequests(transcript, undefined), []);
});
