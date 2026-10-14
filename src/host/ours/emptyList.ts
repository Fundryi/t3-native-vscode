/**
 * R19 emptylist, host side (docs/ours/FORK-FEATURES.md R19). Requests from src/webview/ours/emptyList.ts:
 * - emptyList.info: { otherChats, folderOpen } for the empty sessions list and its footer.
 * - emptyList.run { action: "new" | "show" }: Start a chat (Q2 chat.new) or Switch Chat over the other-folder chats.
 * Those chats stay outside his workspace filter: Switch Chat only lists them and offers to open their folder.
 */
import * as vscode from "vscode";
import * as DateTime from "effect/DateTime";
import type { OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import type { HostState } from "../hostState.js";
import { otherChats } from "./emptyListRules.js";
import { log } from "./log.js";
import { registerOursRpc } from "./rpc.js";
import type { OursDeps } from "./types.js";

export interface OtherChat { readonly id: string; readonly title: string; readonly root: string; readonly time: number }

let warned = false;
/** The chats T3 has in folders this window does not show, newest first. */
export function otherFolderChats(hostState: HostState): OtherChat[] {
  // shortcut: reads his private HostState.shell and visibleProjects() by name (TS private is compile-time only, as
  // contextMeter.ts reads threads); an upstream rename shows no count and logs once. Swap for a public getter if approved.
  const host = hostState as unknown as { shell?: OrchestrationV2ShellSnapshot | null; visibleProjects?: () => ReadonlyArray<{ readonly id: string }> };
  if (!("shell" in host) || typeof host.visibleProjects !== "function") {
    if (!warned) { warned = true; log.error("Empty list: HostState.shell or visibleProjects is gone; no other-folder count."); }
    return [];
  }
  const shell = host.shell;
  if (!shell) return [];
  const visible = new Set(host.visibleProjects().map((project) => project.id));
  const roots = new Map(shell.projects.map((project) => [project.id, project.workspaceRoot]));
  return otherChats(shell.threads, visible)
    .map((thread) => ({ id: thread.id, title: thread.title.trim() || "New conversation", root: roots.get(thread.projectId) ?? "", time: DateTime.toEpochMillis(thread.updatedAt) }))
    .sort((a, b) => b.time - a.time);
}

export function activateEmptyList({ hostState }: OursDeps): vscode.Disposable {
  const offs = [
    // His filter shows every project when the window has no folder (hostState.ts pathInWorkspace), so the count is 0 then.
    registerOursRpc("emptyList.info", (_params, viewId) => ({
      otherChats: otherFolderChats(hostState).length,
      folderOpen: hostState.snapshot(viewId).workspaceRoots.length > 0,
    })),
    registerOursRpc("emptyList.run", (params) => {
      // Not awaited: Switch Chat waits on a quick pick; Q2's run() toasts its own failures.
      if (params.action === "new") void vscode.commands.executeCommand("t3-vscode.ours.chat.new");
      else if (params.action === "show") void vscode.commands.executeCommand("t3-vscode.ours.chat.switch", "other");
      else throw new Error("Unknown empty list action.");
      return true;
    }),
  ];
  return { dispose: () => { for (const off of offs) off(); } };
}
