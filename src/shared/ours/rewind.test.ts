import assert from "node:assert/strict";
import { test } from "node:test";
import { rewindTarget, type RewindCheckpoint } from "./rewind.js";

const cp = (id: string, appRunOrdinal: number | null, ordinalWithinScope: number, runId: string | null, extra: Partial<RewindCheckpoint> = {}): RewindCheckpoint =>
  ({ id, scopeId: "s", runId, ordinalWithinScope, appRunOrdinal, status: "ready", ...extra });
const thread = [cp("base", null, 0, null), cp("c1", 1, 1, "r1"), cp("c2", 2, 2, "r2"), cp("c3", 3, 3, "r3")];
const msg = (runId: string | null, inputIntent = "turn_start") => ({ runId, inputIntent });

test("rewind goes to the checkpoint BEFORE the message, never its own (a wrong one overwrites files)", () => {
  assert.deepEqual(rewindTarget(thread, msg("r2")), { scopeId: "s", checkpointId: "c1" });
  assert.deepEqual(rewindTarget(thread, msg("r3", "queued_turn")), { scopeId: "s", checkpointId: "c2" });
  assert.deepEqual(rewindTarget(thread, msg("r1")), { scopeId: "s", checkpointId: "base" });
});

test("rewind refuses steers, missing or non-ready checkpoints, and ignores another scope", () => {
  assert.ok("refuse" in rewindTarget(thread, msg("r2", "steer")));
  assert.ok("refuse" in rewindTarget(thread, msg(null)));
  assert.ok("refuse" in rewindTarget(thread, msg("r9")));
  assert.ok("refuse" in rewindTarget([cp("base", null, 0, null), cp("c1", 1, 1, "r1", { status: "stale" }), cp("c2", 2, 2, "r2")], msg("r2")));
  assert.ok("refuse" in rewindTarget([cp("other", 1, 1, "rx", { scopeId: "t" }), cp("c2", 2, 2, "r2")], msg("r2")));
});

test("after an earlier rollback the newest checkpoint of a reused ordinal wins", () => {
  const after = [...thread.slice(0, 2), cp("c2old", 2, 2, "r2", { status: "stale" }), cp("c2new", 2, 3, "r2b"), cp("c3new", 3, 4, "r3b")];
  assert.deepEqual(rewindTarget(after, msg("r3b")), { scopeId: "s", checkpointId: "c2new" });
});
