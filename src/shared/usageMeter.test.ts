import { test } from "node:test";
import assert from "node:assert/strict";
import { meterResetLabel } from "./usageMeter.js";

const now = Date.parse("2026-10-12T12:00:00Z");
test("Reset suffixes read as a duration alone, and nothing at all without a reset", () => {
  assert.equal(meterResetLabel("2026-10-16T08:00:00Z", now), "3d 20h");
  assert.equal(meterResetLabel("2026-10-12T14:13:00Z", now), "2h 13m");
  assert.equal(meterResetLabel("2026-10-12T12:12:00Z", now), "12m");
  assert.equal(meterResetLabel(undefined, now), "");
  assert.equal(meterResetLabel(null, now), "");
  assert.equal(meterResetLabel("not a date", now), "");
});
test("A window already past its reset says so rather than counting down from zero", () => {
  assert.equal(meterResetLabel("2026-10-12T11:59:00Z", now), "now");
  assert.equal(meterResetLabel("2026-10-12T12:00:00Z", now), "now");
});
