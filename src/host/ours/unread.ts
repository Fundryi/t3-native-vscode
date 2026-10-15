/**
 * P7 unread (docs/ours/FORK-FEATURES.md P7): which chats finished since they were last looked at, by T3's own rule
 * (hasUnseenCompletion, apps/web/src/components/Sidebar.logic.ts). The sessions list (src/webview/ours/unread.ts) asks
 * for the ids with unread.ids and puts a dot on those rows; Switch Chat (keys.ts) marks them too.
 * No value import of vscode, so unread.test.ts and visit.ts can load it.
 */
import type * as vscode from "vscode";
import * as DateTime from "effect/DateTime";
import type { OrchestrationV2ShellSnapshot, OrchestrationV2ThreadShell } from "@t3tools/contracts";
import type { HostState } from "../hostState.js";
import { registerOursRpc } from "./rpc.js";

/** T3's rule: the latest run completed after the last visit. A thread never visited (null) or a server without
 *  visited tracking (undefined) counts as read, so a first start does not light up every old chat. */
export function isUnread(thread: Pick<OrchestrationV2ThreadShell, "latestRunCompletedAt" | "lastVisitedAt">): boolean {
  if (!thread.latestRunCompletedAt || !thread.lastVisitedAt) return false;
  return DateTime.toEpochMillis(thread.latestRunCompletedAt) > DateTime.toEpochMillis(thread.lastVisitedAt);
}

/** The ids of unread chats in T3's live shell. */
export function unreadIds(hostState: HostState): string[] {
  // shortcut: reads his private HostState.shell by name, as emptyList.ts does (that one logs a rename); an upstream
  // rename shows no dots. Swap for a public getter if he adds one.
  const shell = (hostState as unknown as { shell?: OrchestrationV2ShellSnapshot | null }).shell;
  return shell ? shell.threads.filter(isUnread).map((thread) => thread.id) : [];
}

export function activateUnread({ hostState }: { readonly hostState: HostState }): vscode.Disposable {
  const off = registerOursRpc("unread.ids", () => unreadIds(hostState));
  return { dispose: off };
}
