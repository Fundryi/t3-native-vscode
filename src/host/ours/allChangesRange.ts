/**
 * P3 allchanges: which saved checkpoint ranges cover everything a chat changed. No vscode import, so a node:test loads it.
 * As T3's full-thread diff (CheckpointDiffQuery.ts getFullThreadDiff): the root_run scope's ordinal 0 is the baseline.
 * Subagent and tool scopes snapshot the same folder, so they are left out (they would list files twice).
 */
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import type { TurnDiff } from "../turnDiff.js";

export type ChangeRange = Omit<TurnDiff, "files">;

/** One range per folder the chat ran in: its first baseline to its latest ready checkpoint. Empty when nothing was saved. */
export function threadChangeRanges(projection: OrchestrationV2ThreadProjection): ChangeRange[] {
  const byCwd = new Map<string, ChangeRange>();
  for (const scope of projection.checkpointScopes) {
    if (scope.kind !== "root_run") continue;
    // The latest READY one, whatever its run's status: an interrupted turn's snapshot still holds its edits.
    const ready = projection.checkpoints.filter((entry) => entry.scopeId === scope.id && entry.status === "ready")
      .sort((a, b) => a.ordinalWithinScope - b.ordinalWithinScope);
    const base = ready[0], head = ready.at(-1);
    if (!base || !head || head === base) continue;
    const earlier = byCwd.get(scope.cwd);
    // shortcut: assumes T3 lists scopes oldest first; a later scope on the same folder extends the first one's range.
    if (!earlier && base.ordinalWithinScope !== 0) continue;
    byCwd.set(scope.cwd, {
      threadId: projection.thread.id, title: projection.thread.title, cwd: scope.cwd,
      turnNumber: head.appRunOrdinal ?? earlier?.turnNumber ?? 0, baseRef: earlier?.baseRef ?? base.ref, headRef: head.ref,
    });
  }
  return [...byCwd.values()];
}
