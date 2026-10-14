import test from "node:test";
import assert from "node:assert/strict";
import { contextLabel, contextMeter } from "./contextUsage.js";

type Projection = Parameters<typeof contextMeter>[0];
const projection = (fields: { turns?: unknown[]; threads?: unknown[]; active?: string | null }) =>
  ({ thread: { activeProviderThreadId: "active" in fields ? fields.active : "pt-1" }, providerThreads: fields.threads ?? [], providerTurns: fields.turns ?? [] }) as unknown as Projection;

test("The newest live turn report wins over the provider thread", () => {
  const meter = contextMeter(projection({
    turns: [{ tokenUsage: { usedTokens: 50_000, maxTokens: 200_000, updatedAt: "2026-10-14T10:00:02Z" } }, {},
      { tokenUsage: { usedTokens: 10_000, maxTokens: 200_000, updatedAt: "2026-10-14T10:00:01Z" } }],
    threads: [{ id: "pt-1", contextUsage: { usedTokens: 1, maxTokens: 2 } }],
  }));
  assert.deepEqual(meter, { usedTokens: 50_000, maxTokens: 200_000, percent: 25 });
  assert.equal(contextLabel(meter!), "25% context");
});

test("Without a live report the active provider thread's contextUsage is used", () => {
  const threads = [{ id: "pt-0", contextUsage: { usedTokens: 9, maxTokens: 10 } }, { id: "pt-1", contextUsage: { usedTokens: 45_400 } }];
  const meter = contextMeter(projection({ threads }));
  assert.deepEqual(meter, { usedTokens: 45_400, maxTokens: null, percent: null });
  assert.equal(contextLabel(meter!), "45k tokens");
  assert.equal(contextMeter(projection({ threads, active: null })), null);
  assert.equal(contextMeter(projection({ threads: [{ id: "pt-1", contextUsage: null }] })), null);
});

test("Over-full context caps at 100%", () => {
  assert.equal(contextMeter(projection({ threads: [{ id: "pt-1", contextUsage: { usedTokens: 300, maxTokens: 200 } }] }))?.percent, 100);
});
