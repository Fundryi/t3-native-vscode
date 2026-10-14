/** Q18 rowCopy: the hover title with the time of a transcript row (pure, tested in rowTime.test.ts). */
import type { TranscriptItem } from "../bridge.js";

const at = (iso: string | null | undefined): number | undefined => { const time = Date.parse(iso ?? ""); return Number.isFinite(time) ? time : undefined; };

/**
 * "message": a user bubble ("Sent") or an assistant message outside a run ("Answered").
 * "run": the assistant header of a run, from its first start to its last finish (no finish while it still runs:
 * activeRunId is the run the snapshot says is active, which also covers approval waits and gaps between tools).
 */
export function rowTimeTitle(rows: ReadonlyArray<TranscriptItem>, key: string, kind: "message" | "run", format: (time: number) => string, activeRunId?: string | null): string | undefined {
  const row = rows.find((candidate) => candidate.key === key);
  if (!row) return undefined;
  const { item } = row;
  if (kind === "message") {
    const user = item.type === "user_message";
    const time = user ? at(item.startedAt) ?? at(item.completedAt) : at(item.completedAt) ?? at(item.startedAt);
    return time === undefined ? undefined : `${user ? "Sent" : "Answered"} ${format(time)}`;
  }
  const run = item.runId ? rows.filter((other) => other.sourceThreadId === row.sourceThreadId && other.item.runId === item.runId && other.item.type !== "user_message") : [row];
  const starts = run.map((other) => at(other.item.startedAt)).filter((time) => time !== undefined);
  const ends = run.map((other) => at(other.item.completedAt)).filter((time) => time !== undefined);
  const running = (activeRunId != null && item.runId === activeRunId) || run.some((other) => other.item.status === "running" || other.item.status === "pending");
  const lines = [starts.length ? `Started ${format(Math.min(...starts))}` : "", !running && ends.length ? `Finished ${format(Math.max(...ends))}` : ""].filter(Boolean);
  return lines.length ? lines.join("\n") : undefined;
}
