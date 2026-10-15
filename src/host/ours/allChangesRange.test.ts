import assert from "node:assert/strict";
import { test } from "node:test";
import { CheckpointScopeId } from "@t3tools/contracts";
import { turnFixture } from "../testing/turnFixture.js";
import { threadChangeRanges } from "./allChangesRange.js";

test("allchanges: the root scope baseline to its latest ready checkpoint, interrupted or not", () => {
  const projection = turnFixture("first", 3);
  assert.deepEqual(threadChangeRanges(projection).map(({ baseRef, headRef, turnNumber }) => ({ baseRef, headRef, turnNumber })),
    [{ baseRef: "refs/t3/checkpoints/first/0", headRef: "refs/t3/checkpoints/first/3", turnNumber: 3 }]);
  const missing = { ...projection, checkpoints: projection.checkpoints.map((entry) => entry.ordinalWithinScope === 3 ? { ...entry, status: "missing" as const } : entry) };
  assert.equal(threadChangeRanges(missing)[0]?.headRef, "refs/t3/checkpoints/first/2");
  const interrupted = { ...projection, runs: projection.runs.map((run) => ({ ...run, status: "interrupted" as const })) };
  assert.equal(threadChangeRanges(interrupted)[0]?.headRef, "refs/t3/checkpoints/first/3");
});

test("allchanges: nothing saved, no baseline, or only other scope kinds give no range", () => {
  assert.deepEqual(threadChangeRanges(turnFixture("first", 0)), []);
  const projection = turnFixture("first", 2);
  assert.deepEqual(threadChangeRanges({ ...projection, checkpoints: projection.checkpoints.filter((entry) => entry.ordinalWithinScope !== 0) }), []);
  assert.deepEqual(threadChangeRanges({ ...projection, checkpointScopes: projection.checkpointScopes.map((scope) => ({ ...scope, kind: "subagent" as const })) }), []);
});

test("allchanges: a second root scope on the same folder extends the range, another folder gets its own", () => {
  const projection = turnFixture("first", 2);
  const scope = projection.checkpointScopes[0]!;
  const later = { ...scope, id: CheckpointScopeId.make("scope-later") };
  const laterCheckpoints = projection.checkpoints.map((entry) => ({ ...entry, scopeId: later.id, ref: entry.ref.replace("first/", "later/") as typeof entry.ref }));
  const same = threadChangeRanges({ ...projection, checkpointScopes: [scope, later], checkpoints: [...projection.checkpoints, ...laterCheckpoints] });
  assert.deepEqual(same.map(({ baseRef, headRef }) => ({ baseRef, headRef })), [{ baseRef: "refs/t3/checkpoints/first/0", headRef: "refs/t3/checkpoints/later/2" }]);
  const other = threadChangeRanges({ ...projection, checkpointScopes: [scope, { ...later, cwd: "/tmp/other" }], checkpoints: [...projection.checkpoints, ...laterCheckpoints] });
  assert.deepEqual(other.map((range) => range.cwd), ["/tmp/t3-vscode", "/tmp/other"]);
});
