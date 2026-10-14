/**
 * Q2 keys (docs/ours/FORK-FEATURES.md Q2): one key to type into T3, one for a new chat, a Switch Chat picker.
 * Only his public provider methods; in sidebar mode layout.ts routes openSession and createNewPanel to the sidebar.
 * The insert key (Shift+Alt+K for his t3-vscode.insertReference) is a package.json binding only.
 */
import * as vscode from "vscode";
import { OURS_EVENT } from "../../shared/ours/channel.js";
import { SIDEBAR_VIEW_ID } from "../hostState.js";
import { log } from "./log.js";
import type { OursDeps } from "./types.js";

export function activateKeys({ hostState, registry, provider }: OursDeps): vscode.Disposable {
  // His Composer ignores a t3-focus-composer whose draftKey is not its own (Composer.tsx:178).
  const focusComposer = (viewId: string) =>
    registry.postWhenReady(viewId, OURS_EVENT, { kind: "focus", draftKey: hostState.snapshot(viewId).activeThreadId ?? "new" });
  const run = (name: string, body: () => Promise<void>) => async () => {
    try { await body(); } catch (cause) {
      log.error(`Fork keys: ${name} failed.`, cause);
      void vscode.window.showErrorMessage(`T3 VSCode: ${name} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };
  return vscode.Disposable.from(
    vscode.commands.registerCommand("t3-vscode.ours.chat.focus", run("Focus Chat", async () => {
      const focused = registry.focusedViewId;
      // A chat tab: his createPanel finds the tab of its own thread and reveals it (the layout wrap leaves non-sidebar sources alone).
      if (focused !== SIDEBAR_VIEW_ID) return focusComposer(await provider.createPanel(focused));
      const threadId = hostState.snapshot(SIDEBAR_VIEW_ID).activeThreadId;
      if (!threadId) { await vscode.commands.executeCommand("t3.webview.focus"); return; }
      focusComposer(await provider.openSession(threadId));
    })),
    vscode.commands.registerCommand("t3-vscode.ours.chat.new", run("New Chat", async () => {
      focusComposer(await provider.createNewPanel(SIDEBAR_VIEW_ID));
    })),
    vscode.commands.registerCommand("t3-vscode.ours.chat.switch", run("Switch Chat", async () => {
      const time = (thread: { lastActiveAt?: string | null; updatedAt: string }) => Date.parse(thread.lastActiveAt ?? thread.updatedAt) || 0;
      const threads = hostState.snapshot(SIDEBAR_VIEW_ID).threads.filter((thread) => !thread.archived).sort((a, b) => time(b) - time(a));
      if (!threads.length) { void vscode.window.showInformationMessage("T3 VSCode: no chats in this workspace yet."); return; }
      const picked = await vscode.window.showQuickPick(threads.map((thread) => ({
        label: thread.title.trim() || "New conversation",
        description: [thread.pinned ? "pinned" : "", thread.pendingRuntimeRequest ? "needs you" : thread.activeRunId ? "working" : ""].filter(Boolean).join(", "),
        id: thread.id,
      })), { placeHolder: "Switch to a T3 chat (type to filter)", matchOnDescription: true });
      if (picked) focusComposer(await provider.openSession(picked.id));
    })),
  );
}
