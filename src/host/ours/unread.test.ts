import test from "node:test";
import assert from "node:assert/strict";
import * as DateTime from "effect/DateTime";
import { isUnread } from "./unread.js";

test("unread follows T3's hasUnseenCompletion: completed after the last visit; never visited counts as read", () => {
  const at = (iso: string) => DateTime.makeUnsafe(iso);
  const done = at("2026-10-15T10:00:00Z");
  assert.equal(isUnread({ latestRunCompletedAt: done, lastVisitedAt: at("2026-10-15T09:00:00Z") }), true);
  // thread.mark-unread rewinds lastVisitedAt to completedAt - 1 ms (Orchestrator.ts).
  assert.equal(isUnread({ latestRunCompletedAt: done, lastVisitedAt: at("2026-10-15T09:59:59.999Z") }), true);
  assert.equal(isUnread({ latestRunCompletedAt: done, lastVisitedAt: done }), false);
  assert.equal(isUnread({ latestRunCompletedAt: done, lastVisitedAt: null }), false);
  assert.equal(isUnread({ latestRunCompletedAt: done }), false);
  assert.equal(isUnread({ latestRunCompletedAt: null, lastVisitedAt: at("2026-10-15T09:00:00Z") }), false);
});
