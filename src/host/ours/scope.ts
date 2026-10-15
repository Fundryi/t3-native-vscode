/**
 * P8 scope (docs/ours/FORK-FEATURES.md P8). His HostState shows only the T3 projects whose root IS a window folder,
 * so a window on a T3 worktree (T3 "Open in VS Code") or on repo/src listed no chats. This wraps his
 * options.workspaceRoots: his folders first (roots[0] stays the real first folder), then the extra roots of
 * scopeRules.ts. Non-file folders are dropped while a file folder remains (an empty list would show every project).
 */
import * as vscode from "vscode";
import { log } from "./log.js";
import { extraRoots, mainCheckout } from "./scopeRules.js";
import type { OursFeature } from "./types.js";
import { wrap } from "./wrap.js";

export const activateScope: OursFeature = ({ hostState }) => {
  // options is private in his HostState and read on every call; element access keeps it type-checked (as modelSync.ts).
  const options = hostState["options"];
  if (!options.workspaceRoots) return { dispose: () => {} };
  let memo: { folders: string; shell: unknown; archive: unknown; extras: string[] } | undefined;
  const mains = new Map<string, string | null>();
  const restore = wrap(options, "workspaceRoots", (original) => () => {
    const his = original!();
    // Hot path: his visibleProjects() calls this once per project, so the extras are recomputed only when an input changes.
    const files = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === "file").map((f) => f.uri.fsPath);
    const shell = hostState["shell"], archive = hostState["archive"], folders = files.join("\0");
    if (!memo || memo.folders !== folders || memo.shell !== shell || memo.archive !== archive) {
      let extras: string[] = [];
      try {
        // The disk walk runs once per folder list, not on every shell event.
        if (memo?.folders !== folders) mains.clear();
        const mainOf = (folder: string) => { if (!mains.has(folder)) mains.set(folder, mainCheckout(folder)); return mains.get(folder)!; };
        extras = extraRoots(files, shell?.projects ?? [], [...shell?.threads ?? [], ...shell?.archivedThreads ?? [], ...archive?.threads ?? []], mainOf);
        if (extras.join("\0") !== memo?.extras.join("\0")) log.info(`Scope: extra T3 project roots for this window: ${extras.join(", ") || "none"}.`);
      } catch (cause) { log.error("Scope: extra roots failed; only the window folders count.", cause); }
      memo = { folders, shell, archive, extras };
    }
    return [...files.length ? files : his, ...memo.extras];
  });
  return { dispose: restore };
};
