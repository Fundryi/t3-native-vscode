/**
 * R8 errors, the pure part: what a turn error row says above its message. No DOM, so it is tested.
 * Fields: the "error" turn item of vendor/contracts/src/orchestrationV2.ts (failure class, code, retryable, resetAt; retry).
 */
import type { TranscriptItem } from "../bridge.js";

const HEADINGS: Readonly<Record<string, string>> = {
  usage_limit: "Usage limit reached",
  provider_error: "Provider error",
  transport_error: "Connection error",
  permission_error: "Permission denied",
  validation_error: "Invalid request",
};

export interface ErrorView {
  readonly heading: string;
  /** Retry and reset state, "" when there is none. */
  readonly detail: string;
  /** A retry is still pending: the countdown needs a tick. */
  readonly live: boolean;
  /** What "Copy error" puts on the clipboard. */
  readonly copy: string;
}

const count = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

/**
 * The view of the error row `key`, or undefined when the transcript has no such error row.
 * A retry is "live" only while the run is still active and nothing came after the error: the item stays after a
 * retry succeeded, and "Retrying" on an old row would be wrong.
 */
export function errorView(rows: ReadonlyArray<TranscriptItem>, key: string, activeRunId: string | null | undefined, now: number, formatTime: (time: number) => string): ErrorView | undefined {
  const index = rows.findIndex((row) => row.key === key);
  const item = rows[index]?.item;
  if (!item || item.type !== "error" || !item.failure || typeof item.failure !== "object") return undefined;
  const { failure } = item, retry = item.retry && typeof item.retry === "object" ? item.retry : undefined;
  const heading = HEADINGS[failure.class] ?? "Error";
  const parts: string[] = [];
  const live = !!retry && !!item.runId && item.runId === activeRunId && index === rows.length - 1;
  if (retry) {
    const attempt = count(retry.attempt), max = count(retry.maxAttempts);
    const of = attempt === undefined ? "" : max ? ` ${attempt}/${max}` : ` ${attempt}`;
    if (live) {
      const delay = count(retry.retryDelayMs), since = Date.parse(item.updatedAt);
      const left = delay === undefined || Number.isNaN(since) ? undefined : Math.ceil((since + delay - now) / 1000);
      parts.push(`Retrying${of}${left !== undefined && left > 0 ? ` in ${left}s` : ""}`);
    } else if (of) parts.push(`Attempt${of}`);
  } else if (failure.retryable === false) parts.push("Will not retry");
  const reset = typeof failure.resetAt === "string" ? Date.parse(failure.resetAt) : NaN;
  if (!Number.isNaN(reset)) parts.push(`resets ${formatTime(reset)}`);
  if (typeof failure.code === "string" && failure.code) parts.push(`code ${failure.code}`);
  const detail = parts.join(" \u00b7 ");
  return { heading, detail, live, copy: `${heading}${detail ? ` (${detail})` : ""}\n${String(failure.message ?? "")}` };
}
