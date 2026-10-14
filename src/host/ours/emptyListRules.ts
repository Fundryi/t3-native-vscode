/** R19 emptylist: which T3 chats live outside this window's folders. No vscode import, so a node:test covers it. */
export interface ShellThreadLike {
  readonly projectId: string;
  readonly archivedAt: unknown;
  readonly deletedAt: unknown;
  readonly lineage: { readonly relationshipToParent: string | null };
}

/** Live top-level chats of projects his workspace filter hides. Subagents sit under their parent in his list, so they do not count. */
export function otherChats<T extends ShellThreadLike>(threads: ReadonlyArray<T>, visibleProjectIds: ReadonlySet<string>): T[] {
  return threads.filter((thread) => !thread.deletedAt && !thread.archivedAt && thread.lineage.relationshipToParent !== "subagent" && !visibleProjectIds.has(thread.projectId));
}
