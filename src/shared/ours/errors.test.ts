import assert from "node:assert/strict";
import { test } from "node:test";
import type { TranscriptItem, WireTurnItem } from "../bridge.js";
import { errorView } from "./errors.js";

const row = (key: string, type: string, extra: Record<string, unknown> = {}): TranscriptItem => ({ key, sourceThreadId: "t", toolLabel: null, output: null, needsDetail: false,
  item: { id: key, type, runId: "r1", status: "failed", updatedAt: "2026-10-14T12:00:00.000Z", ...extra } as unknown as WireTurnItem });
const failure = (extra: Record<string, unknown> = {}) => ({ class: "transport_error", message: "socket hang up", code: null, retryable: true, ...extra });
const at = (seconds: number) => Date.parse("2026-10-14T12:00:00.000Z") + seconds * 1000;
const time = (value: number) => new Date(value).toISOString().slice(11, 16);

test("a pending retry counts down while it is the newest row of the active run", () => {
  const rows = [row("u", "user_message"), row("e", "error", { failure: failure(), retry: { attempt: 2, maxAttempts: 5, retryDelayMs: 4000 } })];
  assert.deepEqual(errorView(rows, "e", "r1", at(1), time), { heading: "Connection error", detail: "Retrying 2/5 in 3s", live: true, copy: "Connection error (Retrying 2/5 in 3s)\nsocket hang up" });
  assert.equal(errorView(rows, "e", "r1", at(9), time)?.detail, "Retrying 2/5");
});

test("an old retry says which attempt it was, not that it is retrying", () => {
  const error = row("e", "error", { failure: failure(), retry: { attempt: 1, maxAttempts: null, retryDelayMs: null } });
  assert.equal(errorView([error, row("a", "assistant_message")], "e", "r1", at(1), time)?.detail, "Attempt 1");
  assert.equal(errorView([error], "e", null, at(1), time)?.live, false);
});

test("class, reset time, code and a final failure", () => {
  const rows = [row("e", "error", { failure: failure({ class: "usage_limit", retryable: false, code: "rate_limited", resetAt: "2026-10-14T14:05:00.000Z" }) })];
  const view = errorView(rows, "e", "r1", at(0), time);
  assert.equal(view?.heading, "Usage limit reached");
  assert.equal(view?.detail, "Will not retry \u00b7 resets 14:05 \u00b7 code rate_limited");
  assert.equal(errorView([row("e", "error", { failure: failure({ class: "something_new" }) })], "e", null, 0, time)?.heading, "Error");
  assert.equal(errorView(rows, "missing", null, 0, time), undefined);
  assert.equal(errorView([row("u", "user_message")], "u", null, 0, time), undefined);
});
