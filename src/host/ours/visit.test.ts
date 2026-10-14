import test from "node:test";
import assert from "node:assert/strict";
import { oursRpc } from "./rpc.js";
import { activateVisit, VISIT_THROTTLE_MS } from "./visit.js";
import type { OursDeps } from "./types.js";

test("thread.visit goes out once per updatedAt, only for the view's own thread, only with the capability", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const dispatched: Array<Record<string, unknown>> = [];
  let tracking: boolean | undefined = true;
  let updatedAt = "2026-10-14T10:00:00.000Z";
  const client = { get config() { return { environment: { capabilities: { threadVisitedTracking: tracking } } }; },
    dispatch: async (input: Record<string, unknown>) => { dispatched.push(input); } } as unknown as OursDeps["client"];
  const hostState = { snapshot: () => ({ activeThreadId: "t1", threads: [{ id: "t1", updatedAt }] }) } as unknown as OursDeps["hostState"];
  const feature = activateVisit({ client, hostState });
  const show = async (params: Record<string, unknown>) => { await oursRpc({ kind: "visitShowing", ...params }, "panel_1"); await Promise.resolve(); };
  try {
    await show({ threadId: "t1" });
    await show({ threadId: "t1" });
    assert.deepEqual(dispatched.map(({ type, threadId, visitedAt }) => ({ type, threadId, visitedAt })),
      [{ type: "thread.visit", threadId: "t1", visitedAt: updatedAt }]);
    await show({ threadId: "t2" }); // not the view's active thread
    assert.equal(dispatched.length, 1);
    // Streaming: a newer updatedAt waits for the trailing throttle, then carries the newest watermark.
    await show({ threadId: "t1" }); // back from t2 counts as reopening
    assert.equal(dispatched.length, 2);
    updatedAt = "2026-10-14T10:00:01.000Z";
    await show({ threadId: "t1", running: true });
    assert.equal(dispatched.length, 2);
    updatedAt = "2026-10-14T10:00:02.000Z";
    await show({ threadId: "t1", running: true });
    assert.equal(dispatched.length, 2);
    t.mock.timers.tick(VISIT_THROTTLE_MS);
    await Promise.resolve();
    assert.equal(dispatched.at(-1)?.visitedAt, "2026-10-14T10:00:02.000Z");
    // A run that finishes while a trailing visit is pending is marked read at once, not after the throttle.
    updatedAt = "2026-10-14T10:00:03.000Z";
    await show({ threadId: "t1", running: true });
    assert.equal(dispatched.length, 3);
    updatedAt = "2026-10-14T10:00:04.000Z";
    await show({ threadId: "t1" });
    assert.equal(dispatched.length, 4);
    assert.equal(dispatched.at(-1)?.visitedAt, "2026-10-14T10:00:04.000Z");
    t.mock.timers.tick(VISIT_THROTTLE_MS); // the cleared timer sends nothing more
    await Promise.resolve();
    assert.equal(dispatched.length, 4);
    tracking = undefined;
    updatedAt = "2026-10-14T10:00:05.000Z";
    await show({ threadId: "t1" });
    assert.equal(dispatched.length, 4);
  } finally { feature.dispose(); }
});
