/**
 * P12 rewind: which checkpoint "Edit from here" rolls back to. T3 web's rule (session-logic.ts
 * deriveRevertTurnCountByUserMessageId and client-runtime revertThreadCheckpoint): the ready checkpoint of this
 * message's own run gives the turn count N; the target is the checkpoint of run N-1, or the scope's baseline for 0.
 * Stricter than T3: the target must be in the same scope and ready, else we refuse (a wrong one overwrites files).
 */
export interface RewindCheckpoint {
  readonly id: string;
  readonly scopeId: string;
  readonly runId: string | null;
  readonly ordinalWithinScope: number;
  readonly appRunOrdinal: number | null;
  readonly status: string;
}
export interface RewindMessage { readonly inputIntent: string; readonly runId: string | null }
export type RewindTarget = { readonly scopeId: string; readonly checkpointId: string } | { readonly refuse: string };

export function rewindTarget(checkpoints: ReadonlyArray<RewindCheckpoint>, message: RewindMessage): RewindTarget {
  if ((message.inputIntent !== "turn_start" && message.inputIntent !== "queued_turn") || message.runId === null) {
    return { refuse: "This message did not start a turn of its own (a steer), so there is no point to go back to. Use Edit from here on the message that started the turn." };
  }
  const own = checkpoints.findLast((checkpoint) => checkpoint.runId === message.runId && checkpoint.status === "ready" && checkpoint.appRunOrdinal !== null);
  if (!own) return { refuse: "This turn has no saved checkpoint, so the chat cannot go back to before it." };
  const count = Math.max(0, own.appRunOrdinal! - 1);
  // findLast: after a rollback, new runs reuse ordinals and the newest checkpoint is the live one.
  const target = checkpoints.findLast((checkpoint) => checkpoint.scopeId === own.scopeId
    && (count === 0 ? checkpoint.ordinalWithinScope === 0 && checkpoint.appRunOrdinal === null : checkpoint.appRunOrdinal === count));
  if (!target || target.status !== "ready") return { refuse: "The checkpoint before this message is not available, so the chat cannot go back to it." };
  return { scopeId: target.scopeId, checkpointId: target.id };
}
