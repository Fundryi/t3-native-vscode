import test from "node:test";
import assert from "node:assert/strict";
import type { HostState } from "../hostState.js";
import { memoizeSnapshot } from "./snapshotMemo.js";

test("The snapshot memo serves one revision and view for one emit pass only", async () => {
  let builds = 0;
  const fake = {
    revision: 1, views: new Map([["sidebar", {}], ["panel_1", {}]]),
    snapshot(viewId = "sidebar") {
      if (!this.views.has(viewId)) throw new Error("This conversation tab has been closed.");
      builds += 1; return { viewId, revision: this.revision };
    },
    onDidChangeState() { return () => {}; },
  };
  const host = fake as unknown as HostState;
  const restore = memoizeSnapshot(host);
  host.snapshot(); host.snapshot(); // no emit since the wrap: no memo, like bridge handle() before cancelSessionSearch
  assert.equal(builds, 2);
  fake.revision += 1; // his emit
  const first = host.snapshot();
  assert.equal(host.snapshot("sidebar"), first);
  assert.notEqual(host.snapshot("panel_1"), first);
  assert.equal(builds, 4);
  fake.views.delete("panel_1"); // removeView emits only later; the closed-tab check must still throw his error
  assert.throws(() => host.snapshot("panel_1"), /tab has been closed/);
  fake.revision += 1;
  assert.notEqual(host.snapshot(), first);
  assert.equal(builds, 5);
  await Promise.resolve();
  host.snapshot(); host.snapshot(); // same revision after the pass: built fresh every time
  assert.equal(builds, 7);
  restore();
  host.snapshot(); host.snapshot();
  assert.equal(builds, 9);
});
