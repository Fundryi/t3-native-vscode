/** R4 working: the pure part of "Working 1m 12s", "Worked 2m 14s" and "Response finished" (tested in working.test.ts). */
import type { TranscriptItem } from "../bridge.js";
import { isWorkItem } from "../transcriptRows.js";
import { stepLabel } from "./latest.js";

const at = (iso: string | null | undefined): number | undefined => { const time = Date.parse(iso ?? ""); return Number.isFinite(time) ? time : undefined; };

/** "45s", "1m 12s", "1h 3m": seconds while it counts up in the chat. */
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m`;
}

/** "<1m", "3m", "1h 3m": minutes, for the status bar that repaints twice a minute. */
export function minutes(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 60000));
  return total < 1 ? "<1m" : total < 60 ? `${total}m` : `${Math.floor(total / 60)}h ${total % 60}m`;
}

/** Elapsed since an ISO start, or undefined without a usable start. */
export function since(start: string | null | undefined, now: number): number | undefined {
  const time = at(start);
  return time === undefined ? undefined : now - time;
}

const sameRun = (row: TranscriptItem, runId: string, threadId: string) => row.item.runId === runId && row.sourceThreadId === threadId && row.item.type !== "user_message";

/** The first start of the run a row belongs to (fallback when the thread carries no workingStartedAt). */
export function runStart(rows: ReadonlyArray<TranscriptItem>, runId: string): string | undefined {
  const starts = rows.filter((row) => row.item.runId === runId && row.item.type !== "user_message").map((row) => at(row.item.startedAt)).filter((time) => time !== undefined);
  return starts.length ? new Date(Math.min(...starts)).toISOString() : undefined;
}

/** First start to last finish of the run that row `key` belongs to; undefined while unknown or unfinished. */
export function runTotal(rows: ReadonlyArray<TranscriptItem>, key: string): number | undefined {
  const row = rows.find((candidate) => candidate.key === key);
  const runId = row?.item.runId;
  if (!row || !runId) return undefined;
  const run = rows.filter((other) => sameRun(other, runId, row.sourceThreadId));
  if (run.some((other) => other.item.status === "running" || other.item.status === "pending")) return undefined;
  const starts = run.map((other) => at(other.item.startedAt)).filter((time) => time !== undefined);
  const ends = run.map((other) => at(other.item.completedAt)).filter((time) => time !== undefined);
  return starts.length && ends.length ? Math.max(0, Math.max(...ends) - Math.min(...starts)) : undefined;
}

/** The newest running step of the active run, with the label his rows show; a stale step of an old run never wins. */
export function currentStep(rows: ReadonlyArray<TranscriptItem>, runId: string | null | undefined): string | undefined {
  if (!runId) return undefined;
  const row = rows.findLast((candidate) => candidate.item.runId === runId && isWorkItem(candidate) && (candidate.item.status === "running" || candidate.item.status === "pending"));
  return row ? stepLabel(row).trim() || undefined : undefined;
}

/** What a screen reader hears when a turn ends. Status literals: OrchestrationV2RunStatus (vendor/contracts). */
export function endPhrase(status: string | undefined): string {
  if (status === "failed") return "Response failed";
  if (status === "interrupted" || status === "cancelled" || status === "rolled_back") return "Response stopped";
  return "Response finished";
}
