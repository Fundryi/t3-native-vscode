/**
 * Q3 toasts, the pure part: which threads stopped working since the last snapshot, and what the stop means.
 * No vscode import, so it is tested. Status literals: OrchestrationV2ShellThreadStatus (vendor/contracts).
 */
import type { ThreadSummary } from "../../shared/bridge.js";
import { threadIsWorking } from "../../shared/sessionTree.js";

type Thread = Pick<ThreadSummary, "id" | "status" | "activityRunStatus" | "archived" | "providerNativeSubagent">;

/** As the status bar (activity.ts): "queued" counts as working, so a queue chain toasts once at its end. */
const working = (thread: Thread) => !thread.archived && !thread.providerNativeSubagent && (threadIsWorking(thread) || thread.status === "queued");

/** The ids working now, and those that worked before and do not now (gone threads simply drop out). */
export function turnEdges(before: ReadonlySet<string>, threads: ReadonlyArray<Thread>): { working: Set<string>; stopped: string[] } {
  const now = new Set(threads.filter(working).map((thread) => thread.id));
  return { working: now, stopped: threads.filter((thread) => before.has(thread.id) && !now.has(thread.id)).map((thread) => thread.id) };
}

/** A stop the user made (interrupted, cancelled, rolled back, archived) or an idle thread gets no toast. */
export function turnOutcome(thread: Thread): "finished" | "failed" | undefined {
  if (thread.archived || working(thread)) return undefined;
  return thread.status === "completed" ? "finished" : thread.status === "failed" ? "failed" : undefined;
}
